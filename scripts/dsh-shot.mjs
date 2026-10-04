/*
 * dsh-shot.mjs — a screenshot of a served page through real Chrome.
 *
 *   node scripts/dsh-shot.mjs <url> <out.png> [width] [height] [settleSeconds]
 *
 * Reads the page back through Chrome rather than curl, because the point of a screenshot is to show what a
 * browser does with the HTML — the stylesheets the design delivers, and whether a new section is styled or
 * sitting unstyled on the page. A 200 and correct markup can both be true of an unstyled page.
 */
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = process.argv[2];
const out = process.argv[3];
const width = Number(process.argv[4] ?? '1440');
const height = Number(process.argv[5] ?? '2400');
const settle = Number(process.argv[6] ?? '4');

const { spawn } = await import('node:child_process');
const { mkdir } = await import('node:fs/promises');
const { dirname, resolve } = await import('node:path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await mkdir(dirname(resolve(out)), { recursive: true });

const proc = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    /*
     * A USER-DATA DIR IS NOT OPTIONAL. Without one Chrome answers `Failed to create a unique user data
     * directory for headless` and exits 1 without writing a file — which reads as "the screenshot failed"
     * rather than as "the browser was never given a profile". `scripts/fetch-with-browser.mjs` sets one for
     * the same reason.
     */
    `--user-data-dir=/tmp/dsh-shot-${process.pid}`,
    `--window-size=${width},${height}`,
    `--screenshot=${out}`,
    `--virtual-time-budget=${settle * 1000}`,
    url,
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] }
);

let stderr = '';
proc.stderr.on('data', (chunk) => { stderr += String(chunk); });

const code = await new Promise((r) => proc.on('exit', r));
await sleep(300);
console.log(`chrome exit ${code} -> ${out}`);
if (code !== 0) console.log(stderr.split('\n').slice(-8).join('\n'));
