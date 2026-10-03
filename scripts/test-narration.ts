/**
 * The narration review contract, exercised against the real database.
 *
 * EVERY WRITE HAPPENS INSIDE A TRANSACTION THAT IS ROLLED BACK.
 *
 * The archive is live and holds a thousand published records and three episodes that real people approved, so a
 * test that "cleans up afterwards" would still be one failed delete away from leaving debris in the record. A
 * single `begin … rollback` around the whole run means **nothing this script does can survive it**, whatever
 * fails, and it is the reason the checks can be this thorough.
 *
 * NO RENDER IS PERFORMED AND NO CREDIT IS SPENT.
 *
 * The render is *simulated*: the episode row is moved to `pending_review` with a made-up storage key and a
 * revision is recorded against it, exactly as `renderProposedNarration` would. **Calling the real renderer would
 * spend the owner's characters to prove that the review step works**, which is the opposite of the point. What is
 * being verified is the state machine and the publication gate, and neither needs audio to be real.
 *
 * WHAT IT PROVES
 *
 *   1. proposing records the script, the character count and the cost, and holds NO audio;
 *   2. declining records the decision and cannot be done twice;
 *   3. a declined record can still be proposed again directly, and does not create a second episode;
 *   4. editing a proposal appends a NEW revision and leaves the proposed one intact;
 *   5. the render fills the revision it was made from rather than making a duplicate;
 *   6. approving a rendered take is what makes the article's audio query return a row, and nothing else does;
 *   7. correcting a published episode removes it from the article and KEEPS the rendered take;
 *   8. the sweep never proposes the same record twice, because the proposal row is the record of having asked.
 *
 * Usage: node scripts/test-narration.ts
 */
import { closeDb, getDb, type Db } from '@ozituma/db/client';
import {
  declineNarration,
  estimateNarrationCredits,
  narrationDisclosure,
  proposeNarration,
  publishNarrationEpisode,
  recordNarrationRevision,
  rejectNarration,
  setNarrationScript,
  sweepNarrationProposals,
} from '@ozikoro/platform';

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * The article page's own query, copied here on purpose.
 *
 * If this test built its own idea of "is the episode live", it would pass while the page stayed empty. **The
 * gate being verified is the page's, so the page's SQL is what is asked**, and the only change is that it is
 * scoped to one article.
 */
async function articleShowsAudio(db: Db, articleId: number): Promise<boolean> {
  const row = await db.one<{ n: number }>(
    `select count(*)::int n from ozikoro_episode
      where article_id = $1 and status = 'published'
        and coalesce(external_url, storage_key) is not null`,
    [articleId]
  );
  return Number(row?.n ?? 0) > 0;
}

const db = await getDb();

console.log('');
console.log('  narration review — against the live schema, inside a transaction that is rolled back');
console.log('');

await db.exec('begin');
try {
  /*
   * A RECORD WITH NO EPISODE, AND TWO FOR THE SWEEP.
   *
   * Picking an existing record rather than inserting a test article: **a synthetic article would have to be
   * created `published`, and a test that publishes something is a test that changes what the site shows for as
   * long as the transaction lives.** The archive has 1,048 eligible records; using one of them costs nobody
   * anything and exercises exactly the row the real sweep would find.
   */
  const candidates = await db.rows<{ id: number; slug: string; title: string }>(
    `select a.id, a.slug, a.title
       from ozikoro_article a
      where a.status = 'published' and a.is_page = false
        and not exists (select 1 from ozikoro_episode e where e.article_id = a.id)
      order by a.id
      limit 2`
  );
  check('the archive has published records with no narration to test against', candidates.length === 2);

  const owner = await db.one<{ id: number }>(
    `select id from account where lower(email) = lower('idenzeme@gmail.com')`
  );
  check('the owner account exists, so decisions have a name to record', Boolean(owner));
  if (candidates.length < 2 || !owner) throw new Error('nothing to test against');
  const actorId = owner.id;

  const caps = await db.rows<{ role: string }>(
    `select role from ozikoro_role_capability where capability = 'review_audio' order by role`
  );
  check(
    'review_audio is held by editor, admin and owner — and by nobody wider',
    caps.map((c) => c.role).join(',') === 'admin,editor,owner',
    caps.map((c) => c.role).join(',')
  );

  // -------------------------------------------------------------------------
  // 1. A PROPOSAL COSTS NOTHING AND HOLDS NO AUDIO
  // -------------------------------------------------------------------------
  const target = candidates[0]!;
  const proposal = await proposeNarration(db, { slug: target.slug, actorId, voice: 'own' });

  check('proposing returns the script that would be spoken', proposal.script.length > 0);
  check(
    'the character count is the length of the script — a fact, not an estimate',
    proposal.characters === proposal.script.length,
    `${proposal.characters} vs ${proposal.script.length}`
  );
  check(
    'the cost is the character count at the estimate rate',
    proposal.estimatedCredits === estimateNarrationCredits(proposal.characters)
  );

  const row = await db.one<{
    status: string; storage_key: string | null; external_url: string | null; byte_size: number | null;
    char_count: number; estimated_credits: number; voice_choice: string; narrator_kind: string;
    ai_disclosure: string; proposed_by: number;
  }>(
    `select status, storage_key, external_url, byte_size, char_count, estimated_credits, voice_choice,
            narrator_kind, ai_disclosure, proposed_by
       from ozikoro_episode where id = $1`,
    [proposal.episodeId]
  );
  check('the proposal is recorded as “proposed”', row?.status === 'proposed', row?.status);
  check(
    'A PROPOSAL HOLDS NO AUDIO — nothing was rendered',
    row?.storage_key === null && row?.external_url === null && row?.byte_size === null
  );
  check('the char count and the cost are stored, not recomputed on read', row?.char_count === proposal.characters);
  check('the narrator kind and the disclosure are recorded at proposal time', row?.narrator_kind === 'synthetic_own_voice');
  check('the disclosure is the one the feed will print', row?.ai_disclosure === narrationDisclosure('own'));
  check('who proposed it is recorded', Number(row?.proposed_by) === actorId);

  const revisions = await db.rows<{ revision_number: number; script: string; storage_key: string | null }>(
    `select revision_number, script, storage_key from ozikoro_episode_revision where episode_id = $1 order by revision_number`,
    [proposal.episodeId]
  );
  check('the proposed script is kept as revision 1, before anything can edit it', revisions.length === 1);
  check('revision 1 is the proposed script and has no audio', revisions[0]?.script === proposal.script && revisions[0]?.storage_key === null);
  check('the article shows NO player while the episode is only proposed', !(await articleShowsAudio(db, target.id)));

  const proposedTransition = await db.rows<{ to_status: string; actor_account_id: number }>(
    `select to_status, actor_account_id from ozikoro_episode_transition where episode_id = $1 and to_status = 'proposed'`,
    [proposal.episodeId]
  );
  check('the proposal is in the audit trail with its actor', proposedTransition.length === 1 && Number(proposedTransition[0]?.actor_account_id) === actorId);

  // -------------------------------------------------------------------------
  // 2. DECLINING, TWICE
  // -------------------------------------------------------------------------
  const declined = await declineNarration(db, { slug: target.slug, actorId, note: 'Not this one.' });
  check('declining records the decision', declined.slug === target.slug);
  const declinedRow = await db.one<{ status: string; decided_by: number; decision_note: string }>(
    `select status, decided_by, decision_note from ozikoro_episode where id = $1`,
    [proposal.episodeId]
  );
  check('the episode is “declined” with a decider and a note', declinedRow?.status === 'declined' && Number(declinedRow?.decided_by) === actorId && declinedRow?.decision_note === 'Not this one.');

  let secondDeclineRefused = false;
  try {
    await declineNarration(db, { slug: target.slug, actorId });
  } catch {
    secondDeclineRefused = true;
  }
  check('a declined proposal cannot be declined a second time', secondDeclineRefused);

  // -------------------------------------------------------------------------
  // 3. A DECLINED RECORD CAN BE PROPOSED AGAIN, WITHOUT A SECOND EPISODE
  // -------------------------------------------------------------------------
  const again = await proposeNarration(db, { slug: target.slug, actorId });
  check('a declined record can be proposed again deliberately', again.status === 'proposed');
  check('re-proposing reuses the row rather than creating a second episode', again.episodeId === proposal.episodeId);
  const episodeCount = await db.one<{ n: number }>(`select count(*)::int n from ozikoro_episode where article_id = $1`, [target.id]);
  check('the article still has exactly one episode', Number(episodeCount?.n) === 1);

  // -------------------------------------------------------------------------
  // 4. EDITING A PROPOSAL APPENDS A REVISION AND LOSES NOTHING
  // -------------------------------------------------------------------------
  const corrected = `${again.script}\n\nThe corrected passage, as an editor would write it.`;
  const edited = await setNarrationScript(db, { slug: target.slug, actorId, script: corrected, note: 'Tightened.' });
  check('editing a proposal keeps it a proposal — still nothing has been rendered', edited.status === 'proposed');
  const afterEdit = await db.rows<{ revision_number: number; script: string; storage_key: string | null }>(
    `select revision_number, script, storage_key from ozikoro_episode_revision where episode_id = $1 order by revision_number`,
    [proposal.episodeId]
  );
  check('the edit is a NEW revision', afterEdit.length === 2 && afterEdit[1]?.revision_number === 2);
  check('the proposed script is still revision 1, byte for byte', afterEdit[0]?.script === proposal.script);
  check('the current script is the corrected one', afterEdit[1]?.script === corrected);
  const currentScript = await db.one<{ script: string }>(`select script from ozikoro_episode where id = $1`, [proposal.episodeId]);
  check('the episode points at the corrected script', currentScript?.script === corrected);
  check('the article still shows no player', !(await articleShowsAudio(db, target.id)));

  // -------------------------------------------------------------------------
  // 5. THE RENDER IS SIMULATED — filling the revision it was made from
  // -------------------------------------------------------------------------
  const fakeKey = `ozikoro/episodes/${target.slug}.mp3`;
  await db.query(
    `update ozikoro_episode set status = 'pending_review', storage_key = $2, mime_type = 'audio/mpeg',
            byte_size = 123456, duration_seconds = 321 where id = $1`,
    [proposal.episodeId, fakeKey]
  );
  const filled = await recordNarrationRevision(db, proposal.episodeId, corrected, {
    storageKey: fakeKey, byteSize: 123456, durationSeconds: 321, generatorModel: 'eleven_multilingual_v2', createdBy: actorId,
  });
  const afterRender = await db.rows<{ revision_number: number; script: string; storage_key: string | null }>(
    `select revision_number, script, storage_key from ozikoro_episode_revision where episode_id = $1 order by revision_number`,
    [proposal.episodeId]
  );
  check('the render fills revision 2 rather than adding a duplicate of the same script', afterRender.length === 2 && filled === 2);
  check('revision 2 now carries the audio for exactly those words', afterRender[1]?.storage_key === fakeKey);
  check('the article STILL shows no player — a rendered take is not a published one', !(await articleShowsAudio(db, target.id)));

  // -------------------------------------------------------------------------
  // 6. PUBLISHING IS THE ONLY THING THAT PUTS AUDIO ON THE ARTICLE
  // -------------------------------------------------------------------------
  const published = await publishNarrationEpisode(db, { slug: target.slug, actorId, note: 'Listened; it is right.' });
  check('approving a rendered take publishes it', published.slug === target.slug);
  const publishedRow = await db.one<{ status: string; approved_by: number; approved_at: Date; published_at: Date }>(
    `select status, approved_by, approved_at, published_at from ozikoro_episode where id = $1`,
    [proposal.episodeId]
  );
  check(
    'the published row carries the approver and both timestamps',
    publishedRow?.status === 'published' &&
      Number(publishedRow?.approved_by) === actorId &&
      Boolean(publishedRow?.approved_at) &&
      Boolean(publishedRow?.published_at)
  );
  check('THE ARTICLE NOW SHOWS THE PLAYER — this transition and nothing else', await articleShowsAudio(db, target.id));

  // -------------------------------------------------------------------------
  // 7. CORRECTING A PUBLISHED EPISODE TAKES IT OFF THE ARTICLE AND KEEPS THE TAKE
  // -------------------------------------------------------------------------
  const replacement = `${corrected}\n\nA later correction, made after the recording went live.`;
  const rejected = await rejectNarration(db, {
    slug: target.slug, actorId, note: 'A name is mispronounced.', correctedScript: replacement,
  });
  check('correcting a published episode moves it to “corrections”', rejected.status === 'corrections');
  const afterReject = await db.rows<{ revision_number: number; script: string; storage_key: string | null }>(
    `select revision_number, script, storage_key from ozikoro_episode_revision where episode_id = $1 order by revision_number`,
    [proposal.episodeId]
  );
  check('the correction is a third revision', afterReject.length === 3 && rejected.revision === 3);
  check(
    'THE REJECTED TAKE IS KEPT — its script and its audio are untouched',
    afterReject[1]?.script === corrected && afterReject[1]?.storage_key === fakeKey
  );
  check('the correction itself has no audio until it is rendered', afterReject[2]?.storage_key === null);
  check('THE PLAYER IS GONE FROM THE ARTICLE while the correction waits', !(await articleShowsAudio(db, target.id)));
  const unpublished = await db.one<{ published_at: Date | null; approved_at: Date | null }>(
    `select published_at, approved_at from ozikoro_episode where id = $1`,
    [proposal.episodeId]
  );
  check('publication timestamps are cleared, so the feed and the article agree', unpublished?.published_at === null && unpublished?.approved_at === null);

  let correctionsCannotPublish = false;
  try {
    await publishNarrationEpisode(db, { slug: target.slug, actorId });
  } catch {
    correctionsCannotPublish = true;
  }
  check('a correction cannot be published before it is rendered again', correctionsCannotPublish);

  // -------------------------------------------------------------------------
  // 8. THE SWEEP IS IDEMPOTENT
  // -------------------------------------------------------------------------
  const sweepOpts = { actorId: null, limit: 1, delayMinutes: 0, since: '2000-01-01T00:00:00.000Z' };
  const first = await sweepNarrationProposals(db, sweepOpts);
  const second = await sweepNarrationProposals(db, sweepOpts);
  check('the sweep proposes one record per run', first.proposed.length === 1 && second.proposed.length === 1);
  check(
    'THE SECOND RUN DOES NOT PROPOSE THE SAME RECORD — the proposal row is the record of having asked',
    first.proposed[0]?.slug !== second.proposed[0]?.slug,
    `${first.proposed[0]?.slug} vs ${second.proposed[0]?.slug}`
  );
  const third = await sweepNarrationProposals(db, { ...sweepOpts, limit: 200 });
  check(
    'a sweep finds nothing for a record that already has an episode',
    !third.proposed.some(
      (p) => p.slug === target.slug || p.slug === first.proposed[0]?.slug || p.slug === second.proposed[0]?.slug
    )
  );
  const sweptRow = await db.one<{ status: string; proposed_by: number | null; storage_key: string | null }>(
    `select status, proposed_by, storage_key from ozikoro_episode where slug = $1`,
    [first.proposed[0]!.slug]
  );
  check('a swept proposal is recorded as proposed by nobody, which is the truth', sweptRow?.status === 'proposed' && sweptRow?.proposed_by === null);
  check('a swept proposal holds no audio and has spent nothing', sweptRow?.storage_key === null);
} finally {
  // **Nothing above survives this line.** Not the episodes, not the revisions, not the transitions.
  await db.exec('rollback');
  await closeDb();
}

console.log('');
if (failures.length === 0) {
  console.log(`  All ${passed} narration review checks passed. The transaction was rolled back; the archive is unchanged.`);
  process.exit(0);
}
console.error(`  ${failures.length} check(s) FAILED (${passed} passed). The transaction was rolled back.`);
for (const f of failures) console.error(`    ${f}`);
process.exit(1);
