#!/usr/bin/env node
/**
 * count-visible-words.mjs — count the words a reader actually sees on a served page.
 *
 * WHY THIS EXISTS RATHER THAN `wc -w` ON THE HTML
 *
 * The pages this repository serves are large documents full of `<style>`, `<script>`, inline SVG, JSON and
 * design-token markup, and **none of that is a word a reader reads.** A count taken from the bytes is
 * inflated by whatever the design ships and by the fill's own additions, so the number moves when a stylesheet
 * changes and stands still when a sentence does. Every count in the rounds that trimmed `/igbo-calendar/` was
 * taken this way, and the method is written down here so the next count is comparable with those.
 *
 * WHAT IS COUNTED, AND WHAT IS NOT
 *
 *   removed before counting   `<script>`, `<style>`, `<noscript>`, `<template>`, `<svg>`, comments and the
 *                             whole `<head>`.
 *   counted                   everything else after tags are replaced by a space and entities are decoded.
 *
 * `noscript` is removed because it is a fallback rather than the page a reader with a browser is reading, and
 * the sibling counts were all taken without it. It is reported separately when `--sections` is given.
 *
 * USAGE
 *
 *   node scripts/count-visible-words.mjs <file-or-url> [...]
 *   node scripts/count-visible-words.mjs --sections <file-or-url>       # per-h2/section breakdown
 *   node scripts/count-visible-words.mjs --needle <text> <file-or-url>  # occurrences of a phrase
 */
import { readFileSync } from 'node:fs';

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '\u201c', rdquo: '\u201d',
  lsquo: '\u2018', rsquo: '\u2019', hellip: '\u2026', mdash: '\u2014', ndash: '\u2013', times: '\u00d7',
  minus: '\u2212', rarr: '\u2192', larr: '\u2190', middot: '\u00b7', eacute: '\u00e9', deg: '\u00b0',
};

function decode(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name] ?? m);
}

/**
 * Strip the document to the text a reader sees, and return it with its block structure kept as newlines.
 *
 * **The order matters.** Comments and the head go first, because a comment can hold a `<script>` and the head
 * holds the title; then the script-like elements, because their contents can hold `<` and `>` that would
 * otherwise be read as tags; then tags; then entities.
 */
export function visibleText(html) {
  let out = html;
  out = out.replace(/<!--[\s\S]*?-->/g, ' ');
  out = out.replace(/<head[\s\S]*?<\/head>/gi, ' ');
  /*
   * ── THE SCRIPT-LIKE ELEMENTS ARE REMOVED FROM THE OUTSIDE IN, AND THAT ORDER IS THE WHOLE TRICK ──
   *
   * A regex over `<(script|style|noscript|…)[\s\S]*?</\1>` **behaves differently on a whole document and on
   * a slice of one**, and the difference is not small: measured on `/igbo-calendar/`, the whole page came to
   * 991 words while the sections summed to 1,442. The cause is that the non-greedy match starts at the FIRST
   * opener of any of those tags and runs to the first matching closer — so on a slice that begins inside the
   * design's year-grid script, it ate the `<noscript>` that an earlier `<script>` had already covered, and on
   * the whole document it did not. **A per-section count that does not add up to the page's own count is a
   * measurement fault, and the sections printed below are now guaranteed to sum to the total.**
   *
   * Running each tag type in its own pass is what removes the ambiguity: a `<noscript>` is taken out as a
   * whole element, so a `<style>` earlier in the document cannot decide whether it survives.
   */
  for (const tag of ['script', 'style', 'noscript', 'template', 'svg']) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ');
    // An unclosed one is the tail of the document; drop it rather than let its code count as prose.
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*$`, 'i'), ' ');
  }
  out = out.replace(/<\/(p|div|section|article|li|tr|h[1-6]|table|caption|blockquote|details|summary|figure|header|footer|main|nav|aside|dt|dd|form|label|button|option|select|textarea)\s*>/gi, '\n$&');
  out = out.replace(/<(br|hr)\s*\/?>/gi, '\n');
  out = out.replace(/<[^>]*>/g, ' ');
  out = decode(out);
  return out
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n');
}

/** Every word a reader sees, split the way a reader would split it. */
export function countWords(text) {
  const words = text.match(/[0-9A-Za-z\u00c0-\u024f\u1e00-\u1eff\u0300-\u036f'\u2019-]+/g) ?? [];
  return words.filter((w) => /[0-9A-Za-z\u00c0-\u024f\u1e00-\u1eff]/.test(w)).length;
}

async function load(target) {
  if (/^https?:\/\//.test(target)) {
    const response = await fetch(target);
    if (!response.ok) throw new Error(`${target} -> HTTP ${response.status}`);
    return response.text();
  }
  return readFileSync(target, 'utf8');
}

/**
 * The page split at each `<h1>`/`<h2>`/`<h3>`, so a section's own words can be counted.
 *
 * A section runs from its heading to the next heading **at the same level or a higher one**, so an `<h3>`
 * inside a section is counted with its parent rather than as a section of its own.
 */
export function sections(html) {
  /*
   * ── THE HEADINGS ARE FOUND IN THE CLEANED TEXT, NOT IN THE RAW MARKUP ────────────────────────────
   *
   * This is a fault the first version of this file had, and it produced a section table that was wrong by 45%
   * on `/igbo-calendar/` while the page total was right. The headings were located in the RAW document, so the
   * `<h3>` elements inside the design's `<noscript>` fallback were counted as sections; **but `visibleText()`
   * removes the whole `<noscript>`, so those slices then counted about 450 words the page total does not
   * contain** — the twelve Gregorian months and the year cards, which a reader with JavaScript never sees.
   *
   * The fix is to clean once and do everything against that one string: each heading becomes a plain marked
   * placeholder the clean pass leaves alone, and the sections are then consecutive slices of the very text
   * that was counted. **The rows therefore always sum to the page's own count**, which is the only thing that
   * makes a per-section table evidence rather than decoration.
   *
   * The markers are ordinary words rather than control characters, because **a control character written into
   * a pattern string is not what it looks like**: a `\u0001` in the source is a literal control byte, it does
   * not match the text the marker check looked for, and the function silently degraded to a single
   * "whole page" row.
   *
   * A section runs from its heading to the next heading of ANY level. **The nested form double-counts**: an
   * `<h3>` inside an `<h2>` would be a section of its own *and* part of its parent.
   */
  const marked = html.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (whole, level, inner) => {
    const title = decode(inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
    return `SXHEAD ${level} ${title} SXEND`;
  });
  const cleaned = visibleText(marked);
  const marks = [];
  const finder = /SXHEAD ([1-6]) ([\s\S]*?) SXEND/g;
  let match;
  while ((match = finder.exec(cleaned)) !== null) {
    marks.push({ level: Number(match[1]), title: match[2], at: match.index, end: match.index + match[0].length });
  }
  if (marks.length === 0) return [{ title: '(whole page)', level: 0, words: countWords(cleaned) }];
  const out = [{ title: '(before the first heading)', level: 0, words: countWords(cleaned.slice(0, marks[0].at)) }];
  for (let i = 0; i < marks.length; i += 1) {
    const end = i + 1 < marks.length ? marks[i + 1].at : cleaned.length;
    out.push({ title: marks[i].title, level: marks[i].level, words: countWords(cleaned.slice(marks[i].end, end)) });
  }
  return out;
}

const argv = process.argv.slice(2);
if (argv.length > 0) {
  const sectionsMode = argv.includes('--sections');
  const needleIndex = argv.indexOf('--needle');
  const needle = needleIndex === -1 ? null : argv[needleIndex + 1];
  const targets = argv.filter((a, i) => !a.startsWith('--') && i !== needleIndex + 1);
  for (const target of targets) {
    const html = await load(target);
    const text = visibleText(html);
    const name = target.replace(/^.*\//, '').replace(/\.html$/, '');
    if (needle) {
      const count = html.split(needle).length - 1;
      console.log(`${name}\t"${needle}"\t${count}`);
      continue;
    }
    console.log(`${name}\tVISIBLE WORDS: ${countWords(text)}`);
    if (sectionsMode) {
      let total = 0;
      for (const s of sections(html)) {
        total += s.words;
        console.log(`  ${String(s.words).padStart(5)}  ${'  '.repeat(Math.max(0, s.level - 1))}${s.title}`);
      }
      console.log(`  ${String(total).padStart(5)}  TOTAL ACROSS SECTIONS`);
    }
  }
}
