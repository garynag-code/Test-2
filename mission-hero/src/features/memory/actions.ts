'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireChild, requireParent } from '@/server/auth/guards';
import { isAppError } from '@/server/errors';
import * as memory from '@/features/memory/service';

export async function reciteAction(challengeId: string, recitedText: string) {
  const actor = await requireChild();
  try {
    await memory.recite(actor, { challengeId, recitedText });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }
  revalidatePath('/kids/memory');
  return { error: undefined };
}

export async function approveMemoryAction(submissionId: string, encouragementMessage?: string) {
  const actor = await requireParent();
  try {
    await memory.approve(actor, { submissionId, encouragementMessage });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }
  revalidatePath('/parent/approvals');
  revalidatePath('/parent');
  return { error: undefined };
}

export async function declineMemoryAction(submissionId: string, message?: string) {
  const actor = await requireParent();
  try {
    await memory.decline(actor, { submissionId, message });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }
  revalidatePath('/parent/approvals');
  return { error: undefined };
}

const createChallengeFormSchema = z.object({
  title: z.string(),
  category: z.enum([
    'BIBLE_VERSE',
    'QUOTE',
    'AFFIRMATION',
    'FAMILY_SAYING',
    'SLOGAN',
    'VOCABULARY',
    'SCHOOL_FACT',
    'CUSTOM',
  ]),
  reference: z.string().optional(),
  bodyText: z.string(),
  xpValue: z.coerce.number(),
  rewardPointsValue: z.coerce.number(),
});

export type ActionState = { error?: string; ok?: boolean } | undefined;

export async function createChallengeAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireParent();
  const parsed = createChallengeFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check those details' };

  const childIds = formData.getAll('childIds').map(String).filter(Boolean);
  if (childIds.length === 0) return { error: 'Pick at least one hero' };

  try {
    await memory.createChallenge(actor, {
      title: parsed.data.title,
      category: parsed.data.category,
      reference: parsed.data.reference || undefined,
      bodyText: parsed.data.bodyText,
      xpValue: parsed.data.xpValue,
      rewardPointsValue: parsed.data.rewardPointsValue,
      verificationType: 'TYPED',
      childIds,
    });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }

  revalidatePath('/parent/learning');
  return { ok: true };
}
