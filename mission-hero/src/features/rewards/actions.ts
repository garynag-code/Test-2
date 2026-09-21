'use server';

import { revalidatePath } from 'next/cache';
import { requireChild, requireParent } from '@/server/auth/guards';
import { isAppError } from '@/server/errors';
import * as rewards from '@/features/rewards/service';

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
