/**
 * The avatars a child can pick.
 *
 * One list, used by the add form, the settings card and the profile picker.
 * It used to be written out separately in each of those, which is how a
 * family ended up with six choices: adding more meant remembering all three.
 *
 * `hero-1` to `hero-6` keep the emoji they have always had — a child who
 * chose the fox does not want to find a dinosaur there tomorrow. New ones are
 * only ever appended.
 *
 * Each carries a label because the key is what a screen reader was reading
 * out otherwise: "hero seventeen" rather than "Fairy".
 */
export const AVATARS = [
  { key: 'hero-1', label: 'Superhero', emoji: '🦸' },
  { key: 'hero-2', label: 'Astronaut', emoji: '🧑‍🚀' },
  { key: 'hero-3', label: 'Fox', emoji: '🦊' },
  { key: 'hero-4', label: 'Unicorn', emoji: '🦄' },
  { key: 'hero-5', label: 'Dragon', emoji: '🐲' },
  { key: 'hero-6', label: 'Robot', emoji: '🤖' },
  { key: 'hero-7', label: 'Lion', emoji: '🦁' },
  { key: 'hero-8', label: 'Panda', emoji: '🐼' },
  { key: 'hero-9', label: 'Koala', emoji: '🐨' },
  { key: 'hero-10', label: 'Tiger', emoji: '🐯' },
  { key: 'hero-11', label: 'Dinosaur', emoji: '🦖' },
  { key: 'hero-12', label: 'Owl', emoji: '🦉' },
  { key: 'hero-13', label: 'Octopus', emoji: '🐙' },
  { key: 'hero-14', label: 'Shark', emoji: '🦈' },
  { key: 'hero-15', label: 'Bee', emoji: '🐝' },
  { key: 'hero-16', label: 'Butterfly', emoji: '🦋' },
  { key: 'hero-17', label: 'Fairy', emoji: '🧚' },
  { key: 'hero-18', label: 'Wizard', emoji: '🧙' },
  { key: 'hero-19', label: 'Ninja', emoji: '🥷' },
  { key: 'hero-20', label: 'Firefighter', emoji: '🧑‍🚒' },
  { key: 'hero-21', label: 'Football', emoji: '⚽' },
  { key: 'hero-22', label: 'Guitar', emoji: '🎸' },
  { key: 'hero-23', label: 'Rocket', emoji: '🚀' },
  { key: 'hero-24', label: 'Rainbow', emoji: '🌈' },
] as const;

export const DEFAULT_AVATAR_KEY = 'hero-1';

/** The name to read aloud for a stored key. */
export function avatarLabel(key: string | null | undefined): string {
  return AVATARS.find((avatar) => avatar.key === key)?.label ?? 'Superhero';
}

/** Emoji for a stored key, falling back rather than rendering nothing. */
export function avatarEmoji(key: string | null | undefined): string {
  return AVATARS.find((avatar) => avatar.key === key)?.emoji ?? '🦸';
}

export function isAvatarKey(key: string): boolean {
  return AVATARS.some((avatar) => avatar.key === key);
}
