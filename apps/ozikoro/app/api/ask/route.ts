/**
 * What does the archive say about this? (objective item 9, the half that needs no decision)
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 *
 * It retrieves **recorded passages from the archive and returns them with the address each came from.** It
 * does not generate a sentence, call a model, or paraphrase anything. **Every word a caller receives was
 * written by an archivist and is already published at the URL beside it.**
 *
 * That is why this exists before the assistant does. Round 190 established that the archive's system prompt —
 * the text telling a model how to speak for a university press — is an editorial decision, and round 183 that
 * the language a `KnowledgeItem` must declare is another. **Neither is needed to return what the archive
 * holds**, and this is the half that must be right before a model is attached to it.
 *
 * And it inherits the refusal built in round 191: if nothing in the archive matches the words of the question,
 * it says so rather than returning the nearest passages by position. `selectKnowledge` has no relevance floor
 * — it ranks and takes the top N, giving every `culture` item a point for its kind — so the shared trust label
 * calls an irrelevant result `verified`. **`answerabilityOf` is the check that catches it**, and this route
 * refuses on the same terms the library does.
 *
 * `languageCode` is required and has no default here either. Round 183 measured that no article records a
 * language, and the three defensible answers are the owner's; **a route that assumed one would be inventing
 * the field the adapter refuses to invent.** It is a query parameter so the decision stays visible.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { selectKnowledge, queryTerms } from '@ozituma/core';
import { archiveKnowledgeItems, answerabilityOf, groundedPassages } from '@ozikoro/platform';
import { clientKey, rateLimit } from '@/lib/rate-limit';

/** Long enough for a question, short enough that a URL cannot be used to make work. */
const MAX_QUESTION = 300;

/**
 * Thirty questions per five minutes, per client.
 *
 * WHAT THIS PROTECTS, and it is the reason this route was recorded as built rather than finished in round 209:
 * every request runs a database query over 1,000 articles and a retrieval across them, **and nothing
 * authenticates it.** Load is the whole risk — the same reasoning `lib/rate-limit.ts` gives for the OAuth
 * endpoints, and it is the same limiter rather than a second one.
 *
 * Thirty is generous for a person reading results and bounded for a script: the window is five minutes, so a
 * single client can make at most 360 requests an hour.
 *
 * THE LIMITER'S OWN CAVEAT APPLIES HERE TOO: it is in-process, so several instances behind a load balancer
 * each allow the full quota and the real ceiling is multiplied by the instance count. That is written in
 * `lib/rate-limit.ts` and is worth repeating at the call site, because this endpoint is public where those
 * are administrator-only.
 */
const LIMIT = { limit: 30, windowSeconds: 300 };

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const question = (url.searchParams.get('q') ?? '').trim();
  const languageCode = (url.searchParams.get('lang') ?? '').trim();

  if (question.length === 0) {
    return NextResponse.json(
      { error: 'Add a question: /api/ask?q=…&lang=ibo' },
      { status: 400 }
    );
  }
  if (question.length > MAX_QUESTION) {
    return NextResponse.json(
      { error: `Questions are limited to ${MAX_QUESTION} characters.` },
      { status: 400 }
    );
  }
  if (!/^[a-z]{3}$/.test(languageCode)) {
    // Not defaulted. The archive records no language per article, so any value here would be this route's
    // invention rather than the archive's record — see round 183.
    return NextResponse.json(
      {
        error:
          'Add lang=<ISO 639-3> — for example lang=ibo. The archive records no language per article, so ' +
          'this cannot be assumed.',
      },
      { status: 400 }
    );
  }

  // Counted before any work: a refused request must not cost a query, or the limiter is protecting the
  // response rather than the database.
  const limited = rateLimit(`ask:${clientKey(request)}`, LIMIT);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: 'Too many questions. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } }
    );
  }

  const db = await getDb();
  const items = await archiveKnowledgeItems(db, languageCode, { limit: 1000 });
  const terms = queryTerms(question);
  const result = selectKnowledge(items, { languageCode, terms, maxItems: 6 });

  const decision = answerabilityOf(result, terms);
  if (!decision.canAnswer) {
    // 200, not 404: the request was understood and the archive's answer is that it holds nothing. The
    // passages are empty rather than approximate, and the reason is the library's own sentence.
    return NextResponse.json(
      { grounded: false, trust: decision.trust, reason: decision.reason, passages: [] },
      { status: 200 }
    );
  }

  return NextResponse.json({
    grounded: true,
    trust: decision.trust,
    passages: groundedPassages(result).map((passage) => ({
      text: passage.text,
      source: passage.source,
      id: passage.id,
    })),
  });
}
