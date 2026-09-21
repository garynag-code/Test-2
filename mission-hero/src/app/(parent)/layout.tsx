import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getParentActor } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { logoutAction } from '@/features/auth/actions';
import { APP_NAME } from '@/domain/constants';

/**
 * Parent shell. The guard runs here as well as in every action — middleware
 * only checks that a cookie exists, it cannot verify a signature or a
 * membership row (docs/03 §2).
 */
export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  const actor = await getParentActor();
  if (!actor) redirect('/parent/login');

  const family = await prisma.family.findUniqueOrThrow({
    where: { id: actor.familyId },
    select: { name: true },
  });

  return (
    <div className="min-h-dvh bg-surface">
      <header className="sticky top-0 z-10 border-b border-border bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-5 py-3">
          <Link href="/parent" className="font-black text-ink">
            {APP_NAME}
          </Link>
          <div className="flex items-center gap-3">
            <span className="truncate text-sm text-muted">{family.name}</span>
            <form action={logoutAction}>
              <button
                type="submit"
                className="mh-tap-sm rounded-full px-3 text-sm font-semibold text-muted"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-2xl px-5 py-6">
        {children}
      </main>
    </div>
  );
}
