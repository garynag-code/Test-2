import { z } from 'zod';
import { prisma } from '@/server/db/prisma';
import { conflict, notFound, validation } from '@/server/errors';
import { hashPin } from '@/server/auth/passwords';
import type { Actor } from '@/server/auth/actor';
import {
  FAMILY_CODE_MAX_LENGTH,
  FAMILY_CODE_MIN_LENGTH,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
} from '@/domain/constants';
import { isValidFamilyCodeShape, normaliseFamilyCode } from '@/server/auth/family-code';
import * as audit from '@/features/audit/service';

/**
 * Family and per-child settings (brief §2, Sprint 7).
 *
 * Every change is audited with its before and after values, because these are
 * exactly the switches a parent may later want to account for — particularly
 * the media ones.
 */

export const familySettingsSchema = z.object({
  mediaUploadsEnabled: z.boolean(),
  photoEvidenceEnabled: z.boolean(),
  voiceNotesEnabled: z.boolean(),
  wheelEnabled: z.boolean(),
  secretMissionsEnabled: z.boolean(),
  hiddenObjectsEnabled: z.boolean(),
  soundEnabled: z.boolean(),
  characterVerificationRequired: z.boolean(),
  characterXpPerStar: z.number().int().min(0).max(100),
  checkInXp: z.number().int().min(0).max(100),
  checkInPoints: z.number().int().min(0).max(100),
  weeklyGoalTarget: z.number().int().min(1).max(200),
  parentGateTimeoutMinutes: z.number().int().min(1).max(1440),
});

export type FamilySettingsInput = z.infer<typeof familySettingsSchema>;

export async function updateFamilySettings(actor: Actor, input: FamilySettingsInput) {
  if (actor.type !== 'parent') throw notFound();
  const parsed = familySettingsSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const before = await tx.familySetting.findUnique({ where: { familyId: actor.familyId } });
    if (!before) throw notFound();

    // Photo and voice evidence cannot be on while the master switch is off —
    // otherwise a parent could believe media is disabled when it is not.
    const normalised: FamilySettingsInput = {
      ...parsed,
      photoEvidenceEnabled: parsed.mediaUploadsEnabled && parsed.photoEvidenceEnabled,
      voiceNotesEnabled: parsed.mediaUploadsEnabled && parsed.voiceNotesEnabled,
    };

    const after = await tx.familySetting.update({
      where: { familyId: actor.familyId },
      data: normalised,
    });

    await audit.record(tx, {
      actor,
      action: 'FAMILY_SETTINGS_CHANGED',
      entityType: 'FamilySetting',
      entityId: after.id,
      before: pickSettings(before),
      after: pickSettings(after),
    });

    return after;
  });
}

type SettingsRow = Record<string, unknown>;

function pickSettings(row: SettingsRow) {
  const keys = Object.keys(familySettingsSchema.shape);
  return Object.fromEntries(keys.map((key) => [key, row[key]]));
}

export const familyCodeSchema = z.object({
  familyCode: z.string().trim().min(1),
});

/**
 * The family's own code, chosen rather than inherited.
 *
 * Generated codes are unguessable and unmemorable, which is the right trade
 * for a random string and the wrong one for something a child types every
 * time they pick up a shared tablet. A family that would rather use its own
 * name should be able to.
 *
 * Owner only, like the other things that change what the whole family sees.
 * Changing it does not sign anybody out: a device is bound by family id, not
 * by the code it was typed in with.
 */
export async function updateFamilyCode(actor: Actor, input: { familyCode: string }) {
  if (actor.type !== 'parent' || actor.role !== 'OWNER') throw notFound();
  const parsed = familyCodeSchema.parse(input);
  const familyCode = normaliseFamilyCode(parsed.familyCode);

  if (!isValidFamilyCodeShape(familyCode)) {
    throw validation(
      `A family code is ${FAMILY_CODE_MIN_LENGTH} to ${FAMILY_CODE_MAX_LENGTH} letters and numbers.`,
    );
  }

  const taken = await prisma.family.findUnique({
    where: { familyCode },
    select: { id: true },
  });
  if (taken && taken.id !== actor.familyId) {
    throw conflict('Another family is already using that code. Try a different one.');
  }

  return prisma.$transaction(async (tx) => {
    const before = await tx.family.findUniqueOrThrow({
      where: { id: actor.familyId },
      select: { id: true, familyCode: true },
    });

    const after = await tx.family.update({
      where: { id: before.id },
      data: { familyCode },
      select: { id: true, familyCode: true },
    });

    await audit.record(tx, {
      actor,
      action: 'FAMILY_SETTINGS_CHANGED',
      entityType: 'Family',
      entityId: after.id,
      before: { familyCode: before.familyCode },
      after: { familyCode: after.familyCode },
    });

    return after;
  });
}

export const displayNameSchema = z.object({
  displayName: z.string().trim().min(1).max(60),
});

/**
 * A grown-up renaming themselves.
 *
 * The name is chosen once at registration and was not editable afterwards,
 * which is a long time to live with a typo — and the name is what a child
 * sees on every approval and word of encouragement.
 *
 * Scoped to the signed-in user: a parent changes their own name, never
 * another member's, so there is no id to pass and nothing to authorize
 * beyond the session itself.
 */
export async function updateDisplayName(actor: Actor, input: { displayName: string }) {
  if (actor.type !== 'parent') throw notFound();
  const parsed = displayNameSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({
      where: { id: actor.userId },
      select: { id: true, displayName: true },
    });
    if (!before) throw notFound();

    const after = await tx.user.update({
      where: { id: before.id },
      data: { displayName: parsed.displayName },
      select: { id: true, displayName: true },
    });

    await audit.record(tx, {
      actor,
      action: 'PARENT_PROFILE_UPDATED',
      entityType: 'User',
      entityId: after.id,
      before: { displayName: before.displayName },
      after: { displayName: after.displayName },
    });

    return after;
  });
}

export const childSettingsSchema = z.object({
  childId: z.string().uuid(),
  nickname: z.string().trim().min(1).max(30),
  avatarKey: z.string().trim().max(30),
  themeKey: z.string().trim().max(30),
  reducedMotion: z.boolean(),
  characterAutoApprove: z.boolean(),
  dailyTaskTarget: z.number().int().min(1).max(20),
  notificationsEnabled: z.boolean(),
  soundEnabled: z.boolean(),
});

export type ChildSettingsInput = z.infer<typeof childSettingsSchema>;

export async function updateChildSettings(actor: Actor, input: ChildSettingsInput) {
  if (actor.type !== 'parent') throw notFound();
  const parsed = childSettingsSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const child = await tx.childProfile.findFirst({
      where: { id: parsed.childId, familyId: actor.familyId, deletedAt: null },
      include: { setting: true },
    });
    if (!child) throw notFound();

    await tx.childProfile.update({
      where: { id: child.id },
      data: {
        nickname: parsed.nickname,
        avatarKey: parsed.avatarKey,
        themeKey: parsed.themeKey,
      },
    });

    await tx.childSetting.upsert({
      where: { childId: child.id },
      create: {
        childId: child.id,
        reducedMotion: parsed.reducedMotion,
        characterAutoApprove: parsed.characterAutoApprove,
        dailyTaskTarget: parsed.dailyTaskTarget,
        notificationsEnabled: parsed.notificationsEnabled,
        soundEnabled: parsed.soundEnabled,
      },
      update: {
        reducedMotion: parsed.reducedMotion,
        characterAutoApprove: parsed.characterAutoApprove,
        dailyTaskTarget: parsed.dailyTaskTarget,
        notificationsEnabled: parsed.notificationsEnabled,
        soundEnabled: parsed.soundEnabled,
      },
    });

    await audit.record(tx, {
      actor,
      action: 'SETTINGS_CHANGED',
      entityType: 'ChildProfile',
      entityId: child.id,
      before: { nickname: child.nickname, themeKey: child.themeKey, setting: child.setting },
      after: { nickname: parsed.nickname, themeKey: parsed.themeKey },
    });
  });
}

/** Sets or clears a child's PIN. Never logs or returns the PIN itself. */
export async function setChildPin(actor: Actor, input: { childId: string; pin: string | null }) {
  if (actor.type !== 'parent') throw notFound();

  const child = await prisma.childProfile.findFirst({
    where: { id: input.childId, familyId: actor.familyId, deletedAt: null },
    select: { id: true, pinRequired: true },
  });
  if (!child) throw notFound();

  if (input.pin && !new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(input.pin)) {
    throw notFound(`A PIN must be ${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} digits.`);
  }

  const pinHash = input.pin ? await hashPin(input.pin) : null;

  return prisma.$transaction(async (tx) => {
    await tx.childProfile.update({
      where: { id: child.id },
      data: {
        pinHash,
        pinRequired: Boolean(pinHash),
        // Setting or clearing a PIN also lifts any lockout.
        pinFailedAttempts: 0,
        pinLockedUntil: null,
      },
    });
    await tx.childSetting.updateMany({
      where: { childId: child.id },
      data: { pinRequired: Boolean(pinHash) },
    });

    await audit.record(tx, {
      actor,
      action: 'PIN_CHANGED',
      entityType: 'ChildProfile',
      entityId: child.id,
      before: { pinRequired: child.pinRequired },
      after: { pinRequired: Boolean(pinHash) },
    });
  });
}

/** Archiving hides a child from the app without destroying their history. */
export async function setChildStatus(
  actor: Actor,
  input: { childId: string; status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED' },
) {
  if (actor.type !== 'parent') throw notFound();

  const child = await prisma.childProfile.findFirst({
    where: { id: input.childId, familyId: actor.familyId, deletedAt: null },
    select: { id: true, status: true, nickname: true },
  });
  if (!child) throw notFound();

  return prisma.$transaction(async (tx) => {
    await tx.childProfile.update({ where: { id: child.id }, data: { status: input.status } });
    await audit.record(tx, {
      actor,
      action: input.status === 'ARCHIVED' ? 'CHILD_ARCHIVED' : 'CHILD_UPDATED',
      entityType: 'ChildProfile',
      entityId: child.id,
      before: { status: child.status },
      after: { status: input.status },
    });
  });
}

export async function getChildSettings(actor: Actor) {
  if (actor.type !== 'parent') throw notFound();
  return prisma.childProfile.findMany({
    where: { familyId: actor.familyId, deletedAt: null },
    include: { setting: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}
