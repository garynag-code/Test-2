import Link from 'next/link';
import { requireParent } from '@/server/auth/guards';
import { EmptyState } from '@/components/ui/card';
import { EMPTY_STATES } from '@/domain/copy';
import { cn } from '@/lib/utils';
import * as approvals from '@/features/approvals/service';
import * as characterService from '@/features/character/service';
import * as memoryService from '@/features/memory/service';
import * as questService from '@/features/secret-missions/service';
import { ApprovalRow } from '@/components/parent/approval-row';
import { CharacterApprovalRow } from '@/components/parent/character-approval-row';
import { MemoryApprovalRow } from '@/components/parent/memory-approval-row';
import { QuestApprovalRow } from '@/components/parent/quest-approval-row';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Approvals' };

type Tab = 'missions' | 'character' | 'memory' | 'quests';

const TABS: Tab[] = ['missions', 'character', 'memory', 'quests'];

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const actor = await requireParent();
  const { tab } = await searchParams;
  const active: Tab = TABS.includes(tab as Tab) ? (tab as Tab) : 'missions';

  const [missions, characterMoments, memory, quests] = await Promise.all([
    approvals.listPendingApprovals(actor),
    characterService.listPendingSubmissions(actor),
    memoryService.listPending(actor),
    questService.listPendingQuests(actor),
  ]);

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'missions', label: 'Missions', count: missions.length },
    { key: 'character', label: 'Character', count: characterMoments.length },
    { key: 'memory', label: 'Memory', count: memory.length },
    { key: 'quests', label: 'Quests', count: quests.length },
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
              <MemoryApprovalRow
                key={item.id}
                submission={{
                  submissionId: item.id,
                  childNickname: item.child.nickname,
                  challengeTitle: item.challenge.title,
                  reference: item.challenge.reference,
                  original: item.challenge.bodyText,
                  recited: item.recitedText,
                  submittedAt: item.submittedAt,
                  xpValue: item.challenge.xpValue,
                  rewardPointsValue: item.challenge.rewardPointsValue,
                }}
              />
            ))}
          </ul>
        )
      ) : null}

      {active === 'quests' ? (
        quests.length === 0 ? (
          <EmptyState icon="🗝️" title="No quests waiting." />
        ) : (
          <ul className="space-y-3">
            {quests.map((item) => (
              <QuestApprovalRow key={item.submissionId} submission={item} />
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
