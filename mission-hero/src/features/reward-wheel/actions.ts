'use server';

import { revalidatePath } from 'next/cache';
import { requireChild } from '@/server/auth/guards';
import { isAppError } from '@/server/errors';
import type { LocalDate } from '@/domain/dates';
import * as wheel from '@/features/reward-wheel/service';
import type { SpinResult } from '@/features/reward-wheel/types';
import { familyToday } from '@/features/tasks/actions';

/**
 * The spin action sends nothing but a wheel id. The outcome comes back from
 * the server already persisted (BR-45/46).
 */
export async function spinAction(
  wheelId: string,
): Promise<{ result?: SpinResult; error?: string }> {
  const actor = await requireChild();
  try {
    const result = await wheel.spin(actor, {
      wheelId,
      today: (await familyToday(actor.familyId)) as LocalDate,
    });
    revalidatePath('/kids/wheel');
    revalidatePath('/kids/home');
    return { result };
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }
}

export async function markSpinRevealedAction(spinId: string): Promise<void> {
  const actor = await requireChild();
  await wheel.markRevealed(actor, spinId);
}
