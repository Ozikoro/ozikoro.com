/**
 * The design's OzitumaMark, ported as written.
 *
 * A green disc with the initial, a coral dot on its shoulder, and the two-line wordmark. The dot is
 * `border-background` so it punches a hole in the disc edge rather than sitting on top of it, which
 * is why it reads as a mark rather than a badge with a sticker.
 */
export function OzitumaMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3" aria-label="Ozituma Learn Igbo">
      <span className="relative grid size-10 place-items-center rounded-full bg-brand text-sm font-black text-brand-foreground shadow-sm">
        O
        <span className="absolute -right-0.5 top-0 size-2.5 rounded-full border-2 border-background bg-highlight" />
      </span>
      {!compact && (
        <span className="leading-none">
          <span className="block font-display text-lg font-bold text-foreground">Ozituma</span>
          <span className="mt-1 block text-[10px] font-bold uppercase text-muted-foreground">
            Learn Igbo
          </span>
        </span>
      )}
    </div>
  );
}
