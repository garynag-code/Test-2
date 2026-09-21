import Link from 'next/link';
import { requireChild } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { toLocalDate } from '@/domain/dates';
import { buildAdventurePath } from '@/domain/adventure-map';
import { cn } from '@/lib/utils';
import * as tasksService from '@/features/tasks/service';
import * as childrenService from '@/features/children/service';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Adventure map' };

/**
 * The map is a second reading of the weekly quest, not a second score: it fills
 * from the same approved-mission count (brief §26).
 */
export default async function MapPage() {
  const actor = await requireChild();
  const family = await prisma.family.findUniqueOrThrow({
    where: { id: actor.familyId },
    select: { timezone: true, setting: true },
  });
  const today = toLocalDate(new Date(), family.timezone);

  const [weekly, summary] = await Promise.all([
    tasksService.getWeeklyProgress(actor, {
      childId: actor.childId,
      today,
      target: family.setting?.weeklyGoalTarget ?? 25,
    }),
    childrenService.getSummary(actor, { childId: actor.childId, today }),
  ]);

  const path = buildAdventurePath(weekly.completed, weekly.target);

  return (
    <div className="pb-24">
      <header className="mh-gradient px-5 pb-8 pt-8 text-white">
        <div className="mx-auto max-w-md">
          <h1 className="text-3xl font-black">Adventure Map</h1>
          <p className="mt-1 font-semibold text-white/90">
            {path.nextStopName
              ? `${path.stepsToNextStop} more to reach the ${path.nextStopName}`
              : 'You reached the treasure this week!'}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-md space-y-6 px-5 py-6">
        <ol className="relative space-y-1">
          {path.stops.map((stop, index) => (
            <li key={stop.name} className="flex items-stretch gap-3">
              <div className="flex w-12 flex-col items-center">
                <div
                  className={cn(
                    'flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 text-2xl',
                    stop.current
                      ? 'mh-gradient border-transparent text-white shadow-pop'
                      : stop.reached
                        ? 'border-success bg-success/10'
                        : 'border-dashed border-border bg-surface',
                  )}
                >
                  <span aria-hidden className={stop.reached ? '' : 'opacity-30 grayscale'}>
                    {stop.icon}
                  </span>
                </div>
                {index < path.stops.length - 1 ? (
                  <div
                    aria-hidden
                    className={cn(
                      'w-1 flex-1 rounded-full',
                      path.stops[index + 1]!.reached ? 'bg-success' : 'bg-border',
                    )}
                    style={{ minHeight: '1.5rem' }}
                  />
                ) : null}
              </div>

              <div className="flex-1 pb-4 pt-2">
                <p className={cn('font-extrabold', stop.reached ? 'text-ink' : 'text-muted')}>
                  {stop.name}
                  {stop.current ? (
                    <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand">
                      You are here
                    </span>
                  ) : null}
                </p>
                <p className="text-sm text-muted">
                  {stop.reached
                    ? 'Reached'
                    : `${stop.requiredSteps - path.steps} more ${
                        stop.requiredSteps - path.steps === 1 ? 'mission' : 'missions'
                      }`}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <p className="rounded-xl2 border-2 border-border bg-card p-4 text-center">
          <span className="block text-3xl font-black text-ink">
            {path.steps} / {path.totalSteps}
          </span>
          <span className="text-sm text-muted">
            missions this week · Level {summary.levelNumber} {summary.levelName}
          </span>
        </p>

        <Link
          href="/kids/home"
          className="mh-tap flex items-center justify-center rounded-full border-2 border-border bg-card font-bold text-ink"
        >
          ← Back to today
        </Link>
      </div>
    </div>
  );
}
