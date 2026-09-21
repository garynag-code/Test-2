import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/utils';

type Kind = 'xp' | 'points' | 'stars';

const STYLES: Record<Kind, { icon: string; label: string; ring: string; text: string }> = {
  // Icon + label + colour: status is never carried by colour alone.
  xp: { icon: '⚡', label: 'XP', ring: 'bg-xp/10 border-xp/30', text: 'text-xp' },
  points: {
    icon: '⭐',
    label: 'Points',
    ring: 'bg-points/10 border-points/30',
    text: 'text-points',
  },
  stars: { icon: '❤️', label: 'Stars', ring: 'bg-star/10 border-star/30', text: 'text-star' },
};

/**
 * The three progression systems are shown side by side and never merged, so a
 * child can see at a glance that stars are not currency (brief §3).
 */
export function StatChip({ kind, value }: { kind: Kind; value: number }) {
  const style = STYLES[kind];
  return (
    <div className={cn('flex-1 rounded-xl2 border-2 px-2 py-3 text-center', style.ring)}>
      <div aria-hidden className="text-xl">
        {style.icon}
      </div>
      <div className={cn('text-xl font-extrabold tabular-nums', style.text)}>
        {formatNumber(value)}
      </div>
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted">{style.label}</div>
    </div>
  );
}
