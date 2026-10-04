#!/usr/bin/env node
/**
 * `npm run speak` — narrate a passage and get an audio file.
 *
 * THE ENGINE IS REQUIRED, AND THAT IS THE POINT
 *
 * `--engine local` or `--engine elevenlabs`, with no default. It is not ceremony: the value ends up in
 * `ozikoro_episode.generator`, so a command that picked one silently would let a record claim ElevenLabs
 * narrated something the local model spoke — or the reverse, which is worse, because it would spend the
 * owner's credits. **A default here would be a default in the archive's provenance.**
 *
 * Usage:
 *   npm run speak -- --engine local --voice own --file article.txt
 *   npm run speak -- --engine local --voice own --text "Ndeewo, aha m bụ Ozikoro."
 *   npm run speak -- --engine local --voice own --file a.txt --out /tmp/a.wav --nfe-step 16
 *   npm run speak -- --engine local --voice own --file a.txt --json     (metadata, no audio to stdout)
 *
 * The pronunciation report is printed for BOTH engines and BEFORE the render, because the mispronunciation
 * the owner heard is not an ElevenLabs problem or a local problem — it is a model not knowing Igbo.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createEngines } from '../lib/engines/index.ts';
import { MediaError, isEngineName, type EngineName } from '../lib/errors.ts';
import { estimateCost, recordedUsed } from '../lib/cost.ts';
import { defaultOutputPath, narrate, writeRender } from '../lib/narrate.ts';
import type { PronunciationReport } from '../lib/lexicon.ts';

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

/** Print the pronunciation findings in the order a person can act on them. */
function reportPronunciation(report: PronunciationReport, quiet: boolean): void {
  if (quiet) return;
  const { summary } = report;
  process.stdout.write('\nPRONUNCIATION — Igbo words found, and how each one resolved\n');
  process.stdout.write(`  engine                 ${report.engine}\n`);
  process.stdout.write(`  words found            ${summary.igboWords} Igbo, ${summary.tokens} tokens total\n`);
  for (const grade of [1, 2, 3, 4, 5, 6]) {
    const count = summary.resolvedByGrade[grade] ?? 0;
    if (count === 0) continue;
    const label =
      grade === 1 ? 'a recording held by the archive'
      : grade === 2 ? 'a recording in the dictionary'
      : grade === 3 ? 'a written respelling'
      : grade === 4 ? 'a dictionary spelling — NO sound recorded'
      : grade === 5 ? 'composed from dictionary parts'
      : 'NOT FOUND — cannot be said';
    process.stdout.write(`  grade ${grade}                ${String(count).padStart(4)}  ${label}\n`);
  }

  if (summary.unsayable > 0) {
    process.stdout.write(`\n  ${summary.unsayable} word(s) the archive cannot say yet, most frequent first:\n`);
    for (const word of report.unsayable.slice(0, 12)) {
      process.stdout.write(`    ${word.surface.padEnd(24)} ×${word.occurrences}\n`);
    }
    if (summary.unsayable > 12) process.stdout.write(`    ... and ${summary.unsayable - 12} more\n`);
    process.stdout.write(
      '    These are not a bug. The dictionary holds no sound for them and dissection cannot build one,\n' +
      '    so a person has to record them — see packages/ozikoro/src/missing-words.ts.\n'
    );
  }

  if (report.engine === 'local') {
    if (!summary.marksChecked) {
      process.stdout.write('\n  DIACRITICS: NOT CHECKED — the model vocabulary could not be read.\n');
    } else if (summary.marksLost === 0) {
      process.stdout.write('\n  DIACRITICS: every mark in this text survives to the model.\n');
    } else {
      process.stdout.write(
        `\n  DIACRITICS: ${summary.marksLost} mark(s) CANNOT be represented and will be dropped.\n` +
          '    The combining marks have no precomposed form the model knows (ụ̀ has no single code point),\n' +
          '    so the tone is lost. The words affected:\n'
      );
      for (const entry of report.markLoss.slice(0, 10)) {
        process.stdout.write(`      ${entry.word.padEnd(20)} ${entry.marks.join(' ')}\n`);
      }
      if (report.markLoss.length > 10) process.stdout.write(`      ... and ${report.markLoss.length - 10} more words\n`);
    }
    if (report.outOfVocab.length > 0) {
      process.stdout.write(`  CHARACTERS NOT IN THE VOCABULARY: ${report.outOfVocab.join(' ')}\n`);
    }
  } else {
    process.stdout.write(
      '\n  DIACRITICS: the text is sent as written, so the marks reach the model. Whether the model then\n' +
        '  SAYS them correctly can only be established by listening, which this command cannot do for you.\n'
    );
  }
  if (summary.englishCollisionsDeclined > 0) {
    process.stdout.write(
      `\n  ${summary.englishCollisionsDeclined} word(s) were treated as English: they are Igbo headwords that\n` +
        '  are also ordinary English words, and calling them Igbo put English words in the queue once already.\n'
    );
  }
}

async function main(): Promise<number> {
  const textArg = value('text');
  const fileArg = value('file');
  const engineArg = value('engine');
  const voice = value('voice');
  const quiet = flag('quiet') || flag('json');

  if (!engineArg || !isEngineName(engineArg)) {
    fail(
      `--engine is required and must be "local" or "elevenlabs".\n` +
        `\n  --engine local        the self-hosted F5-TTS model. Free, slower, lower quality. For drafts\n` +
        `                        and bulk work. Its weights are CC-BY-NC-4.0 — NON-COMMERCIAL.\n` +
        `  --engine elevenlabs   the hosted model. Costs 1 credit per character and is DISABLED on this\n` +
        `                        machine because narration is paused.\n` +
        `\n  There is no default: the engine that ran is written to the episode record as \`generator\`.`
    );
  }
  if (!voice) fail('--voice is required. Try `npm run voices` to see what is registered.');

  let text: string;
  let sourceLabel: string;
  if (fileArg) {
    if (!existsSync(fileArg)) fail(`no such file: ${fileArg}`);
    text = readFileSync(fileArg, 'utf8');
    sourceLabel = fileArg;
  } else if (textArg) {
    text = textArg;
    sourceLabel = '(from --text)';
  } else {
    // Reading stdin lets a pipeline feed it without a temporary file.
    text = readFileSync(0, 'utf8');
    sourceLabel = '(from stdin)';
  }

  if (!text.trim()) fail('the text is empty; nothing to speak.');

  const engines = createEngines({ preload: false });
  const engine: EngineName = engineArg;
  const capability = engines[engine].capabilities();

  process.stdout.write('\nSPEAK\n');
  process.stdout.write(`  source                 ${sourceLabel}\n`);
  process.stdout.write(`  characters             ${text.length.toLocaleString('en-GB')}\n`);
  process.stdout.write(`  engine                 ${engine}\n`);
  process.stdout.write(`  model                  ${capability.model}\n`);
  process.stdout.write(`  voice                  ${voice}\n`);
  process.stdout.write(`  max characters         ${capability.maxCharacters.toLocaleString('en-GB')}\n`);

  const cost = estimateCost(text.length, recordedUsed());
  process.stdout.write(`  estimated duration     ${Math.round(cost.estimatedSeconds)}s (${cost.words} words)\n`);
  if (engine === 'elevenlabs') {
    process.stdout.write(`  CREDITS THIS WILL COST ${cost.elevenlabs.credits} of ${cost.elevenlabs.monthlyAllowance} allowance\n`);
  } else {
    process.stdout.write('  credits this will cost 0 — the local engine has no per-character cost\n');
  }
  if (!capability.available) {
    process.stdout.write(`  ENGINE UNAVAILABLE       ${capability.reason}\n`);
  }

  reportPronunciation(
    (await import('../lib/lexicon.ts')).analyse(text, engine),
    quiet
  );

  process.stdout.write('\nRENDERING\n');
  const started = Date.now();
  let narrated;
  try {
    narrated = await narrate(engines, { text, voice, engine });
  } catch (error) {
    await engines.local.stop();
    if (error instanceof MediaError) {
      process.stderr.write(`\nFAILED (${error.code})\n`);
      process.stderr.write(`  engine      ${error.engine ?? '(not engine-specific)'}\n`);
      process.stderr.write(`  model       ${error.model ?? '(unknown)'}\n`);
      process.stderr.write(`  characters  ${error.characters ?? '(unknown)'}\n`);
      process.stderr.write(`  reason      ${error.message}\n`);
      if (error.details) process.stderr.write(`  details     ${JSON.stringify(error.details)}\n`);
      process.exit(1);
    }
    throw error;
  }

  const outArg = value('out');
  const outDir = value('out-dir') ?? join(process.cwd(), 'work', 'media');
  const outPath = outArg ? resolve(outArg) : defaultOutputPath(outDir, 'speak', narrated.result);
  const written = writeRender(narrated.result, outPath);

  await engines.local.stop();

  const { result } = narrated;
  if (flag('json')) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          path: written.path,
          bytes: written.bytes,
          contentType: result.contentType,
          durationSeconds: result.durationSeconds,
          characters: result.characters,
          silent: result.silent,
          markedSilent: result.silent,
          chunks: result.chunks,
          outOfVocab: result.outOfVocab,
          measuredCredits: result.measuredCredits,
          elapsedMs: narrated.elapsedMs,
          provenance: result.provenance,
          pronunciation: {
            summary: narrated.pronunciation.summary,
            unsayable: narrated.pronunciation.unsayable,
            markLoss: narrated.pronunciation.markLoss,
          },
        },
        null,
        2
      )}\n`
    );
  } else {
    process.stdout.write(
      `\nDONE in ${(narrated.elapsedMs / 1000).toFixed(1)}s\n` +
        `  file        ${written.path}\n` +
        `  bytes       ${written.bytes.toLocaleString('en-GB')}\n` +
        `  type        ${result.contentType}\n` +
        `  duration    ${result.durationSeconds === null ? '(unknown)' : `${result.durationSeconds.toFixed(2)}s`}\n` +
        `  narrated by ${result.provenance.engine} / ${result.provenance.model} / ${result.provenance.voice}\n` +
        `  chunks      ${result.chunks.total}${result.chunks.midSentenceSeams > 0 ? ` (${result.chunks.midSentenceSeams} cut mid-sentence)` : ''}\n`
    );
    if (result.silent) {
      process.stdout.write(
        '\n  *** THIS RENDER IS DIGITAL SILENCE. *** The file is playable and says nothing. Check the\n' +
          "  reference clip and its transcript before publishing it.\n"
      );
    }
    if (result.outOfVocab.length > 0) {
      process.stdout.write(`  characters the model could not represent: ${result.outOfVocab.join(' ')}\n`);
    }
    process.stdout.write('\n');
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    /*
     * The STACK as well as the message.
     *
     * A self-hosted service for its own owner: a bare "path argument must be a string" costs an hour of
     * guessing and the stack costs one line of reading, and there is no adversary to hide it from. The only
     * thing withheld is a credential, and there are none on this path.
     */
    process.stderr.write(`speak failed: ${error instanceof Error ? error.message : String(error)}\n`);
    if (error instanceof Error && error.stack) {
      process.stderr.write(`${error.stack}\n`);
    }
    process.exit(1);
  }
);
