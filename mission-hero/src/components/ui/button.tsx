import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
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

export function Button({ className, variant, size, children, ...props }: ButtonProps) {
  return (
    <button className={cn(button({ variant, size }), className)} {...props}>
      {children}
    </button>
  );
}

export { button as buttonStyles };
