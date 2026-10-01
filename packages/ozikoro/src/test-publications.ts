/**
 * The research network, tested as a workflow and as a claim that must not be overstated.
 *
 * The centre of this file is one rule: "never label a work peer-reviewed unless it completed the
 * actual peer-review workflow". Everything else here supports proving that rule holds — that the
 * states are reachable only in order, that a work cannot leave expert review without a completed
 * expert review, and that a work published by an editorial route is published and NOT peer-reviewed.
 *
 * The citation formats are tested against their rules too, because a citation is the thing a reader
 * copies and a wrong one propagates.
 *
 * Run with: npm -w @ozikoro/platform run test:publications
 */
import { getDb, closeDb } from '@ozituma/db/client';
import { registerAccount } from '@ozituma/db/accounts';
import { MemberError } from './members.ts';
import {
  CITATION_STYLES,
  PUBLICATION_STATES,
  PUBLICATION_TRANSITIONS,
  assignReview,
  canTransition,
  capabilityForTransition,
  completeReview,
  createPublication,
  formatCitation,
  getPublicationBySlug,
  listByAccount,
  listPublished,
  listResearchers,
  listReviewQueue,
  revisePublication,
  reviewStatusSentence,
  transitionPublication,
  type PublicationAuthor,
} from './publications.ts';

const db = await getDb();
let failures = 0;

const assert = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const refuses = async (label: string, run: () => Promise<unknown>, code: string) => {
  try {
    await run();
    assert(label, false, 'it was allowed');
  } catch (error) {
    const actual = error instanceof MemberError ? error.code : '';
    assert(label, actual === code, actual || String(error).slice(0, 70));
  }
};

const SUFFIX = 'zztest-ozikoro-pub';

/*
 * Purge before as well as after.
 *
 * Cleanup at the end alone is not enough: an assertion that throws exits the process before it runs,
 * and the next run then finds its own slug taken and silently writes `-2`, which makes every
 * subsequent assertion look at a different row than the one it just created. Purging first makes the
 * suite idempotent even after a crash — which is how it was found.
 */
async function purge() {
  const existing = await db.rows<{ id: string }>(`select id from ozikoro_publication where slug like 'zztest-%'`);
  for (const row of existing) {
    await db.query(`delete from ozikoro_publication_transition where publication_id = $1`, [row.id]);
    await db.query(`delete from ozikoro_publication_review where publication_id = $1`, [row.id]);
    await db.query(`delete from ozikoro_publication_version where publication_id = $1`, [row.id]);
    await db.query(`delete from ozikoro_publication_author where publication_id = $1`, [row.id]);
    await db.query(`delete from ozikoro_publication_file where publication_id = $1`, [row.id]);
    await db.query(`delete from ozikoro_publication where id = $1`, [row.id]);
  }
  await db.query(`delete from ozikoro_member where account_id in (select id from account where email like '${SUFFIX}-%')`);
  await db.query(`delete from account where email like '${SUFFIX}-%'`);
}
await purge();

const author = await registerAccount(db, { email: `${SUFFIX}-author@example.com`, password: 'a long enough password' });
const editor = await registerAccount(db, { email: `${SUFFIX}-editor@example.com`, password: 'a long enough password' });
const reviewer = await registerAccount(db, { email: `${SUFFIX}-reviewer@example.com`, password: 'a long enough password' });
const stranger = await registerAccount(db, { email: `${SUFFIX}-stranger@example.com`, password: 'a long enough password' });

// Capability sets, which the caller resolves in the application from `capabilitiesFor`.
const AUTHOR_CAPS = new Set(['read', 'submit_work', 'research_profile']);
const EDITOR_CAPS = new Set(['read', 'review_queue', 'edit_entity', 'manage_source', 'publish']);
const REVIEWER_CAPS = new Set(['read', 'expert_review']);

async function cleanup() {
  try {
    await purge();
  } catch (error) {
    console.error('cleanup failed:', String(error).slice(0, 200));
  }
  await closeDb();
}

const DRAFT = {
  title: 'zztest-Ọ̀nịchạ Market Networks and the Nineteenth-Century Trade Routes',
  abstract: 'An examination of market networks around Ọ̀nịchạ and their relation to regional trade routes.',
  kind: 'journal_article' as const,
  disciplines: ['History', 'Economic history'],
  keywords: ['Ọ̀nịchạ', 'trade routes', 'Igbo history'],
  /*
   * The first author is the signed-in account, so the work appears on their profile. The second has
   * no account here, which is the ordinary case for a co-author who never signed up — the schema
   * keeps both and the directory counts only the one that is linked.
   */
  authors: [
    { name: 'Idenze Ezeme', affiliation: 'Ozi Ikoro Limited', isCorresponding: true, accountId: author.id },
    { name: 'Chinemerem Okwuchukwu', affiliation: null },
  ],
};

// ---------------------------------------------------------------------------

console.log('\n--- the nine states ---');

assert('the workflow has the nine states the plan names', PUBLICATION_STATES.length === 9, PUBLICATION_STATES.join(', '));
assert('a draft cannot jump to published', !canTransition('draft', 'published'));
assert('a work reaches publication only through approval', canTransition('approved', 'published') && canTransition('expert_review', 'approved'));
assert('a revision goes back to the author, not forward', canTransition('revision_required', 'submitted') && !canTransition('revision_required', 'published'));
assert('archived is reachable from every live state', ['draft','submitted','under_review','expert_review','approved','published'].every((s) => canTransition(s as never, 'archived')));
assert('archived is terminal', PUBLICATION_TRANSITIONS.archived.length === 0);
assert('every state has a capability behind it', PUBLICATION_STATES.every((s) => capabilityForTransition(s).length > 0));

console.log('\n--- a work starts private and in draft ---');

const publicationId = await createPublication(db, { author: { accountId: author.id, name: 'Idenze Ezeme' }, publication: DRAFT });
const created = await getPublicationBySlug(db, 'zztest-onicha-market-networks-and-the-nineteenth-century-trade-routes');
assert('a work is created', created !== null);
assert('as a draft', created?.status === 'draft');
assert('and is not public', created?.isPublic === false);
assert('with both authors recorded in order', created?.authors.length === 2 && created?.authors[0]?.name === 'Idenze Ezeme', created?.authors.map((a) => a.name).join(' / '));
assert('and the corresponding author marked', created?.authors[0]?.isCorresponding === true);
assert('and a first version', created?.currentVersion === 1, String(created?.currentVersion));
assert('and it is not called peer-reviewed', created?.peerReviewed === false);

await refuses('a work needs a title', () => createPublication(db, { author: { accountId: author.id, name: 'x' }, publication: { ...DRAFT, title: '  ' } }), 'no_title');
await refuses('a work needs an author', () => createPublication(db, { author: { accountId: author.id, name: 'x' }, publication: { ...DRAFT, title: 'zztest-nobody', authors: [{ name: '  ' }] } }), 'no_authors');
await refuses('a malformed DOI is refused rather than stored', () => createPublication(db, { author: { accountId: author.id, name: 'x' }, publication: { ...DRAFT, title: 'zztest-baddoi', doi: 'https://example.org/paper' } }), 'bad_doi');

assert('a draft is invisible to the public', !(await listPublished(db)).some((p) => p.id === publicationId));
assert('a draft is not in the review queue', !(await listReviewQueue(db)).some((p) => p.id === publicationId));
assert('but the author can see their own', (await listByAccount(db, author.id, { includePrivate: true })).some((p) => p.id === publicationId));

console.log('\n--- the author submits, and only the author may ---');

await transitionPublication(db, { publicationId, to: 'submitted', actorId: author.id, capabilities: AUTHOR_CAPS });
assert('an author may submit their own draft', (await getPublicationBySlug(db, 'zztest-onicha-market-networks-and-the-nineteenth-century-trade-routes'))?.status === 'submitted');

await refuses('a submitted work cannot be published directly', () => transitionPublication(db, { publicationId, to: 'published', actorId: editor.id, capabilities: EDITOR_CAPS }), 'bad_transition');
await refuses('and cannot skip to approval', () => transitionPublication(db, { publicationId, to: 'approved', actorId: editor.id, capabilities: EDITOR_CAPS }), 'bad_transition');
await refuses('a work cannot be moved to the state it is already in', () => transitionPublication(db, { publicationId, to: 'submitted', actorId: editor.id, capabilities: EDITOR_CAPS }), 'same_state');
await refuses('an author without the editorial capability cannot screen their own work',
  () => transitionPublication(db, { publicationId, to: 'editorial_screening', actorId: author.id, capabilities: AUTHOR_CAPS }), 'forbidden');

console.log('\n--- screening, review, and the expert stage ---');

await transitionPublication(db, { publicationId, to: 'editorial_screening', actorId: editor.id, capabilities: EDITOR_CAPS });
await transitionPublication(db, { publicationId, to: 'under_review', actorId: editor.id, capabilities: EDITOR_CAPS });
assert('a work can be screened and put under review', (await listReviewQueue(db)).some((p) => p.id === publicationId));

await transitionPublication(db, { publicationId, to: 'expert_review', actorId: editor.id, capabilities: EDITOR_CAPS });
const reviewId = await assignReview(db, { publicationId, reviewerId: reviewer.id, kind: 'expert', actorId: editor.id });
assert('an expert review can be assigned', reviewId > 0);

await refuses('the same reviewer cannot be assigned twice while a review is open',
  () => assignReview(db, { publicationId, reviewerId: reviewer.id, kind: 'expert', actorId: editor.id }), 'already_assigned');

/*
 * THE RULE. This is the assertion the whole module exists for: a work may not leave expert review
 * before the expert review it is waiting on has actually been completed.
 */
await refuses(
  'a work cannot leave expert review with the review still outstanding',
  () => transitionPublication(db, { publicationId, to: 'approved', actorId: editor.id, capabilities: EDITOR_CAPS }),
  'no_completed_review'
);

await refuses('a review cannot be completed by somebody it was not assigned to',
  () => completeReview(db, { reviewId, reviewerId: stranger.id, recommendation: 'accept' }), 'not_your_review');

await refuses('somebody without the reviewer capability cannot complete a review',
  () => completeReview(db, { reviewId, reviewerId: reviewer.id, capabilities: AUTHOR_CAPS, recommendation: 'accept' }), 'forbidden');
await completeReview(db, { reviewId, reviewerId: reviewer.id, capabilities: REVIEWER_CAPS, recommendation: 'minor_revision', comments: 'Sound, but the chronology needs tightening.', privateComments: 'Editor: the second section is thin.' });
await refuses('a completed review cannot be completed again',
  () => completeReview(db, { reviewId, reviewerId: reviewer.id, recommendation: 'accept' }), 'already_completed');

const afterReview = await getPublicationBySlug(db, 'zztest-onicha-market-networks-and-the-nineteenth-century-trade-routes');
assert('the review is recorded with its recommendation', afterReview?.reviews.some((r) => r.recommendation === 'minor_revision' && r.completedAt !== null) === true);
assert('and the reviewer is named against it', afterReview?.reviews.some((r) => r.reviewerName?.includes('reviewer')) === true);

console.log('\n--- a peer-reviewed work ---');

await transitionPublication(db, { publicationId, to: 'approved', actorId: editor.id, capabilities: EDITOR_CAPS, note: 'Accepted after minor revision.' });
const approved = await getPublicationBySlug(db, 'zztest-onicha-market-networks-and-the-nineteenth-century-trade-routes');
assert('approval after expert review marks the work peer-reviewed', approved?.peerReviewed === true);
/*
 * The sentence is deliberately NOT the peer-reviewed one yet, because the work is approved and not
 * published. Saying "published and peer-reviewed" while it is queued would itself be an overstatement,
 * which is the thing this whole module is guarding against.
 */
assert('and the page does not claim publication before it happens', !(approved?.reviewStatus ?? '').includes('peer-reviewed'), approved?.reviewStatus?.slice(0, 60));

await transitionPublication(db, { publicationId, to: 'published', actorId: editor.id, capabilities: EDITOR_CAPS });
const published = await getPublicationBySlug(db, 'zztest-onicha-market-networks-and-the-nineteenth-century-trade-routes');
assert('publishing sets a publication date', Boolean(published?.publishedAt));
assert('and makes it public', published?.isPublic === true);
assert('and it appears in the public list', (await listPublished(db)).some((p) => p.id === publicationId));
assert('with a transition history behind it', (published?.transitions.length ?? 0) >= 7, `${published?.transitions.length} transitions`);
assert('showing every state it passed through', (published?.transitions ?? []).map((t) => t.to).join(' → ').includes('expert_review'));

console.log('\n--- a work published WITHOUT expert review is not peer-reviewed ---');

const directId = await createPublication(db, {
  author: { accountId: author.id, name: 'Idenze Ezeme' },
  publication: { ...DRAFT, title: 'zztest-A Working Paper With No Expert Review' },
});
await transitionPublication(db, { publicationId: directId, to: 'submitted', actorId: author.id, capabilities: AUTHOR_CAPS });
await transitionPublication(db, { publicationId: directId, to: 'editorial_screening', actorId: editor.id, capabilities: EDITOR_CAPS });
// Straight from screening to approval: an editorial route with no expert review at all.
await transitionPublication(db, { publicationId: directId, to: 'under_review', actorId: editor.id, capabilities: EDITOR_CAPS });
await transitionPublication(db, { publicationId: directId, to: 'approved', actorId: editor.id, capabilities: EDITOR_CAPS, note: 'Screened and accepted editorially.' });
await transitionPublication(db, { publicationId: directId, to: 'published', actorId: editor.id, capabilities: EDITOR_CAPS });

const direct = await getPublicationBySlug(db, 'zztest-a-working-paper-with-no-expert-review');
assert('it is published', direct?.status === 'published');
assert('and it is NOT labelled peer-reviewed', direct?.peerReviewed === false);
assert('and the page says plainly that it was not', (direct?.reviewStatus ?? '').includes('has not been peer-reviewed'), direct?.reviewStatus?.slice(0, 80));
assert('which is a different sentence from the reviewed one', direct?.reviewStatus !== published?.reviewStatus);

console.log('\n--- versions are kept, not overwritten ---');

const v2 = await revisePublication(db, {
  publicationId, title: 'zztest-Ọ̀nịchạ Market Networks and the Nineteenth-Century Trade Routes (revised)',
  abstract: 'Revised with the chronology corrected.', changeNote: 'Corrected the chronology after review.', actorId: author.id,
});
assert('a revision creates a new version', v2 === 2, String(v2));
const versioned = await getPublicationBySlug(db, 'zztest-onicha-market-networks-and-the-nineteenth-century-trade-routes');
assert('both versions are kept', versioned?.versions.length === 2, versioned?.versions.map((v) => v.version).join(', '));
assert('the older one is still readable, with its own title', versioned?.versions.some((v) => v.version === 1 && v.title.includes('Networks')) === true);
assert('and the change is noted against the new one', versioned?.versions.some((v) => v.version === 2 && (v.changeNote ?? '').includes('chronology')) === true);
assert('the current version pointer moved', versioned?.currentVersion === 2);

console.log('\n--- citations, in five styles, from the same facts ---');

const citationInput = {
  title: 'Ọ̀nịchạ Market Networks',
  abstract: null,
  authors: [
    { accountId: null, name: 'Idenze Ezeme', affiliation: null, department: null, orcid: null, email: null, position: 0, isCorresponding: true },
    { accountId: null, name: 'Chinemerem Okwuchukwu', affiliation: null, department: null, orcid: null, email: null, position: 1, isCorresponding: false },
  ] as PublicationAuthor[],
  kind: 'journal_article',
  publishedAt: '2026-03-15T00:00:00.000Z',
  submittedAt: null,
  journal: 'Journal of Igbo Studies',
  volume: '12',
  issue: '2',
  pages: '45-67',
  publisher: null,
  doi: '10.1234/jis.2026.045',
  externalUrl: null,
  slug: 'onicha-market-networks',
};

for (const style of CITATION_STYLES) {
  const text = formatCitation(citationInput, style.value);
  assert(`${style.label} citation is produced`, text.length > 40, text.slice(0, 58).replace(/\n/g, ' '));
  assert(`${style.label} names the work`, text.includes('Ọ̀nịchạ'));
  assert(`${style.label} carries the year`, text.includes('2026'));
}

const apa = formatCitation(citationInput, 'apa');
assert('APA inverts every author and joins with an ampersand', apa.includes('Ezeme, I.') && apa.includes('& Okwuchukwu, C.'), apa.slice(0, 70));
assert('APA gives the DOI as a link', apa.includes('https://doi.org/10.1234/jis.2026.045'));

const mla = formatCitation(citationInput, 'mla');
assert('MLA inverts only the first author', mla.includes('Ezeme, Idenze, and Chinemerem Okwuchukwu'), mla.slice(0, 80));

const bibtex = formatCitation(citationInput, 'bibtex');
assert('BibTeX is a well-formed entry', bibtex.startsWith('@article{') && bibtex.trimEnd().endsWith('}'), bibtex.split('\n')[0]);
assert('BibTeX joins authors with "and"', bibtex.includes('author = {Idenze Ezeme and Chinemerem Okwuchukwu}'));
assert('BibTeX carries the DOI bare, not as a URL', bibtex.includes('doi = {10.1234/jis.2026.045}'));

const ris = formatCitation(citationInput, 'ris');
assert('RIS uses the two-letter field tags', ris.startsWith('TY  - JOUR') && ris.trimEnd().endsWith('ER  -'));
assert('RIS gives one AU line per author', (ris.match(/^AU  - /gm) ?? []).length === 2);

/*
 * The degradation matters as much as the happy path. A work with no date and no DOI must produce a
 * citation that says so rather than inventing either.
 */
const bare = formatCitation({ ...citationInput, publishedAt: null, submittedAt: null, doi: null, journal: null, volume: null, issue: null, pages: null, authors: [] }, 'apa');
assert('an undated work cites as n.d.', bare.includes('n.d.'), bare.slice(0, 60));
assert('a work with no DOI falls back to its address, and invents nothing', !bare.includes('doi.org') && bare.includes('ozikoro.com/publications/'));
assert('and never emits the string "undefined"', !bare.includes('undefined') && !bare.includes('null'));

console.log('\n--- the researcher directory ---');

await db.query(
  `insert into ozikoro_member (account_id, display_name, headline, institution, research_interests, is_public)
   values ($1, 'Idenze Ezeme', 'Historian of Igbo markets', 'Ozi Ikoro Limited', ARRAY['Igbo history','Trade'], true)
   on conflict (account_id) do update set is_public = true, institution = excluded.institution`,
  [author.id]
);
const researchers = await listResearchers(db, { search: 'Idenze' });
assert('a member with a public profile is listed', researchers.some((r) => r.accountId === author.id));
assert('with their institution', researchers.find((r) => r.accountId === author.id)?.institution === 'Ozi Ikoro Limited');
assert('and their publication count', (researchers.find((r) => r.accountId === author.id)?.publicationCount ?? 0) >= 1);

await db.query(`update ozikoro_member set institution = null, research_interests = ARRAY[]::text[] where account_id = $1`, [author.id]);
const independent = await listResearchers(db, { search: 'Idenze' });
assert('an independent researcher with no institution is still listed', independent.some((r) => r.accountId === author.id));

console.log('\n--- authorization for a specific record ---');

/*
 * Regression tests for a real vulnerability, found and fixed in round 44.
 *
 * `revisePublication` took a publication id and an actor id and never checked they were related, and
 * the route above it authorized only on `submit_work` — which every contributor role holds. Account B
 * rewrote account A's private draft and the new version was attributed to B.
 *
 * A role check and a record check are different questions. These assertions exist so the second
 * question keeps being asked, because the first one will always pass.
 */
const draftId = await createPublication(db, {
  author: { accountId: author.id, name: 'Idenze Ezeme' },
  publication: {
    title: 'zztest-A Draft Nobody Else May Touch',
    abstract: 'Private until its author says otherwise.',
    kind: 'working_paper',
    authors: [{ name: 'Idenze Ezeme', accountId: author.id, isCorresponding: true }],
  },
});

await refuses(
  "a stranger cannot revise somebody else's publication",
  () => revisePublication(db, {
    publicationId, title: 'zztest-Rewritten By A Stranger', abstract: 'not mine',
    changeNote: 'not mine to make', actorId: stranger.id,
  }),
  'not_your_work'
);

await refuses(
  "a stranger cannot revise a private draft they were never meant to see",
  () => revisePublication(db, {
    publicationId: draftId, title: 'zztest-Hijacked Draft', abstract: 'taken',
    changeNote: 'taken', actorId: stranger.id,
  }),
  'not_your_work'
);

/*
 * The stranger is given a capability set that DOES include `submit_work`, deliberately.
 *
 * The real accounts here hold no roles, so resolving their capabilities would return a set without
 * `submit_work` — and the transition would be refused on the CAPABILITY, before the ownership check
 * was ever reached. The test would have passed for entirely the wrong reason and proved nothing about
 * the fix. Handing the stranger a capability they could plausibly hold makes the refusal attributable
 * to ownership alone, which is the thing being tested.
 */
await refuses(
  "a stranger holding submit_work still cannot submit somebody else's draft",
  () => transitionPublication(db, {
    publicationId: draftId, to: 'submitted', actorId: stranger.id,
    capabilities: AUTHOR_CAPS,
  }),
  'not_your_work'
);

const ownVersion = await revisePublication(db, {
  publicationId: draftId, title: 'zztest-A Draft, Revised By Its Author',
  abstract: 'Still mine.', changeNote: 'My own revision.', actorId: author.id,
});
assert('the author can still revise their own work', ownVersion === 2, String(ownVersion));

await transitionPublication(db, {
  publicationId: draftId, to: 'submitted', actorId: author.id,
  capabilities: AUTHOR_CAPS,
});
/*
 * Queried by id rather than by slug, because revising a work does NOT change its slug — the address a
 * citation already points at must keep resolving. Looking the work up by its new title's slug found
 * nothing, and the assertion failed for that reason rather than for anything to do with submission.
 */
const submitted = await db.one<{ status: string }>(
  `select status from ozikoro_publication where id = $1`, [draftId]
);
assert('and submit it themselves', submitted?.status === 'submitted', submitted?.status);

console.log('\n--- privacy ---');

await db.query(`update ozikoro_publication set is_public = false where id = $1`, [publicationId]);
assert('a published work can be made private', !(await listPublished(db)).some((p) => p.id === publicationId));
assert('while its author still sees it', (await listByAccount(db, author.id, { includePrivate: true })).some((p) => p.id === publicationId));
await db.query(`update ozikoro_publication set is_public = true where id = $1`, [publicationId]);

console.log(`\n${failures === 0 ? '  All checks passed.' : `  ${failures} check(s) failed.`}\n`);
await cleanup();
process.exit(failures === 0 ? 0 : 1);
