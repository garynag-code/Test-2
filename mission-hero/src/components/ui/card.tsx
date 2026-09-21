import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl2 border border-border bg-card p-4 shadow-sm', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cn('text-sm font-bold uppercase tracking-wide text-muted', className)}>
      {children}
    </h2>
  );
}

/**
 * Empty states are a first-class part of every screen (brief §50), so they get
 * a component rather than being improvised per page.
 */
export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl2 border-2 border-dashed border-border px-6 py-10 text-center">
      <span aria-hidden className="text-4xl">
        {icon}
      </span>
      <p className="font-semibold text-ink">{title}</p>
      {hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  );
}
