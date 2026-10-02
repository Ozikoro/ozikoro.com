/**
 * Retrieval — the tutor's knowledge, restricted to published content.
 *
 * Spec §8.1: "Retrieval first. The tutor receives the learner level, current lesson, and relevant
 * published vocabulary, grammar notes and cultural notes as context. It is instructed to prefer
 * these over its own knowledge."
 *
 * Spec §5.3: "Only items in published status are visible to learners and available to the AI tutor
 * as trusted knowledge."
 *
 * WHY THE PUBLISHED FILTER IS THE FIRST STATEMENT IN THE FUNCTION
 *
 * Everything else here is ranking, and ranking is reversible. The published filter is not: it is
 * the mechanism by which §5.3 and §2.1 ("AI never authors published language content") become
 * true rather than aspirational. If unpublished material reaches the model as VERIFIED CONTENT,
 * the model will faithfully present it as verified, and the platform will have laundered an
 * unreviewed draft into a confident answer with a Verified label on it.
 *
 * So the filter runs before any ranking, and it is re-asserted after budget trimming — because
 * the cheapest way for this to break later is for someone to add a "fallback" that widens the
 * pool when the result set is empty.
 *
 * WHY THERE IS NO VECTOR SEARCH HERE
 *
 * §7 mentions pgvector as "optional for retrieval later". At launch the corpus for a single
 * lesson is small — a few dozen lexemes and one grammar note — and lexical ranking over a set
 * that small is both cheaper and more predictable than embeddings. Adding a vector index now
 * would be building for a scale the platform does not have, and it would make the ranking harder
 * to explain to a linguist asking why a particular word was or was not shown.
 */
import type { ReviewStatus, TrustLabel } from '../exercises.ts';
import { toSearchForm } from '../orthography.ts';

export type KnowledgeKind = 'lexeme' | 'grammar' | 'culture' | 'lesson';

export interface KnowledgeItem {
  id: string;
  kind: KnowledgeKind;
  /** ISO 639-3, e.g. 'ibo'. */
  languageCode: string;
  /** §5.3 lifecycle. Only 'published' is retrievable. */
  status: ReviewStatus;
  /** True when a machine produced any part of this. Recorded, not used to exclude — see below. */
  aiGenerated?: boolean;
  /** 0–1 curriculum level. Used to keep material near the learner's level. */
  level?: number;
  topic?: string;
  /** Documented region or variety, where §11.1 asks for one. */
  region?: string;
  lessonId?: string;
  /** For lexemes: the headword in NFC, exactly as stored. */
  headword?: string;
  /** English gloss, for the contradiction check in the validator. */
  glossEn?: string;
  /** The text handed to the model. */
  text: string;
  /** §11.4: every entry records its source. */
  source?: string;
}

export interface RetrievalQuery {
  languageCode: string;
  /** The learner's level. Material above this is filtered out. */
  level?: number;
  /** The lesson being studied, if any. Its material ranks first. */
  lessonId?: string | null;
  topic?: string;
  /** Prefer this region, without excluding others — §11.1 forbids presenting one form as universal. */
  region?: string;
  /** Terms from the learner's question, used to rank. */
  terms?: readonly string[];
  maxItems?: number;
  /** A character budget, so a long question cannot blow the context window or the cost. */
  maxCharacters?: number;
}

export interface RetrievalResult {
  items: KnowledgeItem[];
  /** True when there was nothing published to ground an answer in. */
  empty: boolean;
  /** How many published items were available before the budget trimmed them. */
  consideredCount: number;
  /** True when the budget cut the set short. */
  truncated: boolean;
}

/**
 * How far above the learner's level material may still be useful.
 *
 * One level. A beginner asking about a word in the next unit should get it; a beginner being
 * handed level-4 grammar because it scored well on a term match is the failure this prevents.
 */
const LEVEL_TOLERANCE = 1;

const DEFAULT_MAX_ITEMS = 12;
const DEFAULT_MAX_CHARACTERS = 6_000;

/**
 * Select the knowledge the tutor may use.
 *
 * Ranking, in order:
 *   1. the current lesson's material
 *   2. material matching the learner's terms
 *   3. level proximity — closest to the learner's level first
 *   4. kind — lexemes before grammar before culture, because a vocabulary question is the common case
 */
export function selectKnowledge(
  items: readonly KnowledgeItem[],
  query: RetrievalQuery
): RetrievalResult {
  const maxItems = query.maxItems ?? DEFAULT_MAX_ITEMS;
  const maxCharacters = query.maxCharacters ?? DEFAULT_MAX_CHARACTERS;
  const terms = (query.terms ?? []).map((term) => toSearchForm(term)).filter((term) => term.length > 1);

  // --- the hard gate: §5.3, published only -----------------------------------
  const published = items.filter(
    (item) => item.status === 'published' && item.languageCode === query.languageCode
  );

  // --- level window -----------------------------------------------------------
  const level = query.level;
  const inLevel = published.filter(
    (item) => level === undefined || item.level === undefined || item.level <= level + LEVEL_TOLERANCE
  );

  const scored = inLevel.map((item) => ({ item, score: scoreItem(item, query, terms, level) }));
  scored.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));

  const selected: KnowledgeItem[] = [];
  let characters = 0;
  let truncated = false;

  for (const { item } of scored) {
    if (selected.length >= maxItems || characters + item.text.length > maxCharacters) {
      truncated = true;
      break;
    }
    selected.push(item);
    characters += item.text.length;
  }

  // Re-assert the gate on the way out. Belt and braces: it costs one comparison and it is the
  // one invariant in this module that must never be relaxed.
  const safe = selected.filter((item) => item.status === 'published');

  return { items: safe, empty: safe.length === 0, consideredCount: published.length, truncated };
}

function scoreItem(
  item: KnowledgeItem,
  query: RetrievalQuery,
  terms: readonly string[],
  level: number | undefined
): number {
  let score = 0;

  // The lesson being studied dominates: the learner asked about what is in front of them.
  if (query.lessonId && item.lessonId === query.lessonId) score += 100;

  // Term overlap, matched on the folded form so "akwa" finds "àkwà" — the same forgiving
  // comparison the dictionary search uses, for the same reason.
  if (terms.length > 0) {
    const haystack = toSearchForm(`${item.headword ?? ''} ${item.glossEn ?? ''} ${item.text}`);
    for (const term of terms) {
      if (haystack.includes(term)) score += 10;
    }
  }

  if (level !== undefined && item.level !== undefined) {
    // Closest to the learner's level wins; the tolerance band has already excluded the rest.
    score += Math.max(0, 10 - Math.abs(item.level - level) * 5);
  }

  if (query.topic && item.topic === query.topic) score += 5;
  // A region match is a preference, never a filter: §16's dialect-risk mitigation is that a
  // documented regional form is shown as a note, never as the only answer.
  if (query.region && item.region === query.region) score += 3;

  score += { lexeme: 3, grammar: 2, culture: 1, lesson: 0 }[item.kind];

  return score;
}

// ---------------------------------------------------------------------------
// Formatting for the prompt
// ---------------------------------------------------------------------------

/**
 * Render the retrieved items as the VERIFIED CONTENT block.
 *
 * Each line carries its source (§11.4) so the model can cite it and a reviewer can trace it. An
 * empty result produces an explicit sentence rather than an empty block, because a blank block
 * reads to a model as "no constraints" rather than "nothing is verified".
 */
export function formatKnowledgeBlock(items: readonly KnowledgeItem[]): string {
  if (items.length === 0) {
    return 'No published material matches this question. Answer from general knowledge if you can, but set trust to "unverified" and say what you are unsure about.';
  }

  return items
    .map((item) => {
      const label = item.kind.toUpperCase();
      const headword = item.headword ? `${item.headword} — ` : '';
      const region = item.region ? ` [${item.region}]` : '';
      const source = item.source ? ` (source: ${item.source})` : '';
      return `- [${label}] ${headword}${item.text}${region}${source}`;
    })
    .join('\n');
}

/**
 * The trust label for an answer built on these items.
 *
 * §8.1 is exact about this: "Answers grounded in published content show Verified. Anything else
 * shows AI-assisted." So this is a statement about GROUNDING, not about how the answer was
 * written — an answer the model composed fluently but which is supported by published content is
 * Verified, and an answer with no support behind it is not, however confident it reads.
 */
export function trustForGrounding(result: RetrievalResult): TrustLabel {
  return result.empty ? 'ai_assisted' : 'verified';
}

/** Terms worth searching on, drawn from a learner's question. */
export function queryTerms(question: string, limit = 8): string[] {
  return question
    .split(/[^\p{L}\p{N}\u0323\u0307]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
    // Very common English words carry no signal and match everything.
    .filter((token) => !STOP_WORDS.has(token.toLowerCase()))
    .slice(0, limit);
}

/*
 * WORDS THAT CARRY NO SIGNAL ABOUT WHAT A QUESTION IS ASKING.
 *
 * WHY THIS LIST MATTERS MORE THAN IT LOOKS (measured in round 262)
 *
 * `answerabilityOf` refuses an answer when no passage contains any of the question's terms — and that gate is
 * the only thing standing between a reader and a model answering from its own knowledge. The check is
 * `terms.some(...)`, so **one surviving common word defeats it entirely.**
 *
 * Measured before this fix:
 *
 *   "Explain quantum chromodynamics"  -> ["Explain", "quantum", "chromodynamics"]
 *        "Explain" appears in 95 published articles, and neither of the other two in any.
 *        The gate matched on the question's own VERB and the archive claimed grounding for a question
 *        about particle physics.
 *
 *   "Tell me about Igbo clans"        -> ["Tell", "me", "clans"]
 *        "Tell" appears in 311 articles.
 *
 *   "What is Nwaezinmadu?"            -> ["is", "Nwaezinmadu"]
 *        "is" was not in this list at all, and appears in essentially every article.
 *
 * **So the list was missing the most basic function words and every question verb**, which meant a question
 * phrased in ordinary English almost always found a spurious match. The verbs are here because they describe
 * the ACT of asking rather than the subject: a question containing "explain" is not a question about
 * explaining.
 */
const STOP_WORDS = new Set([
  // articles, pronouns, prepositions, conjunctions
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'so', 'as', 'at', 'by', 'for', 'from',
  'in', 'into', 'of', 'on', 'onto', 'to', 'up', 'with', 'within', 'without', 'over', 'under', 'between',
  'about', 'after', 'before', 'during', 'against', 'among', 'around', 'through', 'toward', 'towards',
  'you', 'your', 'yours', 'me', 'my', 'mine', 'we', 'our', 'ours', 'us', 'he', 'him', 'his', 'she',
  'her', 'hers', 'it', 'its', 'they', 'them', 'their', 'theirs', 'i', 'this', 'that', 'these', 'those',
  // the verb 'to be', in every form a question uses
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  // auxiliaries and modals
  'do', 'does', 'did', 'done', 'have', 'has', 'had', 'can', 'could', 'will', 'would', 'shall', 'should',
  'may', 'might', 'must',
  // question words
  'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how',
  // THE VERBS OF ASKING — the round 262 finding. A question containing these is not a question ABOUT them.
  'explain', 'explains', 'explained', 'tell', 'tells', 'told', 'describe', 'describes', 'described',
  'give', 'gives', 'given', 'know', 'knows', 'known', 'show', 'shows', 'shown', 'list', 'lists',
  'find', 'finds', 'help', 'helps', 'need', 'needs', 'want', 'wants', 'like', 'look', 'looks',
  // the vocabulary of asking itself
  'mean', 'means', 'meaning', 'please', 'say', 'says', 'said', 'ask', 'asks', 'asked', 'question',
  'answer', 'answers', 'information', 'info', 'details', 'detail', 'anything', 'something', 'everything',
  // the archive's own subject, which a question about it will always contain
  'igbo', 'word', 'words', 'language', 'archive', 'ozikoro', 'history', 'histories',
  // leftovers that were here and still belong
  'all', 'any', 'one', 'two', 'new', 'now', 'old', 'out', 'day', 'get', 'let', 'put', 'see', 'too', 'use',
  'way', 'boy', 'not', 'while', 'also', 'just', 'only', 'very', 'more', 'most', 'much', 'many', 'some',
]);
