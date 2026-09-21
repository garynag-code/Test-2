import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db/prisma';
import * as memory from '@/features/memory/service';
import * as ledger from '@/features/ledger/service';
import { createFamilyFixture, type FamilyFixture } from '@/test/factories';

/** Memory challenges (brief §15, BR-49/BR-50). */

let fixture: FamilyFixture;

beforeEach(async () => {
  fixture = await createFamilyFixture();
});

async function createChallenge(overrides: { xpValue?: number; rewardPointsValue?: number } = {}) {
  return memory.createChallenge(fixture.parentActor, {
    title: 'Philippians 4:13',
    category: 'BIBLE_VERSE',
    reference: 'Philippians 4:13',
    bodyText: 'I can do all things through Christ who strengthens me.',
    xpValue: overrides.xpValue ?? 10,
    rewardPointsValue: overrides.rewardPointsValue ?? 5,
    verificationType: 'TYPED',
    childIds: [fixture.childId],
  });
}

describe('challenges are family-authored, whatever the family values', () => {
  it('accepts a verse, a quote, a family saying or a school fact alike', async () => {
    for (const category of ['BIBLE_VERSE', 'QUOTE', 'FAMILY_SAYING', 'SCHOOL_FACT'] as const) {
      const challenge = await memory.createChallenge(fixture.parentActor, {
        title: `A ${category}`,
        category,
        bodyText: 'Something worth remembering.',
        xpValue: 5,
        rewardPointsValue: 0,
        verificationType: 'TYPED',
        childIds: [fixture.childId],
      });
      expect(challenge.category).toBe(category);
    }
  });

  it("only assigns children in the parent's own family", async () => {
    const other = await createFamilyFixture();
    await expect(
      memory.createChallenge(fixture.parentActor, {
        title: 'Nope',
        category: 'CUSTOM',
        bodyText: 'Text',
        xpValue: 5,
        rewardPointsValue: 0,
        verificationType: 'TYPED',
        childIds: [other.childId],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('recitation (BR-50)', () => {
  it('stores what the child typed and awards nothing yet', async () => {
    const challenge = await createChallenge();
    const submission = await memory.recite(fixture.childActor, {
      challengeId: challenge.id,
      recitedText: 'I can do all things through Christ who strengthens me.',
    });

    expect(submission.status).toBe('PENDING');
    expect(submission.recitedText).toContain('I can do all things');
    expect(await ledger.getXpBalance(prisma, fixture.childId)).toBe(0);
  });

  it('refuses a challenge the child is not assigned', async () => {
    const challenge = await createChallenge();
    await expect(
      memory.recite(fixture.secondChildActor, { challengeId: challenge.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('approval awards once, ever (BR-49)', () => {
  it('awards the challenge XP and points on approval', async () => {
    const challenge = await createChallenge({ xpValue: 10, rewardPointsValue: 5 });
    const submission = await memory.recite(fixture.childActor, { challengeId: challenge.id });

    await memory.approve(fixture.parentActor, { submissionId: submission.id });

    const xp = await prisma.xpTransaction.findMany({ where: { sourceType: 'MEMORY_SUBMISSION' } });
    expect(xp).toHaveLength(1);
    expect(xp[0]!.amount).toBe(10);
    expect(await ledger.getPointsBalance(prisma, fixture.childId)).toBe(5);
  });

  it('does not pay twice when approved twice', async () => {
    const challenge = await createChallenge();
    const submission = await memory.recite(fixture.childActor, { challengeId: challenge.id });

    await memory.approve(fixture.parentActor, { submissionId: submission.id });
    await memory.approve(fixture.parentActor, { submissionId: submission.id });

    expect(await prisma.xpTransaction.count({ where: { sourceType: 'MEMORY_SUBMISSION' } })).toBe(
      1,
    );
  });

  it('refuses a second recitation of a mastered challenge', async () => {
    const challenge = await createChallenge();
    const submission = await memory.recite(fixture.childActor, { challengeId: challenge.id });
    await memory.approve(fixture.parentActor, { submissionId: submission.id });

    await expect(
      memory.recite(fixture.childActor, { challengeId: challenge.id }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(await prisma.xpTransaction.count({ where: { sourceType: 'MEMORY_SUBMISSION' } })).toBe(
      1,
    );
  });

  it('pays each child separately for the same challenge', async () => {
    const challenge = await memory.createChallenge(fixture.parentActor, {
      title: 'Family saying',
      category: 'FAMILY_SAYING',
      bodyText: 'We finish what we start.',
      xpValue: 10,
      rewardPointsValue: 0,
      verificationType: 'TYPED',
      childIds: [fixture.childId, fixture.secondChildId],
    });

    for (const actor of [fixture.childActor, fixture.secondChildActor]) {
      const submission = await memory.recite(actor, { challengeId: challenge.id });
      await memory.approve(fixture.parentActor, { submissionId: submission.id });
    }

    expect(await ledger.getXpBalance(prisma, fixture.childId)).toBe(10);
    expect(await ledger.getXpBalance(prisma, fixture.secondChildId)).toBe(10);
  });

  it('a child cannot approve their own recitation', async () => {
    const challenge = await createChallenge();
    const submission = await memory.recite(fixture.childActor, { challengeId: challenge.id });

    await expect(
      memory.approve(fixture.childActor, { submissionId: submission.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await prisma.xpTransaction.count()).toBe(0);
  });
});
