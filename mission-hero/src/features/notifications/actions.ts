'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db/prisma';
import { requireChild, requireParent } from '@/server/auth/guards';
import * as notifications from '@/features/notifications/service';

/**
 * Marking read is scoped by recipient inside the service, so one family member
 * can never clear another's inbox.
 */

export async function markParentInboxReadAction(): Promise<void> {
  const actor = await requireParent();
  await notifications.markAllReadForParent(prisma, actor.userId);
  revalidatePath('/parent/notifications');
  revalidatePath('/parent');
}

export async function markChildInboxReadAction(): Promise<void> {
  const actor = await requireChild();
  await notifications.markAllReadForChild(prisma, actor.childId);
  revalidatePath('/kids/news');
  revalidatePath('/kids/home');
}
