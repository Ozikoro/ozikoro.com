/**
 * GET /api/v1/words — search the dictionary.
 *
 * Mirrors the Igbo API's primary endpoint so existing clients can migrate by
 * changing a base URL, but with better defaults:
 *
 *   ?keyword=mmiri        free-text search (headwords, variants, dialects, glosses)
 *   ?language=ibo         target language (default ibo)
 *   ?page=1&limit=20      pagination (limit max 100)
 *   ?strict=true          exact headword matches only
 *   ?dialect=ONI          filter to a dialect
 *   ?wordClasses=NNC,AV   filter by grammar category
 *   ?tags=proverb         filter by tag
 *   ?common=true          only high-frequency words
 *
 * Unlike the reference implementation, an omitted keyword is a valid request
 * (it browses) rather than an error, and results always carry the source
 * attribution the corpus licence requires.
 */
import { searchWords } from '@ozituma/db/repository';
import {
  intParam,
  listParam,
  boolParam,
  paginatedResponse,
  resolveLanguage,
  withApiAuth,
} from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiAuth('words', async (request, ctx) => {
  const url = new URL(request.url);
  const params = url.searchParams;

  const language = await resolveLanguage(ctx.db, params.get('language'));

  // `keyword` is the Igbo API's name for it; `q` is the modern short form.
  const query = params.get('keyword') ?? params.get('q') ?? '';

  const result = await searchWords(ctx.db, {
    query,
    language,
    page: intParam(params, 'page', 1, 1, 10_000),
    perPage: intParam(params, 'limit', 20, 1, 100),
    strict: boolParam(params, 'strict'),
    dialect: params.get('dialect') ?? undefined,
    wordClasses: listParam(params, 'wordClasses'),
    tags: listParam(params, 'tags'),
    commonOnly: boolParam(params, 'common'),
  });

  return paginatedResponse(result);
});
