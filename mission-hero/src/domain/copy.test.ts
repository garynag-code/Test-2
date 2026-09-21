import { describe, expect, it } from 'vitest';
import {
  BANNED_PHRASES,
  CHARACTER,
  ENCOURAGEMENT_CHIPS,
  REDO,
  STREAK,
  allChildCopyStrings,
} from './copy';

describe('child-facing tone (BR-60)', () => {
  it('collects every child-facing string', () => {
    const strings = allChildCopyStrings();
    expect(strings.length).toBeGreaterThan(25);
    expect(strings.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
  });

  it('contains no shame, loss or failure language', () => {
    const offenders: string[] = [];
    for (const text of allChildCopyStrings()) {
      for (const pattern of BANNED_PHRASES) {
        if (pattern.test(text)) offenders.push(`${text}  ✗ ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('would catch a regression — the guard itself works', () => {
    expect(BANNED_PHRASES.some((p) => p.test('You failed again'))).toBe(true);
    expect(BANNED_PHRASES.some((p) => p.test('You lost everything'))).toBe(true);
    expect(BANNED_PHRASES.some((p) => p.test("You're bad at honesty"))).toBe(true);
  });
});

describe('positive reset language (BR-40, BR-61)', () => {
  it('frames a broken streak as a fresh start', () => {
    expect(STREAK.reset).toBe('New streak starts today.');
    expect(STREAK.reset.toLowerCase()).not.toContain('lost');
  });

  it('names the parent when asking for a redo', () => {
    expect(REDO.tryAgain('Dad')).toBe('Almost there. Dad asked you to try this one again.');
  });

  it('frames a low trait total as growth, never as a deficiency (BR-34)', () => {
    expect(CHARACTER.growThisOne).toBe("Let's grow this one.");
    expect(CHARACTER.momentsToBadge(3, 'Kindness')).toBe('3 more kindness moments to your next badge.');
    expect(CHARACTER.momentsToBadge(1, 'Honesty')).toBe('1 more honesty moment to your next badge.');
  });

  it('offers parents ready-made encouragement', () => {
    expect(ENCOURAGEMENT_CHIPS).toContain('Proud of your effort.');
    expect(ENCOURAGEMENT_CHIPS.length).toBeGreaterThanOrEqual(6);
  });
});
