import Link from 'next/link';
import { requireParent } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { toLocalDate } from '@/domain/dates';
import { Card, CardTitle, EmptyState } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { formatNumber, relativeTime } from '@/lib/utils';
import * as children from '@/features/children/service';
import * as progress from '@/features/progress/service';
import * as character from '@/features/character/service';
import { AwardBonusForm } from '@/components/parent/award-bonus-form';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Progress' };

export default async function ProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string }>;
}) {
  const actor = await requireParent();
  const { child: requestedChildId } = await searchParams;

  const family = await prisma.family.findUniqueOrThrow({
    where: { id: actor.familyId },
    select: { timezone: true },
  });
  const today = toLocalDate(new Date(), family.timezone);

  const kids = await children.listChildren(actor);
  if (kids.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-black text-ink">Progress</h1>
        <EmptyState icon="🦸" title="No heroes yet" hint="Add a child to see their progress." />
      </div>
    );
  }

  // An unknown or other-family id simply falls back to the first child.
  const selected = kids.find((kid) => kid.id === requestedChildId) ?? kids[0]!;

  const [detail, characterHistory, taskHistory, ledgerHistory, traits] = await Promise.all([
    progress.getChildProgress(actor, { childId: selected.id, today }),
    progress.getCharacterHistory(actor, selected.id, 15),
    progress.getTaskHistory(actor, selected.id, 15),
    progress.getLedgerHistory(actor, selected.id, 20),
    character.listTraits(actor),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-ink">Progress</h1>
        <p className="text-sm text-muted">How the last few weeks have actually gone.</p>
      </div>

      {kids.length > 1 ? (
        <nav aria-label="Choose a child" className="flex flex-wrap gap-2">
          {kids.map((kid) => (
            <Link
              key={kid.id}
              href={`/parent/progress?child=${kid.id}`}
              aria-current={kid.id === selected.id ? 'page' : undefined}
              className={cn(
                'mh-tap-sm flex items-center rounded-full px-4 text-sm font-bold',
                kid.id === selected.id
                  ? 'bg-brand text-white'
                  : 'border-2 border-border bg-card text-muted',
              )}
            >
              {kid.nickname}
            </Link>
          ))}
        </nav>
      ) : null}

      <section aria-labelledby="totals" className="space-y-3">
        <CardTitle>
          <span id="totals">{detail.nickname} right now</span>
        </CardTitle>
        <Card className="grid grid-cols-3 gap-3 text-center">
          <Stat label="XP" value={formatNumber(detail.lifetimeXp)} tone="text-xp" />
          <Stat label="Points" value={formatNumber(detail.rewardPoints)} tone="text-points" />
          <Stat label="Stars" value={formatNumber(detail.characterStars)} tone="text-star" />
        </Card>
        <Card className="space-y-2">
          <Progress
            label="This week"
            value={detail.approvedThisWeek}
            max={Math.max(1, detail.scheduledThisWeek)}
            caption={`${detail.approvedThisWeek} / ${detail.scheduledThisWeek || 0}`}
          />
          <p className="text-sm text-muted">
            Best streak {detail.longestStreak} {detail.longestStreak === 1 ? 'day' : 'days'} ·{' '}
            {detail.perfectWeeks} perfect {detail.perfectWeeks === 1 ? 'week' : 'weeks'}
            {detail.missedThisWeek > 0 ? ` · ${detail.missedThisWeek} missed this week` : ''}
          </p>
        </Card>
      </section>

      <section aria-labelledby="weeks" className="space-y-2">
        <CardTitle>
          <span id="weeks">Recent weeks</span>
        </CardTitle>
        {detail.recentWeeks.length === 0 ? (
          <EmptyState icon="📅" title="No history yet" />
        ) : (
          <Card className="space-y-2">
            {detail.recentWeeks.map((week) => (
              <div key={week.weekStart} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-xs text-muted">{week.weekStart}</span>
                <span className="flex-1">
                  <Progress
                    label={`Week of ${week.weekStart}`}
                    value={week.approved}
                    max={Math.max(1, week.total)}
                  />
                </span>
                <span className="w-16 shrink-0 text-right text-xs font-bold text-ink">
                  {week.approved}/{week.total}
                  {week.perfect ? ' ✨' : ''}
                </span>
              </div>
            ))}
          </Card>
        )}
      </section>

      <section aria-labelledby="character" className="space-y-2">
        <CardTitle>
          <span id="character">Character</span>
        </CardTitle>
        <Card>
          <ul className="space-y-1">
            {detail.traits
              .filter((trait) => trait.total > 0)
              .map((trait) => (
                <li key={trait.label} className="flex items-center justify-between text-sm">
                  <span className="text-ink">
                    <span aria-hidden>{trait.emoji}</span> {trait.label}
                  </span>
                  <span className="font-bold tabular-nums text-star">{trait.total}</span>
                </li>
              ))}
            {detail.traits.every((trait) => trait.total === 0) ? (
              <li className="text-sm text-muted">No confirmed moments yet.</li>
            ) : null}
          </ul>
        </Card>
      </section>

      <section aria-labelledby="moments" className="space-y-2">
        <CardTitle>
          <span id="moments">Character history</span>
        </CardTitle>
        {characterHistory.length === 0 ? (
          <EmptyState icon="❤️" title="No confirmed moments yet." />
        ) : (
          <ul className="space-y-2">
            {characterHistory.map((moment) => (
              <li key={moment.id}>
                <Card>
                  <p className="text-sm font-bold text-ink">
                    <span aria-hidden>{moment.trait.emoji}</span> {moment.trait.label} ·{' '}
                    <span className="font-normal text-muted">
                      {relativeTime(moment.submittedAt)}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-muted">“{moment.story}”</p>
                  {moment.approval?.encouragementMessage ? (
                    <p className="mt-1 text-sm text-brand">
                      You said: {moment.approval.encouragementMessage}
                    </p>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="missions" className="space-y-2">
        <CardTitle>
          <span id="missions">Mission history</span>
        </CardTitle>
        {taskHistory.length === 0 ? (
          <EmptyState icon="🎯" title="No missions resolved yet." />
        ) : (
          <Card className="divide-y divide-border p-0">
            {taskHistory.map((completion) => (
              <p
                key={completion.id}
                className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
              >
                <span className="truncate text-ink">{completion.task.title}</span>
                <span className="shrink-0 text-xs text-muted">
                  {completion.status === 'APPROVED' ? '✓' : '↻'}{' '}
                  {relativeTime(completion.submittedAt)}
                </span>
              </p>
            ))}
          </Card>
        )}
      </section>

      <section aria-labelledby="ledger" className="space-y-2">
        <CardTitle>
          <span id="ledger">Every award and spend</span>
        </CardTitle>
        <Card className="divide-y divide-border p-0">
          {ledgerHistory.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">Nothing yet.</p>
          ) : (
            ledgerHistory.map((entry) => (
              <p
                key={entry.id}
                className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
              >
                <span className="min-w-0 truncate text-ink">
                  {entry.description}
                  {entry.traitLabel ? ` (${entry.traitLabel})` : ''}
                </span>
                <span
                  className={cn(
                    'shrink-0 font-bold tabular-nums',
                    entry.ledger === 'XP'
                      ? 'text-xp'
                      : entry.ledger === 'POINTS'
                        ? 'text-points'
                        : 'text-star',
                  )}
                >
                  {entry.amount > 0 ? '+' : ''}
                  {entry.amount}
                </span>
              </p>
            ))
          )}
        </Card>
      </section>

      <section aria-labelledby="bonus" className="space-y-2">
        <CardTitle>
          <span id="bonus">Award a bonus</span>
        </CardTitle>
        <Card>
          <AwardBonusForm
            childId={selected.id}
            childNickname={selected.nickname}
            traits={traits.map((trait) => ({ id: trait.id, label: trait.label }))}
          />
        </Card>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <p className={cn('text-xl font-black tabular-nums', tone)}>{value}</p>
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}
