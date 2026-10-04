/**
 * test-narration-gate — proves that nothing reaches ElevenLabs before the gates, WITHOUT spending a credit.
 *
 * WHY THIS CAN BE TESTED AT ALL
 *
 * A render is billed per character, so a mechanism whose only proof is a live render can only be tested by
 * spending the money it exists to protect. **Round 313 recorded that reasoning for the pronunciation gate and
 * this file applies it to the whole path**: `globalThis.fetch` is replaced with a recording stub, so every
 * request the renderer would make is observed instead of sent, and the speech endpoint is refused by the
 * harness. If the code tried to spend, this test would catch it and the call would not leave the machine.
 *
 * WHAT IS ASSERTED
 *
 *   1. THE STATUS GATE. Every status the episode table can hold EXCEPT the ones a re-render starts from is
 *      refused with `not_awaiting_approval`, and NOT ONE fetch is recorded — including `published` with no
 *      approval record, which is the state the public surfaces now refuse.
 *   2. THE ORDER OF THE GATES, MEASURED. For a renderable proposal the recorded calls are
 *      `GET /v1/user/subscription` (free, the allowance) and only then `POST /v1/text-to-speech/…`. The stub
 *      throws on the second, so the assertion is about the ORDER and nothing is billed.
 *   3. THE CAPABILITY. `manage_ai_corpus` — the permission that authorises the charge — is held by admin and
 *      owner and by nobody else, asked of the database rather than of the code.
 *   4. THE ROW IS UNCHANGED when a gate refuses: no storage key, no `pending_review`, no transition.
 *
 * Run against a COPY of the cluster (this refuses anything else):
 *
 *   OZITUMA_DB_PATH=.data/scratch-r323/pg \
 *     ELEVENLABS_API_KEY=sk_dummy_for_the_gate_test ELEVENLABS_VOICE_ID_OWN=dummy_voice \
 *     node scripts/test-narration-gate.ts
 */
import { closeDb, getDb, type Db } from '@ozituma/db/client';
import { can } from '@ozikoro/platform';
import { renderProposedNarration } from '../apps/ozikoro/lib/render-episode.ts';

if (!process.env.OZITUMA_DB_PATH?.includes('scratch')) {
  console.error('refusing: this must run against a scratch cluster, not', process.env.OZITUMA_DB_PATH);
  process.exit(2);
}

const calls: string[] = [];
const realFetch = globalThis.fetch;

/*
 * THE STUB IS INSTALLED BEFORE THE FIRST RENDER CALL AND IS THE ONLY WAY OUT OF THIS PROCESS.
 *
 * `/v1/user/subscription` is free and is allowed to be asked (it is how the allowance is read); the speech
 * endpoint is refused by the harness, so a render that got that far is REPORTED rather than paid for.
 */
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  calls.push(`${init?.method ?? 'GET'} ${url}`);
  if (url.includes('/v1/text-to-speech/')) {
    throw new Error('GATE-TEST-REFUSAL: the harness refused to let the speech request leave the machine');
  }
  if (url.includes('/v1/user/subscription')) {
    return new Response(JSON.stringify({ tier: 'starter', character_count: 43_448, character_limit: 65_000 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
}) as unknown as typeof fetch;

let failures = 0;
const assert = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const db: Db = await getDb();

/** Every status the CHECK constraint allows, asked of the database rather than typed. */
const constraint = await db.one<{ def: string }>(
  `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'ozikoro_episode_status_check'`
);
const allowed = [...(constraint?.def ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
console.log(`\n  The constraint allows: ${allowed.join(', ')}\n`);

const RENDERABLE = new Set(['proposed', 'corrections', 'failed']);

console.log('1. THE STATUS GATE — no request for anything a render may not start from\n');
for (const status of allowed.filter((s) => !RENDERABLE.has(s))) {
  const row = await db.one<{ slug: string }>(
    `select slug from ozikoro_episode where status = $1 order by id limit 1`,
    [status]
  );
  if (!row) {
    console.log(`  skip  ${status.padEnd(15)} no episode in the scratch cluster holds this status`);
    continue;
  }
  const before = calls.length;
  const result = await renderProposedNarration(db, { slug: row.slug, actorId: 199 });
  const made = calls.length - before;
  assert(
    `${status.padEnd(15)} refused (${result.ok ? 'RENDERED?!' : result.code})`,
    !result.ok && result.code === 'not_awaiting_approval',
    result.ok ? 'A RENDER WAS ATTEMPTED' : result.message.slice(0, 70)
  );
  assert(`${status.padEnd(15)} made no request at all`, made === 0, `${made} request(s)`);
}

/*
 * `published` IS THE STATUS THE OWNER'S RULE IS ABOUT, and a row in it with no approval record is the exact
 * state the article, the feed and the transcript now refuse. It is not renderable either: a re-render of a
 * live episode is a new decision, not a retry.
 */
const unapproved = await db.one<{ slug: string; status: string }>(
  `select slug, status from ozikoro_episode where status = 'published' and approved_at is null order by id limit 1`
);
if (unapproved) {
  const before = calls.length;
  const result = await renderProposedNarration(db, { slug: unapproved.slug, actorId: 199 });
  assert(
    'published without an approval record is refused as a render source',
    !result.ok && result.code === 'not_awaiting_approval',
    result.ok ? 'RENDERED?!' : result.code
  );
  assert('published without an approval record made no request', calls.length === before);
} else {
  console.log('  skip  no published-without-approval row exists to try');
}

console.log('\n2. THE ORDER OF THE GATES — what a renderable proposal actually reaches\n');
const proposal = await db.one<{ slug: string; id: number; storage_key: string | null }>(
  `select slug, id, storage_key from ozikoro_episode where status = 'proposed' order by id limit 1`
);
if (!proposal) {
  console.log('  skip  no proposal exists in the scratch cluster');
} else {
  const before = calls.length;
  const result = await renderProposedNarration(db, { slug: proposal.slug, actorId: 199 });
  const made = calls.slice(before);
  console.log(`  calls recorded for “${proposal.slug}”:`);
  for (const c of made) console.log(`     ${c}`);
  const speechAt = made.findIndex((c) => c.includes('/v1/text-to-speech/'));
  const allowanceAt = made.findIndex((c) => c.includes('/v1/user/subscription'));
  const reachedSpeech = speechAt !== -1;
  assert(
    'the free allowance read happens before the billed render',
    !reachedSpeech || (allowanceAt !== -1 && allowanceAt < speechAt),
    reachedSpeech ? `allowance at ${allowanceAt}, speech at ${speechAt}` : 'the render was refused before either'
  );
  assert(
    'the billed request was REFUSED BY THIS HARNESS, so nothing was spent',
    !result.ok,
    result.ok ? 'IT SUCCEEDED — THE STUB DID NOT HOLD' : `${result.code}: ${result.message.slice(0, 90)}`
  );
  const after = await db.one<{ status: string; storage_key: string | null }>(
    `select status, storage_key from ozikoro_episode where id = $1`,
    [proposal.id]
  );
  assert(
    'a refused render leaves the row exactly as it was',
    after?.status === 'proposed' && after?.storage_key === proposal.storage_key,
    `status=${after?.status} storage_key=${after?.storage_key ?? 'null'}`
  );
  const transitions = await db.one<{ n: number }>(
    `select count(*)::int as n from ozikoro_episode_transition where episode_id = $1 and to_status = 'pending_review'`,
    [proposal.id]
  );
  assert('no transition to pending_review was written', (transitions?.n ?? 0) === 0);
}

console.log('\n3. THE CAPABILITY THAT AUTHORISES THE CHARGE\n');
const holders = await db.rows<{ role: string }>(
  `select role from ozikoro_role_capability where capability = 'manage_ai_corpus' order by role`
);
const roles = holders.map((h) => h.role);
assert('manage_ai_corpus is held by admin and owner', roles.includes('admin') && roles.includes('owner'), roles.join(', '));
assert('manage_ai_corpus is NOT held by editor', !roles.includes('editor'), roles.join(', '));
const editor = await db.one<{ id: number }>(
  `select account_id as id from ozikoro_member_role where role = 'editor' order by account_id limit 1`
);
if (editor) {
  assert('an editor account cannot authorise the spend', (await can(db, editor.id, 'manage_ai_corpus')) === false);
} else {
  console.log('  skip  no editor account exists to ask');
}
const owner = await db.one<{ id: number }>(
  `select account_id as id from ozikoro_member_role where role = 'owner'
    union all
   select id as id from account where role::text = 'owner'
   order by id limit 1`
);
if (owner) {
  assert('the owner account can authorise the spend', (await can(db, owner.id, 'manage_ai_corpus')) === true);
} else {
  console.log('  skip  no owner account exists to ask');
}

globalThis.fetch = realFetch;
await closeDb();

console.log('');
if (failures > 0) {
  console.error(`  ${failures} assertion(s) FAILED.`);
  process.exit(1);
}
console.log('  All gate assertions passed. No request reached the speech endpoint; no credit was spent.');
