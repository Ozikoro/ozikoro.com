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
 * Run with: npm -w @ozikoro/platform run test:knowledge
 *
 * ⚠️ **THIS FILE IS `test-*.ts` AND NOT `*.test.ts` BECAUSE IT IS NOT DATABASE-FREE.** It was
 * `src/knowledge.test.ts`, and the `*.test.ts` glob is what the root `test:unit` script hands to
 * `node --test` — so CI ran it under a job named *"Typecheck and database-free suites"* and it failed
 * there for a reason that was nothing to do with code: **it does `await getDb()` and asserts on the
 * archive's own rows** (that there are published articles to retrieve from, and that a question nothing
 * matches returns nothing). Measured on a freshly migrated, empty cluster — which is the most a runner
 * could build — it fails with *"the archive has published articles to retrieve from"*. The data it needs
 * is the imported WordPress archive, which lives only in `.data/pg` on a developer's machine and is
 * deliberately not committed. So it moved to the suite that runs against the real archive, alongside
 * `test-archive.ts` and the rest of `test:ozikoro-data`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, closeDb } from '@ozituma/db/client';
import { archiveKnowledgeItems, articleKnowledgeId, answerabilityOf, groundedPassages } from './knowledge.ts';
import { selectKnowledge, queryTerms, trustForGrounding } from '@ozituma/core';

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

/**
 * The refusal is the point of this module, so it is tested in both directions.
 *
 * `answerabilityOf` decides whether the archive may answer at all. Round 185 measured what happens when the
 * retriever finds nothing: the trust label drops to `ai_assisted`, which is the archive saying *the model
 * would be answering from its own knowledge*. **The objective forbids exactly that**, so the decision has to
 * be a refusal rather than a prompt the model might ignore.
 */
test('refuses to answer a question the archive holds nothing for', async () => {
  const db = await getDb();
  try {
    const items = await archiveKnowledgeItems(db, 'ibo');

    // Non-words, so no passage can contain one by accident. The first version of this test used
    // 'quantum chromodynamics lattice gauge renormalisation' and FAILED — because `lattice` and `gauge`
    // are ordinary English words that do appear in an archive about craft and building. The check was
    // right and the test was wrong: **terms have to be impossible, not merely unlikely.**
    const nonsense = 'qzxwv plmbk trzzn';
    const terms = queryTerms(nonsense);

    const retrieved = selectKnowledge(items, { languageCode: 'ibo', terms, maxItems: 4 });

    // THE FINDING, asserted first so the guard below cannot hide it: retrieval returns items even when
    // nothing matches, because `scoreItem` gives every `culture` item +1 for its kind and the selector
    // takes the top N by score without a relevance floor.
    assert.ok(
      retrieved.items.length > 0,
      'selectKnowledge returns items for a question nothing matches — this is the gap answerabilityOf covers'
    );
    assert.equal(retrieved.empty, false);
    assert.equal(
      trustForGrounding(retrieved),
      'verified',
      'and the shared trust label calls it verified, because it only asks whether anything came back'
    );

    // AND THE GUARD: the archive refuses, because the passages do not contain the question's words.
    const decision = answerabilityOf(retrieved, terms);
    assert.equal(decision.canAnswer, false, 'a question nothing matches must be refused');
    if (decision.canAnswer) return;
    assert.equal(decision.trust, 'ai_assisted');
    assert.match(decision.reason, /words of this question|model/, 'the refusal says WHY');
    assert.ok(decision.reason.length > 40, 'the refusal is a sentence a reader can be shown');
  } finally {
    await closeDb();
  }
});

test('answers a question the archive does hold, and every passage is citable', async () => {
  const db = await getDb();
  try {
    const items = await archiveKnowledgeItems(db, 'ibo');
    const found = selectKnowledge(items, {
      languageCode: 'ibo',
      terms: queryTerms('What is the New Yam Festival about?'),
      maxItems: 4,
    });
    const decision = answerabilityOf(found, queryTerms('What is the New Yam Festival about?'));

    assert.equal(decision.canAnswer, true, 'the archive holds material on this');
    if (!decision.canAnswer) return;
    assert.equal(decision.trust, 'verified');
    assert.ok(decision.passages > 0 && decision.characters > 0);

    const passages = groundedPassages(found);
    assert.equal(passages.length, found.items.length);
    for (const passage of passages) {
      assert.ok(passage.source.length > 0, `${passage.id} is citable`);
      assert.match(passage.source, /^https?:\/\//);
      assert.ok(passage.text.length > 0);
    }
  } finally {
    await closeDb();
  }
});
