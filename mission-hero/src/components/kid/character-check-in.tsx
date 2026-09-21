'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { CHARACTER, PENDING } from '@/domain/copy';
import { MAX_STORY_LENGTH } from '@/domain/constants';
import { submitCharacterAction } from '@/features/character/actions';
import type { TraitCard } from '@/features/character/types';

export function CharacterCheckIn({ traits }: { traits: TraitCard[] }) {
  const [selected, setSelected] = useState<TraitCard | null>(null);
  const [story, setStory] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? traits : traits.slice(0, 6);

  if (sent) {
    return (
      <div
        role="status"
        className="animate-pop-in rounded-xl2 border-2 border-success bg-success/10 p-6 text-center"
      >
        <p className="text-4xl" aria-hidden>
          ✨
        </p>
        <p className="mt-2 text-lg font-extrabold text-ink">{PENDING.sentIt}</p>
        <Button
          variant="soft"
          size="block"
          className="mt-4"
          onClick={() => {
            setSent(false);
            setSelected(null);
            setStory('');
          }}
        >
          Add another moment
        </Button>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl2 border-2 border-brand bg-brand-soft p-4 text-center">
          <p className="text-4xl" aria-hidden>
            {selected.emoji}
          </p>
          <p className="mt-1 text-lg font-black uppercase tracking-wide text-brand">
            {selected.label}
          </p>
        </div>

        <label htmlFor="story" className="block text-lg font-extrabold text-ink">
          {CHARACTER.tellUs}
        </label>
        <textarea
          id="story"
          value={story}
          onChange={(event) => setStory(event.target.value)}
          rows={4}
          maxLength={MAX_STORY_LENGTH}
          className="w-full rounded-xl2 border-2 border-border bg-card p-4 text-base"
          placeholder="I helped my little brother pack away his toys."
        />

        {error ? (
          <p
            role="alert"
            className="rounded-xl2 bg-star/10 px-4 py-3 text-sm font-semibold text-star"
          >
            {error}
          </p>
        ) : null}

        <Button
          variant="primary"
          size="block"
          disabled={pending || story.trim().length < 3}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await submitCharacterAction(selected.id, story.trim());
              if (result?.error) setError(result.error);
              else setSent(true);
            });
          }}
        >
          {pending ? 'Sending…' : 'SEND IT!'}
        </Button>
        <p className="text-center text-sm text-muted">A grown-up will see this ✨</p>

        <Button variant="ghost" size="block" onClick={() => setSelected(null)}>
          ← Pick a different one
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-2 gap-3">
        {visible.map((trait) => (
          <li key={trait.id}>
            <button
              type="button"
              onClick={() => setSelected(trait)}
              className="mh-tap flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl3 border-2 border-border bg-card p-4 text-center transition-transform active:scale-[0.97]"
            >
              <span aria-hidden className="text-4xl">
                {trait.emoji}
              </span>
              <span className="text-sm font-extrabold leading-tight text-ink">
                {trait.promptText}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {traits.length > 6 ? (
        <Button variant="ghost" size="block" onClick={() => setExpanded((open) => !open)}>
          {expanded ? '▲ Show fewer' : `▼ ${traits.length - 6} more`}
        </Button>
      ) : null}
    </div>
  );
}
