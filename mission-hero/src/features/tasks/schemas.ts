import { z } from 'zod';
import { MAX_NOTE_LENGTH, MAX_TITLE_LENGTH } from '@/domain/constants';

/**
 * Input schemas are explicit allow-lists (docs/03 §2).
 *
 * Note what is *absent*: no familyId, no childId the caller could forge on a
 * submission, and on the approval side no point values at all. Zod strips
 * unknown keys, so an extra `xpValue` in a request body is silently discarded
 * rather than honoured (BR-13).
 */

export const recurrenceFrequencySchema = z.enum([
  'ONE_TIME',
  'DAILY',
  'WEEKDAYS',
  'WEEKENDS',
  'SELECTED_DAYS',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'ANNUAL',
  'CUSTOM',
]);

const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the mission a name').max(MAX_TITLE_LENGTH),
    description: z.string().trim().max(500).optional(),
    categoryKey: z.string().trim().max(40).optional(),
    iconKey: z.string().trim().max(40).default('target'),
    colorKey: z.string().trim().max(40).default('brand'),
    xpValue: z.number().int().min(0).max(1000).default(0),
    rewardPointsValue: z.number().int().min(0).max(1000).default(0),
    characterTraitId: z.string().uuid().optional(),
    characterStarValue: z.number().int().min(0).max(10).default(0),
    difficulty: z.enum(['EASY', 'STANDARD', 'CHALLENGING', 'EPIC']).default('STANDARD'),
    evidenceType: z.enum(['NONE', 'PHOTO', 'NOTE', 'VOICE', 'PARENT_CONFIRM']).default('NONE'),
    approvalRequired: z.boolean().default(true),
    streakEligible: z.boolean().default(true),
    isFamilyTask: z.boolean().default(false),
    notes: z.string().trim().max(500).optional(),
    childIds: z.array(z.string().uuid()).min(1, 'Pick at least one hero'),
    schedule: z.object({
      frequency: recurrenceFrequencySchema.default('DAILY'),
      interval: z.number().int().min(1).max(52).default(1),
      weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
      monthDay: z.number().int().min(1).max(31).nullable().optional(),
      month: z.number().int().min(1).max(12).nullable().optional(),
      startDate: localDateSchema,
      endDate: localDateSchema.nullable().optional(),
      dueTime: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a HH:mm time')
        .nullable()
        .optional(),
    }),
  })
  // BR-8: a mission has to be worth something.
  .refine(
    (value) => value.xpValue + value.rewardPointsValue + value.characterStarValue > 0,
    { message: 'A mission needs to be worth some XP, points or stars.', path: ['xpValue'] },
  )
  // A star-bearing task must say which trait it builds.
  .refine((value) => value.characterStarValue === 0 || Boolean(value.characterTraitId), {
    message: 'Pick the character trait this mission builds.',
    path: ['characterTraitId'],
  });

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  xpValue: z.number().int().min(0).max(1000).optional(),
  rewardPointsValue: z.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/**
 * What a child may send when claiming a mission. No child id: the server takes
 * that from the session (BR-55).
 */
export const submitCompletionSchema = z.object({
  occurrenceId: z.string().uuid(),
  note: z.string().trim().max(MAX_NOTE_LENGTH).optional(),
  evidenceText: z.string().trim().max(MAX_NOTE_LENGTH).optional(),
});

export type SubmitCompletionInput = z.infer<typeof submitCompletionSchema>;
