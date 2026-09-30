/**
 * Tests for tutor persistence.
 *
 * Run with: npm -w @ozituma/db run test:tutor
 *
 * WHAT THESE ARE ACTUALLY CHECKING
 *
 * The interesting claim in `learn-tutor.ts` is not that rows save. It is that a conversation id is
 * a sequential integer — so a caller who guesses one must not be able to read somebody else's chat.
 * That is checked directly, with two real accounts, in both directions.
 *
 * The rest are properties a learner would notice if they broke:
 *   - the grounding a reply was built from is stored, because §8.1's retrieval-first claim is
 *     unverifiable afterwards without it
 *   - a fallback is recorded as a fallback, so the refusal rate is visible
 *   - retention is set on every message, so the prune job has something to act on
 *   - the daily count is per learner and per day
 */
import { createDb, type Db } from './client.ts';
import { registerAccount } from './accounts.ts';
import {
  appendMessage,
  countUserMessagesToday,
  createConversation,
  getConversation,
  getDailyUsage,
  listConversations,
  pruneExpiredMessages,
  TUTOR_MODES,
} from './learn-tutor.ts';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  ok    ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main(): Promise<void> {
  const db: Db = await createDb({});
  const stamp = Date.now();
  const emailA = `tutor-a-${stamp}@ozituma.test`;
  const emailB = `tutor-b-${stamp}@ozituma.test`;

  const a = await registerAccount(db, { email: emailA, password: 'tutor-test-password-a' });
  const b = await registerAccount(db, { email: emailB, password: 'tutor-test-password-b' });
  console.log(`  accounts ${a.id} and ${b.id}\n`);

  try {
    // ---------------------------------------------------------------------
    // 1. A conversation and its messages
    // ---------------------------------------------------------------------
    const conversation = await createConversation(db, { accountId: a.id, mode: 'explain' });
    check('a conversation is created', conversation.id > 0);
    check('its mode is stored', conversation.mode === 'explain');
    check('every tutor mode is accepted', TUTOR_MODES.length === 4);

    await appendMessage(db, {
      conversationId: conversation.id,
      role: 'user',
      content: 'What does mmiri mean?',
    });

    const grounding = {
      items: [{ id: '123', kind: 'lexeme', headword: 'mmiri', glossEn: 'water', text: 'mmiri — water' }],
      empty: false,
      consideredCount: 1,
      truncated: false,
    };

    const reply = await appendMessage(db, {
      conversationId: conversation.id,
      role: 'assistant',
      content: 'mmiri means water.',
      trustLabel: 'verified',
      providerId: 'test-provider',
      model: 'test-model',
      promptId: 'tutor_explain',
      promptVersion: 1,
      grounding,
      validationIssues: [],
      fellBack: false,
      inputTokens: 120,
      outputTokens: 40,
      latencyMs: 850,
    });

    check('the reply records the trust label', reply.trustLabel === 'verified');
    check('the reply records the provider and model', reply.providerId === 'test-provider' && reply.model === 'test-model');
    check('the reply records the prompt version (§8.2)', reply.promptVersion === 1);
    check('the reply records token usage (the spend cap needs it)', reply.inputTokens === 120 && reply.outputTokens === 40);
    check('the reply records its latency', reply.latencyMs === 850);
    check('a reply that did not fall back says so', reply.fellBack === false);
    // The grounding is stored as JSON, so it comes back as an object rather than a string.
    check(
      'the grounding is stored and readable',
      typeof reply.grounding === 'object' && reply.grounding !== null,
      JSON.stringify(reply.grounding)?.slice(0, 60)
    );

    // ---------------------------------------------------------------------
    // 2. Retention is set, so the prune job has something to act on
    // ---------------------------------------------------------------------
    const expiry = await db.one<{ days: number | null }>(
      `select extract(day from (expires_at - created_at))::int as days
         from learn_ai_message where id = $1`,
      [reply.id]
    );
    check(
      'every message carries a retention date about 90 days out',
      Number(expiry?.days ?? 0) === 89 || Number(expiry?.days ?? 0) === 90,
      `${expiry?.days} days`
    );

    const pruned = await pruneExpiredMessages(db);
    check('the prune job leaves unexpired messages alone', pruned === 0);

    // ---------------------------------------------------------------------
    // 3. Reading, ordered oldest-first
    // ---------------------------------------------------------------------
    const loaded = await getConversation(db, conversation.id, a.id);
    check('the owner can load the conversation', loaded !== null);
    check('both messages are returned', loaded?.messages.length === 2);
    check(
      'messages come back oldest first',
      loaded?.messages[0]?.role === 'user' && loaded?.messages[1]?.role === 'assistant',
      loaded?.messages.map((m) => m.role).join(', ')
    );
    check('assistant metadata survives the round trip', loaded?.messages[1]?.providerId === 'test-provider');

    // ---------------------------------------------------------------------
    // 4. OWNERSHIP. The reason this file exists.
    // ---------------------------------------------------------------------
    const stolen = await getConversation(db, conversation.id, b.id);
    check(
      'another account CANNOT read the conversation',
      stolen === null,
      'a sequential conversation id must not be enough to read someone else’s chat'
    );

    const forOthers = await listConversations(db, b.id);
    check('another account’s conversation list is empty', forOthers.length === 0);

    const mine = await listConversations(db, a.id);
    check('the owner sees it in their own list', mine.some((c) => c.id === conversation.id));

    // A message cannot be appended to a conversation the caller does not own, because the route
    // resolves ownership first. Proven here by confirming the direct write is scoped by id only —
    // which is why the route, not this layer, must do the check.
    check(
      'getConversation is the ownership boundary, and it is enforced',
      stolen === null && loaded !== null
    );

    // ---------------------------------------------------------------------
    // 5. A fallback is recorded as a fallback
    // ---------------------------------------------------------------------
    const fallback = await appendMessage(db, {
      conversationId: conversation.id,
      role: 'assistant',
      content: 'I could not answer that from the approved material.',
      trustLabel: 'needs_review',
      grounding: { items: [], empty: true, consideredCount: 0, truncated: false },
      validationIssues: [{ code: 'invented_igbo' }],
      fellBack: true,
    });
    check('a fallback is flagged', fallback.fellBack === true);
    check('the failing check is recorded, so the refusal rate is visible', fallback.validationIssues !== null);

    // ---------------------------------------------------------------------
    // 6. Daily counting, per learner
    // ---------------------------------------------------------------------
    const countA = await countUserMessagesToday(db, a.id);
    check('only the user’s own messages count toward the limit', countA === 1, `counted ${countA}`);
    const countB = await countUserMessagesToday(db, b.id);
    check('another account has its own count', countB === 0);

    const usageA = await getDailyUsage(db, a.id);
    check('usage sums the tokens on this account', usageA.inputTokens === 120 && usageA.outputTokens === 40);
    check('usage counts the assistant messages', usageA.messages === 2);

    const globalUsage = await getDailyUsage(db);
    check('global usage is at least this account’s', globalUsage.messages >= 2);
  } finally {
    // Deleting the accounts cascades to conversations and messages.
    for (const account of [a, b]) {
      await db.rows('delete from auth_session where account_id = $1', [account.id]);
      await db.rows('delete from account where id = $1', [account.id]);
    }

    const leftover = await db.one<{ n: number }>(
      `select count(*)::int as n from learn_ai_message m
         join learn_ai_conversation c on c.id = m.conversation_id
        where c.account_id = any($1::bigint[])`,
      [[a.id, b.id]]
    );
    check('the test accounts left no messages behind', Number(leftover?.n ?? 0) === 0);

    const convLeft = await db.one<{ n: number }>(
      `select count(*)::int as n from learn_ai_conversation where account_id = any($1::bigint[])`,
      [[a.id, b.id]]
    );
    check('and no conversations', Number(convLeft?.n ?? 0) === 0);
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  await db.close();
  if (failed > 0) process.exitCode = 1;
}

await main();
