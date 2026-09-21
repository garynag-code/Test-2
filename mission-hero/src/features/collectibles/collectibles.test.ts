import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db/prisma';
import * as collectibles from '@/features/collectibles/service';
import * as ledger from '@/features/ledger/service';
import * as tasks from '@/features/tasks/service';
import * as approvals from '@/features/approvals/service';
import {
  createFamilyFixture,
  createOccurrence,
  createTaskFixture,
  traitId,
  type FamilyFixture,
} from '@/test/factories';

/** Digital collectibles and avatar items (brief §20/§21, Sprint 6). */

let fixture: FamilyFixture;

beforeEach(async () => {
  fixture = await createFamilyFixture();
});

async function evaluate() {
  return collectibles.evaluateForChild(prisma, {
    childId: fixture.childId,
    familyId: fixture.familyId,
  });
}

describe('unlocking', () => {
  it('grants the starter items straight away', async () => {
    const unlocked = await evaluate();
    const keys = unlocked.map((item) => item.key);

    expect(keys).toContain('pet-pup');
    expect(keys).toContain('hat-cap');
  });

  it('never grants the same item twice', async () => {
    await evaluate();
    const second = await evaluate();

    expect(second).toEqual([]);
    expect(await prisma.childCollectible.count({ where: { childId: fixture.childId } })).toBe(1);
  });

  it('holds under concurrent evaluation', async () => {
    await Promise.allSettled([evaluate(), evaluate(), evaluate()]);
    expect(await prisma.childCollectible.count({ where: { childId: fixture.childId } })).toBe(1);
  });

  it('unlocks on reaching a level', async () => {
    // 300 lifetime XP is level 3, which unlocks the penguin.
    await ledger.awardXp(prisma, {
      familyId: fixture.familyId,
      childId: fixture.childId,
      amount: 320,
      sourceType: 'MANUAL_ADJUSTMENT',
      idempotencyKey: 'xp:level-test',
      reason: 'Test',
      description: 'Test',
    });

    const keys = (await evaluate()).map((item) => item.key);
    expect(keys).toContain('pet-penguin');
    expect(keys).toContain('glasses-cool');
    // Level 6 and 9 items are still locked.
    expect(keys).not.toContain('pet-dragon');
    expect(keys).not.toContain('pet-phoenix');
  });

  it('does not unlock anything from spendable points (brief §20)', async () => {
    await prisma.rewardPointsTransaction.create({
      data: {
        childId: fixture.childId,
        familyId: fixture.familyId,
        amount: 10_000,
        sourceType: 'MANUAL_ADJUSTMENT',
        idempotencyKey: 'points:rich',
        reason: 'Test',
        description: 'Test',
      },
    });

    const keys = (await evaluate()).map((item) => item.key);
    // Only the always-on starters; money buys nothing here.
    expect(keys.sort()).toEqual(['hat-cap', 'pet-pup']);
  });

  it('keeps an unlock even after the points are spent', async () => {
    await ledger.awardXp(prisma, {
      familyId: fixture.familyId,
      childId: fixture.childId,
      amount: 320,
      sourceType: 'MANUAL_ADJUSTMENT',
      idempotencyKey: 'xp:keep',
      reason: 'Test',
      description: 'Test',
    });
    await evaluate();

    const owned = await prisma.childCollectible.count({ where: { childId: fixture.childId } });
    await evaluate();
    expect(await prisma.childCollectible.count({ where: { childId: fixture.childId } })).toBe(
      owned,
    );
  });

  it('tells the child what they unlocked', async () => {
    await evaluate();
    const notification = await prisma.notification.findFirstOrThrow({
      where: { recipientChildId: fixture.childId, kind: 'BADGE_UNLOCKED' },
    });
    expect(notification.body).toContain('Scout the Pup');
  });

  it('keeps children separate', async () => {
    await evaluate();
    expect(await prisma.childCollectible.count({ where: { childId: fixture.secondChildId } })).toBe(
      0,
    );
  });

  it('lands in the same transaction as the award that earned it', async () => {
    const task = await createTaskFixture(fixture, [fixture.childId], { xpValue: 10 });
    const occurrence = await createOccurrence(fixture, task.id, fixture.childId, '2026-09-21');
    const { completion } = await tasks.submitCompletion(fixture.childActor, {
      occurrenceId: occurrence.id,
    });

    const celebration = await approvals.approveTaskCompletion(fixture.parentActor, {
      completionId: completion.id,
    });

    expect(celebration.unlocks.map((item) => item.key)).toContain('pet-pup');
    expect(await prisma.childCollectible.count({ where: { childId: fixture.childId } })).toBe(1);
  });
});

describe('the collection as a child sees it', () => {
  it('shows locked items with what would unlock them, not a scolding', async () => {
    const collection = await collectibles.getCollection(fixture.childActor, fixture.childId);

    const dragon = collection.collectibles.find((item) => item.key === 'pet-dragon');
    expect(dragon?.owned).toBe(false);
    expect(dragon?.requirement).toBe('Reach level 6');

    for (const item of [...collection.collectibles, ...collection.avatarItems]) {
      expect(item.requirement.toLowerCase()).not.toMatch(/fail|not enough|behind/);
    }
  });

  it("refuses to show another child's collection (BR-57)", async () => {
    await expect(
      collectibles.getCollection(fixture.childActor, fixture.secondChildId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('equipping avatar items', () => {
  async function ownedHatIds() {
    await evaluate();
    const items = await prisma.childAvatarItem.findMany({
      where: { childId: fixture.childId },
      include: { item: true },
    });
    return items;
  }

  it('equips an owned item', async () => {
    const [hat] = await ownedHatIds();
    const result = await collectibles.equipItem(fixture.childActor, hat!.avatarItemId);

    expect(result.equipped).toBe(true);
    const refreshed = await prisma.childAvatarItem.findUniqueOrThrow({ where: { id: hat!.id } });
    expect(refreshed.equipped).toBe(true);
  });

  it('tapping the same item again takes it off', async () => {
    const [hat] = await ownedHatIds();
    await collectibles.equipItem(fixture.childActor, hat!.avatarItemId);
    const result = await collectibles.equipItem(fixture.childActor, hat!.avatarItemId);

    expect(result.equipped).toBe(false);
    expect(
      await prisma.childAvatarItem.count({ where: { childId: fixture.childId, equipped: true } }),
    ).toBe(0);
  });

  it('only one item per slot can be worn at once', async () => {
    // Both crowns: one needs level 7, the other 15 kindness stars.
    await ledger.awardXp(prisma, {
      familyId: fixture.familyId,
      childId: fixture.childId,
      amount: 5000,
      sourceType: 'MANUAL_ADJUSTMENT',
      idempotencyKey: 'xp:both-crowns',
      reason: 'Test',
      description: 'Test',
    });
    await ledger.awardStars(prisma, {
      familyId: fixture.familyId,
      childId: fixture.childId,
      traitId: await traitId(fixture.familyId, 'kindness'),
      amount: 15,
      sourceType: 'MANUAL_ADJUSTMENT',
      idempotencyKey: 'star:both-crowns',
      reason: 'Test',
      description: 'Test',
    });
    await evaluate();

    const crowns = await prisma.childAvatarItem.findMany({
      where: { childId: fixture.childId, slot: 'CROWN' },
    });
    expect(crowns.length).toBeGreaterThan(1);

    for (const crown of crowns) {
      await collectibles.equipItem(fixture.childActor, crown.avatarItemId);
    }

    // The partial unique index makes more than one impossible, not merely unlikely.
    const equipped = await prisma.childAvatarItem.findMany({
      where: { childId: fixture.childId, slot: 'CROWN', equipped: true },
    });
    expect(equipped).toHaveLength(1);
    expect(equipped[0]!.avatarItemId).toBe(crowns[crowns.length - 1]!.avatarItemId);
  });

  it('refuses an item the child has not unlocked', async () => {
    const locked = await prisma.avatarItem.findFirstOrThrow({
      where: { familyId: fixture.familyId, key: 'crown-gold' },
    });

    await expect(collectibles.equipItem(fixture.childActor, locked.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it("refuses another family's item", async () => {
    const other = await createFamilyFixture();
    const item = await prisma.avatarItem.findFirstOrThrow({
      where: { familyId: other.familyId, key: 'hat-cap' },
    });

    await expect(collectibles.equipItem(fixture.childActor, item.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it("a parent cannot dress a child's avatar", async () => {
    const [hat] = await ownedHatIds();
    await expect(
      collectibles.equipItem(fixture.parentActor, hat!.avatarItemId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
