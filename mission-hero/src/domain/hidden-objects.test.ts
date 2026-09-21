import { describe, expect, it } from 'vitest';
import { HIDDEN_OBJECT_SURFACES } from './constants';
import { isHiddenObjectAvailable, placeHiddenObject, stableHash } from './hidden-objects';

describe('hidden object placement (BR-51)', () => {
  it('is stable within a day, so refreshing cannot farm a discovery', () => {
    const a = placeHiddenObject('child-1', '2026-09-21');
    const b = placeHiddenObject('child-1', '2026-09-21');
    expect(b).toEqual(a);
    expect(isHiddenObjectAvailable('child-1', '2026-09-21')).toBe(
      isHiddenObjectAvailable('child-1', '2026-09-21'),
    );
  });

  it('moves between days', () => {
    const week = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'];
    const placements = new Set(week.map((d) => placeHiddenObject('child-1', d).surface));
    expect(placements.size).toBeGreaterThan(1);
  });

  it('differs between children on the same day', () => {
    const placements = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => JSON.stringify(placeHiddenObject(id, '2026-09-21'))),
    );
    expect(placements.size).toBeGreaterThan(1);
  });

  it('always lands on a real surface with a usable offset', () => {
    for (let day = 1; day <= 28; day += 1) {
      const placement = placeHiddenObject('child-42', `2026-09-${String(day).padStart(2, '0')}`);
      expect(HIDDEN_OBJECT_SURFACES).toContain(placement.surface);
      expect(placement.offset).toBeGreaterThanOrEqual(0);
      expect(placement.offset).toBeLessThan(1);
      expect(placement.objectKey).toBeTruthy();
    }
  });

  it('is not available every single day', () => {
    const days = Array.from({ length: 60 }, (_, i) => `2026-0${i < 30 ? '9' : '8'}-${String((i % 28) + 1).padStart(2, '0')}`);
    const available = days.filter((d) => isHiddenObjectAvailable('child-1', d));
    expect(available.length).toBeGreaterThan(0);
    expect(available.length).toBeLessThan(days.length);
  });
});

describe('stableHash', () => {
  it('is deterministic and well spread', () => {
    expect(stableHash('abc')).toBe(stableHash('abc'));
    expect(stableHash('abc')).not.toBe(stableHash('abd'));
    const values = new Set(Array.from({ length: 500 }, (_, i) => stableHash(`key-${i}`) % 8));
    expect(values.size).toBe(8);
  });
});
