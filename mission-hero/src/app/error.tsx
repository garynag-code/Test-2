'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * The last line of defence. A child should never see a stack trace, and a
 * parent should never be left wondering whether something was saved.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side detail stays on the server; the digest is the thread back to it.
    console.error('Unhandled error', error.digest ?? error.message);
  }, [error]);

  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-surface px-5">
      <div className="w-full max-w-sm text-center">
        <p aria-hidden className="text-5xl">
          🛠️
        </p>
        <h1 className="mt-3 text-2xl font-black text-ink">Something went wrong</h1>
        <p className="mt-2 text-muted">
          Nothing was lost. Have another go, and if it keeps happening, tell a grown-up.
        </p>
        <div className="mt-6 space-y-2">
          <button
            type="button"
            onClick={reset}
            className="mh-tap mh-gradient w-full rounded-full font-extrabold text-white"
          >
            Try again
          </button>
          <Link
            href="/"
            className="mh-tap flex w-full items-center justify-center rounded-full border-2 border-border bg-card font-bold text-ink"
          >
            Back to the start
          </Link>
        </div>
        {error.digest ? (
          <p className="mt-4 font-mono text-xs text-muted">Reference: {error.digest}</p>
        ) : null}
      </div>
    </main>
  );
}
