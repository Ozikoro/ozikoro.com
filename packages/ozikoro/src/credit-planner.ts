/**
 * THE CREDIT PLANNER: what the plan buys, and what one record costs before it is spent.
 *
 * THE OWNER'S REQUIREMENT
 *
 *   "the ones we will be getting from elevenlabs is going to be calculated according to our plans, how many
 *    credits it is in a month, and how many audiobook/record we can use it to produce in a month."
 *
 * and the reason the second half matters more than the first:
 *
 *   "the owner must see the cost before spending it."
 *
 * ---------------------------------------------------------------------------
 * THE ARITHMETIC THAT EXISTED, AND WHAT IS WRONG WITH IT
 * ---------------------------------------------------------------------------
 *
 * The figure in circulation was: *1,051 articles at roughly 9,000 characters each is about 9,500,000
 * characters; the Starter plan allows 65,000 a month, which is about seven articles a month and roughly
 * twelve years for the archive.*
 *
 * **The conclusion is right and the character count it rests on is wrong, in the direction that makes the
 * plan look worse than it is.** Measured on the live cluster: the 1,057 published records hold **9,941,768
 * characters of `body_html`** — and `body_html` is HTML. It contains `<p class="…">`, `<figure>`, anchors,
 * entities and attributes, **none of which is sent to the API and none of which is billed.** What is billed
 * is the SPOKEN SCRIPT, which `toSpokenScript` produces by removing markup, captions and citation brackets
 * and changing no words.
 *
 * So this module counts the script, for a real article, and never `length(body_html)`. The difference is
 * measured below rather than asserted, and it is large enough to change the number of articles a month.
 *
 * ---------------------------------------------------------------------------
 * THE ESTIMATE AND THE MEASUREMENT
 * ---------------------------------------------------------------------------
 *
 * `CREDITS_PER_CHARACTER = 1` in `narration.ts` is an ESTIMATE and is labelled as one there. The authority
 * is the API's own `character_count`, read before and after a render. `renderProposedNarration` has always
 * made that measurement and written it into a transition NOTE — a sentence, which nothing can sum.
 * Migration 0050 adds the columns that make it data.
 *
 * **This module reports the reconciliation honestly, including when there is nothing to reconcile.**
 * `reconcileCharges` returns `verified: false` when no render has ever been measured, and says so in words,
 * because "1 credit per character, confirmed" and "1 credit per character, never once checked" are very
 * different claims and only one of them is currently true.
 */
import type { Db } from '@ozituma/db/client';
import { toSpokenScript } from './spoken.ts';
import { countNarrationWords, estimateNarrationCredits, estimateNarrationSeconds } from './narration.ts';

/** The subscription as the ElevenLabs endpoint reports it. Passed in, because the API client lives in the app. */
export type PlanSubscription = { tier: string; used: number; limit: number } | null;

export type PlanReport = {
  /** The plan itself, or the reason it cannot be read. */
  plan:
    | { known: true; tier: string; monthlyCharacters: number; used: number; remaining: number; resetsAt: string | null }
    | { known: false; reason: string };
  /** What the archive holds, counted from the records rather than quoted. */
  archive: { articles: number; characters: number; averageCharacters: number; htmlCharacters: number };
  /** WHAT THE ALLOWANCE BUYS — the owner's question, answered. */
  buys: {
    /** Articles of average length the whole monthly allowance pays for. */
    articlesPerMonth: number;
    /** How much of the archive one month narrates. */
    monthsForArchive: number | null;
    /** The whole archive in credits at the estimate. */
    archiveCredits: number;
    /** Hours of audio the allowance buys, at the pace the renderer uses. */
    hoursPerMonth: number;
  };
  /** The rate the estimate uses, and whether it has ever been checked. */
  rate: { creditsPerCharacter: number; verified: boolean; note: string; measuredRenders: number; measuredRatio: number | null };
};

/**
 * The archive's own size, in BILLABLE characters.
 *
 * The spoken script is produced for every published record once and reused, because `toSpokenScript` is not
 * free and the archive is a thousand records. The HTML figure is carried alongside it **so the difference
 * between the two is visible on the page** — it is the correction this module exists to make, and a reader
 * who has seen "9,500,000" should be able to see why the number moved.
 */
export async function archiveSize(
  db: Db
): Promise<{ articles: number; characters: number; averageCharacters: number; htmlCharacters: number; words: number; seconds: number }> {
  const rows = await db.rows<{ body_html: string | null; html_length: number }>(
    `select body_html, coalesce(length(body_html), 0)::int as html_length
       from ozikoro_article
      where status = 'published' and is_page = false`
  );

  let characters = 0;
  let htmlCharacters = 0;
  let words = 0;
  let seconds = 0;
  for (const row of rows) {
    const { script } = toSpokenScript(row.body_html ?? '');
    characters += script.length;
    words += countNarrationWords(script);
    // The renderer's own duration estimate, accumulated over the real archive. **This is how the planner
    // converts characters into hours without restating "145 words a minute"** — that figure lives in
    // `estimateNarrationSeconds` and a second copy of it here would be a second thing to keep true.
    seconds += estimateNarrationSeconds(script);
    htmlCharacters += Number(row.html_length ?? 0);
  }

  return {
    articles: rows.length,
    characters,
    averageCharacters: rows.length === 0 ? 0 : Math.round(characters / rows.length),
    htmlCharacters,
    words,
    seconds,
  };
}

/**
 * The whole owner-facing report.
 *
 * `subscription` is passed in rather than fetched: the ElevenLabs client lives in `apps/ozikoro/lib`, and
 * `@ozikoro/platform` must not import from an app — the dependency direction is one way and the package
 * header says so. The app reads the API and hands the numbers here, which also means the arithmetic can be
 * tested against a plan that does not exist on this account.
 */
export async function planCredits(
  db: Db,
  subscription: PlanSubscription,
  options: { resetsAt?: string | null } = {}
): Promise<PlanReport> {
  const archive = await archiveSize(db);
  const creditsPerCharacter = 1;

  const plan = subscription
    ? {
        known: true as const,
        tier: subscription.tier,
        monthlyCharacters: subscription.limit,
        used: subscription.used,
        remaining: Math.max(0, subscription.limit - subscription.used),
        resetsAt: options.resetsAt ?? null,
      }
    : {
        known: false as const,
        reason:
          'The ElevenLabs subscription could not be read. Either no API key is configured on this ' +
          'deployment, or the API refused the request — so the plan, the allowance and everything below it ' +
          'are unknown rather than zero.',
      };

  const rate = await reconcileCharges(db);

  // The allowance buys articles of AVERAGE length. An average is the honest unit here: the owner asked
  // "how many audiobook/record we can use it to produce in a month", and a page cannot answer that with a
  // distribution. The per-article list below is where a specific record's real length is used.
  const perArticle = archive.averageCharacters;
  const monthly = plan.known ? plan.monthlyCharacters : 0;
  const articlesPerMonth = perArticle > 0 && monthly > 0 ? Math.floor(monthly / perArticle) : 0;
  // Seconds of speech per character, measured over the real archive by the renderer's own duration
  // function — not a second assumption about reading pace.
  const secondsPerCharacter = archive.characters > 0 ? archive.seconds / archive.characters : 0;

  return {
    plan,
    archive: {
      articles: archive.articles,
      characters: archive.characters,
      averageCharacters: archive.averageCharacters,
      htmlCharacters: archive.htmlCharacters,
    },
    buys: {
      articlesPerMonth,
      monthsForArchive:
        articlesPerMonth > 0 && archive.articles > 0 ? Number((archive.articles / articlesPerMonth).toFixed(1)) : null,
      archiveCredits: estimateNarrationCredits(archive.characters),
      hoursPerMonth: Number(((monthly * secondsPerCharacter) / 3600).toFixed(1)),
    },
    rate: {
      creditsPerCharacter: rate.creditsPerCharacter,
      verified: rate.verified,
      note: rate.note,
      measuredRenders: rate.measuredRenders,
      measuredRatio: rate.measuredRatio,
    },
  };
}

export type ArticleCost = {
  slug: string;
  title: string;
  /** The BILLABLE characters — the spoken script, not the HTML. */
  characters: number;
  /** The HTML length, so the difference is visible rather than described. */
  htmlCharacters: number;
  credits: number;
  estimatedSeconds: number;
  words: number;
  /** Whether the episode for this record already has a proposal, and in what state. */
  episode: { status: string; charCount: number | null; estimatedCredits: number | null; measuredCredits: number | null } | null;
};

/**
 * What ONE record would cost, before it is rendered. **This is the whole point of the planner.**
 *
 * The figure comes from `toSpokenScript` on the record's own body — the exact transform the renderer will
 * apply — so the number is not an estimate of a length, it is the length. What remains an estimate is the
 * credits, and that is the rate's business, not this function's.
 */
export async function articleCost(db: Db, slug: string): Promise<ArticleCost | null> {
  const row = await db.one<{ id: number; slug: string; title: string; body_html: string | null; html_length: number }>(
    `select id, slug, title, body_html, coalesce(length(body_html), 0)::int as html_length
       from ozikoro_article
      where slug = $1 and status = 'published' and is_page = false`,
    [slug]
  );
  if (!row) return null;

  const { script } = toSpokenScript(row.body_html ?? '');
  const characters = script.length;

  const episode = await db.one<{
    status: string; char_count: number | null; estimated_credits: number | null; measured_credits: number | null;
  }>(
    `select status, char_count, estimated_credits, measured_credits
       from ozikoro_episode where article_id = $1 order by id desc limit 1`,
    [row.id]
  );

  return {
    slug: row.slug,
    title: row.title,
    characters,
    htmlCharacters: Number(row.html_length ?? 0),
    credits: estimateNarrationCredits(characters),
    estimatedSeconds: estimateNarrationSeconds(script),
    words: countNarrationWords(script),
    episode: episode
      ? {
          status: episode.status,
          charCount: episode.char_count,
          estimatedCredits: episode.estimated_credits,
          measuredCredits: episode.measured_credits,
        }
      : null,
  };
}

export type FitRow = ArticleCost & { fits: boolean; shortfall: number };

/**
 * WHICH RECORDS FIT IN WHAT IS LEFT.
 *
 * The owner asked for "how many audiobook/record we can use it to produce in a month" and for a specific
 * list, the more useful question is which of THESE records the remaining allowance pays for. So each one is
 * costed and tested against the remaining characters, **and the ones that do not fit say by how much** — a
 * bare "no" would not tell an editor whether to shorten the script or wait for the month to turn over.
 */
export async function whichFit(
  db: Db,
  slugs: string[],
  remainingCharacters: number
): Promise<{ rows: FitRow[]; fitting: number; totalCredits: number; affordableCredits: number }> {
  const rows: FitRow[] = [];
  for (const slug of slugs) {
    const cost = await articleCost(db, slug);
    if (!cost) continue;
    const shortfall = Math.max(0, cost.characters - remainingCharacters);
    rows.push({ ...cost, fits: cost.characters <= remainingCharacters, shortfall });
  }
  const fitting = rows.filter((r) => r.fits).length;
  return {
    rows: rows.sort((a, b) => a.characters - b.characters),
    fitting,
    totalCredits: rows.reduce((sum, r) => sum + r.credits, 0),
    // What the SAME LIST would cost if the allowance were not a constraint — the number an owner needs when
    // deciding whether to raise the plan for a batch.
    affordableCredits: rows.filter((r) => r.fits).reduce((sum, r) => sum + r.credits, 0),
  };
}

export type Reconciliation = {
  /** The rate the estimate uses. */
  creditsPerCharacter: number;
  /** True only when a real render was measured. */
  verified: boolean;
  /** Measured ÷ estimated across every render that was measured. Null when none was. */
  measuredRatio: number | null;
  measuredRenders: number;
  totalEstimated: number;
  totalMeasured: number;
  renders: {
    episodeId: number; slug: string; title: string; status: string;
    characters: number; estimated: number; measured: number | null;
    usedBefore: number | null; usedAfter: number | null; measuredAt: string | null;
  }[];
  note: string;
};

/**
 * RECONCILE THE ESTIMATE AGAINST WHAT WAS ACTUALLY CHARGED.
 *
 * The rate is `CREDITS_PER_CHARACTER = 1` and it has never been checked against a real charge. This function
 * is how it stops being a guess: it reads every episode whose charge was measured, compares the estimate with
 * the measurement, and returns the ratio.
 *
 * **It refuses to claim verification it does not have.** With zero measured renders it returns
 * `verified: false` and a sentence saying so, rather than a ratio of 1 computed from nothing — which would
 * read as "confirmed" and would be a fabrication of exactly the kind this project has had to correct before.
 */
export async function reconcileCharges(db: Db): Promise<Reconciliation> {
  const rows = await db.rows<Record<string, unknown>>(
    `select id, slug, title, status, char_count, estimated_credits, measured_credits,
            measured_used_before, measured_used_after, measured_at,
            coalesce(char_count, length(script)) as characters
       from ozikoro_episode
      order by (measured_credits is null), id desc`
  );

  const renders = rows.map((row) => ({
    episodeId: Number(row.id),
    slug: String(row.slug),
    title: String(row.title),
    status: String(row.status),
    characters: Number(row.characters ?? 0),
    estimated: Number(row.estimated_credits ?? 0),
    measured: row.measured_credits === null ? null : Number(row.measured_credits),
    usedBefore: row.measured_used_before === null ? null : Number(row.measured_used_before),
    usedAfter: row.measured_used_after === null ? null : Number(row.measured_used_after),
    measuredAt: row.measured_at === null ? null : String(row.measured_at),
  }));

  const measured = renders.filter((r) => r.measured !== null && r.estimated > 0);
  const totalEstimated = measured.reduce((sum, r) => sum + r.estimated, 0);
  const totalMeasured = measured.reduce((sum, r) => sum + (r.measured ?? 0), 0);
  const measuredRatio = totalEstimated > 0 ? Number((totalMeasured / totalEstimated).toFixed(4)) : null;

  const note =
    measured.length === 0
      ? 'One credit per character is an ESTIMATE. No render has ever been measured against the account’s own ' +
        'character_count, so nothing here confirms it — and the first measured render will change this ' +
        'sentence rather than this number.'
      : `Measured across ${measured.length} render${measured.length === 1 ? '' : 's'}: ${totalMeasured.toLocaleString('en-GB')} ` +
        `credits charged against an estimate of ${totalEstimated.toLocaleString('en-GB')} ` +
        `(${measuredRatio?.toFixed(3)}× the estimate).`;

  return {
    creditsPerCharacter: 1,
    verified: measured.length > 0,
    measuredRatio,
    measuredRenders: measured.length,
    totalEstimated,
    totalMeasured,
    renders,
    note,
  };
}
