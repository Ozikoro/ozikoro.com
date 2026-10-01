/**
 * The project's non-negotiables, checked against the LIVE DATABASE.
 *
 * WHY AGAINST THE DATABASE AND NOT THE SOURCE
 *
 * These are properties of the CONTENT, not of the code. A codebase can be perfectly correct while the
 * data violates every rule — and that is not hypothetical: "NFC everywhere" was held in the client
 * while 95% of the corpus sat in NFD, and only a query found it.
 *
 * The same blindness applies to each rule below. `ai_generated` is a column; nothing in `src/` can
 * tell you whether a published row carries it.
 *
 * WHAT EACH CHECK MEANS
 *
 *   AI never authors published content  — a published row with `ai_generated` is the exact thing the
 *                                          project forbids. Must be zero, and stays zero.
 *   No invented Igbo / provenance        — every published word is attributed to a corpus. An
 *                                          unattributed word is one nobody can trace.
 *   Central Igbo only                    — a published dialect-tagged word, or audio attached to
 *                                          one, breaks the owner's standing instruction. The AUDIO
 *                                          check is the one that matters: the dictionary stores
 *                                          dialect PRONUNCIATIONS, so excluding dialectal words is
 *                                          not by itself sufficient.
 *   Linguist sign-off                    — published with no reviewer_id means it bypassed review.
 *
 * "No scraping" is checked by listing the sources rather than asserting on them: they are documented
 * open corpora, and printing them each run makes a NEW source appear in the log rather than pass
 * silently.
 */
const TOKEN = process.env["SUPABASE_MANAGEMENT_TOKEN"];
const REF = process.env["SUPABASE_PROJECT_REF"];

if (!TOKEN || !REF) {
  console.log("  skipped: no SUPABASE_MANAGEMENT_TOKEN / SUPABASE_PROJECT_REF (runs in the data job)");
  process.exit(0);
}

const QUERY = `
  select
    (select count(*)::int from public.lexemes where ai_generated is true and status = 'published')
      as ai_published,
    (select count(*)::int from public.lexemes where status = 'published' and source is null)
      as published_no_source,
    (select count(*)::int from public.lexemes where status = 'published' and dialect is not null)
      as dialect_published,
    (select count(*)::int from public.lexeme_examples
      where lexeme_id in (select id from public.lexemes where dialect is not null))
      as dialect_audio,
    (select count(*)::int from public.lexemes where status = 'published' and reviewer_id is null)
      as unreviewed_published,
    (select string_agg(distinct source, ' || ') from public.lexemes where source is not null)
      as sources
`;

const response = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: QUERY }),
});

const row = (await response.json())[0];
if (!row) {
  console.error("  query returned nothing — cannot verify the non-negotiables");
  process.exit(1);
}

const checks = [
  ["AI has not authored published content", row.ai_published === 0, row.ai_published],
  ["every published word has a source", row.published_no_source === 0, row.published_no_source],
  ["no dialect words are published", row.dialect_published === 0, row.dialect_published],
  ["no audio is attached to a dialect word", row.dialect_audio === 0, row.dialect_audio],
  ["no published word bypassed review", row.unreviewed_published === 0, row.unreviewed_published],
];

let failed = 0;
for (const [name, ok, count] of checks) {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : `  (${count} rows)`}`);
  if (!ok) failed++;
}

console.log(`\n  sources in the corpus:`);
for (const s of String(row.sources ?? "").split(" || ")) console.log(`    ${s}`);

if (failed) {
  console.error(`\n  ${failed} non-negotiable(s) violated. This is a content problem, not a code one.`);
  process.exit(1);
}
