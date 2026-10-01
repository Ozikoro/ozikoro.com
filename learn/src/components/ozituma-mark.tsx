/**
 * The Ozituma mark — the official artwork, not an approximation.
 *
 * WHAT WAS HERE
 *
 * A hand-drawn stand-in: a circle containing the letter "O" with a small dot beside it. It gestured
 * at the identity without being it. The real mark says three things at once, per BRAND.md:
 *
 *   speech bubble    the ring with a tail — language, speaking, naming
 *   open book        the dictionary, reference and learning
 *   ikoro slit drum  the ochre log the book rests on — Igbo and African heritage
 *
 * The bubble is also the "O" of Ozituma. None of that survived in "a letter O with a dot".
 *
 * WHY AN <img> AND NOT INLINE SVG
 *
 * The official files are 1.3–21 KB each and ship in four colourways. Inlining would put a large path
 * in the JavaScript bundle four times over to serve one at a time. An <img> lets the browser fetch
 * and cache a single file.
 *
 * COLOURWAY
 *
 * BRAND.md is explicit: `color` for light backgrounds, `reversed` for dark, `black`/`white` only
 * when colour is unavailable, and "do not stretch, recolour, rotate, add effects, or retype the
 * wordmark". So the variant is CHOSEN here and never tinted — tinting an official mark is on that
 * list.
 */

const MARK = {
  color: { light: "/brand/ozituma-horizontal-color.svg", mark: "/brand/ozituma-mark-color.svg" },
  reversed: { light: "/brand/ozituma-horizontal-reversed.svg", mark: "/brand/ozituma-mark-reversed.svg" },
  black: { light: "/brand/ozituma-horizontal-black.svg", mark: "/brand/ozituma-mark-black.svg" },
  white: { light: "/brand/ozituma-horizontal-white.svg", mark: "/brand/ozituma-mark-white.svg" },
} as const;

export type MarkVariant = keyof typeof MARK;

export function OzitumaMark({
  compact = false,
  variant = "color",
}: {
  compact?: boolean;
  variant?: MarkVariant;
}) {
  /*
   * Lockup choice follows the kit's minimum sizes: the horizontal lockup is legible from 120 px and
   * the mark alone from 32 px, so compact placements take the mark. The favicon covers anything
   * smaller, which is the tab.
   */
  const src = compact ? MARK[variant].mark : MARK[variant].light;

  return (
    <span className="flex items-center gap-3">
      <img
        src={src}
        alt="Ozituma"
        /* Height is fixed and width left auto so the lockup keeps its aspect ratio and is never
           stretched — the guide forbids distorting it. */
        className={compact ? "size-9" : "h-9 w-auto"}
      />
      {/*
        "Learn" alone, by the owner's instruction; it names this application rather than the company, and the official lockups carry
        "Ozituma" only. It is kept as live text so it stays translatable — an outlined wordmark
        cannot be — and it sits beside the lockup rather than inside it, so the mark itself is never
        modified.
      */}
      {!compact && (
        <span className="hidden flex-col leading-none sm:flex">
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Learn
          </span>
        </span>
      )}
    </span>
  );
}
