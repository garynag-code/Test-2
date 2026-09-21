import { requireChild } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import * as notifications from '@/features/notifications/service';
import { NotificationList } from '@/components/ui/notification-list';
import { MarkReadButton } from '@/components/ui/mark-read-button';
import { markChildInboxReadAction } from '@/features/notifications/actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'News' };

export default async function KidNewsPage() {
  const actor = await requireChild();
  const [items, unread] = await Promise.all([
    notifications.listForChild(prisma, actor.childId),
    notifications.unreadCountForChild(prisma, actor.childId),
  ]);

  return (
    <div className="pb-24">
      <header className="mh-gradient px-5 pb-8 pt-8 text-white">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black">Your News</h1>
            <p className="mt-1 font-semibold text-white/90">
              {unread > 0 ? `${unread} new` : 'All caught up'}
            </p>
          </div>
          {unread > 0 ? <MarkReadButton action={markChildInboxReadAction} onDark /> : null}
        </div>
      </header>

      <div className="mx-auto max-w-md px-5 py-6">
        <NotificationList
          notifications={items}
          emptyTitle="Nothing here yet"
          emptyHint="Approvals and unlocks will show up here."
        />
      </div>
    </div>
  );
}
