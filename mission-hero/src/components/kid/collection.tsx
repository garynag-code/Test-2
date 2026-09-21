'use client';

import { useState, useTransition } from 'react';
import { equipItemAction } from '@/features/collectibles/actions';
import { cn } from '@/lib/utils';

interface Entry {
  id: string;
  key: string;
  name: string;
  iconKey: string;
  rarity: string;
  owned: boolean;
  requirement: string;
}

interface AvatarEntry extends Entry {
  slot: string;
  equipped: boolean;
}

const RARITY_RING: Record<string, string> = {
  COMMON: 'border-border',
  RARE: 'border-brand',
  EPIC: 'border-points',
  LEGENDARY: 'border-xp',
};

/**
 * A locked item shows what would unlock it, not a scolding. Nothing here can be
 * bought, and none of it depends on spendable points (brief §20).
 */
export function Collection({
  collectibles,
  avatarItems,
}: {
  collectibles: Entry[];
  avatarItems: AvatarEntry[];
}) {
  const ownedCount =
    collectibles.filter((c) => c.owned).length + avatarItems.filter((a) => a.owned).length;
  const total = collectibles.length + avatarItems.length;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        {ownedCount} of {total} unlocked — all free, none of it bought.
      </p>

      <section aria-labelledby="my-gear" className="space-y-2">
        <h3 id="my-gear" className="text-sm font-bold uppercase tracking-wide text-muted">
          Gear · tap to wear
        </h3>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {avatarItems.map((item) => (
            <AvatarTile key={item.id} item={item} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="my-collection" className="space-y-2">
        <h3 id="my-collection" className="text-sm font-bold uppercase tracking-wide text-muted">
          Collection
        </h3>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {collectibles.map((item) => (
            <li key={item.id}>
              <Tile
                owned={item.owned}
                rarity={item.rarity}
                icon={item.iconKey}
                name={item.name}
                requirement={item.requirement}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function AvatarTile({ item }: { item: AvatarEntry }) {
  const [equipped, setEquipped] = useState(item.equipped);
  const [pending, startTransition] = useTransition();

  if (!item.owned) {
    return (
      <li>
        <Tile
          owned={false}
          rarity={item.rarity}
          icon={item.iconKey}
          name={item.name}
          requirement={item.requirement}
        />
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        disabled={pending}
        aria-pressed={equipped}
        onClick={() =>
          startTransition(async () => {
            const result = await equipItemAction(item.id);
            if (!('error' in result)) setEquipped(Boolean(result.equipped));
          })
        }
        className={cn(
          'mh-tap flex w-full flex-col items-center gap-1 rounded-xl2 border-2 p-2 text-center',
          equipped ? 'border-brand bg-brand-soft' : (RARITY_RING[item.rarity] ?? 'border-border'),
        )}
      >
        <span aria-hidden className="text-2xl">
          {item.iconKey}
        </span>
        <span className="text-[11px] font-bold leading-tight text-ink">{item.name}</span>
        <span className="text-[10px] font-bold uppercase text-brand">
          {equipped ? 'Wearing' : ' '}
        </span>
      </button>
    </li>
  );
}

function Tile({
  owned,
  rarity,
  icon,
  name,
  requirement,
}: {
  owned: boolean;
  rarity: string;
  icon: string;
  name: string;
  requirement: string;
}) {
  return (
    <div
      className={cn(
        'flex h-full flex-col items-center gap-1 rounded-xl2 border-2 p-2 text-center',
        owned ? (RARITY_RING[rarity] ?? 'border-border') : 'border-dashed border-border bg-surface',
      )}
      // Locked items are described in full so a screen reader hears the goal.
      title={owned ? name : `${name} — ${requirement}`}
    >
      <span aria-hidden className={cn('text-2xl', owned ? '' : 'opacity-25 grayscale')}>
        {owned ? icon : '🔒'}
      </span>
      <span className="text-[11px] font-bold leading-tight text-ink">{name}</span>
      {owned ? null : <span className="text-[10px] leading-tight text-muted">{requirement}</span>}
    </div>
  );
}
