import { describe, expect, it } from 'vitest';
import { badgeProgress, highestTier, thresholdFor, tiersUnlockedBy } from './badges';

describe('character badge tiers (BR-35)', () => {
  it('uses the thresholds from the brief', () => {
    expect(thresholdFor('BRONZE')).toBe(5);
    expect(thresholdFor('SILVER')).toBe(15);
    expect(thresholdFor('GOLD')).toBe(30);
    expect(thresholdFor('DIAMOND')).toBe(75);
  });

  it('reports the highest tier a count satisfies', () => {
    expect(highestTier(0)).toBeNull();
    expect(highestTier(4)).toBeNull();
    expect(highestTier(5)).toBe('BRONZE');
    expect(highestTier(29)).toBe('SILVER');
    expect(highestTier(100)).toBe('DIAMOND');
  });

  it('only returns tiers that are newly reached', () => {
    expect(tiersUnlockedBy(16, [])).toEqual(['BRONZE', 'SILVER']);
    expect(tiersUnlockedBy(16, ['BRONZE'])).toEqual(['SILVER']);
    expect(tiersUnlockedBy(16, ['BRONZE', 'SILVER'])).toEqual([]);
  });

  it('describes progress toward the next tier without shaming a low count', () => {
    expect(badgeProgress(3)).toEqual({
      currentTier: null,
      nextTier: 'BRONZE',
      count: 3,
      remaining: 2,
    });
    expect(badgeProgress(27)).toEqual({
      currentTier: 'SILVER',
      nextTier: 'GOLD',
      count: 27,
      remaining: 3,
    });
    expect(badgeProgress(80)).toEqual({
      currentTier: 'DIAMOND',
      nextTier: null,
      count: 80,
      remaining: 0,
    });
  });
});
