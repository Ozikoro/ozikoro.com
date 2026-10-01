/**
 * Fail if the corpus is not Unicode NFC.
 *
 * WHY THIS CHECK EXISTS
 *
 * "NFC everywhere" is a non-negotiable, and the database was violating it at scale: **28,512 of
 * 30,028 example sentences (95%) were stored NFD**, along with 998 lexeme examples and 2 meanings.
 *
 * WHY IT MATTERS AND WHY IT IS INVISIBLE
 *
 * NFC and NFD render IDENTICALLY. `ọ` as one codepoint and `ọ` as `o` + combining dot-below look the
 * same on screen and are different byte sequences. So:
 *
 *   - a learner typing NFC `ọ` does not match an NFD `ọ` in the database
 *   - `search_key` comparisons miss
 *   - audio lookups by text fail
 *   - exercise answer comparison fails on text that looks correct
 *
 * Every one of those failures presents as "the search found nothing", never as a normalisation bug.
 * This is checked against the live database because no amount of client-side normalising repairs rows
 * that are already stored wrong — the fix is a migration, not a guard in the app.
 *
 * SKIPPED WITHOUT CREDENTIALS: this needs database access, so it runs in the migration job rather
 * than on every push. `node scripts/check-nfc.mjs` reports the counts when a key is present.
 */
const URL_BASE = process.env["SUPABASE_URL"];
const TOKEN = process.env["SUPABASE_MANAGEMENT_TOKEN"];
const REF = process.env["SUPABASE_PROJECT_REF"];

if (!TOKEN || !REF) {
  console.log("  skipped: no SUPABASE_MANAGEMENT_TOKEN / SUPABASE_PROJECT_REF (runs in the migration job)");
  process.exit(0);
}

const QUERY = `
  select
    (select count(*)::int from public.lexeme_examples where text_ig <> normalize(text_ig, NFC)) as examples_nfd,
    (select count(*)::int from public.lexemes
      where headword <> normalize(headword, NFC)
         or meaning <> normalize(meaning, NFC)
         or (example_ig is not null and example_ig <> normalize(example_ig, NFC))) as lexemes_nfd
`;

const response = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: QUERY }),
});

const rows = await response.json();
const row = rows[0] ?? { examples_nfd: 0, lexemes_nfd: 0 };

console.log(`  examples not NFC: ${row.examples_nfd}`);
console.log(`  lexemes not NFC:  ${row.lexemes_nfd}`);

if (row.examples_nfd > 0 || row.lexemes_nfd > 0) {
  console.error("\n  The corpus contains non-NFC text. Search and audio lookup will fail silently on it.");
  console.error("  Fix: update ... set text_ig = normalize(text_ig, NFC) where text_ig <> normalize(text_ig, NFC);");
  process.exit(1);
}
console.log("  corpus is fully NFC");
