/**
 * /api/learn/tutor — the text tutor.
 *
 *   POST { message, mode, conversationId? }
 *
 *   -> { conversationId, reply, trustLabel, grounded, fellBack, configured, sources }
 *
 * THE ORDER OF OPERATIONS IS THE SAFETY DESIGN, NOT A SEQUENCE OF STEPS
 *
 * §8.1 requires that a reply be grounded in approved content before it is generated, that it be
 * validated after, and that a failed check fall back to a safe reply. So:
 *
 *   1. retrieve approved content FIRST, and refuse to call a model with nothing to ground on
 *   2. render the prompt from that content only
 *   3. generate
 *   4. validate, and replace the answer with SAFE_FALLBACK if it fails
 *   5. store the grounding, the validation issues and whether it fell back
 *
 * Step 1 is the one that matters. §2.1 forbids the platform inventing Igbo, and a model asked about
 * a word with no approved entry has nothing to say that the platform is allowed to publish — so it
 * is not asked.
 *
 * WHEN NO PROVIDER IS CONFIGURED, THIS SAYS SO
 *
 * §18 #10 makes the owner the holder of the AI account and the spending cap, and no AI credential
 * exists in this deployment. The wrong responses to that are a 500, or a chat box that silently
 * never answers. The right one is to say the tutor is not configured and hand over the approved
 * entries retrieval already found — which are useful on their own, and are exactly what a
 * generative answer would have been grounded in.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import {
  appendMessage,
  countUserMessagesToday,
  createConversation,
  getConversation,
  TUTOR_MODES,
  type TutorMode,
} from '@ozituma/db/learn-tutor';
import {
  DEFAULT_PLAN,
  SAFE_FALLBACK,
  checkInputSize,
  checkMessageAllowance,
  formatKnowledgeBlock,
  planFor,
  queryTerms,
  selectKnowledge,
  trustForGrounding,
  validateTutorOutput,
  type KnowledgeItem,
} from '@ozituma/core';
import { getCurrentAccount } from '@/lib/session';
import { openAiCompatibleProvider } from '@/lib/ai-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const hits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

function allowed(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_PER_WINDOW;
}

const IGBO = 'ibo';

/**
 * Is a provider configured?
 *
 * Read from the environment at request time rather than at module load, so turning the tutor on is
 * a restart rather than a rebuild — and so a test can set it. The variable names are §19.4's.
 */
function providerConfig(): { id: string; apiKey: string; model: string; baseUrl?: string } | null {
  const apiKey = process.env.AI_API_KEY?.trim();
  const model = process.env.AI_MODEL_TUTOR?.trim();
  const id = process.env.AI_PROVIDER?.trim() || 'openai';
  if (!apiKey || !model) return null;
  return { id, apiKey, model, baseUrl: process.env.AI_BASE_URL?.trim() };
}

/**
 * Load the approved content the tutor may use.
 *
 * Published Igbo lexemes with a definition, capped. `status = 'published'` is §5.3's rule and is
 * enforced in SQL rather than filtered afterwards, so an unpublished row cannot reach the model by
 * a later refactor forgetting a check.
 */
async function loadKnowledge(db: Awaited<ReturnType<typeof getDb>>, limit: number): Promise<KnowledgeItem[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select w.id, w.headword, w.language_code,
            (select d.text from definition d where d.word_id = w.id
              order by d.is_primary desc, d.position, d.id limit 1) as gloss,
            (select a.storage_key from audio a where a.word_id = w.id and a.status = 'published'
              order by a.created_at, a.id limit 1) as storage_key
       from word w
      where w.language_code = $1 and w.status = 'published'
        and exists (select 1 from definition d where d.word_id = w.id)
      order by w.is_common desc nulls last, w.frequency_rank asc nulls last, w.headword
      limit $2`,
    [IGBO, limit]
  );

  return rows
    .filter((row) => typeof row.gloss === 'string' && String(row.gloss).trim() !== '')
    .map((row) => ({
      id: String(row.id),
      kind: 'lexeme' as const,
      languageCode: String(row.language_code),
      // Published by the WHERE clause above. Stated rather than implied because the retrieval
      // layer trusts this field, and a future caller must not be able to pass a draft through.
      status: 'published' as const,
      headword: String(row.headword),
      glossEn: String(row.gloss),
      text: `${row.headword} — ${row.gloss}`,
      source: 'ozituma-dictionary',
    }));
}

export async function POST(request: Request): Promise<NextResponse> {
  const ip = (request.headers.get('x-forwarded-for') ?? 'local').split(',')[0]!.trim();
  if (!allowed(ip)) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Too many requests. Slow down a little.' } },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  const account = await getCurrentAccount();
  if (!account) {
    return NextResponse.json(
      {
        error: {
          code: 'unauthenticated',
          message: 'The tutor keeps a history and a daily limit, so it needs an account. Sign in to use it.',
        },
      },
      { status: 401 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'The request body must be JSON.' } },
      { status: 400 }
    );
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const rawMode = typeof body.mode === 'string' ? body.mode : 'explain';
  const mode: TutorMode = TUTOR_MODES.includes(rawMode as TutorMode)
    ? (rawMode as TutorMode)
    : 'explain';

  if (message === '') {
    return NextResponse.json(
      { error: { code: 'empty_message', message: 'Ask something first.' } },
      { status: 400 }
    );
  }

  const db = await getDb();
  const plan = planFor(process.env.OZITUMA_LEARN_PLAN ?? DEFAULT_PLAN);

  // §8.1's caps, both of them. Checked before retrieval so an over-long input costs one query fewer.
  const size = checkInputSize(plan, message);
  if (!size.allowed) {
    return NextResponse.json(
      { error: { code: size.reason ?? 'input_too_long', message: size.message } },
      { status: 413 }
    );
  }

  const usedToday = await countUserMessagesToday(db, account.account.id);
  const allowance = checkMessageAllowance(plan, usedToday);
  if (!allowance.allowed) {
    return NextResponse.json(
      {
        error: {
          code: allowance.reason ?? 'daily_limit',
          message: allowance.message,
        },
        usedToday,
        limit: plan.tutorMessagesPerDay,
      },
      { status: 429 }
    );
  }

  // -------------------------------------------------------------------------
  // 1. Ground it, before anything is generated.
  // -------------------------------------------------------------------------
  const corpus = await loadKnowledge(db, 400);
  const retrieval = selectKnowledge(corpus, {
    languageCode: IGBO,
    terms: queryTerms(message),
  });

  const conversationId = await resolveConversation(db, account.account.id, mode, body);

  await appendMessage(db, {
    conversationId,
    role: 'user',
    content: message,
  });

  const config = providerConfig();

  // -------------------------------------------------------------------------
  // 2. No provider: say so, and hand over what retrieval found.
  // -------------------------------------------------------------------------
  if (config === null) {
    const sources = retrieval.items.map((item) => ({
      headword: item.headword ?? '',
      gloss: item.glossEn ?? '',
      text: item.text,
    }));

    await appendMessage(db, {
      conversationId,
      role: 'assistant',
      content:
        'The tutor is not switched on yet. The Ozituma entries below are the approved records ' +
        'relevant to your question — they are the same material a tutor answer would be built ' +
        'from, and they are readable and checkable as they stand.',
      trustLabel: 'verified',
      grounding: retrieval,
      fellBack: true,
    });

    return NextResponse.json({
      conversationId,
      configured: false,
      reply:
        'The tutor is not switched on yet. The Ozituma entries below are the approved records ' +
        'relevant to your question — they are the same material a tutor answer would be built ' +
        'from, and they are readable and checkable as they stand.',
      trustLabel: 'verified',
      grounded: !retrieval.empty,
      fellBack: true,
      sources,
      reason: 'no_provider',
    });
  }

  // -------------------------------------------------------------------------
  // 3. Nothing to ground on: refuse rather than let a model improvise.
  // -------------------------------------------------------------------------
  if (retrieval.empty) {
    await appendMessage(db, {
      conversationId,
      role: 'assistant',
      content: SAFE_FALLBACK,
      trustLabel: 'needs_review',
      grounding: retrieval,
      validationIssues: [{ code: 'no_grounding' }],
      fellBack: true,
    });

    return NextResponse.json({
      conversationId,
      configured: true,
      reply: SAFE_FALLBACK,
      trustLabel: 'needs_review',
      grounded: false,
      fellBack: true,
      sources: [],
      reason: 'no_grounding',
    });
  }

  // -------------------------------------------------------------------------
  // 4. Generate, validate, and fall back if the checks fail.
  //
  // The gateway and prompt rendering are wired here behind a lazy import so that a deployment with
  // no provider never loads the model client at all.
  // -------------------------------------------------------------------------
  const started = Date.now();
  const knowledgeBlock = formatKnowledgeBlock(retrieval.items);

  try {
    const { AiGateway, TUTOR_PROMPTS } = await import('@ozituma/core');

    const template = TUTOR_PROMPTS[mode];
    const gateway = new AiGateway();
    gateway.register(
      openAiCompatibleProvider({
        id: config.id,
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
      })
    );

    const system = template.system.replace('{{KNOWLEDGE}}', knowledgeBlock);
    const response = await gateway.complete({
      system,
      messages: [{ role: 'user', content: message }],
      model: config.model,
      maxOutputTokens: plan.maxOutputTokens,
      expectJson: true,
      // Deliberately opaque: §8.1 requires prompts logged with user identifiers separated, so this
      // must not be an email or an account id.
      requestId: `tutor-${conversationId}-${started}`,
    });

    const validation = validateTutorOutput(response.text, {
      mode,
      // The grounding is passed as the retrieval RESULT, not its items: the validator derives the
      // trust label from what retrieval actually returned, and an empty result must not be able to
      // produce a "verified" label.
      grounding: retrieval,
      knowledge: retrieval.items,
      maxOutputTokens: plan.maxOutputTokens,
    });

    // `validation.fallback` rather than the module constant: the validator may have a more specific
    // safe reply than the generic one, and using the constant would discard it.
    const finalText = validation.ok && validation.output ? validation.output.answer : validation.fallback;
    const trustLabel = validation.ok
      ? trustForGrounding(retrieval)
      : ('needs_review' as const);

    await appendMessage(db, {
      conversationId,
      role: 'assistant',
      content: finalText,
      trustLabel,
      providerId: config.id,
      model: response.model,
      promptId: template.id ?? mode,
      promptVersion: template.version ?? null,
      grounding: retrieval,
      validationIssues: validation.ok ? [] : validation.issues,
      fellBack: !validation.ok,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      latencyMs: Date.now() - started,
    });

    return NextResponse.json({
      conversationId,
      configured: true,
      reply: finalText,
      trustLabel,
      grounded: true,
      fellBack: !validation.ok,
      sources: retrieval.items.map((item) => ({
        headword: item.headword ?? '',
        gloss: item.glossEn ?? '',
        text: item.text,
      })),
    });
  } catch (error) {
    // A provider failure is not a learner error. The safe reply is stored and the reason logged,
    // because §8.1 wants the refusal rate visible.
    console.error('[tutor] generation failed', error);

    await appendMessage(db, {
      conversationId,
      role: 'assistant',
      content: SAFE_FALLBACK,
      trustLabel: 'needs_review',
      providerId: config.id,
      model: config.model,
      grounding: retrieval,
      validationIssues: [{ code: 'provider_error' }],
      fellBack: true,
      latencyMs: Date.now() - started,
    });

    return NextResponse.json({
      conversationId,
      configured: true,
      reply: SAFE_FALLBACK,
      trustLabel: 'needs_review',
      grounded: true,
      fellBack: true,
      sources: [],
      reason: 'provider_error',
    });
  }
}

/**
 * Reuse the conversation the caller named, or start one.
 *
 * Ownership is enforced by `getConversation`, which scopes by account and answers null for someone
 * else's id. A named conversation that fails that check starts a new one rather than erroring: the
 * learner's question still deserves an answer, and a 404 would confirm the id exists.
 */
async function resolveConversation(
  db: Awaited<ReturnType<typeof getDb>>,
  accountId: number,
  mode: TutorMode,
  body: Record<string, unknown>
): Promise<number> {
  const raw = body.conversationId;
  const requested = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);

  if (Number.isFinite(requested) && requested > 0) {
    const existing = await getConversation(db, requested, accountId, 1);
    if (existing) return existing.conversation.id;
  }

  const created = await createConversation(db, { accountId, mode });
  return created.id;
}

export async function GET(request: Request): Promise<NextResponse> {
  const account = await getCurrentAccount();
  if (!account) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Sign in to see your tutor history.' } },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const raw = Number.parseInt(url.searchParams.get('conversation') ?? '', 10);
  const db = await getDb();

  if (!Number.isFinite(raw) || raw <= 0) {
    return NextResponse.json({ configured: providerConfig() !== null, conversation: null, messages: [] });
  }

  const loaded = await getConversation(db, raw, account.account.id);
  if (!loaded) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'No such conversation.' } },
      { status: 404 }
    );
  }

  return NextResponse.json({
    configured: providerConfig() !== null,
    conversation: loaded.conversation,
    messages: loaded.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      trustLabel: m.trustLabel,
      fellBack: m.fellBack,
      createdAt: m.createdAt,
      // The grounding is NOT returned: it is the raw knowledge block and would duplicate the whole
      // source list into every reply. The learner-facing sources travel with the POST response.
    })),
  });
}
