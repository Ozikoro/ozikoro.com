/*
 * audit-buttons.mjs — find controls that render but cannot do anything.
 *
 *   node scripts/audit-buttons.mjs [dir]
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
 * So this looks for the three shapes a dead control takes in a React server component:
 *
 *   1. A `<button>` that is not `type="submit"`, has no `onClick`, and is not inside a `<form>`.
 *      *It cannot do anything: there is no handler and no form for it to submit.*
 *   2. A `<button>` whose only handler is a local toast/alert.
 *   3. An `<a>` with `href="#"` or no `href`. *It is drawn as a destination and is not one.*
 *
 * ⚠️ **IT REPORTS, IT DOES NOT JUDGE, AND IT HAS A KNOWN BLIND SPOT.** A `type="submit"` button inside
 * a `<form>` is counted as wired because the form is what carries the action — **this script does not
 * follow the form to its endpoint.** So "0 findings" means "no control is structurally incapable of
 * doing something", not "every endpoint exists". The second half is checked by fetching the built pages.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.argv[2] ?? 'apps/ozikoro/app/admin';

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
  console.log('      the form to its endpoint. Verify the endpoints by fetching the built pages.');
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
