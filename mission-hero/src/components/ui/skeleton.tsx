import { cn } from '@/lib/utils';

/** A calm placeholder. Announced as busy so a screen reader is not left silent. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse-soft rounded-xl2 bg-border', className)} />;
}

export function PageSkeleton({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-1/2" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-24 w-full" />
      ))}
    </div>
  );
}
