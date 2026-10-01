/**
 * Fail if a brand asset has drifted from the official kit.
 *
 * WHY THIS CHECK EXISTS
 *
 * The logo, favicons and manifest icons are the OWNER'S BRAND, not this project's artwork. They were
 * copied from `Documents/ozituma-brand-kit 2` and are byte-identical to it — verified, all 18 of them.
 *
 * That is a property worth freezing. A brand asset is unusually easy to damage without noticing: an
 * optimiser run, an editor that rewrites the SVG on save, or a well-meaning redraw all produce a file
 * that still LOOKS right at 36px and is no longer the approved mark. The guide forbids distorting or
 * recolouring it, and a checksum is the only way to hold that line.
 *
 * CHECKED AGAINST RECORDED HASHES, not against the kit directory: the kit lives in the owner's
 * Documents folder, which is not present in CI and should not need to be.
 *
 * `--record` rewrites the hashes. That is the ONLY correct way to accept a new asset, and it should
 * follow a deliberate re-copy from the kit rather than an edit to the file in place.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const BRAND = "public/brand";
const RECORD = join(BRAND, ".checksums.json");

const ASSETS = [
  ...readdirSync(BRAND).filter((f) => f.endsWith(".svg")).map((f) => join(BRAND, f)),
  "public/favicon.svg",
  "public/favicon-32x32.png",
  "public/apple-touch-icon.png",
  "public/android-chrome-192x192.png",
  "public/android-chrome-512x512.png",
].filter((f) => existsSync(f));

const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

if (process.argv.includes("--record")) {
  const recorded = {};
  for (const f of ASSETS) recorded[basename(f)] = hash(f);
  writeFileSync(RECORD, JSON.stringify(recorded, null, 2) + "\n");
  console.log(`  recorded ${ASSETS.length} brand assets`);
  process.exit(0);
}

const expected = JSON.parse(readFileSync(RECORD, "utf8"));
const drifted = [];
let ok = 0;

for (const f of ASSETS) {
  const want = expected[basename(f)];
  if (!want) continue;
  if (hash(f) === want) ok++;
  else drifted.push(basename(f));
}

console.log(`  brand assets unchanged: ${ok}/${Object.keys(expected).filter((k) => !k.startsWith("_")).length}`);
for (const d of drifted) console.log(`    DRIFTED ${d}`);

if (drifted.length) {
  console.error(
    "\n  A brand asset no longer matches the official kit.\n" +
      "  Re-copy it from 'Documents/ozituma-brand-kit 2' rather than editing it,\n" +
      "  then run: node scripts/check-brand-kit.mjs --record"
  );
  process.exit(1);
}
