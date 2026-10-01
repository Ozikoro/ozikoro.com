/**
 * Keyboard layouts for the on-screen keyboard demo. Pure data so the same
 * definitions can later generate desktop (Keyman/.klc/XKB) and mobile
 * (Android IME / iOS extension) keyboards.
 *
 * Igbo behaviour follows the Edémédé keyboard (github.com/chrisemezue/edemede.github.io,
 * Apache-2.0, by Chris C. Emezue and Handel C. Emezue): Shift + vowel cycles the
 * dotted / low-tone / high-tone forms. This is a fresh implementation, not a copy of its code.
 */
export type KeyboardId = "igbo" | "ndebe" | "english";

export type KeyDef = { label: string; insert?: string; action?: "shift" | "backspace" | "space" | "enter"; wide?: boolean; hint?: string };

const row = (s: string): KeyDef[] => s.split(" ").map((c) => ({ label: c }));

const actionsBottom: KeyDef[] = [{ label: "space", action: "space", wide: true }, { label: "⏎", action: "enter" }];

/** Shift + vowel cycles through these forms in order (NFC). */
export const igboVowelCycles: Record<string, readonly string[]> = {
  a: ["ạ", "à", "á"],
  e: ["ẹ", "è", "é"],
  i: ["ị", "ì", "í"],
  o: ["ọ", "ò", "ó"],
  u: ["ụ", "ù", "ú"],
  n: ["ṅ", "ǹ", "ń"],
  m: ["m̀", "ḿ"],
};

/** Extra Igbo characters from the Edémédé layout (tone-marked dotted vowels, macron mid-tone, syllabic nasals). */
export const igboExtraKeys: readonly string[] = [
  "ị", "ọ", "ụ", "ṅ", "ạ", "ẹ",
  "à", "á", "è", "é", "ì", "í", "ò", "ó", "ù", "ú",
  "ọ̀", "ọ́", "ụ̀", "ụ́", "ị̀", "ị́",
  "ā", "ē", "ī", "ō", "ū",
  "ǹ", "ń", "n̄", "m̀", "ḿ",
];

export const keyboardLayouts: Record<KeyboardId, { name: string; note: string; rows: KeyDef[][] }> = {
  igbo: {
    name: "Igbo",
    note: "Standard Igbo letters. Press Shift + a vowel (or n/m) on a computer keyboard to cycle ị → ì → í, etc.",
    rows: [
      row("q w e r t y u i o p"),
      [...row("a s d f g h j k l")],
      [{ label: "⇧", action: "shift" }, ...row("z c v b n m"), { label: "⌫", action: "backspace" }],
      [{ label: "ị" }, { label: "ọ" }, { label: "ụ" }, { label: "ṅ" }, ...actionsBottom],
    ],
  },
  english: {
    name: "English",
    note: "Plain QWERTY layout.",
    rows: [
      row("q w e r t y u i o p"),
      row("a s d f g h j k l"),
      [{ label: "⇧", action: "shift" }, ...row("z x c v b n m"), { label: "⌫", action: "backspace" }],
      [{ label: "," }, { label: "." }, ...actionsBottom],
    ],
  },
  ndebe: {
    name: "Ńdẹ́bẹ́",
    /*
     * The real script, from the real map.
     *
     * This layout used to insert bracket notation — `[NW]`, `[GB]` — under the note "Prototype
     * notation ... until the licensed font and verified key-to-glyph map are supplied". Both are
     * supplied now:
     *
     *   fonts  self-hosted at /fonts/, SHA-256 verified against the ndebeproject/ndebe-fonts
     *          FONT-MANIFEST.json ("approved 2026-09-24 release candidate"), mapping U+E100..U+E96E
     *   map    typendebe.com's own `input-data.js`, which defines 1,134 syllables
     *
     * Every key below inserts a genuine codepoint, and all 1,184 distinct codepoints in the map sit
     * inside the font's range — so each one renders rather than showing a tofu box.
     *
     * 42 base consonants × 5 vowels × 4 tones. The first rows are the consonants, each inserting its
     * `-a` form; the last two rows are vowels and tones. The full tables are in ndebe-input-data.ts.
     */
    note: "The Ńdẹ́bẹ́ script. Keys insert real glyphs, rendered by the official font.",
    rows: [
        [{ label: "nw", insert: "\u{e500}", hint: "nw" }, { label: "gb", insert: "\u{e51b}", hint: "gb" }, { label: "kp", insert: "\u{e536}", hint: "kp" }, { label: "b", insert: "\u{e551}", hint: "b" }, { label: "p", insert: "\u{e56c}", hint: "p" }, { label: "ny", insert: "\u{e587}", hint: "ny" }, { label: "m", insert: "\u{e5a2}", hint: "m" }],
        [{ label: "gv", insert: "\u{e5bd}", hint: "gv" }, { label: "g", insert: "\u{e5d9}", hint: "g" }, { label: "nly", insert: "\u{e5f4}", hint: "nly" }, { label: "gw", insert: "\u{e60f}", hint: "gw" }, { label: "k", insert: "\u{e62a}", hint: "k" }, { label: "kw", insert: "\u{e645}", hint: "kw" }, { label: "n", insert: "\u{e660}", hint: "n" }],
        [{ label: "rh", insert: "\u{e67b}", hint: "rh" }, { label: "d", insert: "\u{e696}", hint: "d" }, { label: "lr", insert: "\u{e6b1}", hint: "lr" }, { label: "yh", insert: "\u{e6cc}", hint: "yh" }, { label: "r", insert: "\u{e6e7}", hint: "r" }, { label: "y", insert: "\u{e702}", hint: "y" }, { label: "l", insert: "\u{e71d}", hint: "l" }],
        [{ label: "fhsh", insert: "\u{e738}", hint: "fhsh" }, { label: "ch", insert: "\u{e753}", hint: "ch" }, { label: "rsh", insert: "\u{e76e}", hint: "rsh" }, { label: "jz", insert: "\u{e789}", hint: "jz" }, { label: "ssh", insert: "\u{e7a4}", hint: "ssh" }, { label: "j", insert: "\u{e7bf}", hint: "j" }, { label: "bv", insert: "\u{e7da}", hint: "bv" }],
        [{ label: "s", insert: "\u{e7f5}", hint: "s" }, { label: "t", insert: "\u{e810}", hint: "t" }, { label: "fp", insert: "\u{e82b}", hint: "fp" }, { label: "f", insert: "\u{e846}", hint: "f" }, { label: "z", insert: "\u{e861}", hint: "z" }, { label: "bw", insert: "\u{e87c}", hint: "bw" }, { label: "st", insert: "\u{e897}", hint: "st" }],
        [{ label: "fv", insert: "\u{e8b2}", hint: "fv" }, { label: "ygh", insert: "\u{e8cd}", hint: "ygh" }, { label: "rf", insert: "\u{e8e8}", hint: "rf" }, { label: "w", insert: "\u{e903}", hint: "w" }, { label: "wgh", insert: "\u{e91e}", hint: "wgh" }, { label: "nyn", insert: "\u{e939}", hint: "nyn" }, { label: "nwn", insert: "\u{e954}", hint: "nwn" }],
        [{ label: "a", insert: "\u{e500}", hint: "vowel a" }, { label: "e", insert: "\u{e50f}", hint: "vowel e" }, { label: "i", insert: "\u{e512}", hint: "vowel i" }, { label: "o", insert: "\u{e515}", hint: "vowel o" }, { label: "u", insert: "\u{e518}", hint: "vowel u" }],
        [{ label: "enu", insert: "\u{e500}", hint: "tone enu" }, { label: "ntela", insert: "\u{e501}", hint: "tone ntela" }, { label: "ani", insert: "\u{e502}", hint: "tone ani" }],
      [...actionsBottom],
    ],
  },
};

/** Cycle the character before the caret when Shift + vowel is pressed. Returns null if not applicable. */
export function cycleIgboVowel(before: string, key: string): { replaceLast: boolean; insert: string } {
  const cycle = igboVowelCycles[key.toLowerCase()];
  if (!cycle) return { replaceLast: false, insert: key };
  const last = [...before.normalize("NFC")].pop() ?? "";
  const idx = cycle.indexOf(last);
  if (idx >= 0) return { replaceLast: true, insert: cycle[(idx + 1) % cycle.length]! };
  return { replaceLast: false, insert: cycle[0]! };
}
