'use server';

import { revalidatePath } from 'next/cache';
import { requireChild } from '@/server/auth/guards';
import { isAppError } from '@/server/errors';
import type { LocalDate } from '@/domain/dates';
import * as checkIns from '@/features/check-ins/service';
import { familyToday } from '@/features/tasks/actions';
import type { CheckInResult } from '@/features/check-ins/service';

export async function checkInAction(input: {
  mood?: string;
  goalText?: string;
  gratitudeText?: string;
}): Promise<{ result?: CheckInResult; error?: string }> {
  const actor = await requireChild();
  try {
    const result = await checkIns.checkIn(actor, {
      ...input,
      localDate: (await familyToday(actor.familyId)) as LocalDate,
    });
    revalidatePath('/kids/check-in');
    revalidatePath('/kids/home');
    return { result };
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }
}
