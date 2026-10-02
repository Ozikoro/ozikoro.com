/**
 * Tests for the archive's retrieval adapter (objective item 9).
 *
 * WHAT THESE LOCK DOWN, AND WHY IT IS THE LANGUAGE ARGUMENT
 *
 * Round 184's proof was a probe — run once, printed, and not left behind. These are the parts worth keeping.
 *
 * The first is the one that matters: **the adapter cannot invent a language.** `KnowledgeItem` requires
 * `languageCode`; the archive records none (round 183 measured no lang, locale or script column, and no
 * `ozikoro_*` language table). The obvious fill is `'ibo'` because the archive is Igbo heritage content, and
 * most of its articles are written in English *about* Igbo subjects — so `'ibo'` asserts the text is Igbo and
 * `'eng'` asserts the opposite. Retrieval filters on the field, so it decides what the assistant will answer
 * from. **A defaulted field is an invented one**, so the parameter is required and validated, and a test says
 * an empty value is refused rather than defaulted.
 *
 * The second is the bound. Round 185 found that whole article bodies exceeded `selectKnowledge`'s 6,000
 * character budget, so the first item broke the selection loop and one question retrieved nothing — falling
 * to `trust: "ai_assisted"`, an ungrounded answer. The excerpt length is asserted so a future edit cannot
 * quietly restore the whole body.
 *
 * Run with: npm -w @ozikoro/platform run test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, closeDb } from '@ozituma/db/client';
import { archiveKnowledgeItems, articleKnowledgeId } from './knowledge.ts';

/** The validation runs before any query, so a fake database proves the refusal without one. */
const noDatabase = null as never;

test('a stable, readable id per article', () => {
  assert.equal(articleKnowledgeId(42), 'ozikoro-article-42');
  assert.equal(articleKnowledgeId(1), 'ozikoro-article-1');
});

test('refuses an empty language code rather than defaulting one', async () => {
  await assert.rejects(
    () => archiveKnowledgeItems(noDatabase, ''),
    /ISO 639-3/,
    'an empty code must be refused, not filled in'
  );
  await assert.rejects(() => archiveKnowledgeItems(noDatabase, '   '), /ISO 639-3/);
});

test('refuses a language name, because the archive needs an ISO 639-3 code', async () => {
  // 'igbo' is four characters and not a code; 'ibo' is the code. Accepting the name would put a
  // non-code into a field the pipeline compares exactly.
  await assert.rejects(() => archiveKnowledgeItems(noDatabase, 'igbo'), /ISO 639-3/);
  await assert.rejects(() => archiveKnowledgeItems(noDatabase, 'IBO'), /ISO 639-3/);
  await assert.rejects(() => archiveKnowledgeItems(noDatabase, 'en'), /ISO 639-3/);
});

test('loads published articles, each with a source and bounded text', async () => {
  const db = await getDb();
  try {
    const items = await archiveKnowledgeItems(db, 'ibo');

    assert.ok(items.length > 0, 'the archive has published articles to retrieve from');

    for (const item of items) {
      assert.equal(item.kind, 'culture');
      assert.equal(item.status, 'published', 'only published material is retrievable');
      assert.equal(item.languageCode, 'ibo', 'the code the caller gave, not one this module chose');
      assert.ok(item.text.length > 0, `${item.id} has text`);
      // `KnowledgeItem.source` is optional, so this narrows rather than asserting on a possibly-undefined
      // value — which is also the honest reading: the ADAPTER guarantees a source by skipping items without
      // one, and the type does not. Round 186 shipped this line as `item.source.length` and typecheck
      // refused it; the fix is to narrow, not to assert non-null.
      const source = item.source ?? '';
      assert.ok(source.length > 0, `${item.id} can be cited: every item carries a source`);
      assert.match(source, /^https?:\/\//, `${item.id}'s source is an address`);
      // Round 185: the whole body broke selectKnowledge's character budget and produced an ungrounded
      // answer. Six excerpts must fit inside 6,000 characters.
      assert.ok(
        item.text.length <= 700,
        `${item.id} text is ${item.text.length} chars; it must stay a bounded excerpt`
      );
    }

    // The budget arithmetic the bound exists for: several items must be selectable at once.
    const budget = 6_000;
    const fits = Math.floor(budget / Math.max(...items.map((i) => i.text.length)));
    assert.ok(fits >= 6, `only ${fits} items fit the budget; the excerpt bound has regressed`);
  } finally {
    await closeDb();
  }
});
