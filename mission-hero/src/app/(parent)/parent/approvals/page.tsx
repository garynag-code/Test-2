import Link from 'next/link';
import { requireParent } from '@/server/auth/guards';
import { Card, CardTitle, EmptyState } from '@/components/ui/card';
import { EMPTY_STATES } from '@/domain/copy';
import { cn } from '@/lib/utils';
import * as approvals from '@/features/approvals/service';
import * as characterService from '@/features/character/service';
import * as memoryService from '@/features/memory/service';
import { ApprovalRow } from '@/components/parent/approval-row';
import { CharacterApprovalRow } from '@/components/parent/character-approval-row';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Approvals' };

type Tab = 'missions' | 'character' | 'memory';

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const actor = await requireParent();
  const { tab } = await searchParams;
  const active: Tab = tab === 'character' || tab === 'memory' ? tab : 'missions';

  const [missions, characterMoments, memory] = await Promise.all([
    approvals.listPendingApprovals(actor),
    characterService.listPendingSubmissions(actor),
    memoryService.listPending(actor),
  ]);

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'missions', label: 'Missions', count: missions.length },
    { key: 'character', label: 'Character', count: characterMoments.length },
    { key: 'memory', label: 'Memory', count: memory.length },
  ];

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-black text-ink">Waiting for you</h1>

      <nav aria-label="Approval queues" className="flex gap-2">
        {tabs.map((item) => (
          <Link
            key={item.key}
            href={`/parent/approvals?tab=${item.key}`}
            aria-current={active === item.key ? 'page' : undefined}
            className={cn(
              'mh-tap-sm flex items-center gap-2 rounded-full px-4 text-sm font-bold',
              active === item.key
                ? 'bg-brand text-white'
                : 'border-2 border-border bg-card text-muted',
            )}
          >
            {item.label}
            {item.count > 0 ? (
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs',
                  active === item.key ? 'bg-white/25' : 'bg-brand-soft text-brand',
                )}
              >
                {item.count}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>

      {active === 'missions' ? (
        missions.length === 0 ? (
          <EmptyState icon="✅" title={EMPTY_STATES.nothingWaiting} />
        ) : (
          <ul className="space-y-3">
            {missions.map((item) => (
              <ApprovalRow key={item.completionId} approval={item} />
            ))}
          </ul>
        )
      ) : null}

      {active === 'character' ? (
        characterMoments.length === 0 ? (
          <EmptyState icon="❤️" title="No character moments waiting." />
        ) : (
          <ul className="space-y-3">
            {characterMoments.map((item) => (
              <CharacterApprovalRow key={item.submissionId} submission={item} />
            ))}
          </ul>
        )
      ) : null}

      {active === 'memory' ? (
        memory.length === 0 ? (
          <EmptyState icon="📜" title="No memory challenges waiting." />
        ) : (
          <ul className="space-y-3">
            {memory.map((item) => (
              <li key={item.id}>
                <Card className="space-y-2">
                  <CardTitle>
                    {item.child.nickname} · {item.challenge.title}
                  </CardTitle>
                  <p className="rounded-xl2 bg-surface p-3 text-sm text-muted">
                    <span className="font-bold text-ink">They said:</span> {item.recitedText ?? '—'}
                  </p>
                  <p className="rounded-xl2 bg-brand-soft p-3 text-sm text-brand">
                    <span className="font-bold">The original:</span> {item.challenge.bodyText}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
