import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db/prisma';
import { AppError } from '@/server/errors';
import * as tasks from '@/features/tasks/service';
import * as approvals from '@/features/approvals/service';
import * as ledger from '@/features/ledger/service';
import {
  createFamilyFixture,
  createOccurrence,
  createTaskFixture,
  type FamilyFixture,
} from '@/test/factories';

/**
 * Vertical Slice 1 (brief §47) and the approval half of the §46 critical list.
 */

const TODAY = '2026-09-21';

let fixture: FamilyFixture;

beforeEach(async () => {
  fixture = await createFamilyFixture();
});

async function readyCompletion(options: Parameters<typeof createTaskFixture>[2] = {}) {
  const task = await createTaskFixture(fixture, [fixture.childId], options);
  const occurrence = await createOccurrence(fixture, task.id, fixture.childId, TODAY);
  const { completion } = await tasks.submitCompletion(fixture.childActor, {
    occurrenceId: occurrence.id,
  });
  return { task, occurrence, completion };
}

describe('submission (BR-10)', () => {
  it('awards absolutely nothing before a parent approves', async () => {
    await readyCompletion();

    const balances = await ledger.getBalances(prisma, fixture.childId);
    expect(balances).toEqual({ lifetimeXp: 0, rewardPoints: 0, characterStars: 0 });
    expect(await prisma.xpTransaction.count()).toBe(0);
    expect(await prisma.rewardPointsTransaction.count()).toBe(0);
  });

  it('marks the occurrence as waiting for a parent', async () => {
    const { occurrence, completion } = await readyCompletion();
    const refreshed = await prisma.taskOccurrence.findUniqueOrThrow({ where: { id: occurrence.id } });
    expect(refreshed.status).toBe('SUBMITTED');
    expect(completion.status).toBe('PENDING');
  });

  it('notifies the parents', async () => {
    await readyCompletion();
    const notification = await prisma.notification.findFirstOrThrow({
      where: { recipientType: 'PARENT' },
    });
    expect(notification.kind).toBe('TASK_SUBMITTED');
    expect(notification.recipientUserId).toBe(fixture.parentUserId);
  });

  it('is idempotent when the child double-taps DONE (BR-9)', async () => {
    const task = await createTaskFixture(fixture, [fixture.childId]);
    const occurrence = await createOccurrence(fixture, task.id, fixture.childId, TODAY);

    const first = await tasks.submitCompletion(fixture.childActor, { occurrenceId: occurrence.id });
    const second = await tasks.submitCompletion(fixture.childActor, { occurrenceId: occurrence.id });

    expect(second.created).toBe(false);
    expect(second.completion.id).toBe(first.completion.id);
    expect(await prisma.taskCompletion.count({ where: { occurrenceId: occurrence.id } })).toBe(1);
  });

  it('refuses a claim on another child in the same family (BR-57)', async () => {
    const task = await createTaskFixture(fixture, [fixture.secondChildId]);
    const occurrence = await createOccurrence(fixture, task.id, fixture.secondChildId, TODAY);

    await expect(
      tasks.submitCompletion(fixture.childActor, { occurrenceId: occurrence.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a claim on another family entirely (BR-56)', async () => {
    const other = await createFamilyFixture();
    const task = await createTaskFixture(other, [other.childId]);
    const occurrence = await createOccurrence(other, task.id, other.childId, TODAY);

    await expect(
      tasks.submitCompletion(fixture.childActor, { occurrenceId: occurrence.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('asks for a note when the task requires evidence (BR-16)', async () => {
    const task = await createTaskFixture(fixture, [fixture.childId], { evidenceType: 'NOTE' });
    const occurrence = await createOccurrence(fixture, task.id, fixture.childId, TODAY);

    await expect(
      tasks.submitCompletion(fixture.childActor, { occurrenceId: occurrence.id }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    const ok = await tasks.submitCompletion(fixture.childActor, {
      occurrenceId: occurrence.id,
      evidenceText: 'I read two chapters.',
    });
    expect(ok.created).toBe(true);
    expect(await prisma.taskEvidence.count({ where: { completionId: ok.completion.id } })).toBe(1);
  });
});

describe('approval (BR-11, BR-12, §47)', () => {
  it('awards XP and points exactly once, and writes the ledger rows', async () => {
    const { completion } = await readyCompletion({ xpValue: 10, rewardPointsValue: 5 });

    const celebration = await approvals.approveTaskCompletion(fixture.parentActor, {
      completionId: completion.id,
    });

    expect(celebration.awards.xp).toBe(10);
    expect(celebration.awards.points).toBe(5);
    expect(celebration.title).toBe('MISSION COMPLETE!');

    // Exactly one ledger row for the task itself.
    const taskXp = await prisma.xpTransaction.findMany({
      where: { childId: fixture.childId, sourceType: 'TASK_COMPLETION' },
    });
    expect(taskXp).toHaveLength(1);
    expect(taskXp[0]!.amount).toBe(10);

    const taskPoints = await prisma.rewardPointsTransaction.findMany({
      where: { childId: fixture.childId, sourceType: 'TASK_COMPLETION' },
    });
    expect(taskPoints).toHaveLength(1);
    expect(taskPoints[0]!.amount).toBe(5);

    // The balance also carries the First Mission achievement's own 10 XP.
    const balances = await ledger.getBalances(prisma, fixture.childId);
    expect(balances.lifetimeXp).toBe(20);
    expect(balances.rewardPoints).toBe(5);
  });

  it('awards a character star when the task builds a trait', async () => {
    const { completion } = await readyCompletion({
      traitKey: 'perseverance',
      characterStarValue: 1,
    });

    await approvals.approveTaskCompletion(fixture.parentActor, { completionId: completion.id });

    const stars = await prisma.characterStarTransaction.findMany({ where: { childId: fixture.childId } });
    expect(stars).toHaveLength(1);
    expect(stars[0]!.amount).toBe(1);
  });

  it('does not duplicate points when approved twice (BR-12)', async () => {
    const { completion } = await readyCompletion({ xpValue: 10, rewardPointsValue: 5 });

    const first = await approvals.approveTaskCompletion(fixture.parentActor, {
      completionId: completion.id,
    });
    const second = await approvals.approveTaskCompletion(fixture.parentActor, {
      completionId: completion.id,
    });

    expect(second.awards).toEqual(first.awards);
    const balances = await ledger.getBalances(prisma, fixture.childId);
    expect(balances.lifetimeXp).toBe(20); // 10 task + 10 First Mission
    expect(balances.rewardPoints).toBe(5);
    expect(
      await prisma.xpTransaction.count({ where: { sourceType: 'TASK_COMPLETION' } }),
    ).toBe(1);
  });

  it('survives two parents approving at the same moment', async () => {
    const { completion } = await readyCompletion({ xpValue: 10, rewardPointsValue: 5 });

    const results = await Promise.allSettled([
      approvals.approveTaskCompletion(fixture.parentActor, { completionId: completion.id }),
      approvals.approveTaskCompletion(fixture.parentActor, { completionId: completion.id }),
    ]);

    // Whether one loses the race or both return, exactly one payout exists.
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(
      await prisma.xpTransaction.count({
        where: { childId: fixture.childId, sourceType: 'TASK_COMPLETION' },
      }),
    ).toBe(1);
    expect(
      await prisma.rewardPointsTransaction.count({
        where: { childId: fixture.childId, sourceType: 'TASK_COMPLETION' },
      }),
    ).toBe(1);
  });

  it('records who approved and their encouragement', async () => {
    const { completion } = await readyCompletion();

    const celebration = await approvals.approveTaskCompletion(fixture.parentActor, {
      completionId: completion.id,
      encouragementMessage: 'Proud of your effort.',
    });

    expect(celebration.encouragement).toBe('Proud of your effort.');
    expect(celebration.parentName).toBe('Mom');
  });

  it('writes an audit entry with before and after values (BR-59)', async () => {
    const { completion } = await readyCompletion();
    await approvals.approveTaskCompletion(fixture.parentActor, { completionId: completion.id });

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'COMPLETION_APPROVED', entityId: completion.id },
    });
    expect(entry.actorType).toBe('PARENT');
    expect(entry.actorUserId).toBe(fixture.parentUserId);
    expect(entry.beforeValue).toMatchObject({ status: 'PENDING' });
    expect(entry.afterValue).toMatchObject({ status: 'APPROVED', xp: 10, points: 5 });
  });

  it('advances the streak and celebrates its milestones', async () => {
    const { completion } = await readyCompletion();
    const celebration = await approvals.approveTaskCompletion(fixture.parentActor, {
      completionId: completion.id,
    });
    expect(celebration.streakDays).toBe(1);

    const streak = await prisma.streak.findFirstOrThrow({ where: { childId: fixture.childId } });
    expect(streak.currentCount).toBe(1);
    expect(streak.kind).toBe('ALL_DAILY_TASKS');
  });

  it('unlocks the First Mission achievement and pays its XP', async () => {
    const { completion } = await readyCompletion({ xpValue: 10 });
    const celebration = await approvals.approveTaskCompletion(fixture.parentActor, {
      completionId: completion.id,
    });

    expect(celebration.achievements.map((a) => a.key)).toContain('first-mission');
    // 10 from the task + 10 from the achievement.
    expect((await ledger.getBalances(prisma, fixture.childId)).lifetimeXp).toBe(20);
  });

  it('notifies the child with the exact awards', async () => {
    const { completion } = await readyCompletion({ xpValue: 10, rewardPointsValue: 5 });
    await approvals.approveTaskCompletion(fixture.parentActor, { completionId: completion.id });

    const notification = await prisma.notification.findFirstOrThrow({
      where: { recipientChildId: fixture.childId, kind: 'TASK_APPROVED' },
    });
    expect(notification.body).toContain('+10 XP');
    expect(notification.body).toContain('+5 points');
  });
});

describe('authorization (BR-11, BR-56, BR-58)', () => {
  it('a child cannot approve their own task', async () => {
    const { completion } = await readyCompletion();

    await expect(
      approvals.approveTaskCompletion(fixture.childActor, { completionId: completion.id }),
    ).rejects.toBeInstanceOf(AppError);

    expect(await prisma.xpTransaction.count()).toBe(0);
  });

  it('a parent cannot approve another family\'s task, and gets a 404 not a 403', async () => {
    const other = await createFamilyFixture();
    const task = await createTaskFixture(other, [other.childId]);
    const occurrence = await createOccurrence(other, task.id, other.childId, TODAY);
    const { completion } = await tasks.submitCompletion(other.childActor, {
      occurrenceId: occurrence.id,
    });

    await expect(
      approvals.approveTaskCompletion(fixture.parentActor, { completionId: completion.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

    expect(await prisma.xpTransaction.count()).toBe(0);
  });

  it('a child cannot smuggle a point value through the approval payload (BR-13)', async () => {
    const { completion } = await readyCompletion({ xpValue: 10, rewardPointsValue: 5 });

    await approvals.approveTaskCompletion(fixture.parentActor, {
      completionId: completion.id,
      // Extra keys are stripped by the schema — there is no amount field at all.
      ...({ xpValue: 9999, rewardPointsValue: 9999, amount: 9999 } as object),
    });

    const taskXp = await prisma.xpTransaction.findFirstOrThrow({
      where: { sourceType: 'TASK_COMPLETION' },
    });
    expect(taskXp.amount).toBe(10); // the Task row's value, not the payload's
    const balances = await ledger.getBalances(prisma, fixture.childId);
    expect(balances.rewardPoints).toBe(5);
  });
});

describe('rejection and redo (BR-13, BR-14)', () => {
  it('awards nothing and reopens the mission', async () => {
    const { completion, occurrence } = await readyCompletion();

    await approvals.rejectTaskCompletion(fixture.parentActor, {
      completionId: completion.id,
      decision: 'REQUEST_REDO',
    });

    expect(await prisma.xpTransaction.count()).toBe(0);
    expect(await prisma.rewardPointsTransaction.count()).toBe(0);

    const refreshedOccurrence = await prisma.taskOccurrence.findUniqueOrThrow({
      where: { id: occurrence.id },
    });
    expect(refreshedOccurrence.status).toBe('OPEN');

    const refreshedCompletion = await prisma.taskCompletion.findUniqueOrThrow({
      where: { id: completion.id },
    });
    expect(refreshedCompletion.status).toBe('REJECTED');
  });

  it('lets the child try again after a redo', async () => {
    const { completion, occurrence } = await readyCompletion();
    await approvals.rejectTaskCompletion(fixture.parentActor, {
      completionId: completion.id,
      decision: 'REQUEST_REDO',
    });

    const retry = await tasks.submitCompletion(fixture.childActor, { occurrenceId: occurrence.id });
    expect(retry.created).toBe(true);

    await approvals.approveTaskCompletion(fixture.parentActor, {
      completionId: retry.completion.id,
    });
    const taskXp = await prisma.xpTransaction.findMany({
      where: { sourceType: 'TASK_COMPLETION' },
    });
    expect(taskXp).toHaveLength(1);
    expect(taskXp[0]!.amount).toBe(10);
  });

  it('uses invitation language, naming the parent who asked (BR-61)', async () => {
    const { completion } = await readyCompletion();
    await approvals.rejectTaskCompletion(fixture.parentActor, {
      completionId: completion.id,
      decision: 'REQUEST_REDO',
    });

    const notification = await prisma.notification.findFirstOrThrow({
      where: { recipientChildId: fixture.childId, kind: 'TASK_REJECTED' },
    });
    expect(notification.body).toBe('Almost there. Mom asked you to try this one again.');
    expect(notification.body.toLowerCase()).not.toContain('failed');
  });

  it('a question keeps the claim pending so nothing is lost', async () => {
    const { completion } = await readyCompletion();
    await approvals.rejectTaskCompletion(fixture.parentActor, {
      completionId: completion.id,
      decision: 'ASK_QUESTION',
      message: 'How long did you read for?',
    });

    const refreshed = await prisma.taskCompletion.findUniqueOrThrow({ where: { id: completion.id } });
    expect(refreshed.status).toBe('PENDING');
  });
});
