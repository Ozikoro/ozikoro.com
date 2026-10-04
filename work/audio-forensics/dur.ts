import { mp3DurationSeconds } from '@ozikoro/platform';
import { readFileSync } from 'node:fs';
import { NARRATION_SETTINGS } from '../../apps/ozikoro/lib/elevenlabs.ts';
console.log('NARRATION_SETTINGS as the code now stands:', JSON.stringify(NARRATION_SETTINGS));
for (const [n, p] of Object.entries({
  'ute-okpu': '.data/media/ozikoro/episodes/ute-okpu-an-ika-igbo-clan-and-its-nri-roots.mp3',
  'tortoise': '.data/media/ozikoro/episodes/how-tortoise-got-his-bumpy-shell.mp3',
  'folklore': '.data/media/ozikoro/episodes/igbo-folklore-twelve-timeless-tales-of-wisdom-wonder-and-moral-heritage.mp3',
  'owner-ref': '/Users/nzeora/Documents/Ozikoro/work/audio-forensics/owner-reference.mp3',
})) {
  const d = mp3DurationSeconds(new Uint8Array(readFileSync(p)));
  console.log(`  ${n.padEnd(10)} mp3DurationSeconds = ${d}`);
}
