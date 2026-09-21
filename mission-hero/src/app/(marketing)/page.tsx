import Link from 'next/link';
import { APP_NAME, APP_TAGLINE } from '@/domain/constants';

/**
 * The role chooser. Deliberately the only public page in the product — every
 * other route requires a session.
 */
export default function LandingPage() {
  return (
    <main id="main" className="mh-gradient min-h-dvh px-5 py-10 text-white">
      <div className="mx-auto flex min-h-[80dvh] max-w-md flex-col justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-white/70">Welcome to</p>
          <h1 className="mt-2 text-5xl font-black leading-none">{APP_NAME}</h1>
          <p className="mt-3 text-lg font-semibold text-white/90">{APP_TAGLINE}</p>
          <p className="mt-6 max-w-sm text-white/80">
            Real missions. Real character. Real rewards your family chooses together.
          </p>
        </div>

        <div className="mt-10 space-y-3">
          <Link
            href="/kids"
            className="mh-tap flex w-full items-center justify-center gap-3 rounded-full bg-white px-6 text-lg font-extrabold text-brand shadow-pop"
          >
            <span aria-hidden>🦸</span> I&apos;m a hero
          </Link>
          <Link
            href="/parent/login"
            className="mh-tap flex w-full items-center justify-center gap-3 rounded-full border-2 border-white/60 px-6 text-lg font-bold text-white"
          >
            <span aria-hidden>👋</span> I&apos;m a grown-up
          </Link>
          <p className="pt-4 text-center text-sm text-white/70">
            New here?{' '}
            <Link href="/parent/register" className="font-bold underline">
              Create your family
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
