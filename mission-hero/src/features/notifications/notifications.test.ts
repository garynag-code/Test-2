import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db/prisma';
import * as notifications from '@/features/notifications/service';
import * as tasks from '@/features/tasks/service';
import * as approvals from '@/features/approvals/service';
import {
  createFamilyFixture,
  createOccurrence,
  createTaskFixture,
  type FamilyFixture,
} from '@/test/factories';

/** The in-app inbox for both roles (brief §41, Sprint 4). */

let fixture: FamilyFixture;

beforeEach(async () => {
  fixture = await createFamilyFixture();
});

describe('routing', () => {
  it('reaches every active parent in the family', async () => {
    const secondParent = await prisma.user.create({
      data: { email: `second-${Date.now()}@example.com`, passwordHash: 'x', displayName: 'Dad' },
    });
    await prisma.familyMember.create({
      data: { familyId: fixture.familyId, userId: secondParent.id, role: 'PARENT' },
    });

    await notifications.notifyParents(prisma, {
      familyId: fixture.familyId,
      kind: 'TASK_SUBMITTED',
      title: 'Josh completed Reading',
      body: 'Tap to approve.',
    });

    expect(await notifications.unreadCountForParent(prisma, fixture.parentUserId)).toBe(1);
    expect(await notifications.unreadCountForParent(prisma, secondParent.id)).toBe(1);
  });

  it('does not reach a removed parent', async () => {
    const removed = await prisma.user.create({
      data: { email: `removed-${Date.now()}@example.com`, passwordHash: 'x', displayName: 'Ex' },
    });
    await prisma.familyMember.create({
      data: { familyId: fixture.familyId, userId: removed.id, role: 'PARENT', status: 'REMOVED' },
    });

    await notifications.notifyParents(prisma, {
      familyId: fixture.familyId,
      kind: 'TASK_SUBMITTED',
      title: 'Something happened',
      body: 'Body',
    });

    expect(await notifications.unreadCountForParent(prisma, removed.id)).toBe(0);
  });

  it('does not reach another family', async () => {
    const other = await createFamilyFixture();

    await notifications.notifyParents(prisma, {
      familyId: fixture.familyId,
      kind: 'TASK_SUBMITTED',
      title: 'Ours only',
      body: 'Body',
    });

    expect(await notifications.unreadCountForParent(prisma, other.parentUserId)).toBe(0);
  });

  it("keeps siblings' inboxes separate", async () => {
    await notifications.notifyChild(prisma, {
      familyId: fixture.familyId,
      childId: fixture.childId,
      kind: 'TASK_APPROVED',
      title: 'Reading approved!',
      body: '+10 XP',
    });

    expect(await notifications.unreadCountForChild(prisma, fixture.childId)).toBe(1);
    expect(await notifications.unreadCountForChild(prisma, fixture.secondChildId)).toBe(0);
  });
});

describe('marking read', () => {
  beforeEach(async () => {
    await notifications.notifyChild(prisma, {
      familyId: fixture.familyId,
      childId: fixture.childId,
      kind: 'TASK_APPROVED',
      title: 'One',
      body: 'Body',
    });
    await notifications.notifyChild(prisma, {
      familyId: fixture.familyId,
      childId: fixture.secondChildId,
      kind: 'TASK_APPROVED',
      title: 'Two',
      body: 'Body',
    });
  });

  it("clears only the recipient's own inbox", async () => {
    await notifications.markAllReadForChild(prisma, fixture.childId);

    expect(await notifications.unreadCountForChild(prisma, fixture.childId)).toBe(0);
    // A sibling's inbox is untouched.
    expect(await notifications.unreadCountForChild(prisma, fixture.secondChildId)).toBe(1);
  });

  it('is safe to call twice', async () => {
    await notifications.markAllReadForChild(prisma, fixture.childId);
    await notifications.markAllReadForChild(prisma, fixture.childId);
    expect(await notifications.unreadCountForChild(prisma, fixture.childId)).toBe(0);
  });

  it('leaves the notification itself readable after marking', async () => {
    await notifications.markAllReadForChild(prisma, fixture.childId);
    const items = await notifications.listForChild(prisma, fixture.childId);
    expect(items).toHaveLength(1);
    expect(items[0]!.readAt).not.toBeNull();
  });
});

describe('the daily loop produces the right notifications', () => {
  it('tells parents on submission and the child on approval', async () => {
    const task = await createTaskFixture(fixture, [fixture.childId], {
      xpValue: 10,
      rewardPointsValue: 5,
    });
    const occurrence = await createOccurrence(fixture, task.id, fixture.childId, '2026-09-21');

    const { completion } = await tasks.submitCompletion(fixture.childActor, {
      occurrenceId: occurrence.id,
    });

    const parentInbox = await notifications.listForParent(prisma, fixture.parentUserId);
    expect(parentInbox[0]).toMatchObject({
      kind: 'TASK_SUBMITTED',
      deepLink: '/parent/approvals',
    });
    // Nothing has reached the child yet — there is nothing to celebrate.
    expect(await notifications.unreadCountForChild(prisma, fixture.childId)).toBe(0);

    await approvals.approveTaskCompletion(fixture.parentActor, { completionId: completion.id });

    const childInbox = await notifications.listForChild(prisma, fixture.childId);
    expect(childInbox[0]).toMatchObject({ kind: 'TASK_APPROVED' });
    expect(childInbox[0]!.body).toContain('+10 XP');
  });

  it('newest first, so the inbox reads the way people expect', async () => {
    for (const title of ['First', 'Second', 'Third']) {
      await notifications.notifyChild(prisma, {
        familyId: fixture.familyId,
        childId: fixture.childId,
        kind: 'ENCOURAGEMENT',
        title,
        body: 'Body',
      });
    }

    const items = await notifications.listForChild(prisma, fixture.childId);
    expect(items.map((item) => item.title)).toEqual(['Third', 'Second', 'First']);
  });
});
