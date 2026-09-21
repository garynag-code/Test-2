import Link from 'next/link';
import { getChildActor } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';

/**
 * Child shell. The theme is applied as a data attribute so the CSS variables in
 * globals.css repaint everything without any component knowing about themes.
 */
export default async function KidLayout({ children }: { children: React.ReactNode }) {
  const actor = await getChildActor();
  const profile = actor
    ? await prisma.childProfile.findUnique({
        where: { id: actor.childId },
        select: { themeKey: true },
      })
    : null;

  return (
    <div data-theme={profile?.themeKey ?? 'space'} className="min-h-dvh bg-surface">
      {children}
      {actor ? <TabBar /> : null}
    </div>
  );
}

const TABS = [
  { href: '/kids/home', label: 'Home', icon: '🏠' },
  { href: '/kids/character', label: 'Character', icon: '❤️' },
  { href: '/kids/wheel', label: 'Wheel', icon: '🎡' },
  { href: '/kids/rewards', label: 'Rewards', icon: '🎁' },
  { href: '/kids/me', label: 'Me', icon: '🦸' },
];

function TabBar() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto flex max-w-md">
        {TABS.map((tab) => (
          <li key={tab.href} className="flex-1">
            <Link
              href={tab.href}
              className="mh-tap flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-bold text-muted"
            >
              <span aria-hidden className="text-xl">
                {tab.icon}
              </span>
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
