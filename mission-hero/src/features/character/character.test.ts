import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db/prisma';
import * as character from '@/features/character/service';
import * as ledger from '@/features/ledger/service';
import { createFamilyFixture, traitId, type FamilyFixture } from '@/test/factories';

/**
 * Vertical Slice 2 (brief §48) and the character rows of the §46 critical list.
 */

const TODAY = '2026-09-21';

let fixture: FamilyFixture;
let kindnessId: string;

beforeEach(async () => {
  fixture = await createFamilyFixture();
  kindnessId = await traitId(fixture.familyId, 'kindness');
});

async function submit(story = 'I helped Sarah clean her room.') {
  return character.submitCharacterMoment(fixture.childActor, {
    traitId: kindnessId,
    story,
    localDate: TODAY,
  });
}

describe('submission (BR-28)', () => {
  it('awards nothing at all before a parent confirms', async () => {
    await submit();

    expect(await prisma.characterStarTransaction.count()).toBe(0);
    expect(await prisma.xpTransaction.count()).toBe(0);
    expect((await ledger.getBalances(prisma, fixture.childId)).characterStars).toBe(0);
  });

  it('stores the story for the parent to read and notifies them', async () => {
    const submission = await submit('I helped my little brother pack away his toys.');
    expect(submission.status).toBe('PENDING');
    expect(submission.story).toBe('I helped my little brother pack away his toys.');

    const notification = await prisma.notification.findFirstOrThrow({
      where: { kind: 'CHARACTER_SUBMITTED' },
    });
    expect(notification.title).toBe('Josh says they showed kindness today.');
  });

  it('refuses a trait from another family', async () => {
    const other = await createFamilyFixture();
    const otherTraitId = await traitId(other.familyId, 'kindness');

    await expect(
      character.submitCharacterMoment(fixture.childActor, {
        traitId: otherTraitId,
        story: 'Something kind',
        localDate: TODAY,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('caps the day gently rather than scolding (BR-32)', async () => {
    for (let i = 0; i < 5; i += 1) await submit(`Moment number ${i + 1}`);

    await expect(submit('One more')).rejects.toMatchObject({ code: 'VALIDATION' });
    const error = await submit('One more').catch((e: Error) => e);
    expect(String(error)).not.toMatch(/failed|too many|stop/i);
  });

  it('allows several distinct moments in one day (BR-32)', async () => {
    await submit('First moment');
    await submit('Second moment');
    expect(await prisma.characterSubmission.count({ where: { childId: fixture.childId } })).toBe(2);
  });
});

describe('confirmation (BR-29, §48)', () => {
  it('awards exactly one star for that trait', async () => {
    const submission = await submit();

    const celebration = await character.confirmCharacterMoment(fixture.parentActor, {
      submissionId: submission.id,
    });

    expect(celebration.starsAwarded).toBe(1);
    expect(celebration.newTotal).toBe(1);
    expect(celebration.headline).toBe('Kindness Power +1!');

    const stars = await prisma.characterStarTransaction.findMany({
      where: { childId: fixture.childId },
    });
    expect(stars).toHaveLength(1);
    expect(stars[0]!.amount).toBe(1);
    expect(stars[0]!.traitId).toBe(kindnessId);
  });

  it('awards the family\'s configured XP alongside the star, as a separate row (BR-31)', async () => {
    const submission = await submit();
    await character.confirmCharacterMoment(fixture.parentActor, { submissionId: submission.id });

    const xp = await prisma.xpTransaction.findMany({
      where: { childId: fixture.childId, sourceType: 'CHARACTER_APPROVAL' },
    });
    expect(xp).toHaveLength(1);
    expect(xp[0]!.amount).toBe(5); // FamilySetting.characterXpPerStar default
  });

  it('does not award twice when confirmed twice (BR-30)', async () => {
    const submission = await submit();

    const first = await character.confirmCharacterMoment(fixture.parentActor, {
      submissionId: submission.id,
    });
    const second = await character.confirmCharacterMoment(fixture.parentActor, {
      submissionId: submission.id,
    });

    expect(second.newTotal).toBe(first.newTotal);
    expect(await prisma.characterStarTransaction.count()).toBe(1);
    expect(await prisma.characterApproval.count()).toBe(1);
  });

  it('survives two parents confirming simultaneously', async () => {
    const submission = await submit();

    await Promise.allSettled([
      character.confirmCharacterMoment(fixture.parentActor, { submissionId: submission.id }),
      character.confirmCharacterMoment(fixture.parentActor, { submissionId: submission.id }),
    ]);

    expect(await prisma.characterStarTransaction.count()).toBe(1);
  });

  it('records the parent\'s encouragement and name', async () => {
    const submission = await submit();
    const celebration = await character.confirmCharacterMoment(fixture.parentActor, {
      submissionId: submission.id,
      encouragementMessage: 'Well done for helping.',
    });

    expect(celebration.encouragement).toBe('Well done for helping.');
    expect(celebration.parentName).toBe('Mom');
  });

  it('advances the character streak', async () => {
    const submission = await submit();
    await character.confirmCharacterMoment(fixture.parentActor, { submissionId: submission.id });

    const streak = await prisma.streak.findFirstOrThrow({
      where: { childId: fixture.childId, kind: 'CHARACTER' },
    });
    expect(streak.currentCount).toBe(1);
  });

  it('writes an audit entry', async () => {
    const submission = await submit();
    await character.confirmCharacterMoment(fixture.parentActor, { submissionId: submission.id });

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'CHARACTER_APPROVED', entityId: submission.id },
    });
    expect(entry.afterValue).toMatchObject({ status: 'APPROVED', stars: 1 });
  });

  it('a child cannot confirm their own moment', async () => {
    const submission = await submit();

    await expect(
      character.confirmCharacterMoment(fixture.childActor, { submissionId: submission.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(await prisma.characterStarTransaction.count()).toBe(0);
  });

  it('a parent cannot confirm another family\'s moment', async () => {
    const other = await createFamilyFixture();
    const otherTrait = await traitId(other.familyId, 'kindness');
    const submission = await character.submitCharacterMoment(other.childActor, {
      traitId: otherTrait,
      story: 'Kind thing',
      localDate: TODAY,
    });

    await expect(
      character.confirmCharacterMoment(fixture.parentActor, { submissionId: submission.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('badges (BR-35)', () => {
  async function confirmTimes(count: number) {
    for (let i = 0; i < count; i += 1) {
      // Spread across days so the per-day cap is not the thing under test.
      const submission = await character.submitCharacterMoment(fixture.childActor, {
        traitId: kindnessId,
        story: `Kind moment ${i + 1}`,
        localDate: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
      });
      await character.confirmCharacterMoment(fixture.parentActor, { submissionId: submission.id });
    }
  }

  it('unlocks Bronze at five confirmed moments', async () => {
    await confirmTimes(4);
    let unlocked = await prisma.characterBadgeProgress.count({
      where: { childId: fixture.childId, unlockedAt: { not: null } },
    });
    expect(unlocked).toBe(0);

    await confirmTimes(1);
    unlocked = await prisma.characterBadgeProgress.count({
      where: { childId: fixture.childId, unlockedAt: { not: null } },
    });
    expect(unlocked).toBe(1);

    const badge = await prisma.characterBadgeProgress.findFirstOrThrow({
      where: { childId: fixture.childId, unlockedAt: { not: null } },
      include: { badge: true },
    });
    expect(badge.badge.name).toBe('Kindness Hero');
    expect(badge.badge.tier).toBe('BRONZE');
  });

  it('reports the badge unlock on the celebration payload', async () => {
    await confirmTimes(4);
    const submission = await character.submitCharacterMoment(fixture.childActor, {
      traitId: kindnessId,
      story: 'The fifth kind moment',
      localDate: '2026-10-01',
    });
    const celebration = await character.confirmCharacterMoment(fixture.parentActor, {
      submissionId: submission.id,
    });

    expect(celebration.badgesUnlocked).toEqual([{ name: 'Kindness Hero', tier: 'BRONZE' }]);
  });

  it('never unlocks the same badge twice', async () => {
    await confirmTimes(7);
    const unlocks = await prisma.characterBadgeProgress.findMany({
      where: { childId: fixture.childId, unlockedAt: { not: null } },
    });
    expect(unlocks).toHaveLength(1);
  });
});

describe('declining (BR-28, tone)', () => {
  it('awards nothing and invites a conversation', async () => {
    const submission = await submit();

    await character.declineCharacterMoment(fixture.parentActor, {
      submissionId: submission.id,
      decision: 'ASK_QUESTION',
      message: 'Tell me more about that?',
    });

    expect(await prisma.characterStarTransaction.count()).toBe(0);

    const refreshed = await prisma.characterSubmission.findUniqueOrThrow({
      where: { id: submission.id },
    });
    expect(refreshed.status).toBe('QUESTION_ASKED');

    const notification = await prisma.notification.findFirstOrThrow({
      where: { recipientChildId: fixture.childId, kind: 'ENCOURAGEMENT' },
    });
    expect(notification.body).toBe('Tell me more about that?');
  });
});

describe('character profile (BR-34)', () => {
  it('frames an empty trait as growth, never as a deficiency', async () => {
    const profile = await character.getCharacterProfile(fixture.childActor, fixture.childId);
    const kindness = profile.find((t) => t.key === 'kindness');

    expect(kindness?.total).toBe(0);
    expect(kindness?.message).toBe("Let's grow this one.");
    expect(profile.every((t) => !/bad|weak|poor|low/i.test(t.message))).toBe(true);
  });

  it('counts confirmed moments and points at the next badge', async () => {
    const submission = await submit();
    await character.confirmCharacterMoment(fixture.parentActor, { submissionId: submission.id });

    const profile = await character.getCharacterProfile(fixture.childActor, fixture.childId);
    const kindness = profile.find((t) => t.key === 'kindness');
    expect(kindness?.total).toBe(1);
    expect(kindness?.nextTier).toBe('BRONZE');
    expect(kindness?.remaining).toBe(4);
    expect(kindness?.message).toBe('4 more kindness moments to your next badge.');
  });

  it('refuses to show another child\'s profile (BR-57)', async () => {
    await expect(
      character.getCharacterProfile(fixture.childActor, fixture.secondChildId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
