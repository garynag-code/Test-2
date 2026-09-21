export interface AwardSummary {
  xp: number;
  points: number;
  stars: number;
  traitLabel: string | null;
}

export interface UnlockSummary {
  key: string;
  name: string;
  description: string;
  iconKey: string;
}

export interface CollectibleUnlock {
  key: string;
  name: string;
  iconKey: string;
  rarity: string;
}

/**
 * What the child's celebration screen replays. Every number here came from the
 * server transaction — the client never computes an award (BR-1).
 */
export interface CelebrationPayload {
  title: string;
  taskTitle: string;
  iconKey: string;
  awards: AwardSummary;
  encouragement: string | null;
  parentName: string | null;
  lifetimeXp: number;
  levelNumber: number;
  levelName: string;
  levelProgress: number;
  xpToNextLevel: number;
  leveledUp: boolean;
  streakDays: number;
  streakMilestone: number | null;
  achievements: UnlockSummary[];
  /** Pets, effects and avatar items earned by this award (brief §20). */
  unlocks: CollectibleUnlock[];
}
