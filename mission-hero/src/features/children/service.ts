import { prisma } from '@/server/db/prisma';
import { notFound, validation } from '@/server/errors';
import { assertSelfChild } from '@/server/auth/guards';
import { hashPin, verifyPin } from '@/server/auth/passwords';
import type { Actor } from '@/server/auth/actor';
import { PIN_LOCKOUT_MINUTES, PIN_MAX_ATTEMPTS } from '@/domain/constants';
import { type LocalDate } from '@/domain/dates';
import { resolveLevel, type LevelDefinition } from '@/domain/levels';
import * as ledger from '@/features/ledger/service';
import * as streaks from '@/features/streaks/service';
import * as audit from '@/features/audit/service';

export interface CreateChildInput {
  nickname: string;
  ageBracket: 'AGE_6_8' | 'AGE_9_11' | 'AGE_12_14';
  avatarKey?: string;
  themeKey?: string;
  pin?: string;
  birthMonth?: number | null;
  birthYear?: number | null;
}

export async function createChild(actor: Actor, input: CreateChildInput) {
  if (actor.type !== 'parent') throw notFound();

  const nickname = input.nickname.trim();
  if (!nickname) throw validation('Give your hero a name.');

  const pinHash = input.pin ? await hashPin(input.pin) : null;

  return prisma.$transaction(async (tx) => {
    const count = await tx.childProfile.count({ where: { familyId: actor.familyId } });

    const child = await tx.childProfile.create({
      data: {
        familyId: actor.familyId,
        nickname,
        ageBracket: input.ageBracket,
        avatarKey: input.avatarKey ?? 'hero-1',
        themeKey: input.themeKey ?? 'space',
        pinHash,
        pinRequired: Boolean(pinHash),
        // Privacy (brief §40): month and year at most, both optional.
        birthMonth: input.birthMonth ?? null,
        birthYear: input.birthYear ?? null,
        sortOrder: count,
        setting: { create: { pinRequired: Boolean(pinHash) } },
      },
    });

    await audit.record(tx, {
      actor,
      action: 'CHILD_CREATED',
      entityType: 'ChildProfile',
      entityId: child.id,
      after: { nickname: child.nickname, ageBracket: child.ageBracket },
    });

    return child;
  });
}

export async function listChildren(actor: Actor) {
  return prisma.childProfile.findMany({
    where: { familyId: actor.familyId, deletedAt: null, status: { not: 'ARCHIVED' } },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}

/**
 * The profile picker on a bound device.
 *
 * Returns nicknames and avatars only — never a PIN hash, never a birth date.
 * The device cookie confers no authority, so this is the most exposed read in
 * the product and its DTO is deliberately tiny (docs/03 §5).
 */
export async function listProfilesForDevice(familyId: string) {
  const children = await prisma.childProfile.findMany({
    where: { familyId, deletedAt: null, status: 'ACTIVE' },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, nickname: true, avatarKey: true, themeKey: true, pinRequired: true },
  });
  return children;
}

export interface PinVerification {
  ok: boolean;
  childId?: string;
  familyId?: string;
  lockedUntil?: Date;
  attemptsRemaining?: number;
}

/**
 * PIN verification with a row-level lockout that survives clearing cookies
 * (docs/03 §5). A wrong profile id and a wrong PIN take the same path.
 */
export async function verifyChildPin(
  familyId: string,
  childId: string,
  pin: string,
): Promise<PinVerification> {
  const child = await prisma.childProfile.findFirst({
    where: { id: childId, familyId, deletedAt: null, status: 'ACTIVE' },
    select: {
      id: true,
      pinHash: true,
      pinRequired: true,
      pinFailedAttempts: true,
      pinLockedUntil: true,
    },
  });

  if (!child) {
    await verifyPin(pin, null);
    return { ok: false };
  }

  if (child.pinLockedUntil && child.pinLockedUntil > new Date()) {
    return { ok: false, lockedUntil: child.pinLockedUntil };
  }

  if (!child.pinRequired) return { ok: true, childId: child.id, familyId };

  const matched = await verifyPin(pin, child.pinHash);

  if (matched) {
    await prisma.childProfile.update({
      where: { id: child.id },
      data: { pinFailedAttempts: 0, pinLockedUntil: null },
    });
    return { ok: true, childId: child.id, familyId };
  }

  const attempts = child.pinFailedAttempts + 1;
  const locked = attempts >= PIN_MAX_ATTEMPTS;
  const lockedUntil = locked ? new Date(Date.now() + PIN_LOCKOUT_MINUTES * 60_000) : null;

  await prisma.childProfile.update({
    where: { id: child.id },
    data: { pinFailedAttempts: locked ? 0 : attempts, pinLockedUntil: lockedUntil },
  });

  return {
    ok: false,
    ...(lockedUntil ? { lockedUntil } : {}),
    attemptsRemaining: Math.max(0, PIN_MAX_ATTEMPTS - attempts),
  };
}

export interface ChildSummary {
  id: string;
  nickname: string;
  avatarKey: string;
  themeKey: string;
  lifetimeXp: number;
  rewardPoints: number;
  characterStars: number;
  levelNumber: number;
  levelName: string;
  levelProgress: number;
  xpToNextLevel: number;
  streakDays: number;
}

export async function getSummary(
  actor: Actor,
  params: { childId: string; today: LocalDate },
): Promise<ChildSummary> {
  assertSelfChild(params.childId, actor);

  const child = await prisma.childProfile.findFirst({
    where: { id: params.childId, familyId: actor.familyId, deletedAt: null },
    select: { id: true, nickname: true, avatarKey: true, themeKey: true, familyId: true },
  });
  if (!child) throw notFound();

  const [balances, levelRows, streakDays] = await Promise.all([
    ledger.getBalances(prisma, child.id),
    prisma.level.findMany({
      where: { familyId: child.familyId },
      orderBy: { minLifetimeXp: 'asc' },
    }),
    streaks.currentCount(prisma, {
      childId: child.id,
      kind: 'ALL_DAILY_TASKS',
      today: params.today,
    }),
  ]);

  const levels: LevelDefinition[] = levelRows.map((row) => ({
    levelNumber: row.levelNumber,
    name: row.name,
    minLifetimeXp: row.minLifetimeXp,
    iconKey: row.iconKey,
  }));
  const progress = resolveLevel(balances.lifetimeXp, levels.length > 0 ? levels : undefined);

  return {
    id: child.id,
    nickname: child.nickname,
    avatarKey: child.avatarKey,
    themeKey: child.themeKey,
    lifetimeXp: balances.lifetimeXp,
    rewardPoints: balances.rewardPoints,
    characterStars: balances.characterStars,
    levelNumber: progress.level.levelNumber,
    levelName: progress.level.name,
    levelProgress: progress.progress,
    xpToNextLevel: progress.xpToNext,
    streakDays,
  };
}
