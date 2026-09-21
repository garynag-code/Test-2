'use server';

import { revalidatePath } from 'next/cache';
import { requireChild, requireParent } from '@/server/auth/guards';
import { isAppError } from '@/server/errors';
import * as character from '@/features/character/service';
import { familyToday } from '@/features/tasks/actions';

export async function submitCharacterAction(traitId: string, story: string) {
  const actor = await requireChild();
  try {
    await character.submitCharacterMoment(actor, {
      traitId,
      story,
      localDate: (await familyToday(actor.familyId)) as `${number}-${number}-${number}`,
    });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }
  revalidatePath('/kids/character');
  revalidatePath('/kids/home');
  return { error: undefined };
}

export async function confirmCharacterAction(submissionId: string, encouragementMessage?: string) {
  const actor = await requireParent();
  try {
    await character.confirmCharacterMoment(actor, { submissionId, encouragementMessage });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }
  revalidatePath('/parent/approvals');
  revalidatePath('/parent');
  return { error: undefined };
}

export async function declineCharacterAction(submissionId: string, message?: string) {
  const actor = await requireParent();
  try {
    await character.declineCharacterMoment(actor, {
      submissionId,
      decision: 'ASK_QUESTION',
      message,
    });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }
  revalidatePath('/parent/approvals');
  return { error: undefined };
}
