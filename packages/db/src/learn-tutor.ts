/**
 * Conversations with the AI tutor — persistence.
 *
 * THE SAME GAP, FOR THE THIRD TIME
 *
 * `packages/core/src/ai/` holds the whole pipeline and it is well tested: `selectKnowledge` ranks
 * approved content, `formatKnowledgeBlock` builds the grounded prompt, `TUTOR_PROMPTS` defines the
 * four modes, the gateway abstracts providers, `validateTutorOutput` rejects an answer that fails
 * its checks, and `SAFE_FALLBACK` is what a learner gets instead. Migration 0030 created
 * `learn_ai_conversation`, `learn_ai_message` and `learn_prompt_version` — with `trust_label`,
 * `grounding`, `validation_issues`, `fell_back`, token counts and retention, which is §8.1 and §8.2
 * almost word for word. Nothing read or wrote any of it.
 *
 * So this is the storage half: a conversation, its messages, the grounding a reply was built from,
 * and the record of whether it had to fall back.
 *
 * WHY `grounding` IS STORED RATHER THAN LOGGED
 *
 * §8.1's design is retrieval-first — the model may only use approved content — and that claim is
 * unverifiable after the fact unless the exact knowledge a reply was shown is kept. A column, not a
 * log line, because it has to be queryable: "which answers cited this lexeme" is the question that
 * matters when a learner reports one as wrong.
 *
 * WHY TOKEN COUNTS ARE STORED
 *
 * §18 #10 makes the owner the holder of the AI account with a hard spend cap. A cap needs a meter,
 * and a meter that is reconstructed from logs is a meter that is wrong at the exact moment it
 * matters. The counts are written with the message.
 */

import type { Db } from './client.ts';
import type { TrustLabel } from '@ozituma/core';

/** §F8's four tutor modes. Mirrors `TUTOR_MODES` in packages/core/src/ai/prompts.ts. */
export type TutorMode = 'explain' | 'correct' | 'translate' | 'explain_pasted';

export const TUTOR_MODES: readonly TutorMode[] = ['explain', 'correct', 'translate', 'explain_pasted'];

/**
 * How long a conversation is kept.
 *
 * §8.1 asks for a retention limit and does not name a number. Ninety days is long enough that a
 * learner can look back over a term's work and short enough that the table does not become a
 * permanent transcript of everything anybody asked. It is a decision recorded in `docs/decisions.md`
 * rather than a hard-coded constant, because it is the owner's call and changing it is a migration
 * of intent, not of schema.
 */
export const RETENTION_DAYS = 90;

export interface Conversation {
  id: number;
  mode: TutorMode;
  lessonId: number | null;
  title: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TutorMessage {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** §5.3: null for a user's own message; every assistant reply carries one. */
  trustLabel: TrustLabel | null;
  /** §8.2: what produced the reply, so a disputed answer can be traced. */
  providerId: string | null;
  model: string | null;
  promptId: string | null;
  promptVersion: number | null;
  /** The approved content the reply was allowed to use. */
  grounding: unknown;
  /** Which checks failed, when any did. */
  validationIssues: unknown;
  /** True when the reply is the safe fallback rather than a generated answer. */
  fellBack: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  createdAt: number;
}

function toEpochMs(value: Date | string | null): number | null {
  if (value === null) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowToConversation(row: Record<string, unknown>): Conversation {
  return {
    id: Number(row.id),
    mode: String(row.mode) as TutorMode,
    lessonId: row.lesson_id === null ? null : Number(row.lesson_id),
    title: (row.title as string | null) ?? null,
    createdAt: toEpochMs(row.created_at as Date | string) ?? 0,
    updatedAt: toEpochMs(row.updated_at as Date | string) ?? 0,
  };
}

function rowToMessage(row: Record<string, unknown>): TutorMessage {
  return {
    id: Number(row.id),
    role: String(row.role) as TutorMessage['role'],
    content: String(row.content),
    trustLabel: (row.trust_label as TrustLabel | null) ?? null,
    providerId: (row.provider_id as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    promptId: (row.prompt_id as string | null) ?? null,
    promptVersion: row.prompt_version === null ? null : Number(row.prompt_version),
    grounding: row.grounding ?? null,
    validationIssues: row.validation_issues ?? null,
    fellBack: Boolean(row.fell_back),
    inputTokens: row.input_tokens === null ? null : Number(row.input_tokens),
    outputTokens: row.output_tokens === null ? null : Number(row.output_tokens),
    latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
    createdAt: toEpochMs(row.created_at as Date | string) ?? 0,
  };
}

/** Start a conversation. The mode is fixed for its life, because the prompt depends on it. */
export async function createConversation(
  db: Db,
  input: { accountId: number; mode: TutorMode; lessonId?: number | null; title?: string | null }
): Promise<Conversation> {
  const row = await db.one<Record<string, unknown>>(
    `insert into learn_ai_conversation (account_id, mode, lesson_id, title)
     values ($1, $2, $3, $4)
     returning id, mode, lesson_id, title, created_at, updated_at`,
    [input.accountId, input.mode, input.lessonId ?? null, input.title ?? null]
  );
  if (!row) throw new Error('Could not create the conversation.');
  return rowToConversation(row);
}

/**
 * Load a conversation and its messages, scoped to the owner.
 *
 * `account_id` is part of the WHERE clause rather than checked afterwards. A conversation id is a
 * sequential integer, so a caller who guesses one would otherwise read somebody else's chat — and
 * "check after fetching" is one forgotten branch away from that.
 *
 * Returns null when the conversation does not exist OR belongs to someone else, deliberately: a
 * distinct "forbidden" would confirm the id exists.
 */
export async function getConversation(
  db: Db,
  conversationId: number,
  accountId: number,
  limit = 50
): Promise<{ conversation: Conversation; messages: TutorMessage[] } | null> {
  const conversationRow = await db.one<Record<string, unknown>>(
    `select id, mode, lesson_id, title, created_at, updated_at
       from learn_ai_conversation where id = $1 and account_id = $2`,
    [conversationId, accountId]
  );
  if (!conversationRow) return null;

  const messageRows = await db.rows<Record<string, unknown>>(
    `select id, role, content, trust_label, provider_id, model, prompt_id, prompt_version,
            grounding, validation_issues, fell_back, input_tokens, output_tokens, latency_ms, created_at
       from learn_ai_message
      where conversation_id = $1
      order by id desc
      limit $2`,
    [conversationId, limit]
  );

  return {
    conversation: rowToConversation(conversationRow),
    // Fetched newest-first so the LIMIT keeps the most recent exchange, then reversed for display.
    messages: messageRows.map(rowToMessage).reverse(),
  };
}

/** A learner's recent conversations, newest first. */
export async function listConversations(
  db: Db,
  accountId: number,
  limit = 20
): Promise<Conversation[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select id, mode, lesson_id, title, created_at, updated_at
       from learn_ai_conversation where account_id = $1
      order by updated_at desc limit $2`,
    [accountId, limit]
  );
  return rows.map(rowToConversation);
}

export interface AppendMessageInput {
  conversationId: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  trustLabel?: TrustLabel | null;
  providerId?: string | null;
  model?: string | null;
  promptId?: string | null;
  promptVersion?: number | null;
  grounding?: unknown;
  validationIssues?: unknown;
  fellBack?: boolean;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
}

/**
 * Append a message, and touch the conversation.
 *
 * Both in one transaction-free sequence, and the second is not critical: `updated_at` orders the
 * conversation list, so a message that lands without its timestamp being bumped shows up slightly
 * lower than it should. Losing that is a cosmetic ordering problem, not a lost message — which is
 * why the two are not forced into one statement the way the SRS state and log are.
 */
export async function appendMessage(db: Db, input: AppendMessageInput): Promise<TutorMessage> {
  const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const row = await db.one<Record<string, unknown>>(
    `insert into learn_ai_message (
       conversation_id, role, content, trust_label, provider_id, model, prompt_id, prompt_version,
       grounding, validation_issues, fell_back, input_tokens, output_tokens, latency_ms, expires_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     returning id, role, content, trust_label, provider_id, model, prompt_id, prompt_version,
               grounding, validation_issues, fell_back, input_tokens, output_tokens, latency_ms, created_at`,
    [
      input.conversationId,
      input.role,
      input.content,
      input.trustLabel ?? null,
      input.providerId ?? null,
      input.model ?? null,
      input.promptId ?? null,
      input.promptVersion ?? null,
      input.grounding === undefined ? null : JSON.stringify(input.grounding),
      input.validationIssues === undefined ? null : JSON.stringify(input.validationIssues),
      input.fellBack ?? false,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.latencyMs ?? null,
      expiresAt,
    ]
  );
  if (!row) throw new Error('Could not store the message.');

  await db.rows(`update learn_ai_conversation set updated_at = now() where id = $1`, [
    input.conversationId,
  ]);

  return rowToMessage(row);
}

/**
 * How many tutor messages the learner has sent today.
 *
 * Counted in the database rather than from a counter, so the limit cannot be reset by clearing
 * local state or bypassed by a second device. `checkMessageAllowance` in core decides what the
 * number means; this only produces it.
 *
 * A day is a UTC day here, unlike the streak's local day. That is a deliberate difference: a limit
 * on spending is not a streak, and it should not move around with the learner's travel. A learner
 * who gains an hour by flying west does not get a second allowance.
 */
export async function countUserMessagesToday(db: Db, accountId: number): Promise<number> {
  const row = await db.one<{ n: number }>(
    `select count(*)::int as n
       from learn_ai_message m
       join learn_ai_conversation c on c.id = m.conversation_id
      where c.account_id = $1
        and m.role = 'user'
        and m.created_at >= date_trunc('day', now())`,
    [accountId]
  );
  return Number(row?.n ?? 0);
}

/** Tokens and spend for today, for the owner's cap (§18 #10). */
export async function getDailyUsage(
  db: Db,
  accountId?: number
): Promise<{ inputTokens: number; outputTokens: number; messages: number }> {
  const row = await db.one<{ input_tokens: number; output_tokens: number; messages: number }>(
    accountId === undefined
      ? `select coalesce(sum(m.input_tokens),0)::int as input_tokens,
                coalesce(sum(m.output_tokens),0)::int as output_tokens,
                count(*) filter (where m.role = 'assistant')::int as messages
           from learn_ai_message m
          where m.created_at >= date_trunc('day', now())`
      : `select coalesce(sum(m.input_tokens),0)::int as input_tokens,
                coalesce(sum(m.output_tokens),0)::int as output_tokens,
                count(*) filter (where m.role = 'assistant')::int as messages
           from learn_ai_message m
           join learn_ai_conversation c on c.id = m.conversation_id
          where c.account_id = $1 and m.created_at >= date_trunc('day', now())`,
    accountId === undefined ? [] : [accountId]
  );
  return {
    inputTokens: Number(row?.input_tokens ?? 0),
    outputTokens: Number(row?.output_tokens ?? 0),
    messages: Number(row?.messages ?? 0),
  };
}

/**
 * Delete messages past their retention date.
 *
 * Intended for a scheduled job rather than a request path. Returns how many went, so a job can log
 * something other than "ran".
 */
export async function pruneExpiredMessages(db: Db): Promise<number> {
  const rows = await db.rows<{ id: number }>(
    `delete from learn_ai_message where expires_at is not null and expires_at < now() returning id`
  );
  return rows.length;
}
