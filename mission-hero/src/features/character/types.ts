export interface TraitCard {
  id: string;
  key: string;
  label: string;
  emoji: string;
  promptText: string;
  colorKey: string;
  description: string | null;
}

export interface TraitTotal {
  traitId: string;
  key: string;
  label: string;
  emoji: string;
  colorKey: string;
  total: number;
  /** Highest badge tier earned for this trait, if any. */
  currentTier: 'BRONZE' | 'SILVER' | 'GOLD' | 'DIAMOND' | null;
  nextTier: 'BRONZE' | 'SILVER' | 'GOLD' | 'DIAMOND' | null;
  /** Moments still needed for the next tier. */
  remaining: number;
  /** Growth copy — never a deficiency label (BR-34). */
  message: string;
}

export interface PendingCharacterSubmission {
  submissionId: string;
  childId: string;
  childNickname: string;
  childAvatarKey: string;
  traitLabel: string;
  traitEmoji: string;
  story: string;
  submittedAt: Date;
  currentTotal: number;
  nextBadgeName: string | null;
  remainingForNextBadge: number;
}

export interface CharacterCelebration {
  traitLabel: string;
  traitEmoji: string;
  starsAwarded: number;
  xpAwarded: number;
  newTotal: number;
  headline: string;
  message: string;
  encouragement: string | null;
  parentName: string | null;
  badgesUnlocked: Array<{ name: string; tier: string }>;
  streakDays: number;
}
