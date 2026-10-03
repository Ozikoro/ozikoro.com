/**
 * THE QUEUE OF WORDS THE ARCHIVE CANNOT SAY — and the digest that asks a person to say them.
 *
 * THE OWNER'S INSTRUCTION
 *
 *   "if it can't, then it can go ahead to inform the admin, and editors, to upload or record the words
 *    listed in the article in the website, which now pushes it to elevenlabs, and approved before it
 *    produces any record, as to not waste credits."
 *
 * ---------------------------------------------------------------------------
 * WHY THE ARTICLE LIST IS THE POINT, AND NOT THE COUNT
 * ---------------------------------------------------------------------------
 *
 * The owner asked for "the word, how often it occurs, and which articles it appears in (so an editor can see
 * whether it is worth recording)" — and gave the reason: *"a word appearing in forty articles is worth
 * recording, one appearing in a single draft may not."*
 *
 * So the count is DERIVED from the occurrence rows and never stored beside them. A `times_seen` column would
 * be a second copy of a fact the child table already holds, and the archive's own record (0035 on the audit
 * table, 0046 on the narration proposal) is that two copies of one fact drift. `listQueue` groups instead.
 *
 * ---------------------------------------------------------------------------
 * WHY A DISSECTED WORD IS IN THE QUEUE BUT DOES NOT BLOCK A RENDER
 * ---------------------------------------------------------------------------
 *
 * The instruction says the queue is for words that are *"neither found nor dissectable"*. This module keeps
 * dissected words in the same table — because they are exactly the words an editor should see and improve,
 * and because one table with a state is how migration 0046 argues a proposal and an episode should be one
 * object — but it separates them in what MATTERS:
 *
 *   - `blocks` is true for a word that is neither approved nor composed. **That is the render gate.**
 *   - a `composed` word is sayable and does not block. It is offered to an editor, not demanded of them.
 *   - **the digest lists only the blocking words**, ordered by how many articles need them. Asking a person
 *     to record two hundred words that can already be approximated from parts would bury the twelve that
 *     matter, which is the failure mode the owner's own "worth recording" test is aimed at.
 *
 * ---------------------------------------------------------------------------
 * EVERY STATE CHANGE IS AUDITED, AND THE ACTOR IS A PARAMETER
 * ---------------------------------------------------------------------------
 *
 * `ozikoro_audit` gets a row per change with the actor id, following `apps/ozikoro/app/admin/users/`
 * exactly. **The actor is never read from a form field**, because the one thing an audit exists to prevent
 * is a change attributed to somebody who did not make it — the note that page carries, applied here.
 */
import type { Db } from '@ozituma/db/client';
import { toSearchForm } from '@ozituma/core';
import { sendMail, siteAddress, type SendResult } from '@ozituma/core';
import { MemberError } from './members.ts';
import { mayApprovePronunciation } from './roles.ts';
import {
  buildDictionaryIndex,
  lookupPronunciation,
  planArticlePronunciation,
  type ArticlePronunciationPlan,
  type DictionaryIndex,
} from './pronunciation.ts';

/** The four states the owner named, and nothing else. */
export type PronunciationStatus = 'unrecorded' | 'recorded' | 'approved' | 'rejected';
export type PronunciationKind = 'human_recording' | 'respelling' | 'composed' | 'dictionary_audio';

export type QueueRow = {
  id: number;
  word: string;
  folded: string;
  kind: PronunciationKind;
  status: PronunciationStatus;
  /** How many times the word occurs across the whole archive. Derived from the occurrence rows. */
  times: number;
  /** How many distinct articles need it. **This is the owner's "worth recording" figure.** */
  articles: number;
  /** The articles, most recent first, with the count of the word in each. */
  where: { articleId: number; slug: string | null; title: string | null; times: number; surface: string | null }[];
  noticedBy: number | null;
  noticedAt: string;
  decidedBy: number | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** A recording or respelling held by the archive, when there is one. */
  audioUrl: string | null;
  respelling: string | null;
  composedOf: string[] | null;
  recordedBy: number | null;
  /** True when this word stops a narration render. The owner's credit-control rule, as a boolean. */
  blocks: boolean;
};

/**
 * The queue, with the article list that makes it actionable.
 *
 * `blocks` is computed in SQL by the same function migration 0050 defines, so the page, the digest and the
 * render gate cannot disagree about which words stop a render.
 */
export async function listQueue(
  db: Db,
  options: { status?: PronunciationStatus | 'open'; limit?: number; blockingOnly?: boolean } = {}
): Promise<QueueRow[]> {
  const params: unknown[] = [];
  const filters: string[] = [];
  const status = options.status ?? 'open';
  if (status === 'open') {
    filters.push(`p.status in ('unrecorded', 'recorded')`);
  } else {
    params.push(status);
    filters.push(`p.status = $${params.length}`);
  }
  if (options.blockingOnly) filters.push(`ozikoro_pronunciation_blocks(p.status, p.kind)`);
  const where = filters.length > 0 ? `where ${filters.join(' and ')}` : '';
  params.push(Math.min(Math.max(options.limit ?? 200, 1), 500));

  const rows = await db.rows<Record<string, unknown>>(
    `select p.id, p.word, p.search_form, p.kind, p.status,
            p.noticed_by, p.noticed_at, p.decided_by, p.decided_at, p.decision_note,
            p.storage_key, p.external_url, p.respelling, p.composed_of, p.recorded_by,
            ozikoro_pronunciation_blocks(p.status, p.kind) as blocks,
            coalesce(o.times, 0)::int as times,
            coalesce(o.articles, 0)::int as articles,
            coalesce(o.detail, '[]'::json) as detail
       from ozikoro_pronunciation p
       left join lateral (
         select sum(occ.times) as times, count(*) as articles,
                json_agg(json_build_object(
                  'articleId', occ.article_id,
                  'slug', a.slug,
                  'title', a.title,
                  'times', occ.times,
                  'surface', occ.surface
                ) order by occ.times desc, occ.article_id) as detail
           from ozikoro_pronunciation_occurrence occ
           left join ozikoro_article a on a.id = occ.article_id
          where occ.pronunciation_id = p.id
       ) o on true
       ${where}
      order by coalesce(o.articles, 0) desc, coalesce(o.times, 0) desc, p.word
      limit $${params.length}`,
    params
  );

  return rows.map((row) => ({
    id: Number(row.id),
    word: String(row.word),
    folded: String(row.search_form),
    kind: row.kind as PronunciationKind,
    status: row.status as PronunciationStatus,
    times: Number(row.times ?? 0),
    articles: Number(row.articles ?? 0),
    where: (row.detail as QueueRow['where'] | null) ?? [],
    noticedBy: row.noticed_by === null ? null : Number(row.noticed_by),
    noticedAt: String(row.noticed_at),
    decidedBy: row.decided_by === null ? null : Number(row.decided_by),
    decidedAt: row.decided_at === null ? null : String(row.decided_at),
    decisionNote: row.decision_note === null ? null : String(row.decision_note),
    audioUrl: (row.external_url as string | null) ?? (row.storage_key as string | null),
    respelling: row.respelling === null ? null : String(row.respelling),
    composedOf: Array.isArray(row.composed_of) ? (row.composed_of as string[]) : null,
    recordedBy: row.recorded_by === null ? null : Number(row.recorded_by),
    blocks: Boolean(row.blocks),
  }));
}

/** The counts a page states rather than implies. */
export async function queueCounts(
  db: Db
): Promise<{ open: number; blocking: number; recorded: number; approved: number; rejected: number }> {
  const row = await db.one<Record<string, unknown>>(
    `select
       count(*) filter (where status in ('unrecorded','recorded'))::int as open,
       count(*) filter (where ozikoro_pronunciation_blocks(status, kind))::int as blocking,
       count(*) filter (where status = 'recorded')::int as recorded,
       count(*) filter (where status = 'approved')::int as approved,
       count(*) filter (where status = 'rejected')::int as rejected
     from ozikoro_pronunciation`
  );
  return {
    open: Number(row?.open ?? 0),
    blocking: Number(row?.blocking ?? 0),
    recorded: Number(row?.recorded ?? 0),
    approved: Number(row?.approved ?? 0),
    rejected: Number(row?.rejected ?? 0),
  };
}

/** One audit row per change, with the actor. Best-effort, as the archive's other audit writes are. */
async function audit(
  db: Db,
  event: {
    id: number; action: string; actorId: number | null;
    before?: unknown; after?: unknown; note?: string | null;
  }
): Promise<void> {
  try {
    await db.query(
      `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
       values ('ozikoro_pronunciation', $1, $2, $3::jsonb, $4::jsonb, $5, $6)`,
      [
        event.id, event.action,
        event.before === undefined ? null : JSON.stringify(event.before),
        event.after === undefined ? null : JSON.stringify(event.after),
        event.actorId, event.note ?? null,
      ]
    );
  } catch (error) {
    // **Recording history must never be the reason an action fails** — the note `apps/ozikoro/app/admin/users`
    // carries, and the reason here is the same: the change has already been made, and a throw would invite a
    // second attempt at something that already happened.
    console.error('[ozikoro/pronunciation] could not record audit event:', String(error).slice(0, 160));
  }
}

/**
 * Put an article's unpronounceable words in the queue.
 *
 * Idempotent by the folded key: a second run adds the articles that are new and never duplicates a word.
 * That matters because this is called for every article the archive narrates, and a queue that grows a
 * second row for a word every time it is seen would look like a queue that is never cleared.
 *
 * **A word the dictionary CAN say is never written here.** It needs no recording, and a row for it would
 * make the queue's own count a lie about what is missing.
 */
export async function recordArticleQueue(
  db: Db,
  input: { slug: string; actorId: number | null; index?: DictionaryIndex }
): Promise<{ plan: ArticlePronunciationPlan; added: number; occurrences: number }> {
  const index = input.index ?? (await buildDictionaryIndex(db));
  const plan = await planArticlePronunciation(db, { slug: input.slug, index });

  let added = 0;
  let occurrences = 0;

  for (const item of plan.missing) {
    const inserted = await db.one<{ id: number; inserted: boolean }>(
      `insert into ozikoro_pronunciation
         (word, search_form, language_code, kind, status, noticed_by, noticed_at)
       values ($1, $2, 'ibo', 'human_recording', 'unrecorded', $3, now())
       on conflict (language_code, search_form) do update
         set updated_at = now()
       returning id, (xmax = 0) as inserted`,
      [item.word, item.folded, input.actorId]
    );
    if (!inserted) continue;
    if (inserted.inserted) added += 1;

    const occ = await db.query(
      `insert into ozikoro_pronunciation_occurrence (pronunciation_id, article_id, times, surface)
       values ($1, $2, $3, $4)
       on conflict (pronunciation_id, article_id) do update
         set times = excluded.times, surface = excluded.surface
       returning id`,
      [inserted.id, plan.articleId, item.occurrences, item.word]
    );
    occurrences += occ.rowCount;
  }

  /*
   * THE COMPOSED WORDS GO IN TOO, AND AT A KIND THAT DOES NOT BLOCK.
   *
   * They are the words dissection rescued — the owner's own idea, and its whole output. An editor should be
   * able to see them and replace a guess with a recording, and a page that showed only the hard misses would
   * hide the more interesting half of the work. `kind = 'composed'` is what keeps them out of the digest and
   * out of the render gate.
   */
  for (const item of plan.composed) {
    const existing = await db.one<{ id: number; status: string }>(
      `select id, status from ozikoro_pronunciation where language_code = 'ibo' and search_form = $1`,
      [item.folded]
    );
    // Never overwrite a real recording or a decision with a guess: `composed` is the weakest evidence there
    // is, and a re-scan of an article must not be able to downgrade an approved recording.
    if (existing) continue;

    const inserted = await db.one<{ id: number }>(
      `insert into ozikoro_pronunciation
         (word, search_form, language_code, kind, status, composed_of, noticed_by, noticed_at)
       values ($1, $2, 'ibo', 'composed', 'unrecorded', $3::jsonb, $4, now())
       on conflict (language_code, search_form) do nothing
       returning id`,
      [item.word, item.folded, JSON.stringify(item.pieces), input.actorId]
    );
    if (!inserted) continue;
    added += 1;

    const occ = await db.query(
      `insert into ozikoro_pronunciation_occurrence (pronunciation_id, article_id, times, surface)
       values ($1, $2, $3, $4)
       on conflict (pronunciation_id, article_id) do update
         set times = excluded.times, surface = excluded.surface
       returning id`,
      [inserted.id, plan.articleId, 1, item.word]
    );
    occurrences += occ.rowCount;
  }

  return { plan, added, occurrences };
}

/**
 * Attach a recording or a respelling to a word — the editor's act the owner asked for.
 *
 * **It moves the word to `recorded` and stops there.** The next state is `approved`, and the owner's rule is
 * that nothing is used before it: *"approved before it produces any record, as to not waste credits."* A
 * upload that approved itself would make the gate decorative, so this function cannot reach `approved` even
 * if a caller asks it to.
 */
export async function recordPronunciation(
  db: Db,
  input: {
    /** The word, or the row id when the caller already has it. */
    word?: string;
    id?: number;
    actorId: number;
    /** The stored object key, for an uploaded recording. */
    storageKey?: string | null;
    externalUrl?: string | null;
    mimeType?: string | null;
    byteSize?: number | null;
    durationMs?: number | null;
    /** IPA or a practical respelling, written by the person recording it. */
    respelling?: string | null;
    /** Who is speaking, when it is not the uploader. A recording with no nameable speaker is a rights problem. */
    speakerName?: string | null;
    sourceNote?: string | null;
    note?: string | null;
  }
): Promise<{ id: number; word: string; status: PronunciationStatus }> {
  const row = await findRow(db, input);
  if (!row) throw new MemberError('no_word', 'That word is not in the pronunciation queue.');
  if (!input.storageKey && !input.externalUrl && !input.respelling?.trim()) {
    throw new MemberError(
      'nothing_to_use',
      'A recording needs audio or a written respelling. A spelling on its own is not something the archive can say.'
    );
  }

  const status: PronunciationStatus = 'recorded';
  const kind: PronunciationKind =
    input.storageKey || input.externalUrl ? 'human_recording' : 'respelling';

  await db.query(
    `update ozikoro_pronunciation
        set kind = $2, status = $3,
            storage_key = coalesce($4, storage_key), external_url = coalesce($5, external_url),
            mime_type = coalesce($6, mime_type), byte_size = coalesce($7, byte_size),
            duration_ms = coalesce($8, duration_ms),
            respelling = coalesce($9, respelling),
            speaker_name = coalesce($10, speaker_name), source_note = coalesce($11, source_note),
            recorded_by = $12, recorded_at = now(),
            -- A new recording clears a previous decision: the thing that was decided about has changed.
            decided_by = null, decided_at = null, decision_note = null,
            updated_at = now()
      where id = $1`,
    [
      row.id, kind, status, input.storageKey ?? null, input.externalUrl ?? null,
      input.mimeType ?? null, input.byteSize ?? null, input.durationMs ?? null,
      input.respelling?.trim() || null, input.speakerName?.trim() || null,
      input.sourceNote?.trim() || null, input.actorId,
    ]
  );

  await audit(db, {
    id: row.id, action: 'record_pronunciation', actorId: input.actorId,
    before: { status: row.status, kind: row.kind },
    after: { status, kind, hasAudio: Boolean(input.storageKey || input.externalUrl), respelling: Boolean(input.respelling?.trim()) },
    note: input.note?.trim() || `Recorded “${row.word}”. It is not used until it is approved.`,
  });

  return { id: row.id, word: row.word, status };
}

/**
 * Approve a pronunciation — **the act that unblocks a render, and the only one that does.**
 *
 * The rank rule is asked, not assumed: `mayApprovePronunciation` calls the database's own ladder, and an
 * approval of one's own recording is permitted but LABELLED, so the audit row says which it was.
 */
export async function approvePronunciation(
  db: Db,
  input: { word?: string; id?: number; actorId: number; note?: string | null }
): Promise<{ id: number; word: string; ownRecording: boolean }> {
  const row = await findRow(db, input);
  if (!row) throw new MemberError('no_word', 'That word is not in the pronunciation queue.');
  if (row.status === 'approved') {
    throw new MemberError('already_approved', `“${row.word}” is already approved. Nothing was changed.`);
  }
  if (!row.hasAudio && !row.respelling) {
    /*
     * THE GATE, STATED PLAINLY. The owner's rule is that approval is what stops credits being wasted, which
     * only means something if approval is about a thing that exists. **An approval of a word with no
     * recording and no respelling would tell the renderer a word is pronounceable when nothing says how** —
     * so it is refused rather than written, and the refusal names the two ways to fix it.
     */
    throw new MemberError(
      'nothing_to_approve',
      `“${row.word}” has no recording and no respelling. Upload a recording or write a respelling first — ` +
        'approving it now would tell the narration a word can be said when nothing says how.'
    );
  }

  const verdict = await mayApprovePronunciation(db, input.actorId, row.recordedBy);
  if (!verdict.allowed) throw new MemberError('rank', verdict.reason ?? 'That approval is above your standing.');

  await db.query(
    `update ozikoro_pronunciation
        set status = 'approved', decided_by = $2, decided_at = now(), decision_note = $3, updated_at = now()
      where id = $1`,
    [row.id, input.actorId, input.note?.trim() || null]
  );

  await audit(db, {
    id: row.id, action: 'approve_pronunciation', actorId: input.actorId,
    before: { status: row.status },
    after: { status: 'approved', ownRecording: verdict.ownRecording, actorRank: verdict.actorRank, recorderRank: verdict.recorderRank },
    note:
      input.note?.trim() ||
      (verdict.ownRecording
        ? `Approved “${row.word}”, recorded by the same account that approved it. Narration may use it.`
        : `Approved “${row.word}”. Narration may use it.`),
  });

  return { id: row.id, word: row.word, ownRecording: verdict.ownRecording };
}

/**
 * Reject a word as not actually Igbo — the editor's answer to the finder being wrong.
 *
 * This is a NEGATIVE result and it is recorded as one: the word leaves the queue for good, the render gate
 * stops considering it, and the audit row says who decided and why. **A rejected word is not deleted**,
 * because "somebody looked at this and judged it English" is a fact worth keeping — and because deleting it
 * would let the next sweep put it back and ask again.
 */
export async function rejectPronunciation(
  db: Db,
  input: { word?: string; id?: number; actorId: number; note?: string | null }
): Promise<{ id: number; word: string }> {
  const row = await findRow(db, input);
  if (!row) throw new MemberError('no_word', 'That word is not in the pronunciation queue.');
  if (row.status === 'rejected') {
    throw new MemberError('already_rejected', `“${row.word}” was already judged not Igbo. Nothing was changed.`);
  }

  await db.query(
    `update ozikoro_pronunciation
        set status = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3, updated_at = now()
      where id = $1`,
    [row.id, input.actorId, input.note?.trim() || null]
  );

  await audit(db, {
    id: row.id, action: 'reject_pronunciation', actorId: input.actorId,
    before: { status: row.status },
    after: { status: 'rejected' },
    note: input.note?.trim() || `Judged “${row.word}” not an Igbo word. It leaves the queue and stops blocking narration.`,
  });

  return { id: row.id, word: row.word };
}

/** One row, by id or by word. **The word is folded with the dictionary's own function**, never by hand. */
async function findRow(
  db: Db,
  key: { word?: string; id?: number }
): Promise<{
  id: number; word: string; status: PronunciationStatus; kind: PronunciationKind;
  recordedBy: number | null; hasAudio: boolean; respelling: string | null;
} | null> {
  const row = await db.one<Record<string, unknown>>(
    `select id, word, status, kind, recorded_by, respelling,
            (storage_key is not null or external_url is not null) as has_audio
       from ozikoro_pronunciation
      where ($1::bigint is not null and id = $1)
         or ($2::text is not null and search_form = $2)
      limit 1`,
    [key.id ?? null, key.word ? toSearchForm(key.word) : null]
  );
  if (!row) return null;
  return {
    id: Number(row.id),
    word: String(row.word),
    status: row.status as PronunciationStatus,
    kind: row.kind as PronunciationKind,
    recordedBy: row.recorded_by === null ? null : Number(row.recorded_by),
    hasAudio: Boolean(row.has_audio),
    respelling: row.respelling === null ? null : String(row.respelling),
  };
}

/*
 * ---------------------------------------------------------------------------
 * THE RENDER GATE
 * ---------------------------------------------------------------------------
 */

export type PronunciationGap = { word: string; folded: string; articles: number; times: number; blocks: boolean; composedOf: string[] | null };

/**
 * The words in one article that the archive cannot say, re-read LIVE.
 *
 * **Live rather than from `ozikoro_episode.pronunciation_gaps`**, and the difference matters: a word recorded
 * and approved after a proposal must unblock the render without the proposal being thrown away. The stored
 * column is the record of what was known when the proposal was made; this function is the answer to "may we
 * render now", and the two are deliberately different questions.
 */
export async function pronunciationGaps(
  db: Db,
  slug: string,
  index?: DictionaryIndex
): Promise<{ gaps: PronunciationGap[]; blocking: PronunciationGap[]; composed: PronunciationGap[] }> {
  const plan = await planArticlePronunciation(db, { slug, index: index ?? (await buildDictionaryIndex(db)) });

  // For every Igbo word the article uses, what does the archive now hold? A word already approved, or
  // composed from parts, is not a gap.
  const gaps: PronunciationGap[] = [];
  const seen = new Set<string>();

  for (const item of [...plan.missing, ...plan.composed.map((c) => ({ word: c.word, folded: c.folded }))]) {
    if (seen.has(item.folded)) continue;
    seen.add(item.folded);

    const row = await db.one<Record<string, unknown>>(
      `select p.id, p.word, p.search_form, p.status, p.kind, p.composed_of,
              coalesce(o.articles, 0)::int as articles, coalesce(o.times, 0)::int as times
         from ozikoro_pronunciation p
         left join lateral (
           select count(*) as articles, sum(occ.times) as times
             from ozikoro_pronunciation_occurrence occ
            where occ.pronunciation_id = p.id
         ) o on true
        where p.language_code = 'ibo' and p.search_form = $1
        limit 1`,
      [item.folded]
    );
    if (!row) continue;

    const status = String(row.status);
    const kind = String(row.kind);
    if (status === 'approved' || status === 'rejected') continue;
    gaps.push({
      word: String(row.word),
      folded: String(row.search_form),
      articles: Number(row.articles ?? 0),
      times: Number(row.times ?? 0),
      blocks: kind !== 'composed',
      composedOf: Array.isArray(row.composed_of) ? (row.composed_of as string[]) : null,
    });
  }

  return {
    gaps,
    blocking: gaps.filter((g) => g.blocks),
    composed: gaps.filter((g) => !g.blocks),
  };
}

/**
 * The owner's decision to narrate anyway, recorded as a decision.
 *
 * The instruction is that a word the archive cannot pronounce "must block or flag the article's narration,
 * not silently render a guess", and that if the owner approves narration despite gaps, the record says what
 * happened. So this writes the actor, the time and the words that were accepted — **on the episode, where
 * the narration it authorises lives**, and not only in a log.
 */
export async function waivePronunciationGaps(
  db: Db,
  input: { slug: string; actorId: number; note?: string | null }
): Promise<{ slug: string; waived: number }> {
  const { blocking } = await pronunciationGaps(db, input.slug);
  const episode = await db.one<{ id: number }>(`select id from ozikoro_episode where slug = $1`, [input.slug]);
  if (!episode) throw new MemberError('no_episode', 'There is no narration for that record to decide about.');

  await db.query(
    `update ozikoro_episode
        set pronunciation_waived_by = $2, pronunciation_waived_at = now(), pronunciation_waiver_note = $3,
            pronunciation_gaps = $4::jsonb, updated_at = now()
      where id = $1`,
    [
      episode.id, input.actorId,
      input.note?.trim() ||
        `Approved narration with ${blocking.length} word${blocking.length === 1 ? '' : 's'} the archive cannot pronounce.`,
      JSON.stringify(blocking),
    ]
  );

  await audit(db, {
    id: episode.id, action: 'waive_pronunciation_gaps', actorId: input.actorId,
    after: { words: blocking.map((g) => g.word) },
    note: input.note?.trim() || null,
  });

  return { slug: input.slug, waived: blocking.length };
}

/**
 * WHETHER A RECORD MAY BE NARRATED YET — the gate as a decision, separate from the render.
 *
 * WHY THIS IS ITS OWN FUNCTION AND NOT FOUR LINES INSIDE `renderProposedNarration`
 *
 * The gate is the owner's credit-control mechanism: *"approved before it produces any record, as to not waste
 * credits."* **And a mechanism whose only proof is a live render is a mechanism that can only be tested by
 * spending money.** Proving it inside the render path would mean calling `speak` — and if the gate were
 * broken, the proof would have cost the credits it was meant to protect. So the DECISION lives here, the
 * render calls it, and the test calls it directly. That is a testable mechanism rather than a promise.
 *
 * It returns a refusal with words in it rather than a boolean, because the page and the refusal message both
 * need to name what is missing.
 */
export async function narrationPronunciationGate(
  db: Db,
  input: { slug: string; episodeId?: number; index?: DictionaryIndex }
): Promise<
  | { allowed: true; composed: PronunciationGap[] }
  | { allowed: false; reason: 'unpronounceable_words'; words: PronunciationGap[]; message: string }
> {
  const { blocking, composed } = await pronunciationGaps(db, input.slug, input.index);
  if (blocking.length === 0) return { allowed: true, composed };

  // A recorded waiver is a decision, and a decision is allowed to stand. It is looked up on the EPISODE,
  // because that is the thing being narrated and the thing the audit names.
  const waiver = input.episodeId
    ? await db.one<{ by: number | null }>(
        `select pronunciation_waived_by as by from ozikoro_episode where id = $1`,
        [input.episodeId]
      )
    : null;
  if (waiver?.by) return { allowed: true, composed };

  const names = blocking.slice(0, 6).map((g) => g.word).join(', ');
  return {
    allowed: false,
    reason: 'unpronounceable_words',
    words: blocking,
    message:
      `${blocking.length} Igbo word${blocking.length === 1 ? '' : 's'} in this record cannot be pronounced ` +
      `yet: ${names}${blocking.length > 6 ? `, and ${blocking.length - 6} more` : ''}. ` +
      'Record and approve them, or approve the narration despite the gaps — nothing has been sent.',
  };
}

/*
 * ---------------------------------------------------------------------------
 * THE NOTIFICATION
 * ---------------------------------------------------------------------------
 */

export type Digest = {
  subject: string;
  text: string;
  html: string;
  /** The words the digest is about, most valuable first. */
  words: QueueRow[];
  total: number;
};

/**
 * The digest: the most valuable missing words, and the articles that need them.
 *
 * A DIGEST AND NOT ONE EMAIL PER WORD. The words arrive a thousand at a time from a sweep, and a message per
 * word would be a thousand messages nobody reads — which is the same as no notification at all. The owner's
 * own test decides the order: *"a word appearing in forty articles is worth recording, one appearing in a
 * single draft may not."*
 *
 * **It lists only the words that BLOCK a render** — a composed word can already be approximated from parts,
 * and asking a person to record those would bury the ones that matter.
 */
export async function buildDigest(
  db: Db,
  options: { limit?: number; baseUrl?: string } = {}
): Promise<Digest> {
  const limit = Math.min(Math.max(options.limit ?? 12, 1), 50);
  const words = await listQueue(db, { status: 'open', blockingOnly: true, limit });
  const counts = await queueCounts(db);
  const site = options.baseUrl?.replace(/\/$/, '') ?? 'https://ozikoro.com';
  const queueUrl = `${site}/admin/pronunciation/`;

  if (words.length === 0) {
    return {
      subject: 'Ozikoro pronunciation: nothing is waiting',
      text:
        'Every Igbo word the archive has found so far can be pronounced, so there is nothing to record.\n\n' +
        `The queue is at ${queueUrl}\n`,
      html:
        '<p>Every Igbo word the archive has found so far can be pronounced, so there is nothing to record.</p>' +
        `<p><a href="${queueUrl}">The pronunciation queue</a></p>`,
      words: [],
      total: 0,
    };
  }

  const lines: string[] = [];
  lines.push(
    `${counts.blocking} word${counts.blocking === 1 ? '' : 's'} in the archive cannot be pronounced yet. ` +
      'They are listed below by how many records need them, because a word forty articles use is worth a ' +
      'person’s time and one a single draft uses may not be.'
  );
  lines.push('');
  for (const word of words) {
    const places = word.where
      .slice(0, 4)
      .map((w) => `      · ${w.title ?? w.slug ?? `article ${w.articleId}`}${w.times > 1 ? ` (×${w.times})` : ''}`)
      .join('\n');
    const more = word.where.length > 4 ? `\n      · and ${word.where.length - 4} more` : '';
    lines.push(
      `  ${word.word} — in ${word.articles} record${word.articles === 1 ? '' : 's'}, ` +
        `${word.times} time${word.times === 1 ? '' : 's'} in all\n${places}${more}`
    );
  }
  lines.push('');
  lines.push('To record one: open the queue, upload a recording or write a respelling, and approve it.');
  lines.push('Nothing is sent to be narrated until it is approved, so no credit is spent on a word the');
  lines.push('archive cannot yet say.');
  lines.push('');
  lines.push(`The queue is at ${queueUrl}`);

  const html = [
    `<p>${counts.blocking} word${counts.blocking === 1 ? '' : 's'} in the archive cannot be pronounced yet. ` +
      'They are listed by how many records need them, because a word forty articles use is worth a person’s ' +
      'time and one a single draft uses may not be.</p>',
    '<ul>',
    ...words.map((word) => {
      const places = word.where
        .slice(0, 4)
        .map((w) => `<li>${escapeHtml(w.title ?? w.slug ?? `article ${w.articleId}`)}${w.times > 1 ? ` (×${w.times})` : ''}</li>`)
        .join('');
      const more = word.where.length > 4 ? `<li>and ${word.where.length - 4} more</li>` : '';
      return (
        `<li><strong>${escapeHtml(word.word)}</strong> — in ${word.articles} record${word.articles === 1 ? '' : 's'}, ` +
        `${word.times} time${word.times === 1 ? '' : 's'} in all<ul>${places}${more}</ul></li>`
      );
    }),
    '</ul>',
    `<p>To record one: <a href="${queueUrl}">open the queue</a>, upload a recording or write a respelling, and ` +
      'approve it. Nothing is sent to be narrated until it is approved, so no credit is spent on a word the ' +
      'archive cannot yet say.</p>',
  ].join('\n');

  return {
    /*
     * THE SUBJECT AGREES WITH ITS OWN NUMBER.
     *
     * The first version read "1 Igbo word need a recording before they can be narrated" — a plural verb and a
     * plural pronoun for a count of one, in the one line a person sees before deciding whether to open the
     * message. **A notification whose first sentence is visibly wrong reads as machine-made, and this one is
     * asking a human being to do work.** The words are chosen from the count.
     */
    subject:
      counts.blocking === 1
        ? '1 Igbo word needs a recording before it can be narrated'
        : `${counts.blocking} Igbo words need a recording before they can be narrated`,
    text: lines.join('\n'),
    html,
    words,
    total: counts.blocking,
  };
}

/** The accounts the owner named: the administrators and the editors. Read from the capability table. */
export async function pronunciationRecipients(db: Db): Promise<{ email: string; role: string }[]> {
  /*
   * READ FROM THE CAPABILITIES, NOT FROM A LIST OF ROLE NAMES IN THIS FILE.
   *
   * The owner said "inform the admin, and editors". **Who that is has exactly one definition in this system
   * and it is `ozikoro_capabilities`** — the same function every route gate calls. A role list written here
   * would be a second definition, and it would go on being wrong after the first role change. So this asks
   * the database which accounts can review audio, and the answer is the recipients.
   */
  const rows = await db.rows<{ email: string; role: string }>(
    `select distinct a.email, a.role::text as role
       from account a
      where a.status = 'active'
        and a.email is not null and length(btrim(a.email)) > 3
        and 'review_audio' in (select c from ozikoro_capabilities(a.id) c)
      order by a.role::text, a.email`
  );
  return rows;
}

/**
 * Send the digest.
 *
 * **A notification that fails must not fail the work**, so the send result is returned rather than thrown:
 * the queue is the record, and the mail is a courtesy that tells somebody the record changed. The caller
 * decides what to say about a failure — which is the pattern `sendMail` itself is built on.
 */
export async function sendDigest(
  db: Db,
  options: { limit?: number; baseUrl?: string; dryRun?: boolean } = {}
): Promise<{ digest: Digest; recipients: string[]; sent: SendResult | null; reason?: string }> {
  const digest = await buildDigest(db, options);
  const people = await pronunciationRecipients(db);
  const recipients = people.map((p) => p.email);

  if (recipients.length === 0) {
    return { digest, recipients, sent: null, reason: 'No active account holds “review audio”, so there is nobody to tell.' };
  }
  if (options.dryRun) {
    return { digest, recipients, sent: null, reason: 'Dry run: the message was composed and not sent.' };
  }

  const sent = await sendMail({
    // Resend accepts a comma-separated list; each recipient sees the others, which is right for a shared
    // editorial queue and wrong for anything private. Nothing private is in this message.
    to: recipients.join(', '),
    subject: digest.subject,
    text: digest.text,
    html: digest.html,
    replyTo: siteAddress(),
  });

  return { digest, recipients, sent };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
