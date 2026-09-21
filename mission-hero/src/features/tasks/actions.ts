'use server';

import { revalidatePath } from 'next/cache';
import { requireChild, requireParent } from '@/server/auth/guards';
import { isAppError } from '@/server/errors';
import { prisma } from '@/server/db/prisma';
import { toLocalDate } from '@/domain/dates';
import { z } from 'zod';
import { createTaskSchema } from '@/features/tasks/schemas';
import * as tasks from '@/features/tasks/service';
import * as approvals from '@/features/approvals/service';

export type ActionState = { error?: string; ok?: boolean } | undefined;

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

/**
 * Creating a task from the parent form.
 *
 * The form sends strings, so this action's job is to coerce them into the
 * shape `createTaskSchema` already validates — the point values and the
 * child list are still checked against the actor's own family in the service.
 */
const formSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  categoryKey: z.string().optional(),
  iconKey: z.string().optional(),
  xpValue: z.coerce.number(),
  rewardPointsValue: z.coerce.number(),
  characterTraitId: z.string().optional(),
  characterStarValue: z.coerce.number().optional(),
  evidenceType: z.enum(['NONE', 'PHOTO', 'NOTE', 'VOICE', 'PARENT_CONFIRM']).optional(),
  difficulty: z.enum(['EASY', 'STANDARD', 'CHALLENGING', 'EPIC']).optional(),
  frequency: z.string(),
  startDate: z.string(),
  dueTime: z.string().optional(),
});

export async function createTaskAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireParent();

  const raw = Object.fromEntries(formData);
  const parsedForm = formSchema.safeParse(raw);
  if (!parsedForm.success) {
    return { error: parsedForm.error.issues[0]?.message ?? 'Check those details' };
  }

  const childIds = formData.getAll('childIds').map(String).filter(Boolean);
  const weekdays = formData.getAll('weekdays').map((value) => Number(value));

  const input = {
    title: parsedForm.data.title,
    description: parsedForm.data.description || undefined,
    categoryKey: parsedForm.data.categoryKey || undefined,
    iconKey: parsedForm.data.iconKey || 'target',
    colorKey: 'brand',
    xpValue: parsedForm.data.xpValue,
    rewardPointsValue: parsedForm.data.rewardPointsValue,
    characterTraitId: parsedForm.data.characterTraitId || undefined,
    characterStarValue: parsedForm.data.characterTraitId
      ? (parsedForm.data.characterStarValue ?? 1)
      : 0,
    difficulty: parsedForm.data.difficulty ?? 'STANDARD',
    evidenceType: parsedForm.data.evidenceType ?? 'NONE',
    approvalRequired: true,
    streakEligible: true,
    isFamilyTask: childIds.length > 1,
    childIds,
    schedule: {
      frequency: parsedForm.data.frequency,
      interval: 1,
      weekdays,
      startDate: parsedForm.data.startDate,
      dueTime: parsedForm.data.dueTime || null,
    },
  };

  const validated = createTaskSchema.safeParse(input);
  if (!validated.success) {
    return { error: validated.error.issues[0]?.message ?? 'Check those details' };
  }

  try {
    await tasks.createTask(actor, validated.data);
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }

  revalidatePath('/parent/tasks');
  revalidatePath('/parent');
  return { ok: true };
}
