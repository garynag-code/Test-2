import type { LedgerSourceType } from '@prisma/client';

export type Ledger = 'XP' | 'POINTS' | 'STARS';

export interface AwardRequest {
  familyId: string;
  childId: string;
  /** Always positive for XP and Stars (BR-3/BR-5); signed for Points. */
  amount: number;
  sourceType: LedgerSourceType;
  sourceId?: string | null;
  /** Built by `src/domain/idempotency.ts` — never supplied by a client. */
  idempotencyKey: string;
  awardedByUserId?: string | null;
  reason?: string | null;
  description: string;
}

export interface AwardResult {
  /** False when this exact award had already been written (BR-6). */
  created: boolean;
  transactionId: string;
  amount: number;
}

export interface Balances {
  lifetimeXp: number;
  rewardPoints: number;
  characterStars: number;
}

export interface TraitStarTotal {
  traitId: string;
  total: number;
}
