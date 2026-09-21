/**
 * Weighted wheel draw (BR-44 … BR-48).
 *
 * Pure and RNG-injected so the distribution can be tested with a seeded
 * generator. The caller in the service layer always passes `crypto.randomInt`;
 * nothing here is ever executed in a browser.
 */

export interface WheelSegment {
  id: string;
  label: string;
  /** Integer ≥ 1. A segment excluded from the draw is filtered out by the caller. */
  weight: number;
  segmentIndex: number;
}

/** Returns an integer in `[0, maxExclusive)`. */
export type RandomInt = (maxExclusive: number) => number;

export interface DrawResult {
  segment: WheelSegment;
  /** The cumulative-weight position that was drawn; stored for auditability. */
  roll: number;
  totalWeight: number;
}

export function totalWeight(segments: readonly WheelSegment[]): number {
  return segments.reduce((sum, s) => sum + Math.max(0, Math.floor(s.weight)), 0);
}

/**
 * Draws one segment with probability proportional to its weight.
 *
 * Integer weights with a running-sum scan keep the draw exactly uniform — a
 * float-based `Math.random() * total` comparison can drift, and a wheel that is
 * subtly unfair would be both a bug and a broken promise to the parent who
 * configured the odds.
 */
export function drawSegment(segments: readonly WheelSegment[], randomInt: RandomInt): DrawResult {
  const eligible = segments.filter((s) => Math.floor(s.weight) >= 1);
  if (eligible.length === 0) {
    throw new Error('drawSegment requires at least one segment with weight >= 1');
  }

  const total = totalWeight(eligible);
  const roll = randomInt(total);
  if (!Number.isInteger(roll) || roll < 0 || roll >= total) {
    throw new Error(`randomInt returned ${roll}, outside [0, ${total})`);
  }

  let cursor = 0;
  for (const segment of eligible) {
    cursor += Math.floor(segment.weight);
    if (roll < cursor) return { segment, roll, totalWeight: total };
  }

  // Unreachable while the loop above sums to `total`; kept so a future change
  // to the weighting fails loudly rather than silently favouring a segment.
  throw new Error('drawSegment failed to select a segment');
}

export interface EligibilityInput {
  active: boolean;
  balance: number;
  pointThreshold: number;
  deductPoints: boolean;
  pointsCost: number;
  spinsToday: number;
  spinsThisWeek: number;
  spinsPerDay: number;
  spinsPerWeek: number;
  cooldownMinutes: number;
  lastSpinAt: Date | null;
  now: Date;
  segmentCount: number;
}

export type IneligibleReason =
  | 'WHEEL_INACTIVE'
  | 'NO_SEGMENTS'
  | 'BELOW_THRESHOLD'
  | 'INSUFFICIENT_POINTS'
  | 'DAILY_LIMIT_REACHED'
  | 'WEEKLY_LIMIT_REACHED'
  | 'COOLING_DOWN';

export interface EligibilityResult {
  eligible: boolean;
  reason: IneligibleReason | null;
  /** Points still needed — drives the "80 / 100" progress bar. */
  pointsNeeded: number;
  availableAt: Date | null;
}

/**
 * Evaluated on the server both when rendering and again inside the spin
 * transaction, so a stale page cannot buy a spin the child is not entitled to.
 */
export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const cost = input.deductPoints ? input.pointsCost : 0;
  const required = Math.max(input.pointThreshold, cost);
  const pointsNeeded = Math.max(0, required - input.balance);

  const deny = (reason: IneligibleReason, availableAt: Date | null = null): EligibilityResult => ({
    eligible: false,
    reason,
    pointsNeeded,
    availableAt,
  });

  if (!input.active) return deny('WHEEL_INACTIVE');
  if (input.segmentCount === 0) return deny('NO_SEGMENTS');
  if (input.balance < input.pointThreshold) return deny('BELOW_THRESHOLD');
  if (input.deductPoints && input.balance < input.pointsCost) return deny('INSUFFICIENT_POINTS');
  if (input.spinsPerDay > 0 && input.spinsToday >= input.spinsPerDay) {
    return deny('DAILY_LIMIT_REACHED');
  }
  if (input.spinsPerWeek > 0 && input.spinsThisWeek >= input.spinsPerWeek) {
    return deny('WEEKLY_LIMIT_REACHED');
  }
  if (input.cooldownMinutes > 0 && input.lastSpinAt) {
    const readyAt = new Date(input.lastSpinAt.getTime() + input.cooldownMinutes * 60_000);
    if (input.now < readyAt) return deny('COOLING_DOWN', readyAt);
  }

  return { eligible: true, reason: null, pointsNeeded: 0, availableAt: null };
}
