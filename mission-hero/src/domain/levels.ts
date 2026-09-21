/**
 * Level progression (brief §22, BR-36).
 *
 * Levels are derived from lifetime XP, which can never decrease (BR-3), so a
 * level can never be lost. Families may override the table; these are the
 * defaults seeded into every new family.
 */

export interface LevelDefinition {
  levelNumber: number;
  name: string;
  minLifetimeXp: number;
  iconKey: string;
}

export const DEFAULT_LEVELS: readonly LevelDefinition[] = [
  { levelNumber: 1, name: 'Rookie', minLifetimeXp: 0, iconKey: 'sprout' },
  { levelNumber: 2, name: 'Explorer', minLifetimeXp: 100, iconKey: 'compass' },
  { levelNumber: 3, name: 'Adventurer', minLifetimeXp: 300, iconKey: 'map' },
  { levelNumber: 4, name: 'Rising Star', minLifetimeXp: 600, iconKey: 'star' },
  { levelNumber: 5, name: 'Champion', minLifetimeXp: 1000, iconKey: 'flame' },
  { levelNumber: 6, name: 'Super Achiever', minLifetimeXp: 1500, iconKey: 'zap' },
  { levelNumber: 7, name: 'Hero', minLifetimeXp: 2200, iconKey: 'shield' },
  { levelNumber: 8, name: 'Legend', minLifetimeXp: 3000, iconKey: 'crown' },
  { levelNumber: 9, name: 'Mythic', minLifetimeXp: 4000, iconKey: 'gem' },
  { levelNumber: 10, name: 'Mission Master', minLifetimeXp: 5500, iconKey: 'trophy' },
] as const;

export interface LevelProgress {
  level: LevelDefinition;
  next: LevelDefinition | null;
  lifetimeXp: number;
  /** XP earned inside the current level band. */
  xpIntoLevel: number;
  /** Total XP the current band spans; 0 at max level. */
  xpForLevel: number;
  /** XP still needed for the next level; 0 at max level. */
  xpToNext: number;
  /** 0..1, saturating at 1 for the top level. */
  progress: number;
}

/**
 * Resolves lifetime XP to a level and its progress bar.
 * Levels are assumed sorted ascending by minLifetimeXp; the function sorts
 * defensively so a family's custom table cannot break the UI.
 */
export function resolveLevel(
  lifetimeXp: number,
  levels: readonly LevelDefinition[] = DEFAULT_LEVELS,
): LevelProgress {
  if (levels.length === 0) {
    throw new Error('resolveLevel requires at least one level definition');
  }
  const sorted = [...levels].sort((a, b) => a.minLifetimeXp - b.minLifetimeXp);
  const xp = Math.max(0, Math.floor(lifetimeXp));

  // The first level is the floor: a child below the lowest threshold is level 1,
  // never "unranked".
  let current = sorted[0]!;
  let next: LevelDefinition | null = null;

  for (const level of sorted) {
    if (xp >= level.minLifetimeXp) {
      current = level;
    } else {
      next = level;
      break;
    }
  }

  const xpIntoLevel = xp - current.minLifetimeXp;
  const xpForLevel = next ? next.minLifetimeXp - current.minLifetimeXp : 0;
  const xpToNext = next ? Math.max(0, next.minLifetimeXp - xp) : 0;
  const progress = next && xpForLevel > 0 ? Math.min(1, xpIntoLevel / xpForLevel) : 1;

  return { level: current, next, lifetimeXp: xp, xpIntoLevel, xpForLevel, xpToNext, progress };
}

/** True when an award crossed a level boundary — drives the level-up celebration. */
export function didLevelUp(
  previousXp: number,
  newXp: number,
  levels: readonly LevelDefinition[] = DEFAULT_LEVELS,
): boolean {
  return resolveLevel(newXp, levels).level.levelNumber > resolveLevel(previousXp, levels).level.levelNumber;
}
