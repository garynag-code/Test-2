import { requireChild } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { toLocalDate } from '@/domain/dates';
import { EMPTY_STATES, STREAK } from '@/domain/copy';
import { EmptyState } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { StatChip } from '@/components/kid/stat-chip';
import { LevelRing } from '@/components/kid/level-ring';
import { MissionList } from '@/components/kid/mission-list';
import { HiddenObject } from '@/components/kid/hidden-object';
import * as childrenService from '@/features/children/service';
import * as tasksService from '@/features/tasks/service';
import * as wheelService from '@/features/reward-wheel/service';
import * as missionsService from '@/features/secret-missions/service';
import * as characterService from '@/features/character/service';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Home' };

export default async function KidHomePage() {
  const actor = await requireChild();
  const family = await prisma.family.findUniqueOrThrow({
    where: { id: actor.familyId },
    select: { timezone: true, setting: true },
  });
  const today = toLocalDate(new Date(), family.timezone);

  const [summary, missions, weekly, wheel, hidden, traits] = await Promise.all([
    childrenService.getSummary(actor, { childId: actor.childId, today }),
    tasksService.getMissionsForDate(actor, { childId: actor.childId, date: today }),
    tasksService.getWeeklyProgress(actor, {
      childId: actor.childId,
      today,
      target: family.setting?.weeklyGoalTarget ?? 25,
    }),
    wheelService.getWheelForChild(actor, { childId: actor.childId, today }),
    missionsService.getHiddenObject(actor, { childId: actor.childId, today }),
    characterService.listTraits(actor),
  ]);

  const remaining = missions.filter((m) => m.state === 'OPEN').length;

  return (
    <div className="pb-24">
      <header className="mh-gradient px-5 pb-8 pt-8 text-white">
        <div className="mx-auto max-w-md space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-white/70">
                Mission Hero
              </p>
              <h1 className="text-3xl font-black">Hey {summary.nickname}!</h1>
              <p className="mt-1 text-sm font-bold text-white/90">
                {summary.streakDays > 0
                  ? `🔥 ${STREAK.showingUp(summary.streakDays)}`
                  : STREAK.reset}
              </p>
            </div>
            <LevelRing
              levelNumber={summary.levelNumber}
              levelName={summary.levelName}
              progress={summary.levelProgress}
              xpToNext={summary.xpToNextLevel}
            />
          </div>
          <HiddenObject surface="home-header" hidden={hidden} />
        </div>
      </header>

      <div className="mx-auto max-w-md space-y-6 px-5 py-6">
        <section aria-label="Your totals" className="flex gap-3">
          <StatChip kind="xp" value={summary.lifetimeXp} />
          <StatChip kind="points" value={summary.rewardPoints} />
          <StatChip kind="stars" value={summary.characterStars} />
        </section>

        {wheel ? (
          <section
            aria-labelledby="wheel-progress"
            className="rounded-xl2 border-2 border-border bg-card p-4"
          >
            <h2
              id="wheel-progress"
              className="text-sm font-bold uppercase tracking-wide text-muted"
            >
              Next wheel spin
            </h2>
            <div className="mt-2">
              <Progress
                label="Progress to your next spin"
                value={Math.min(wheel.balance, wheel.pointThreshold)}
                max={wheel.pointThreshold}
                caption={`${Math.min(wheel.balance, wheel.pointThreshold)} / ${wheel.pointThreshold}`}
              />
            </div>
            {wheel.eligible ? (
              <Link
                href="/kids/wheel"
                className="mh-tap mh-gradient mt-3 flex items-center justify-center rounded-full px-6 font-extrabold text-white shadow-pop"
              >
                YOU UNLOCKED A SPIN!
              </Link>
            ) : (
              <p className="mt-2 text-sm text-muted">
                {wheel.pointsNeeded > 0
                  ? `${wheel.pointsNeeded} more points to unlock a spin.`
                  : 'Next spin available tomorrow.'}
              </p>
            )}
          </section>
        ) : null}

        <section aria-labelledby="today" className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 id="today" className="text-sm font-bold uppercase tracking-wide text-muted">
              Today&apos;s missions
            </h2>
            {remaining > 0 ? (
              <span className="text-sm font-bold text-brand">{remaining} left</span>
            ) : null}
          </div>
          {missions.length === 0 ? (
            <EmptyState icon="🎉" title={EMPTY_STATES.noMissionsToday} />
          ) : (
            <MissionList missions={missions} />
          )}
          <HiddenObject surface="home-missions" hidden={hidden} />
        </section>

        <section
          aria-labelledby="character"
          className="rounded-xl2 border-2 border-border bg-card p-4"
        >
          <h2 id="character" className="text-sm font-bold uppercase tracking-wide text-muted">
            Character power
          </h2>
          <p className="mt-1 font-extrabold text-ink">What kind of hero were you today?</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {traits.slice(0, 4).map((trait) => (
              <li key={trait.id}>
                <Link
                  href="/kids/character"
                  className="mh-tap-sm flex items-center gap-2 rounded-full border-2 border-border px-4 text-sm font-bold text-ink"
                >
                  <span aria-hidden>{trait.emoji}</span> {trait.label}
                </Link>
              </li>
            ))}
          </ul>
          <HiddenObject surface="home-character" hidden={hidden} />
        </section>

        <section
          aria-labelledby="weekly"
          className="rounded-xl2 border-2 border-border bg-card p-4"
        >
          <h2 id="weekly" className="text-sm font-bold uppercase tracking-wide text-muted">
            Weekly quest
          </h2>
          <div className="mt-2">
            <Progress
              label="Missions completed this week"
              value={weekly.completed}
              max={weekly.target}
              caption={`${weekly.completed} / ${weekly.target}`}
            />
          </div>
          <HiddenObject surface="home-weekly" hidden={hidden} />
        </section>
      </div>
    </div>
  );
}
