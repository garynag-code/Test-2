import { cn } from '@/lib/utils';

interface ProgressProps {
  value: number;
  max: number;
  label: string;
  className?: string;
  barClassName?: string;
  /** Shown beside the bar, e.g. "80 / 100". */
  caption?: string;
}

/**
 * A progress bar that is legible without colour and announced correctly to a
 * screen reader — both requirements from the accessibility rules in docs/03.
 */
export function Progress({ value, max, label, className, barClassName, caption }: ProgressProps) {
  const safeMax = Math.max(1, max);
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const percent = Math.round((clamped / safeMax) * 100);

  return (
    <div className={cn('space-y-1', className)}>
      {caption ? (
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-semibold text-muted">{label}</span>
          <span className="font-bold tabular-nums text-ink">{caption}</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuetext={`${clamped} of ${safeMax}`}
        className="h-3 w-full overflow-hidden rounded-full bg-border"
      >
        <div
          className={cn(
            'mh-gradient h-full rounded-full transition-[width] duration-700',
            barClassName,
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
