/**
 * Child-facing language (brief §53, BR-60/61).
 *
 * All encouragement and status copy for the child surface lives here so the
 * tone commitment is testable: `copy.test.ts` asserts no string in this file
 * matches the banned-phrase list. Shame, loss and failure language must not be
 * able to reach a nine-year-old by accident.
 */

export const BANNED_PHRASES: readonly RegExp[] = [
  /\byou failed\b/i,
  /\bfailed\b/i,
  /\byou are bad\b/i,
  /\byou're bad\b/i,
  /\bbad at\b/i,
  /\byou lost\b/i,
  /\blost everything\b/i,
  /\bpunish/i,
  /\byou didn't\b/i,
  /\bdisappoint/i,
  /\bnaughty\b/i,
  /\blazy\b/i,
  /\bstupid\b/i,
] as const;

export const CELEBRATION = {
  missionComplete: 'MISSION COMPLETE!',
  greatConsistency: 'Great consistency!',
  keptYourPromise: 'You kept your promise!',
  awesomeEffort: 'Awesome effort!',
  braveChoice: 'That was a brave choice.',
  toldTheTruth: 'You told the truth even when it was hard.',
  levelUp: 'LEVEL UP!',
  badgeUnlocked: 'NEW BADGE UNLOCKED!',
  secretFound: 'SECRET MISSION FOUND!',
  spinUnlocked: 'YOU UNLOCKED A SPIN!',
} as const;

export const CHARACTER = {
  prompt: 'What kind of person were you today?',
  tellUs: 'Awesome. Tell us what happened.',
  waitingForParent: 'Waiting for a grown-up',
  kindnessPower: 'Kindness Power +1!',
  becomingHero: (badgeName: string) => `You're becoming a ${badgeName}!`,
  growThisOne: "Let's grow this one.",
  buildingSomething: "You're building something great.",
  momentsToBadge: (remaining: number, traitLabel: string) =>
    `${remaining} more ${traitLabel.toLowerCase()} ${remaining === 1 ? 'moment' : 'moments'} to your next badge.`,
} as const;

export const PENDING = {
  waitingFor: (parentName: string) => `Waiting for ${parentName}`,
  sentIt: 'Sent! A grown-up will take a look.',
} as const;

/** BR-61: a redo is an invitation, and it names who asked. */
export const REDO = {
  tryAgain: (parentName: string) => `Almost there. ${parentName} asked you to try this one again.`,
  letsTalk: "Let's talk about this one together.",
  notYet: 'Not quite yet — have another go when you can.',
} as const;

/** BR-40: a broken streak is a fresh start, never a loss. */
export const STREAK = {
  reset: 'New streak starts today.',
  best: (days: number) => `Your best is ${days} ${days === 1 ? 'day' : 'days'}.`,
  showingUp: (days: number) => `${days} ${days === 1 ? 'day' : 'days'} of showing up!`,
  keepGoing: 'Keep it rolling!',
} as const;

export const ENCOURAGEMENT_CHIPS: readonly string[] = [
  'Proud of your effort.',
  'Great honesty.',
  'Well done for helping.',
  'Awesome consistency.',
  'That took courage.',
  'You worked hard on this.',
  'Thank you for helping out.',
  'I noticed that. Well done.',
] as const;

export const EMPTY_STATES = {
  noMissionsToday: 'All clear for today. Enjoy it!',
  noMissionsYet: 'Your missions will show up here.',
  nothingWaiting: 'Nothing waiting for a grown-up right now.',
  noRewardsYet: 'Rewards will appear here soon.',
  noBadgesYet: 'Your first badge is on its way.',
} as const;

/** Every string in the child surface, flattened — used by the tone test. */
export function allChildCopyStrings(): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      out.push(value);
    } else if (typeof value === 'function') {
      // Templates are exercised with representative arguments so their literal
      // parts are covered by the tone check too.
      try {
        out.push(String((value as (...args: unknown[]) => unknown)('Mom', 3)));
        out.push(String((value as (...args: unknown[]) => unknown)(1, 'Kindness')));
      } catch {
        // A template needing different arguments is covered by its own test.
      }
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(walk);
    }
  };
  [CELEBRATION, CHARACTER, PENDING, REDO, STREAK, EMPTY_STATES].forEach(walk);
  ENCOURAGEMENT_CHIPS.forEach(walk);
  return out;
}
