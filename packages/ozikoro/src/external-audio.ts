/**
 * AUDIO THAT LIVES SOMEWHERE ELSE.
 *
 * THE OWNER'S INSTRUCTION, VERBATIM
 *
 *   "there should be an option to add spotify audio link, instead of my own generated link. all these are
 *    options"
 *
 * THE TWO QUESTIONS THIS MODULE ANSWERS, AND WHY THEY ARE NOT ONE
 *
 *   1. WHERE DOES IT LIVE? `ozikoro_episode.external_url` has carried the address since 0045. What it could
 *      not carry is the SERVICE, and the service is what a reader is told: *"this is on Spotify"* is a
 *      statement about the record, while a bare URL beside a Listen button reads as our own file at somebody
 *      else's address — the one thing the owner's rule forbids.
 *
 *   2. IS IT A FILE? An RSS `<enclosure>` must be a directly playable audio resource. A Spotify episode page
 *      is HTML and is not one, so a feed that points an enclosure at it is a feed a podcast client shows as
 *      unplayable — **and the failure appears in the subscriber's app, not in our logs.** The answer is a
 *      measurement of the URL, taken once when the link is saved and stored on the row, because a feed
 *      request must not make a network call per subscriber.
 *
 * WHY THE VALIDATION IS TWO PARTS
 *
 * `externalAudioShapeProblem` is PURE: scheme, host and service agreement. It is the part that can be tested
 * without a network, and it is where a wrong host is caught. The network check lives in the route, because a
 * route has a `Request` to build an absolute URL from and a timeout to apply — and because a shape rule that
 * needed a socket could not be exercised by a test. **The division is the same one
 * `apps/ozikoro/app/api/admin/design/route.ts` makes for images**: `imageAddressProblem` fetches, and the
 * decision about what a bad answer means is one sentence it returns.
 *
 * A FETCH THAT FAILS IS NOT EVIDENCE THAT THE ADDRESS IS WRONG. `imageAddressProblem` records this and this
 * module keeps it: a timeout, a DNS blip or a service restarting is reported as "could not be checked", and
 * the link is still saved. Refusing on an inability to check would block a correct edit whenever the check
 * itself was unlucky — which is the opposite of what a guard is for.
 */
import type { Db } from '@ozituma/db/client';
import { MemberError } from './members.ts';

/** The services a link may be recorded against. `other` is a real answer, not a failure to answer. */
export const EXTERNAL_AUDIO_SERVICES = ['spotify', 'apple_podcasts', 'youtube', 'other'] as const;
export type ExternalAudioService = (typeof EXTERNAL_AUDIO_SERVICES)[number];

/** What a reader is told, and what the admin form offers. */
export const EXTERNAL_AUDIO_LABELS: Record<ExternalAudioService, string> = {
  spotify: 'Spotify',
  apple_podcasts: 'Apple Podcasts',
  youtube: 'YouTube',
  other: 'another service',
};

/** The hostnames each named service actually serves from. `other` accepts any host. */
const SERVICE_HOSTS: Record<Exclude<ExternalAudioService, 'other'>, string[]> = {
  spotify: ['open.spotify.com', 'spotify.com', 'www.spotify.com', 'spotify.link'],
  apple_podcasts: ['podcasts.apple.com', 'apple.co'],
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com'],
};

export function isExternalAudioService(value: string): value is ExternalAudioService {
  return (EXTERNAL_AUDIO_SERVICES as readonly string[]).includes(value);
}

/** The service a URL's host belongs to, or null when no service claims it. */
export function serviceFromUrl(rawUrl: string): ExternalAudioService | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  for (const service of ['spotify', 'apple_podcasts', 'youtube'] as const) {
    if (SERVICE_HOSTS[service].some((h) => host === h || host.endsWith(`.${h}`))) return service;
  }
  return null;
}

/**
 * Whether the address is acceptable in shape, and says so when it is not.
 *
 * Returns null when there is nothing wrong. The three refusals are each a different mistake:
 *   * not https   — a link a reader is sent to should not be downgradable in transit;
 *   * host/service disagree — the record would name one service and point at another, which is the
 *     "two copies of one fact drift" fault in a single row;
 *   * an unknown service — a caller bypassing the vocabulary.
 */
export function externalAudioShapeProblem(rawUrl: string, service: string): string | null {
  const url = rawUrl.trim();
  if (url.length === 0) return 'An address is required.';
  if (!isExternalAudioService(service)) {
    return `“${service}” is not one of the services this archive records (${EXTERNAL_AUDIO_SERVICES.join(', ')}).`;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'That is not a complete web address. It needs to begin with https:// and name a host.';
  }
  if (parsed.protocol !== 'https:') {
    return 'That address is not https. A link a reader is sent to must not be openable in the clear.';
  }
  if (service === 'other') return null;
  const actual = serviceFromUrl(url);
  if (actual !== service) {
    const hosts = SERVICE_HOSTS[service as Exclude<ExternalAudioService, 'other'>].join(', ');
    return actual === null
      ? `That address is not on ${EXTERNAL_AUDIO_LABELS[service as ExternalAudioService]} (${hosts}). If it is genuinely another service, record it as “another service” instead.`
      : `That address is on ${EXTERNAL_AUDIO_LABELS[actual]}, not ${EXTERNAL_AUDIO_LABELS[service as ExternalAudioService]}.`;
  }
  return null;
}

/**
 * Whether a fetched resource is directly playable audio.
 *
 * A content type rather than a file extension: the extension is a claim in a URL and the content type is what
 * the server says it is serving. `application/ogg` is included because it is audio; `application/octet-stream`
 * is NOT, because it says nothing — and an enclosure whose type says nothing is one a client may refuse.
 */
export function isDirectAudioContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return type.startsWith('audio/') || type === 'application/ogg';
}

/**
 * What the reader is told when the audio is not ours.
 *
 * **It states who is speaking AND that the file is not held here**, because the archive's rule is that the
 * record says what happened. It never says "the words are the article's own": that is a claim this archive
 * can support for a render it made from the article, and cannot support for a recording somebody else
 * published.
 */
export function externalAudioDisclosure(narratorKind: string, service: ExternalAudioService): string {
  const where = `The audio is held on ${EXTERNAL_AUDIO_LABELS[service]} and is not stored by this archive; the link opens there.`;
  if (narratorKind === 'human') return `Read by a person. ${where}`;
  if (narratorKind === 'synthetic_own_voice') {
    return `Generated using AI text-to-speech from a voice cloned from the author’s own recording. ${where}`;
  }
  if (narratorKind === 'synthetic_generic') return `Generated using AI text-to-speech. ${where}`;
  return where;
}

/**
 * WHAT THE FEED DOES WITH THIS EPISODE, decided once and stated.
 *
 * The three outcomes the brief names, chosen between by facts rather than by preference:
 *
 *   `external`  the external URL is itself a directly playable file, so it can be an enclosure — and it is
 *               the host the owner chose, so it wins over our copy;
 *   `ours`      the external address is a page (a Spotify episode link) and an enclosure must be a file, so
 *               the enclosure stays on the copy this archive holds and can promise;
 *   `omitted`   neither — the page is a page and we hold no file, so the episode cannot be in the feed at
 *               all. A podcast item without an enclosure is one Spotify rejects, and a subscriber sees it as
 *               unplayable. **It is left out and the reason is shown on the admin page.**
 */
export type FeedAudioChoice =
  | { kind: 'external'; url: string }
  | { kind: 'ours'; storageKey: string }
  | { kind: 'omitted'; reason: string };

export function feedAudioChoice(row: {
  external_url: string | null;
  external_direct_audio: boolean | null;
  external_service: string | null;
  storage_key: string | null;
}): FeedAudioChoice {
  if (row.external_url && row.external_direct_audio === true) {
    return { kind: 'external', url: row.external_url };
  }
  if (row.storage_key) return { kind: 'ours', storageKey: row.storage_key };
  const service = row.external_service && isExternalAudioService(row.external_service)
    ? EXTERNAL_AUDIO_LABELS[row.external_service]
    : 'an external service';
  return {
    kind: 'omitted',
    reason:
      `The audio is a page on ${service}, not a directly playable file, and this archive holds no copy of ` +
      'it — so there is nothing an RSS enclosure can point at. A podcast item without one is rejected or ' +
      'shown as unplayable, so the episode is not listed.',
  };
}

/*
 * ---------------------------------------------------------------------------
 * THE WRITE
 * ---------------------------------------------------------------------------
 */

export type ExternalAudioRow = {
  id: number;
  slug: string;
  title: string;
  status: string;
  storage_key: string | null;
  external_url: string | null;
  external_service: string | null;
  external_direct_audio: boolean | null;
  external_checked_at: Date | null;
  external_check_note: string | null;
  narrator_kind: string;
  narrator_name: string | null;
};

export interface SetExternalAudioInput {
  slug: string;
  url: string;
  service: ExternalAudioService;
  /** Stated by the person, never defaulted: the record says who is speaking because somebody said so. */
  narratorKind: 'human' | 'synthetic_own_voice' | 'synthetic_generic';
  narratorName?: string | null;
  /** What the fetch of the URL established. `false` and `null` are different facts. */
  directAudio: boolean;
  /** The content type the fetch returned, recorded on the row when the external file is the enclosure. */
  mimeType?: string | null;
  checkNote: string;
  actorId: number;
  note?: string | null;
}

/**
 * Record that an episode's audio lives elsewhere, and publish it.
 *
 * WHY THIS ACT PUBLISHES
 *
 * The owner's rule is that an unapproved episode shows no audio. Attaching an external link is a deliberate,
 * capability-gated, audited act by a person — and it spends nothing, so there is no charge for the approval
 * to be a gate on. **The act IS the approval**, and recording `approved_by`/`approved_at` here is what makes
 * that a fact on the row rather than an inference from the status.
 *
 * THE RENDER'S OWN RECORD IS NOT OVERWRITTEN. If the row already holds a file this archive rendered,
 * `storage_key`, `generator`, `voice_settings` and the revision history are left exactly as they were: the
 * page will use the external link, and the feed will use our copy when the external address is a page. A
 * later edit to where the audio is presented must not erase what produced the audio this archive paid for.
 */
export async function setEpisodeExternalAudio(
  db: Db,
  input: SetExternalAudioInput
): Promise<{ episodeId: number; slug: string; status: string; before: ExternalAudioRow; after: ExternalAudioRow }> {
  const shape = externalAudioShapeProblem(input.url, input.service);
  if (shape) throw new MemberError('bad_external_url', shape);

  const before = await db.one<ExternalAudioRow>(
    `select id, slug, title, status, storage_key, external_url, external_service, external_direct_audio,
            external_checked_at, external_check_note, narrator_kind, narrator_name
       from ozikoro_episode where slug = $1`,
    [input.slug]
  );
  if (!before) throw new MemberError('no_episode', `No episode has the slug “${input.slug}”.`);

  const disclosure = externalAudioDisclosure(input.narratorKind, input.service);
  const url = input.url.trim();
  /*
   * THE MIME TYPE FOLLOWS THE ENCLOSURE, NOT THE ROW.
   *
   * `feedAudioChoice` gives a directly playable external URL to the enclosure, so the row's `mime_type` — which
   * the feed prints as `type=` — has to describe THAT file. `coalesce` leaves the column alone when the check
   * established no content type, which is the honest state: an unknown type is not a reason to overwrite the
   * one our own render recorded.
   */
  const mimeType = input.directAudio ? (input.mimeType ?? null) : null;

  await db.query(
    `update ozikoro_episode
        set external_url = $2, external_service = $3, external_direct_audio = $4,
            external_checked_at = now(), external_check_note = $5,
            narrator_kind = $6, narrator_name = $7, ai_disclosure = $8,
            status = 'published', approved_by = $9, approved_at = now(), published_at = now(),
            decided_by = $9, decided_at = now(),
            generator = case when storage_key is null then 'external' else generator end,
            generator_model = case when storage_key is null then null else generator_model end,
            mime_type = coalesce($10, mime_type),
            updated_at = now()
      where id = $1`,
    [
      before.id, url, input.service, input.directAudio, input.checkNote,
      input.narratorKind, input.narratorName?.trim() || null, disclosure, input.actorId,
      mimeType,
    ]
  );

  const after = await db.one<ExternalAudioRow>(
    `select id, slug, title, status, storage_key, external_url, external_service, external_direct_audio,
            external_checked_at, external_check_note, narrator_kind, narrator_name
       from ozikoro_episode where id = $1`,
    [before.id]
  );

  /*
   * THE SPEND FACT IS NEVER REPLACED BY A CUSTOM NOTE.
   *
   * The operator's own words go in front of it, and the sentence that says no credit was spent is always
   * there. **The owner asked for the approval gate on the grounds of cost**, so a decision row that leaves the
   * cost unstated is the one fact the review of it most needs — and a custom note is exactly the case where it
   * would otherwise be dropped.
   */
  const spend = 'Nothing was rendered and no credit was spent.';
  const note =
    (input.note?.trim() ? `${input.note.trim()} ` : '') +
    `Audio recorded as held on ${EXTERNAL_AUDIO_LABELS[input.service]}. ${spend} ${input.checkNote}`;

  await db.query(
    `insert into ozikoro_episode_transition (episode_id, from_status, to_status, actor_account_id, note)
     values ($1,$2,'published',$3,$4)`,
    [before.id, before.status, input.actorId, note]
  );

  await audit(db, {
    episodeId: before.id,
    action: 'set_external_audio',
    actorId: input.actorId,
    before: {
      status: before.status,
      external_url: before.external_url,
      external_service: before.external_service,
      external_direct_audio: before.external_direct_audio,
      narrator_kind: before.narrator_kind,
    },
    after: {
      status: 'published',
      external_url: url,
      external_service: input.service,
      external_direct_audio: input.directAudio,
      narrator_kind: input.narratorKind,
    },
    note,
  });

  return { episodeId: before.id, slug: before.slug, status: 'published', before, after: after ?? before };
}

/**
 * Take the external link off an episode.
 *
 * IF THIS ARCHIVE HOLDS NO FILE OF ITS OWN, THE EPISODE STOPS BEING PUBLISHED. Leaving it `published` would
 * be a row that says a record is live and carries no audio at all — the state the article, the feed and the
 * transcript all filter out, so the record would be live and silent. `withdrawn` says what happened.
 */
export async function clearEpisodeExternalAudio(
  db: Db,
  input: { slug: string; actorId: number; note?: string | null }
): Promise<{ episodeId: number; slug: string; status: string }> {
  const before = await db.one<ExternalAudioRow>(
    `select id, slug, title, status, storage_key, external_url, external_service, external_direct_audio,
            external_checked_at, external_check_note, narrator_kind, narrator_name
       from ozikoro_episode where slug = $1`,
    [input.slug]
  );
  if (!before) throw new MemberError('no_episode', `No episode has the slug “${input.slug}”.`);

  const nextStatus = before.storage_key ? 'published' : 'withdrawn';
  await db.query(
    `update ozikoro_episode
        set external_url = null, external_service = null, external_direct_audio = null,
            external_checked_at = now(), external_check_note = null,
            status = $2,
            approved_by = case when $2 = 'published' then approved_by else null end,
            approved_at = case when $2 = 'published' then approved_at else null end,
            published_at = case when $2 = 'published' then published_at else null end,
            updated_at = now()
      where id = $1`,
    [before.id, nextStatus]
  );

  /*
   * The operator's words go in front of the fact, not instead of it: **whether the record is still live is
   * what a reader of this row needs**, and a custom note is exactly the case where it would otherwise be lost.
   */
  const consequence = before.storage_key
    ? 'The external audio link was removed. The copy this archive holds is what the page now offers.'
    : 'The external audio link was removed and no copy is held here, so the episode is withdrawn rather than left published and silent.';
  const note = (input.note?.trim() ? `${input.note.trim()} ` : '') + consequence;

  await db.query(
    `insert into ozikoro_episode_transition (episode_id, from_status, to_status, actor_account_id, note)
     values ($1,$2,$3,$4,$5)`,
    [before.id, before.status, nextStatus, input.actorId, note]
  );

  await audit(db, {
    episodeId: before.id,
    action: 'clear_external_audio',
    actorId: input.actorId,
    before: { external_url: before.external_url, external_service: before.external_service, status: before.status },
    after: { external_url: null, external_service: null, status: nextStatus },
    note,
  });

  return { episodeId: before.id, slug: before.slug, status: nextStatus };
}

/**
 * Recording history must never be the reason a change fails — the rule every write path in this repository
 * follows (see `design-override-store.ts`). The change has already been made by the time this runs.
 */
async function audit(
  db: Db,
  event: {
    episodeId: number;
    action: string;
    before?: unknown;
    after?: unknown;
    actorId: number | null;
    note?: string | null;
  }
): Promise<void> {
  try {
    await db.query(
      `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
       values ('ozikoro_episode', $1, $2, $3::jsonb, $4::jsonb, $5, $6)`,
      [
        event.episodeId,
        event.action,
        event.before === undefined ? null : JSON.stringify(event.before),
        event.after === undefined ? null : JSON.stringify(event.after),
        event.actorId,
        event.note ?? null,
      ]
    );
  } catch (error) {
    console.error('[ozikoro/external-audio] could not record audit event:', String(error).slice(0, 160));
  }
}

/*
 * ---------------------------------------------------------------------------
 * THE ADMIN LISTING
 * ---------------------------------------------------------------------------
 */

export type EpisodeAudioSetting = {
  episodeId: number;
  slug: string;
  articleSlug: string;
  title: string;
  status: string;
  storageKey: string | null;
  externalUrl: string | null;
  externalService: ExternalAudioService | null;
  externalDirectAudio: boolean | null;
  externalCheckedAt: Date | null;
  externalCheckNote: string | null;
  narratorKind: string;
  narratorName: string | null;
  aiDisclosure: string;
  /** What the feed does with it, so the page can say rather than leave a reader to infer. */
  feed: FeedAudioChoice;
};

/** Every episode, with where its audio lives — the surface the owner sets a Spotify link from. */
export async function listEpisodeAudioSettings(db: Db, limit = 200): Promise<EpisodeAudioSetting[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select e.id, e.slug, e.title, e.status, e.storage_key, e.external_url, e.external_service,
            e.external_direct_audio, e.external_checked_at, e.external_check_note,
            e.narrator_kind, e.narrator_name, e.ai_disclosure, a.slug as article_slug
       from ozikoro_episode e
       join ozikoro_article a on a.id = e.article_id
      order by e.updated_at desc
      limit $1`,
    [limit]
  );
  return rows.map((r) => {
    const service = typeof r.external_service === 'string' && isExternalAudioService(r.external_service)
      ? r.external_service
      : null;
    const shape = {
      external_url: (r.external_url as string | null) ?? null,
      external_direct_audio: (r.external_direct_audio as boolean | null) ?? null,
      external_service: service,
      storage_key: (r.storage_key as string | null) ?? null,
    };
    return {
      episodeId: Number(r.id),
      slug: String(r.slug),
      articleSlug: String(r.article_slug),
      title: String(r.title),
      status: String(r.status),
      storageKey: shape.storage_key,
      externalUrl: shape.external_url,
      externalService: service,
      externalDirectAudio: shape.external_direct_audio,
      externalCheckedAt: r.external_checked_at ? new Date(r.external_checked_at as string) : null,
      externalCheckNote: r.external_check_note ? String(r.external_check_note) : null,
      narratorKind: String(r.narrator_kind),
      narratorName: r.narrator_name ? String(r.narrator_name) : null,
      aiDisclosure: String(r.ai_disclosure),
      feed: feedAudioChoice(shape),
    };
  });
}
