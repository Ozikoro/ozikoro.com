/*
 * sweep-overflow.mjs — RUN THE LAYOUT PROBE OVER EVERY PAGE, AT THREE WIDTHS, IN ONE BROWSER.
 *
 * The owner asked for the same fault to be found "in other pages". Measuring 60 pages one process at a
 * time costs a Chrome launch and a settle for every page; this keeps one browser per width and only
 * navigates, which is roughly two seconds a page after the first.
 *
 *   node scripts/sweep-overflow.mjs --urls /tmp/pages.txt --widths 390,768,1440 --out /tmp/sweep
 *
 * `--urls` is one URL (or path) per line, `#` comments and blanks ignored. A line that is a path is
 * resolved against `--base` (default `http://127.0.0.1:3110`).
 *
 * It writes `<out>/w<width>.jsonl` — one JSON object per page, the same shape `probe-overflow.mjs`
 * prints — and returns a summary of every page that failed at least one of the four checks.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { openBrowser, navigate, settlePage, measure } from './lib/overflow-probe.mjs';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
};

const urlsFile = arg('--urls');
const base = arg('--base', 'http://127.0.0.1:3110');
const outDir = arg('--out', '/tmp/sweep');
const widths = String(arg('--widths', '390,768,1440')).split(',').map(Number);
const settle = Number(arg('--settle', '2'));
const limit = Number(arg('--limit', '0'));

if (!urlsFile) {
  console.error('usage: node scripts/sweep-overflow.mjs --urls <file> --widths 390,768,1440 --out <dir>');
  process.exit(2);
}

const lines = (await readFile(urlsFile, 'utf8'))
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));
const urls = (limit > 0 ? lines.slice(0, limit) : lines).map((l) => (/^https?:\/\//.test(l) ? l : base + l));

await mkdir(outDir, { recursive: true });
console.log(`sweeping ${urls.length} pages at ${widths.join(', ')} px`);

const allFailures = [];

for (const width of widths) {
  const browser = await openBrowser({ width, height: 900, tag: 'sweep' });
  const rows = [];
  let done = 0;
  for (const url of urls) {
    done++;
    let row;
    try {
      if (!(await navigate(browser.send, url, settle))) {
        row = { url, error: 'navigation failed' };
      } else {
        await settlePage(browser.send);
        row = await measure(browser.send, null);
      }
    } catch (e) {
      row = { url, error: e.message };
    }
    rows.push(row);
    const flags = [];
    if (row.error) flags.push('LOAD-' + row.error);
    else {
      if (row.pageOverflowsHorizontally) flags.push(`page+${row.overflowAmount}`);
      if (row.counts.leaksRight) flags.push(`right:${row.counts.leaksRight}`);
      if (row.counts.leaksLeft) flags.push(`left:${row.counts.leaksLeft}`);
      if (row.counts.selfOverflow) flags.push(`self:${row.counts.selfOverflow}`);
      if (row.counts.outsideWrap) flags.push(`outside:${row.counts.outsideWrap}`);
    }
    if (flags.length) {
      allFailures.push({ width, url, flags: flags.join(' ') , row });
      console.log(`  w=${width} ${String(done).padStart(3)}/${urls.length}  FAIL  ${flags.join(' ')}  ${url}`);
    } else if (done % 10 === 0) {
      console.log(`  w=${width} ${String(done).padStart(3)}/${urls.length}  ok`);
    }
  }
  await browser.close();
  await writeFile(`${outDir}/w${width}.jsonl`, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`wrote ${outDir}/w${width}.jsonl (${rows.length} rows)`);
}

const summary = {
  widths,
  pages: urls.length,
  failures: allFailures.map((f) => ({
    width: f.width,
    url: f.url,
    flags: f.flags,
    pageOverflow: f.row.pageOverflowsHorizontally ? f.row.overflowAmount : 0,
    leaksRight: (f.row.leaksRight || []).slice(0, 4).map((o) => ({ sel: o.sel, over: o.over, rect: o.rect })),
    leaksLeft: (f.row.leaksLeft || []).slice(0, 4).map((o) => ({ sel: o.sel, over: o.over, rect: o.rect })),
    selfOverflow: (f.row.selfOverflow || []).slice(0, 4).map((o) => ({ sel: o.sel, over: o.over, scrollW: o.scrollW, clientW: o.clientW })),
    outsideWrap: (f.row.outsideWrap || []).slice(0, 4).map((o) => ({ sel: o.sel, rect: o.rect, anchor: o.anchor, anchorX: o.anchorX, text: o.text })),
  })),
};
await writeFile(`${outDir}/summary.json`, JSON.stringify(summary, null, 1));
console.log(`\n${allFailures.length} page-width failures of ${urls.length * widths.length} page-widths measured`);
console.log(`summary written to ${outDir}/summary.json`);
process.exit(0);
