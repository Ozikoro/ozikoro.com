#!/usr/bin/env node
/**
 * `npm run voices` — see, register and remove the voice profiles the local engine can speak with.
 *
 * WHY A VOICE NEEDS A TRANSCRIPT, AND WHY THIS COMMAND REFUSES TO INVENT ONE
 *
 * F5-TTS is a zero-shot cloner: it conditions on a reference clip **and the words spoken in it**. The
 * audio alone is not enough, because the model aligns the new text to the reference through its text. The
 * two honest options are to be told the words, or to run an ASR model to recover them — and this service
 * refuses the second: **transcribing the owner's Igbo recordings with an English model would produce a
 * wrong transcript, and a wrong transcript does not fail.** It quietly produces a voice conditioned on
 * words nobody said, which sounds fine and is a lie.
 *
 * So a clip registered without `--text` is stored — the audio is the irreplaceable part and the conversion
 * work is real — and marked `needs_transcript`. Every attempt to speak with it then fails with that reason.
 *
 * Usage:
 *   npm run voices                          list what is registered
 *   npm run voices -- list
 *   npm run voices -- import-samples        stage the owner's 13 recordings (they need transcripts)
 *   npm run voices -- register --name own --audio clip.wav --text "what is said in it"
 *   npm run voices -- delete --name own
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MediaError } from '../lib/errors.ts';
import { deleteVoice, getVoice, listVoices, profilesRoot, registerVoice } from '../lib/voice-profiles.ts';

function values(name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === `--${name}`) {
      const next = process.argv[i + 1];
      if (next && !next.startsWith('--')) out.push(next);
    }
  }
  return out;
}

function value(name: string): string | null {
  return values(name)[0] ?? null;
}

function failed(error: unknown): never {
  if (error instanceof MediaError) {
    process.stderr.write(`\nFAILED (${error.code}): ${error.message}\n`);
    if (error.details) process.stderr.write(`  details: ${JSON.stringify(error.details)}\n`);
  } else {
    process.stderr.write(`\nFAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exit(1);
}

async function list(): Promise<number> {
  const voices = listVoices();
  process.stdout.write(`\nvoices directory: ${profilesRoot()}\n\n`);
  if (voices.length === 0) {
    process.stdout.write('  (none registered)\n\n');
    process.stdout.write('  Register one:\n');
    process.stdout.write('    npm run voices -- register --name own --audio <clip.wav> --text "<what is said in it>"\n\n');
    return 0;
  }
  const width = Math.max(4, ...voices.map((v) => v.name.length));
  process.stdout.write(`  ${'name'.padEnd(width)}  ${'status'.padEnd(17)} ${'secs'.padStart(7)}  label\n`);
  for (const voice of voices) {
    process.stdout.write(
      `  ${voice.name.padEnd(width)}  ${voice.status.padEnd(17)} ${voice.durationSeconds.toFixed(1).padStart(7)}  ${voice.label}\n`
    );
  }
  const blocked = voices.filter((v) => !v.speakable);
  if (blocked.length > 0) {
    process.stdout.write(
      `\n  ${blocked.length} of ${voices.length} cannot speak yet, because F5-TTS conditions on the WORDS in\n` +
        `  the reference clip and guessing them would tune the voice on words nobody said.\n` +
        `  Fix with: npm run voices -- register --name <name> --audio <clip> --text "<the words>" --replace\n`
    );
  }
  process.stdout.write('\n');
  return 0;
}

/**
 * Stage the owner's own recordings, with no transcripts.
 *
 * **This is the honest state his work is actually in.** The 13 recordings in `data/voice-samples/` are his
 * voice; what is missing is one line of text per clip saying what he says. The clips are converted and
 * stored now so that adding the transcript later is one command rather than a re-import — and every one is
 * marked `needs_transcript` so nothing can quietly speak with a guessed one.
 */
async function importSamples(): Promise<number> {
  const repoRoot = join(import.meta.dirname, '..', '..', '..');
  const source = value('from') ?? join(repoRoot, 'data', 'voice-samples');
  if (!statSync(source).isDirectory()) {
    process.stderr.write(`no such directory: ${source}\n`);
    return 1;
  }

  const audioFiles = (directory: string): string[] => {
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter((f) => !f.startsWith('.') && statSync(join(directory, f)).isFile())
      .filter((f) => /\.(m4a|mp3|wav|aac|aiff?|flac|ogg)$/i.test(f))
      .sort();
  };

  /*
   * `data/voice-samples/wav/` holds the same recordings already converted to the 24 kHz mono PCM the model
   * wants. Preferring them means a profile is made from ONE conversion rather than two — every resample is
   * a generation of loss, and the model conditions on this clip every time it speaks.
   */
  const converted = join(source, 'wav');
  const useConverted = audioFiles(converted).length > 0;
  const directory = useConverted ? converted : source;
  const chosen = audioFiles(directory);
  if (chosen.length === 0) {
    process.stderr.write(`no audio files found in ${source} or ${converted}\n`);
    return 1;
  }

  process.stdout.write(`\nStaging ${chosen.length} clip(s) from ${directory}\n`);
  process.stdout.write('  No transcript is supplied for any of these, by design: see the note in this file.\n\n');

  const transcript = value('text');
  let registered = 0;
  for (const [index, file] of chosen.entries()) {
    const name = `sample-${String(index + 1).padStart(2, '0')}`;
    try {
      const profile = await registerVoice({
        name,
        label: file.replace(/\.[^.]+$/, ''),
        clips: [{ originalName: file, data: readFileSync(join(directory, file)) }],
        referenceText: transcript,
        notes: 'Staged from data/voice-samples by `npm run voices -- import-samples`.',
        replace: true,
      });
      registered += 1;
      process.stdout.write(`  ${name}  ${profile.durationSeconds.toFixed(1)}s  ${profile.status}\n`);
    } catch (error) {
      process.stdout.write(`  ${name}  FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  process.stdout.write(`\n${registered} registered.\n`);
  if (!transcript) {
    process.stdout.write(
      '  Each is marked `needs_transcript`. To make one speakable, give it the words:\n' +
        '    npm run voices -- register --name sample-01 --audio "data/voice-samples/wav/<file>" \\\n' +
        '        --text "<exactly what he says>" --replace\n'
    );
  }
  process.stdout.write('\n');
  return 0;
}

async function main(): Promise<number> {
  const command = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'list';

  if (command === 'list') return list();
  if (command === 'import-samples') return importSamples();

  if (command === 'register') {
    const name = value('name');
    const audio = values('audio');
    if (!name || audio.length === 0) {
      process.stderr.write('usage: npm run voices -- register --name <name> --audio <file> [--audio <file2>] --text "<words>"\n');
      return 1;
    }
    const profile = await registerVoice({
      name,
      label: value('label'),
      clips: audio.map((path) => ({ originalName: path.split('/').pop() ?? path, data: readFileSync(path) })),
      referenceText: value('text'),
      referenceText2: value('text2'),
      notes: value('notes'),
      replace: process.argv.includes('--replace'),
    });
    process.stdout.write(`\nregistered ${profile.name} (${profile.status}), ${profile.durationSeconds.toFixed(1)}s of reference audio\n`);
    process.stdout.write(`  reference: ${profile.referenceAudio}\n`);
    if (profile.status !== 'ready') {
      process.stdout.write('  It cannot speak yet: supply --text with the words spoken in the clip.\n');
    }
    process.stdout.write('\n');
    return 0;
  }

  if (command === 'show') {
    const name = value('name') ?? process.argv[3] ?? '';
    process.stdout.write(`${JSON.stringify(getVoice(name), null, 2)}\n`);
    return 0;
  }

  if (command === 'delete' || command === 'remove') {
    const name = value('name') ?? process.argv[3] ?? '';
    if (!name) {
      process.stderr.write('usage: npm run voices -- delete --name <name>\n');
      return 1;
    }
    process.stdout.write(`${JSON.stringify(deleteVoice(name))}\n`);
    return 0;
  }

  process.stderr.write(`unknown command ${JSON.stringify(command)}. Try: list, register, show, delete, import-samples\n`);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => failed(error)
);
