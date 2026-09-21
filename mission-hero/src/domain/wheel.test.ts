import { describe, expect, it } from 'vitest';
import { drawSegment, evaluateEligibility, totalWeight, type WheelSegment } from './wheel';

const segments: WheelSegment[] = [
  { id: 'a', label: 'Ice cream', weight: 1, segmentIndex: 0 },
  { id: 'b', label: 'Choose movie', weight: 2, segmentIndex: 1 },
  { id: 'c', label: 'Extra gaming', weight: 7, segmentIndex: 2 },
];

/** A deterministic generator so the distribution test can never flake. */
function seededRandomInt(seed: number) {
  let state = seed >>> 0;
  return (maxExclusive: number): number => {
    // xorshift32 — cheap, well-distributed, and reproducible.
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % maxExclusive;
  };
}

describe('drawSegment (BR-45)', () => {
  it('maps the cumulative weight bands onto the right segments', () => {
    // Weights 1 / 2 / 7 → bands [0], [1,2], [3..9].
    expect(drawSegment(segments, () => 0).segment.id).toBe('a');
    expect(drawSegment(segments, () => 1).segment.id).toBe('b');
    expect(drawSegment(segments, () => 2).segment.id).toBe('b');
    expect(drawSegment(segments, () => 3).segment.id).toBe('c');
    expect(drawSegment(segments, () => 9).segment.id).toBe('c');
  });

  it('reports the roll and total so a spin is auditable', () => {
    const result = drawSegment(segments, () => 4);
    expect(result.totalWeight).toBe(10);
    expect(result.roll).toBe(4);
  });

  it('ignores segments with a weight below 1 rather than re-rolling (BR-48)', () => {
    const withExcluded: WheelSegment[] = [
      { id: 'excluded', label: 'Sold out', weight: 0, segmentIndex: 0 },
      { id: 'only', label: 'Mystery', weight: 3, segmentIndex: 1 },
    ];
    expect(totalWeight(withExcluded)).toBe(3);
    for (let roll = 0; roll < 3; roll += 1) {
      expect(drawSegment(withExcluded, () => roll).segment.id).toBe('only');
    }
  });

  it('throws when nothing is eligible instead of silently picking', () => {
    expect(() => drawSegment([{ id: 'x', label: 'x', weight: 0, segmentIndex: 0 }], () => 0)).toThrow(
      /at least one segment/,
    );
  });

  it('rejects an RNG that returns an out-of-range value', () => {
    expect(() => drawSegment(segments, () => 10)).toThrow(/outside/);
    expect(() => drawSegment(segments, () => -1)).toThrow(/outside/);
    expect(() => drawSegment(segments, () => 1.5)).toThrow(/outside/);
  });

  it('honours the configured odds over many trials', () => {
    const randomInt = seededRandomInt(20260921);
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    const trials = 60_000;
    for (let i = 0; i < trials; i += 1) {
      counts[drawSegment(segments, randomInt).segment.id]! += 1;
    }
    // Expected shares are 10% / 20% / 70%; 1.5 points of tolerance is far
    // tighter than any real bias would be, and the seed makes it repeatable.
    expect((counts.a! / trials) * 100).toBeCloseTo(10, 0);
    expect((counts.b! / trials) * 100).toBeCloseTo(20, 0);
    expect((counts.c! / trials) * 100).toBeCloseTo(70, 0);
  });
});

describe('evaluateEligibility (BR-44)', () => {
  const now = new Date('2026-09-21T12:00:00.000Z');
  const base = {
    active: true,
    balance: 150,
    pointThreshold: 100,
    deductPoints: true,
    pointsCost: 100,
    spinsToday: 0,
    spinsThisWeek: 0,
    spinsPerDay: 1,
    spinsPerWeek: 3,
    cooldownMinutes: 0,
    lastSpinAt: null,
    now,
    segmentCount: 4,
  };

  it('unlocks at or above the threshold', () => {
    expect(evaluateEligibility(base).eligible).toBe(true);
    expect(evaluateEligibility({ ...base, balance: 100 }).eligible).toBe(true);
  });

  it('locks below the threshold and reports how many points are still needed', () => {
    const result = evaluateEligibility({ ...base, balance: 80 });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('BELOW_THRESHOLD');
    expect(result.pointsNeeded).toBe(20);
  });

  it('locks an inactive wheel or one with no segments', () => {
    expect(evaluateEligibility({ ...base, active: false }).reason).toBe('WHEEL_INACTIVE');
    expect(evaluateEligibility({ ...base, segmentCount: 0 }).reason).toBe('NO_SEGMENTS');
  });

  it('enforces the daily and weekly spin limits', () => {
    expect(evaluateEligibility({ ...base, spinsToday: 1 }).reason).toBe('DAILY_LIMIT_REACHED');
    expect(evaluateEligibility({ ...base, spinsThisWeek: 3 }).reason).toBe('WEEKLY_LIMIT_REACHED');
  });

  it('treats a limit of 0 as unlimited', () => {
    expect(evaluateEligibility({ ...base, spinsPerDay: 0, spinsToday: 99 }).eligible).toBe(true);
  });

  it('enforces a cooldown and says when the next spin is available', () => {
    const lastSpinAt = new Date('2026-09-21T11:30:00.000Z');
    const cooling = evaluateEligibility({ ...base, cooldownMinutes: 60, lastSpinAt });
    expect(cooling.reason).toBe('COOLING_DOWN');
    expect(cooling.availableAt?.toISOString()).toBe('2026-09-21T12:30:00.000Z');

    const ready = evaluateEligibility({ ...base, cooldownMinutes: 15, lastSpinAt });
    expect(ready.eligible).toBe(true);
  });

  it('requires enough points to pay when a spin costs more than the threshold', () => {
    const result = evaluateEligibility({ ...base, pointThreshold: 50, pointsCost: 200, balance: 120 });
    expect(result.reason).toBe('INSUFFICIENT_POINTS');
    expect(result.pointsNeeded).toBe(80);
  });

  it('ignores the cost entirely when the wheel does not deduct points', () => {
    const result = evaluateEligibility({ ...base, deductPoints: false, pointsCost: 500, balance: 100 });
    expect(result.eligible).toBe(true);
  });
});
