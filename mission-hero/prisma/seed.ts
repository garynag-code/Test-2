/**
 * Seed: the Adventure Family (brief §45).
 *
 * Idempotent — running it twice leaves one family, so `npm run db:seed` is safe
 * during development. Everything here goes through the same schema the app
 * uses; there is no privileged back door.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { seedFamilyDefaults } from '../src/features/families/defaults';
import { localDateToUtcDate, toLocalDate, addDays } from '../src/domain/dates';

const prisma = new PrismaClient();

const FAMILY_CODE = 'ADVENTUR';
const TIMEZONE = 'Africa/Johannesburg';

async function main(): Promise<void> {
  const existing = await prisma.family.findUnique({ where: { familyCode: FAMILY_CODE } });
  if (existing) {
    console.log('Removing the previous Adventure Family so the seed is repeatable…');
    await prisma.family.delete({ where: { id: existing.id } });
  }
  await prisma.user.deleteMany({
    where: { email: { in: ['mom@adventure.family', 'dad@adventure.family'] } },
  });

  const family = await prisma.family.create({
    data: { name: 'The Adventure Family', timezone: TIMEZONE, familyCode: FAMILY_CODE },
  });
  await seedFamilyDefaults(prisma, family.id);

  // --- parents -------------------------------------------------------------
  const passwordHash = await bcrypt.hash('MissionHero123!', 12);

  const mom = await prisma.user.create({
    data: { email: 'mom@adventure.family', passwordHash, displayName: 'Sam Adventure' },
  });
  const dad = await prisma.user.create({
    data: { email: 'dad@adventure.family', passwordHash, displayName: 'Chris Adventure' },
  });

  for (const [user, role, nickname] of [
    [mom, 'OWNER', 'Mom'],
    [dad, 'PARENT', 'Dad'],
  ] as const) {
    await prisma.familyMember.create({
      data: { familyId: family.id, userId: user.id, role, joinedAt: new Date() },
    });
    await prisma.parentProfile.create({
      data: { familyId: family.id, userId: user.id, displayName: nickname },
    });
  }

  // --- children ------------------------------------------------------------
  const josh = await prisma.childProfile.create({
    data: {
      familyId: family.id,
      nickname: 'Josh',
      ageBracket: 'AGE_9_11',
      birthYear: 2016,
      birthMonth: 4,
      avatarKey: 'hero-1',
      themeKey: 'space',
      sortOrder: 0,
      setting: { create: { dailyTaskTarget: 5 } },
    },
  });
  const sarah = await prisma.childProfile.create({
    data: {
      familyId: family.id,
      nickname: 'Sarah',
      ageBracket: 'AGE_6_8',
      birthYear: 2019,
      birthMonth: 9,
      avatarKey: 'hero-4',
      themeKey: 'jungle',
      sortOrder: 1,
      setting: { create: { dailyTaskTarget: 3 } },
    },
  });

  const categories = await prisma.taskCategory.findMany({ where: { familyId: family.id } });
  const categoryId = (key: string) => categories.find((c) => c.key === key)?.id ?? null;

  const traits = await prisma.characterTrait.findMany({ where: { familyId: family.id } });
  const traitId = (key: string) => traits.find((t) => t.key === key)?.id ?? null;

  // --- tasks ---------------------------------------------------------------
  const startDate = localDateToUtcDate(addDays(toLocalDate(new Date(), TIMEZONE), -14));

  const taskDefs = [
    {
      title: 'Make your bed',
      icon: 'bed',
      xp: 5,
      points: 2,
      category: 'morning',
      children: [josh.id, sarah.id],
    },
    {
      title: 'Brush your teeth',
      icon: 'sparkles',
      xp: 5,
      points: 0,
      category: 'health',
      children: [josh.id, sarah.id],
    },
    {
      title: 'Read for 20 minutes',
      icon: 'book',
      xp: 10,
      points: 5,
      category: 'learning',
      children: [josh.id, sarah.id],
      evidence: 'NOTE' as const,
    },
    {
      title: 'Finish homework',
      icon: 'pencil',
      xp: 20,
      points: 10,
      category: 'learning',
      children: [josh.id],
    },
    {
      title: 'Pack your school bag',
      icon: 'backpack',
      xp: 5,
      points: 2,
      category: 'evening',
      children: [josh.id, sarah.id],
    },
    {
      title: 'Help with the dishes',
      icon: 'utensils',
      xp: 10,
      points: 5,
      category: 'helping',
      children: [josh.id],
      trait: 'helpfulness',
      stars: 1,
    },
    {
      title: 'Clean your bedroom',
      icon: 'broom',
      xp: 15,
      points: 8,
      category: 'helping',
      children: [josh.id, sarah.id],
    },
    {
      title: 'Learn your memory verse',
      icon: 'scroll',
      xp: 10,
      points: 5,
      category: 'faith-values',
      children: [josh.id, sarah.id],
    },
    {
      title: 'Practice your instrument',
      icon: 'music',
      xp: 15,
      points: 5,
      category: 'learning',
      children: [josh.id],
      trait: 'perseverance',
      stars: 1,
    },
  ];

  for (const def of taskDefs) {
    await prisma.task.create({
      data: {
        familyId: family.id,
        title: def.title,
        iconKey: def.icon,
        categoryId: categoryId(def.category),
        xpValue: def.xp,
        rewardPointsValue: def.points,
        characterTraitId: def.trait ? traitId(def.trait) : null,
        characterStarValue: def.stars ?? 0,
        evidenceType: def.evidence ?? 'NONE',
        createdByUserId: mom.id,
        schedule: { create: { frequency: 'DAILY', startDate } },
        assignments: { createMany: { data: def.children.map((childId) => ({ childId })) } },
      },
    });
  }

  // --- rewards -------------------------------------------------------------
  const rewardCategories = await prisma.rewardCategory.findMany({ where: { familyId: family.id } });
  const rewardCategoryId = (key: string) => rewardCategories.find((c) => c.key === key)?.id ?? null;

  const rewardDefs = [
    {
      name: 'Choose the movie',
      type: 'EXPERIENCE' as const,
      cost: 80,
      icon: 'film',
      category: 'experiences',
    },
    { name: 'Ice cream', type: 'FOOD' as const, cost: 60, icon: 'ice-cream', category: 'treats' },
    {
      name: '30 minutes gaming',
      type: 'SCREEN_TIME' as const,
      cost: 100,
      icon: 'gamepad',
      category: 'screen-time',
    },
    {
      name: 'R20 pocket money',
      type: 'POCKET_MONEY' as const,
      cost: 150,
      icon: 'coins',
      category: 'pocket-money',
    },
    {
      name: 'Choose dinner',
      type: 'EXPERIENCE' as const,
      cost: 90,
      icon: 'utensils',
      category: 'experiences',
    },
    {
      name: 'Stay up 30 minutes later',
      type: 'PRIVILEGE' as const,
      cost: 120,
      icon: 'moon',
      category: 'privileges',
    },
    {
      name: 'Mystery reward',
      type: 'CUSTOM' as const,
      cost: 200,
      icon: 'gift',
      category: 'experiences',
    },
  ];

  for (const def of rewardDefs) {
    await prisma.reward.create({
      data: {
        familyId: family.id,
        name: def.name,
        type: def.type,
        pointsCost: def.cost,
        iconKey: def.icon,
        categoryId: rewardCategoryId(def.category),
        requiresParentApproval: true,
      },
    });
  }

  // --- reward wheel --------------------------------------------------------
  // Weights are visible to the parent and deliberately modest: the rarest
  // segment is one in ten, not one in a thousand (brief §42).
  await prisma.rewardWheel.create({
    data: {
      familyId: family.id,
      name: 'The Adventure Wheel',
      pointThreshold: 100,
      deductPoints: true,
      pointsCost: 100,
      spinsPerDay: 1,
      spinsPerWeek: 3,
      items: {
        createMany: {
          data: [
            {
              label: 'Choose the movie',
              weight: 3,
              segmentIndex: 0,
              iconKey: 'film',
              colorKey: 'brand',
            },
            {
              label: 'Ice cream',
              weight: 3,
              segmentIndex: 1,
              iconKey: 'ice-cream',
              colorKey: 'star',
            },
            {
              label: '30 min extra gaming',
              weight: 2,
              segmentIndex: 2,
              iconKey: 'gamepad',
              colorKey: 'points',
            },
            {
              label: 'Choose dinner',
              weight: 3,
              segmentIndex: 3,
              iconKey: 'utensils',
              colorKey: 'success',
            },
            {
              label: 'Stay up later',
              weight: 2,
              segmentIndex: 4,
              iconKey: 'moon',
              colorKey: 'accent',
            },
            {
              label: 'Mystery reward',
              weight: 1,
              segmentIndex: 5,
              iconKey: 'gift',
              colorKey: 'xp',
            },
          ],
        },
      },
    },
  });

  // --- memory challenges ---------------------------------------------------
  const memoryDefs = [
    {
      title: 'I can do all things',
      category: 'BIBLE_VERSE' as const,
      reference: 'Philippians 4:13',
      body: 'I can do all things through Christ who strengthens me.',
    },
    {
      title: 'Kindness when nobody is watching',
      category: 'QUOTE' as const,
      reference: null,
      body: 'Be kind even when nobody is watching.',
    },
    {
      title: 'Our family saying',
      category: 'FAMILY_SAYING' as const,
      reference: null,
      body: 'We finish what we start.',
    },
  ];

  for (const def of memoryDefs) {
    await prisma.memoryChallenge.create({
      data: {
        familyId: family.id,
        title: def.title,
        category: def.category,
        reference: def.reference,
        bodyText: def.body,
        xpValue: 10,
        rewardPointsValue: 5,
        assignments: { createMany: { data: [{ childId: josh.id }, { childId: sarah.id }] } },
      },
    });
  }

  // --- secret missions -----------------------------------------------------
  const missionDefs = [
    {
      title: 'Secret Kindness Mission',
      instructions: 'Do something helpful without being asked.',
      rarity: 'RARE' as const,
      xp: 25,
      points: 10,
      trait: 'kindness',
      object: 'chest',
    },
    {
      title: 'Gratitude Challenge',
      instructions: 'Tell three people why you appreciate them.',
      rarity: 'COMMON' as const,
      xp: 15,
      points: 5,
      trait: 'gratitude',
      object: 'star',
    },
    {
      title: 'Encouragement Quest',
      instructions: 'Encourage one person today.',
      rarity: 'COMMON' as const,
      xp: 15,
      points: 5,
      trait: 'encouragement',
      object: 'gem',
    },
    {
      title: 'Extra Pages',
      instructions: 'Read 10 extra pages today.',
      rarity: 'COMMON' as const,
      xp: 20,
      points: 10,
      trait: null,
      object: 'scroll',
    },
    {
      title: 'Legendary Tidy-Up',
      instructions: 'Tidy one area nobody asked you to.',
      rarity: 'LEGENDARY' as const,
      xp: 40,
      points: 20,
      trait: 'responsibility',
      object: 'rocket',
    },
  ];

  for (const def of missionDefs) {
    await prisma.secretMission.create({
      data: {
        familyId: family.id,
        title: def.title,
        instructions: def.instructions,
        rarity: def.rarity,
        xpValue: def.xp,
        rewardPointsValue: def.points,
        characterTraitId: def.trait ? traitId(def.trait) : null,
        starValue: def.trait ? 1 : 0,
        hiddenObjectKey: def.object,
      },
    });
  }

  // --- a little history, so the dashboards are not empty --------------------
  // Written through the ledger's own shape, including idempotency keys.
  await prisma.rewardPointsTransaction.createMany({
    data: [
      {
        childId: josh.id,
        familyId: family.id,
        amount: 120,
        sourceType: 'MANUAL_ADJUSTMENT',
        idempotencyKey: 'points:seed:josh-welcome',
        reason: 'Welcome to Mission Hero',
        description: 'Welcome bonus',
      },
      {
        childId: sarah.id,
        familyId: family.id,
        amount: 45,
        sourceType: 'MANUAL_ADJUSTMENT',
        idempotencyKey: 'points:seed:sarah-welcome',
        reason: 'Welcome to Mission Hero',
        description: 'Welcome bonus',
      },
    ],
  });
  await prisma.xpTransaction.createMany({
    data: [
      {
        childId: josh.id,
        familyId: family.id,
        amount: 180,
        sourceType: 'MANUAL_ADJUSTMENT',
        idempotencyKey: 'xp:seed:josh-welcome',
        reason: 'Welcome to Mission Hero',
        description: 'Welcome bonus',
      },
      {
        childId: sarah.id,
        familyId: family.id,
        amount: 60,
        sourceType: 'MANUAL_ADJUSTMENT',
        idempotencyKey: 'xp:seed:sarah-welcome',
        reason: 'Welcome to Mission Hero',
        description: 'Welcome bonus',
      },
    ],
  });

  console.log(`
  Mission Hero seeded.

    Family        The Adventure Family
    Family code   ${FAMILY_CODE}      (type this on a child's device)

    Parent login  mom@adventure.family / MissionHero123!
                  dad@adventure.family / MissionHero123!

    Children      Josh (10) · Sarah (7)     no PIN set, so they can just tap their avatar
  `);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
