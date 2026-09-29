/**
 * Donations — the record, not the gateway.
 *
 * Paystack talks to us in two ways and both have to land on the same row without
 * ever double-counting:
 *
 *   1. the donor comes back from checkout to /donate/thanks
 *   2. Paystack posts a webhook, possibly before (1), possibly after, possibly
 *      both, possibly twice
 *
 * So the row is created as `pending` when the transaction is initialised, and
 * every later event updates that row by its reference. There is no insert path
 * that can produce a second row for one payment.
 *
 * Nothing in this module trusts a caller's word that money arrived. `markPaid`
 * is called only after the gateway itself has been asked — see lib/paystack.ts.
 */
import type { Db } from './client.ts';

export type DonationStatus = 'pending' | 'success' | 'failed' | 'abandoned';

export interface Donation {
  id: number;
  reference: string;
  email: string;
  amountMinor: number;
  currency: string;
  status: DonationStatus;
  payerName: string | null;
  message: string | null;
  channel: string | null;
  paidAt: string | null;
}

/**
 * Timestamps come back as `Date` objects from both drivers (PGlite and node-pg),
 * and `String(date)` is a locale-dependent rendering — "Fri Jan 02 2026
 * 04:04:05 GMT+0100 (West Africa Time)" — which is neither stable across servers
 * nor parseable by anything else. ISO 8601 or nothing.
 */
function timestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapDonation(row: Record<string, unknown>): Donation {
  return {
    id: Number(row.id),
    reference: String(row.reference),
    email: String(row.email),
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency),
    status: String(row.status) as DonationStatus,
    payerName: (row.payer_name as string | null) ?? null,
    message: (row.message as string | null) ?? null,
    channel: (row.channel as string | null) ?? null,
    paidAt: timestamp(row.paid_at),
  };
}

export interface NewDonation {
  reference: string;
  email: string;
  amountMinor: number;
  currency: string;
  payerName?: string | null;
  message?: string | null;
}

/** Record that a transaction has been started. Idempotent on the reference. */
export async function createPendingDonation(db: Db, donation: NewDonation): Promise<void> {
  await db.query(
    `insert into donation
       (reference, email, amount_minor, currency, payer_name, message, status)
     values ($1, $2, $3, $4, $5, $6, 'pending')
     on conflict (reference) do nothing`,
    [
      donation.reference,
      donation.email,
      donation.amountMinor,
      donation.currency,
      donation.payerName ?? null,
      donation.message ?? null,
    ]
  );
}

/** Look a donation up by the reference on the URL a donor returns with. */
export async function getDonation(db: Db, reference: string): Promise<Donation | null> {
  const row = await db.one<Record<string, unknown>>(
    `select * from donation where reference = $1`,
    [reference]
  );
  return row ? mapDonation(row) : null;
}

export interface GatewayOutcome {
  providerId: string | null;
  channel: string | null;
  gatewayResponse: string | null;
  paidAt: string | null;
  payload: unknown;
}

/**
 * Record a successful payment.
 *
 * `where status <> 'success'` in the update is what makes this idempotent: the
 * second caller — the webhook arriving after the redirect, or a refreshed
 * thank-you page — changes nothing and is not an error. The donor's paid_at and
 * the gateway's own payload are written on the first success only, so they
 * cannot be overwritten by a later, thinner payload.
 */
export async function markDonationPaid(
  db: Db,
  reference: string,
  outcome: GatewayOutcome
): Promise<boolean> {
  const result = await db.query(
    `update donation set
       status = 'success',
       provider_id = coalesce($2, provider_id),
       channel = coalesce($3, channel),
       gateway_response = coalesce($4, gateway_response),
       paid_at = coalesce($5::timestamptz, paid_at, now()),
       provider_payload = coalesce($6::jsonb, provider_payload),
       updated_at = now()
     where reference = $1 and status <> 'success'`,
    [
      reference,
      outcome.providerId,
      outcome.channel,
      outcome.gatewayResponse,
      outcome.paidAt,
      outcome.payload === undefined ? null : JSON.stringify(outcome.payload),
    ]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Record a payment that the gateway says did not succeed. */
export async function markDonationFailed(
  db: Db,
  reference: string,
  outcome: Pick<GatewayOutcome, 'gatewayResponse' | 'payload'>
): Promise<void> {
  await db.query(
    `update donation set
       status = case when status = 'success' then status else 'failed' end,
       gateway_response = coalesce($2, gateway_response),
       provider_payload = coalesce($3::jsonb, provider_payload),
       updated_at = now()
     where reference = $1`,
    [
      reference,
      outcome.gatewayResponse ?? null,
      outcome.payload === undefined ? null : JSON.stringify(outcome.payload),
    ]
  );
}

/**
 * How many donations this email address has started recently.
 *
 * The donate form is a public, unauthenticated endpoint that both writes a row
 * and calls a payment gateway, so it is the one place on this site where an
 * unauthenticated caller costs us something. This is not security — Paystack
 * does the real abuse handling, and a determined attacker can vary the address —
 * it is a tripwire so that one script cannot fill the table or hammer the
 * gateway through us. Twenty starts an hour is far more than a real donor.
 */
export async function recentDonationCount(
  db: Db,
  email: string,
  withinMinutes = 60
): Promise<number> {
  const row = await db.one<{ n: number }>(
    `select count(*)::int as n
       from donation
      where lower(email) = lower($1)
        and created_at > now() - make_interval(mins => $2)`,
    [email, withinMinutes]
  );
  return Number(row?.n ?? 0);
}

/** What has actually been received. Only `success` counts. */
export async function donationTotals(
  db: Db
): Promise<{ count: number; totalMinor: number; currency: string }> {
  const row = await db.one<{ n: number; total: string | null; currency: string | null }>(
    `select count(*)::int as n,
            sum(amount_minor) as total,
            min(currency) as currency
       from donation where status = 'success'`
  );
  return {
    count: Number(row?.n ?? 0),
    totalMinor: Number(row?.total ?? 0),
    currency: row?.currency ?? 'NGN',
  };
}
