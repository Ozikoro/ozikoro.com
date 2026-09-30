/**
 * Culture notes, and the cultural material the owner already publishes.
 *
 * TWO DIFFERENT THINGS, KEPT APART
 *
 * §F9 defines a culture note as an AUTHORED record: a title, a body, and — the fields that make it
 * a note rather than an essay — WHO says it, TO WHOM, in what setting, at what register, in which
 * region. `learn_culture_note` has held those columns since migration 0029 and nothing has ever read
 * them, so the table is empty and correctly so: a cultural claim is exactly what §2.1 forbids an AI
 * from writing, and §18 #4's linguist and native reviewers have not been named.
 *
 * Separately, the owner already publishes a great deal of VERIFIED cultural material in the
 * dictionary: 2,889 personal names with their meanings and origins, 228 clans with origin
 * summaries, 995 clan towns, 6 tribes. §11.4 calls the name dictionary "the owner's asset and the
 * first seed data set", and §3 makes this a "language-and-culture platform" rather than a
 * vocabulary trainer.
 *
 * So this module reads both, and never confuses them. A culture note is displayed as a note, with
 * its attribution fields. A name or a clan is displayed as what it is — a dictionary record. Calling
 * the second kind a "note" would attach the platform's editorial voice to material that came from
 * somewhere else, which is the thing §11.4 exists to prevent.
 *
 * WHY THE NAME AND CLAN READERS ARE NOT REIMPLEMENTED
 *
 * `listPersonNames` in `repository.ts` and `listClans` in `clans.ts` already exist, are already
 * used by the dictionary, and already handle folding, filtering and pagination. A second query here
 * would rank differently and eventually disagree — the same reasoning that made the learn lookup
 * share `searchWords`.
 */

import type { Db } from './client.ts';

const IGBO = 'ibo';

export interface CultureNote {
  id: number;
  slug: string;
  title: string;
  body: string;
  /** §F9's structured fields. Null when the author did not record them. */
  whoSaysIt: string | null;
  saidTo: string | null;
  setting: string | null;
  register: string | null;
  region: string | null;
  source: string | null;
  licence: string | null;
}

function rowToNote(row: Record<string, unknown>): CultureNote {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    title: String(row.title),
    body: String(row.body),
    whoSaysIt: (row.who_says_it as string | null) ?? null,
    saidTo: (row.said_to as string | null) ?? null,
    setting: (row.setting as string | null) ?? null,
    register: (row.register as string | null) ?? null,
    region: (row.region as string | null) ?? null,
    source: (row.source as string | null) ?? null,
    licence: (row.licence as string | null) ?? null,
  };
}

/**
 * Published culture notes.
 *
 * `status = 'published'` in SQL rather than filtered afterwards, because §5.3 makes published the
 * only learner-visible state and a filter applied in application code is one refactor away from
 * being forgotten. The same rule the exercise engine and the tutor apply to content.
 */
export async function listCultureNotes(
  db: Db,
  options: { language?: string; limit?: number; offset?: number } = {}
): Promise<{ notes: CultureNote[]; total: number }> {
  const language = options.language ?? IGBO;
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  const [rows, count] = await Promise.all([
    db.rows<Record<string, unknown>>(
      `select id, slug, title, body, who_says_it, said_to, setting, register, region, source, licence
         from learn_culture_note
        where language_code = $1 and status = 'published'
        order by title
        limit $2 offset $3`,
      [language, limit, offset]
    ),
    db.one<{ n: number }>(
      `select count(*)::int as n from learn_culture_note
        where language_code = $1 and status = 'published'`,
      [language]
    ),
  ]);

  return { notes: rows.map(rowToNote), total: Number(count?.n ?? 0) };
}

export async function getCultureNote(db: Db, slug: string): Promise<CultureNote | null> {
  const row = await db.one<Record<string, unknown>>(
    `select id, slug, title, body, who_says_it, said_to, setting, register, region, source, licence
       from learn_culture_note
      where slug = $1 and status = 'published'`,
    [slug]
  );
  return row ? rowToNote(row) : null;
}

/**
 * The notes attached to a lesson, in the order the author placed them.
 *
 * §4 requires "a cultural note on every lesson", and `learn_lesson_culture_note` is the join that
 * carries it with a `position`. The status is checked through the note rather than trusted from the
 * join: a note that was published and later unpublished must stop appearing, and the join row has no
 * status of its own.
 */
export async function cultureNotesForLesson(
  db: Db,
  lessonId: number
): Promise<CultureNote[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select n.id, n.slug, n.title, n.body, n.who_says_it, n.said_to, n.setting, n.register,
            n.region, n.source, n.licence
       from learn_lesson_culture_note j
       join learn_culture_note n on n.id = j.note_id
      where j.lesson_id = $1 and n.status = 'published'
      order by j.position, n.id`,
    [lessonId]
  );
  return rows.map(rowToNote);
}

// ---------------------------------------------------------------------------
// The cultural material the owner already publishes
// ---------------------------------------------------------------------------

export interface CultureOverview {
  /** Authored notes. Zero until a linguist writes them — §18 #4. */
  notes: number;
  /** The verified name dictionary (§11.4's "first seed data set"). */
  names: number;
  clans: number;
}

/**
 * Counts for the culture hub.
 *
 * Delegates to the dictionary's own counters rather than counting rows here, so the number shown on
 * the learning site matches the number the dictionary shows for the same thing. Two counts of the
 * same table that disagree is a bug a reader would blame on the data.
 */
export async function getCultureOverview(db: Db): Promise<CultureOverview> {
  const { countPersonNames } = await import('./repository.ts');

  const [names, clans, notes] = await Promise.all([
    countPersonNames(db, IGBO),
    // Counted directly because `listClans` returns a page and no total of its own for this purpose.
    // Cheap: the table is small and indexed, and it is one count for one page render.
    db.one<{ n: number }>(`select count(*)::int as n from clan`),
    db.one<{ n: number }>(
      `select count(*)::int as n from learn_culture_note where language_code = $1 and status = 'published'`,
      [IGBO]
    ),
  ]);

  return {
    notes: Number(notes?.n ?? 0),
    names: Number(names),
    clans: Number(clans?.n ?? 0),
  };
}

/**
 * A page of the name dictionary, for the learning site.
 *
 * A thin adapter over `listPersonNames`, and deliberately nothing more: the dictionary's reader
 * already folds the query, matches the meaning as well as the name, and paginates. Re-exporting the
 * shape rather than re-querying is what keeps the two surfaces showing the same records in the same
 * order.
 */
export async function listNamesForLearning(
  db: Db,
  params: { query?: string; gender?: 'male' | 'female' | 'unisex'; limit?: number; offset?: number } = {}
): Promise<{ names: { name: string; slug: string; meaning: string | null; gender: string }[]; total: number }> {
  const { listPersonNames } = await import('./repository.ts');
  const result = await listPersonNames(db, {
    language: IGBO,
    query: params.query,
    gender: params.gender,
    limit: params.limit ?? 30,
    offset: params.offset ?? 0,
  });

  return {
    names: result.data.map((entry) => ({
      name: entry.name,
      slug: entry.slug,
      meaning: entry.meaning,
      gender: entry.gender,
    })),
    total: result.total,
  };
}

/** A page of the clan archive, likewise delegated to the dictionary's own reader. */
export async function listClansForLearning(
  db: Db,
  params: { query?: string; limit?: number } = {}
): Promise<{ clans: { name: string; slug: string; kind: string; ethnicGroup: string; region: string | null }[]; total: number }> {
  const { listClans } = await import('./clans.ts');
  const result = await listClans(db, { query: params.query });
  const limit = Math.min(Math.max(params.limit ?? 30, 1), 100);

  return {
    clans: result.data.slice(0, limit).map((clan) => ({
      name: clan.name,
      slug: clan.slug,
      kind: clan.kind,
      ethnicGroup: clan.ethnicGroup,
      region: clan.region,
    })),
    total: result.total,
  };
}
