import Link from 'next/link';

/**
 * Also the response to "that isn't yours" (BR-58) — a missing thing and a
 * forbidden one look identical from out here, on purpose.
 */
export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-surface px-5">
      <div className="w-full max-w-sm text-center">
        <p aria-hidden className="text-5xl">
          🧭
        </p>
        <h1 className="mt-3 text-2xl font-black text-ink">We couldn&apos;t find that</h1>
        <p className="mt-2 text-muted">The page may have moved, or it may not be yours to see.</p>
        <Link
          href="/"
          className="mh-tap mh-gradient mt-6 flex w-full items-center justify-center rounded-full font-extrabold text-white"
        >
          Back to the start
        </Link>
      </div>
    </main>
  );
}
