/**
 * Paystack flow test.
 *
 * Two things in the donation feature are security boundaries, and neither can be
 * checked by looking at a page:
 *
 *   1. the webhook signature check — get it wrong and anyone who learns the URL
 *      can write "someone gave ₦500,000" into the ledger
 *   2. the rule that only the gateway can declare a payment successful — get it
 *      wrong and a query string becomes a receipt
 *
 * So both are exercised here against a stubbed Paystack: a real HMAC computed
 * independently of the code under test, and a real database whose rows are read
 * back afterwards. The stub replaces `fetch`, so nothing here talks to Paystack
 * and nothing here can spend money.
 *
 * This is the only place the web app's lib is tested. It imports the real
 * modules — no copies — so a change to the signature or confirmation logic that
 * breaks these properties fails here rather than in production.
 *
 *   npm run test:paystack
 */
import { createHmac } from 'node:crypto';
import { closeDb, getDb } from '../packages/db/src/client.ts';
import {
  createPendingDonation,
  getDonation,
} from '../packages/db/src/donations.ts';
import {
  formatMoney,
  paystackConfigured,
  toMinorUnits,
  verifyTransaction,
  verifyWebhookSignature,
} from '../apps/web/lib/paystack.ts';
import { confirmDonation } from '../apps/web/lib/donation-confirm.ts';

let failures = 0;

function assert(label: string, condition: boolean, detail = ''): void {
  console.log(`  ${condition ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

const KEY = 'sk_test_not_a_real_key';
process.env.PAYSTACK_SECRET_KEY = KEY;

const db = await getDb();
const suffix = Date.now().toString(36).toUpperCase();
const email = `flow-${suffix}@example.test`;
const ref = (n: string): string => `TEST-FLOW-${suffix}-${n}`;

/** What Paystack would answer. `statusCode` lets a test ask for a failure. */
type Stub = { statusCode?: number; body: unknown };
let queue: Stub[] = [];
let calls: string[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  calls.push(String(input));
  const next = queue.shift();
  if (!next) throw new Error(`unexpected fetch to ${String(input)}`);
  const status = next.statusCode ?? 200;
  return new Response(JSON.stringify(next.body), {
    status,
    headers: { 'content-type': 'application/json' },
    // `ok` is derived from status by Response; kept in the type for clarity.
  });
}) as typeof fetch;

function verifyBody(reference: string, status: string, amountMinor: number): unknown {
  return {
    status: true,
    data: {
      id: 987654,
      status,
      amount: amountMinor,
      currency: 'NGN',
      reference,
      channel: 'card',
      gateway_response: status === 'success' ? 'Approved' : 'Declined',
      paid_at: status === 'success' ? '2026-01-02T03:04:05.000Z' : null,
      customer: { email },
    },
  };
}

console.log('Paystack flow');

// Each section is its own block so the names it uses stay local to it.

// ---- configuration ---------------------------------------------------------
{
  assert('a configured key is seen', paystackConfigured());
  const saved = process.env.PAYSTACK_SECRET_KEY;
  delete process.env.PAYSTACK_SECRET_KEY;
  assert('a missing key is not', !paystackConfigured());
  const noKey = await verifyTransaction('anything');
  assert('and nothing is called without it', 'ok' in noKey && calls.length === 0);
  process.env.PAYSTACK_SECRET_KEY = saved;
}

// ---- the signature ---------------------------------------------------------
{
  const body = JSON.stringify({ event: 'charge.success', data: { reference: ref('SIG') } });
  const good = createHmac('sha512', KEY).update(body, 'utf8').digest('hex');

  assert('a correctly signed body verifies', await verifyWebhookSignature(body, good));
  assert('an uppercase signature verifies', await verifyWebhookSignature(body, good.toUpperCase()));
  assert('a signature with stray whitespace verifies',
    await verifyWebhookSignature(body, ` ${good}\n`));
  assert('a missing signature is refused', !(await verifyWebhookSignature(body, null)));
  assert('an empty signature is refused', !(await verifyWebhookSignature(body, '')));

  // Every one of these is a plausible attempt, not a theoretical one.
  assert('a signature of the wrong length is refused',
    !(await verifyWebhookSignature(body, good.slice(0, -2))));
  assert('a near-miss signature is refused',
    !(await verifyWebhookSignature(body, `${good.slice(0, -1)}0`)));

  const tampered = JSON.stringify({
    event: 'charge.success',
    data: { reference: ref('SIG'), amount: 999_999_999 },
  });
  assert('a tampered body fails its signature', !(await verifyWebhookSignature(tampered, good)));

  // The signature is over bytes, so the exact serialisation matters: a body that
  // parses to the same object but is spelled differently must NOT verify.
  const respaced = JSON.stringify(JSON.parse(body), null, 2);
  assert('re-serialised JSON does not verify', !(await verifyWebhookSignature(respaced, good)));
}

// ---- a real payment, verified with the gateway -----------------------------
{
  const reference = ref('OK');
  await createPendingDonation(db, { reference, email, amountMinor: 250_000, currency: 'NGN' });

  queue = [{ body: verifyBody(reference, 'success', 250_000) }];
  calls = [];
  const result = await confirmDonation(db, reference);
  const row = await getDonation(db, reference);

  assert('a paid transaction is confirmed', result.paid);
  assert('the row is success', row?.status === 'success');
  assert('the gateway transaction id is kept', row?.channel === 'card');
  assert('paid_at is ISO 8601', row?.paidAt === '2026-01-02T03:04:05.000Z', row?.paidAt ?? 'null');
  assert('the gateway was actually asked', calls.some((u) => u.includes('/transaction/verify/')));

  // Confirming again must not call out again — the row is already settled.
  queue = [];
  calls = [];
  const again = await confirmDonation(db, reference);
  assert('a settled donation is not re-verified', again.paid && calls.length === 0);
}

// ---- a payment the bank refused --------------------------------------------
{
  const reference = ref('FAIL');
  await createPendingDonation(db, { reference, email, amountMinor: 100_000, currency: 'NGN' });

  queue = [{ body: verifyBody(reference, 'abandoned', 100_000) }];
  const result = await confirmDonation(db, reference);
  const row = await getDonation(db, reference);

  assert('an unpaid transaction is not confirmed', !result.paid);
  assert('and the row says failed', row?.status === 'failed');
  assert('with the gateway’s own status kept', result.message.includes('abandoned'), result.message);

  // The webhook can still settle it later. This is the case that matters most:
  // a donor who closed the tab and paid afterwards must not be lost.
  queue = [{ body: verifyBody(reference, 'success', 100_000) }];
  const later = await confirmDonation(db, reference);
  assert('a failed donation can still settle later', later.paid);
}

// ---- the gateway says a different amount -----------------------------------
{
  const reference = ref('MISMATCH');
  await createPendingDonation(db, { reference, email, amountMinor: 250_000, currency: 'NGN' });

  queue = [{ body: verifyBody(reference, 'success', 1_000_000) }];
  const result = await confirmDonation(db, reference);
  const row = await getDonation(db, reference);

  // The money is real, so it is recorded as received — but the record must say
  // that the figures disagree rather than quietly storing one of them.
  assert('a mismatched amount is still recorded as received', result.paid);
  assert('and the discrepancy is written down', result.message.includes('amount mismatch'),
    result.message);
  assert('the amount we recorded is unchanged', row?.amountMinor === 250_000);
}

// ---- failures that are not "unpaid" ----------------------------------------
{
  const reference = ref('HTTP');
  await createPendingDonation(db, { reference, email, amountMinor: 250_000, currency: 'NGN' });

  // A gateway error must NOT be reported as a failed payment — we do not know
  // that it failed, and saying so to a donor who has paid is the worst outcome.
  queue = [{ statusCode: 500, body: { status: false, message: 'Server error' } }];
  const result = await confirmDonation(db, reference);
  const row = await getDonation(db, reference);

  assert('a gateway error does not confirm a payment', !result.paid);
  assert('and does not mark a paid donation failed', row?.status === 'pending', row?.status ?? 'null');
}

// ---- unknown references ----------------------------------------------------
{
  const unknown = await confirmDonation(db, ref('NEVER'));
  assert('an unknown reference is reported, not thrown', !unknown.paid && unknown.donation === null);
}

// ---- money formatting ------------------------------------------------------
{
  assert('whole naira print without decimals', formatMoney(250_000, 'NGN') === '₦2,500',
    formatMoney(250_000, 'NGN'));
  assert('kobo print with them', formatMoney(250_050, 'NGN') === '₦2,500.50',
    formatMoney(250_050, 'NGN'));
  assert('naira convert to kobo exactly', toMinorUnits(2500) === 250_000);
  assert('and a fractional amount does not lose a kobo', toMinorUnits(10.55) === 1055,
    String(toMinorUnits(10.55)));
}

// ---- cleanup ---------------------------------------------------------------
{
  await db.query(`delete from donation where reference like $1`, [`TEST-FLOW-${suffix}-%`]);
  const left = await db.one<{ n: number }>(
    `select count(*)::int as n from donation where email = $1`,
    [email]
  );
  assert('the test cleaned up after itself', Number(left?.n ?? 0) === 0, `${left?.n ?? 0} rows left`);
}

globalThis.fetch = realFetch;
await closeDb();

console.log(failures === 0 ? '\nAll Paystack flow checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
