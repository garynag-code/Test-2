'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireChild, requireParent } from '@/server/auth/guards';
import { isAppError } from '@/server/errors';
import * as rewards from '@/features/rewards/service';

export type ActionState = { error?: string; ok?: boolean } | undefined;

export async function redeemRewardAction(rewardId: string) {
  const actor = await requireChild();
  try {
    const { redemption } = await rewards.redeem(actor, { rewardId });
    revalidatePath('/kids/rewards');
    revalidatePath('/kids/home');
    return { needsApproval: redemption.status === 'PENDING' };
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }
}

export async function resolveRedemptionAction(
  redemptionId: string,
  approve: boolean,
  note?: string,
) {
  const actor = await requireParent();
  try {
    await rewards.resolveRedemption(actor, { redemptionId, approve, note });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }
  revalidatePath('/parent');
  return { error: undefined };
}

const createRewardFormSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  type: z.enum([
    'EXPERIENCE',
    'PHYSICAL',
    'PRIVILEGE',
    'SCREEN_TIME',
    'POCKET_MONEY',
    'FOOD',
    'PARENT_TIME',
    'DIGITAL',
    'CUSTOM',
  ]),
  pointsCost: z.coerce.number(),
  inventoryQuantity: z.string().optional(),
  requiresParentApproval: z.string().optional(),
});

export async function createRewardAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireParent();
  const parsed = createRewardFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check those details' };

  try {
    await rewards.createReward(actor, {
      name: parsed.data.name,
      description: parsed.data.description || undefined,
      type: parsed.data.type,
      pointsCost: parsed.data.pointsCost,
      // An empty field means unlimited, which is different from zero in stock.
      inventoryQuantity: parsed.data.inventoryQuantity
        ? Number(parsed.data.inventoryQuantity)
        : null,
      requiresParentApproval: parsed.data.requiresParentApproval === 'on',
      iconKey: 'gift',
    });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }

  revalidatePath('/parent/rewards');
  return { ok: true };
}
