/**
 * Fail if the audio pipeline stops resolving.
 *
 * WHY THIS CHECK EXISTS
 *
 * "Native audio pipeline" is an MVP deliverable and the app is worthless without it — a learner taps
 * a word and needs to hear it. The URLs point at Cloudflare R2 through `media.ozituma.com`, and a
 * bucket rename, a DNS change or a missing object turns every one of them into a silent failure that
 * looks exactly like a word with no recording.
 *
 * SAMPLED, NOT EXHAUSTIVE: checking 30,028 objects on every run would be slow and would hammer the
 * bucket. A random sample catches a systemic break (bucket gone, DNS wrong, permissions changed)
 * which is the failure that actually happens. A single missing file is not caught, and that is the
 * right trade — the fix for one missing file is to re-upload it, not to fail a build.
 *
 * ALSO CHECKS THE FORMAT MIX. 242 word recordings are `.webm` against 255 `.mp3`. An app that assumed
 * mp3 would silently lose half the word audio, so the sample asserts the type is audio at all rather
 * than a specific subtype.
 */
const TOKEN = process.env["SUPABASE_MANAGEMENT_TOKEN"];
const REF = process.env["SUPABASE_PROJECT_REF"];
const SAMPLE = Number(process.env["AUDIO_SAMPLE"] ?? 12);

if (!TOKEN || !REF) {
  console.log("  skipped: no SUPABASE_MANAGEMENT_TOKEN / SUPABASE_PROJECT_REF (runs in the data job)");
  process.exit(0);
}

const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return r.json();
};

const rows = await q(`
  (select audio_url from public.lexeme_examples where audio_url is not null and status='published' order by random() limit ${SAMPLE})
  union all
  (select audio_url from public.lexemes where audio_url is not null and status='published' order by random() limit ${SAMPLE})
`);

if (!Array.isArray(rows) || rows.length === 0) {
  console.error("  could not sample audio URLs — cannot verify the pipeline");
  process.exit(1);
}

let ok = 0;
const failures = [];
for (const { audio_url } of rows) {
  try {
    const head = await fetch(audio_url, { method: "HEAD" });
    const type = head.headers.get("content-type") ?? "";
    if (head.ok && type.startsWith("audio/")) ok++;
    else failures.push(`${head.status} ${type} ${audio_url}`);
  } catch (e) {
    failures.push(`${e.message} ${audio_url}`);
  }
}

console.log(`  audio reachable: ${ok}/${rows.length}`);
for (const f of failures) console.log(`    FAIL ${f}`);

if (ok < rows.length) {
  console.error("\n  Audio does not resolve. Every failure looks like a word with no recording.");
  process.exit(1);
}
