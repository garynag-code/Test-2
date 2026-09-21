/**
 * Default collectibles and avatar items seeded into every family (brief §20/§21).
 *
 * Every one of these is free. Nothing here can be bought, and nothing is gated
 * behind spendable Reward Points.
 */

import type { UnlockRule } from './unlocks';

export interface CollectibleDefinition {
  key: string;
  name: string;
  type: 'PET' | 'BACKGROUND' | 'ROOM_ITEM' | 'EFFECT' | 'EMOTE' | 'MAP_DECOR';
  iconKey: string;
  rarity: 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';
  unlockRule: UnlockRule;
}

export const DEFAULT_COLLECTIBLES: readonly CollectibleDefinition[] = [
  {
    key: 'pet-pup',
    name: 'Scout the Pup',
    type: 'PET',
    iconKey: '🐶',
    rarity: 'COMMON',
    unlockRule: { type: 'ALWAYS' },
  },
  {
    key: 'pet-cat',
    name: 'Mango the Cat',
    type: 'PET',
    iconKey: '🐱',
    rarity: 'COMMON',
    unlockRule: { type: 'TASKS_COMPLETED', threshold: 10 },
  },
  {
    key: 'pet-penguin',
    name: 'Pip the Penguin',
    type: 'PET',
    iconKey: '🐧',
    rarity: 'RARE',
    unlockRule: { type: 'LEVEL', threshold: 3 },
  },
  {
    key: 'pet-fox',
    name: 'Rusty the Fox',
    type: 'PET',
    iconKey: '🦊',
    rarity: 'RARE',
    unlockRule: { type: 'STREAK', threshold: 7 },
  },
  {
    key: 'pet-dragon',
    name: 'Ember the Dragon',
    type: 'PET',
    iconKey: '🐲',
    rarity: 'EPIC',
    unlockRule: { type: 'LEVEL', threshold: 6 },
  },
  {
    key: 'pet-unicorn',
    name: 'Star the Unicorn',
    type: 'PET',
    iconKey: '🦄',
    rarity: 'EPIC',
    unlockRule: { type: 'TOTAL_STARS', threshold: 25 },
  },
  {
    key: 'pet-phoenix',
    name: 'Blaze the Phoenix',
    type: 'PET',
    iconKey: '🔥',
    rarity: 'LEGENDARY',
    unlockRule: { type: 'LEVEL', threshold: 9 },
  },
  {
    key: 'effect-sparkle',
    name: 'Sparkle Trail',
    type: 'EFFECT',
    iconKey: '✨',
    rarity: 'COMMON',
    unlockRule: { type: 'TASKS_COMPLETED', threshold: 5 },
  },
  {
    key: 'effect-rainbow',
    name: 'Rainbow Trail',
    type: 'EFFECT',
    iconKey: '🌈',
    rarity: 'RARE',
    unlockRule: { type: 'STREAK', threshold: 14 },
  },
  {
    key: 'effect-comet',
    name: 'Comet Trail',
    type: 'EFFECT',
    iconKey: '☄️',
    rarity: 'EPIC',
    unlockRule: { type: 'SECRET_MISSIONS', threshold: 5 },
  },
  {
    key: 'decor-treehouse',
    name: 'Treehouse',
    type: 'ROOM_ITEM',
    iconKey: '🏡',
    rarity: 'COMMON',
    unlockRule: { type: 'LEVEL', threshold: 2 },
  },
  {
    key: 'decor-telescope',
    name: 'Telescope',
    type: 'ROOM_ITEM',
    iconKey: '🔭',
    rarity: 'RARE',
    unlockRule: { type: 'MEMORY_MASTERED', threshold: 3 },
  },
  {
    key: 'decor-trophy-shelf',
    name: 'Trophy Shelf',
    type: 'ROOM_ITEM',
    iconKey: '🏆',
    rarity: 'EPIC',
    unlockRule: { type: 'ACHIEVEMENT', achievementKey: 'perfect-week' },
  },
  {
    key: 'map-castle',
    name: 'Castle Marker',
    type: 'MAP_DECOR',
    iconKey: '🏰',
    rarity: 'RARE',
    unlockRule: { type: 'LEVEL', threshold: 5 },
  },
  {
    key: 'emote-cheer',
    name: 'Cheer',
    type: 'EMOTE',
    iconKey: '🎉',
    rarity: 'COMMON',
    unlockRule: { type: 'TOTAL_STARS', threshold: 5 },
  },
  {
    key: 'emote-heart',
    name: 'Big Heart',
    type: 'EMOTE',
    iconKey: '💛',
    rarity: 'RARE',
    unlockRule: { type: 'TRAIT_STARS', traitKey: 'kindness', threshold: 10 },
  },
] as const;

export interface AvatarItemDefinition {
  key: string;
  name: string;
  slot: 'HAT' | 'CAPE' | 'CROWN' | 'HELMET' | 'GLASSES' | 'PET' | 'BACKGROUND' | 'TRAIL';
  iconKey: string;
  rarity: 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';
  unlockRule: UnlockRule;
}

export const DEFAULT_AVATAR_ITEMS: readonly AvatarItemDefinition[] = [
  {
    key: 'hat-cap',
    name: 'Baseball Cap',
    slot: 'HAT',
    iconKey: '🧢',
    rarity: 'COMMON',
    unlockRule: { type: 'ALWAYS' },
  },
  {
    key: 'hat-wizard',
    name: 'Wizard Hat',
    slot: 'HAT',
    iconKey: '🎩',
    rarity: 'RARE',
    unlockRule: { type: 'MEMORY_MASTERED', threshold: 1 },
  },
  {
    key: 'hat-party',
    name: 'Party Hat',
    slot: 'HAT',
    iconKey: '🥳',
    rarity: 'COMMON',
    unlockRule: { type: 'TASKS_COMPLETED', threshold: 20 },
  },
  {
    key: 'glasses-cool',
    name: 'Cool Shades',
    slot: 'GLASSES',
    iconKey: '🕶️',
    rarity: 'COMMON',
    unlockRule: { type: 'LEVEL', threshold: 2 },
  },
  {
    key: 'cape-hero',
    name: 'Hero Cape',
    slot: 'CAPE',
    iconKey: '🦸',
    rarity: 'RARE',
    unlockRule: { type: 'LEVEL', threshold: 4 },
  },
  {
    key: 'crown-gold',
    name: 'Golden Crown',
    slot: 'CROWN',
    iconKey: '👑',
    rarity: 'EPIC',
    unlockRule: { type: 'LEVEL', threshold: 7 },
  },
  {
    key: 'crown-kindness',
    name: 'Crown of Kindness',
    slot: 'CROWN',
    iconKey: '💛',
    rarity: 'EPIC',
    unlockRule: { type: 'TRAIT_STARS', traitKey: 'kindness', threshold: 15 },
  },
  {
    key: 'helmet-space',
    name: 'Space Helmet',
    slot: 'HELMET',
    iconKey: '🪖',
    rarity: 'RARE',
    unlockRule: { type: 'SECRET_MISSIONS', threshold: 3 },
  },
  {
    key: 'trail-stars',
    name: 'Star Trail',
    slot: 'TRAIL',
    iconKey: '⭐',
    rarity: 'RARE',
    unlockRule: { type: 'STREAK', threshold: 7 },
  },
  {
    key: 'trail-fire',
    name: 'Fire Trail',
    slot: 'TRAIL',
    iconKey: '🔥',
    rarity: 'LEGENDARY',
    unlockRule: { type: 'STREAK', threshold: 30 },
  },
] as const;
