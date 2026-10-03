/**
 * Turn one published record into a publication PDF.
 *
 * **This file is only a runner.** The mapping from article to layout lives in `apps/ozikoro/lib/publication.ts`
 * and the layout itself in `packages/ozikoro/src/pdf/`, because the download route needs both and **two copies
 * of one job is how the narration ended up chunking on one path and failing on the other.**
 *
 * Usage: node scripts/generate-pdf.ts <slug> [--out=path]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { closeDb } from '@ozituma/db/client';
import { buildPublication } from '../apps/ozikoro/lib/publication.ts';

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
const outArg = args.find((a) => a.startsWith('--out='))?.split('=')[1];
if (!slug) {
  console.error('  usage: node scripts/generate-pdf.ts <slug> [--out=path]');
  process.exit(2);
}

const built = await buildPublication(slug);
if (!built) {
  console.error(`  no published record "${slug}"`);
  await closeDb();
  process.exit(2);
}

const out = outArg ?? join(process.cwd(), 'data', 'publications', `${slug}.pdf`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, built.pdf);
console.log(`  ${built.title.slice(0, 58)}`);
console.log(`  ${(built.pdf.length / 1024).toFixed(0)} KB → ${out.replace(process.cwd() + '/', '')}`);
await closeDb();
