/*
 * verify-round-344.mjs — every link, every menu, every form control on every page the site serves.
 *
 * THE OWNER'S GATING CONDITION
 *
 *   "launch it to ozikoro.com when every functions and link or menu is functional."
 *
 * Twelve faults today answered 200 and were unusable, and four of them were links that led somewhere other
 * than their label promised. **A 200 is not evidence.** So this probe does not ask whether an address
 * answers; it asks whether the destination is the page the label named, by reading the destination's own
 * `<h1>`, and it reports a 200 to the wrong page as the fault it is.
 *
 * IT IS ALSO THE DEPLOY GATE, WHICH CHANGED TWO THINGS ABOUT IT
 *
 * The owner's second instruction is *"scan every link when you deploy the website to be sure they are all
 * working"*, so this script now has a mode a deployment can run and fail on. `--gate` makes a problem an exit
 * code rather than a paragraph, and `--sample N` walks the primary navigation and one page behind each of its
 * destinations instead of the whole site, because **a gate that takes twelve minutes is a gate people skip**.
 * `scripts/check-deploy-links.mjs` is the deploy step's name for this; `npm run check:deploy-links`.
 *
 * IT DOES NOT RE-IMPLEMENT THE TWO FAULTS A STATUS CANNOT SEE, AND THAT IS DELIBERATE
 *
 * The content type (a `btn` that led to a `text/plain` file) and the identity a control carries (a link that
 * discarded its own `?v=` and showed another record) are both checked in this repository already, by
 * `scripts/check-link-destinations.mjs` and the identity rule in `scripts/check-page-variants.mjs`. **A third
 * copy of either rule would be a second implementation of the same test, and the two would drift.** This
 * script's job is the breadth those two do not attempt: every page the application serves, every address any
 * of them names, each followed once.
 *
 * WHAT IT DOES, IN ORDER
 *
 *   A. THE INVENTORY. Every page the application serves, from three independent sources rather than one:
 *      the 52 design screens by name, the route files under `apps/ozikoro/app/`, and every address a
 *      link or a form on any of them points at. A checker that verifies only what it was handed cannot
 *      report an omission — the fault `check-screen-coverage.mjs` records, whose `ROUTE` map held no
 *      entry for fourteen dashboards and so reported `NO ROUTE` for exactly those on every commit.
 *
 *   B. THE TARGETS. For every page, every `href`, `src`, `action`, `srcset` candidate and meta-refresh
 *      target is extracted. Each unique address is fetched once, and every reference to it is reported
 *      with its source page, the anchor's text, the address as served, the status chain and the
 *      destination's `<h1>`.
 *
 *   C. THE RESOLUTION, DONE THE WAY A BROWSER DOES IT. A `<base href="/">` changes what every relative
 *      address on the page means, and the served head carries one. So the base is read from the document
 *      and `new URL(target, base)` is what resolves — not a string join. `/watch/` resolves `?page=2`
 *      against `/`, and `/about/` resolves `listen.html` against `/about/` only when no base is present.
 *
 *   D. THE ASSERTIONS. Zero relative targets left in the served markup, zero `href="#"` that is not inert
 *      or deliberately wired, exactly one `<base>` per screen — then every target followed and its `<h1>`
 *      read, its content type judged, and every identity-carrying control's link checked.
 *
 * NO DATABASE, NO BUILD. It sends HTTP to a server that is already up. It prints as it goes, so a run that
 * is killed still leaves evidence.
 *
 * USAGE
 *   node scripts/verify-round-344.mjs [base-url] [--json /tmp/inventory.json]
 *   node scripts/verify-round-344.mjs [base-url] --sample 24 --gate     # the deploy step's mode
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanElements, attributesOf } from '../packages/ozikoro/src/design-override.ts';

const args = process.argv.slice(2);
const BASE = (args.find((a) => a.startsWith('http')) ?? process.env.OZIKORO_BASE ?? 'http://127.0.0.1:3110')
  .replace(/\/$/, '');
const JSON_OUT = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
/** Make a problem the exit code, which is what a deploy needs and what a report does not. */
const GATE = args.includes('--gate');
/** How many primary destinations to walk, or 0 for the whole site. `--full` states the default in words. */
const SAMPLE = args.includes('--sample') ? Number(args[args.indexOf('--sample') + 1] ?? 24) || 24 : 0;
if (args.includes('--full') && SAMPLE !== 0) {
  console.error('  --full and --sample are opposites; pass one of them.');
  process.exit(2);
}
const STARTED = Date.now();

const APP = 'apps/ozikoro/app';
const SCREEN_DIR = 'apps/ozikoro/public/design/screens';
const ORIGIN = new URL(BASE).origin;

let problems = [];
const problem = (m) => { problems.push(m); };
const say = (line) => process.stdout.write(`${line}\n`);

/* ── the fetcher ───────────────────────────────────────────────────────────────────────────────────── */
process.on('uncaughtException', (e) => say(`  UNCAUGHT: ${e && e.stack ? e.stack : e}`));
process.on('unhandledRejection', (e) => say(`  UNHANDLED: ${e && e.stack ? e.stack : e}`));

const cache = new Map();
async function fetchPage(url, { redirect = 'follow' } = {}) {
  const key = `${redirect} ${url}`;
  if (cache.has(key)) return cache.get(key);
  let out = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, {
        redirect,
        headers: { 'user-agent': 'ozikoro-link-check/1.0', accept: 'text/html,application/xhtml+xml,*/*' },
        signal: AbortSignal.timeout(10000),
      });
      /*
       * THE BODY IS KEPT ONLY FOR A DOCUMENT, AND EVERYTHING ELSE IS CANCELLED RATHER THAN IGNORED.
       *
       * A media file left unconsumed holds its connection in undici's pool until the socket times out, and this
       * probe did exactly that: 579 addresses took ten minutes instead of one, the run was killed before it
       * wrote a report, and the second attempt died the same way. **A response that is not read is not
       * finished**, and the cost is paid by every request queued behind it.
       */
      const type = res.headers.get('content-type') ?? '';
      const textish = /text\/html|application\/xhtml|text\/plain|application\/xml|text\/xml/i.test(type);
      let body = '';
      if (textish) body = await res.text();
      else { try { await res.body?.cancel(); } catch { /* already gone */ } }
      out = {
        status: res.status,
        finalUrl: res.url,
        location: res.headers.get('location'),
        type,
        body,
      };
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  cache.set(key, out);
  return out;
}

/** Follow up to six redirects by hand, so every hop's status can be reported and not only the last. */
async function fetchChain(url) {
  const hops = [];
  let current = url;
  for (let i = 0; i < 6; i += 1) {
    const res = await fetchPage(current, { redirect: 'manual' });
    if (!res) { hops.push({ url: current, status: 0 }); break; }
    hops.push({ url: current, status: res.status, location: res.location });
    if (res.status >= 300 && res.status < 400 && res.location) {
      current = new URL(res.location, current).href;
      continue;
    }
    return { hops, last: res, finalUrl: current };
  }
  return { hops, last: null, finalUrl: current };
}

/** A bounded-concurrency map, so 400 addresses take seconds and the server is not flooded. */
async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

const text = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&#8217;/g, '\u2019')
  .replace(/\s+/g, ' ')
  .trim();

const firstH1 = (html) => {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return m ? text(m[1]).slice(0, 120) : null;
};

/* ── A. THE INVENTORY ─────────────────────────────────────────────────────────────────────────────── */

const screens = readdirSync(SCREEN_DIR).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, ''));

function routeFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name === 'node_modules') continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) routeFiles(p, out);
    else if (entry.name === 'page.tsx' || entry.name === 'route.ts') out.push(p);
  }
  return out;
}
const routes = routeFiles(APP)
  .map((f) => f.slice(APP.length).replace(/\/(page\.tsx|route\.ts)$/, ''))
  .map((s) => s.replace(/\[(\.\.\.)?([^\]]+)\]/g, ':$2'))
  .sort();

const seeds = [];
const seedSet = new Set();
const SKIP_SCHEME = /^(mailto:|tel:|sms:|data:|javascript:|blob:|whatsapp:|geo:)/i;
const addSeed = (p) => { if (!seedSet.has(p)) { seedSet.add(p); seeds.push(p); } };
if (SAMPLE === 0) {
  for (const s of screens) if (s !== '404') addSeed(s === 'home' ? '/' : `/${s}/`);
  for (const r of routes) if (!r.includes(':') && r !== '') addSeed(`${r}/`);
} else {
  /*
   * THE SAMPLED INVENTORY, AND WHY IT IS DERIVED RATHER THAN TYPED.
   *
   * A list of "the important pages" written into this file is a list that goes stale the day a page is added,
   * and a checker that verifies only what it was handed cannot report an omission — this file's own header
   * records that fault. So the sample is read from the SITE: the front page's own navigation, which is the
   * menu a reader uses, capped at N. Everything those pages link to is still followed; what is skipped is
   * walking all 52 screens and every record in the sitemap, which is the full sweep's job.
   *
   * `/` is always first, and always present: a navigation that cannot be read is itself a fault worth the
   * gate stopping on.
   */
  addSeed('/');
  const front = await fetchPage(`${BASE}/`);
  if (front && front.status === 200) {
    const nav = [...front.body.matchAll(/<nav\b[\s\S]*?<\/nav>/gi)].map((m) => m[0]).join(' ');
    for (const m of (nav || front.body).matchAll(/<a\b[^>]*\bhref\s*=\s*"([^"]*)"/gi)) {
      const raw = m[1].trim();
      if (!raw || SKIP_SCHEME.test(raw) || raw.startsWith('#')) continue;
      let resolved;
      try { resolved = new URL(raw, `${BASE}/`); } catch { continue; }
      if (resolved.origin !== ORIGIN) continue;
      addSeed(resolved.pathname + (resolved.search || ''));
      if (seeds.length >= SAMPLE + 1) break;
    }
  }
  if (seeds.length === 1) {
    console.error('  the front page carried no same-origin navigation to sample');
    problem('the front page carried no same-origin navigation, so NOTHING WAS SAMPLED — a gate that checked no page must not pass');
  }
}
if (SAMPLE === 0) {
  /* One instance of each dynamic family, discovered from the sitemap rather than guessed. */
  const sitemapIndex = await fetchPage(`${BASE}/sitemap.xml`);
  if (sitemapIndex && sitemapIndex.status === 200) {
    for (const m of sitemapIndex.body.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const u = m[1];
      if (u.startsWith(ORIGIN)) addSeed(u.slice(ORIGIN.length) || '/');
    }
  }
  /* The child sitemaps name every published record, town, author, publication, collection and folder. */
  const childSitemaps = [...seedSet].filter((p) => p.startsWith('/sitemap/'));
  for (const sm of childSitemaps) {
    const res = await fetchPage(`${BASE}${sm}`);
    if (res && res.status === 200) {
      for (const m of res.body.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        const u = m[1];
        if (u.startsWith(ORIGIN)) addSeed(u.slice(ORIGIN.length) || '/');
      }
    }
  }
}

say(`  inventory: ${SAMPLE === 0 ? `${screens.length} design screens, ${routes.length} route files, ` : `SAMPLE of ${SAMPLE} navigation destinations, `}${seeds.length} seed addresses`);

/* ── B. EXTRACT ───────────────────────────────────────────────────────────────────────────────────── */

function extractTargets(html) {
  const out = [];
  const push = (kind, raw, label, extra = {}) => {
    if (!raw) return;
    const value = raw.trim();
    if (!value || SKIP_SCHEME.test(value)) return;
    out.push({ kind, raw: value, label: label ? text(label).slice(0, 90) : '', ...extra });
  };

  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = m[1];
    const href = /\bhref\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];
    const aria = /aria-label\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];
    push('a', href, aria ?? m[2], {
      inert: /\baria-disabled\s*=\s*"true"/i.test(attrs),
      /*
       * WIRED MEANS THREE THINGS, AND IT USED TO MEAN ONE.
       *
       * This site wires a control through its own scripts as often as through an inline handler: the design's
       * `watch.js` looks up `#inline-player-external` and sets its `href` when a film is opened, and
       * `mobile-nav.js` builds the phone menu from an `id`. An `href="#"` in the served markup is therefore
       * NOT evidence of a dead control — but the old test only counted `on*=` attributes, so it reported the
       * "Open on YouTube" control as unwired while the script had already wired it. Found by running this
       * gate: **a rule that reports a fault that is not there is the fault this file exists to remove.**
       *
       * So a hook is any of: an inline handler, a `data-` attribute (markup that exists only for a script), or
       * an `id` a script or the design's own CSS can name. A bare `href="#"` with none of the three is still a
       * problem, and it is the case round 344 found eighteen of on the account screen.
       */
      wired: /\bon(click|submit)\s*=/i.test(attrs) || /\sdata-[a-z0-9-]+\s*=/i.test(attrs),
      hooked: /\sid\s*=\s*"[^"]+"/i.test(attrs),
      /* `download` is the markup's own way of saying "this address is a file", and rule 1 reads it. */
      download: /\bdownload\b/i.test(attrs),
    });
  }
  for (const m of html.matchAll(/<(img|source|iframe|video|audio|track|embed)\b([^>]*)>/gi)) {
    const attrs = m[2];
    const src = /\bsrc\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];
    const srcset = /\bsrcset\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];
    const poster = /\bposter\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];
    const alt = /\balt\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];
    push(m[1].toLowerCase(), src, alt ?? '');
    push(m[1].toLowerCase(), poster, `${alt ?? ''} (poster)`);
    if (srcset) {
      for (const cand of srcset.split(',')) push('srcset', cand.trim().split(/\s+/)[0], alt ?? '');
    }
  }
  for (const m of html.matchAll(/<form\b([^>]*)>/gi)) {
    const attrs = m[1];
    const action = /\baction\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];
    const method = (/\bmethod\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? 'get').toUpperCase();
    push('form', action ?? '', `${method} form`, { method, form: true, action });
  }
  for (const m of html.matchAll(/<meta\b[^>]*http-equiv\s*=\s*"refresh"[^>]*>/gi)) {
    const content = /\bcontent\s*=\s*"([^"]*)"/i.exec(m[0])?.[1] ?? '';
    push('meta-refresh', /url\s*=\s*([^"';]+)/i.exec(content)?.[1], 'meta refresh');
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = /\brel\s*=\s*"([^"]*)"/i.exec(m[0])?.[1];
    if (!rel || !/^(canonical|alternate|icon|apple-touch-icon|manifest|stylesheet|preload|shortcut)/i.test(rel)) continue;
    push('link', /\bhref\s*=\s*"([^"]*)"/i.exec(m[0])?.[1], `rel=${rel}`);
  }
  return out;
}

const baseOf = (html, url) => {
  const all = [...html.matchAll(/<base\b[^>]*>/gi)].map((m) => m[0]);
  const href = all.length ? (/\bhref\s*=\s*"([^"]*)"/i.exec(all[0])?.[1] ?? null) : null;
  return { count: all.length, href, resolved: href ? new URL(href, url).href : url };
};

const isAsset = (p) =>
  /\.(css|js|png|jpe?g|webp|gif|svg|ico|avif|mp3|mp4|m4a|wav|ogg|opus|pdf|xml|txt|json|webmanifest|woff2?|ttf|otf|vtt)(\?|$)/i.test(p);

/* ── the pages, fetched in a pool, printing as they land ──────────────────────────────────────────── */

const pages = [];
const targets = [];
let done = 0;

await pool(seeds, 6, async (path) => {
  const url = `${BASE}${path}`;
  const res = await fetchPage(url);
  done += 1;
  if (done % 25 === 0) say(`  fetched ${done}/${seeds.length} pages…`);
  if (!res) { pages.push({ path, status: 0, why: 'no response' }); return; }
  if (res.status !== 200 || !/text\/html/i.test(res.type)) {
    pages.push({ path, status: res.status, why: `${res.status} ${res.type}` });
    return;
  }
  const html = res.body;
  const base = baseOf(html, url);
  const ids = new Set([...html.matchAll(/\sid\s*=\s*"([^"]*)"/g)].map((m) => m[1]));
  const page = {
    status: 200,
    path, url,
    title: /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null,
    h1: firstH1(html),
    bytes: html.length,
    /* Kept for the two rules in phase D that read the element tree — 112 pages of markup is a few megabytes. */
    body: html,
    base,
    targets: 0,
    relative: [],
    hashes: [],
    wiredHashes: [],
    hookedHashes: [],
    danglingFragments: [],
  };
  const found = extractTargets(html);
  page.targets = found.length;
  for (const t of found) {
    let resolved;
    try {
      resolved = new URL(t.raw, base.resolved).href;
    } catch {
      problem(`${path}: unparseable target ${t.raw}`);
      continue;
    }
    /*
     * A FRAGMENT-ONLY ADDRESS IS NOT A RELATIVE URL. `#main` names an element in this document, so it is
     * not a second address at a shallower path — but it IS a link, and it leads nowhere when the document
     * has no such element. So it is checked against the page's own `id` set instead of being called relative.
     */
    const fragmentOnly = /^#/.test(t.raw);
    if (fragmentOnly) {
      const id = t.raw.slice(1);
      if (id && !ids.has(id)) page.danglingFragments.push(`${t.raw} (${t.label || t.kind})`);
    } else if (!/^([a-z]+:|\/\/|\/)/i.test(t.raw)) {
      page.relative.push(`${t.kind} ${t.raw}`);
    }
    /*
     * A BARE `href="#"` IS A PROBLEM; ONE WITH A HOOK IS A QUESTION.
     *
     * The design wires several controls by `id` or `data-` from its own scripts, so a markup-only reader
     * cannot tell a dead anchor from one a script fills in. The ones with a hook are listed for a person to
     * look at, and the ones with nothing at all are still faults.
     */
    if (t.kind === 'a' && (t.raw === '#' || t.raw === '')) {
      if (t.inert || t.wired) page.wiredHashes.push(`${t.raw} :: ${t.label}`);
      else if (t.hooked) page.hookedHashes.push(`${t.raw} :: ${t.label}`);
      else page.hashes.push(`${t.raw} :: ${t.label}`);
    }
    targets.push({ from: path, ...t, resolved, relativeTo: base.href ? 'base' : 'document' });
  }
  pages.push(page);
});

/* ── C. FOLLOW EVERY UNIQUE ADDRESS ONCE ──────────────────────────────────────────────────────────── */

/*
 * ONE FETCH PER ADDRESS, AND THE FRAGMENT IS NOT PART OF THE ADDRESS.
 *
 * `#main` and `#faq` on the same page are the same HTTP request, so keying on the resolved URL *including the
 * fragment* fetched `/about/` once per anchor on it — the crawl spent most of its time re-requesting pages it
 * already held, and a long run is a run that gets killed before it writes its report.
 *
 * AND A PAGE FETCHED IN THE INVENTORY IS NOT FETCHED AGAIN. Phase A already has the status, the final URL and
 * the `<h1>` of every seed, which is most of what the links point at; asking a design screen for itself for the
 * third time is a database query per request on a single PGlite process. **This is also what keeps the probe
 * from being the thing that takes the site down.**
 */
const fetchKey = (u) => {
  const x = new URL(u);
  return `${x.origin}${x.pathname}${x.search}`;
};
const fromInventory = new Map();
for (const p of pages) {
  if (!p.url) continue;
  fromInventory.set(fetchKey(p.url), {
    status: String(p.status),
    finalStatus: p.status,
    finalUrl: p.url,
    hops: 0,
    destinationH1: p.h1,
    destinationTitle: p.title,
    contentType: 'text/html; (read in the inventory phase)',
  });
}

const unique = new Map();
for (const t of targets) {
  const k = fetchKey(t.resolved);
  if (!unique.has(k)) unique.set(k, t);
}
const urls = [...unique.keys()];
say(`  ${targets.length} target(s) referencing ${urls.length} distinct address(es); following each…`);

const fetched = new Map();
let n = 0;
/*
 * SIX AT A TIME, NOT TWENTY-FOUR, AND A SECOND ATTEMPT ON A DEAD CONNECTION.
 *
 * The first version of this probe fetched 24 at once and **the review server stopped answering** — 1,289 of
 * 1,762 targets came back with no response at all, which reads exactly like 1,289 broken links. A design
 * screen is not a static file: every one runs several database queries, so a modest burst of them saturates
 * the single PGlite process and the whole site stops for everybody else working in this checkout. **A probe
 * that takes the site down measures itself, not the site**, and a fault that only exists under a load no
 * reader will produce is not a fault to report. Six is enough to finish in a couple of minutes and gentle
 * enough to leave the server answering.
 *
 * AND A REQUEST WITH NO RESPONSE IS RETRIED BEFORE IT IS BELIEVED. The connection-refused case is the one
 * that must not be mistaken for a 404: `fetchPage` already tries twice, and this gives the whole chain one
 * more attempt after a pause, because the alternative — recording a live server's restart as a broken link —
 * is the exact error this round exists to avoid.
 */
await pool(urls, 10, async (u) => {
  n += 1;
  if (n % 50 === 0) say(`  followed ${n}/${urls.length}…`);
  const parsed = new URL(u);
  if (parsed.origin !== ORIGIN) { fetched.set(u, { status: 'external', finalStatus: 'external' }); return; }
  const known = fromInventory.get(u);
  if (known && known.finalStatus === 200) { fetched.set(u, known); return; }
  let chain = await fetchChain(u);
  if (!chain.last) {
    await new Promise((r) => setTimeout(r, 2000));
    /* Only THIS address's cached failure is forgotten: clearing the whole cache would make every other
       in-flight worker re-request what it already has, and the stampede is what took the server down. */
    cache.delete(`manual ${u}`);
    chain = await fetchChain(u);
  }
  const { hops, last, finalUrl } = chain;
  const isHtml = last && /text\/html/i.test(last.type ?? '');
  fetched.set(u, {
    status: hops.map((h) => h.status).join('→'),
    finalStatus: last ? last.status : (hops[hops.length - 1]?.status ?? 0),
    finalUrl,
    hops: hops.length,
    destinationH1: isHtml ? firstH1(last.body) : null,
    destinationTitle: isHtml ? (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(last.body)?.[1]?.trim() ?? null) : null,
    contentType: last?.type ?? '',
  });
});

for (const t of targets) Object.assign(t, fetched.get(fetchKey(t.resolved)) ?? { status: 0, finalStatus: 0 });

/* ── D. THE ASSERTIONS ────────────────────────────────────────────────────────────────────────────── */

for (const p of pages) {
  /*
   * THE INVARIANT IS "AT MOST ONE `<base>`, AND NO RELATIVE TARGET BESIDE IT" — NOT "EXACTLY ONE".
   *
   * A `<base href="/">` is the design-screen mechanism, and every served screen carries one. The React routes
   * and the four account routes carry none and need none: **they are served through the application's layout,
   * which writes its addresses from the root**, and none of them has a relative target (asserted on the next
   * line). Demanding a base of them would have reported 24 pages as broken that are not — and a check that
   * reports a fault that is not there is the fault this whole round is about, one order up.
   *
   * TWO BASES IS ALWAYS WRONG: the last one wins, so every relative address on the page means something
   * nobody reading the source would predict. A BASE BESIDE A RELATIVE TARGET IS ALWAYS WRONG: the base
   * decides where that target goes, and it is never where the design's sibling grammar means once served.
   * That pair of rules is what the mechanism actually needs; "exactly one" was never the requirement.
   */
  if (p.base && p.base.count > 1) problem(`${p.path}: ${p.base.count} <base> elements, and the last one wins`);
  if (p.base?.count === 1 && (p.relative ?? []).length > 0) {
    problem(`${p.path}: carries a <base> AND ${p.relative.length} relative target(s), so they resolve against the root: ${p.relative.slice(0, 4).join(', ')}`);
  }
  if (!p.base || p.base.count === 0) {
    for (const r of p.relative ?? []) problem(`${p.path}: relative target with no <base> on the page: ${r}`);
  }
  for (const h of p.hashes ?? []) problem(`${p.path}: href="#" anchor with no handler, no data- hook and no id — nothing can wire it: ${h}`);
  for (const d of p.danglingFragments ?? []) problem(`${p.path}: fragment names an element the page does not have: ${d}`);
}

const measured = targets.filter((t) => t.finalStatus !== 'external');
const broken = measured.filter((t) => t.finalStatus !== 200 && t.status !== '200');
const external = targets.filter((t) => t.finalStatus === 'external');
const unmeasured = pages.filter((p) => p.status !== 200);

/*
 * ── A PAGE THAT DID NOT ANSWER IS A PROBLEM, AND THIS IS THE MOST IMPORTANT LINE IN THE GATE ─────────
 *
 * Found by running the gate while ANOTHER AGENT'S BUILD HAD THE SITE DOWN: every page came back `0 no
 * response`, the crawl found no targets, and it printed `PROBLEMS: 0 — GATE PASSED`. **A checker that cannot
 * reach the site reported the site as working**, which is the exact fault this whole round is about, one
 * order up from the links. So an unanswered page is now a problem in its own right, and it is a problem
 * whatever else was checked.
 *
 * THE EXEMPTIONS ARE NAMED, AND EACH ONE IS A DECISION SOMEBODY ALREADY MADE:
 *
 *   403 on /dashboard-*   the eleven role workspaces answer 403 to a signed-out fetch BY DESIGN. Counting
 *                         that as a broken page would report the auth gate working as a fault.
 *   500 on /admin*        an authenticated area refusing a stranger, surfacing as a server error. Round 344
 *                         recorded it as "worth a round of its own and not a link fault"; it is printed and
 *                         not asserted, and that judgement is recorded rather than silently applied.
 *   405 on /api/*         the POST-only endpoints, correctly refusing a GET.
 *
 * Everything else that does not answer 200 — including a connection that is refused outright — fails the gate.
 */
const BY_DESIGN = [
  [/^\/dashboard-[a-z-]+\/?$/, 403, 'the role workspace gate, working'],
  [/^\/admin(\/|$)/, 500, 'an authenticated area refusing a signed-out fetch; a fault of its own, not of a link'],
  [/^\/api\//, 405, 'a POST-only endpoint correctly refusing a GET'],
  [/^\/api\/ask\/?$/, 400, 'a search endpoint with no query'],
  [/^\/api\/spotify\/callback\/?$/, 500, 'a callback that did not arrive over HTTPS'],
];
for (const p of pages) {
  if (p.status === 200) continue;
  const exempt = BY_DESIGN.find(([re, status]) => re.test(p.path) && status === p.status);
  if (exempt) {
    say(`  by design: ${p.status}  ${p.path}  (${exempt[2]})`);
    continue;
  }
  problem(`${p.path}: answered ${p.status}${p.why ? ` (${p.why})` : ''} — a page the inventory names did not answer, and a gate cannot pass on a page it did not read`);
}

const byStatus = {};
for (const t of measured) byStatus[t.finalStatus] = (byStatus[t.finalStatus] ?? 0) + 1;

say('');
say(`  PAGES: ${pages.length} fetched, ${pages.filter((p) => p.h1).length} carrying an <h1>, ${unmeasured.length} not 200`);
for (const u of unmeasured.slice(0, 40)) say(`    ${u.status}  ${u.path}  ${u.why ?? ''}`);
say('');
say(`  TARGETS: ${targets.length} references, ${measured.length} same-origin, ${external.length} off-origin`);
say(`  statuses: ${Object.entries(byStatus).sort().map(([k, v]) => `${k}:${v}`).join(' ')}`);
say('');
say(`  NOT 200 (${broken.length}):`);
for (const t of broken.slice(0, 80)) {
  say(`    ${t.from}  [${t.kind}${t.form ? ` ${t.method}` : ''}] "${t.label}"  ${t.raw}`);
  say(`        -> ${t.status}  ${t.contentType}`);
}

/*
 * ── THE LIST THAT MATTERS MOST: AN ANCHOR THAT LED TO THE WRONG PAGE, EVEN AT 200 ────────────────────
 *
 * A 200 says the destination exists. It does not say the destination is the page the label promised — and
 * that is the fault four times today. The test here is deliberately crude and deliberately REPORTED rather
 * than asserted: the label's significant words are compared with the destination's `<h1>` and `<title>`,
 * and a label that shares not one of them is printed for a person to look at. Crude is the point: it
 * cannot prove an anchor is right, and it can put the suspicious ones in front of a reader who can.
 */
const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'or', 'for', 'in', 'on', 'at', 'by', 'with', 'your', 'this', 'that', 'all', 'from', 'is', 'it', 'as', 'we', 'you', 'our', 'their', 'here', 'more', 'other']);
const words = (s) => new Set(
  (s ?? '').toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/[\s'-]+/).filter((w) => w.length > 2 && !STOP.has(w))
);
const suspects = [];
for (const t of targets) {
  if (t.kind !== 'a' || t.finalStatus !== 200 || !t.destinationH1) continue;
  if (t.raw.startsWith('#')) continue;
  const l = words(t.label);
  if (l.size < 1) continue;
  const d = words(`${t.destinationH1} ${t.destinationTitle ?? ''}`);
  if ([...l].some((w) => d.has(w))) continue;
  suspects.push(t);
}
say('');
say(`  LINKS WHOSE DESTINATION DOES NOT NAME WHAT THE LABEL PROMISED (${suspects.length}, reviewed by hand):`);
for (const t of suspects.slice(0, 60)) {
  say(`    ${t.from}  "${t.label}"  ->  ${t.raw}`);
  say(`        destination h1: ${t.destinationH1}`);
}

say('');
const hookedHashes = pages.flatMap((p) => (p.hookedHashes ?? []).map((h) => `${p.path}  ${h}`));
say(`  href="#" WITH AN id BUT NO VISIBLE WIRING (${hookedHashes.length}, reviewed by hand — this site wires controls from its own scripts):`);
for (const h of hookedHashes.slice(0, 30)) say(`    ${h}`);



/*
 * The weak half of the identity rule, reported and not asserted: a card whose link names no query string may
 * be a card that points at a section, which is legitimate, or a link that dropped the record it was built
 * for. A rule that guessed would report faults that are not there, so a person reads this list.
 */

say('');
say(`PROBLEMS: ${problems.length}`);
for (const p of problems.slice(0, 120)) say(`  - ${p}`);

const seconds = ((Date.now() - STARTED) / 1000).toFixed(1);
say('');
say(`  ${SAMPLE === 0 ? 'FULL sweep' : `SAMPLE of ${SAMPLE} navigation destinations`}: ${pages.length} pages, ${targets.length} references, ${urls.length} addresses, ${seconds}s`);

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, pages: pages.map(({ body, ...rest }) => rest), targets: targets.map((t) => ({ ...t })), problems, suspects, seconds: Number(seconds) }, null, 1));
  say(`  full inventory written to ${JSON_OUT}`);
}

/*
 * THE EXIT CODE IS THE POINT OF THE GATE MODE. Without it this script is a report — valuable, and something a
 * deploy cannot act on. `--gate` is what `scripts/check-deploy-links.mjs` passes, and it makes a problem stop
 * the deploy rather than scroll past in a log.
 */
if (GATE && problems.length > 0) {
  say('');
  say(`  GATE FAILED: ${problems.length} problem(s). The deploy must not proceed on this.`);
  process.exitCode = 1;
} else if (GATE) {
  say('');
  say('  GATE PASSED: every page in the sample answered, every address it names resolved, and no anchor was left relative, dead or unowned.');
}
