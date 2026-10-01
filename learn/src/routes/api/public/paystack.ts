/**
 * POST /api/public/paystack — Paystack's webhook.
 *
 * This URL is public because it has to be: Paystack calls it from their servers with no session and
 * no cookie. The only thing that makes it trustworthy is the HMAC in `x-paystack-signature`, which
 * is why that check comes before anything else in this file and why a failure is a 401 rather than
 * an exception.
 *
 * WHY THE BODY IS READ AS TEXT
 *
 * The signature is an HMAC over the EXACT bytes Paystack sent. Parsing the JSON first and
 * re-serialising it would produce different bytes — key order, whitespace, unicode escaping — and
 * the signature would never match. So `request.text()` comes first, and `JSON.parse` second.
 *
 * WHY THE AMOUNT IN THE BODY IS IGNORED
 *
 * A webhook can be replayed and, to anyone holding the secret, its body can be edited. So the
 * reference from the body is used only to ASK PAYSTACK what happened, and the amount used to decide
 * anything comes back from that verify call. The body says "look at X"; Paystack's API says what X
 * was.
 *
 * THE DATABASE WRITE USES THE SERVICE ROLE
 *
 * It has to. `guard_booking_payment()` refuses any change to `paid`, `payment_reference` or
 * `price_kobo` unless `auth.role() = 'service_role'`, which is the whole point of that trigger: a
 * learner must not be able to mark their own lesson paid, and neither must a teacher.
 */

import { createFileRoute } from '@tanstack/react-router';
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { splitPayment, verifyPaystackSignature, verifyTransaction } from '@/lib/paystack.server';

interface PaystackEvent {
  event?: string;
  data?: {
    reference?: string;
    status?: string;
    amount?: number;
    metadata?: { booking_id?: string };
  };
}

export const Route = createFileRoute('/api/public/paystack')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const raw = await request.text();
        const signature = request.headers.get('x-paystack-signature');

        if (!verifyPaystackSignature(raw, signature)) {
          // Deliberately terse. A caller who cannot sign does not get to learn why.
          return new Response('Invalid signature', { status: 401 });
        }

        let event: PaystackEvent;
        try {
          event = JSON.parse(raw) as PaystackEvent;
        } catch {
          return new Response('Bad JSON', { status: 400 });
        }

        const reference = event.data?.reference;
        if (!reference) return new Response('No reference', { status: 400 });

        // Only `charge.success` marks a booking paid. Every other event is acknowledged and ignored,
        // because returning 4xx for an event we simply do not handle makes Paystack retry it forever.
        if (event.event !== 'charge.success') {
          return Response.json({ ok: true, ignored: event.event ?? 'unknown' });
        }

        // The authority, not the body.
        const transaction = await verifyTransaction(reference);
        if (!transaction) return new Response('Could not verify', { status: 502 });

        if (transaction.status !== 'success') {
          return Response.json({ ok: true, ignored: `status=${transaction.status}` });
        }

        const supabase = supabaseAdmin;

        // Find the booking by the reference already stored on it, rather than trusting
        // `metadata.booking_id` from the body. The stored reference is the one THIS server wrote.
        const { data: booking, error: findError } = await supabase
          .from('lesson_bookings')
          .select('id, price_kobo, paid, teacher_id')
          .eq('payment_reference', reference)
          .maybeSingle();

        if (findError) return new Response('Lookup failed', { status: 500 });
        if (!booking) return new Response('Unknown reference', { status: 404 });

        // Already applied. Paystack retries, so this is the normal path on a replay, not an error —
        // and answering non-2xx would make it retry again.
        if (booking.paid) return Response.json({ ok: true, alreadyPaid: true });

        /*
         * The amount is checked against what the booking was priced at. Paystack will happily take a
         * different amount for the same reference if the checkout was tampered with, and marking a
         * ₦20,000 lesson paid on a ₦200 charge is exactly the fraud this prevents.
         */
        if (transaction.amountKobo !== booking.price_kobo) {
          console.error('[paystack] amount mismatch', {
            reference,
            expected: booking.price_kobo,
            received: transaction.amountKobo,
          });
          return Response.json({ ok: false, reason: 'amount_mismatch' }, { status: 409 });
        }

        const split = splitPayment(transaction.amountKobo);

        const { error: updateError } = await supabase
          .from('lesson_bookings')
          .update({
            paid: true,
            payment_reference: reference,
            // Re-stamped from the verified split so the payout reads the same arithmetic the
            // checkout did.
            price_kobo: split.total,
          })
          .eq('id', booking.id);

        if (updateError) {
          console.error('[paystack] update failed', updateError);
          // 500 so Paystack retries: the money has been taken and the booking is not yet marked.
          // This is the one case where a retry is genuinely wanted.
          return new Response('Update failed', { status: 500 });
        }

        /*
         * The audit row uses the columns `audit_log` actually has: `table_name`, `record_id`,
         * `action`, `new_status`. The amounts have nowhere to go in this table, so they are not
         * recorded here — the booking row and Paystack's own dashboard are the record of what was
         * paid. `actor_id` is null because the actor is Paystack, not a signed-in person.
         */
        await supabase.from('audit_log').insert({
          actor_id: null,
          table_name: 'lesson_bookings',
          record_id: booking.id,
          action: 'booking.paid',
          new_status: 'paid',
        });

        return Response.json({ ok: true, bookingId: booking.id });
      },
    },
  },
});
