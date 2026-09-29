/**
 * Download the gated CC-BY-4.0 Igbo audio corpora from Hugging Face.
 *
 *   node scripts/fetch-audio.ts            # download everything missing
 *   node scripts/fetch-audio.ts --limit 50 # smoke test
 *   node scripts/fetch-audio.ts --manifest # only write the manifest, no audio
 *
 * WHY A SCRIPT RATHER THAN `huggingface-cli download`
 *
 * Two reasons. The datasets are gated, so every request needs the token header —
 * easy either way. But 24,013 files at ~10-30 KB each is a request-per-file
 * workload that benefits from concurrency, resumability and a manifest we
 * control; the CLI fetches the whole tree including duplicates of the metadata
 * we already have, and gives no progress signal we can act on.
 *
 * Resumability matters because this is a long download over a network that will
 * hiccup: a file that already exists at the expected size is skipped, so
 * re-running is cheap and safe.
 *
 * SETUP: put the token in HF_TOKEN, or in a file and point HF_TOKEN_FILE at it.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SOURCE_DIR = join(ROOT, 'data', 'sources', 'ibodict');
const AUDIO_DIR = join(SOURCE_DIR, 'audio');
const MANIFEST = join(SOURCE_DIR, 'audio-manifest.json');

const DATASETS = [
  { repo: 'nkowaokwu/ibo-dict', metadata: 'ibo-dict.json' },
  { repo: 'nkowaokwu/ibo-dict-expansion', metadata: 'igbo-dict.json' },
];

const CONCURRENCY = Number(process.env.HF_CONCURRENCY ?? 8);
const MAX_ATTEMPTS = 4;

interface AudioRef {
  /** Dataset the file belongs to. */
  repo: string;
  /** Path inside the repo, e.g. audio/archive-0/abc.mp3 */
  path: string;
  /** What this recording is a recording OF. */
  kind: 'word' | 'dialect' | 'sentence';
  /** Headword (or sentence text) it belongs to. */
  label: string;
  /** Dialect name, for dialect recordings. */
  dialect?: string;
}

async function readToken(): Promise<string> {
  const direct = process.env.HF_TOKEN?.trim();
  if (direct) return direct;

  const tokenFile = process.env.HF_TOKEN_FILE?.trim();
  if (tokenFile) {
    return (await readFile(tokenFile, 'utf8')).trim();
  }
  throw new Error(
    'No Hugging Face token. Set HF_TOKEN, or HF_TOKEN_FILE to a file containing it.\n' +
      'The audio corpora are gated, so an anonymous request returns HTTP 401.'
  );
}

/** Collect every audio path the metadata refers to. */
function collectRefs(repo: string, metadata: unknown): AudioRef[] {
  const refs: AudioRef[] = [];
  if (!Array.isArray(metadata)) return refs;

  for (const entry of metadata as Record<string, unknown>[]) {
    const label = String(entry.word ?? entry.igbo ?? '').trim();

    const base = entry.pronunciation;
    if (typeof base === 'string' && base.trim()) {
      refs.push({ repo, path: base.trim(), kind: entry.word ? 'word' : 'sentence', label });
    }

    for (const dialect of (entry.dialects as Record<string, unknown>[] | undefined) ?? []) {
      const path = dialect.pronunciation;
      if (typeof path !== 'string' || !path.trim()) continue;
      const names = (dialect.dialects as string[] | undefined) ?? [];
      refs.push({
        repo,
        path: path.trim(),
        kind: 'dialect',
        label: String(dialect.word ?? label).trim(),
        dialect: names[0],
      });
    }
  }
  return refs;
}

async function existsWithSize(path: string, expected?: number): Promise<boolean> {
  try {
    const info = await stat(path);
    if (info.size === 0) return false;
    // A size mismatch means a truncated earlier attempt; refetch it.
    return expected === undefined ? true : info.size === expected;
  } catch {
    return false;
  }
}

async function fetchOne(token: string, ref: AudioRef): Promise<'skipped' | 'downloaded' | 'failed'> {
  const dest = join(AUDIO_DIR, ref.repo, ref.path);
  if (await existsWithSize(dest)) return 'skipped';

  const url = `https://huggingface.co/datasets/${ref.repo}/resolve/main/${ref.path}`;
  await mkdir(dirname(dest), { recursive: true });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'follow',
      });
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `HTTP ${response.status}: the token is not authorised for ${ref.repo}. ` +
            'Accept the dataset terms on its Hugging Face page first.'
        );
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0) throw new Error('empty response');
      await writeFile(dest, bytes);
      return 'downloaded';
    } catch (error) {
      const isLast = attempt === MAX_ATTEMPTS;
      if (isLast) {
        console.error(`\n  ! ${ref.path}: ${error instanceof Error ? error.message : error}`);
        return 'failed';
      }
      // Exponential backoff; the hub rate-limits bursts.
      await new Promise((r) => setTimeout(r, 2 ** attempt * 250));
    }
  }
  return 'failed';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : undefined;
  const manifestOnly = args.includes('--manifest');

  const token = manifestOnly ? '' : await readToken();

  console.log('\nCollecting audio references\n');
  const allRefs: AudioRef[] = [];

  for (const dataset of DATASETS) {
    const metadataPath = join(SOURCE_DIR, `${dataset.repo.split('/')[1]}.json`);
    let metadata: unknown;
    try {
      metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    } catch {
      console.error(
        `  ! ${metadataPath} not found. Download the dataset metadata first ` +
          `(see data/sources/README.md).`
      );
      continue;
    }
    const refs = collectRefs(dataset.repo, metadata);
    allRefs.push(...refs);
    console.log(`  ${dataset.repo.padEnd(30)} ${refs.length} recordings`);
  }

  // De-duplicate: the same path can be referenced twice within one dataset.
  const unique = new Map<string, AudioRef>();
  for (const ref of allRefs) unique.set(`${ref.repo}/${ref.path}`, ref);
  const refs = [...unique.values()];
  console.log(`\n  unique recordings: ${refs.length}`);

  const byKind = refs.reduce<Record<string, number>>((acc, r) => {
    acc[r.kind] = (acc[r.kind] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`  by kind: ${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(', ')}`);

  // The manifest is what the importer reads: it maps an audio file to the word
  // and dialect it belongs to, which the bare audio folder cannot express.
  await writeFile(MANIFEST, JSON.stringify({ generatedAt: new Date().toISOString(), refs }, null, 2));
  console.log(`\n  manifest written: ${MANIFEST}`);

  if (manifestOnly) {
    console.log('');
    return;
  }

  const queue = limit && limit > 0 ? refs.slice(0, limit) : refs;
  console.log(`\nDownloading ${queue.length} file(s) with concurrency ${CONCURRENCY}\n`);

  const started = Date.now();
  let done = 0;
  let skipped = 0;
  let failed = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= queue.length) return;

      const ref = queue[index]!;
      const outcome = await fetchOne(token, ref);
      if (outcome === 'skipped') skipped += 1;
      else if (outcome === 'downloaded') done += 1;
      else failed += 1;

      const processed = done + skipped + failed;
      if (processed % 200 === 0 || processed === queue.length) {
        const elapsed = (Date.now() - started) / 1000;
        const rate = processed / Math.max(elapsed, 1);
        const eta = Math.round((queue.length - processed) / Math.max(rate, 0.01));
        process.stdout.write(
          `\r  ${processed}/${queue.length}  downloaded=${done} skipped=${skipped} failed=${failed}  ` +
            `${rate.toFixed(1)}/s  eta ${Math.floor(eta / 60)}m${eta % 60}s          `
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write('\n');

  console.log('\n  Download complete');
  console.log('  ' + '-'.repeat(44));
  console.log(`  downloaded   ${done}`);
  console.log(`  already had  ${skipped}`);
  console.log(`  failed       ${failed}`);
  console.log(`  duration     ${((Date.now() - started) / 1000).toFixed(0)}s`);
  if (failed > 0) {
    console.log('\n  Re-run to retry the failures — completed files are skipped.\n');
    process.exitCode = 1;
  } else {
    console.log('');
  }
}

main().catch((error) => {
  console.error('\nDownload failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
