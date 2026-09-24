import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db/prisma';
import * as tasks from '@/features/tasks/service';
import * as approvals from '@/features/approvals/service';
import * as achievements from '@/features/achievements/service';
import { DEFAULT_LEVELS } from '@/domain/levels';
import { localDateToUtcDate } from '@/domain/dates';
import {
  createFamilyFixture,
  createOccurrence,
  createTaskFixture,
  type FamilyFixture,
} from '@/test/factories';

/** Task creation, occurrence materialisation and weekly progress (Sprint 4). */

let fixture: FamilyFixture;

beforeEach(async () => {
  fixture = await createFamilyFixture();
});

function taskInput(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Read for 20 minutes',
    iconKey: 'book',
    colorKey: 'brand',
    xpValue: 10,
    rewardPointsValue: 5,
    characterStarValue: 0,
    difficulty: 'STANDARD' as const,
    evidenceType: 'NONE' as const,
    approvalRequired: true,
    streakEligible: true,
    isFamilyTask: false,
    childIds: [fixture.childId],
    schedule: {
      frequency: 'DAILY' as const,
      interval: 1,
      weekdays: [],
      startDate: '2026-09-21',
    },
    ...overrides,
  };
}

describe('creating a task', () => {
  it('stores the schedule and assigns the chosen children', async () => {
    const task = await tasks.createTask(fixture.parentActor, taskInput());

    expect(task.title).toBe('Read for 20 minutes');
    expect(task.xpValue).toBe(10);
    expect(task.schedule?.frequency).toBe('DAILY');
    expect(task.assignments).toHaveLength(1);
    expect(task.assignments[0]!.childId).toBe(fixture.childId);
  });

  it('assigns a family task to every listed child', async () => {
    const task = await tasks.createTask(
      fixture.parentActor,
      taskInput({
        title: 'Clean up after dinner',
        isFamilyTask: true,
        childIds: [fixture.childId, fixture.secondChildId],
      }),
    );

    expect(task.assignments).toHaveLength(2);
  });

  it('refuses a task worth nothing (BR-8)', async () => {
    await expect(
      tasks.createTask(
        fixture.parentActor,
        taskInput({ xpValue: 0, rewardPointsValue: 0, characterStarValue: 0 }),
      ),
    ).rejects.toThrow();
  });

  it('refuses a star-bearing task with no trait', async () => {
    await expect(
      tasks.createTask(fixture.parentActor, taskInput({ characterStarValue: 1 })),
    ).rejects.toThrow();
  });

  it('refuses a trait from another family', async () => {
    const other = await createFamilyFixture();
    const otherTrait = await prisma.characterTrait.findFirstOrThrow({
      where: { familyId: other.familyId },
    });

    await expect(
      tasks.createTask(
        fixture.parentActor,
        taskInput({ characterTraitId: otherTrait.id, characterStarValue: 1 }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a child cannot create a task', async () => {
    await expect(tasks.createTask(fixture.childActor, taskInput())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await prisma.task.count()).toBe(0);
  });

  it('writes an audit entry', async () => {
    const task = await tasks.createTask(fixture.parentActor, taskInput());
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'TASK_CREATED', entityId: task.id },
    });
    expect(entry.afterValue).toMatchObject({ title: 'Read for 20 minutes', xpValue: 10 });
  });
});

describe('editing a task', () => {
  it('changes what it is called and what it is worth', async () => {
    const task = await tasks.createTask(fixture.parentActor, taskInput());

    await tasks.updateTask(fixture.parentActor, {
      ...taskInput({ title: 'Read for 30 minutes', xpValue: 25, rewardPointsValue: 12 }),
      taskId: task.id,
      active: true,
    });

    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.title).toBe('Read for 30 minutes');
    expect(after.xpValue).toBe(25);
    expect(after.rewardPointsValue).toBe(12);
  });

  it('changes the schedule in place rather than leaving two', async () => {
    const task = await tasks.createTask(fixture.parentActor, taskInput());

    await tasks.updateTask(fixture.parentActor, {
      ...taskInput({
        schedule: {
          frequency: 'WEEKLY' as const,
          interval: 1,
          weekdays: [1],
          startDate: '2026-09-21',
        },
      }),
      taskId: task.id,
      active: true,
    });

    const schedules = await prisma.taskSchedule.findMany({ where: { taskId: task.id } });
    expect(schedules).toHaveLength(1);
    expect(schedules[0]?.frequency).toBe('WEEKLY');
  });

  it('takes back an untouched card when a child is unassigned', async () => {
    const task = await tasks.createTask(
      fixture.parentActor,
      taskInput({ childIds: [fixture.childId, fixture.secondChildId] }),
    );
    await tasks.ensureOccurrences(prisma, {
      childId: fixture.secondChildId,
      familyId: fixture.familyId,
      date: '2026-09-21' as never,
    });
    expect(
      await prisma.taskOccurrence.count({
        where: { taskId: task.id, childId: fixture.secondChildId },
      }),
    ).toBe(1);

    await tasks.updateTask(fixture.parentActor, {
      ...taskInput({ childIds: [fixture.childId] }),
      taskId: task.id,
      active: true,
    });

    expect(
      await prisma.taskOccurrence.count({
        where: { taskId: task.id, childId: fixture.secondChildId },
      }),
    ).toBe(0);
    expect(
      await prisma.taskAssignment.count({
        where: { taskId: task.id, childId: fixture.secondChildId },
      }),
    ).toBe(0);
  });

  it('still refuses a mission worth nothing (BR-8)', async () => {
    const task = await tasks.createTask(fixture.parentActor, taskInput());

    await expect(
      tasks.updateTask(fixture.parentActor, {
        ...taskInput({ xpValue: 0, rewardPointsValue: 0, characterStarValue: 0 }),
        taskId: task.id,
        active: true,
      }),
    ).rejects.toThrow();
  });

  it("a parent cannot edit another family's mission", async () => {
    const task = await tasks.createTask(fixture.parentActor, taskInput());
    const stranger = await createFamilyFixture();

    await expect(
      tasks.updateTask(stranger.parentActor, {
        ...taskInput({ childIds: [stranger.childId] }),
        taskId: task.id,
        active: true,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('retiring a task', () => {
  it('hides it and clears what was outstanding, keeping the history', async () => {
    const task = await tasks.createTask(fixture.parentActor, taskInput());
    await tasks.ensureOccurrences(prisma, {
      childId: fixture.childId,
      familyId: fixture.familyId,
      date: '2026-09-21' as never,
    });

    await tasks.deleteTask(fixture.parentActor, { taskId: task.id });

    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.deletedAt).not.toBeNull();
    expect(after.active).toBe(false);
    expect(await prisma.taskOccurrence.count({ where: { taskId: task.id, status: 'OPEN' } })).toBe(
      0,
    );
  });

  it('a child cannot retire a mission', async () => {
    const task = await tasks.createTask(fixture.parentActor, taskInput());

    await expect(tasks.deleteTask(fixture.childActor, { taskId: task.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('occurrence materialisation (BR-23)', () => {
  it('creates one occurrence per due day, and only once', async () => {
    await tasks.createTask(fixture.parentActor, taskInput());

    for (let i = 0; i < 3; i += 1) {
      await tasks.ensureOccurrences(prisma, {
        childId: fixture.childId,
        familyId: fixture.familyId,
        date: '2026-09-22',
      });
    }

    expect(await prisma.taskOccurrence.count({ where: { childId: fixture.childId } })).toBe(1);
  });

  it('creates nothing for a day the schedule does not cover', async () => {
    await tasks.createTask(
      fixture.parentActor,
      taskInput({
        schedule: { frequency: 'WEEKENDS', interval: 1, weekdays: [], startDate: '2026-09-21' },
      }),
    );

    // 2026-09-22 is a Tuesday.
    await tasks.ensureOccurrences(prisma, {
      childId: fixture.childId,
      familyId: fixture.familyId,
      date: '2026-09-22',
    });
    expect(await prisma.taskOccurrence.count()).toBe(0);

    // 2026-09-26 is a Saturday.
    await tasks.ensureOccurrences(prisma, {
      childId: fixture.childId,
      familyId: fixture.familyId,
      date: '2026-09-26',
    });
    expect(await prisma.taskOccurrence.count()).toBe(1);
  });

  it('creates nothing before the start date (BR-21)', async () => {
    await tasks.createTask(
      fixture.parentActor,
      taskInput({
        schedule: { frequency: 'DAILY', interval: 1, weekdays: [], startDate: '2026-10-01' },
      }),
    );

    await tasks.ensureOccurrences(prisma, {
      childId: fixture.childId,
      familyId: fixture.familyId,
      date: '2026-09-22',
    });
    expect(await prisma.taskOccurrence.count()).toBe(0);
  });

  it('stops creating occurrences once a task is deactivated (BR-24)', async () => {
    const task = await tasks.createTask(fixture.parentActor, taskInput());
    await prisma.task.update({ where: { id: task.id }, data: { active: false } });

    await tasks.ensureOccurrences(prisma, {
      childId: fixture.childId,
      familyId: fixture.familyId,
      date: '2026-09-22',
    });
    expect(await prisma.taskOccurrence.count()).toBe(0);
  });

  it('shows the child their missions for the day', async () => {
    await tasks.createTask(fixture.parentActor, taskInput());
    const missions = await tasks.getMissionsForDate(fixture.childActor, {
      childId: fixture.childId,
      date: '2026-09-22',
    });

    expect(missions).toHaveLength(1);
    expect(missions[0]).toMatchObject({ title: 'Read for 20 minutes', state: 'OPEN', xpValue: 10 });
  });

  it("will not show one child another child's missions (BR-57)", async () => {
    await expect(
      tasks.getMissionsForDate(fixture.childActor, {
        childId: fixture.secondChildId,
        date: '2026-09-22',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('weekly progress (Sprint 4)', () => {
  /** Approves `count` occurrences across the week beginning 2026-09-21. */
  async function completeDays(count: number, taskId: string) {
    for (let i = 0; i < count; i += 1) {
      const date = `2026-09-${21 + i}`;
      const occurrence = await createOccurrence(fixture, taskId, fixture.childId, date);
      const { completion } = await tasks.submitCompletion(fixture.childActor, {
        occurrenceId: occurrence.id,
      });
      await approvals.approveTaskCompletion(fixture.parentActor, { completionId: completion.id });
    }
  }

  it('counts only approved occurrences from this week', async () => {
    const task = await createTaskFixture(fixture, [fixture.childId]);
    await completeDays(2, task.id);
    // An open one today, and an approved one from last week.
    await createOccurrence(fixture, task.id, fixture.childId, '2026-09-23');
    await prisma.taskOccurrence.create({
      data: {
        taskId: task.id,
        childId: fixture.childId,
        familyId: fixture.familyId,
        occurrenceDate: localDateToUtcDate('2026-09-14'),
        status: 'APPROVED',
      },
    });

    const progress = await tasks.getWeeklyProgress(fixture.childActor, {
      childId: fixture.childId,
      today: '2026-09-23',
      target: 25,
    });

    expect(progress.completed).toBe(2);
    expect(progress.scheduled).toBe(3);
  });

  it('never sets a target the child cannot reach', async () => {
    const task = await createTaskFixture(fixture, [fixture.childId]);
    await createOccurrence(fixture, task.id, fixture.childId, '2026-09-22');

    const progress = await tasks.getWeeklyProgress(fixture.childActor, {
      childId: fixture.childId,
      today: '2026-09-23',
      target: 25,
    });

    expect(progress.target).toBe(1);
    expect(progress.remaining).toBe(1);
  });

  it('counts XP earned this week but not points spent', async () => {
    const task = await createTaskFixture(fixture, [fixture.childId], {
      xpValue: 10,
      rewardPointsValue: 20,
    });
    await completeDays(1, task.id);

    await prisma.rewardPointsTransaction.create({
      data: {
        childId: fixture.childId,
        familyId: fixture.familyId,
        amount: -15,
        sourceType: 'REWARD_REDEMPTION',
        idempotencyKey: 'points:spend-this-week',
        description: 'Spent on a reward',
      },
    });

    const progress = await tasks.getWeeklyProgress(fixture.childActor, {
      childId: fixture.childId,
      today: '2026-09-23',
      target: 25,
    });

    // Spending is not a loss of what was earned.
    expect(progress.pointsThisWeek).toBe(20);
  });
});

describe('perfect weeks feed achievements (Sprint 4)', () => {
  it('counts a finished week where everything was approved', async () => {
    const task = await createTaskFixture(fixture, [fixture.childId]);

    // A week that has ended: 7–13 September 2026.
    for (const date of ['2026-09-07', '2026-09-08', '2026-09-09']) {
      const occurrence = await createOccurrence(fixture, task.id, fixture.childId, date);
      const { completion } = await tasks.submitCompletion(fixture.childActor, {
        occurrenceId: occurrence.id,
      });
      await approvals.approveTaskCompletion(fixture.parentActor, { completionId: completion.id });
    }

    const snapshot = await achievements.buildSnapshot(
      prisma,
      fixture.childId,
      DEFAULT_LEVELS,
      'UTC',
      '2026-09-21',
    );

    expect(snapshot.perfectWeeks).toBe(1);
    expect(snapshot.approvedTaskCount).toBe(3);
  });

  it('will not count a week that is still running', async () => {
    const task = await createTaskFixture(fixture, [fixture.childId]);
    const occurrence = await createOccurrence(fixture, task.id, fixture.childId, '2026-09-21');
    const { completion } = await tasks.submitCompletion(fixture.childActor, {
      occurrenceId: occurrence.id,
    });
    await approvals.approveTaskCompletion(fixture.parentActor, { completionId: completion.id });

    // Judged mid-week: everything so far is approved, but the week is not over.
    const midWeek = await achievements.buildSnapshot(
      prisma,
      fixture.childId,
      DEFAULT_LEVELS,
      'UTC',
      '2026-09-23',
    );
    expect(midWeek.perfectWeeks).toBe(0);

    // Judged after it ended, the same data counts.
    const afterwards = await achievements.buildSnapshot(
      prisma,
      fixture.childId,
      DEFAULT_LEVELS,
      'UTC',
      '2026-09-28',
    );
    expect(afterwards.perfectWeeks).toBe(1);
  });

  it('does not count a week with an unapproved occurrence', async () => {
    const task = await createTaskFixture(fixture, [fixture.childId]);
    const occurrence = await createOccurrence(fixture, task.id, fixture.childId, '2026-09-21');
    await tasks.submitCompletion(fixture.childActor, { occurrenceId: occurrence.id });
    await createOccurrence(fixture, task.id, fixture.childId, '2026-09-22');
    // Submitted is not approved, so the week cannot be perfect.

    const snapshot = await achievements.buildSnapshot(
      prisma,
      fixture.childId,
      DEFAULT_LEVELS,
      'UTC',
      '2026-09-28',
    );
    expect(snapshot.perfectWeeks).toBe(0);
  });

  it('unlocks the Perfect Week achievement once the week qualifies', async () => {
    const task = await createTaskFixture(fixture, [fixture.childId]);
    const unlockedKeys: string[] = [];

    // A week already in the past, so the evaluation inside the approval
    // transaction (which uses the real clock) sees it as finished.
    for (const date of ['2026-09-07', '2026-09-08']) {
      const occurrence = await createOccurrence(fixture, task.id, fixture.childId, date);
      const { completion } = await tasks.submitCompletion(fixture.childActor, {
        occurrenceId: occurrence.id,
      });
      const celebration = await approvals.approveTaskCompletion(fixture.parentActor, {
        completionId: completion.id,
      });
      unlockedKeys.push(...celebration.achievements.map((a) => a.key));
    }

    expect(unlockedKeys).toContain('perfect-week');
    // And only once, however many approvals land in the same week.
    expect(unlockedKeys.filter((key) => key === 'perfect-week')).toHaveLength(1);
    expect(
      await prisma.achievementUnlock.count({
        where: { childId: fixture.childId, achievement: { key: 'perfect-week' } },
      }),
    ).toBe(1);
  });
});
