/**
 * Default character traits seeded into every new family (brief §6/§7).
 *
 * These are *defaults*, cloned into the family on creation so a parent can
 * rename, reorder, deactivate or add to them without affecting anyone else.
 * The platform holds no opinion about which traits a family should value, and
 * nothing here is tied to a particular faith or worldview.
 */

export interface TraitDefinition {
  key: string;
  label: string;
  emoji: string;
  promptText: string;
  description: string;
  colorKey: string;
}

export const DEFAULT_TRAITS: readonly TraitDefinition[] = [
  {
    key: 'kindness',
    label: 'Kindness',
    emoji: '❤️',
    promptText: 'I was kind today',
    description: 'Choosing to be warm and caring toward someone else.',
    colorKey: 'star',
  },
  {
    key: 'honesty',
    label: 'Honesty',
    emoji: '⭐',
    promptText: 'I was honest today',
    description: 'Telling the truth, especially when it is not the easy thing.',
    colorKey: 'xp',
  },
  {
    key: 'helpfulness',
    label: 'Helpfulness',
    emoji: '🤝',
    promptText: 'I helped someone today',
    description: 'Noticing what someone needs and stepping in.',
    colorKey: 'brand',
  },
  {
    key: 'perseverance',
    label: 'Perseverance',
    emoji: '💪',
    promptText: "I didn't give up today",
    description: 'Staying with something hard until it is done.',
    colorKey: 'points',
  },
  {
    key: 'gratitude',
    label: 'Gratitude',
    emoji: '🙏',
    promptText: 'I was grateful today',
    description: 'Noticing and saying thank you for good things.',
    colorKey: 'success',
  },
  {
    key: 'respect',
    label: 'Respect',
    emoji: '👨‍👩‍👧',
    promptText: 'I showed respect today',
    description: 'Treating people and their things with care.',
    colorKey: 'accent',
  },
  {
    key: 'self-control',
    label: 'Self Control',
    emoji: '🎯',
    promptText: 'I showed self-control today',
    description: 'Pausing and choosing well when it would be easier not to.',
    colorKey: 'warn',
  },
  {
    key: 'listening',
    label: 'Listening',
    emoji: '👂',
    promptText: 'I listened well today',
    description: 'Giving someone your full attention.',
    colorKey: 'brand',
  },
  {
    key: 'encouragement',
    label: 'Encouragement',
    emoji: '😊',
    promptText: 'I encouraged someone',
    description: 'Building someone up with your words.',
    colorKey: 'star',
  },
  {
    key: 'peacemaking',
    label: 'Peacemaking',
    emoji: '🕊️',
    promptText: 'I made peace',
    description: 'Helping to calm things down instead of stirring them up.',
    colorKey: 'success',
  },
  {
    key: 'humility',
    label: 'Humility',
    emoji: '🙋',
    promptText: 'I admitted when I was wrong',
    description: 'Owning a mistake without excuses.',
    colorKey: 'points',
  },
  {
    key: 'forgiveness',
    label: 'Forgiveness',
    emoji: '💛',
    promptText: 'I forgave someone',
    description: 'Letting go of something someone did.',
    colorKey: 'xp',
  },
  {
    key: 'responsibility',
    label: 'Responsibility',
    emoji: '🧹',
    promptText: 'I helped without being asked',
    description: 'Seeing what needs doing and doing it.',
    colorKey: 'accent',
  },
  {
    key: 'courage',
    label: 'Courage',
    emoji: '🦁',
    promptText: 'I was brave today',
    description: 'Doing the right thing even when it felt scary.',
    colorKey: 'warn',
  },
  {
    key: 'learning',
    label: 'Learning',
    emoji: '🌱',
    promptText: 'I learned from a mistake',
    description: 'Turning something that went wrong into something you know.',
    colorKey: 'success',
  },
] as const;
