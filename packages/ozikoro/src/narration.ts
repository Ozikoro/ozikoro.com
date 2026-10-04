/**
 * THE PROPOSAL, AND THE REVIEW QUEUE AROUND IT.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE
 *
 * *Every audio embarked on must be approved, and the approval must come before the spend.* The render is the
 * only act in this pipeline that costs money — `speak` sends the whole article to ElevenLabs and is billed by
 * the character — so the expensive step must not be reachable without a human decision. **A review gate on
 * publication is not a gate on spending**: by the time an episode is `pending_review` the credits are already
 * gone, and declining it buys nothing back.
 *
 * So a narration has two decisions, and this module owns both:
 *
 *   1. `proposeNarration` — prepare the article's own words for speaking, count the characters, cost them, and
 *      record the whole thing as an episode in `proposed` with NO audio. **It does not call ElevenLabs, and it
 *      cannot: nothing here imports the API client.** That is the point — the no-credits rule is structural
 *      rather than a promise, because the module that creates a proposal has no way to spend anything.
 *
 *   2. `declineNarration` / `publishNarrationEpisode` / `rejectNarration` — the decisions. Declining costs
 *      nothing. Publishing is what makes the player appear on the article. Rejecting with corrections keeps
 *      the corrected script as a NEW revision and sends the episode back to be rendered again.
 *
 * THE SCRIPT IS THE ARTICLE'S OWN WORDS
 *
 * `toSpokenScript` removes markup and citation brackets and nothing else — no rewriting, no dramatising. The
 * archive's founding rule is that nothing is invented, and a history rewritten into a dramatic register
 * asserts a tone the record does not have in a way a listener cannot detect. The proposal exists so a person
 * can read those exact words before they are spoken aloud.
 */
import type { Db } from '@ozituma/db/client';
import { MemberError } from './members.ts';
import { toSpokenScript } from './spoken.ts';

/** The voice the owner trained, or a stock narrator. Recorded on the proposal, used at render time. */
export type NarrationVoice = 'own' | 'generic';

export function isNarrationVoice(value: string): value is NarrationVoice {
  return value === 'own' || value === 'generic';
}

/*
 * ---------------------------------------------------------------------------
 * THE ONE CONDITION THAT PUTS AN EPISODE IN FRONT OF A READER
 * ---------------------------------------------------------------------------
 *
 * THE OWNER'S RULE, VERBATIM
 *
 *   "on the audio article, if one is not approved, please be sure it does not show audio"
 *
 * THE FAULT THIS CLOSES
 *
 * Three public surfaces select an episode: the article page, the podcast feed and the transcript. Each asked
 * `status = 'published'`, and that is a gate on PUBLICATION. **It is not a gate on APPROVAL**, and the two
 * are different facts on different columns: `published` is written by `publishNarrationEpisode`, which also
 * writes `approved_by` and `approved_at` — but any other write that sets the status alone produces a row that
 * LOOKS live and records that nobody approved it. `scripts/narration-review.ts check` already calls that
 * state a failure ("published without an approver"); until this fragment existed, the public surfaces served
 * it anyway.
 *
 * WHY IT IS ONE FRAGMENT AND NOT FOUR COPIES
 *
 * A condition written out at each call site is four places to forget — and this repository's record is that
 * the second copy is the one that drifts (the media resolver, the design script paths, the two share
 * controls). So all four surfaces compose the same string, and a surface added later has an obvious thing to
 * call rather than a sentence to remember.
 *
 * `published` REMAINS THE BAR, and `approved` is not it: **no code path sets `status = 'approved'`** —
 * `publishNarrationEpisode` moves `pending_review` (or `approved`) straight to `published` — so requiring the
 * `approved` status would hide every episode the archive owns. What the record's own states say is that
 * `published` is "live" and `approved_at` is "a person authorised this". Both are required here.
 *
 * `approved_by` is required beside `approved_at` because they are one act: `publishNarrationEpisode` writes
 * both, and the two scripts that publish outside it (`restore-episodes.ts`, `adopt-episode-recording.ts`)
 * write both. A timestamp with no account behind it is exactly the unattributable approval the owner asked
 * not to have.
 *
 * `alias` is the table alias in the caller's query (`'e'` in the feed, `''` in the article and transcript).
 * It is compiled into the string rather than parameterised because a table alias cannot be a bind parameter —
 * and it is only ever a literal this repository writes.
 */
export function playableEpisodeSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `${p}status = 'published' and ${p}approved_at is not null and ${p}approved_by is not null`;
}

/**
 * THE CONDITION THAT PUTS A PLAYER IN FRONT OF A READER — approval AND an address to play.
 *
 * THE OWNER'S RULE, VERBATIM
 *
 *   "every article with youtube embeded on this blog must automatically appear in watch, same way every
 *    audio inside an article on this website must appear on listen."
 *
 * WHY A SECOND FRAGMENT RATHER THAN A SECOND COPY
 *
 * `playableEpisodeSql()` answers *may this episode be heard*. It does not answer *is there anything to
 * hear*: a row can be approved and published with both `storage_key` and `external_url` NULL — an approval
 * recorded before the file was written, which the schema permits. **The article page has always required the
 * second half** (`and coalesce(external_url, storage_key) is not null`), and until this fragment existed the
 * listen page would have had to write that same clause out again to mean the same thing. **This repository
 * has paid four times for a second copy drifting** (the media resolver, the design script paths, the two
 * share controls), so the clause is composed here and both surfaces ask the same question of the same
 * columns.
 *
 * WHAT IT IS *NOT*
 *
 * The podcast feed must not use this. An `<enclosure>` has to be a file a client can fetch, so the feed is
 * legitimately NARROWER than a page — it accepts our own `storage_key` or an external URL a check
 * established serves audio, and a Spotify episode PAGE is neither. That difference is real and is stated at
 * the feed's own query; a shared fragment would have hidden it.
 *
 * `alias` is the table alias in the caller's query (`'a'`/`'e'` where the caller joins, `''` on the article).
 * It is compiled into the string rather than parameterised because a table alias cannot be a bind parameter —
 * and it is only ever a literal this repository writes.
 */
export function playableEpisodeAudioSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `${playableEpisodeSql(alias)} and coalesce(${p}external_url, ${p}storage_key) is not null`;
}


/**
 * THE RATE THE ESTIMATE USES.
 *
 * ElevenLabs bills text-to-speech by the character, and the multilingual narration model used here bills one
 * credit per character. **This is an ESTIMATE and it is labelled as one everywhere it is shown**, because the
 * authority on what was actually charged is the API's own `character_count` before and after the render — and
 * that measurement is what the transition note records once an episode is rendered. A hard-coded rate that
 * silently disagreed with the account would be a number presented as a fact.
 */
export const CREDITS_PER_CHARACTER = 1;

export function estimateNarrationCredits(characters: number): number {
  return Math.ceil(Math.max(0, characters) * CREDITS_PER_CHARACTER);
}

/** About 145 words a minute is the ordinary pace of a read history — the figure `prepare-episode` uses. */
export function countNarrationWords(script: string): number {
  return script.split(/\s+/).filter(Boolean).length;
}

export function estimateNarrationSeconds(script: string): number {
  return Math.round((countNarrationWords(script) / 145) * 60);
}

export function narratorKindFor(voice: NarrationVoice): 'synthetic_own_voice' | 'synthetic_generic' {
  return voice === 'own' ? 'synthetic_own_voice' : 'synthetic_generic';
}

/**
 * The disclosure that ships with the audio.
 *
 * **Spotify's rules put the responsibility for synthetic narration on the publisher**, and the record has to
 * say which kind of voice it was. This is written once so the API surface, the CLI and the review screen
 * cannot disagree about what the listener is told.
 */
export function narrationDisclosure(voice: NarrationVoice): string {
  return voice === 'own'
    ? 'This episode was generated using AI text-to-speech from a voice cloned from the author’s own recording, with his permission. The words are the article’s own.'
    : 'This episode was generated using AI text-to-speech. The words are the article’s own. Narrated by a synthetic voice.';
}

/*
 * ---------------------------------------------------------------------------
 * THE TWO CLOCKS THE SWEEP RUNS ON, AND WHY THERE ARE TWO
 * ---------------------------------------------------------------------------
 */

/**
 * HOW LONG AFTER PUBLICATION THE SWEEP STARTS OFFERING TO NARRATE.
 *
 * Five minutes. The owner asked for "a few minutes after the article goes live", and the small delay is not
 * ceremony: **an article is often published and then corrected in the same sitting**, and a proposal built
 * from a version that is about to change would be a script nobody wants read.
 */
export const DEFAULT_DELAY_MINUTES = 5;

/**
 * THE OLDEST ARTICLE THE SWEEP WILL PROPOSE FOR.
 *
 * THE MISTAKE THIS AVOIDS IS THE WHOLE REASON THE COLUMN EXISTS.
 *
 * The archive holds 1,051 published records. A sweep with no lower bound and no upper bound would find all of
 * them on its first run — **a queue of a thousand proposals nobody asked for, one approval away from a
 * hundred thousand characters of spend.** The delay alone does not prevent it: every one of those records is
 * far older than five minutes.
 *
 * So the sweep proposes only for records that "went live" within this window, which is what makes it a
 * follower of publication rather than a backfill of the archive. **A deliberate backfill is still possible
 * and must be asked for** — `--since` on the CLI and `since` on the route override this.
 *
 * `published_at` is the primary signal, but three columns are tried in order: the importer set `published_at`
 * for the migrated records, while an editor publishing through the facets form moves `status` and touches
 * `updated_at` and never sets `published_at` at all. **Reading only `published_at` would mean an article
 * published on this site is never proposed for.**
 */
export const DEFAULT_MAX_AGE_HOURS = 24;

/**
 * HOW MANY PROPOSALS ONE RUN MAY CREATE.
 *
 * Small on purpose. The queue is read by a person, and a run that dumped a week of proposals at once would be
 * a wall rather than a list. A cron running every five minutes clears this in seconds.
 */
export const DEFAULT_SWEEP_LIMIT = 5;

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/*
 * WHY THESE ARE TWO FUNCTIONS EACH RATHER THAN ONE WITH A DEFAULT PARAMETER
 *
 * The reading of the environment and the interpretation of it are separated because of a check that runs on
 * every commit: `scripts/check-secrets.sh` requires every variable the application reads to appear in
 * `.env.example`, and it finds them by looking for a literal read of the process environment naming the
 * variable. **A function that took the environment as a default parameter read the variable off that
 * parameter and mentioned the process environment only once, as its own default — so the check reported both
 * variables as "documented but never read" and the commit was refused.** An injectable reader is worth keeping
 * for a test; the literal read is what makes the pair visible, so both exist and each says which is which.
 *
 * The comment deliberately does not spell the pattern out: written literally it matches the check's own
 * expression, and the check then reports a variable called NAME — **the self-match this repository has already
 * recorded twice, where a detector was found to be matching its own documentation.**
 */

/** The raw value, as given — a pure function, so a test can pass a string instead of touching the environment. */
export function resolveNarrationDelayMinutes(raw: string | undefined): number {
  return positiveInt(raw, DEFAULT_DELAY_MINUTES);
}

/** `OZIKORO_NARRATION_DELAY_MINUTES`, or five. */
export function narrationDelayMinutes(): number {
  return resolveNarrationDelayMinutes(process.env.OZIKORO_NARRATION_DELAY_MINUTES);
}

/** The raw value, as given. */
export function resolveNarrationMaxAgeHours(raw: string | undefined): number {
  return positiveInt(raw, DEFAULT_MAX_AGE_HOURS);
}

/** `OZIKORO_NARRATION_MAX_AGE_HOURS`, or twenty-four. */
export function narrationMaxAgeHours(): number {
  return resolveNarrationMaxAgeHours(process.env.OZIKORO_NARRATION_MAX_AGE_HOURS);
}

/**
 * A published record's own words, ready to be proposed.
 *
 * Throws `MemberError('no_article')` for anything that is not a published, non-page record — the same rule the
 * render route applies, and for the same reason: an ingested record held as `review` has not been stood behind
 * as text yet, and speaking it aloud would put the archive's voice on something it has not published.
 */
export async function loadNarrationArticle(
  db: Db,
  slug: string
): Promise<{ id: number; slug: string; title: string; standfirst: string | null; bodyHtml: string }> {
  const article = await db.one<{
    id: number; slug: string; title: string; standfirst: string | null; body_html: string | null;
  }>(
    `select id, slug, title, standfirst, body_html
       from ozikoro_article
      where slug = $1 and status = 'published' and is_page = false`,
    [slug]
  );
  if (!article) throw new MemberError('no_article', 'No published record has that slug.');
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    standfirst: article.standfirst,
    bodyHtml: article.body_html ?? '',
  };
}

/*
 * ---------------------------------------------------------------------------
 * THE REVISION HISTORY
 * ---------------------------------------------------------------------------
 */

/**
 * Record a script version, attaching the audio when there is audio for it.
 *
 * **A revision is never overwritten.** A corrected script becomes a new row, so a rejected take can always be
 * returned to and the question "what exactly was said" has an answer for every version that was ever live.
 *
 * The one case that updates an existing row is a render completing for a script that is ALREADY the latest
 * revision and has no audio yet — the proposal's version. Filling in the audio beside the very words it was
 * made from is not an overwrite of anything: no script character changes. **A second render of the same script
 * after a rejection inserts a fresh revision instead**, because that is a new take and the two recordings are
 * different objects.
 */
export async function recordNarrationRevision(
  db: Db,
  episodeId: number,
  script: string,
  opts: {
    storageKey?: string | null;
    externalUrl?: string | null;
    byteSize?: number | null;
    durationSeconds?: number | null;
    generatorModel?: string | null;
    voiceSettings?: unknown;
    createdBy?: number | null;
  } = {}
): Promise<number> {
  const latest = await db.one<{ revision_number: number; script: string; storage_key: string | null }>(
    `select revision_number, script, storage_key
       from ozikoro_episode_revision
      where episode_id = $1
      order by revision_number desc
      limit 1`,
    [episodeId]
  );

  const settings = opts.voiceSettings === undefined ? null : JSON.stringify(opts.voiceSettings);

  if (latest && latest.script === script) {
    /*
     * THE SAME SCRIPT IS NOT A NEW VERSION.
     *
     * This is where a re-proposal of an unrendered record used to duplicate its own history. `proposeNarration`
     * records the proposed script as revision 1, so proposing the same record a second time — after a decline,
     * or when a sweep refreshes it — reached this function with a script that already had a revision, found no
     * audio to attach, and fell through to the INSERT. **The archive then held two identical revisions and
     * every later correction landed one number higher than the recorded history said it should**, which is
     * exactly the kind of quiet drift the revision table exists to prevent, and it was found by a test rather
     * than by reading this code.
     *
     * So the same words with nothing new to attach is a no-op that returns the revision already holding them.
     */
    if (opts.storageKey && latest.storage_key === null) {
      // The render completing for the script this revision already holds. Filling in the audio beside the very
      // words it was made from changes no script character, so it is not an overwrite of anything.
      await db.query(
        `update ozikoro_episode_revision
            set storage_key = $2, external_url = $3, byte_size = $4, duration_seconds = $5,
                generator_model = $6, voice_settings = $7
          where episode_id = $1 and revision_number = $8`,
        [
          episodeId, opts.storageKey, opts.externalUrl ?? null, opts.byteSize ?? null,
          opts.durationSeconds ?? null, opts.generatorModel ?? null, settings, latest.revision_number,
        ]
      );
      return latest.revision_number;
    }
    if (!opts.storageKey) return latest.revision_number;
    /*
     * Audio for a script that already has some IS a new version: a second recording of the same words is a
     * different object, and the rejected take has to stay reachable. It falls through to the insert.
     */
  }

  const number = (latest?.revision_number ?? 0) + 1;
  await db.query(
    `insert into ozikoro_episode_revision
       (episode_id, revision_number, script, storage_key, external_url, byte_size, duration_seconds,
        generator_model, voice_settings, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      episodeId, number, script, opts.storageKey ?? null, opts.externalUrl ?? null,
      opts.byteSize ?? null, opts.durationSeconds ?? null, opts.generatorModel ?? null, settings,
      opts.createdBy ?? null,
    ]
  );
  return number;
}

/** Every state change, with who made it. The audit trail the whole review step rests on. */
async function recordTransition(
  db: Db,
  episodeId: number,
  fromStatus: string | null,
  toStatus: string,
  actorId: number | null,
  note: string | null
): Promise<void> {
  await db.query(
    `insert into ozikoro_episode_transition (episode_id, from_status, to_status, actor_account_id, note)
     values ($1,$2,$3,$4,$5)`,
    [episodeId, fromStatus, toStatus, actorId, note]
  );
}

/** The statuses a proposal may be created or refreshed from. Anything else is under way and must not be clobbered. */
const PROPOSEABLE = new Set(['proposed', 'draft', 'failed', 'corrections', 'declined']);

export type NarrationProposal = {
  episodeId: number;
  slug: string;
  title: string;
  status: string;
  script: string;
  transcript: string;
  characters: number;
  estimatedCredits: number;
  estimatedSeconds: number;
  words: number;
  voice: NarrationVoice;
  proposedAt: Date | null;
};

/**
 * Prepare a proposal. **This function spends nothing and cannot spend anything.**
 *
 * It reads the record, removes what cannot be heard, counts the characters, costs them at the estimate rate,
 * and writes an episode in `proposed` with a null `storage_key`. Nothing in this file imports the ElevenLabs
 * client, so there is no path from here to a charge.
 *
 * A record that already has an episode under way is refused rather than overwritten: **re-proposing a rendered
 * take would silently discard the audio somebody is in the middle of reviewing**, and re-proposing a published
 * one would pull a live episode back into the queue.
 */
export async function proposeNarration(
  db: Db,
  input: {
    slug: string;
    /** Defaults to what the episode already proposed, then to the owner's own trained voice. */
    voice?: NarrationVoice;
    /** Null for the sweep, which runs with nobody signed in. */
    actorId: number | null;
    note?: string | null;
  }
): Promise<NarrationProposal> {
  const article = await loadNarrationArticle(db, input.slug);

  const existing = await db.one<{ id: number; status: string; voice_choice: string | null }>(
    `select id, status, voice_choice from ozikoro_episode where slug = $1`,
    [article.slug]
  );
  if (existing && !PROPOSEABLE.has(existing.status)) {
    throw new MemberError(
      'already_under_way',
      `“${article.title}” already has an episode in “${existing.status}”. Review or withdraw that one first.`
    );
  }

  const { script, transcript } = toSpokenScript(article.bodyHtml);
  if (script.replace(/\s+/g, '').length === 0) {
    throw new MemberError('nothing_to_say', 'That record has no spoken words to narrate.');
  }

  const characters = script.length;
  const estimatedCredits = estimateNarrationCredits(characters);
  const seconds = estimateNarrationSeconds(script);
  const words = countNarrationWords(script);
  const voice: NarrationVoice =
    input.voice ?? (existing?.voice_choice && isNarrationVoice(existing.voice_choice) ? existing.voice_choice : 'own');
  const note = input.note?.trim() || null;

  /*
   * THE ROW IS THE PROPOSAL, AND ITS `storage_key` IS CLEARED.
   *
   * A re-proposal from `failed` or `corrections` must not leave the previous render's key behind: **the
   * download route serves raw audio for any episode that has any**, whatever its status, so a stale key would
   * offer a file that does not match the script now on the row.
   */
  const episode = await db.one<{ id: number }>(
    `insert into ozikoro_episode
       (article_id, slug, title, script, transcript, summary, narrator_kind, ai_disclosure,
        storage_key, external_url, byte_size, duration_seconds, status,
        char_count, estimated_credits, voice_choice, proposed_by, proposed_at, decision_note,
        generator, generator_model, voice_settings)
     values ($1,$2,$3,$4,$4,$5,$6,$7,null,null,null,$8,'proposed',$9,$10,$11,$12,now(),$13,
             'elevenlabs','eleven_multilingual_v2',$14)
     on conflict (slug) do update set
       title = excluded.title, script = excluded.script, transcript = excluded.transcript,
       summary = excluded.summary, narrator_kind = excluded.narrator_kind, ai_disclosure = excluded.ai_disclosure,
       storage_key = null, external_url = null, byte_size = null, duration_seconds = excluded.duration_seconds,
       status = 'proposed', char_count = excluded.char_count, estimated_credits = excluded.estimated_credits,
       voice_choice = excluded.voice_choice, proposed_by = excluded.proposed_by, proposed_at = now(),
       decision_note = excluded.decision_note, decided_by = null, decided_at = null,
       approved_by = null, approved_at = null, published_at = null, updated_at = now()
     returning id`,
    [
      article.id, article.slug, article.title, script, article.standfirst,
      narratorKindFor(voice), narrationDisclosure(voice), seconds,
      characters, estimatedCredits, voice, input.actorId, note,
      /*
       * THE SETTINGS A PROPOSAL RECORDS, AND WHY THEY ARE TYPED OUT RATHER THAN IMPORTED.
       *
       * The same object lives in `apps/ozikoro/lib/elevenlabs.ts` as `NARRATION_SETTINGS`, and this package
       * cannot reach it — the dependency runs the other way, so an import here would be a cycle. **That makes
       * this a copy, and a copy that had already drifted: it was missing `speed` entirely, so a proposal
       * describing a render that ran at the API's default of 1.0 recorded nothing at all about pace.** It now
       * carries the same 0.75, and the drift is worth naming because **the next person to change the speed must
       * change it here too, or the row will describe a render that never happened.**
       *
       * `duration_source` is honestly `estimated` here and says so: no audio exists yet, so there is nothing to
       * measure, and the figure beside it is the word count at 145 words per minute. The render replaces both
       * once it has a file — see `mp3DurationSeconds`.
       */
      JSON.stringify({
        stability: 0.7, similarity_boost: 0.8, style: 0.1, use_speaker_boost: true, speed: 0.75,
        duration_source: 'estimated',
      }),
    ]
  );
  if (!episode) throw new MemberError('not_saved', 'The proposal could not be recorded.');

  // THE PROPOSED SCRIPT IS KEPT AS A REVISION STRAIGHT AWAY, before anything can edit it.
  // **A proposal that is later corrected would otherwise lose the exact words that were approved**, because
  // the corrected text replaces `ozikoro_episode.script` — the column is the current script, and the revision
  // is what makes "the current script" a change with a history rather than an overwrite.
  await recordNarrationRevision(db, episode.id, script, { createdBy: input.actorId });

  await recordTransition(
    db, episode.id, existing?.status ?? null, 'proposed', input.actorId,
    note ?? `Proposed for narration: ${characters.toLocaleString('en-GB')} characters, about ${estimatedCredits.toLocaleString('en-GB')} credits at the estimate. Nothing has been rendered and nothing has been spent.`
  );

  return {
    episodeId: episode.id,
    slug: article.slug,
    title: article.title,
    status: 'proposed',
    script,
    transcript,
    characters,
    estimatedCredits,
    estimatedSeconds: seconds,
    words,
    voice,
    proposedAt: null,
  };
}

/** One episode, by slug or id. */
export async function findNarrationEpisode(
  db: Db,
  key: { slug?: string; episodeId?: number }
): Promise<{
  id: number; slug: string; title: string; status: string; script: string; transcript: string;
  storageKey: string | null; externalUrl: string | null; voiceChoice: NarrationVoice | null;
  charCount: number | null; estimatedCredits: number | null; durationSeconds: number | null;
  articleId: number; hasAudio: boolean;
} | null> {
  const row = await db.one<{
    id: number; slug: string; title: string; status: string; script: string; transcript: string;
    storage_key: string | null; external_url: string | null; voice_choice: string | null;
    char_count: number | null; estimated_credits: number | null; duration_seconds: number | null;
    article_id: number;
  }>(
    `select id, slug, title, status, script, transcript, storage_key, external_url, voice_choice,
            char_count, estimated_credits, duration_seconds, article_id
       from ozikoro_episode
      where ($1::text is not null and slug = $1) or ($2::bigint is not null and id = $2)
      limit 1`,
    [key.slug ?? null, key.episodeId ?? null]
  );
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    script: row.script,
    transcript: row.transcript,
    storageKey: row.storage_key,
    externalUrl: row.external_url,
    voiceChoice: row.voice_choice && isNarrationVoice(row.voice_choice) ? row.voice_choice : null,
    charCount: row.char_count,
    estimatedCredits: row.estimated_credits,
    durationSeconds: row.duration_seconds,
    articleId: row.article_id,
    hasAudio: Boolean(row.storage_key || row.external_url),
  };
}

function requireEpisode(
  episode: Awaited<ReturnType<typeof findNarrationEpisode>>,
  key: { slug?: string; episodeId?: number }
): NonNullable<Awaited<ReturnType<typeof findNarrationEpisode>>> {
  if (!episode) {
    throw new MemberError('no_episode', `No episode matches ${key.slug ? `“${key.slug}”` : `id ${key.episodeId}`}.`);
  }
  return episode;
}

/**
 * Refuse a proposal. **Nothing was rendered, so nothing is refunded and nothing is lost.**
 *
 * The refusal is recorded with a note, and the sweep will not ask again: the article now has an episode row, so
 * the anti-join that finds un-narrated records excludes it. **Re-asking after a person said no is how a
 * notification becomes noise**, and a deliberate second attempt is available by proposing the slug directly.
 */
export async function declineNarration(
  db: Db,
  input: { slug?: string; episodeId?: number; actorId: number; note?: string | null }
): Promise<{ episodeId: number; slug: string; title: string }> {
  const episode = requireEpisode(await findNarrationEpisode(db, input), input);
  if (episode.status !== 'proposed') {
    throw new MemberError('not_proposed', `That episode is “${episode.status}”, not a proposal awaiting a decision.`);
  }
  const note = input.note?.trim() || 'Declined. Nothing was rendered and no credits were spent.';
  await db.query(
    `update ozikoro_episode
        set status = 'declined', decided_by = $2, decided_at = now(), decision_note = $3, updated_at = now()
      where id = $1`,
    [episode.id, input.actorId, note]
  );
  await recordTransition(db, episode.id, 'proposed', 'declined', input.actorId, note);
  return { episodeId: episode.id, slug: episode.slug, title: episode.title };
}

/**
 * Edit the script without rendering it.
 *
 * Allowed on a `proposed` episode (still no credits spent) and on one that already has audio — `pending_review`,
 * `corrections`, `approved` or `published`. **A published episode that is edited stops being published and goes
 * to `corrections`**, because the audio on the article no longer matches the script on the row, and leaving it
 * live would put the archive's name on a recording it has just corrected.
 */
export async function setNarrationScript(
  db: Db,
  input: { slug?: string; episodeId?: number; actorId: number; script: string; note?: string | null }
): Promise<{ episodeId: number; slug: string; status: string; revision: number }> {
  const episode = requireEpisode(await findNarrationEpisode(db, input), input);
  const script = input.script.replace(/\r\n/g, '\n').trim();
  if (script.replace(/\s+/g, '').length === 0) {
    throw new MemberError('nothing_to_say', 'A corrected script cannot be empty.');
  }

  const wasPublished = episode.status === 'published';
  const nextStatus = episode.status === 'proposed' ? 'proposed' : 'corrections';

  // The new version first, so the revision exists before the row that points at it moves.
  const revision = await recordNarrationRevision(db, episode.id, script, { createdBy: input.actorId });

  await db.query(
    `update ozikoro_episode
        set script = $2, transcript = $2, char_count = $3, estimated_credits = $4, status = $5,
            decided_by = $6, decided_at = now(), decision_note = $7,
            approved_by = null, approved_at = null, published_at = null, updated_at = now()
      where id = $1`,
    [
      episode.id, script, script.length, estimateNarrationCredits(script.length), nextStatus,
      input.actorId, input.note?.trim() || 'Script edited; the recording must be remade from this version.',
    ]
  );

  await recordTransition(
    db, episode.id, episode.status, nextStatus, input.actorId,
    (wasPublished ? 'UNPUBLISHED and corrected: the live audio no longer matched the script. ' : '') +
      (input.note?.trim() || `Script replaced with revision ${revision}.`)
  );

  return { episodeId: episode.id, slug: episode.slug, status: nextStatus, revision };
}

/**
 * Reject a rendered take with corrections.
 *
 * **The corrected script is a new revision and the old one is kept**, so the rejected take can always be
 * returned to. Passing no script is allowed and means "this recording is not good enough; the script will be
 * edited and it must be rendered again".
 */
export async function rejectNarration(
  db: Db,
  input: {
    slug?: string; episodeId?: number; actorId: number; note?: string | null; correctedScript?: string | null;
  }
): Promise<{ episodeId: number; slug: string; status: string; revision: number | null }> {
  const episode = requireEpisode(await findNarrationEpisode(db, input), input);
  if (!['pending_review', 'approved', 'published', 'corrections'].includes(episode.status)) {
    throw new MemberError('nothing_to_reject', `That episode is “${episode.status}”; there is no rendered take to reject.`);
  }

  const corrected = input.correctedScript?.replace(/\r\n/g, '\n').trim() ?? '';
  if (corrected && corrected !== episode.script) {
    const edited = await setNarrationScript(db, {
      episodeId: episode.id,
      actorId: input.actorId,
      script: corrected,
      note: input.note ?? null,
    });
    return { episodeId: episode.id, slug: episode.slug, status: edited.status, revision: edited.revision };
  }

  const note = input.note?.trim() || 'Rejected with corrections; the script needs editing and a new render.';
  await db.query(
    `update ozikoro_episode
        set status = 'corrections', decided_by = $2, decided_at = now(), decision_note = $3,
            approved_by = null, approved_at = null, published_at = null, updated_at = now()
      where id = $1`,
    [episode.id, input.actorId, note]
  );
  await recordTransition(db, episode.id, episode.status, 'corrections', input.actorId, note);
  return { episodeId: episode.id, slug: episode.slug, status: 'corrections', revision: null };
}

/**
 * Approve a rendered episode. **THIS IS THE ACT THAT MAKES THE PLAYER APPEAR.**
 *
 * The article page offers audio only for `status = 'published'`, so this transition and nothing else is what a
 * reader sees. An episode with no audio is refused: **an approved episode with no enclosure is an item Spotify
 * rejects and a subscriber sees as unplayable**, and the feed already skips them — better to refuse the
 * approval than to record one that cannot be heard.
 */
export async function publishNarrationEpisode(
  db: Db,
  input: { slug?: string; episodeId?: number; actorId: number; note?: string | null }
): Promise<{ episodeId: number; slug: string; title: string; publishedAt: string }> {
  const episode = requireEpisode(await findNarrationEpisode(db, input), input);
  if (!['pending_review', 'approved'].includes(episode.status)) {
    throw new MemberError('not_awaiting_review', `That episode is “${episode.status}”, not awaiting review.`);
  }
  if (!episode.hasAudio) {
    throw new MemberError('no_audio', 'There is no recording to publish. Render it first.');
  }

  const note = input.note?.trim() || 'Listen approved. The recording and the script go live on the article.';
  const row = await db.one<{ published_at: Date }>(
    `update ozikoro_episode
        set status = 'published', approved_by = $2, approved_at = now(), published_at = now(),
            decided_by = $2, decided_at = now(), decision_note = $3, updated_at = now()
      where id = $1
      returning published_at`,
    [episode.id, input.actorId, note]
  );
  await recordTransition(db, episode.id, episode.status, 'published', input.actorId, note);
  return {
    episodeId: episode.id,
    slug: episode.slug,
    title: episode.title,
    publishedAt: (row?.published_at ?? new Date()).toISOString(),
  };
}

/*
 * ---------------------------------------------------------------------------
 * THE SWEEP
 * ---------------------------------------------------------------------------
 */

export type SweepOutcome = {
  delayMinutes: number;
  maxAgeHours: number;
  since: string;
  limit: number;
  considered: number;
  proposed: { slug: string; episodeId: number; characters: number; estimatedCredits: number }[];
  failed: { slug: string; reason: string }[];
};

/**
 * Propose narration for records that went live a few minutes ago and have no narration yet.
 *
 * THERE IS NO SCHEDULER IN THIS CODEBASE, SO THIS IS A FUNCTION RATHER THAN A TIMER.
 *
 * The ways articles reach `published` were searched for before this was written: `updateArticleFacets` in
 * `packages/ozikoro/src/editorial.ts` sets the status from the editorial form, and the importers set it during
 * migration. **There is no worker, no queue, no `setInterval` and no cron entry anywhere in the repository** —
 * the only recurring mechanism in the tree is the browser's own SRS practice queue, which is a client-side
 * thing and not a job runner.
 *
 * So rather than invent a timer that would only exist while one Node process happened to be alive — **a
 * proposal that stops appearing when the process restarts is worse than one that is visibly scheduled** — the
 * work is expressed as this idempotent function, and it is exposed twice: as `POST /api/podcast/sweep` for a
 * signed-in reviewer pressing "catch up now", and as `node scripts/narration-review.ts sweep` for a real cron.
 * `scripts/check-narration.sh` and the README note state that it must be run on a schedule until a scheduler
 * exists.
 *
 * IDEMPOTENT, THREE WAYS OVER
 *
 *   1. The anti-join selects records with NO episode row, and proposing one creates that row. A second run
 *      therefore finds nothing — **the row IS the record of having asked.**
 *   2. The insert is `on conflict (slug) do update`, so two runs racing over the same record converge instead
 *      of colliding.
 *   3. A declined article keeps its row, so the sweep never re-asks a question a person has answered.
 */
export async function sweepNarrationProposals(
  db: Db,
  opts: {
    actorId?: number | null;
    voice?: NarrationVoice;
    delayMinutes?: number;
    maxAgeHours?: number;
    limit?: number;
    /** An explicit floor, which overrides `maxAgeHours`. This is how a deliberate backfill is asked for. */
    since?: string | null;
    /** Injectable for a test; the database is asked for `now()` otherwise. */
    now?: Date;
  } = {}
): Promise<SweepOutcome> {
  const delayMinutes = opts.delayMinutes ?? narrationDelayMinutes();
  const maxAgeHours = opts.maxAgeHours ?? narrationMaxAgeHours();
  const limit = opts.limit ?? DEFAULT_SWEEP_LIMIT;

  const clock = await db.one<{ now: Date }>(`select now() as now`);
  const now = opts.now ?? (clock?.now ? new Date(clock.now) : new Date());
  const since =
    opts.since ??
    new Date(now.getTime() - maxAgeHours * 60 * 60 * 1000).toISOString();

  /*
   * WHICH TIMESTAMP IS "WENT LIVE".
   *
   * The migrated records carry `published_at` from WordPress, so that is the primary signal. **An article
   * published through the editorial form does not get one** — `updateArticleFacets` moves `status` and touches
   * `updated_at` only — so `updated_at` is tried next, and `created_at` last. Reading `published_at` alone
   * would mean an article published on this site is never proposed for, which is the exact opposite of the
   * requirement.
   */
  const rows = await db.rows<{ id: number; slug: string }>(
    `select a.id, a.slug
       from ozikoro_article a
      where a.status = 'published'
        and a.is_page = false
        and coalesce(a.published_at, a.updated_at, a.created_at) <= $1::timestamptz - make_interval(mins => $2::int)
        and coalesce(a.published_at, a.updated_at, a.created_at) >= $3::timestamptz
        and not exists (select 1 from ozikoro_episode e where e.article_id = a.id)
      order by coalesce(a.published_at, a.updated_at, a.created_at) desc
      limit $4`,
    [now.toISOString(), delayMinutes, since, limit]
  );

  const proposed: SweepOutcome['proposed'] = [];
  const failed: SweepOutcome['failed'] = [];

  for (const row of rows) {
    try {
      const proposal = await proposeNarration(db, {
        slug: row.slug,
        actorId: opts.actorId ?? null,
        ...(opts.voice ? { voice: opts.voice } : {}),
        note: 'Proposed automatically after publication. Nothing has been rendered.',
      });
      proposed.push({
        slug: proposal.slug,
        episodeId: proposal.episodeId,
        characters: proposal.characters,
        estimatedCredits: proposal.estimatedCredits,
      });
    } catch (error) {
      // One bad record must not stop the run — but it is reported rather than swallowed.
      failed.push({ slug: row.slug, reason: String(error instanceof Error ? error.message : error).slice(0, 200) });
    }
  }

  return { delayMinutes, maxAgeHours, since, limit, considered: rows.length, proposed, failed };
}

/*
 * ---------------------------------------------------------------------------
 * THE QUEUE
 * ---------------------------------------------------------------------------
 */

export type NarrationQueueItem = {
  episodeId: number;
  slug: string;
  title: string;
  status: string;
  articleSlug: string;
  characters: number | null;
  estimatedCredits: number | null;
  durationSeconds: number | null;
  voice: NarrationVoice | null;
  hasAudio: boolean;
  storageKey: string | null;
  proposedAt: Date | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  updatedAt: Date | null;
  /** Present only when the caller asked for it. A listing of fifty records does not need fifty scripts. */
  script: string | null;
};

const QUEUE_COLUMNS = `
  e.id as episode_id, e.slug, e.title, e.status, a.slug as article_slug, e.char_count,
  e.estimated_credits, e.duration_seconds, e.voice_choice, e.storage_key,
  e.proposed_at, e.decided_at, e.decision_note, e.updated_at`;

function toQueueItem(row: Record<string, unknown>): NarrationQueueItem {
  const voice = row.voice_choice;
  return {
    episodeId: Number(row.episode_id),
    slug: String(row.slug),
    title: String(row.title),
    status: String(row.status),
    articleSlug: String(row.article_slug),
    characters: row.char_count === null || row.char_count === undefined ? null : Number(row.char_count),
    estimatedCredits:
      row.estimated_credits === null || row.estimated_credits === undefined ? null : Number(row.estimated_credits),
    durationSeconds:
      row.duration_seconds === null || row.duration_seconds === undefined ? null : Number(row.duration_seconds),
    voice: typeof voice === 'string' && isNarrationVoice(voice) ? voice : null,
    hasAudio: Boolean(row.storage_key),
    storageKey: row.storage_key ? String(row.storage_key) : null,
    proposedAt: row.proposed_at ? new Date(row.proposed_at as string) : null,
    decidedAt: row.decided_at ? new Date(row.decided_at as string) : null,
    decisionNote: row.decision_note ? String(row.decision_note) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at as string) : null,
    script: typeof row.script === 'string' ? row.script : null,
  };
}

/**
 * The rows the review screen shows, in the states that need a person.
 *
 * `includeScript` is off by default: **the spoken script is the whole article**, so a listing of fifty records
 * would be a megabyte of text to render a list of titles. The review screen asks for it because a reviewer
 * cannot decide without reading the words; a status summary does not.
 */
export async function listNarrationQueue(
  db: Db,
  opts: { statuses?: string[]; limit?: number; includeScript?: boolean } = {}
): Promise<NarrationQueueItem[]> {
  const statuses = opts.statuses ?? ['proposed', 'pending_review', 'corrections'];
  const rows = await db.rows<Record<string, unknown>>(
    `select ${QUEUE_COLUMNS}${opts.includeScript ? ', e.script' : ''}
       from ozikoro_episode e
       join ozikoro_article a on a.id = e.article_id
      where e.status = any($1::text[])
      order by
        case e.status when 'proposed' then 0 when 'corrections' then 1 else 2 end,
        e.updated_at asc
      limit $2`,
    [statuses, opts.limit ?? 50]
  );
  return rows.map(toQueueItem);
}

/** Every status the episode table holds, with its count — the honest shape of the audio pipeline. */
export async function narrationCounts(db: Db): Promise<{ status: string; count: number }[]> {
  const rows = await db.rows<{ status: string; n: number }>(
    `select status, count(*)::int as n from ozikoro_episode group by status order by status`
  );
  return rows.map((r) => ({ status: r.status, count: Number(r.n) }));
}

/**
 * What the account may still spend, read from ElevenLabs itself.
 *
 * Returns null when the API cannot be asked, and the callers say so rather than guessing — **a remaining
 * allowance invented to fill a screen is a number somebody would make a spending decision on.**
 */
export type NarrationAllowance = {
  tier: string;
  used: number;
  limit: number;
  remaining: number;
  sufficient: (characters: number) => boolean;
};

export function allowanceFrom(sub: { tier: string; used: number; limit: number } | null): NarrationAllowance | null {
  if (!sub) return null;
  const remaining = Math.max(0, sub.limit - sub.used);
  return {
    tier: sub.tier,
    used: sub.used,
    limit: sub.limit,
    remaining,
    sufficient: (characters: number) => sub.limit <= 0 || characters <= remaining,
  };
}
