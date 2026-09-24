'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireParent } from '@/server/auth/guards';
import { isAppError } from '@/server/errors';
import { endParentSession, startParentSession } from '@/server/auth/session';
import * as settings from '@/features/families/settings';
import * as familyData from '@/features/families/data';
import * as invites from '@/features/families/invites';
import * as approvals from '@/features/approvals/service';

export type ActionState = { error?: string; ok?: boolean } | undefined;

const toBool = (value: FormDataEntryValue | null) => value === 'on' || value === 'true';

export async function updateFamilySettingsAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireParent();
  try {
    await settings.updateFamilySettings(actor, {
      mediaUploadsEnabled: toBool(formData.get('mediaUploadsEnabled')),
      photoEvidenceEnabled: toBool(formData.get('photoEvidenceEnabled')),
      voiceNotesEnabled: toBool(formData.get('voiceNotesEnabled')),
      wheelEnabled: toBool(formData.get('wheelEnabled')),
      secretMissionsEnabled: toBool(formData.get('secretMissionsEnabled')),
      hiddenObjectsEnabled: toBool(formData.get('hiddenObjectsEnabled')),
      soundEnabled: toBool(formData.get('soundEnabled')),
      characterVerificationRequired: toBool(formData.get('characterVerificationRequired')),
      characterXpPerStar: Number(formData.get('characterXpPerStar') ?? 0),
      checkInXp: Number(formData.get('checkInXp') ?? 0),
      checkInPoints: Number(formData.get('checkInPoints') ?? 0),
      weeklyGoalTarget: Number(formData.get('weeklyGoalTarget') ?? 25),
      parentGateTimeoutMinutes: Number(formData.get('parentGateTimeoutMinutes') ?? 30),
    });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    return { error: 'Those settings could not be saved.' };
  }
  revalidatePath('/parent/settings');
  return { ok: true };
}

export async function updateChildSettingsAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireParent();
  try {
    await settings.updateChildSettings(actor, {
      childId: String(formData.get('childId') ?? ''),
      nickname: String(formData.get('nickname') ?? ''),
      avatarKey: String(formData.get('avatarKey') ?? 'hero-1'),
      themeKey: String(formData.get('themeKey') ?? 'space'),
      reducedMotion: toBool(formData.get('reducedMotion')),
      characterAutoApprove: toBool(formData.get('characterAutoApprove')),
      dailyTaskTarget: Number(formData.get('dailyTaskTarget') ?? 4),
      notificationsEnabled: toBool(formData.get('notificationsEnabled')),
      soundEnabled: toBool(formData.get('soundEnabled')),
    });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    return { error: 'Those settings could not be saved.' };
  }
  revalidatePath('/parent/settings');
  return { ok: true };
}

export async function updateDisplayNameAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireParent();
  try {
    await settings.updateDisplayName(actor, {
      displayName: String(formData.get('displayName') ?? ''),
    });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    return { error: 'That name could not be saved.' };
  }
  revalidatePath('/parent/settings');
  return { ok: true };
}

export async function setChildPinAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireParent();
  const pin = String(formData.get('pin') ?? '').trim();
  try {
    await settings.setChildPin(actor, {
      childId: String(formData.get('childId') ?? ''),
      pin: pin || null,
    });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }
  revalidatePath('/parent/settings');
  return { ok: true };
}

export async function setChildStatusAction(
  childId: string,
  status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED',
) {
  const actor = await requireParent();
  try {
    await settings.setChildStatus(actor, { childId, status });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }
  revalidatePath('/parent/settings');
  revalidatePath('/parent/children');
  return { error: undefined };
}

const bonusSchema = z.object({
  childId: z.string().uuid(),
  xp: z.coerce.number(),
  points: z.coerce.number(),
  traitId: z.string().optional(),
  stars: z.coerce.number(),
  reason: z.string(),
});

/** A deliberate manual award. Always audited, and always requires a reason. */
export async function awardBonusAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireParent();
  const parsed = bonusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check those details' };

  try {
    await approvals.awardBonus(actor, {
      childId: parsed.data.childId,
      xp: parsed.data.xp,
      points: parsed.data.points,
      traitId: parsed.data.traitId || undefined,
      stars: parsed.data.traitId ? parsed.data.stars : 0,
      reason: parsed.data.reason,
    });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }

  revalidatePath('/parent/progress');
  revalidatePath('/parent');
  return { ok: true };
}

export async function inviteParentAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireParent();
  const email = String(formData.get('email') ?? '');
  if (!z.string().email().safeParse(email).success) return { error: 'Enter a valid email address' };

  try {
    await invites.inviteParent(actor, {
      email,
      role: formData.get('role') === 'GUARDIAN' ? 'GUARDIAN' : 'PARENT',
    });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }
  revalidatePath('/parent/settings');
  return { ok: true };
}

export async function revokeInviteAction(inviteId: string) {
  const actor = await requireParent();
  await invites.revokeInvite(actor, inviteId);
  revalidatePath('/parent/settings');
}

const acceptSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(10, 'Use at least 10 characters'),
  displayName: z.string().trim().min(1, 'Tell us your name').max(60),
  parentNickname: z.string().trim().max(30).optional(),
});

export async function acceptInviteAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = acceptSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check those details' };

  try {
    const result = await invites.acceptInvite(parsed.data);
    await startParentSession(result.userId, result.familyId);
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }
  redirect('/parent');
}

/**
 * Permanent deletion. Requires the owner's password and the family name typed
 * exactly, because nothing about this is recoverable.
 */
export async function deleteFamilyAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireParent();
  try {
    await familyData.deleteFamily(actor, {
      password: String(formData.get('password') ?? ''),
      confirmation: String(formData.get('confirmation') ?? ''),
    });
  } catch (error) {
    if (isAppError(error)) return { error: error.publicMessage };
    throw error;
  }
  await endParentSession();
  redirect('/');
}
