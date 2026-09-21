import { z } from 'zod';
import { MAX_ENCOURAGEMENT_LENGTH } from '@/domain/constants';

/**
 * Note what a parent may send: an id and some kind words.
 *
 * There is no amount field anywhere in this file. Point values live on the Task
 * row, so there is no channel through which any client — child or parent —
 * could suggest what an approval is worth (BR-13). A deliberate bonus is a
 * separate, audited action that requires a reason.
 */

export const approveCompletionSchema = z.object({
  completionId: z.string().uuid(),
  encouragementMessage: z.string().trim().max(MAX_ENCOURAGEMENT_LENGTH).optional(),
});

export const rejectCompletionSchema = z.object({
  completionId: z.string().uuid(),
  decision: z.enum(['REJECT', 'REQUEST_REDO', 'ASK_QUESTION']).default('REQUEST_REDO'),
  message: z.string().trim().max(MAX_ENCOURAGEMENT_LENGTH).optional(),
});

export const awardBonusSchema = z.object({
  childId: z.string().uuid(),
  xp: z.number().int().min(0).max(500).default(0),
  points: z.number().int().min(-500).max(500).default(0),
  traitId: z.string().uuid().optional(),
  stars: z.number().int().min(0).max(10).default(0),
  // BR-7: a manual adjustment must say why.
  reason: z.string().trim().min(3, 'Please say why').max(280),
});

export type ApproveCompletionInput = z.infer<typeof approveCompletionSchema>;
export type RejectCompletionInput = z.infer<typeof rejectCompletionSchema>;
export type AwardBonusInput = z.infer<typeof awardBonusSchema>;
