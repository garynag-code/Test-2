'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { MAX_NOTE_LENGTH } from '@/domain/constants';
import { submitSecretMissionAction } from '@/features/secret-missions/actions';
import type { QuestCard } from '@/features/secret-missions/service';
import { cn } from '@/lib/utils';

/**
 * Rarity changes presentation and reward size only. There is no purchase path
 * and no paid randomness anywhere near it (brief §42, BR-54).
 */
const RARITY: Record<string, { label: string; className: string }> = {
  COMMON: { label: 'Common', className: 'bg-muted/15 text-muted' },
  RARE: { label: 'Rare', className: 'bg-brand/15 text-brand' },
  EPIC: { label: 'Epic', className: 'bg-points/15 text-points' },
  LEGENDARY: { label: 'Legendary', className: 'bg-xp/20 text-xp' },
};

export function QuestList({ quests }: { quests: QuestCard[] }) {
  return (
    <ul className="space-y-3">
      {quests.map((quest) => (
        <QuestItem key={quest.missionId} quest={quest} />
      ))}
    </ul>
  );
}

function QuestItem({ quest }: { quest: QuestCard }) {
  const [note, setNote] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [status, setStatus] = useState(quest.status);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rarity = RARITY[quest.rarity] ?? RARITY.COMMON!;
  const done = status === 'APPROVED';

  return (
    <li
      className={cn(
        'rounded-xl2 border-2 bg-card p-4',
        done ? 'border-success/40 bg-success/5' : 'border-border',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wide">
            <span className={cn('rounded-full px-2 py-0.5', rarity.className)}>{rarity.label}</span>
            <span className="text-muted">
              {quest.kind === 'SECRET' ? '🗝️ Secret mission' : '⭐ Bonus challenge'}
            </span>
          </p>
          <h2 className="mt-1 font-extrabold text-ink">{quest.title}</h2>
          <p className="mt-1 text-sm text-muted">{quest.instructions}</p>
        </div>
        <p className="shrink-0 text-right text-xs font-bold">
          {quest.xpValue > 0 ? <span className="text-xp">+{quest.xpValue} XP</span> : null}
          {quest.rewardPointsValue > 0 ? (
            <>
              <br />
              <span className="text-points">+{quest.rewardPointsValue} pts</span>
            </>
          ) : null}
          {quest.starValue > 0 && quest.traitLabel ? (
            <>
              <br />
              <span className="text-star">
                +{quest.starValue} {quest.traitLabel}
              </span>
            </>
          ) : null}
        </p>
      </div>

      {done ? (
        <p className="mt-3 text-sm font-bold text-success">
          <span aria-hidden>✓</span> Complete
        </p>
      ) : status === 'PENDING' ? (
        <p className="mt-3 rounded-xl2 bg-warn/10 px-3 py-2 text-sm font-bold text-warn">
          <span aria-hidden>⏳</span> Waiting for a grown-up
        </p>
      ) : claiming ? (
        <div className="mt-3 space-y-2">
          <label htmlFor={`note-${quest.missionId}`} className="block text-sm font-bold text-ink">
            What did you do?
          </label>
          <textarea
            id={`note-${quest.missionId}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={MAX_NOTE_LENGTH}
            className="w-full rounded-xl2 border-2 border-border bg-surface p-3 text-base"
            placeholder="I tidied the lounge without being asked."
          />
          {error ? (
            <p role="alert" className="text-sm font-semibold text-star">
              {error}
            </p>
          ) : null}
          <Button
            variant="primary"
            size="block"
            disabled={pending || note.trim().length === 0}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await submitSecretMissionAction(quest.missionId, note.trim());
                if (result?.error) setError(result.error);
                else setStatus('PENDING');
              });
            }}
          >
            {pending ? 'Sending…' : 'SEND IT!'}
          </Button>
        </div>
      ) : (
        <Button variant="primary" size="block" className="mt-3" onClick={() => setClaiming(true)}>
          I DID IT!
        </Button>
      )}
    </li>
  );
}
