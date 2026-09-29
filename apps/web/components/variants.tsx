import type { ReactNode } from 'react';

/**
 * The variant disclosures.
 *
 * Shared by the word entry page and the name entry page so that a variant reads
 * the same way in both places — the owner asked for name variants to be
 * presented like the dialect variants, and one component is the only way to
 * keep that true as either page changes.
 *
 * A native <details>, not a button holding state:
 *
 *   - the variants are in the HTML the server sends, so they are reachable with
 *     no JavaScript, which is the standard the contribution forms are held to
 *   - the label swap is CSS, not a re-render, which is why both spellings of the
 *     label are in the markup at once and only one is visible
 */

function Disclosure({
  noun,
  className,
  children,
}: {
  noun: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details className={className ? `variant-disclosure ${className}` : 'variant-disclosure'}>
      <summary className="variant-toggle">
        <span className="label-closed">Show {noun}</span>
        <span className="label-open">Hide {noun}</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      {children}
    </details>
  );
}

/** Spellings of the name within the same language. */
export function VariantDisclosure({
  variants,
  noun = 'spelling variants',
  className,
}: {
  variants: readonly string[];
  /** What the toggle says it is showing, e.g. "spelling variants". */
  noun?: string;
  className?: string;
}) {
  if (variants.length === 0) return null;

  return (
    <Disclosure noun={noun} className={className}>
      <ul className="variant-chips">
        {variants.map((variant) => (
          <li className="variant-chip" key={variant}>
            {variant}
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

/**
 * Forms of the same name in a neighbouring Igbo variety.
 *
 * Separate from the spellings above because the distinction is real and the
 * owner asked for it: *Wike* is not a misspelling of *Nwike*, it is how Ikwerre
 * writes the same name. So each chip carries the variety it belongs to rather
 * than being flattened into a list of spellings.
 */
export function VarietyFormDisclosure({
  forms,
  noun = 'forms in other varieties',
  className,
}: {
  forms: readonly { form: string; variety: string }[];
  noun?: string;
  className?: string;
}) {
  if (forms.length === 0) return null;

  /*
   * Grouped by form, because the data is one row per form-per-variety and the
   * page should not read like a database. Ovunda is recorded against both
   * Ikwerre and Ohaji, and "Ovunda · Ikwerre, Ohaji" says that once; two chips
   * repeating the word Ovunda would not.
   */
  const byForm = new Map<string, string[]>();
  for (const entry of forms) {
    byForm.set(entry.form, [...(byForm.get(entry.form) ?? []), entry.variety]);
  }

  return (
    <Disclosure noun={noun} className={className}>
      <ul className="variant-chips">
        {[...byForm].map(([form, varieties]) => (
          <li className="variant-chip" key={form}>
            {form}
            <span className="variant-chip-note"> · {varieties.join(', ')}</span>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}
