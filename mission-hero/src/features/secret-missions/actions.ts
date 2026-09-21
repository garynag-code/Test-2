'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireChild, requireParent } from '@/server/auth/guards';
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
  revalidatePath('/kids/quests');
  revalidatePath('/kids/home');
  return { error: undefined };
}

export async function approveQuestAction(submissionId: string) {
  const actor = await requireParent();
  try {
    await missions.approve(actor, { submissionId });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }
  revalidatePath('/parent/approvals');
  revalidatePath('/parent');
  return { error: undefined };
}

export async function declineQuestAction(submissionId: string, message?: string) {
  const actor = await requireParent();
  try {
    await missions.declineQuest(actor, { submissionId, message });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }
  revalidatePath('/parent/approvals');
  return { error: undefined };
}

const createQuestFormSchema = z.object({
  title: z.string(),
  instructions: z.string(),
  rarity: z.enum(['COMMON', 'RARE', 'EPIC', 'LEGENDARY']),
  kind: z.enum(['SECRET', 'BONUS']),
  xpValue: z.coerce.number(),
  rewardPointsValue: z.coerce.number(),
  characterTraitId: z.string().optional(),
  hiddenObjectKey: z.string().optional(),
});

export type ActionState = { error?: string; ok?: boolean } | undefined;

export async function createQuestAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireParent();
  const parsed = createQuestFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check those details' };

  const requiresDiscovery = parsed.data.kind === 'SECRET';

  try {
    await missions.createMission(actor, {
      title: parsed.data.title,
      instructions: parsed.data.instructions,
      rarity: parsed.data.rarity,
      requiresDiscovery,
      xpValue: parsed.data.xpValue,
      rewardPointsValue: parsed.data.rewardPointsValue,
      characterTraitId: parsed.data.characterTraitId || undefined,
      // A trait-bearing quest is worth one star; the amount is not the
      // parent's to type, for the same reason approvals carry no amounts.
      starValue: parsed.data.characterTraitId ? 1 : 0,
      grantsWheelSpin: false,
      hiddenObjectKey: requiresDiscovery ? parsed.data.hiddenObjectKey || 'chest' : 'none',
    });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }

  revalidatePath('/parent/learning');
  return { ok: true };
}
