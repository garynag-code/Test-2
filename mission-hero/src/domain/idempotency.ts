/**
 * Canonical idempotency keys (BR-6).
 *
 * Keys are *derived from the causing row*, never supplied by a client. A
 * duplicate request therefore collides with the unique index on
 * `(childId, idempotencyKey)` whatever path it arrived by.
 */

import type { LocalDate } from './dates';

export const ledgerKeys = {
  taskCompletion: (completionId: string) => `task_completion:${completionId}`,
  dailyCheckIn: (localDate: LocalDate) => `daily_check_in:${localDate}`,
  characterApproval: (submissionId: string) => `character_approval:${submissionId}`,
  memorySubmission: (submissionId: string) => `memory_submission:${submissionId}`,
  secretMission: (submissionId: string) => `secret_mission:${submissionId}`,
  streakMilestone: (kind: string, milestone: number, localDate: LocalDate) =>
    `streak_milestone:${kind}:${milestone}:${localDate}`,
  achievement: (achievementId: string) => `achievement:${achievementId}`,
  wheelSpinCost: (spinId: string) => `wheel_spin_cost:${spinId}`,
  wheelSpinReward: (spinId: string) => `wheel_spin_reward:${spinId}`,
  redemption: (redemptionId: string) => `redemption:${redemptionId}`,
  redemptionRefund: (redemptionId: string) => `redemption_refund:${redemptionId}`,
  /**
   * Manual awards are the one case with no causing row, so the key carries a
   * server-generated id. The parent-facing action always creates a fresh id,
   * which is what makes a deliberate second bonus possible while an accidental
   * double-submit of the same form is not.
   */
  manual: (adjustmentId: string) => `manual:${adjustmentId}`,
} as const;
