import { requireChild } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { toLocalDate } from '@/domain/dates';
import { EmptyState } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { EMPTY_STATES } from '@/domain/copy';
import { formatNumber } from '@/lib/utils';
import { childLogoutAction } from '@/features/auth/actions';
import * as childrenService from '@/features/children/service';
import * as characterService from '@/features/character/service';
import * as collectiblesService from '@/features/collectibles/service';
import { Collection } from '@/components/kid/collection';
import { badgeProgress } from '@/domain/badges';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My character' };

/** The character profile (brief §8). Growth framing, never a report card. */
export default async function MePage() {
  const actor = await requireChild();
  const family = await prisma.family.findUniqueOrThrow({
    where: { id: actor.familyId },
    select: { timezone: true },
  });
  const today = toLocalDate(new Date(), family.timezone);

  const [summary, traits, badges, collection, equipped, achievements] = await Promise.all([
    childrenService.getSummary(actor, { childId: actor.childId, today }),
    characterService.getCharacterProfile(actor, actor.childId),
    prisma.characterBadgeProgress.findMany({
      where: { childId: actor.childId, unlockedAt: { not: null } },
      include: { badge: { select: { name: true, tier: true } } },
      orderBy: { unlockedAt: 'desc' },
    }),
    collectiblesService.getCollection(actor, actor.childId),
    collectiblesService.getEquipped(actor.childId),
    prisma.achievement.findMany({
      where: { familyId: actor.familyId, active: true },
      include: { unlocks: { where: { childId: actor.childId }, select: { unlockedAt: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const maxTotal = Math.max(1, ...traits.map((trait) => trait.total));

  return (
    <div className="pb-24">
      <header className="mh-gradient px-5 pb-8 pt-8 text-white">
        <div className="mx-auto max-w-md">
          <h1 className="text-3xl font-black">{summary.nickname}</h1>
          <p className="mt-1 font-bold text-white/90">
            Level {summary.levelNumber} {summary.levelName}
          </p>
          <p className="mt-3 text-sm font-bold text-white/90">
            <span aria-hidden>⚡</span> {formatNumber(summary.lifetimeXp)} XP ·{' '}
            <span aria-hidden>❤️</span> {formatNumber(summary.characterStars)} stars
          </p>
          {equipped.length > 0 ? (
            <p className="mt-3 flex items-center gap-2 text-3xl" aria-label="What you're wearing">
              {equipped.map((row) => (
                <span key={row.id} title={row.item.name}>
                  {row.item.iconKey}
                </span>
              ))}
            </p>
          ) : null}
        </div>
      </header>

      <div className="mx-auto max-w-md space-y-6 px-5 py-6">
        <section aria-labelledby="my-character" className="space-y-3">
          <h2 id="my-character" className="text-sm font-bold uppercase tracking-wide text-muted">
            My character
          </h2>
          <ul className="space-y-3">
            {traits.map((trait) => (
              <li key={trait.traitId} className="rounded-xl2 border-2 border-border bg-card p-4">
                <div className="flex items-baseline justify-between">
                  <p className="font-extrabold text-ink">
                    <span aria-hidden>{trait.emoji}</span> {trait.label}
                  </p>
                  <p className="text-lg font-black tabular-nums text-star">{trait.total}</p>
                </div>
                <div className="mt-2">
                  <Progress label={`${trait.label} moments`} value={trait.total} max={maxTotal} />
                </div>
                <p className="mt-2 text-sm text-muted">{trait.message}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="my-badges" className="space-y-3">
          <h2 id="my-badges" className="text-sm font-bold uppercase tracking-wide text-muted">
            Badges
          </h2>
          {badges.length === 0 ? (
            <EmptyState icon="🏅" title={EMPTY_STATES.noBadgesYet} hint={nextBadgeHint(traits)} />
          ) : (
            <ul className="flex flex-wrap gap-2">
              {badges.map((row) => (
                <li
                  key={row.id}
                  className="rounded-full border-2 border-border bg-card px-4 py-2 text-sm font-bold text-ink"
                >
                  <span aria-hidden>🏅</span> {row.badge.name} ({titleCase(row.badge.tier)})
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="my-achievements" className="space-y-3">
          <h2 id="my-achievements" className="text-sm font-bold uppercase tracking-wide text-muted">
            Achievements
          </h2>
          <ul className="space-y-2">
            {achievements.map((achievement) => {
              const unlockedAt = achievement.unlocks[0]?.unlockedAt ?? null;
              return (
                <li
                  key={achievement.id}
                  className={
                    unlockedAt
                      ? 'rounded-xl2 border-2 border-success/40 bg-success/5 p-3'
                      : 'rounded-xl2 border-2 border-dashed border-border p-3'
                  }
                >
                  <p className="font-extrabold text-ink">
                    <span aria-hidden>{unlockedAt ? '🏆' : '🔒'}</span> {achievement.name}
                  </p>
                  <p className="text-sm text-muted">{achievement.description}</p>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="my-stuff" className="space-y-3">
          <h2 id="my-stuff" className="text-sm font-bold uppercase tracking-wide text-muted">
            My Collection
          </h2>
          <Collection collectibles={collection.collectibles} avatarItems={collection.avatarItems} />
        </section>

        <form action={childLogoutAction}>
          <button
            type="submit"
            className="mh-tap w-full rounded-full border-2 border-border bg-card font-bold text-muted"
          >
            Switch hero
          </button>
        </form>
      </div>
    </div>
  );
}

function nextBadgeHint(traits: Array<{ total: number; label: string }>): string {
  const best = [...traits].sort((a, b) => b.total - a.total)[0];
  if (!best || best.total === 0) return 'Confirmed character moments unlock badges.';
  const progress = badgeProgress(best.total);
  return progress.nextTier
    ? `${progress.remaining} more ${best.label.toLowerCase()} moments to your first badge.`
    : 'Your badges will appear here.';
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
