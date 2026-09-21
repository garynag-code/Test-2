import { requireParent } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import * as notifications from '@/features/notifications/service';
import { NotificationList } from '@/components/ui/notification-list';
import { MarkReadButton } from '@/components/ui/mark-read-button';
import { markParentInboxReadAction } from '@/features/notifications/actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notifications' };

export default async function ParentNotificationsPage() {
  const actor = await requireParent();
  const [items, unread] = await Promise.all([
    notifications.listForParent(prisma, actor.userId),
    notifications.unreadCountForParent(prisma, actor.userId),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-ink">Notifications</h1>
          <p className="text-sm text-muted">{unread > 0 ? `${unread} unread` : 'All caught up'}</p>
        </div>
        {unread > 0 ? <MarkReadButton action={markParentInboxReadAction} /> : null}
      </div>

      <NotificationList
        notifications={items}
        emptyTitle="Nothing here yet"
        emptyHint="Submissions and unlocks will appear here."
      />
    </div>
  );
}
