import { prisma } from '@/server/db/prisma';
import { notFound } from '@/server/errors';
import type { Actor } from '@/server/auth/actor';
import { type LocalDate, addDays, startOfWeek, utcDateToLocalDate } from '@/domain/dates';
import { countPerfectWeeks, summariseWeeks, type OccurrenceSummary } from '@/domain/progress';
import { badgeProgress } from '@/domain/badges';
import * as ledger from '@/features/ledger/service';

/**
 * Parent-facing history and progress (brief §28, Sprint 7).
 *
 * Read-only and family-scoped. Nothing here can move value; it exists so a
 * parent can answer "how has this month actually gone?" without guessing.
 */

export interface ChildProgress {
  childId: string;
  nickname: string;
  avatarKey: string;
  lifetimeXp: number;
  rewardPoints: number;
  characterStars: number;
  approvedThisWeek: number;
  scheduledThisWeek: number;
  missedThisWeek: number;
  perfectWeeks: number;
  longestStreak: number;
  currentStreak: number;
  traits: Array<{
    label: string;
    emoji: string;
    total: number;
    nextTier: string | null;
    remaining: number;
  }>;
  recentWeeks: Array<{ weekStart: LocalDate; approved: number; total: number; perfect: boolean }>;
}

export async function getChildProgress(
  actor: Actor,
  params: { childId: string; today: LocalDate },
): Promise<ChildProgress> {
  if (actor.type !== 'parent') throw notFound();

  const child = await prisma.childProfile.findFirst({
    where: { id: params.childId, familyId: actor.familyId, deletedAt: null },
    select: { id: true, nickname: true, avatarKey: true },
  });
  if (!child) throw notFound();

  // Twelve weeks is enough to see a pattern without loading a child's whole life.
  const from = addDays(startOfWeek(params.today), -7 * 11);

  const [balances, occurrenceRows, traits, starTotals, streaks] = await Promise.all([
    ledger.getBalances(prisma, child.id),
    prisma.taskOccurrence.findMany({
      where: { childId: child.id },
      select: { occurrenceDate: true, status: true },
    }),
    prisma.characterTrait.findMany({
      where: { familyId: actor.familyId, active: true },
      orderBy: { sortOrder: 'asc' },
    }),
    ledger.getStarsByTrait(prisma, child.id),
    prisma.streak.findMany({ where: { childId: child.id } }),
  ]);

  const occurrences: OccurrenceSummary[] = occurrenceRows.map((row) => ({
    date: utcDateToLocalDate(row.occurrenceDate),
    status: row.status,
  }));

  const weeks = summariseWeeks(occurrences, params.today);
  const thisWeekStart = startOfWeek(params.today);
  const thisWeek = weeks.find((week) => week.weekStart === thisWeekStart);
  const totalByTrait = new Map(starTotals.map((row) => [row.traitId, row.total]));

  return {
    childId: child.id,
    nickname: child.nickname,
    avatarKey: child.avatarKey,
    lifetimeXp: balances.lifetimeXp,
    rewardPoints: balances.rewardPoints,
    characterStars: balances.characterStars,
    approvedThisWeek: thisWeek?.approved ?? 0,
    scheduledThisWeek: thisWeek?.total ?? 0,
    missedThisWeek: occurrences.filter(
      (row) => startOfWeek(row.date) === thisWeekStart && row.status === 'MISSED',
    ).length,
    perfectWeeks: countPerfectWeeks(occurrences, params.today),
    longestStreak: Math.max(0, ...streaks.map((row) => row.longestCount)),
    currentStreak: Math.max(0, ...streaks.map((row) => row.currentCount)),
    traits: traits.map((trait) => {
      const total = totalByTrait.get(trait.id) ?? 0;
      const progress = badgeProgress(total);
      return {
        label: trait.label,
        emoji: trait.emoji,
        total,
        nextTier: progress.nextTier,
        remaining: progress.remaining,
      };
    }),
    recentWeeks: weeks
      .filter((week) => week.weekStart >= from)
      .map((week) => ({
        weekStart: week.weekStart,
        approved: week.approved,
        total: week.total,
        perfect: week.perfect,
      })),
  };
}

/** Every confirmed character moment, newest first — the story of the month. */
export async function getCharacterHistory(actor: Actor, childId: string, take = 40) {
  if (actor.type !== 'parent') throw notFound();

  return prisma.characterSubmission.findMany({
    where: { childId, familyId: actor.familyId, status: 'APPROVED' },
    orderBy: { submittedAt: 'desc' },
    take,
    include: {
      trait: { select: { label: true, emoji: true } },
      approval: { select: { encouragementMessage: true, decidedAt: true } },
    },
  });
}

export async function getTaskHistory(actor: Actor, childId: string, take = 40) {
  if (actor.type !== 'parent') throw notFound();

  return prisma.taskCompletion.findMany({
    where: { childId, familyId: actor.familyId, status: { in: ['APPROVED', 'REJECTED'] } },
    orderBy: { submittedAt: 'desc' },
    take,
    include: {
      task: { select: { title: true, iconKey: true } },
      approvals: { orderBy: { decidedAt: 'desc' }, take: 1 },
    },
  });
}

/** Every award and debit, so a disputed balance can be reconstructed. */
export async function getLedgerHistory(actor: Actor, childId: string, take = 50) {
  if (actor.type !== 'parent') throw notFound();

  const child = await prisma.childProfile.findFirst({
    where: { id: childId, familyId: actor.familyId },
    select: { id: true },
  });
  if (!child) throw notFound();

  const [xp, points, stars] = await Promise.all([
    prisma.xpTransaction.findMany({
      where: { childId },
      orderBy: { createdAt: 'desc' },
      take,
    }),
    prisma.rewardPointsTransaction.findMany({
      where: { childId },
      orderBy: { createdAt: 'desc' },
      take,
    }),
    prisma.characterStarTransaction.findMany({
      where: { childId },
      orderBy: { createdAt: 'desc' },
      take,
      include: { trait: { select: { label: true } } },
    }),
  ]);

  return [
    ...xp.map((row) => ({ ...row, ledger: 'XP' as const, traitLabel: null })),
    ...points.map((row) => ({ ...row, ledger: 'POINTS' as const, traitLabel: null })),
    ...stars.map((row) => ({ ...row, ledger: 'STARS' as const, traitLabel: row.trait.label })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, take);
}
