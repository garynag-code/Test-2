/**
 * DTOs handed to the UI.
 *
 * Written by hand rather than derived from Prisma models so widening a model
 * can never silently widen what reaches a client (docs/05).
 */

export type MissionState = 'OPEN' | 'WAITING' | 'DONE' | 'REDO' | 'MISSED';

export interface MissionCard {
  occurrenceId: string;
  taskId: string;
  title: string;
  description: string | null;
  iconKey: string;
  colorKey: string;
  xpValue: number;
  rewardPointsValue: number;
  characterStarValue: number;
  traitLabel: string | null;
  difficulty: 'EASY' | 'STANDARD' | 'CHALLENGING' | 'EPIC';
  evidenceType: 'NONE' | 'PHOTO' | 'NOTE' | 'VOICE' | 'PARENT_CONFIRM';
  dueAt: Date | null;
  state: MissionState;
  /** Set when a parent asked for a redo or sent encouragement. */
  parentMessage: string | null;
}

export interface WeeklyProgress {
  completed: number;
  /** What the bar fills to — always reachable (see src/domain/progress.ts). */
  target: number;
  /** Occurrences actually scheduled this week. */
  scheduled: number;
  remaining: number;
  onTrack: boolean;
  xpThisWeek: number;
  pointsThisWeek: number;
  starsThisWeek: number;
}

export interface PendingApproval {
  completionId: string;
  childId: string;
  childNickname: string;
  childAvatarKey: string;
  taskTitle: string;
  iconKey: string;
  submittedAt: Date;
  childNote: string | null;
  evidenceText: string | null;
  xpValue: number;
  rewardPointsValue: number;
  characterStarValue: number;
  traitLabel: string | null;
}
