#!/usr/bin/env node
/**
 * `npm run compare` — the SAME passage through both engines, two files, one after the other.
 *
 * THIS IS THE COMMAND THE DECISION TURNS ON
 *
 * The owner's recommendation was *"keep ElevenLabs for public narration, self-host for drafts and bulk"*,
 * and he accepted it with *"having both is good."* But the choice between them is a judgement about sound,
 * and the only way to make it is to hear the same words twice. *"Listen to both in your own ear"* is only
 * useful if the two files exist, so this command's whole job is to make them exist, named so they cannot be
 * confused, with the facts that matter printed beside them.
 *
 * ---------------------------------------------------------------------------
 * NO CREDIT IS SPENT UNLESS IT IS ASKED FOR, TWICE OVER
 * ---------------------------------------------------------------------------
 *
 * Narration is paused and the account has 21,552 of 65,000 characters left; re-rendering three episodes
 * would exceed that. So:
 *
 *   * **the local render is what this command does by default.** The paid render is `--paid`.
 *   * with `--paid`, the character count, the credit cost, the remaining allowance and the resulting
 *     headroom are printed **before** anything is sent, and the command then requires
 *     `OZIKORO_MEDIA_ALLOW_ELEVENLABS=1` — the same switch the engine enforces, so the two cannot disagree.
 *   * `--dry-run` prints the cost and stops.
 *
 * Usage:
 *   npm run compare -- --voice own --file article.txt
 *   npm run compare -- --voice own --text "Ndeewo." --out-dir /tmp/cmp
 *   npm run compare -- --voice own --file a.txt --paid --dry-run     show the price, spend nothing
 *   npm run compare -- --voice own --file a.txt --paid               render both, having asked for it
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createEngines } from '../lib/engines/index.ts';
import { MediaError } from '../lib/errors.ts';
import { estimateCost, recordedUsed } from '../lib/cost.ts';
import { analyse } from '../lib/lexicon.ts';
import { narrate, writeRender } from '../lib/narrate.ts';

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function value(name: string, fallback: string | null = null): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const next = process.argv[index + 1];
  return next && !next.startsWith('--') ? next : fallback;
}

function fail(message: string): never {
  process.stderr.write(`\n${message}\n`);
  process.exit(1);
}

function main(): Promise<number> {
  return run();
}

async function run(): Promise<number> {
  const paid = flag('paid');
  const dryRun = flag('dry-run');
  const voice = value('voice');
  const fileArg = value('file');
  const textArg = value('text');
  const outDir = resolve(value('out-dir') ?? join(process.cwd(), 'work', 'media', 'compare'));

  if (!voice) fail('--voice is required (the ElevenLabs side also needs a voice id, or "own" / "generic").');

  let text: string;
  let source: string;
  if (fileArg) {
    if (!existsSync(fileArg)) fail(`no such file: ${fileArg}`);
    text = readFileSync(fileArg, 'utf8');
    source = fileArg;
  } else if (textArg) {
    text = textArg;
    source = '(from --text)';
  } else {
    text = readFileSync(0, 'utf8');
    source = '(from stdin)';
  }
  if (!text.trim()) fail('the text is empty; there is nothing to compare.');

  const engines = createEngines({ preload: false });
  const cost = estimateCost(text.length, recordedUsed());
  const local = engines.local.capabilities();
  const hosted = engines.elevenlabs.capabilities();

  process.stdout.write('\nCOMPARE — the same passage through both engines\n');
  process.stdout.write(`  source                     ${source}\n`);
  process.stdout.write(`  characters                 ${text.length.toLocaleString('en-GB')} (${cost.words} words)\n`);
  process.stdout.write(`  estimated duration         ${Math.round(cost.estimatedSeconds)}s\n`);
  process.stdout.write(`  output directory           ${outDir}\n`);
  process.stdout.write('\n  local engine\n');
  process.stdout.write(`    model                    ${local.model}\n`);
  process.stdout.write(`    available                ${local.available ? 'yes' : `NO — ${local.reason}`}\n`);
  process.stdout.write(`    licence of the weights   ${local.licence.weights}\n`);
  process.stdout.write(`    PUBLISHABLE              ${local.licence.nonCommercial ? 'NO — non-commercial weights' : 'yes'}\n`);
  process.stdout.write('    cost                     0 credits\n');

  process.stdout.write('\n  elevenlabs engine\n');
  process.stdout.write(`    model                    ${hosted.model}\n`);
  process.stdout.write(`    available                ${hosted.available ? 'yes' : `no — ${hosted.reason}`}\n`);
  process.stdout.write(`    licence                  ${hosted.licence.weights}\n`);
  process.stdout.write(`    cost                     ${cost.elevenlabs.credits} credits of ${cost.elevenlabs.monthlyAllowance}\n`);
  process.stdout.write(`    allowance remaining      ${cost.elevenlabs.remainingThisPeriod ?? 'unknown'}\n`);
  process.stdout.write(
    `    would exceed it          ${cost.elevenlabs.exceedsRemaining === null ? 'unknown — a paid render would be refused' : cost.elevenlabs.exceedsRemaining ? 'YES — a paid render would be refused' : 'no'}\n`
  );

  // The pronunciation findings are identical for both engines in substance and different in one respect,
  // so both are shown: the local side is the one that can lose a tone mark.
  for (const engine of ['local', 'elevenlabs'] as const) {
    const report = analyse(text, engine);
    process.stdout.write(`\n  pronunciation, as the ${engine} engine would meet it\n`);
    process.stdout.write(`    Igbo words found         ${report.summary.igboWords}\n`);
    process.stdout.write(`    named by the dictionary  ${report.summary.resolvedByGrade[4] ?? 0}\n`);
    process.stdout.write(`    composed from parts      ${report.summary.rescuableByDissection}\n`);
    process.stdout.write(`    UNSAYABLE                ${report.summary.unsayable}\n`);
    process.stdout.write(
      `    tone marks lost          ${engine === 'local' ? (report.summary.marksChecked ? String(report.summary.marksLost) : 'not checked (vocabulary unreadable)') : 'none — the text is sent as written'}\n`
    );
  }

  if (!paid) {
    process.stdout.write(
      '\n  ElevenLabs is NOT being asked to render. Add --paid to render it as well;\n' +
        '  that costs the credits printed above, and narration is currently paused.\n'
    );
  }

  if (dryRun) {
    process.stdout.write('\n--dry-run: nothing was rendered. Remove it to produce the local file.\n\n');
    await engines.local.stop();
    return 0;
  }

  const results: {
    engine: string;
    path: string;
    bytes: number;
    durationSeconds: number | null;
    contentType: string;
    elapsedMs: number;
    credits: number | null;
    silent: boolean;
  }[] = [];

  // ---------------------------------------------------------------- local
  process.stdout.write('\nRENDERING with the local engine ...\n');
  try {
    const narrated = await narrate(engines, { text, voice, engine: 'local' });
    const path = join(outDir, `compare.local.${narrated.result.fileExtension}`);
    const written = writeRender(narrated.result, path);
    results.push({
      engine: 'local',
      path: written.path,
      bytes: written.bytes,
      durationSeconds: narrated.result.durationSeconds,
      contentType: narrated.result.contentType,
      elapsedMs: narrated.elapsedMs,
      credits: 0,
      silent: narrated.result.silent,
    });
    process.stdout.write(`  wrote ${written.path} (${written.bytes.toLocaleString('en-GB')} bytes)\n`);
  } catch (error) {
    if (error instanceof MediaError) {
      process.stdout.write(`  local render FAILED (${error.code}): ${error.message}\n`);
    } else {
      process.stdout.write(`  local render FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  // ----------------------------------------------------------- elevenlabs
  if (paid) {
    process.stdout.write('\nRENDERING with ElevenLabs ...\n');
    if (process.env.OZIKORO_MEDIA_ALLOW_ELEVENLABS !== '1') {
      process.stdout.write(
        '  REFUSED before any request was built: narration is paused.\n' +
          '  Set OZIKORO_MEDIA_ALLOW_ELEVENLABS=1 to permit it, having read the cost above.\n'
      );
    } else {
      try {
        const narrated = await narrate(engines, { text, voice, engine: 'elevenlabs' });
        const path = join(outDir, `compare.elevenlabs.${narrated.result.fileExtension}`);
        const written = writeRender(narrated.result, path);
        results.push({
          engine: 'elevenlabs',
          path: written.path,
          bytes: written.bytes,
          durationSeconds: narrated.result.durationSeconds,
          contentType: narrated.result.contentType,
          elapsedMs: narrated.elapsedMs,
          credits: narrated.result.measuredCredits,
          silent: narrated.result.silent,
        });
        process.stdout.write(`  wrote ${written.path} (${written.bytes.toLocaleString('en-GB')} bytes)\n`);
      } catch (error) {
        if (error instanceof MediaError) {
          process.stdout.write(`  elevenlabs render FAILED (${error.code}): ${error.message}\n`);
        } else {
          process.stdout.write(`  elevenlabs render FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
        }
      }
    }
  }

  await engines.local.stop();

  if (results.length === 0) {
    process.stdout.write('\nNOTHING WAS PRODUCED. See the failures above.\n\n');
    return 1;
  }

  process.stdout.write('\nTHE TWO FILES, SIDE BY SIDE — play them one after the other\n');
  const width = Math.max(9, ...results.map((r) => r.engine.length));
  process.stdout.write(`  ${'engine'.padEnd(width)}  ${'bytes'.padStart(12)}  ${'duration'.padStart(9)}  ${'render'.padStart(8)}  ${'credits'.padStart(8)}  file\n`);
  for (const result of results) {
    process.stdout.write(
      `  ${result.engine.padEnd(width)}  ${result.bytes.toLocaleString('en-GB').padStart(12)}  ` +
        `${(result.durationSeconds === null ? '?' : `${result.durationSeconds.toFixed(1)}s`).padStart(9)}  ` +
        `${`${(result.elapsedMs / 1000).toFixed(0)}s`.padStart(8)}  ` +
        `${String(result.credits ?? '?').padStart(8)}  ${result.path}\n`
    );
  }
  process.stdout.write(
    '\n  Play them with:  afplay <file>\n' +
      "  The local weights are CC-BY-NC-4.0 — NON-COMMERCIAL. Judge the sound, then judge the licence.\n\n"
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`compare failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
);
