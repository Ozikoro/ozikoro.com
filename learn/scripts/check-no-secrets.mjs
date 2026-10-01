/**
 * Fail if a secret is committed.
 *
 * WHY THIS CHECK EXISTS
 *
 * The project rule is "no secrets in the repo", and it has already been broken once: a Supabase
 * service-role key and a publishable key were hardcoded into a probe script in this directory. They
 * were removed, but nothing stopped the next one.
 *
 * A service-role key bypasses row-level security on every table. Committed, it is a full database
 * compromise that cannot be undone by deleting the commit — the key is already public. So this runs
 * on every push.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOTS = ["src", "scripts", "public", "drizzle", "docs"];
const TEXT = new Set([".ts", ".tsx", ".js", ".mjs", ".jsx", ".json", ".sql", ".md", ".toml", ".yml", ".yaml", ".html", ".css", ".txt"]);

/** Patterns that are secrets wherever they appear. */
const PATTERNS = [
  [/sb_secret_[A-Za-z0-9_-]{10,}/, "Supabase service-role key"],
  [/sbp_[a-f0-9]{20,}/, "Supabase personal access token"],
  [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./, "JWT"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
];

/**
 * `sb_publishable_` is deliberately NOT flagged: a publishable key is designed to be public and ships
 * in the client bundle. Flagging it would train people to ignore this script.
 */

const findings = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return; // an absent root is not a failure
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".output" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (!TEXT.has(extname(name))) continue;

    const content = readFileSync(full, "utf8");
    for (const [re, label] of PATTERNS) {
      const m = content.match(re);
      // A probe script may legitimately carry a key that has already been revoked; it must say so.
      if (m && !/REVOKED|ROTATED|example|placeholder/i.test(content.slice(Math.max(0, m.index - 120), m.index + 120))) {
        findings.push(`${full}: ${label}`);
      }
    }
  }
}

for (const root of ROOTS) walk(root);

if (findings.length) {
  console.error("  Secrets found in tracked files:\n" + findings.map((f) => "    " + f).join("\n"));
  console.error("\n  Remove the secret and ROTATE IT. Deleting the commit does not unpublish it.");
  process.exit(1);
}
console.log("  no secrets in tracked files");
