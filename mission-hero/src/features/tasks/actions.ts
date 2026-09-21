'use server';

import { revalidatePath } from 'next/cache';
import { requireChild, requireParent } from '@/server/auth/guards';
import { isAppError } from '@/server/errors';
import { prisma } from '@/server/db/prisma';
import { toLocalDate } from '@/domain/dates';
import * as tasks from '@/features/tasks/service';
import * as approvals from '@/features/approvals/service';

/**
 * Server actions: guard → service → revalidate. No business logic lives here.
 */

export async function submitCompletionAction(occurrenceId: string, evidenceText?: string) {
  const actor = await requireChild();
  await tasks.submitCompletion(actor, { occurrenceId, evidenceText });
  revalidatePath('/kids/home');
}

export async function approveCompletionAction(completionId: string, encouragementMessage?: string) {
  const actor = await requireParent();
  try {
    await approvals.approveTaskCompletion(actor, { completionId, encouragementMessage });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }
  revalidatePath('/parent/approvals');
  revalidatePath('/parent');
  return { error: undefined };
}

export async function rejectCompletionAction(
  completionId: string,
  decision: 'REJECT' | 'REQUEST_REDO' | 'ASK_QUESTION',
  message?: string,
) {
  const actor = await requireParent();
  try {
    await approvals.rejectTaskCompletion(actor, { completionId, decision, message });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }
  revalidatePath('/parent/approvals');
  revalidatePath('/parent');
  return { error: undefined };
}

/** The family-local "today" — every day-bounded rule uses this (BR-18). */
export async function familyToday(familyId: string): Promise<string> {
  const family = await prisma.family.findUniqueOrThrow({
    where: { id: familyId },
    select: { timezone: true },
  });
  return toLocalDate(new Date(), family.timezone);
}
