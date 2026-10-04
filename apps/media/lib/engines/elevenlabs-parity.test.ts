/**
 * The check that keeps `apps/media`'s ElevenLabs settings equal to `apps/ozikoro`'s.
 *
 * WHY A DUPLICATE EXISTS AT ALL, AND WHY THIS FILE MAKES IT ACCEPTABLE
 *
 * `NARRATION_SETTINGS` has to be stated twice. `apps/media` is a headless renderer and `apps/ozikoro` is a
 * Next.js application, so importing one from the other would pull a web app into the service. That is a
 * real reason — **and it is also exactly the reason the two would drift.** The `speed: 0.75` in there is
 * not a preference: it is the reciprocal of a measured ratio (the first render ran at 186.2 words per
 * minute against the owner's own 140.3), and the day somebody tunes one copy, the archive starts rendering
 * at a pace the owner already rejected while the other copy still records the reason it does not.
 *
 * So the divergence is *checked* rather than hoped against. This reads both files as text and compares the
 * settings objects. **A duplicate with a test that fails on divergence is a different thing from a
 * duplicate** — and if this test is ever deleted, the honest fix is to move the constant into
 * `@ozikoro/platform`, which both may import, not to delete the check.
 *
 * It reads the files rather than importing the app's module because importing a Next.js app's module from
 * a `node --test` process is not possible, and would be a worse dependency than reading the text.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const SERVICE_FILE = join(import.meta.dirname, 'elevenlabs.ts');
const APP_FILE = join(import.meta.dirname, '..', '..', '..', 'ozikoro', 'lib', 'elevenlabs.ts');

/** Pull the keys and numeric/boolean values out of a `NARRATION_SETTINGS = { ... }` literal. */
function settingsFrom(source: string, file: string): Record<string, string> {
  const match = /export const NARRATION_SETTINGS = \{(?<body>[\s\S]*?)\} as const;/.exec(source);
  assert.ok(match?.groups?.['body'], `could not find NARRATION_SETTINGS in ${file} — has it been renamed?`);
  const body = match.groups['body'];
  const out: Record<string, string> = {};
  for (const line of body.split('\n')) {
    // Strip a trailing `//` comment, which the app's copy carries on the `speed` line.
    const withoutComment = line.split('//')[0] ?? '';
    const entry = /^\s*([a-z_]+)\s*:\s*([^,]+),?\s*$/.exec(withoutComment);
    if (!entry) continue;
    out[entry[1] as string] = (entry[2] as string).trim();
  }
  return out;
}

test('the two NARRATION_SETTINGS copies are identical', () => {
  const service = settingsFrom(readFileSync(SERVICE_FILE, 'utf8'), SERVICE_FILE);
  const app = settingsFrom(readFileSync(APP_FILE, 'utf8'), APP_FILE);

  assert.deepEqual(
    service,
    app,
    'NARRATION_SETTINGS has diverged between apps/media and apps/ozikoro. The service is the one that ' +
      'renders, so whichever copy is wrong, the owner hears the difference and the record keeps the old ' +
      'reason. Fix both, or move the constant into @ozikoro/platform.'
  );
});

test('speed is the measured 0.75 and not the API default', () => {
  const service = settingsFrom(readFileSync(SERVICE_FILE, 'utf8'), SERVICE_FILE);
  // The API default is 1.0, which is the pace the owner heard and rejected. If this ever changes it must
  // be because a new measurement says so — see the long note in apps/ozikoro/lib/elevenlabs.ts.
  assert.equal(service['speed'], '0.75');
});

test('a settings object was actually parsed from each file', () => {
  const service = settingsFrom(readFileSync(SERVICE_FILE, 'utf8'), SERVICE_FILE);
  // Guards against a rename making both sides parse to `{}` and comparing equal: **two empty sets are
  // equal, and a test that passes when it read nothing is worse than no test.**
  assert.ok(Object.keys(service).length >= 5, `expected at least 5 settings, read ${Object.keys(service).length}`);
});
