/**
 * Donation ledger test.
 *
 * The properties that matter here are not UI properties — they are the ones that
 * decide whether the books balance:
 *
 *   - one payment can never become two rows, however many times the gateway or
 *     the donor tells us about it
 *   - a confirmation can be delivered twice, in either order, without
 *     double-counting, and a second delivery cannot overwrite a good record
 *   - only `success` is counted as money
 *   - a `failed` row can still be settled as paid later, because the redirect can
 *     arrive before the bank has finished
 *
 * Uses references under a `TEST-` prefix and deletes exactly those rows
 * afterwards, so it is safe to run against a populated database.
 *
 *   npm -w @ozituma/db run test:donations
 */
import { closeDb, getDb } from './client.ts';
import {
  createPendingDonation,
  donationTotals,
  getDonation,
  markDonationFailed,
  markDonationPaid,
  recentDonationCount,
} from './donations.ts';

const db = await getDb();
let failures = 0;

function assert(label: string, condition: boolean, detail = ''): void {
  console.log(`  ${condition ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

const suffix = Date.now().toString(36).toUpperCase();
const email = `donor-${suffix}@example.test`;
const ref = (n: string): string => `TEST-${suffix}-${n}`;

/** A gateway payload shaped like Paystack's, for the columns that store it. */
const outcome = (amountMinor: number, status = 'success') => ({
  providerId: '12345678',
  channel: 'card',
  gatewayResponse: 'Successful',
  paidAt: '2026-01-02T03:04:05.000Z',
  payload: { status: true, data: { status, amount: amountMinor, reference: ref('A') } },
});

console.log('Donations');

try {
  // ---- a started donation exists exactly once -------------------------------
  const a = ref('A');
  await createPendingDonation(db, { reference: a, email, amountMinor: 250_000, currency: 'NGN', payerName: 'Ada', message: 'Ka ọ dị' });
  // Same reference again — a double-submitted form, or a retried initialise.
  await createPendingDonation(db, { reference: a, email, amountMinor: 999_999, currency: 'NGN' });

  const started = await getDonation(db, a);
  assert('a pending donation is recorded', started?.status === 'pending');
  assert('a repeated reference does not create a second row', started?.amountMinor === 250_000,
    `amount ${started?.amountMinor}`);
  assert('the name and message are kept', started?.payerName === 'Ada' && started?.message === 'Ka ọ dị');

  // ---- confirmation is idempotent, and never downgrades ---------------------
  const first = await markDonationPaid(db, a, outcome(250_000));
  const second = await markDonationPaid(db, a, {
    providerId: null,
    channel: null,
    gatewayResponse: 'a thinner payload arriving later',
    paidAt: null,
    payload: null,
  });
  assert('the first confirmation writes', first);
  assert('the second confirmation is a no-op, not an error', second === false);

  const paid = await getDonation(db, a);
  assert('the status is success', paid?.status === 'success');
  assert('paid_at is the gateway’s own timestamp', paid?.paidAt?.startsWith('2026-01-02') === true,
    paid?.paidAt ?? 'null');
  assert('a later thin payload does not erase the gateway detail', paid?.channel === 'card');

  // ---- a failed payment can still settle later -----------------------------
  const b = ref('B');
  await createPendingDonation(db, { reference: b, email, amountMinor: 100_000, currency: 'NGN' });
  await markDonationFailed(db, b, { gatewayResponse: 'Insufficient funds', payload: null });
  assert('a failed donation is marked failed', (await getDonation(db, b))?.status === 'failed');
  await markDonationPaid(db, b, outcome(100_000));
  assert('a failed donation can still be settled as paid', (await getDonation(db, b))?.status === 'success');

  // ---- a failure never overwrites a success --------------------------------
  await markDonationFailed(db, b, { gatewayResponse: 'a late failure event', payload: null });
  assert('a late failure does not unsay a success', (await getDonation(db, b))?.status === 'success');

  // ---- an unknown reference is not an error --------------------------------
  assert('an unknown reference reads as null', (await getDonation(db, ref('NOPE'))) === null);
  assert('confirming an unknown reference changes nothing',
    (await markDonationPaid(db, ref('NOPE'), outcome(1))) === false);

  // ---- only success counts as money ----------------------------------------
  // The totals are global, so the check is a delta rather than an absolute
  // figure: a pending row must change nothing, and confirming it must add
  // exactly its own amount and exactly one to the count.
  const c = ref('C');
  const beforePending = await donationTotals(db);
  await createPendingDonation(db, { reference: c, email, amountMinor: 500_000, currency: 'NGN' });
  const withPending = await donationTotals(db);
  assert('a pending donation is not counted as money',
    withPending.totalMinor === beforePending.totalMinor && withPending.count === beforePending.count,
    `${beforePending.totalMinor}/${beforePending.count} → ${withPending.totalMinor}/${withPending.count}`);

  await markDonationPaid(db, c, outcome(500_000));
  const after = await donationTotals(db);
  assert('confirming a donation adds exactly its amount',
    after.totalMinor === beforePending.totalMinor + 500_000,
    `${beforePending.totalMinor} → ${after.totalMinor}`);
  assert('and exactly one to the count', after.count === beforePending.count + 1);

  // ---- the rate-limit tripwire --------------------------------------------
  const recent = await recentDonationCount(db, email);
  assert('recent starts are counted per address', recent >= 3, `count ${recent}`);
  assert('counting is case-insensitive', (await recentDonationCount(db, email.toUpperCase())) === recent);
  assert('an address that never gave counts zero',
    (await recentDonationCount(db, `nobody-${suffix}@example.test`)) === 0);
  assert('a window in the past excludes everything',
    (await recentDonationCount(db, email, 0)) === 0);
} finally {
  // Only what this test made.
  await db.query(`delete from donation where reference like $1`, [`TEST-${suffix}-%`]);
  const left = await db.one<{ n: number }>(
    `select count(*)::int as n from donation where email = $1`,
    [email]
  );
  assert('the test cleaned up after itself', Number(left?.n ?? 0) === 0, `${left?.n ?? 0} rows left`);
  await closeDb();
}

console.log(failures === 0 ? '\nAll donation checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
