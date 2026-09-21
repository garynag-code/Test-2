'use server';

import { revalidatePath } from 'next/cache';
import { requireChild } from '@/server/auth/guards';
import { isAppError } from '@/server/errors';
import * as collectibles from '@/features/collectibles/service';

export async function equipItemAction(avatarItemId: string) {
  const actor = await requireChild();
  try {
    const result = await collectibles.equipItem(actor, avatarItemId);
    revalidatePath('/kids/me');
    revalidatePath('/kids/home');
    return { equipped: result.equipped };
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }
}
