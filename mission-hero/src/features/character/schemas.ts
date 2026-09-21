import { z } from 'zod';
import { MAX_ENCOURAGEMENT_LENGTH, MAX_STORY_LENGTH } from '@/domain/constants';

/**
 * As with task approvals, note the absence of any star count: confirming a
 * character moment awards exactly one star (BR-29), decided by the server.
 */

export const submitCharacterSchema = z.object({
  traitId: z.string().uuid(),
  story: z
    .string()
    .trim()
    .min(3, 'Tell us what happened.')
    .max(MAX_STORY_LENGTH),
  mood: z.string().trim().max(24).optional(),
});

export const confirmCharacterSchema = z.object({
  submissionId: z.string().uuid(),
  encouragementMessage: z.string().trim().max(MAX_ENCOURAGEMENT_LENGTH).optional(),
});

export const declineCharacterSchema = z.object({
  submissionId: z.string().uuid(),
  decision: z.enum(['REJECT', 'ASK_QUESTION']).default('ASK_QUESTION'),
  message: z.string().trim().max(MAX_ENCOURAGEMENT_LENGTH).optional(),
});

export const createTraitSchema = z.object({
  label: z.string().trim().min(1).max(40),
  emoji: z.string().trim().min(1).max(8).default('⭐'),
  promptText: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).optional(),
  colorKey: z.string().trim().max(24).default('star'),
});

export type SubmitCharacterInput = z.infer<typeof submitCharacterSchema>;
export type ConfirmCharacterInput = z.infer<typeof confirmCharacterSchema>;
export type DeclineCharacterInput = z.infer<typeof declineCharacterSchema>;
export type CreateTraitInput = z.infer<typeof createTraitSchema>;
