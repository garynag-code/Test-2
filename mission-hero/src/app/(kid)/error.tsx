'use client';

import { useEffect } from 'react';

/** The child-facing wording of the same failure: nothing scary, nothing lost. */
export default function KidError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Kid surface error', error.digest ?? error.message);
  }, [error]);

  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-5">
      <div className="w-full max-w-sm text-center">
        <p aria-hidden className="text-5xl">
          🚀
        </p>
        <h1 className="mt-3 text-2xl font-black text-ink">Oops — a little glitch</h1>
        <p className="mt-2 text-muted">
          Your XP and stars are all safe. Let&apos;s have another go.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mh-tap mh-gradient mt-6 w-full rounded-full font-extrabold text-white"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
