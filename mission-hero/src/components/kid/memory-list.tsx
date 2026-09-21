'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { MAX_STORY_LENGTH } from '@/domain/constants';
import { reciteAction } from '@/features/memory/actions';

interface Challenge {
  id: string;
  title: string;
  category: string;
  reference: string | null;
  bodyText: string;
  xpValue: number;
  rewardPointsValue: number;
  status: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  BIBLE_VERSE: 'Verse',
  QUOTE: 'Quote',
  AFFIRMATION: 'Affirmation',
  FAMILY_SAYING: 'Family saying',
  SLOGAN: 'Slogan',
  VOCABULARY: 'Word',
  SCHOOL_FACT: 'Fact',
  CUSTOM: 'Challenge',
};

export function MemoryList({ challenges }: { challenges: Challenge[] }) {
  return (
    <ul className="space-y-3">
      {challenges.map((challenge) => (
        <MemoryCard key={challenge.id} challenge={challenge} />
      ))}
    </ul>
  );
}

/**
 * The text is hidden the moment the child chooses to recite, so typing it
 * really is from memory. The app does not grade the answer — the parent
 * compares it themselves (BR-50).
 */
function MemoryCard({ challenge }: { challenge: Challenge }) {
  const [reciting, setReciting] = useState(false);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(challenge.status === 'PENDING');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const mastered = challenge.status === 'APPROVED';

  return (
    <li className="rounded-xl2 border-2 border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">
            {CATEGORY_LABELS[challenge.category] ?? 'Challenge'}
            {challenge.reference ? ` · ${challenge.reference}` : ''}
          </p>
          <h2 className="font-extrabold text-ink">{challenge.title}</h2>
        </div>
        {mastered ? (
          <span className="shrink-0 rounded-full bg-success/15 px-3 py-2 text-xs font-bold text-success">
            <span aria-hidden>✓</span> Mastered
          </span>
        ) : (
          <p className="shrink-0 text-xs font-bold text-xp">+{challenge.xpValue} XP</p>
        )}
      </div>

      {reciting && !sent ? (
        <div className="mt-3 space-y-2">
          <label htmlFor={`recite-${challenge.id}`} className="block text-sm font-bold text-ink">
            Type it from memory
          </label>
          <textarea
            id={`recite-${challenge.id}`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={4}
            maxLength={MAX_STORY_LENGTH}
            autoFocus
            className="w-full rounded-xl2 border-2 border-border bg-surface p-3 text-base"
            placeholder="Give it your best shot…"
          />
          {error ? (
            <p role="alert" className="text-sm font-semibold text-star">
              {error}
            </p>
          ) : null}
          <Button
            variant="primary"
            size="block"
            disabled={pending || text.trim().length === 0}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await reciteAction(challenge.id, text.trim());
                if (result?.error) setError(result.error);
                else setSent(true);
              });
            }}
          >
            {pending ? 'Sending…' : 'SEND IT!'}
          </Button>
          <Button variant="ghost" size="block" onClick={() => setReciting(false)}>
            ← Let me read it again
          </Button>
        </div>
      ) : sent ? (
        <p className="mt-3 rounded-xl2 bg-warn/10 px-3 py-2 text-sm font-bold text-warn">
          <span aria-hidden>⏳</span> Waiting for a grown-up to check it
        </p>
      ) : (
        <>
          {/* The text stays visible until the child chooses to recite. */}
          <blockquote className="mt-3 rounded-xl2 bg-surface p-3 text-ink">
            {challenge.bodyText}
          </blockquote>
          {mastered ? null : (
            <>
              {challenge.status === 'REJECTED' ? (
                <p className="mt-2 text-sm text-muted">
                  Have another practice, then try again when you&apos;re ready.
                </p>
              ) : null}
              <Button
                variant="primary"
                size="block"
                className="mt-3"
                onClick={() => setReciting(true)}
              >
                READY TO RECITE
              </Button>
            </>
          )}
        </>
      )}
    </li>
  );
}
