/**
 * POST /api/donate — start a donation and send the donor to Paystack.
 *
 * A form endpoint, like the rest of this site, so giving does not require
 * JavaScript and the whole flow can be exercised with curl.
 *
 * THE ORDER OF OPERATIONS MATTERS
 *
 * The row is written BEFORE Paystack is called. If it were the other way round
 * there would be a window — small, but real — in which Paystack has a live
 * transaction and we have nothing to match its webhook against, and a fast
 * webhook would land on a reference we have never heard of and be discarded.
 * Writing first means every reference the gateway can mention already exists.
 *
 * If initialisation then fails the row is marked `failed` rather than deleted:
 * a donation log that silently drops its own failures is not a log.
 *
 * THE AMOUNT IS FIXED HERE, ON THE SERVER
 *
 * The donor picks an amount in the form, but the number that reaches Paystack is
 * the one this handler computed, and the amount Paystack reports back is what
 * gets recorded. The form's value is an input, never an authority.
 */
import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { getDb } from '@ozituma/db/client';
import {
  createPendingDonation,
  markDonationFailed,
  recentDonationCount,
} from '@ozituma/db/donations';
import { initializeTransaction, paystackConfigured, toMinorUnits } from '@/lib/paystack';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The bounds on a single donation, in naira.
 *
 * The floor is Paystack's own practical minimum for a card charge — below it the
 * fee eats the gift and the donor is worse off for having given. The ceiling is
 * not a limit on generosity; it is a sanity check that catches a slipped decimal
 * point before it reaches a card, because a mistyped amount is far more painful
 * to undo than to prevent.
 */
const MIN_MAJOR = 100;
const MAX_MAJOR = 5_000_000;

/** Only the naira for now. Paystack settles what the account is registered for. */
const CURRENCY = 'NGN';

/** Starts allowed per email address per hour — see recentDonationCount. */
const STARTS_PER_HOUR = 20;

function redirectTo(path: string, params: Record<string, string> = {}): NextResponse {
  // Relative Location, for the reasons set out in app/api/auth: absolute would
  // need a configured base or a caller-controlled Host header.
  const search = new URLSearchParams(params).toString();
  const location = search.length > 0 ? `${path}?${search}` : path;
  return new NextResponse(null, { status: 303, headers: { Location: location } });
}

function formValue(form: FormData, name: string, max = 400): string {
  const raw = form.get(name);
  return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
}

/**
 * Build the public callback URL.
 *
 * This is the one place on the site that genuinely needs an absolute URL — the
 * browser leaves for paystack.co and has to be told where to come back to — so
 * unlike the other redirects here it must be configured rather than relative.
 * It must also match the callback URL registered on the Paystack account.
 */
function callbackUrl(): string {
  const base = (process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com').replace(/\/+$/, '');
  return `${base}/donate/thanks`;
}

/**
 * A reference that is unique and legible.
 *
 * Paystack accepts letters, digits, `-`, `.` and `=`. Time-prefixed so that
 * references sort in the order they were created when read raw out of the
 * database, with random bytes appended so two donations in the same millisecond
 * still differ. The `OZI-` prefix makes our transactions identifiable in the
 * Paystack dashboard next to anything else the account does.
 */
function newReference(): string {
  return `OZI-${Date.now().toString(36).toUpperCase()}-${randomBytes(5).toString('hex').toUpperCase()}`;
}

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();

  // Honeypot: a field no person can see and no person fills in. Answered as if
  // it had worked, so a script learns nothing, but no row and no gateway call.
  if (formValue(form, 'website').length > 0) {
    return redirectTo('/donate/thanks');
  }

  // Checked before the form is read: if the gateway is not configured then no
  // answer to the form would be actionable, and "the amount is missing" would be
  // a confusing thing to say when the real problem is on our side.
  if (!paystackConfigured()) {
    // Better an honest message than a 500 in front of someone trying to give.
    return redirectTo('/donate', { error: 'Donations are not open yet. Please try again shortly.' });
  }

  // The "other" box wins when it is filled; otherwise the chosen preset. See the
  // note in app/donate/page.tsx for why the form has two amount fields.
  const raw = (formValue(form, 'other', 40) || formValue(form, 'amount', 40)).replace(/[,\s₦]/g, '');
  const major = Number(raw);

  if (!Number.isFinite(major) || major <= 0) {
    return redirectTo('/donate', { error: 'Enter an amount to give.' });
  }
  if (major < MIN_MAJOR) {
    return redirectTo('/donate', { error: `The smallest donation is ₦${MIN_MAJOR.toLocaleString('en-NG')}.` });
  }
  if (major > MAX_MAJOR) {
    return redirectTo('/donate', {
      error: 'That amount is larger than this form accepts. Please get in touch instead.',
    });
  }

  const email = formValue(form, 'email', 200).toLowerCase();
  // Deliberately loose: the real validation is that Paystack issues a receipt to
  // it, and a strict pattern here would reject valid unusual addresses.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return redirectTo('/donate', { error: 'Enter an email address so we can send you a receipt.' });
  }

  const amountMinor = toMinorUnits(major);
  const reference = newReference();
  const payerName = formValue(form, 'name', 120) || null;
  const message = formValue(form, 'message', 500) || null;

  const db = await getDb();

  if ((await recentDonationCount(db, email)) >= STARTS_PER_HOUR) {
    return redirectTo('/donate', {
      error: 'That is a lot of attempts in a short time. Please wait a little and try again.',
    });
  }

  await createPendingDonation(db, {
    reference,
    email,
    amountMinor,
    currency: CURRENCY,
    payerName,
    message,
  });

  const result = await initializeTransaction({
    email,
    amountMinor,
    currency: CURRENCY,
    reference,
    callbackUrl: callbackUrl(),
    // Shown on the Paystack checkout page and kept on the transaction there, so
    // a donation can be recognised in their dashboard without our database.
    metadata: {
      project: 'Ozikoro',
      site: 'ozituma.com',
      ...(payerName ? { donor_name: payerName } : {}),
      ...(message ? { donor_message: message } : {}),
    },
  });

  if ('ok' in result) {
    await markDonationFailed(db, reference, { gatewayResponse: result.message, payload: null });
    return redirectTo('/donate', { error: `${result.message} Nothing has been charged.` });
  }

  // 303 to the gateway's own checkout page. The donor's card details are only
  // ever entered there; nothing about a card touches this server.
  return redirectTo(result.authorizationUrl);
}
