/**
 * The numbers behind the two dashboards: a contributor's own record, and the
 * state of the dictionary.
 *
 * Kept here rather than in the pages because both are read the same way a
 * repository function is — one round of queries, plain rows, no formatting — and
 * because a dashboard that counts things is exactly the kind of code that
 * quietly drifts from the schema if its SQL lives in a component.
 *
 * WHAT THESE NUMBERS ARE, AND ARE NOT
 *
 * They are counts from the live tables, so they move as the dictionary moves.
 * Nothing here is cached and nothing is estimated: a dashboard that says "about
 * 12,000 words" is worse than one that says 12,301, because the first number
 * cannot be checked. Where a figure is not knowable — how many people speak the
 * language, say — this file does not invent one.
 */
import type { Db } from './client.ts';
import { getQueueStats, listSuggestions, type QueueStats, type SuggestionRecord } from './contributions.ts';

/** A contributor's own record: what they have sent, and what became of it. */
export interface AccountDashboard {
  contributions: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    merged: number;
    recent: SuggestionRecord[];
  };
  recordings: {
    total: number;
    published: number;
    pending: number;
    rejected: number;
    /** Clips other people have approved, minus the ones they denied. */
    approvals: number;
    denials: number;
    recent: { id: number; wordHeadword: string | null; status: string; createdAt: string }[];
  };
  sessions: number;
  /** Their own review history, which only exists once they are trusted to review. */
  reviewed: number;
}

export async function accountDashboard(db: Db, accountId: number): Promise<AccountDashboard> {
  const contributions = await db.one<Record<string, unknown>>(
    `select count(*)::int as total,
            count(*) filter (where status = 'pending')::int  as pending,
            count(*) filter (where status = 'approved')::int as approved,
            count(*) filter (where status = 'rejected')::int as rejected,
            count(*) filter (where status = 'merged')::int   as merged
       from suggestion where submitted_by = $1`,
    [accountId]
  );

  const recordings = await db.one<Record<string, unknown>>(
    `select count(*)::int as total,
            count(*) filter (where a.status = 'published')::int      as published,
            count(*) filter (where a.status = 'pending_review')::int as pending,
            count(*) filter (where a.status = 'rejected')::int       as rejected,
            coalesce(sum(a.approvals), 0)::int                       as approvals,
            coalesce(sum(a.denials), 0)::int                         as denials
       from audio a where a.contributor_account_id = $1`,
    [accountId]
  );

  const recentRecordings = await db.rows<Record<string, unknown>>(
    `select a.id, a.status, a.created_at, w.headword
       from audio a
       left join word w on w.id = a.word_id
      where a.contributor_account_id = $1
      order by a.created_at desc
      limit 8`,
    [accountId]
  );

  const [recent, sessions, reviewed] = await Promise.all([
    listSuggestions(db, { submittedBy: accountId, limit: 10 }),
    db.one<{ n: number }>(
      `select count(*)::int as n from auth_session
        where account_id = $1 and revoked_at is null and expires_at > now()`,
      [accountId]
    ),
    db.one<{ n: number }>(
      `select count(*)::int as n from suggestion where reviewed_by = $1`,
      [accountId]
    ),
  ]);

  return {
    contributions: {
      total: Number(contributions?.total ?? 0),
      pending: Number(contributions?.pending ?? 0),
      approved: Number(contributions?.approved ?? 0),
      rejected: Number(contributions?.rejected ?? 0),
      merged: Number(contributions?.merged ?? 0),
      recent: recent.data,
    },
    recordings: {
      total: Number(recordings?.total ?? 0),
      published: Number(recordings?.published ?? 0),
      pending: Number(recordings?.pending ?? 0),
      rejected: Number(recordings?.rejected ?? 0),
      approvals: Number(recordings?.approvals ?? 0),
      denials: Number(recordings?.denials ?? 0),
      recent: recentRecordings.map((row) => ({
        id: Number(row.id),
        wordHeadword: (row.headword as string | null) ?? null,
        status: String(row.status),
        createdAt: new Date(String(row.created_at)).toISOString(),
      })),
    },
    sessions: Number(sessions?.n ?? 0),
    reviewed: Number(reviewed?.n ?? 0),
  };
}

/** A count per language, so the admin page can show where the work is. */
export interface LanguageCounts {
  code: string;
  name: string;
  words: number;
  published: number;
  names: number;
  proverbs: number;
  recordings: number;
}

export interface AdminDashboard {
  dictionary: {
    words: number;
    publishedWords: number;
    draftWords: number;
    definitions: number;
    names: number;
    proverbs: number;
    translatedProverbs: number;
    themelessProverbs: number;
    dialects: number;
    relations: number;
  };
  audio: {
    total: number;
    published: number;
    pending: number;
    rejected: number;
    dialect: number;
    sentences: number;
  };
  accounts: {
    total: number;
    contributors: number;
    editors: number;
    admins: number;
    suspended: number;
    signedInLast30: number;
    recent: { id: number; email: string; displayName: string | null; role: string; createdAt: string }[];
  };
  queue: QueueStats;
  donations: {
    count: number;
    succeeded: number;
    totalMinor: number;
    currency: string;
    last30Minor: number;
    recent: { reference: string; email: string; amountMinor: number; status: string; createdAt: string }[];
  };
  languages: LanguageCounts[];
  recentSuggestions: SuggestionRecord[];
}

export async function adminDashboard(db: Db): Promise<AdminDashboard> {
  const dictionary = await db.one<Record<string, unknown>>(
    `select
       (select count(*) from word)::int                                      as words,
       (select count(*) from word where status = 'published')::int           as published_words,
       (select count(*) from word where status = 'draft')::int               as draft_words,
       (select count(*) from definition)::int                                as definitions,
       (select count(*) from person_name)::int                               as names,
       (select count(*) from example
         where style = 'proverb' and status = 'published')::int              as proverbs,
       (select count(*) from example
         where style = 'proverb' and status = 'published'
           and translation is not null)::int                                 as translated_proverbs,
       (select count(*) from example
         where style = 'proverb' and status = 'published'
           and theme is null)::int                                           as themeless_proverbs,
       (select count(*) from dialect)::int                                   as dialects,
       (select count(*) from word_relation)::int                             as relations`
  );

  const audio = await db.one<Record<string, unknown>>(
    `select count(*)::int                                                as total,
            count(*) filter (where status = 'published')::int            as published,
            count(*) filter (where status = 'pending_review')::int       as pending,
            count(*) filter (where status = 'rejected')::int             as rejected,
            count(*) filter (where word_dialect_id is not null)::int     as dialect,
            count(*) filter (where example_id is not null)::int          as sentences
       from audio`
  );

  const accounts = await db.one<Record<string, unknown>>(
    `select count(*)::int                                          as total,
            count(*) filter (where role = 'contributor')::int      as contributors,
            count(*) filter (where role = 'editor')::int           as editors,
            count(*) filter (where role in ('admin', 'owner'))::int as admins,
            count(*) filter (where status = 'suspended')::int      as suspended,
            count(*) filter (where last_login_at > now() - interval '30 days')::int as signed_in_30
       from account`
  );

  const donations = await db.one<Record<string, unknown>>(
    `select count(*)::int                                            as count,
            count(*) filter (where status = 'success')::int          as succeeded,
            coalesce(sum(amount_minor) filter (where status = 'success'), 0)::bigint as total_minor,
            coalesce(sum(amount_minor) filter (
              where status = 'success' and created_at > now() - interval '30 days'
            ), 0)::bigint                                            as last30_minor,
            coalesce(max(currency), 'NGN')                           as currency
       from donation`
  );

  const [languageRows, recentAccounts, recentDonations, recentSuggestions, queue] =
    await Promise.all([
      db.rows<Record<string, unknown>>(
        `select l.code, l.name,
                (select count(*) from word w where w.language_code = l.code)::int as words,
                (select count(*) from word w where w.language_code = l.code
                   and w.status = 'published')::int as published,
                (select count(*) from person_name p where p.language_code = l.code)::int as names,
                (select count(*) from example e where e.language_code = l.code
                   and e.style = 'proverb' and e.status = 'published')::int as proverbs,
                (select count(*) from audio a where a.language_code = l.code)::int as recordings
           from language l
          order by words desc, l.name`
      ),
      db.rows<Record<string, unknown>>(
        `select id, email, display_name, role::text as role, created_at
           from account order by created_at desc limit 8`
      ),
      db.rows<Record<string, unknown>>(
        `select reference, email, amount_minor, status, created_at
           from donation order by created_at desc limit 8`
      ),
      listSuggestions(db, { limit: 8 }),
      getQueueStats(db),
    ]);

  return {
    dictionary: {
      words: Number(dictionary?.words ?? 0),
      publishedWords: Number(dictionary?.published_words ?? 0),
      draftWords: Number(dictionary?.draft_words ?? 0),
      definitions: Number(dictionary?.definitions ?? 0),
      names: Number(dictionary?.names ?? 0),
      proverbs: Number(dictionary?.proverbs ?? 0),
      translatedProverbs: Number(dictionary?.translated_proverbs ?? 0),
      themelessProverbs: Number(dictionary?.themeless_proverbs ?? 0),
      dialects: Number(dictionary?.dialects ?? 0),
      relations: Number(dictionary?.relations ?? 0),
    },
    audio: {
      total: Number(audio?.total ?? 0),
      published: Number(audio?.published ?? 0),
      pending: Number(audio?.pending ?? 0),
      rejected: Number(audio?.rejected ?? 0),
      dialect: Number(audio?.dialect ?? 0),
      sentences: Number(audio?.sentences ?? 0),
    },
    accounts: {
      total: Number(accounts?.total ?? 0),
      contributors: Number(accounts?.contributors ?? 0),
      editors: Number(accounts?.editors ?? 0),
      admins: Number(accounts?.admins ?? 0),
      suspended: Number(accounts?.suspended ?? 0),
      signedInLast30: Number(accounts?.signed_in_30 ?? 0),
      recent: recentAccounts.map((row) => ({
        id: Number(row.id),
        email: String(row.email),
        displayName: (row.display_name as string | null) ?? null,
        role: String(row.role),
        createdAt: new Date(String(row.created_at)).toISOString(),
      })),
    },
    queue,
    donations: {
      count: Number(donations?.count ?? 0),
      succeeded: Number(donations?.succeeded ?? 0),
      totalMinor: Number(donations?.total_minor ?? 0),
      currency: String(donations?.currency ?? 'NGN'),
      last30Minor: Number(donations?.last30_minor ?? 0),
      recent: recentDonations.map((row) => ({
        reference: String(row.reference),
        email: String(row.email),
        amountMinor: Number(row.amount_minor),
        status: String(row.status),
        createdAt: new Date(String(row.created_at)).toISOString(),
      })),
    },
    languages: languageRows.map((row) => ({
      code: String(row.code),
      name: String(row.name),
      words: Number(row.words),
      published: Number(row.published),
      names: Number(row.names),
      proverbs: Number(row.proverbs),
      recordings: Number(row.recordings),
    })),
    recentSuggestions: recentSuggestions.data,
  };
}
