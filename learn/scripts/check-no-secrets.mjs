/**
 * Fail if a secret is in the working tree.
 *
 * WHY THIS WAS REWRITTEN
 *
 * The first version scanned five directories RELATIVE TO `staging/learn` -- `src`, `scripts`,
 * `public`, `drizzle`, `docs` -- and reported "no secrets in tracked files". It was wrong. A Stripe
 * test key sat at `staging/docs/reference/igbo-api-analysis-raw.md`, one directory above the scan
 * root, and the guard never looked there. GitHub's push protection found it instead, and refused
 * the push.
 *
 * A guard that reports success over a range it never examined is worse than no guard: it converts
 * "unchecked" into "verified". That is the same failure as the cache check that passed against a
 * worker with the guard deleted.
 *
 * WHAT IT DOES NOW
 *
 * Uses `git ls-files` from the REPOSITORY ROOT, so the range is "everything git tracks" -- which is
 * exactly the range that gets pushed. Untracked and ignored files are excluded automatically,
 * because they cannot leak through a commit.
 *
 * RUN FROM THE LEARN APP, as the CI does; it walks up to find the repository root itself, so it
 * cannot be pointed at the wrong directory by where it happens to be invoked.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

/** Walk up until we find the repository root, then list everything git tracks from there. */
function trackedFiles() {
  let dir = resolve(".");
  for (let i = 0; i < 8; i++) {
    try {
      execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, stdio: "pipe" });
      break;
    } catch {
      const up = resolve(dir, "..");
      if (up === dir) throw new Error("not inside a git repository");
      dir = up;
    }
  }
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8" }).trim();
  const list = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { root, files: list.split("\n").filter(Boolean) };
}

/** A secret is only checked in files that could hold one. Binaries are skipped. */
const TEXT = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", ".json", ".jsonc", ".sql", ".md", ".toml",
  ".yml", ".yaml", ".html", ".css", ".txt", ".env", ".example", ".sh", ".py", ".conf", ".ini",
]);

/**
 * Patterns that are secrets wherever they appear.
 *
 * `sk_live_` and `sk_test_` are both listed. A test key is lower risk but it is still a credential,
 * GitHub still blocks it, and the distinction is not this check's to make.
 */
const PATTERNS = [
  [/sk_live_[A-Za-z0-9]{10,}/, "Stripe LIVE secret key"],
  [/sk_test_[A-Za-z0-9]{10,}/, "Stripe test secret key"],
  [/sk-proj-[A-Za-z0-9_-]{20,}/, "OpenAI project key"],
  [/sb_secret_[A-Za-z0-9_-]{10,}/, "Supabase service-role key"],
  [/sbp_[a-f0-9]{20,}/, "Supabase personal access token"],
  [/\bre_[A-Za-z0-9]{20,}/, "Resend API key"],
  [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./, "JWT"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/AKIA[0-9A-Z]{16}/, "AWS access key id"],
  [/ghp_[A-Za-z0-9]{30,}/, "GitHub personal access token"],
  [/\blbr_[a-f0-9]{32,}/, "Ozituma learn-bridge secret"],
];

/**
 * Publishable keys are deliberately NOT flagged. A `pk_`/`sb_publishable_` key is designed to ship
 * in a client bundle; flagging it would train people to ignore this script.
 */

/**
 * Known and ALLOWED, with the reason. Anything listed here is a deliberate decision, not an
 * oversight -- which is the point: an exception that has to be written down cannot be forgotten.
 *
 *  - `docs/reference/igbo-api-analysis-raw.md` is a raw dump of an external API exploration, kept
 *    for the record. It contains a Stripe TEST key (`sk_test_`), which cannot move money. The owner
 *    reviewed and allowed it through GitHub push protection on 2026-10-01.
 *
 * A real (live) secret must never be added here. If one appears, rotate it.
 */
const ALLOWED = [
  { path: "docs/reference/igbo-api-analysis-raw.md", label: "Stripe test secret key" },
];

const { root, files } = trackedFiles();
const findings = [];
const allowed_hits = [];

for (const rel of files) {
  const ext = rel.slice(rel.lastIndexOf("."));
  if (!TEXT.has(ext)) continue;

  const full = join(root, rel);
  let content;
  try {
    if (statSync(full).size > 4 * 1024 * 1024) continue; // a 4 MB text file is data, not source
    content = readFileSync(full, "utf8");
  } catch {
    continue; // deleted between listing and reading
  }

  for (const [re, label] of PATTERNS) {
    const m = content.match(re);
    if (!m) continue;
    // An already-rotated key may be kept for the record, but it must SAY so nearby.
    const around = content.slice(Math.max(0, (m.index ?? 0) - 160), (m.index ?? 0) + 160);
    if (/REVOKED|ROTATED|example|placeholder|redacted/i.test(around)) continue;
    const line = content.slice(0, m.index ?? 0).split("\n").length;
    const allowed = ALLOWED.some((a) => rel.endsWith(a.path) && a.label === label);
    if (allowed) {
      allowed_hits.push(`${rel}:${line}  ${label}`);
      continue;
    }
    findings.push(`${relative(process.cwd(), full) || rel}:${line}  ${label}`);
  }
}

console.log(`  scanned ${files.length} tracked file(s) from ${relative(process.cwd(), root) || "."}`);
for (const a of allowed_hits) console.log(`  allowed (documented): ${a}`);
if (findings.length) {
  console.error("\n  Secrets found:\n" + findings.map((f) => "    " + f).join("\n"));
  console.error("\n  Remove the secret and ROTATE IT. Deleting the commit does not unpublish it.");
  process.exit(1);
}
console.log("  no secrets in tracked files");
