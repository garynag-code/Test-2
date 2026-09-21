import Link from 'next/link';
import { requireParent } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { Card, CardTitle, EmptyState } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { formatNumber, pluralise, relativeTime } from '@/lib/utils';
import { toLocalDate } from '@/domain/dates';
import * as children from '@/features/children/service';
import * as approvals from '@/features/approvals/service';
import * as characterService from '@/features/character/service';
import * as tasksService from '@/features/tasks/service';
import * as memoryService from '@/features/memory/service';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

export default async function ParentDashboard() {
  const actor = await requireParent();
  const family = await prisma.family.findUniqueOrThrow({
    where: { id: actor.familyId },
    select: { timezone: true, familyCode: true, setting: true },
  });
  const today = toLocalDate(new Date(), family.timezone);

  const [kids, pendingTasks, pendingCharacter, pendingMemory, recent] = await Promise.all([
    children.listChildren(actor),
    approvals.listPendingApprovals(actor),
    characterService.listPendingSubmissions(actor),
    memoryService.listPending(actor),
    prisma.auditLog.findMany({
      where: { familyId: actor.familyId },
      orderBy: { createdAt: 'desc' },
      take: 6,
      include: { child: { select: { nickname: true } } },
    }),
  ]);

  const waiting = pendingTasks.length + pendingCharacter.length + pendingMemory.length;

  const summaries = await Promise.all(
    kids.map(async (child) => ({
      child,
      summary: await children.getSummary(actor, { childId: child.id, today }),
      weekly: await tasksService.getWeeklyProgress(actor, {
        childId: child.id,
        today,
        target: family.setting?.weeklyGoalTarget ?? 25,
      }),
    })),
  );

  return (
    <div className="space-y-6">
      <section aria-labelledby="needs-you">
        <h1 id="needs-you" className="text-2xl font-black text-ink">
          {waiting > 0
            ? `${waiting} ${pluralise(waiting, 'thing')} needs you`
            : 'Nothing waiting right now'}
        </h1>
        {waiting > 0 ? (
          <Card className="mt-3 divide-y divide-border p-0">
            <QueueRow href="/parent/approvals" count={pendingTasks.length} label="missions" />
            <QueueRow
              href="/parent/approvals?tab=character"
              count={pendingCharacter.length}
              label="character moments"
            />
            <QueueRow
              href="/parent/approvals?tab=memory"
              count={pendingMemory.length}
              label="memory challenges"
            />
          </Card>
        ) : (
          <p className="mt-2 text-muted">You&apos;re all caught up. Nice.</p>
        )}
      </section>

      <section aria-labelledby="children" className="space-y-3">
        <CardTitle>Children</CardTitle>
        {summaries.length === 0 ? (
          <EmptyState icon="🦸" title="No heroes yet" hint="Add a child profile to get started." />
        ) : (
          summaries.map(({ child, summary, weekly }) => (
            <Card key={child.id} className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-lg font-extrabold text-ink">{child.nickname}</p>
                  <p className="text-sm text-muted">
                    Level {summary.levelNumber} {summary.levelName}
                    {summary.streakDays > 0 ? ` · 🔥 ${summary.streakDays}-day streak` : ''}
                  </p>
                </div>
                <div className="text-right text-sm font-bold">
                  <span className="text-xp">⚡ {formatNumber(summary.lifetimeXp)}</span>{' '}
                  <span className="text-points">⭐ {formatNumber(summary.rewardPoints)}</span>{' '}
                  <span className="text-star">❤️ {formatNumber(summary.characterStars)}</span>
                </div>
              </div>
              <Progress
                label={`${child.nickname}'s week`}
                value={weekly.completed}
                max={weekly.target}
                caption={`${weekly.completed} / ${weekly.target}`}
              />
            </Card>
          ))
        )}
      </section>

      <section aria-labelledby="family-code">
        <CardTitle>Family code</CardTitle>
        <Card className="mt-2">
          <p className="text-sm text-muted">Type this once on your child&apos;s device.</p>
          <p className="mt-2 font-mono text-3xl font-black tracking-[0.3em] text-brand">
            {family.familyCode}
          </p>
        </Card>
      </section>

      <section aria-labelledby="recent" className="space-y-2">
        <CardTitle>Recent activity</CardTitle>
        {recent.length === 0 ? (
          <EmptyState
            icon="📋"
            title="Nothing here yet"
            hint="Activity will appear as it happens."
          />
        ) : (
          <Card className="divide-y divide-border p-0">
            {recent.map((entry) => (
              <p
                key={entry.id}
                className="flex items-baseline justify-between gap-3 px-4 py-3 text-sm"
              >
                <span className="text-ink">
                  {entry.child ? `${entry.child.nickname}: ` : ''}
                  {humanise(entry.action)}
                </span>
                <span className="shrink-0 text-xs text-muted">{relativeTime(entry.createdAt)}</span>
              </p>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}

function QueueRow({ href, count, label }: { href: string; count: number; label: string }) {
  if (count === 0) return null;
  return (
    <Link href={href} className="mh-tap-sm flex items-center justify-between px-4 py-3">
      <span className="font-semibold text-ink">
        {count} {pluralise(count, label.replace(/s$/, ''), label)}
      </span>
      <span aria-hidden className="text-muted">
        →
      </span>
    </Link>
  );
}

function humanise(action: string): string {
  return action.toLowerCase().replace(/_/g, ' ');
}
