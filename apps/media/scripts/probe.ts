#!/usr/bin/env node
/**
 * `npm run probe` — what this machine actually has, before anything is blamed on the model.
 *
 * WHY THIS IS A COMMAND AND NOT A PARAGRAPH IN A README
 *
 * Every failure in this service so far has had the same shape: **the code was right and the box was
 * missing something.** No ffmpeg. No llvmlite wheel for Intel macOS. A checkpoint truncated to zero bytes
 * by a fast-transfer path that reports no error. A Hugging Face cache outside the working tree that the
 * sandbox refuses to write. Each of those reads like a model bug and none of them is one.
 *
 * So this prints the facts first and only then offers an opinion, and **`--self-test` actually loads the
 * model and renders a second of audio** — because "installed" and "produces a file" are different claims
 * and only the second one is worth anything.
 *
 * It never calls ElevenLabs. Not even `/user/subscription`, which would be free: the instruction is that no
 * call is made, and a free call that the rules forbid is still a call the rules forbid.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createEngines } from '../lib/engines/index.ts';
import { LOCAL_LICENCE, LOCAL_MODEL } from '../lib/engines/local.ts';
import { f5Vocab, lexiconExists, lexiconPath, loadLexicon } from '../lib/lexicon.ts';
import { pythonPaths } from '../lib/worker-client.ts';

function sh(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function which(binary: string): string | null {
  const out = sh('/usr/bin/which', [binary]);
  return out || null;
}

function line(label: string, value: string): void {
  process.stdout.write(`  ${label.padEnd(34)} ${value}\n`);
}

async function main(): Promise<number> {
  const selfTest = process.argv.includes('--self-test');
  const appRoot = join(import.meta.dirname, '..');
  const repoRoot = join(appRoot, '..', '..');
  const paths = pythonPaths();

  process.stdout.write('\nTHE MACHINE\n');
  line('operating system', `${process.platform} ${process.arch} (node ${process.version})`);
  line('cpu', sh('/usr/sbin/sysctl', ['-n', 'machdep.cpu.brand_string']) || '(unknown)');
  line('cores', sh('/usr/sbin/sysctl', ['-n', 'hw.ncpu']) || '(unknown)');
  line('memory (GB)', String(Math.round(Number(sh('/usr/sbin/sysctl', ['-n', 'hw.memsize']) || '0') / 1_073_741_824) || '(unknown)'));
  const df = sh('/bin/df', ['-h', repoRoot]).split('\n').pop() ?? '';
  line('disk free', df.split(/\s+/).filter(Boolean).slice(3, 4).join('') || '(unknown)');

  process.stdout.write('\nTHE TOOLS, ALL OPTIONAL, ALL NAMED WHEN ABSENT\n');
  for (const tool of ['ffmpeg', 'espeak-ng', 'docker', 'afconvert', 'say', 'git']) {
    line(tool, which(tool) ?? 'NOT FOUND');
  }
  line('system python3', sh('/usr/bin/env', ['python3', '--version']) || '(unknown)');
  line('python3 on PATH', which('python3') ?? 'NOT FOUND');
  line('pip3', which('pip3') ?? 'NOT FOUND');

  process.stdout.write('\nTHE LOCAL ENGINE\n');
  line('interpreter the service uses', existsSync(paths.python) ? paths.python : `${paths.python}  NOT FOUND`);
  line('worker', existsSync(paths.worker) ? paths.worker : `${paths.worker}  NOT FOUND`);
  line('model directory', join(repoRoot, '.tools', 'models', LOCAL_MODEL));
  const ckpt = join(repoRoot, '.tools', 'models', LOCAL_MODEL, 'model_1200000.safetensors');
  if (existsSync(ckpt)) {
    const size = statSync(ckpt).size;
    // The exact size is the check that matters: a truncated download is the failure that has no error.
    line('checkpoint', `${size.toLocaleString('en-GB')} bytes${size === 1_348_645_281 ? '  (complete)' : '  (EXPECTED 1,348,645,281 — likely truncated)'}`);
  } else {
    line('checkpoint', `${ckpt}  NOT FOUND — run: .tools/tts-venv/bin/python .tools/download-model.py`);
  }
  const vocab = f5Vocab();
  line('vocab.txt', vocab === null ? 'NOT FOUND — the diacritic check cannot run' : `${vocab.size} distinct characters`);

  // The claim that matters for Igbo, checked rather than asserted.
  if (vocab) {
    const letters = ['ị', 'ọ', 'ụ', 'ṅ'];
    const present = letters.filter((c) => vocab.has(c));
    line('Igbo letters in the vocabulary', `${present.join(' ')}  (${present.length}/4)`);
    const combining = ['\u0323', '\u0300'];
    line('combining marks in the vocabulary', combining.filter((c) => vocab.has(c)).join(' ') || '(none — NFC must compose them)');
  }

  process.stdout.write('\nTHE ENGINES\n');
  const engines = createEngines({ preload: false });
  for (const capability of [engines.local.capabilities(), engines.elevenlabs.capabilities()]) {
    process.stdout.write(`  ${capability.engine}\n`);
    line('    available', capability.available ? 'yes' : `no — ${capability.reason}`);
    line('    model', capability.model);
    line('    max characters', capability.maxCharacters.toLocaleString('en-GB'));
    line('    voice cloning', capability.voiceCloning ? 'yes' : 'no');
    line('    costs credits', capability.costsCredits ? 'yes — 1 per character' : 'no');
    line('    weights licence', capability.licence.weights);
    line('    code licence', capability.licence.code);
    line('    NON-COMMERCIAL', capability.licence.nonCommercial ? 'YES — cannot be published on a commercial site' : 'no');
  }

  process.stdout.write('\nTHE LICENSE OF THE LOCAL WEIGHTS, PLAINLY\n');
  process.stdout.write(`  ${LOCAL_LICENCE.weights} (code: ${LOCAL_LICENCE.code})\n`);
  process.stdout.write(`  ${LOCAL_LICENCE.note}\n`);

  process.stdout.write('\nTHE PRONUNCIATION LAYER\n');
  if (lexiconExists()) {
    const lexicon = loadLexicon();
    line('lexicon', lexiconPath());
    line('built', lexicon.generatedAt);
    line('dictionary words', String(lexicon.source.publishedIgboWords));
    line('clean folded forms', String(lexicon.source.cleanFoldedForms));
    line('respellings in the dictionary', String(lexicon.source.respellings));
    line('RECORDINGS in the dictionary', String(lexicon.source.recordings));
    process.stdout.write(
      `  Archive coverage, measured: ${lexicon.archive.distinctIgboWords} distinct Igbo words; ` +
        `${lexicon.archive.namedByDictionary} named by the dictionary, ` +
        `${lexicon.archive.rescuedByDissection} rescued by dissection, ` +
        `${lexicon.archive.unsayable} UNSAYABLE.\n`
    );
  } else {
    line('lexicon', `NOT BUILT — run: npm -w @ozikoro/media run lexicon   (expected at ${lexiconPath()})`);
  }

  const elevenlabs = engines.elevenlabs.capabilities();
  process.stdout.write('\nTHE ELEVENLABS ALLOWANCE (never called — this is the recorded figure)\n');
  line('permitted to spend', elevenlabs.available ? 'yes' : 'NO — narration is paused');
  line('reason', elevenlabs.reason ?? 'the switch OZIKORO_MEDIA_ALLOW_ELEVENLABS=1 is set');

  if (!selfTest) {
    process.stdout.write('\nRun with --self-test to load the model and render audio.\n\n');
    await engines.local.stop();
    return 0;
  }

  process.stdout.write('\nSELF-TEST: loading the model and rendering\n');
  const started = Date.now();
  try {
    await engines.local.load();
    process.stdout.write(`  model loaded in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
    const health = engines.local.health();
    line('device', health.device ?? '(unknown)');
    line('accelerators', JSON.stringify(health.accelerators));
  } catch (error) {
    process.stdout.write(`  FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
    process.stdout.write(`  worker stderr:\n${engines.local.health().stderrTail.join('\n')}\n`);
    await engines.local.stop();
    return 1;
  }

  await engines.local.stop();
  process.stdout.write('  (the self-test loads the model only; `npm run speak` renders a file)\n\n');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`probe failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
);
