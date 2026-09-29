-- Donations.
--
-- Ozikoro is funded by the people who use it, and this is the record of that.
-- Deliberately a table of its own rather than rows in something existing: a
-- donation is money, it has a payment gateway's identifier on it, and it must be
-- reconcilable against Paystack's own records months later. Nothing here is
-- derived from the dictionary and nothing in the dictionary depends on it.
--
-- AMOUNTS ARE IN MINOR UNITS
--
-- `amount_minor` is kobo for NGN, cents for USD — the smallest unit of the
-- currency, which is what Paystack itself uses. Storing a decimal would mean
-- choosing a rounding rule at some point and getting it wrong; integers cannot
-- lose a kobo.
--
-- THE REFERENCE IS THE IDENTITY
--
-- Paystack returns a `reference` when a transaction is initialised and it is
-- unique per transaction, so it is the table's unique key. That is what makes
-- both confirmation paths idempotent: the redirect back from Paystack and the
-- webhook can arrive in either order, or twice, or the donor can refresh the
-- thank-you page, and the row still updates exactly once.
--
-- STATUS
--
--   pending    initialised with Paystack, not yet confirmed paid
--   success    verified with the gateway (or confirmed by a signed webhook)
--   failed     the gateway says it did not succeed
--   abandoned  the donor never came back and the gateway has no record of a
--              payment; a reconciliation job may settle these later
--
-- Only `success` counts as money received. Nothing else is ever summed.

create table donation (
  id                bigserial primary key,

  -- Paystack's transaction reference. The natural key for reconciliation.
  reference         text not null unique,
  provider          text not null default 'paystack',

  email             text not null,
  amount_minor      bigint not null check (amount_minor > 0),
  currency          text not null default 'NGN',

  status            text not null default 'pending'
                    check (status in ('pending', 'success', 'failed', 'abandoned')),

  -- Optional, and only ever what the donor chose to give us.
  payer_name        text,
  message           text,

  -- What the gateway told us, kept verbatim so a dispute or a refund can be
  -- reconciled without re-querying Paystack for a transaction from last year.
  provider_id       text,
  channel           text,
  gateway_response  text,
  paid_at           timestamptz,
  provider_payload  jsonb,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index donation_status_idx on donation (status);
create index donation_email_idx on donation (lower(email));
-- The common read is "what has actually been received, newest first".
create index donation_received_idx on donation (paid_at desc)
  where status = 'success';

comment on table donation is
  'Donations received through Paystack. amount_minor is in the currency''s '
  'smallest unit (kobo for NGN). Only rows with status = ''success'' are money '
  'received; the reference is Paystack''s own transaction reference and is what '
  'makes both the redirect and the webhook idempotent.';
