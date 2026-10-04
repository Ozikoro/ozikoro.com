#!/usr/bin/env node
/**
 * WHAT EVERY LINK ON THE LISTEN AND FILM PAGES ACTUALLY LEADS TO.
 *
 * ── WHY THIS EXISTS (AND WHY THE EXISTING CHECKS COULD NOT HAVE CAUGHT IT) ────────────────────────
 *
 * The owner reported, twice, that pressing `Read the transcript` on `/listen/` led to "complete code". The
 * link answered **200 with `content-type: text/plain`**, and the content was correct — an 11,836-byte
 * transcript with no angle brackets in it. **So every check this repository had passed.**
 *
 *   `check-links.sh`   follows links and reads STATUS. 200 is not a broken link.
 *   `check-sitemap.sh` reads `<loc>` values. A control is not a `<loc>`.
 *   round 351          followed `/listen/`'s ROW destination — the article — read its `h1`, and concluded
 *                      "its row destination is the article, so the writing is one click away — not the same
 *                      fault, so nothing built there." **It never followed the transcript link itself.**
 *
 * Three lessons are encoded here, each one a line of code rather than a paragraph:
 *
 *   1. **A page's controls are not measured by measuring the page.** Every `<a>` on the page is followed, not
 *      the one a round happened to care about — the row destinations AND the buttons on the cards.
 *   2. **STATUS ALONE CANNOT SEE THIS FAULT.** Every response's `content-type` is read and reported, because
 *      200 + `text/plain` is a wall of monospace where the design draws a control.
 *   3. **A `btn` IS A DESTINATION IN THIS DESIGN'S LANGUAGE.** A control drawn as a button that returns
 *      `text/plain` or `application/octet-stream` is a suspicious destination and is reported as one — with
 *      the reason, because a **download** button returning `application/pdf` is a legitimate `btn`.
 *
 * ── WHAT IT FOLLOWS ───────────────────────────────────────────────────────────────────────────────
 *
 * `/listen/`, `/watch-video/`, and **every `/watch-video/?v=<id>` the served `/watch/` pages name** — the ids
 * are read out of the cards' own `data-video-page` attribute rather than typed here, and the library's
 * pagination is walked through the design's own `Next` control, because `/watch/` holds eighteen films over two
 * pages and a check that stopped at page one would measure half the family. **Nothing is discovered by reading
 * the source**: every address came off a served page, which is the only way a control that exists only in
 * JavaScript is found.
 *
 * Same-origin, cross-origin and in-page fragment addresses all get an entry:
 *
 *   * same-origin  — fetched, status and `content-type` read;
 *   * cross-origin — fetched with a timeout, status and `content-type` read, failures reported not fatal;
 *   * `#fragment`  — the id is looked for ON THE PAGE, because a link that scrolls nowhere is the fault round
 *                    338 recorded and no HTTP request can see it.
 *
 * ── WHAT FAILS AND WHAT IS ONLY REPORTED ─────────────────────────────────────────────────────────
 *
 * FAILS (exit 1):
 *   * a same-origin address that answers 4xx or 5xx — a link that leads nowhere;
 *   * an in-page `#fragment` with no element carrying that id;
 *   * **a `btn` whose own words say `Read`/`View`/`Open` and whose destination is a raw file**
 *     (`text/plain`, `application/octet-stream`, `text/csv`). This is the owner's fault exactly: the label
 *     promises reading and the destination is a download.
 *
 * REPORTED, NOT FAILED (the reason is printed beside each):
 *   * any other `btn` returning `text/plain` or `application/octet-stream`, which may be a legitimate download
 *     link — the label is what decides, so the label is printed;
 *   * a `btn` that answers 3xx, with the address it goes to.
 *
 * Usage:
 *   node scripts/check-link-destinations.mjs                       # http://127.0.0.1:3110
 *   node scripts/check-link-destinations.mjs --base=http://host:3110
 *   node scripts/check-link-destinations.mjs --strict              # a suspicious btn also fails
 *   node scripts/check-link-destinations.mjs --json                # the same inventory, as JSON
 */
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const BASE = (value('base', process.env.OZIKORO_REVIEW_URL ?? 'http://127.0.0.1:3110')).replace(/\/$/, '');
const STRICT = flag('strict');
const AS_JSON = flag('json');
const TIMEOUT_MS = Number(value('timeout', '15000'));
/** A bound on the library walk, so a page whose `Next` control loops cannot run this forever. */
const MAX_PAGES = Number(value('max-pages', '6'));

/** The class that makes a control a button in the design's language. */
const BUTTON_CLASS = /\bbtn\b/;
/** The labels that promise reading rather than saving. */
const READING_LABEL = /^\s*(read|view|open|see|browse)\b/i;
/** Content types that are a FILE rather than a page, and so cannot be what a reading control promises. */
const RAW_TYPES = ['text/plain', 'application/octet-stream', 'text/csv', 'text/tab-separated-values'];

/** An anchor on a page, exactly as the served markup writes it. */
function anchorsOf(html) {
  const out = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1] ?? '';
    const href = /\bhref\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];
    if (href === undefined) continue;
    const cls = /\bclass\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? '';
    // The label a reader sees: markup stripped, entities decoded, whitespace flattened.
    const label = (match[2] ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
    out.push({ href, cls, label });
  }
  return out;
}

/** A whole page, for its markup rather than its headers. */
async function fetchHtml(url) {
  try {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim();
    return { status: response.status, type, text: await response.text() };
  } catch (error) {
    return { status: null, type: null, text: '', error: String(error?.message ?? error) };
  }
}

/** Headers only, for a link this check follows rather than renders. */
async function head(url) {
  try {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    // The headers are what this check is for; the body is never read, so a 40 MB recording costs nothing.
    await response.body?.cancel().catch(() => {});
    return {
      status: response.status,
      type: (response.headers.get('content-type') ?? '').split(';')[0].trim(),
      final: response.url,
    };
  } catch (error) {
    return { status: null, type: null, error: String(error?.message ?? error) };
  }
}

const isRaw = (type) => RAW_TYPES.some((t) => (type ?? '').toLowerCase().startsWith(t));
const isButton = (cls) => BUTTON_CLASS.test(cls);

/**
 * FOLLOW ONE ADDRESS AND SAY WHAT IT IS.
 *
 * `here` is the page the address was found on, and it is passed rather than assumed because **a fragment-only
 * address is a different thing on every page** — `#listen` resolves to an element on an article and to nothing
 * at all on a transcript page, and only the page it was written on can answer that.
 */
async function follow(href, here, idsOnPage) {
  if (href.startsWith('#')) {
    const id = href.slice(1);
    if (id === '') return { kind: 'fragment', status: null, type: null, note: 'the top of the page' };
    return {
      kind: 'fragment',
      status: null,
      type: null,
      broken: !idsOnPage.has(id),
      note: idsOnPage.has(id) ? `#${id} is on this page` : `#${id} is on NO element of this page`,
    };
  }
  const absolute = new URL(href, here).href;
  const sameOrigin = new URL(absolute).origin === new URL(BASE).origin;
  const result = await head(absolute);
  return {
    kind: sameOrigin ? 'same-origin' : 'cross-origin',
    ...result,
    broken: sameOrigin && result.status !== null && result.status >= 400,
  };
}

/**
 * THE RULE THE OWNER'S FAULT NEEDS.
 *
 * A control is suspicious when it is DRAWN AS A BUTTON and answers with a file. The reason is printed with it,
 * because the fault and the legitimate download look identical in a status code.
 */
function verdictFor(link, result) {
  if (result.broken) return { verdict: 'BROKEN', reason: `answered ${result.status ?? result.error}` };
  if (!isButton(link.cls)) return { verdict: 'ok', reason: '' };
  if (isRaw(result.type)) {
    const reading = READING_LABEL.test(link.label);
    return {
      verdict: reading ? 'BROKEN' : 'suspicious',
      reason: reading
        ? `a btn labelled "${link.label}" answers ${result.type} — the label promises reading, the destination is a file`
        : `a btn answers ${result.type}; legitimate if the label says download, and this one says "${link.label}"`,
    };
  }
  if (result.status !== null && result.status >= 300 && result.status < 400) {
    return { verdict: 'suspicious', reason: `a btn answers ${result.status} and goes to ${result.final}` };
  }
  return { verdict: 'ok', reason: '' };
}

const report = [];
const failures = [];
const suspicious = [];

/** Every `<a>` on one page, followed. Returns the page's markup so the caller can find more pages in it. */
async function inspect(pageUrl) {
  const page = await fetchHtml(pageUrl);
  const rows = [];
  report.push({ page: pageUrl, rows });
  if (page.status !== 200) {
    failures.push(`${pageUrl} answered ${page.status ?? page.error}`);
    return '';
  }
  const idsOnPage = new Set([...page.text.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1] ?? ''));
  for (const link of anchorsOf(page.text)) {
    const result = await follow(link.href, pageUrl, idsOnPage);
    const { verdict, reason } = verdictFor(link, result);
    rows.push({
      page: pageUrl,
      label: link.label,
      href: link.href,
      button: isButton(link.cls),
      status: result.status,
      type: result.type,
      kind: result.kind,
      note: result.note ?? '',
      verdict,
      reason,
    });
    if (verdict === 'BROKEN') failures.push(`${pageUrl} → ${link.href} : ${reason}`);
    if (verdict === 'suspicious') suspicious.push(`${pageUrl} → ${link.href} : ${reason}`);
  }
  return page.text;
}

// 1. The listen library.
await inspect(`${BASE}/listen/`);

/*
 * 2. THE FILM LIBRARY, AND EVERY PAGE IT NAMES.
 *
 * The `?v=` addresses are in the cards' own `data-video-page` attribute — **not in an `<a href>`**, because the
 * design opens the film in an inline player and only the extended `watch.js` navigates to the film's page. A
 * check that read only anchors would therefore have measured the library and none of the films, which is the
 * same shape of omission round 351 made. The pagination is walked through the design's own `Next` control.
 */
const filmPages = new Set();
const walked = new Set();
let watch = `${BASE}/watch/`;
for (let step = 0; step < MAX_PAGES; step += 1) {
  if (walked.has(watch)) break;
  walked.add(watch);
  const html = await inspect(watch);
  if (!html) break;
  for (const match of html.matchAll(/data-video-page="([^"]+)"/g)) {
    filmPages.add(new URL(match[1] ?? '', BASE).href);
  }
  for (const link of anchorsOf(html)) {
    if (/[?&]v=[A-Za-z0-9_-]{6,}/.test(link.href)) filmPages.add(new URL(link.href, BASE).href);
  }
  const next = anchorsOf(html).find((a) => /next/i.test(a.label) && /page=/.test(a.href) && isButton(a.cls));
  if (!next) break;
  watch = new URL(next.href, BASE).href;
}

// 3. Every film's page, and 4. the bare address the design drew its own film on.
for (const filmPage of filmPages) await inspect(filmPage);
await inspect(`${BASE}/watch-video/`);

if (AS_JSON) {
  console.log(JSON.stringify({ base: BASE, report, failures, suspicious }, null, 2));
} else {
  console.log(`Link destinations — ${BASE}`);
  console.log('Every <a> on the listen and film pages, followed; status AND content-type read.\n');
  for (const { page, rows } of report) {
    console.log(`── ${page}`);
    if (rows.length === 0) console.log('   (no anchors, or the page did not answer 200)');
    for (const row of rows) {
      const mark = row.verdict === 'BROKEN' ? '✖' : row.verdict === 'suspicious' ? '!' : '·';
      const status = row.status === null ? (row.kind === 'fragment' ? 'in-page' : 'ERROR') : row.status;
      const type = row.type ?? row.note ?? '';
      console.log(`  ${mark} [${status} ${type}] ${row.button ? 'btn' : '   '} ${row.label.slice(0, 44)} → ${row.href}`);
      if (row.reason) console.log(`      ${row.reason}`);
    }
    console.log('');
  }
  const buttons = report.flatMap((p) => p.rows).filter((r) => r.button);
  console.log(`BUTTONS: ${buttons.length} control(s) drawn with a btn class across ${report.length} page(s)`);
  for (const row of buttons) {
    console.log(`  ${row.label.slice(0, 38).padEnd(40)} ${String(row.status ?? 'in-page').padEnd(8)} ${(row.type ?? row.note ?? '').padEnd(26)} [${row.verdict}]`);
    console.log(`  ${''.padEnd(40)} → ${row.href}`);
  }
  console.log(`\nFailures: ${failures.length}`);
  for (const line of failures) console.log(`  ✖ ${line}`);
  console.log(`\nSuspicious (reported, not failed — a download is a legitimate btn): ${suspicious.length}`);
  for (const line of suspicious) console.log(`  ! ${line}`);
}

/*
 * THE EXIT CODE. A broken destination fails; a suspicious one fails only under `--strict`, so a routine run
 * reports what a reader would meet without turning a legitimate download button into a red build.
 */
process.exit(failures.length > 0 || (STRICT && suspicious.length > 0) ? 1 : 0);
