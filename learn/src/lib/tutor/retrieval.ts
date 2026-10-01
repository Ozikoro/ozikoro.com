/**
 * The Ozituma language retrieval layer.
 *
 * THE CONTRACT THIS FILE KEEPS
 *
 * The tutor may generate the TEACHING. It may not generate the LANGUAGE. Everything in this file
 * exists to make that separation real rather than aspirational: linguistic facts come out of the
 * Ozituma corpus, and each one carries the evidence for why it should be believed.
 *
 * NO NEW DICTIONARY
 *
 * This reads `lexemes` and `lexeme_examples` exactly as they are. It does not copy, merge, normalise
 * or "improve" them. A second dictionary would be a second truth, and the project already has one.
 *
 * TRUST IS CARRIED, NOT SUMMARISED
 *
 * Six signals already exist in the data and each is preserved onto every retrieved item rather than
 * being flattened into a single score:
 *
 *   status        published | draft            — has a linguist approved it?
 *   reviewer_id   present  | null             — did a named person sign it off?
 *   dialect       null means Central Igbo      — an untagged word IS Igbo Izugbe
 *   source        which corpus it came from
 *   ai_generated  must be false for anything shown as verified
 *   audio_url     whether a pronunciation recording exists
 *
 * A single "confidence" number would lose the distinction between "a linguist approved this" and
 * "nobody has looked at it yet", which are different problems needing different responses.
 */

import { createClient } from "@supabase/supabase-js";

/** The labels a learner sees. Wording is deliberate — see `trustLabel`. */
export type Trust = "verified" | "variant" | "needs_review" | "insufficient";

export interface RetrievedEntry {
  /** The row id, kept so an answer can be traced back to the exact record. */
  id: string;
  headword: string;
  toneMarked: string | null;
  meaning: string;
  partOfSpeech: string | null;
  exampleIg: string | null;
  exampleEn: string | null;
  audioUrl: string | null;

  /** How well it matched, so the orchestrator can prefer strong evidence. */
  match: "exact" | "headword" | "meaning";
  /** Every signal above, kept individually. */
  status: string;
  dialect: string | null;
  source: string | null;
  aiGenerated: boolean;
  reviewed: boolean;
  /** Whether a recording of the WORD exists (not just an example). */
  hasPronunciation: boolean;
  trust: Trust;
}

/**
 * Decide the trust label from the row's own signals.
 *
 * WHY THE ORDER MATTERS
 *
 * A dialect-tagged word is a legitimate entry — it is simply not Central Igbo. Calling it "needs
 * review" would be wrong, and calling it "verified" without saying WHICH variety would be misleading.
 * So `variant` is checked before the review state and always names the variety.
 */
export function trustOf(row: {
  status: string;
  dialect: string | null;
  ai_generated: boolean | null;
  reviewer_id: string | null;
}): Trust {
  if (row.status !== "published") return "needs_review";
  /*
   * AI-written text must never be presented as verified, whatever its status. The project rule is
   * that AI never authors published content; if such a row ever appears, this catches it here rather
   * than letting it reach a learner wearing a tick it did not earn.
   */
  if (row.ai_generated) return "needs_review";
  if (row.dialect) return "variant";
  if (!row.reviewer_id) return "needs_review";
  return "verified";
}

/** The human-facing label, kept beside the machine value so they cannot drift. */
export function trustLabel(t: Trust, dialect?: string | null): string {
  switch (t) {
    case "verified":
      return "✓ Verified";
    /*
     * The variety is named. "⚠ Variant" alone tells a learner nothing about what it varies from,
     * and this project's whole position is that Central Igbo is the standard.
     */
    case "variant":
      return `⚠ Variant${dialect ? ` (${dialect})` : ""}`;
    case "needs_review":
      return "⚠ Linguist review needed";
    case "insufficient":
      return "? Insufficient data";
  }
}

const SELECT =
  "id,headword,tone_marked,meaning,part_of_speech,example_ig,example_en,audio_url,dialect,source,ai_generated,status,reviewer_id";

type Row = {
  id: string;
  headword: string;
  tone_marked: string | null;
  meaning: string | null;
  part_of_speech: string | null;
  example_ig: string | null;
  example_en: string | null;
  audio_url: string | null;
  dialect: string | null;
  source: string | null;
  ai_generated: boolean | null;
  status: string;
  reviewer_id: string | null;
};

function toEntry(row: Row, match: RetrievedEntry["match"]): RetrievedEntry {
  return {
    id: row.id,
    headword: row.headword,
    toneMarked: row.tone_marked,
    meaning: row.meaning ?? "",
    partOfSpeech: row.part_of_speech,
    exampleIg: row.example_ig,
    exampleEn: row.example_en,
    audioUrl: row.audio_url,
    match,
    status: row.status,
    dialect: row.dialect,
    source: row.source,
    aiGenerated: Boolean(row.ai_generated),
    reviewed: row.reviewer_id !== null,
    hasPronunciation: row.audio_url !== null,
    trust: trustOf(row),
  };
}

/** Words worth searching: punctuation stripped, stopwords dropped, Igbo terms ranked first. */
export function searchTerms(question: string): string[] {
  const words = [
    ...new Set(
      question
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2)
    ),
  ];
  // Igbo-looking terms (diacritics or dot-below vowels) are the strongest signal and go first, so an
  // English word cannot crowd out the term the learner actually asked about.
  const isIgbo = (w: string) => /[ịọụẹṅ]|[\u0300-\u036f]/.test(w);
  return [...words.filter(isIgbo), ...words.filter((w) => !isIgbo(w))].slice(0, 12);
}

/**
 * Retrieve everything relevant to a question.
 *
 * TWO PASSES, AND WHY BOTH ARE NEEDED
 *
 * Pass 1 is exact headword. A learner asking about a word has almost certainly typed that word, and
 * an exact hit is the strongest evidence available — it must never be crowded out by incidental
 * matches on the English around it. (This was a real bug: "Tell me about the word nne" retrieved
 * the entries for about/tell/word/the and never fetched `nne`, then correctly reported that the
 * dictionary had no entry for it. A right refusal caused by a retrieval fault.)
 *
 * Pass 2 is partial, and only runs if pass 1 was thin. It is what handles a question phrased as a
 * MEANING — "how do I say mother" — where no word in the question is the headword.
 */
export async function retrieve(
  db: { from: (t: string) => any },
  question: string,
  options: { includeVariants?: boolean; limit?: number } = {}
): Promise<RetrievedEntry[]> {
  const terms = searchTerms(question);
  if (terms.length === 0) return [];

  const limit = options.limit ?? 12;
  const seen = new Map<string, RetrievedEntry>();

  /* Pass 1 — exact headword. Diacritic-insensitive via `search_key`, the folded headword. */
  for (const term of terms) {
    const key = term.replace(/[%,]/g, "");
    let q = db.from("lexemes").select(SELECT).eq("status", "published").eq("search_key", key);
    // Central Igbo only unless the caller explicitly wants variants. An untagged word IS Igbo Izugbe.
    if (!options.includeVariants) q = q.is("dialect", null);
    const { data } = await q.limit(2);
    for (const row of (data ?? []) as Row[]) {
      if (!seen.has(row.id)) seen.set(row.id, toEntry(row, "exact"));
    }
  }

  /* Pass 2 — partial on headword, then on meaning. Only if pass 1 was thin. */
  if (seen.size < 6) {
    for (const term of terms) {
      const key = term.replace(/[%,]/g, "");
      let q = db
        .from("lexemes")
        .select(SELECT)
        .eq("status", "published")
        .or(`search_key.ilike.%${key}%,meaning.ilike.%${key}%`);
      if (!options.includeVariants) q = q.is("dialect", null);
      const { data } = await q.limit(4);
      for (const row of (data ?? []) as Row[]) {
        if (!seen.has(row.id)) seen.set(row.id, toEntry(row, "headword"));
      }
      if (seen.size >= limit) break;
    }
  }

  /*
   * Recorded example sentences come from `lexeme_examples`, which holds far more audio than the word
   * rows do — 30,028 sentences against 467 word recordings. They are attached to the entry they
   * belong to rather than returned separately, so a teaching answer can quote a sentence the corpus
   * actually contains.
   */
  const ids = [...seen.keys()];
  if (ids.length) {
    const { data: examples } = await db
      .from("lexeme_examples")
      .select("lexeme_id,text_ig,text_en,audio_url")
      .in("lexeme_id", ids)
      .eq("status", "published")
      .order("position");

    const byLexeme = new Map<string, { text_ig: string; text_en: string | null; audio_url: string | null }>();
    for (const e of examples ?? []) {
      const k = e.lexeme_id as string;
      if (!byLexeme.has(k)) byLexeme.set(k, e as never);
    }
    for (const [id, entry] of seen) {
      const ex = byLexeme.get(id);
      if (ex) {
        entry.exampleIg = ex.text_ig;
        entry.exampleEn = ex.text_en;
        // The sentence recording is only used when the WORD has none — a word's own pronunciation is
        // what a learner needs first, and the sentence is the fallback.
        if (!entry.audioUrl) entry.audioUrl = ex.audio_url;
      }
    }
  }

  /*
   * Rank: exact matches first, then verified before variant before unreviewed. The orchestrator sees
   * the best evidence at the top of the list.
   */
  const rank = { exact: 0, headword: 1, meaning: 2 } as const;
  const trustRank: Record<Trust, number> = { verified: 0, variant: 1, needs_review: 2, insufficient: 3 };

  return [...seen.values()]
    .sort((a, b) => rank[a.match] - rank[b.match] || trustRank[a.trust] - trustRank[b.trust])
    .slice(0, limit);
}

/** A ready-to-use client for server-side retrieval. */
export function languageDb(url: string, serviceKey: string) {
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * Does the corpus contain enough to answer?
 *
 * The line between "explain what we have" and "admit we cannot" is the whole point of the feature, so
 * it is a function rather than an inline condition. One exact match is enough to talk about a word.
 * Only incidental matches are not enough to answer a direct question about a specific word — the
 * tutor should say so instead of improvising.
 */
export function sufficiency(entries: readonly RetrievedEntry[], question: string): "enough" | "partial" | "none" {
  if (entries.length === 0) return "none";
  if (entries.some((e) => e.match === "exact")) return "enough";
  /*
   * No exact hit. If the learner typed something that LOOKS like an Igbo word and it is not in the
   * corpus, that is the dangerous case — the thing they asked about does not exist here, and only
   * partial matches came back. That is "partial", and the answer must say the word itself was not
   * found rather than teaching one of the near-misses.
   */
  const asked = searchTerms(question).some((t) => /[ịọụẹṅ]|[\u0300-\u036f]/.test(t));
  return asked ? "partial" : entries.length >= 2 ? "enough" : "partial";
}
