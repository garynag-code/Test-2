import Link from 'next/link';
import { Card, EmptyState } from '@/components/ui/card';
import { relativeTime } from '@/lib/utils';
import { cn } from '@/lib/utils';

export interface NotificationView {
  id: string;
  kind: string;
  title: string;
  body: string;
  deepLink: string | null;
  readAt: Date | null;
  createdAt: Date;
}

const ICONS: Record<string, string> = {
  TASK_SUBMITTED: '📥',
  TASK_APPROVED: '✅',
  TASK_REJECTED: '🔁',
  CHARACTER_SUBMITTED: '❤️',
  CHARACTER_CONFIRMED: '⭐',
  MEMORY_SUBMITTED: '📜',
  MEMORY_APPROVED: '🧠',
  WHEEL_UNLOCKED: '🎡',
  WHEEL_SPUN: '🎉',
  REWARD_REQUESTED: '🎁',
  REWARD_FULFILLED: '🎀',
  BADGE_UNLOCKED: '🏅',
  ACHIEVEMENT_UNLOCKED: '🏆',
  LEVEL_UP: '⬆️',
  STREAK_MILESTONE: '🔥',
  SECRET_MISSION_FOUND: '🗝️',
  ENCOURAGEMENT: '💬',
};

export function NotificationList({
  notifications,
  emptyTitle,
  emptyHint,
}: {
  notifications: NotificationView[];
  emptyTitle: string;
  emptyHint?: string;
}) {
  if (notifications.length === 0) {
    return <EmptyState icon="🔔" title={emptyTitle} hint={emptyHint} />;
  }

  return (
    <ul className="space-y-2">
      {notifications.map((item) => {
        const content = (
          <Card
            className={cn(
              'flex items-start gap-3',
              // Unread is marked by weight and a dot, not by colour alone.
              item.readAt ? 'opacity-80' : 'border-brand/40',
            )}
          >
            <span aria-hidden className="text-2xl">
              {ICONS[item.kind] ?? '🔔'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span
                  className={cn('block truncate', item.readAt ? 'font-semibold' : 'font-extrabold')}
                >
                  {item.title}
                </span>
                {item.readAt ? null : (
                  <>
                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-brand" />
                    <span className="sr-only">Unread</span>
                  </>
                )}
              </span>
              <span className="block text-sm text-muted">{item.body}</span>
              <span className="block text-xs text-muted">{relativeTime(item.createdAt)}</span>
            </span>
          </Card>
        );

        return (
          <li key={item.id}>
            {item.deepLink ? (
              <Link href={item.deepLink} className="block">
                {content}
              </Link>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ul>
  );
}
