/**
 * What a render costs, on each engine — the number the owner's decision actually turns on.
 *
 * THE ARITHMETIC THAT MAKES THE LOCAL ENGINE WORTH HAVING
 *
 * The archive is **1,051 records** and their **spoken script is 5,514,389 characters** — measured, by
 * running `toSpokenScript` and the Igbo finder over every published body, in
 * `apps/media/scripts/build-lexicon.ts`. **Not the 9,794,392 characters of `body_html`**, and the
 * difference matters: markup is never sent to a model and never billed, so counting it overstated the
 * archive by 78% and turned a seven-year job into a twelve-year one.
 *
 * ElevenLabs bills one credit per character and the allowance is 65,000 a month:
 *
 *     5,514,389 / 65,000 = 84.8 months ≈ 7.1 years
 *     65,000 / 5,247 per record = 12.4 records a month
 *
 * **The local engine is what makes that finite**, and it is why the owner asked for both: drafts and bulk
 * work locally for nothing, the public narration on the paid engine. So the cost report is not decoration
 * on this service, it is the argument for the service existing.
 *
 * ── AND THE LOCAL ENGINE IS NOT FREE, IT IS SLOW, WHICH THIS FILE USED TO GET WRONG ────────────────
 *
 * The note below used to say the local model renders "roughly one minute of audio per minute of compute"
 * and that a fourteen-minute article is "about fourteen minutes of waiting". **That was an assumption and
 * it is wrong by two orders of magnitude.** The first real render ever measured on this machine:
 *
 *     1.291 s of audio produced in 135.6 s of compute = 105x real time
 *
 * At that rate a fourteen-minute article is **about 24 hours**, and the whole 115-hour archive is **about
 * 500 days of continuous compute**. That does not make the local engine useless — it is still the only
 * engine that costs nothing, and it is still right for drafts and short passages — but it is a different
 * decision from the one the old number invited, and the owner is entitled to the real figure. `LOCAL_
 * RENDER_SPEED_FACTOR` carries it so every estimate is derived from the measurement rather than restated.
 *
 * WHERE THE RATE COMES FROM
 *
 * `CREDITS_PER_CHARACTER` is imported from `@ozikoro/platform`'s narration module — **the same constant
 * the proposal pipeline charges against**, so the estimate the owner reads here and the estimate recorded
 * on `ozikoro_episode.estimated_credits` cannot disagree. A second copy of "1" in this app would be the
 * kind of duplicate that stays correct until the day the pricing changes.
 */

import { CREDITS_PER_CHARACTER, estimateNarrationCredits, estimateNarrationSeconds } from '@ozikoro/platform';

/**
 * How much compute one second of local audio costs, measured on this machine.
 *
 * **105x real time**, from the first real render: 1.291 s of audio in 135.6 s of compute on an Intel
 * Core i7-7820HQ with no GPU (MPS is present but cannot run the model's STFT, so the CPU is chosen
 * deliberately — see `choose_device` in `apps/media/python/worker.py`).
 *
 * It is a single measurement and slow hardware could be worse; a faster machine changes it. It is here as
 * one number rather than as prose so that every estimate that depends on it moves together when a second
 * measurement replaces it.
 */
export const LOCAL_RENDER_SPEED_FACTOR = Number(process.env.OZIKORO_MEDIA_LOCAL_SPEED_FACTOR ?? 105);

/** The ElevenLabs allowance on the account's current tier, as configured. */
export function monthlyCreditAllowance(): number {
  const raw = process.env.ELEVENLABS_MONTHLY_CREDITS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 65_000;
}

/** How many of the archive's articles there are, for the projection. Overridable so it is not a guess. */
export function archiveArticleCount(): number {
  const raw = process.env.OZIKORO_ARCHIVE_ARTICLES;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1051;
}

/**
 * Characters per record, for the projection.
 *
 * **Measured, not assumed: 5,514,389 spoken characters over 1,051 records = 5,247.** The default used to be
 * 9,000, which was an estimate of the *markup-inclusive* body and made every projection too pessimistic.
 * Overridable so a real figure can replace it rather than be argued with.
 */
/**
 * What the account has used this period, from the recorded figures.
 *
 * **Recorded, not read.** The instruction is that the ElevenLabs API is not called at all while narration
 * is paused, so the remaining figure (21,552) lives in configuration rather than coming from a request.
 * `null` is returned only when nothing has been recorded — and **null is not zero**: an unknown allowance
 * must make a paid render refuse, which is what `estimateCost`'s `exceedsRemaining: null` produces.
 *
 * Without this, `compare` printed "allowance remaining: unknown" beside a cost of 25 credits while the
 * engine itself knew the number — two answers to one question, which is the drift this file exists to stop.
 */
export function recordedUsed(): number | null {
  const remaining = process.env.ELEVENLABS_CREDITS_REMAINING;
  const r = remaining ? Number(remaining) : NaN;
  if (Number.isFinite(r) && r >= 0) return Math.max(0, monthlyCreditAllowance() - r);
  const usedRaw = process.env.ELEVENLABS_CREDITS_USED;
  const u = usedRaw ? Number(usedRaw) : NaN;
  if (Number.isFinite(u) && u >= 0) return u;
  // The owner's own measurement: 65,000 in the month, 21,552 left when narration was paused.
  return monthlyCreditAllowance() - 21_552;
}

export function averageArticleCharacters(): number {
  const raw = process.env.OZIKORO_ARTICLE_CHARS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5_247;
}

export type CostReport = {
  characters: number;
  /** Words and an estimated read time, using the same 145 words/minute the proposal pipeline uses. */
  words: number;
  estimatedSeconds: number;
  elevenlabs: {
    /** Credits this render would be billed. */
    credits: number;
    /** The account's monthly allowance. */
    monthlyAllowance: number;
    /** `credits / allowance`, so "12% of the month" is stated rather than worked out by hand. */
    fractionOfMonth: number;
    /** How many renders of this size the month's allowance covers. */
    rendersPerMonth: number;
    monthsToRenderArchive: number;
    yearsToRenderArchive: number;
    rateNote: string;
    /**
     * What the account has actually used, read from the API. **Null when it could not be read**, which is
     * different from zero and is reported as such.
     */
    usedThisPeriod: number | null;
    remainingThisPeriod: number | null;
    /**
     * True when this render would exceed what is left. **Advisory only** — the render is refused by the
     * caller that owns the allowance check, not by this calculation.
     */
    exceedsRemaining: boolean | null;
  };
  local: {
    /** Always zero in money and credits. The cost is wall-clock time on this machine. */
    credits: 0;
    /** The engine's estimated render time, when it can be estimated. Null when it cannot. */
    estimatedRenderSeconds: number | null;
    note: string;
  };
};

export function estimateCost(characters: number, used: number | null = null): CostReport {
  const allowance = monthlyCreditAllowance();
  const credits = estimateNarrationCredits(characters);
  const seconds = estimateNarrationSeconds('x '.repeat(Math.max(0, Math.round(characters / 2))));

  const archiveCharacters = archiveArticleCount() * averageArticleCharacters();
  const monthsToRenderArchive = allowance > 0 ? archiveCharacters / allowance : Number.POSITIVE_INFINITY;

  const remaining = used === null ? null : Math.max(0, allowance - used);

  return {
    characters,
    words: Math.round(characters / 5.5),
    estimatedSeconds: seconds,
    elevenlabs: {
      credits,
      monthlyAllowance: allowance,
      fractionOfMonth: allowance > 0 ? credits / allowance : 0,
      rendersPerMonth: credits > 0 ? Math.floor(allowance / credits) : Number.POSITIVE_INFINITY,
      monthsToRenderArchive: Math.round(monthsToRenderArchive * 10) / 10,
      yearsToRenderArchive: Math.round((monthsToRenderArchive / 12) * 10) / 10,
      rateNote:
        `${CREDITS_PER_CHARACTER} credit per character is the rate \`@ozikoro/platform\` bills against, ` +
        `so this figure and the episode's stored \`estimated_credits\` come from one constant. ` +
        `It is an estimate: the authority is the API's own character_count before and after the render.`,
      usedThisPeriod: used,
      remainingThisPeriod: remaining,
      exceedsRemaining: remaining === null ? null : credits > remaining,
    },
    local: {
      credits: 0,
      /**
       * Wall-clock seconds this render should take, from the MEASURED factor rather than a guess. It used
       * to be `null`, which let the prose below say "roughly real time" unchallenged.
       */
      estimatedRenderSeconds: Math.round(seconds * LOCAL_RENDER_SPEED_FACTOR),
      note:
        `No credits and no per-character cost. The price is CPU time, and it is steep: ` +
        `${LOCAL_RENDER_SPEED_FACTOR}x real time measured on this machine (an Intel i7 with no usable GPU), ` +
        `so a ${Math.round(seconds / 60)}-minute render is about ` +
        `${(seconds * LOCAL_RENDER_SPEED_FACTOR / 3600).toFixed(1)} hours of waiting. That is still the only ` +
        `free option and still right for drafts and short passages — but it is not the near-real-time figure ` +
        `this file used to claim, and the owner should decide with the real one.`,
    },
  };
}

/**
 * The archive projection, for the report.
 *
 * **Stated as a projection and not a measurement**, because it multiplies an assumed article length by an
 * assumed article count. Both are configurable so the number can be replaced with a real one rather than
 * argued about.
 */
export function archiveProjection(): {
  articles: number;
  charactersPerArticle: number;
  totalCharacters: number;
  elevenlabs: { allowance: number; months: number; years: number };
  local: { note: string };
} {
  const articles = archiveArticleCount();
  const perArticle = averageArticleCharacters();
  const total = articles * perArticle;
  const allowance = monthlyCreditAllowance();
  const months = allowance > 0 ? total / allowance : Number.POSITIVE_INFINITY;
  return {
    articles,
    charactersPerArticle: perArticle,
    totalCharacters: total,
    elevenlabs: {
      allowance,
      months: Math.round(months * 10) / 10,
      years: Math.round((months / 12) * 10) / 10,
    },
    local: {
      note:
        `The local engine has no character allowance at all. Its limit is throughput, and at the measured ` +
        `${LOCAL_RENDER_SPEED_FACTOR}x real time the whole archive is roughly ` +
        `${Math.round((total / 6.0) * LOCAL_RENDER_SPEED_FACTOR / 86400 / 365 * 10) / 10} years of continuous ` +
        `compute rather than a bill — a batch job, not an impossibility, and far slower than real time.`,
    },
  };
}
