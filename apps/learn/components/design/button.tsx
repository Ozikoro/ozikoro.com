import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The design's Button, ported as written.
 *
 * The class strings are exactly the design's — including `min-h-11` (44px), which is the same tap
 * target §9.1 requires, and the `hover:-translate-y-0.5` lift. Translating these into hand-written
 * CSS is what lost the fidelity last time, so they are kept as utilities.
 *
 * `@radix-ui/react-slot` is NOT a dependency here. Its one job is `asChild`, and the call sites that
 * want a link render one with the same classes via `buttonClasses` — which is what Slot produces
 * anyway, without a package whose only export is a cloneElement wrapper.
 */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'icon';
  children: ReactNode;
};

const VARIANTS = {
  primary: 'bg-primary text-primary-foreground shadow-sm hover:-translate-y-0.5 hover:bg-primary/90',
  secondary: 'border border-border bg-card text-card-foreground hover:bg-muted',
  ghost: 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
  icon: 'size-11 min-h-11 bg-transparent p-0 text-muted-foreground hover:bg-muted hover:text-foreground',
} as const;

export function Button({ variant = 'primary', className, children, asChild, ...props }: ButtonProps) {
  const classes = cn(
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
    VARIANTS[variant],
    className
  );

  // `asChild` on a button element has no meaning without Slot, and silently dropping the prop is
  // better than rendering a button inside a link. Callers that want a link use ButtonLink below.
  void asChild;

  return (
    <button className={classes} {...props}>
      {children}
    </button>
  );
}

/** The same styling on an anchor, which is what `asChild` was reaching for. */
export function buttonClasses(
  variant: keyof typeof VARIANTS = 'primary',
  className?: string
): string {
  return cn(
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    VARIANTS[variant],
    className
  );
}
