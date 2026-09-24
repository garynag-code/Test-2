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

const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');

const taskFields = z.object({
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
});

/*
 * The two rules that hold however a mission arrives, applied to creating one
 * and to editing one alike — an edit must not be a way round them.
 */
type TaskFields = z.infer<typeof taskFields>;

const worthSomething = (value: TaskFields) =>
  value.xpValue + value.rewardPointsValue + value.characterStarValue > 0;

const starsNameTheirTrait = (value: TaskFields) =>
  value.characterStarValue === 0 || Boolean(value.characterTraitId);

const WORTH_SOMETHING = {
  message: 'A mission needs to be worth some XP, points or stars.',
  path: ['xpValue'],
};

const NAMES_ITS_TRAIT = {
  message: 'Pick the character trait this mission builds.',
  path: ['characterTraitId'],
};

// BR-8: a mission has to be worth something.
export const createTaskSchema = taskFields
  .refine(worthSomething, WORTH_SOMETHING)
  .refine(starsNameTheirTrait, NAMES_ITS_TRAIT);

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/**
 * Editing a mission.
 *
 * Same shape as creating one, plus the id, because the edit form shows every
 * field and sends them all back. Partial updates would mean the form and the
 * schema disagreeing about what an absent field means.
 */
export const updateTaskSchema = taskFields
  .extend({
    taskId: z.string().uuid(),
    active: z.boolean().default(true),
  })
  .refine(worthSomething, WORTH_SOMETHING)
  .refine(starsNameTheirTrait, NAMES_ITS_TRAIT);

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
