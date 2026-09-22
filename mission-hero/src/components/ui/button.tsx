'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-transform disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]',
  {
    variants: {
      variant: {
        primary: 'mh-gradient text-white shadow-pop',
        solid: 'bg-brand text-white shadow-lift',
        soft: 'bg-brand-soft text-brand',
        outline: 'border-2 border-border bg-card text-ink',
        ghost: 'text-muted hover:bg-brand-soft/50',
        danger: 'border-2 border-border bg-card text-ink',
      },
      size: {
        // Child surface: never below 56px (brief §52).
        kid: 'mh-tap px-7 text-lg',
        md: 'mh-tap-sm px-5 text-sm',
        sm: 'min-h-[36px] px-3 text-xs',
        block: 'mh-tap w-full px-6 text-base',
      },
    },
    defaultVariants: { variant: 'solid', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  children: ReactNode;
}

/**
 * Every button here stays disabled until React has attached to it.
 *
 * Nothing on either surface works without JavaScript. Forms are driven by
 * `useActionState`, which does not progressively enhance without a
 * `permalink` — before hydration the submit is an ordinary POST carrying no
 * action reference, so the server re-renders the same page and the tap does
 * nothing at all: no error, no spinner, no row written. Buttons that act
 * through `onClick` are just as dead in that window.
 *
 * On a developer's machine the window is a few hundred milliseconds. On a
 * child's phone waking a sleeping server it is long enough to tap twice and
 * decide the app is broken — and they would be right, because the first tap
 * really did nothing.
 *
 * Disabling until mounted turns that silent no-op into a control that visibly
 * is not ready yet, which is the honest thing for it to be. It also gives the
 * end-to-end suite something real to wait on: "enabled" now means "will
 * work", where before it meant nothing at all.
 */
export function Button({ className, variant, size, children, ...props }: ButtonProps) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  return (
    <button
      className={cn(button({ variant, size }), className)}
      {...props}
      disabled={props.disabled || !hydrated}
    >
      {children}
    </button>
  );
}

export { button as buttonStyles };
