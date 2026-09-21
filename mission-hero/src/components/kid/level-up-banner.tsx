'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CELEBRATION } from '@/domain/copy';

/**
 * Shown once per level reached. The "seen" marker is a per-viewer convenience
 * in localStorage, so a lost flag simply means the banner shows again — it can
 * never cost a child anything, because the level itself lives in the ledger.
 */
export function LevelUpBanner({
  levelNumber,
  levelName,
}: {
  levelNumber: number;
  levelName: string;
}) {
  const [show, setShow] = useState(false);
  const storageKey = `mh:level-seen`;

  useEffect(() => {
    try {
      const seen = Number(window.localStorage.getItem(storageKey) ?? '0');
      if (levelNumber > seen) setShow(true);
    } catch {
      // Private mode or blocked storage: skip the banner rather than break.
    }
  }, [levelNumber, storageKey]);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try {
      window.localStorage.setItem(storageKey, String(levelNumber));
    } catch {
      // Nothing to do — the banner is a nicety, not state we depend on.
    }
  };

  return (
    <div
      role="status"
      className="animate-pop-in rounded-xl3 border-2 border-xp bg-xp/10 p-5 text-center"
    >
      <p aria-hidden className="text-4xl">
        🎉
      </p>
      <p className="mt-1 text-sm font-black uppercase tracking-widest text-xp">
        {CELEBRATION.levelUp}
      </p>
      <p className="text-2xl font-black text-ink">
        Level {levelNumber} · {levelName}
      </p>
      <div className="mt-3 flex gap-2">
        <Link
          href="/kids/me"
          className="mh-tap mh-gradient flex flex-1 items-center justify-center rounded-full px-4 font-extrabold text-white"
        >
          See what unlocked
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="mh-tap rounded-full border-2 border-border px-4 font-bold text-muted"
        >
          Nice!
        </button>
      </div>
    </div>
  );
}
