import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Join class names, with later Tailwind utilities winning over earlier ones.
 *
 * Ported verbatim from the design (`src/lib/utils.ts`). `twMerge` is the part that matters: without
 * it, `cn('p-4', 'p-6')` emits both and the winner is decided by stylesheet order, which is not the
 * order the caller wrote them in. With it, the later class wins, which is what every caller assumes.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
