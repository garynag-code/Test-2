'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireParent } from '@/server/auth/guards';
import { isAppError } from '@/server/errors';
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '@/domain/constants';
import * as children from '@/features/children/service';

export type ActionState = { error?: string; ok?: boolean } | undefined;

const createChildSchema = z.object({
  nickname: z.string().trim().min(1, 'Give your hero a name').max(30),
  ageBracket: z.enum(['AGE_6_8', 'AGE_9_11', 'AGE_12_14']),
  avatarKey: z.string().trim().max(30).default('hero-1'),
  themeKey: z.string().trim().max(30).default('space'),
  // Optional: a PIN is a choice, not a requirement (docs/03 §5).
  pin: z
    .string()
    .trim()
    .regex(
      new RegExp(`^(\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}})?$`),
      `A PIN is ${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} digits`,
    )
    .optional(),
});

export async function createChildAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireParent();
  const parsed = createChildSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check those details' };

  try {
    await children.createChild(actor, {
      nickname: parsed.data.nickname,
      ageBracket: parsed.data.ageBracket,
      avatarKey: parsed.data.avatarKey,
      themeKey: parsed.data.themeKey,
      ...(parsed.data.pin ? { pin: parsed.data.pin } : {}),
    });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    // A duplicate nickname is the one realistic failure here.
    return { error: 'Could not add that hero. Is the name already taken?' };
  }

  revalidatePath('/parent/children');
  revalidatePath('/parent');
  return { ok: true };
}
