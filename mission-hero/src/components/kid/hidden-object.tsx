'use client';

import { useState, useTransition } from 'react';
import { discoverSecretMissionAction } from '@/features/secret-missions/actions';
import { CELEBRATION } from '@/domain/copy';

interface HiddenObjectProps {
  surface: string;
  hidden: { surface: string; offset: number; objectKey: string; missionId: string } | null;
}

const OBJECTS: Record<string, string> = {
  chest: '🧰',
  star: '🌟',
  key: '🗝️',
  gem: '💎',
  rocket: '🚀',
  scroll: '📜',
  egg: '🥚',
  bolt: '⚡',
  shield: '🛡️',
  'map-piece': '🗺️',
};

/**
 * A small, findable object. Its position comes from the server (a deterministic
 * per-child, per-day hash), so refreshing cannot conjure a new one — BR-51,
 * which is as much an anti-compulsion measure as an anti-farming one.
 */
export function HiddenObject({ surface, hidden }: HiddenObjectProps) {
  const [found, setFound] = useState<{ title: string; instructions: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (!hidden || hidden.surface !== surface) return null;

  if (found) {
    return (
      <div
        role="status"
        className="mt-3 animate-pop-in rounded-xl2 border-2 border-brand bg-brand-soft p-4 text-brand"
      >
        <p className="text-sm font-black uppercase tracking-wide">{CELEBRATION.secretFound}</p>
        <p className="mt-1 text-lg font-extrabold text-ink">{found.title}</p>
        <p className="text-sm text-ink">{found.instructions}</p>
      </div>
    );
  }

  return (
    <div
      className="relative mt-2 h-8"
      style={{ paddingLeft: `${Math.round(hidden.offset * 70)}%` }}
    >
      <button
        type="button"
        disabled={pending}
        aria-label="A mysterious object. Tap to look closer."
        onClick={() =>
          startTransition(async () => {
            const result = await discoverSecretMissionAction(hidden.missionId, surface);
            if (result.mission) setFound(result.mission);
          })
        }
        className="text-2xl transition-transform hover:scale-125 active:scale-95"
      >
        <span aria-hidden>{OBJECTS[hidden.objectKey] ?? '✨'}</span>
      </button>
    </div>
  );
}
