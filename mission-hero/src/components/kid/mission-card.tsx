'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { MissionCard as Mission } from '@/features/tasks/types';

interface MissionCardProps {
  mission: Mission;
  onDone: (occurrenceId: string, evidenceText?: string) => Promise<void>;
}

/**
 * The card a child taps. The optimistic part is deliberately limited to the
 * pending *animation*: the awarded values are never shown until the server has
 * confirmed them (brief §50, "do not fake backend actions in frontend state").
 */
export function MissionCard({ mission, onDone }: MissionCardProps) {
  const [pending, startTransition] = useTransition();
  const [showEvidence, setShowEvidence] = useState(false);
  const [evidence, setEvidence] = useState('');
  const [error, setError] = useState<string | null>(null);

  const needsEvidence = mission.evidenceType === 'NOTE' || mission.evidenceType === 'PHOTO';

  const submit = (text?: string) => {
    setError(null);
    startTransition(async () => {
      try {
        await onDone(mission.occurrenceId, text);
        setShowEvidence(false);
        setEvidence('');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Something went wrong. Try again?');
      }
    });
  };

  return (
    <li
      className={cn(
        'rounded-xl2 border-2 bg-card p-4 transition-colors',
        mission.state === 'DONE' && 'border-success/40 bg-success/5',
        mission.state === 'WAITING' && 'border-warn/40 bg-warn/5',
        mission.state === 'REDO' && 'border-brand/40',
        mission.state === 'OPEN' && 'border-border',
      )}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className="text-3xl">
          {ICONS[mission.iconKey] ?? '🎯'}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-extrabold leading-tight text-ink">{mission.title}</h3>
          <p className="mt-1 flex flex-wrap gap-2 text-xs font-bold">
            {mission.xpValue > 0 ? <span className="text-xp">+{mission.xpValue} XP</span> : null}
            {mission.rewardPointsValue > 0 ? (
              <span className="text-points">+{mission.rewardPointsValue} points</span>
            ) : null}
            {mission.characterStarValue > 0 ? (
              <span className="text-star">
                +{mission.characterStarValue} {mission.traitLabel ?? 'star'}
              </span>
            ) : null}
          </p>
          {mission.parentMessage ? (
            <p className="mt-2 rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand">
              {mission.parentMessage}
            </p>
          ) : null}
        </div>

        <div className="shrink-0">
          {mission.state === 'WAITING' ? (
            <span className="inline-flex animate-pulse-soft items-center gap-1 rounded-full bg-warn/15 px-3 py-2 text-xs font-bold text-warn">
              <span aria-hidden>⏳</span> Waiting
            </span>
          ) : mission.state === 'DONE' ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-3 py-2 text-xs font-bold text-success">
              <span aria-hidden>✓</span> Done
            </span>
          ) : (
            <Button
              variant="primary"
              size="kid"
              disabled={pending}
              onClick={() => (needsEvidence ? setShowEvidence((open) => !open) : submit())}
              aria-expanded={needsEvidence ? showEvidence : undefined}
            >
              {pending ? 'Sending…' : 'DONE!'}
            </Button>
          )}
        </div>
      </div>

      {showEvidence ? (
        <div className="mt-3 space-y-2">
          <label
            htmlFor={`evidence-${mission.occurrenceId}`}
            className="text-sm font-semibold text-muted"
          >
            Tell us what you did
          </label>
          <textarea
            id={`evidence-${mission.occurrenceId}`}
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
            rows={3}
            maxLength={500}
            className="w-full rounded-xl2 border-2 border-border bg-surface p-3 text-base"
            placeholder="I read two chapters of my book."
          />
          <Button
            variant="primary"
            size="block"
            disabled={pending || evidence.trim().length === 0}
            onClick={() => submit(evidence.trim())}
          >
            {pending ? 'Sending…' : 'SEND IT!'}
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm font-semibold text-star">
          {error}
        </p>
      ) : null}
    </li>
  );
}

const ICONS: Record<string, string> = {
  bed: '🛏️',
  book: '📚',
  pencil: '✏️',
  backpack: '🎒',
  utensils: '🍽️',
  broom: '🧹',
  scroll: '📜',
  music: '🎵',
  sparkles: '✨',
  target: '🎯',
  heart: '❤️',
  hands: '🤝',
};

export { ICONS as MISSION_ICONS };
