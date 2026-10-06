/**
 * THE MENTION LIST'S OWN TEST, AND THE FOUR THINGS IT MUST NOT DO.
 *
 * The owner's report was *"it told me it has no archive links to published history to izuogu, then i
 * serched and found many articles izuogu and arondizuogu were mentioned."* The repair adds a second list
 * to `/town/<slug>/` — records whose own words name the place — and every way that repair can go wrong is
 * a false claim about a record. So this file asserts, in the order the fault report names them:
 *
 *   1. a record that genuinely names the place IS listed, with the word that named it;
 *   2. a record that does not name it is NOT listed;
 *   3. a name inside a longer word is not a match — `Owa` is not `Owa-Alero`;
 *   4. the "about" sentence is left to say what it said, and a mention is never put in its place.
 *
 * Two more are here because they are the same class of fault:
 *
 *   * **markup is not text.** The place's own entity page is linked from dozens of bodies
 *     (`<a href="/entities/ndizuogu/">`), and counting that link as a mention would report the archive's
 *     own furniture as the record's words.
 *   * **`Izuogu` is refused, and the refusal is checked against the register's real aliases.** The owner
 *     searched that word and found records; this archive also holds *"Ezekiel Izuogu"*, so a bare `Izuogu`
 *     does not say which. The token list below is Ndizuogu's own, copied from
 *     `data/clans/clans.json`, so this test fails if either the aliases or the refusal change.
 *
 * WHAT THIS FILE DOES NOT COVER, STATED RATHER THAN IMPLIED. These are database-free assertions, because
 * `npm run test:unit` is what CI runs and CI has no archive in it (see `.github/workflows/ci.yml`). The
 * candidate query — the GIN index lookup and the `strpos` prefilter in `listPlaceMentions` — is exercised
 * against the real 1,052-record archive by hand, and the run is recorded in `docs/OZIKORO-REMAINING.md`.
 *
 * Run with: npm -w @ozikoro/platform run test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { evidenceNames } from './entity-graph.ts';
import {
  MENTION_LIMIT,
  classifyMention,
  mentionsCapSentence,
  mentionsHeading,
  mentionsIntroSentence,
  mentionsNamesSentence,
  noLinkedHistorySentence,
  noRecordNamesSentence,
  recordText,
} from './place-mentions.ts';

/** The register's own row for Ndizuogu, aliases and all — `data/clans/clans.json`. */
const NDIZUOGU = {
  name: 'Ndizuogu',
  aliases: ['Arondizuogu', 'Ndi Izuogu', 'Izuogu na Iheme', 'Aro-Ndizuogu', 'Izuogu'],
};

/** The tokens the archive will read for Ndizuogu: its name and the aliases that survive the rules. */
const TOKENS = evidenceNames(NDIZUOGU).counted;

test('the place’s names are read through the archive’s own rule, and Izuogu is refused with its reason', () => {
  /*
   * `Izuogu` is Ndizuogu's own last alias AND a surname in this archive. `entity-graph.ts` recorded that by
   * measuring titles, and the place page prints the same reason — so the assertion is on the reason, not
   * only on the refusal.
   */
  assert.deepEqual(TOKENS, ['Ndizuogu', 'Arondizuogu', 'Ndi Izuogu', 'Izuogu na Iheme', 'Aro-Ndizuogu']);
  assert.deepEqual(
    evidenceNames(NDIZUOGU).refused,
    [{ token: 'Izuogu', reason: 'a surname' }],
    'the bare word Izuogu is refused, with the reason the archive measured'
  );
});

test('a record that genuinely names the place is listed, with the word that named it', () => {
  const verdict = classifyMention(
    {
      title: 'The History and Origins of Arondizuogu',
      text: recordText(
        '<p>Ndizuogu did not begin as a town that grew old. The community that grew from them is ' +
          '<em>Izuogu na Iheme</em>, and the name Arondizuogu is the Aro who belong to Izuogu.</p>'
      ),
    },
    TOKENS
  );
  assert.ok(verdict, 'the record names the place and must be listed');
  assert.equal(verdict.inTitle, true, 'the alias is in the title, which is the stronger claim');
  assert.deepEqual(verdict.tokens, ['Arondizuogu', 'Ndizuogu', 'Izuogu na Iheme']);
});

test('a record that does not name the place is not listed', () => {
  const verdict = classifyMention(
    {
      title: 'The Nsukka Industrial Complex: Lejja and Opi',
      text: recordText('<p>Lejja and Opi lie in Nsukka, in Enugu State, and their iron working is old.</p>'),
    },
    TOKENS
  );
  assert.equal(verdict, null);
});

test('a name inside a longer word is not a match', () => {
  // The archive's own measured case: `Owa` is a kingdom, and `Owa-Alero` is a different community.
  assert.equal(classifyMention({ title: 'Owa-Alero', text: '' }, ['Owa']), null);
  assert.equal(classifyMention({ title: 'Owan', text: '' }, ['Owa']), null);
  // And the same fault in the shape this place can produce.
  assert.equal(classifyMention({ title: 'The Arondizuogus', text: '' }, TOKENS), null);
  assert.equal(classifyMention({ title: 'Ndundizuogu', text: '' }, TOKENS), null);
  // A possessive IS a mention: the word is the name, and the apostrophe is not a letter.
  assert.deepEqual(classifyMention({ title: 'Arondizuogu’s market', text: '' }, TOKENS)?.tokens, ['Arondizuogu']);
});

test('markup is not text: a link to the place is not a record naming it', () => {
  const body = '<p>See the <a href="/entities/ndizuogu/" title="Ndizuogu">register entry</a> for the graph.</p>';
  const verdict = classifyMention(
    { title: 'A note on the knowledge graph', text: recordText(body) },
    TOKENS
  );
  assert.equal(verdict, null, 'an href is the archive’s furniture, not the record’s words');
  // `&#038;` is a live fault elsewhere in this repository; it must never be matched as if it were text.
  assert.equal(recordText('Oko &#038; Okwe'), 'Oko & Okwe');
  assert.equal(recordText('Aro&#8217;ndizuogu'), 'Aro’ndizuogu');
  // Shortcode attributes are not words the record wrote; a caption's own words are kept.
  assert.equal(recordText('[gallery ids="1,2"]'), '');
  assert.equal(recordText('[caption id="x"]The Ndizuogu market[/caption]'), 'The Ndizuogu market');
  // A URL is an address, not a sentence.
  assert.equal(recordText('see https://example.com/arondizuogu for more'), 'see for more');
  /*
   * AND A HOST WITH NO SCHEME IS STILL AN ADDRESS. This case was found by measurement, not imagined: a
   * record whose only occurrence of `Arochukwu` was the host `www.arochukwu.info` was counted as a mention
   * of the town while the full-text index — which indexes that host as one lexeme — did not match it. The
   * index was right, and the matcher was wrong.
   */
  assert.equal(recordText('reports reproduced at www.arochukwu.info today'), 'reports reproduced at today');
});

test('a title mention and a body mention are different claims', () => {
  const title = classifyMention({ title: 'From Arondizuogu to the World', text: '' }, TOKENS);
  const body = classifyMention({ title: 'Migration and trade in the south-east', text: 'it left Arondizuogu' }, TOKENS);
  assert.equal(title?.inTitle, true);
  assert.equal(body?.inTitle, false, 'a body mention is not promoted to a title match');
  assert.deepEqual(body?.tokens, ['Arondizuogu']);
});

test('a record is listed once even when it carries two of the place’s names', () => {
  // The tokens come back in the REGISTER's order rather than the order the title happens to spell them,
  // so the same record lists its names the same way on every request.
  const verdict = classifyMention({ title: 'Aro-Ndizuogu and the Ndi Izuogu divisions', text: '' }, TOKENS);
  assert.deepEqual(verdict?.tokens, ['Ndi Izuogu', 'Aro-Ndizuogu']);
  assert.equal(verdict?.inTitle, true);
});

test('a name that is also an ordinary word is only counted where it is written as a name', () => {
  /*
   * MEASURED, NOT PREFERRED. `Item` is a town in Abia State and the ordinary English noun, and of its 23
   * word-boundary matches in the archive 18 write it in lower case — "a significant trade item", "each
   * item carries traditional symbols". Those records do not mention the town, and the archive's own rule
   * for a weak word is "a wrong one is worse than a missing one". Across all 188 places the rule costs 67
   * of 1,787 matches (3.7%); `Ihechiowa`, whose alias `Ihe` is the Igbo word for *thing*, goes 54 → 27.
   */
  assert.equal(classifyMention({ title: 'Pre-colonial trade routes', text: 'yams were a major trade item' }, ['Item']), null);
  assert.deepEqual(classifyMention({ title: 'Amaokwe Item', text: '' }, ['Item'])?.tokens, ['Item']);
  assert.deepEqual(classifyMention({ title: 'Other towns', text: 'Ohafia, Abam, Item and Nkanu' }, ['Item'])?.tokens, ['Item']);
  // An all-capitals occurrence is written as a name too.
  assert.deepEqual(classifyMention({ title: 'ITEM IN ABIA', text: '' }, ['Item'])?.tokens, ['Item']);
  /*
   * AND THE RULE APPLIES TO EVERY NAME, WHICH IS PART OF ITS COST. A record that writes `arondizuogu` in
   * lower case is not counted either — the rule is about how the record writes a name, not about which
   * names are ambiguous. It is not a rule about Ndizuogu, and pretending it were would make the matcher a
   * list of special cases.
   */
  assert.equal(classifyMention({ title: 'the arondizuogu settlement', text: 'ndizuogu' }, TOKENS), null);
  assert.deepEqual(classifyMention({ title: 'The Arondizuogu settlement', text: '' }, TOKENS)?.tokens, ['Arondizuogu']);
});

test('the words the page prints are the words this test asserts', () => {
  /*
   * The "about" sentence is NOT rewritten. It said the archive links no published history, and it still
   * says exactly that — the mention list is added beneath it, never in its place.
   */
  const about = noLinkedHistorySentence('Ndizuogu');
  assert.match(about, /^The archive links no published history to Ndizuogu yet\./);
  assert.match(about, /a link to another community is not a history of this one\.$/);

  // The mention heading claims a mention, not a history.
  assert.equal(mentionsHeading('Ndizuogu'), 'Histories that mention Ndizuogu');

  // The intro says what a mention is and is not, and says the two lists do not repeat each other.
  const intro = mentionsIntroSentence('Ndizuogu', 4);
  assert.match(intro, /whose own words name Ndizuogu/);
  assert.match(intro, /A mention is not a history of Ndizuogu/);
  assert.match(intro, /Records already listed above are not repeated\./);
  assert.doesNotMatch(mentionsIntroSentence('Ndizuogu', 0), /not repeated/, 'nothing was listed above');

  // A place nothing names says so, and does not borrow a claim.
  const none = noRecordNamesSentence('Ndizuogu');
  assert.equal(none, 'No published record in this archive names Ndizuogu in its own words.');
  assert.doesNotMatch(none, /about/);

  // The refusals reach the page, with the archive's own reason attached.
  const names = mentionsNamesSentence(evidenceNames(NDIZUOGU));
  assert.match(names, /Read as: Ndizuogu, Arondizuogu, Ndi Izuogu, Izuogu na Iheme, Aro-Ndizuogu\./);
  assert.match(names, /“Izuogu” is not counted on its own — in this archive it is a surname\./);

  // A capped list says it is capped; a complete one does not.
  assert.equal(mentionsCapSentence(4, 4), null);
  assert.match(String(mentionsCapSentence(MENTION_LIMIT, MENTION_LIMIT + 7)), /most recent of 55/);
});

test('a town with no mentions leaves the “about” sentence honest', () => {
  /*
   * The fault was NOT the about sentence. It was that the page had nothing else to say. So this test reads
   * the page itself and asserts that the two claims are still two: the empty "about" state is rendered from
   * `noLinkedHistorySentence`, and the mention list is a separate block under its own heading. A later edit
   * that replaced the about sentence with the mention list — the exact misleading the brief forbids — would
   * make this test fail.
   */
  const page = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../apps/ozikoro/app/town/[slug]/page.tsx'),
    'utf8'
  );
  assert.match(page, /noLinkedHistorySentence\(clan\.name\)/, 'the about sentence is still the empty state');
  assert.match(page, /<h2>Histories about \{clan\.name\}<\/h2>/, 'the about heading is unchanged');
  assert.match(page, /mentionsHeading\(clan\.name\)/, 'the mention list has its own heading');
  assert.match(page, /listPlaceMentions\(/, 'the mention list comes from the shared query');
  assert.match(page, /noRecordNamesSentence\(clan\.name\)/, 'a place nothing names still says so');
  // The about list is still the entity's own links, and the mention list is not merged into it.
  assert.match(page, /const histories = entity\?\.articles \?\? \[\]/);
  assert.match(page, /histories\.map\(\(a\) => a\.slug\)/, 'already-linked records are not repeated as mentions');
});
