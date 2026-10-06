/*
 * audit-buttons.mjs — find controls that render but cannot do anything.
 *
 * ── WHICH MODE ANSWERS WHICH QUESTION ─────────────────────────────────────────────────────────────
 *
 *   node scripts/audit-buttons.mjs [dir]
 *       THE REACT SOURCE. Walks `.tsx` files (default `apps/ozikoro/app/admin`) and looks for the
 *       shapes a dead control takes in a server component: an orphan `<button>`, a toast-only handler,
 *       a field outside any form, and an `<a>` that is drawn as a destination and is not one.
 *       **It answers "is a control structurally incapable of acting" — not "does its endpoint exist".**
 *
 *   node scripts/audit-buttons.mjs --screens [dir]
 *       THE DESIGN'S OWN HTML FILES (default `apps/ozikoro/public/design/screens`).
 *       ⚠️ **IT REPORTS WHAT THE INVIOLABLE FILE CARRIES, AND THAT NUMBER IS NOT THE DEFECT.** The
 *       deliverable is byte-compared against the handover copy and is full of `href="#"` by construction,
 *       so this mode reports the design as written — measured: **156 across the fourteen dashboards.**
 *       *A finding here is not a thing to fix in the file; it is a thing the serve-time transform has to
 *       answer.* It exists to keep that baseline honest and to catch a screen whose placeholders change.
 *
 *   node scripts/audit-buttons.mjs --served [baseUrl]
 *       🔴 **THE SERVED PAGE — THIS IS THE NUMBER THAT MATTERS.** Fetches the fourteen dashboards
 *       (`http://127.0.0.1:3110` by default) and reports the dead controls that actually reach a reader.
 *       `href="#"` in the file means nothing if the transform removed it; an `<a aria-disabled="true">`
 *       means everything, because **that one looks handled and is not.**
 *           --cookie-file <path>   a file holding the `ozituma_session` value (never echoed)
 *           --only a,b,c           audit just these screens
 *       The cookie may also come from `$OZITUMA_REVIEW_COOKIE`. Without one, the two member dashboards
 *       answer 307 to sign-in and are reported as unreachable rather than silently counted clean.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────────
 *
 * The owner's instruction, verbatim:
 *
 *   *"when you import the design finish, make sure every single button works and built"*
 *
 * **That is the failure a design import produces most reliably.** The file he sent is a working
 * prototype whose buttons are `onclick="toast('All pending design changes saved')"` — every one of them
 * makes a small black box appear and writes nothing. *Carried into the product they look finished and
 * are not, which is worse than absent: the screen teaches everyone who opens it that the feature is
 * done.*
 *
 * ── THE SECOND DEAD SHAPE, WHICH FOOLED EVERYBODY ──────────────────────────────────────────────────
 *
 * The first version of this script knew one dead anchor: `href="#"` or no `href`. **The owner's own
 * report then named a control that this check called clean** — `<a class="btn btn-gold"
 * aria-disabled="true" title="…">Open next task</a>` on `/dashboard-reader`:
 *
 *   * `aria-disabled` is an accessibility hint. **It does not prevent the click, it does not prevent
 *     navigation, and it does not change what a sighted person sees.**
 *   * the gold `.btn-gold` still looked live, the item still sat in the tab order, and pressing it did
 *     nothing.
 *
 * *A control marked `aria-disabled` is a control the owner still believes works*, which is why the
 * served dashboards carried **78 of them** while this script reported the pages clean. So
 * `<a aria-disabled="true">` is now reported as a dead control in every mode — in the source, in the
 * design files, and above all on the served page. **The honest shape is a `<span>`**, which cannot be
 * clicked, cannot be focused and is visibly inert.
 *
 * ⚠️ **AND ITS HONEST LIMIT, UNCHANGED:** in source mode a `type="submit"` button inside a `<form>` is
 * counted as wired because the form carries the action — **this script does not follow the form to its
 * endpoint.** So "0 findings" means "no control is structurally incapable of doing something", not
 * "every endpoint exists".
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/* ── THE FOURTEEN DASHBOARDS, FROM THE DELIVERABLE'S OWN FILENAMES ──────────────────────────────── */
const DASHBOARDS = [
  'dashboard-reader', 'dashboard-editor', 'dashboard-admin', 'dashboard-researcher',
  'dashboard-student', 'dashboard-teacher', 'dashboard-reviewer', 'dashboard-moderation',
  'dashboard-knowledge-holder', 'dashboard-independent-researcher', 'dashboard-account',
  'dashboard-workflow', 'dashboard-states', 'dashboard-review',
];

/* ── ARGUMENTS ─────────────────────────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
/** The two flags that take a value; every other `--…` is a marker. */
const VALUE_FLAGS = new Set(['--cookie-file', '--only']);
function flagValue(name, fallback) {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
}
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  if (VALUE_FLAGS.has(argv[i])) {
    i += 1;
    continue;
  }
  if (argv[i].startsWith('--')) continue;
  positional.push(argv[i]);
}
const MODE = argv.includes('--served') ? 'served' : argv.includes('--screens') ? 'screens' : 'source';

/* ================================================================================================
 * THE HTML MODES — `--served` AND `--screens` SHARE ONE SCANNER
 * ============================================================================================== */

/**
 * Every `<a …>` opening tag in a served page, with the readable text inside it.
 *
 * It walks the tag character by character rather than matching `<a([^>]*)>`, for the reason the source
 * scanner below was rewritten to walk too: **an attribute value may legally contain a `>`**, and a
 * regex that stops at the first one truncates the tag and misreads every attribute after it.
 */
function anchorTags(html) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = html.indexOf('<a ', from);
    if (at === -1) return out;
    let i = at + 2;
    let quote = null;
    while (i < html.length) {
      const c = html[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      }
      i += 1;
    }
    const close = html.indexOf('</a>', i);
    out.push({
      attrs: html.slice(at + 2, i),
      inner: (close === -1 ? '' : html.slice(i + 1, close)).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
    });
    from = at + 2;
  }
}

/**
 * The dead controls in one HTML document.
 *
 * ⚠️ **A `<span aria-disabled="true">` IS NOT A FINDING AND MUST NEVER BE ONE.** That is the honest
 * shape this work produces: it cannot be clicked, cannot be focused, and is visibly inert. Reporting it
 * would teach the next person to delete the marking.
 */
function deadControlsHtml(html) {
  const found = [];
  for (const { attrs, inner } of anchorTags(html)) {
    const href = attrs.match(/\shref=("([^"]*)"|'([^']*)')/);
    const value = href ? (href[2] ?? href[3] ?? '').trim() : null;
    if (/aria-disabled="true"/.test(attrs)) {
      /*
       * A REAL DESTINATION WITH `aria-disabled` IS STILL A DEAD CONTROL UNLESS THE MARKING IS A LIE.
       * Nothing measured on this site carries that shape; if one appears, it is reported rather than
       * guessed at, because the two possible repairs — drop the marking, or drop the link — are opposite.
       */
      found.push({ kind: 'INERT ANCHOR', what: `aria-disabled="true"${value ? ` href="${value}"` : ''}`, label: inner });
    } else if (value === null) {
      found.push({ kind: 'NO HREF', what: attrs.replace(/\s+/g, ' ').trim().slice(0, 100), label: inner });
    } else if (value === '#' || value === '') {
      found.push({ kind: 'DEAD HREF', what: `href="${value}"`, label: inner });
    }
  }
  return found;
}

/* ── `--screens`: THE DESIGN'S OWN FILES, AS WRITTEN ───────────────────────────────────────────── */
if (MODE === 'screens') {
  const dir = positional[0] ?? 'apps/ozikoro/public/design/screens';
  const files = readdirSync(dir).filter((f) => f.endsWith('.html')).sort();
  let total = 0;
  const rows = [];
  for (const f of files) {
    const found = deadControlsHtml(readFileSync(join(dir, f), 'utf8'));
    total += found.length;
    if (found.length) rows.push([f, found]);
  }
  console.log(`audited ${files.length} design HTML file(s) under ${dir}`);
  console.log('');
  for (const [f, found] of rows) console.log(`${String(found.length).padStart(4)}  ${f}`);
  console.log('');
  console.log(`🔴 ${total} dead control(s) IN THE DELIVERABLE, which is inviolable and is not where they are fixed.`);
  console.log('   ⚠️ THIS IS NOT THE DEFECT. The number that matters is `--served`:');
  console.log('      the design keeps its `href="#"` and the serve-time transform answers it.');
  if (rows.length === 0) process.exit(0);
  process.exit(1);
}

/* ── `--served`: WHAT THE SERVER ACTUALLY SENDS ─────────────────────────────────────────────────── */
if (MODE === 'served') {
  const base = (positional[0] ?? 'http://127.0.0.1:3110').replace(/\/$/, '');
  const only = flagValue('--only', null);
  const screens = only ? only.split(',').map((s) => s.trim()).filter(Boolean) : DASHBOARDS;
  const cookieFile = flagValue('--cookie-file', null);
  const cookie = cookieFile
    ? readFileSync(cookieFile, 'utf8').trim()
    : (process.env.OZITUMA_REVIEW_COOKIE ?? '').trim();

  console.log(`auditing the SERVED dashboards at ${base}`);
  console.log(cookie ? '  session: supplied (value not printed)' : '  ⚠️ no session supplied — member dashboards will answer 307');
  console.log('');
  console.log('screen                                 status  href="#"   <a aria-disabled>  no href');

  const findings = [];
  let unreachable = 0;
  for (const screen of screens) {
    let status = 0;
    let html = '';
    try {
      const res = await fetch(`${base}/${screen}`, {
        headers: cookie ? { cookie: `ozituma_session=${cookie}` } : {},
        redirect: 'manual',
      });
      status = res.status;
      html = await res.text();
    } catch (error) {
      status = 0;
    }
    const dead = html ? deadControlsHtml(html) : [];
    const count = (kind) => dead.filter((d) => d.kind === kind).length;
    /*
     * A REDIRECT OR A REFUSAL IS NOT A CLEAN PAGE. `dashboard-reader` answers 307 to sign-in without a
     * session and `dashboard-admin` answers 403 — counting either as "0 findings" is how a check reports
     * on a page it never saw.
     */
    if (status !== 200) unreachable += 1;
    console.log(
      `${screen.padEnd(38)} ${String(status || 'ERR').padEnd(6)} ${String(count('DEAD HREF')).padEnd(9)} ` +
        `${String(count('INERT ANCHOR')).padEnd(17)} ${count('NO HREF')}`
    );
    for (const d of dead) findings.push({ screen, ...d });
  }

  console.log('');
  const byKind = new Map();
  for (const f of findings) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);
  for (const [kind, rows] of byKind) {
    console.log(`🔴 ${kind} — ${rows.length}`);
    for (const r of rows) console.log(`   ${r.screen}: ${r.label || '(no text)'}   [${r.what}]`);
    console.log('');
  }
  if (findings.length === 0 && unreachable === 0) {
    console.log('✅ every served dashboard carries no dead anchor');
    process.exit(0);
  }
  if (findings.length === 0) {
    console.log(`⚠️ no dead anchor found — but ${unreachable} screen(s) did not answer 200, so they were not audited.`);
    process.exit(1);
  }
  console.log(`🔴 ${findings.length} dead control(s) on the SERVED dashboards.`);
  console.log('   An `<a aria-disabled="true">` is the one that fooled everyone: it looks handled and is not.');
  console.log('   A real destination, or a `<span>` that looks unavailable. Never an `<a href="#">`.');
  process.exit(1);
}

/* ================================================================================================
 * SOURCE MODE — THE REACT SERVER COMPONENTS
 * ============================================================================================== */

const ROOT = positional[0] ?? 'apps/ozikoro/app/admin';

/** Every .tsx file under a directory, recursively. */
function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * Find the `<form>` ranges in a file, so a button can be tested for being inside one.
 *
 * The nesting count is deliberate rather than a regex on `<form>…</form>`: these files contain nested
 * `<div>`s between the form and its buttons, and a non-greedy match would stop at the first `</div>`
 * and report every button in a real form as orphaned. **A false accusation here is worse than a missed
 * one, because the next person stops trusting the tool.**
 */
function formRanges(src) {
  const ranges = [];
  const re = /<form\b/g;
  let m;
  while ((m = re.exec(src))) {
    const open = m.index;
    const tagEnd = src.indexOf('>', open);
    if (tagEnd < 0) continue;
    let depth = 1;
    let i = tagEnd + 1;
    while (i < src.length && depth > 0) {
      const nextOpen = src.indexOf('<form', i);
      const nextClose = src.indexOf('</form>', i);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1;
        i = nextOpen + 5;
      } else {
        depth -= 1;
        i = nextClose + 7;
      }
    }
    ranges.push([open, i]);
  }
  return ranges;
}

/**
 * Every `<button …>` and `<a …>` opening tag, found by counting braces rather than by regex.
 *
 * ⚠️ **A REGEX CANNOT DO THIS AND THE FIRST VERSION PROVED IT.** *`/<a\b([\s\S]*?)>/` stops at the
 * first `>`, but a JSX attribute may legally contain one — `href={tabHref('text', { from })}`, a
 * comparison, an arrow function — and it may contain `}` inside a nested object, which breaks a
 * non-greedy `\{([\s\S]*?)\}` just as badly.* **Measured: 117 findings, of which 111 were real links
 * accused of being dead.** So the tag is walked character by character: a `{` opens a brace depth that
 * a `}` closes, a quote opens a string that its own kind of quote closes, and the tag ends at a `>`
 * that is at depth zero and outside any string.
 */
function tags(src, name) {
  const out = [];
  const open = new RegExp(`<${name}\\b`, 'g');
  let m;
  while ((m = open.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let quote = null;
    while (i < src.length) {
      const c = src[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === '`') {
        quote = c;
      } else if (c === '{') {
        depth += 1;
      } else if (c === '}') {
        depth -= 1;
      } else if (c === '>' && depth === 0) {
        break;
      }
      i += 1;
    }
    out.push({ text: src.slice(m.index, i), index: m.index });
  }
  return out;
}

/**
 * Blank out every comment, keeping the line structure so reported line numbers stay true.
 *
 * ⚠️ **BOTH KINDS, AND THE SECOND KIND WAS THE LAST FOUR FALSE FINDINGS.**
 *
 * The first version stripped only JSX comments — `{/* … *\/}` — and left `/** … *\/` doc comments
 * alone. **But this codebase's doc comments are prose that quotes markup**: *"PLAIN `<a>`, NOT
 * `next/link`"*, *"a `<a>` with `href=\"#\"`"*. **Four real `<a>` mentions inside sentences were
 * reported as dead links**, which is the same fault as the 111 before it: the scanner reading
 * documentation as code.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

const findings = [];
let buttons = 0;
let links = 0;
let fields = 0;
let disabledHonestly = 0;

for (const file of files(ROOT)) {
  const src = stripComments(readFileSync(file, 'utf8'));
  const rel = relative(process.cwd(), file);
  const ranges = formRanges(src);
  const inForm = (at) => ranges.some(([a, b]) => at > a && at < b);

  // ── BUTTONS ────────────────────────────────────────────────────────────────────────────────────
  for (const t of tags(src, 'button')) {
    buttons += 1;
    const attrs = t.text;
    const line = src.slice(0, t.index).split('\n').length;
    const isSubmit = /type\s*=\s*["']submit["']/.test(attrs) || /type\s*=\s*\{\s*["']submit["']\s*\}/.test(attrs);
    const hasHandler = /onClick\s*=/.test(attrs);
    const wrapped = inForm(t.index);
    const toastOnly = /onClick\s*=\s*\{?\s*\(?\)?\s*=>\s*(toast|alert)\s*\(/.test(attrs);
    /*
     * ⚠️ A DISABLED BUTTON IS NOT A DEAD ONE. A control that says it cannot be used, and says why, is
     * honest — the toolbar in `classic-editor/editor.tsx` draws its buttons disabled until the editor
     * reports them available, which is the truthful state. **What is not honest is a button that looks
     * pressable and does nothing.** So a disabled control is counted and reported apart from a finding.
     */
    const disabled = /(^|\s)disabled(\s|=|>|$)/.test(attrs);

    if (toastOnly) {
      findings.push({ kind: 'TOAST ONLY', file: rel, line, what: attrs.replace(/\s+/g, ' ').slice(0, 100) });
    } else if (disabled) {
      disabledHonestly += 1;
    } else if (!isSubmit && !hasHandler && !wrapped) {
      findings.push({ kind: 'ORPHAN BUTTON', file: rel, line, what: attrs.replace(/\s+/g, ' ').slice(0, 100) });
    }
  }

  // ── FIELDS OUTSIDE ANY FORM ────────────────────────────────────────────────────────────────────
  /*
   * ⚠️ **THIS CHECK EXISTS BECAUSE ITS ABSENCE LET A REAL DEFECT THROUGH, AND THE OWNER HAD ALREADY
   * TOLD US WHAT TO LOOK FOR.**
   *
   * The first version of this script looked only for `<button>` and `<a>`. **The rebuilt Design
   * Studio's Profile tab then rendered four `<input>`s and a `<textarea>` with NO `<form>` and NO
   * button at all** — fields that look editable, that a person can type into, and that nothing can
   * ever save. *The audit reported ✅ on that page, because an input is not a button.*
   *
   * **An input that cannot be submitted is the same fault as a button that cannot act**, and it is
   * worse in one way: it invites a person to do work that is then thrown away.
   *
   * ⚠️ **THE EXEMPTIONS ARE NAMED RATHER THAN LEFT TO A REGEX TO GUESS.** *A search box that navigates
   * on `onChange`, a filter that posts by `form` attribute, and a file input inside a form are all
   * fine; a file input with no form is not.* A field is counted as wired when it is inside a `<form>`
   * — the form is what carries the action — or when it declares `form=` naming one, or when it has a
   * handler, or when it is `type="hidden"` (a value carried by other means).
   */
  for (const t of tags(src, 'input')) {
    fields += 1;
    const attrs = t.text;
    const line = src.slice(0, t.index).split('\n').length;
    const type = /type\s*=\s*["']([^"']*)["']/.exec(attrs)?.[1] ?? 'text';
    if (type === 'hidden') continue;
    if (inForm(t.index)) continue;
    if (/\bform\s*=/.test(attrs)) continue;
    if (/onChange\s*=/.test(attrs)) continue;
    findings.push({
      kind: 'FIELD OUTSIDE A FORM',
      file: rel,
      line,
      what: `type=${type} — cannot be saved by anything`,
    });
  }
  for (const t of tags(src, 'textarea')) {
    fields += 1;
    if (!inForm(t.index) && !/\bform\s*=/.test(t.text) && !/onChange\s*=/.test(t.text)) {
      findings.push({
        kind: 'FIELD OUTSIDE A FORM',
        file: rel,
        line: src.slice(0, t.index).split('\n').length,
        what: 'textarea — cannot be saved by anything',
      });
    }
  }
  for (const t of tags(src, 'select')) {
    fields += 1;
    if (!inForm(t.index) && !/\bform\s*=/.test(t.text) && !/onChange\s*=/.test(t.text)) {
      findings.push({
        kind: 'FIELD OUTSIDE A FORM',
        file: rel,
        line: src.slice(0, t.index).split('\n').length,
        what: 'select — cannot be saved by anything',
      });
    }
  }

  // ── LINKS ──────────────────────────────────────────────────────────────────────────────────────
  for (const t of tags(src, 'a')) {
    links += 1;
    const attrs = t.text;
    const line = src.slice(0, t.index).split('\n').length;
    const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|(\{[\s\S]*\}))/.exec(attrs);
    /*
     * ── THE SHAPE THAT FOOLED EVERYONE, NOW A FINDING ─────────────────────────────────────────────
     *
     * `<a aria-disabled="true">` is reported whether or not it has an `href`, because the marking does
     * not stop a click, does not stop navigation and does not change what a sighted person sees. The
     * `title` that usually accompanies it is invisible to a touch reader, and this archive's audience
     * is largely on a phone. **The honest shape is a `<span>`** — reported by neither branch below,
     * because a span is not an `<a>` at all.
     */
    if (/aria-disabled/.test(attrs)) {
      findings.push({
        kind: 'INERT ANCHOR',
        file: rel,
        line,
        what: attrs.replace(/\s+/g, ' ').slice(0, 100),
      });
      continue;
    }
    if (!href) {
      findings.push({ kind: 'NO HREF', file: rel, line, what: attrs.replace(/\s+/g, ' ').slice(0, 100) });
    } else {
      const value = href[1] ?? href[2] ?? '';
      const isExpression = href[3] !== undefined;
      if (!isExpression && (value === '#' || value.trim() === '')) {
        findings.push({ kind: 'DEAD HREF', file: rel, line, what: `href="${value}"` });
      }
    }
  }
}

console.log(`audited ${files(ROOT).length} files under ${ROOT}`);
console.log(
  `  ${buttons} <button>  ·  ${links} <a>  ·  ${fields} field(s)  ·  ` +
    `${disabledHonestly} button(s) disabled with a reason`
);
console.log('');

if (findings.length === 0) {
  console.log('✅ no control is structurally incapable of doing something');
  console.log('   ⚠️ blind spot: a type="submit" inside a form is counted as wired WITHOUT following');
  console.log('      the form to its endpoint. Verify the endpoints by fetching the built pages —');
  console.log('      `node scripts/audit-buttons.mjs --served` is that check for the dashboards.');
  process.exit(0);
}

const byKind = new Map();
for (const f of findings) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);

for (const [kind, rows] of byKind) {
  console.log(`🔴 ${kind} — ${rows.length}`);
  for (const r of rows) {
    console.log(`   ${r.file}:${r.line}`);
    console.log(`     ${r.what}`);
  }
  console.log('');
}
console.log(`🔴 ${findings.length} control(s) render without a way to act.`);
console.log('   A button that does nothing is worse than no button: it teaches the owner the screen');
console.log('   is finished when it is not. Wire it, or take it out.');
process.exit(1);
