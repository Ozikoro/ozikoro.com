/**
 * Starting a Paystack checkout for a lesson booking.
 *
 * THE ORDER OF OPERATIONS MATTERS HERE
 *
 * The reference is written to the booking BEFORE the learner is sent to Paystack, and that order is
 * deliberate. If it were the other way round — send them to pay, then store the reference on the way
 * back — a learner who paid and then closed the tab would have a payment that nothing could match to
 * a booking. Paystack's webhook finds the row by reference, so the row has to know it first.
 *
 * WHAT THIS REFUSES TO DO
 *
 * It does not take the price from the client. `price_kobo` is read from the booking and the teacher's
 * rate, server-side. A checkout that trusts a price sent from the browser is a checkout that sells
 * ₦20,000 lessons for ₦200.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { getRequest } from '@tanstack/react-start/server';
import { initializeTransaction, makeReference } from '@/lib/paystack.server';

const Input = z.object({ bookingId: z.string().uuid() });

export const startLessonCheckout = createServerFn({ method: 'POST' })
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data }) => {
    /*
     * The signed-in user, taken from the request's own credentials.
     *
     * The learner id is NOT accepted from the client, because a client that could name the learner
     * could start a checkout against somebody else's booking.
     */
    const request = getRequest();
    const authorization = request?.headers.get('authorization') ?? '';
    const token = authorization.replace(/^Bearer\s+/i, '');
    if (!token) return { ok: false as const, reason: 'not_signed_in' as const };

    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user) return { ok: false as const, reason: 'not_signed_in' as const };

    /*
     * Only real columns of `lesson_bookings`.
     *
     * This read `'…, teacher_profiles:hourly_rate_kobo, currency, display_name'`, which is not valid
     * PostgREST syntax. `table:column` means "alias", so it asked for a COLUMN called
     * `teacher_profiles` on `lesson_bookings` — a column that does not exist, and `currency` and
     * `display_name` belong to `teacher_profiles` too. The query therefore errored, `bookingError`
     * was truthy, and checkout returned `not_found` EVERY time. Nobody could pay for a lesson.
     *
     * None of the three were used by this function either — payment needs the booking's own id,
     * learner, price, paid flag and status, nothing from the teacher's profile. Removing them is the
     * fix, not rewriting the join: a join that is never read cannot be worth its round trip.
     */
    const { data: booking, error: bookingError } = await supabaseAdmin
      .from('lesson_bookings')
      .select('id, learner_id, price_kobo, paid, status, teacher_id')
      .eq('id', data.bookingId)
      .maybeSingle();

    if (bookingError || !booking) return { ok: false as const, reason: 'not_found' as const };

    // Only the learner on the booking may pay for it.
    if (booking.learner_id !== user.id) return { ok: false as const, reason: 'not_yours' as const };

    if (booking.paid) return { ok: false as const, reason: 'already_paid' as const };

    // Payment only makes sense once the teacher has confirmed the time.
    if (booking.status !== 'confirmed') return { ok: false as const, reason: 'not_confirmed' as const };

    const priceKobo = Number(booking.price_kobo ?? 0);
    if (priceKobo <= 0) return { ok: false as const, reason: 'no_price' as const };

    if (!user.email) return { ok: false as const, reason: 'no_email' as const };

    const reference = makeReference(booking.id);
    const origin = new URL(request.url).origin;

    const initialized = await initializeTransaction({
      email: user.email,
      amountKobo: priceKobo,
      reference,
      bookingId: booking.id,
      callbackUrl: `${origin}/platform?paid=${encodeURIComponent(reference)}`,
    });

    if (!initialized) return { ok: false as const, reason: 'paystack_failed' as const };

    // Stored before the redirect. `price_kobo` is re-stamped for the same reason the webhook
    // re-stamps it: so the payout reads what the checkout actually charged.
    const { error: stampError } = await supabaseAdmin
      .from('lesson_bookings')
      .update({ payment_reference: initialized.reference, price_kobo: priceKobo })
      .eq('id', booking.id);

    if (stampError) return { ok: false as const, reason: 'could_not_store' as const };

    return { ok: true as const, authorizationUrl: initialized.authorizationUrl, reference: initialized.reference };
  });
