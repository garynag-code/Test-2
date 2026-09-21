/**
 * Hidden object placement (BR-51).
 *
 * Placement is a deterministic function of (child, day, salt). It moves between
 * days so discovery still feels like a hunt, but refreshing the page cannot
 * produce a new object — which is both an anti-farming measure and, more
 * importantly, an anti-compulsion one (docs/10 §3).
 */

import { HIDDEN_OBJECT_SURFACES, type HiddenObjectSurface } from './constants';
import type { LocalDate } from './dates';

/** FNV-1a: small, fast, dependency-free, and stable across Node versions. */
export function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export interface HiddenObjectPlacement {
  surface: HiddenObjectSurface;
  /** 0..1 horizontal hint so the object does not always sit in a corner. */
  offset: number;
  objectKey: string;
}

const OBJECT_KEYS = [
  'chest',
  'star',
  'key',
  'gem',
  'rocket',
  'scroll',
  'egg',
  'bolt',
  'shield',
  'map-piece',
] as const;

export function placeHiddenObject(
  childId: string,
  localDate: LocalDate,
  salt = 'mission-hero',
): HiddenObjectPlacement {
  const base = stableHash(`${salt}:${childId}:${localDate}`);
  const surface = HIDDEN_OBJECT_SURFACES[base % HIDDEN_OBJECT_SURFACES.length]!;
  const objectKey = OBJECT_KEYS[stableHash(`obj:${base}`) % OBJECT_KEYS.length]!;
  const offset = (stableHash(`off:${base}`) % 1000) / 1000;
  return { surface, offset, objectKey };
}

/**
 * Whether the object is present at all today. Roughly one day in three keeps it
 * a surprise rather than a daily chore, and the same seed means the answer does
 * not change on refresh.
 */
export function isHiddenObjectAvailable(
  childId: string,
  localDate: LocalDate,
  salt = 'mission-hero',
): boolean {
  return stableHash(`avail:${salt}:${childId}:${localDate}`) % 3 === 0;
}
