/**
 * Platform-wide constants. Anything a family can override lives in
 * FamilySetting / ChildSetting instead.
 */

export const APP_NAME = 'Mission Hero';
export const APP_TAGLINE = 'Big Goals. Small Wins. Awesome Kids.';

/** Child PIN policy (docs/03 §5). */
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCKOUT_MINUTES = 15;

/** Session lifetimes. */
export const PARENT_SESSION_DAYS = 30;
export const CHILD_SESSION_HOURS = 12;
export const DEVICE_BINDING_DAYS = 365;

/** Cookie names. Parent and child sessions are deliberately separate. */
export const COOKIE_PARENT_SESSION = 'mh_session';
export const COOKIE_CHILD_SESSION = 'mh_child';
export const COOKIE_DEVICE = 'mh_device';

/** Family codes avoid characters a child could misread (0/O, 1/I/L). */
export const FAMILY_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/*
 * Two different minimums, on purpose.
 *
 * FAMILY_CODE_MIN_LENGTH is what a family may *choose*. Eight characters is
 * the floor because this code is the only thing standing between a stranger
 * and a list of children's names: short codes are guessable, and a family
 * that picks "SAM" has weakened the one gate the child surface has.
 *
 * FAMILY_CODE_LEGACY_MIN_LENGTH is what sign-in still *accepts*. Tightening
 * the rule must not lock a child out of a family whose code was already
 * shorter — they would have no way in and no idea why. Old codes keep working
 * until a grown-up changes them, at which point the new floor applies.
 *
 * The restricted alphabet above still governs codes the app invents. It has
 * no business rejecting "MILLERS1" because somebody wanted their own name on
 * it, so a chosen code may use any letter or digit.
 */
export const FAMILY_CODE_MIN_LENGTH = 8;
export const FAMILY_CODE_LEGACY_MIN_LENGTH = 4;
export const FAMILY_CODE_MAX_LENGTH = 12;
export const FAMILY_CODE_LENGTH = 8;

/** Input caps, mirrored by the Zod schemas. */
export const MAX_STORY_LENGTH = 2000;
export const MAX_NOTE_LENGTH = 500;
export const MAX_TITLE_LENGTH = 120;
export const MAX_ENCOURAGEMENT_LENGTH = 280;

/** BR-32: a gentle daily cap on character submissions, never surfaced as a scolding. */
export const CHARACTER_SUBMISSIONS_PER_DAY = 5;

/** Streak milestones that earn a celebration (brief §23). */
export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100] as const;

/** Character badge tier thresholds (brief §9). */
export const CHARACTER_BADGE_THRESHOLDS = {
  BRONZE: 5,
  SILVER: 15,
  GOLD: 30,
  DIAMOND: 75,
} as const;

/**
 * Surfaces a hidden object may appear on. Placement is deterministic per child
 * per day so refreshing cannot farm discoveries (BR-51).
 */
export const HIDDEN_OBJECT_SURFACES = [
  'home-header',
  'home-stats',
  'home-missions',
  'home-character',
  'home-weekly',
  'map-path',
  'rewards-header',
  'me-badges',
] as const;

export type HiddenObjectSurface = (typeof HIDDEN_OBJECT_SURFACES)[number];
