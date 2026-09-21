import { describe, expect, it } from 'vitest';
import { DEFAULT_LEVELS, didLevelUp, resolveLevel } from './levels';

describe('resolveLevel (BR-36)', () => {
  it('floors at level 1 rather than leaving a child unranked', () => {
    expect(resolveLevel(0).level.levelNumber).toBe(1);
    expect(resolveLevel(0).level.name).toBe('Rookie');
  });

  it('places a child in the band their lifetime XP falls in', () => {
    expect(resolveLevel(99).level.levelNumber).toBe(1);
    expect(resolveLevel(100).level.levelNumber).toBe(2);
    expect(resolveLevel(299).level.levelNumber).toBe(2);
    expect(resolveLevel(1500).level.name).toBe('Super Achiever');
  });

  it('reports progress toward the next level', () => {
    const progress = resolveLevel(200);
    expect(progress.level.levelNumber).toBe(2);
    expect(progress.next?.levelNumber).toBe(3);
    expect(progress.xpIntoLevel).toBe(100);
    expect(progress.xpForLevel).toBe(200);
    expect(progress.xpToNext).toBe(100);
    expect(progress.progress).toBeCloseTo(0.5);
  });

  it('saturates at the top level', () => {
    const top = DEFAULT_LEVELS[DEFAULT_LEVELS.length - 1]!;
    const progress = resolveLevel(top.minLifetimeXp + 10_000);
    expect(progress.level.levelNumber).toBe(top.levelNumber);
    expect(progress.next).toBeNull();
    expect(progress.xpToNext).toBe(0);
    expect(progress.progress).toBe(1);
  });

  it('never returns a level for negative XP', () => {
    expect(resolveLevel(-500).level.levelNumber).toBe(1);
    expect(resolveLevel(-500).lifetimeXp).toBe(0);
  });

  it('accepts an unsorted custom level table', () => {
    const custom = [
      { levelNumber: 2, name: 'Two', minLifetimeXp: 50, iconKey: 'x' },
      { levelNumber: 1, name: 'One', minLifetimeXp: 0, iconKey: 'x' },
    ];
    expect(resolveLevel(60, custom).level.name).toBe('Two');
  });

  it('is monotonic: more XP never means a lower level', () => {
    let previous = 0;
    for (let xp = 0; xp <= 6000; xp += 37) {
      const level = resolveLevel(xp).level.levelNumber;
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });
});

describe('didLevelUp', () => {
  it('detects crossing a boundary', () => {
    expect(didLevelUp(99, 100)).toBe(true);
    expect(didLevelUp(100, 150)).toBe(false);
    expect(didLevelUp(0, 5500)).toBe(true);
  });
});
