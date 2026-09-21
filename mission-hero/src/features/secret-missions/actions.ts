'use server';

import { revalidatePath } from 'next/cache';
import { requireChild } from '@/server/auth/guards';
import { isAppError } from '@/server/errors';
import * as missions from '@/features/secret-missions/service';

export async function discoverSecretMissionAction(missionId: string, surfaceKey: string) {
  const actor = await requireChild();
  try {
    const { mission } = await missions.discover(actor, { missionId, surfaceKey });
    revalidatePath('/kids/home');
    return { mission: { title: mission.title, instructions: mission.instructions } };
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }
}

export async function submitSecretMissionAction(missionId: string, note?: string) {
  const actor = await requireChild();
  try {
    await missions.submit(actor, { missionId, note });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }
  revalidatePath('/kids/home');
  return { error: undefined };
}
