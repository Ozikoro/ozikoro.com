/**
 * The two claims, and the words that keep them apart.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT
 *
 * The archive now marks a thing in two different ways and the marks mean different things:
 *
 *   `ozikoro_media_rights.restricted`     "you may read this, you may not reuse it"
 *   `ozikoro_article.access_tier`         "you may not read this at all without an agreement"
 *
 * **A page that made the wrong claim would be worse than a page that made none**, because a reader acts on
 * it: an item wrongly described as unreadable is a record hidden from the people it is about, and a record
 * wrongly described as merely not-for-reuse is one a publisher will take. The two live one word apart in
 * English and in the database they share no column at all, so the separation is asserted here rather than
 * left to a reviewer to notice.
 *
 * Three things are checked, and each of them could fail silently:
 *
 *   1. **The refusal's words never contain the other claim's word.** `restricted` is the media right's word
 *      and appears nowhere on the refusal screen.
 *   2. **The refusal does not read the record it is refusing.** Its title, its byline and its body are not
 *      printed — the tier's claim is that the record cannot be read at all, and a screen that printed the
 *      title would be reading part of it. This is asserted against the REAL design screen, so the design's
 *      own example article and example byline cannot survive under a refusal.
 *   3. **The refusal hands the reader no address the archive does not already publish**, because inventing
 *      a form, a fee or a turnaround is the easy way to make a refusal look helpful.
 *
 * Run with: node --test src/institutional-access.test.ts   (or: npm -w @ozikoro/platform run test)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCESS_TIERS,
  ACCESS_TIER_CLAIM,
  ACCESS_TIER_LABEL,
  agreementRefusal,
  agreementRefusalDocument,
} from './institutional-access.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** The canonical design source, which `apps/ozikoro/public/design` is byte-compared against. */
const ARTICLE_SCREEN = join(
  HERE, '..', '..', '..',
  'design', 'calm-comfort-construct', 'public', 'design', 'screens', 'article.html'
);

const refusal = agreementRefusal({ path: '/a-record-held-by-agreement/' });
const refusalText = [
  refusal.title,
  refusal.lede,
  ...refusal.paragraphs,
  refusal.ask.heading,
  refusal.ask.body,
  ...refusal.ask.links.map((l) => l.label),
].join('\n');

// ---------------------------------------------------------------------------

test('the two marks are two different claims, and neither borrows the other word', () => {
  assert.deepEqual([...ACCESS_TIERS], ['open', 'by_agreement']);
  assert.match(ACCESS_TIER_CLAIM.open, /may be reused is a separate question/i);
  assert.match(ACCESS_TIER_CLAIM.by_agreement, /cannot be read at all/i);
  // The new tier's own claim never uses the media right's word...
  assert.ok(!/restrict/i.test(ACCESS_TIER_CLAIM.by_agreement), ACCESS_TIER_CLAIM.by_agreement);
  // ...and the media right's claim is about reuse rather than about reading being closed.
  assert.match(ACCESS_TIER_CLAIM.open, /reuse/i);
  assert.ok(!/cannot be read/i.test(ACCESS_TIER_CLAIM.open));
  // The labels a working screen shows are the two distinguishable words, not the other mark's word.
  assert.equal(ACCESS_TIER_LABEL.by_agreement, 'Held by agreement');
  assert.ok(!/restrict/i.test(ACCESS_TIER_LABEL.by_agreement));
  assert.ok(!/restrict/i.test(ACCESS_TIER_LABEL.open));
});

test('the refusal never uses the word the other claim owns', () => {
  assert.ok(!/restrict/i.test(refusalText), refusalText);
});

test('the refusal names the address asked for, and nothing else about the record', () => {
  assert.ok(refusalText.includes('/a-record-held-by-agreement/'), refusalText);
  // It says what is withheld, without reading any of it.
  assert.match(refusal.paragraphs[0] ?? '', /words, its images and its sources/);
  assert.match(refusal.paragraphs[0] ?? '', /unavailable for reuse/);
});

test('the refusal says an agreement opens it, and who makes one', () => {
  assert.match(refusal.paragraphs[1] ?? '', /institutional access agreement is what opens it/i);
  assert.match(refusal.paragraphs[1] ?? '', /proprietor/);
  // It says a withdrawal is recorded, and by ROLE rather than by address.
  assert.match(refusal.paragraphs[1] ?? '', /withdrawn/);
  assert.ok(!refusalText.includes('idenzeme'), 'the proprietor is named by role, not by address');
});

test('the refusal promises no fee, no form and no turnaround, and says so', () => {
  const said = refusal.paragraphs[2] ?? '';
  assert.match(said, /has set no fee/);
  assert.match(said, /publishes\s+no form/);
  assert.match(said, /states no time/);
  // And no invented turnaround or process anywhere in the copy, in either direction.
  assert.ok(!/\b\d+\s*(working\s+)?(day|days|week|weeks|hour|hours|month|months)\b/i.test(refusalText), refusalText);
  assert.ok(!/\bform\b/i.test(`${refusal.lede} ${refusal.paragraphs[0]} ${refusal.paragraphs[1]}`));
  assert.ok(!/(apply|application|portal|log ?in to|committee|department)/i.test(refusalText), refusalText);
});

test('every address the refusal gives is one the archive already publishes', () => {
  const allowed = new Set([
    '/terms',
    'mailto:archive@ozikoro.com',
    'mailto:hello@ozikoro.com',
  ]);
  assert.equal(refusal.ask.links.length, 3);
  for (const link of refusal.ask.links) {
    assert.ok(allowed.has(link.href), `the refusal invents an address: ${link.href}`);
  }
  // Two addresses and the page they are published on; no second door.
  assert.match(refusal.ask.body, /archive@ozikoro\.com/);
  assert.match(refusal.ask.body, /hello@ozikoro\.com/);
  assert.match(refusal.ask.body, /terms page/);
});

test('a reader who never had access is not told that access was withdrawn', () => {
  assert.equal(refusal.withdrawn, null);
  assert.ok(!/withdrawn on/i.test(refusalText), 'the word must appear only for the reader it happened to');
});

test('a reader whose own agreement was withdrawn is told, with the reason and the date', () => {
  const told = agreementRefusal({
    path: '/a-record-held-by-agreement/',
    withdrawn: { revokedAt: '2026-10-05T09:30:00.000Z', reason: 'The agreement lapsed at the end of its term.' },
  });
  assert.ok(told.withdrawn, 'the withdrawal is stated');
  const body = told.withdrawn?.body ?? '';
  assert.match(body, /withdrawn on 5 October 2026/);
  assert.match(body, /The agreement lapsed at the end of its term\./);
  assert.match(body, /proprietor/, 'the revoker is named by role');
  assert.match(body, /have not been removed from the archive/);
  // A person is named by role, and no address is written into a served page.
  assert.ok(!body.includes('@'), body);
  assert.ok(!body.includes('idenzeme'), body);
});

test('the refusal document replaces the design’s example article rather than sitting over it', () => {
  const design = readFileSync(ARTICLE_SCREEN, 'utf8');
  // What the design's own article screen says, which must be gone.
  assert.match(design, /Nwagu Aneke/, 'the fixture assumption: the design carries an example title');
  assert.match(design, /Kosisochukwu Nzeribe/, 'the fixture assumption: the design carries an example byline');
  assert.match(design, /example-flag/, 'the fixture assumption: the design carries its banner');

  const doc = agreementRefusalDocument(design, { path: '/a-record-held-by-agreement/' });

  assert.ok(!doc.includes('Nwagu Aneke'), 'the design’s example title survives the refusal');
  assert.ok(!doc.includes('Kosisochukwu Nzeribe'), 'the design’s example byline survives the refusal');
  assert.ok(!doc.includes('example-flag'), 'the design’s example banner survives the refusal');
  assert.ok(!doc.includes('Demonstration quotation'), 'the design’s example quotation survives the refusal');
  assert.ok(!doc.includes('Ute-Okpu: An Ika-Igbo Clan and Its Nri Roots'), 'the design’s example related reading survives');

  // It is a real screen: the design's frame, the archive's words, a canonical and a refusal heading.
  assert.ok(doc.includes(refusal.title), 'the refusal heading is on the screen');
  assert.ok(doc.includes('/a-record-held-by-agreement/'), 'the address asked for is on the screen');
  assert.ok(doc.includes('<header class="sx-reader-header">'), 'the design’s own frame is kept');
  assert.ok(doc.includes('rel="canonical"'), 'the screen carries a canonical');
  // The whole document, head included, is free of the other claim's word — measured on the design screen
  // first: `article.html` contains no `restrict` at all, so this cannot pass by accident.
  assert.ok(!/restrict/i.test(doc), 'the document does not carry the other word');
});

test('the refusal document says it must not be indexed, and is not a walkthrough', () => {
  const design = readFileSync(ARTICLE_SCREEN, 'utf8');
  const doc = agreementRefusalDocument(design, { path: '/a-record-held-by-agreement/' });
  assert.match(doc, /<meta name="robots" content="noindex/, 'a refusal is not a search result');
  assert.ok(!/Reading demonstration/.test(doc), 'the design’s own walkthrough sentence is gone');
});

test('a screen whose main element has moved fails loudly rather than composing over half a design', () => {
  assert.throws(
    () => agreementRefusalDocument('<!doctype html><html><body><p>no main here</p></body></html>', { path: '/x/' }),
    /no longer holds/
  );
});
