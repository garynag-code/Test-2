import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getParentActor } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import * as notifications from '@/features/notifications/service';
import { logoutAction } from '@/features/auth/actions';
import { APP_NAME } from '@/domain/constants';

/**
 * Parent shell. The guard runs here as well as in every action — middleware
 * only checks that a cookie exists, it cannot verify a signature or a
 * membership row (docs/03 §2).
 */
const NAV = [
  { href: '/parent', label: 'Dashboard' },
  { href: '/parent/approvals', label: 'Approvals' },
  { href: '/parent/tasks', label: 'Missions' },
  { href: '/parent/rewards', label: 'Rewards' },
  { href: '/parent/learning', label: 'Learning' },
  { href: '/parent/children', label: 'Children' },
  { href: '/parent/progress', label: 'Progress' },
  { href: '/parent/settings', label: 'Settings' },
  { href: '/parent/audit', label: 'History' },
];

export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  const actor = await getParentActor();
  if (!actor) redirect('/parent/login');

  const [family, unread] = await Promise.all([
    prisma.family.findUniqueOrThrow({
      where: { id: actor.familyId },
      select: { name: true },
    }),
    notifications.unreadCountForParent(prisma, actor.userId),
  ]);

  return (
    <div className="min-h-dvh bg-surface">
      <header className="sticky top-0 z-10 border-b border-border bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-5 py-3">
          <Link href="/parent" className="font-black text-ink">
            {APP_NAME}
          </Link>
          <div className="flex items-center gap-1">
            <span className="hidden truncate text-sm text-muted sm:inline">{family.name}</span>
            <Link
              href="/parent/notifications"
              className="mh-tap-sm relative flex items-center justify-center rounded-full px-3 text-lg"
            >
              <span aria-hidden>🔔</span>
              <span className="sr-only">Notifications{unread > 0 ? `, ${unread} unread` : ''}</span>
              {unread > 0 ? (
                <span
                  aria-hidden
                  className="absolute right-0 top-1 rounded-full bg-star px-1.5 text-[10px] font-black text-white"
                >
                  {unread > 9 ? '9+' : unread}
                </span>
              ) : null}
            </Link>
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

        <nav aria-label="Sections" className="mx-auto max-w-2xl overflow-x-auto px-5 pb-2">
          <ul className="flex gap-2">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="mh-tap-sm flex items-center whitespace-nowrap rounded-full border-2 border-border px-4 text-sm font-bold text-muted"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-2xl px-5 py-6">
        {children}
      </main>
    </div>
  );
}
