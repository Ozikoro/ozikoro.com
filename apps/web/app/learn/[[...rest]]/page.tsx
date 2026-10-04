import type { Metadata } from 'next';

/**
 * `ozituma.com/learn` — where the courses used to send a reader, and what it says now.
 *
 * ── WHAT THIS ROUTE WAS, AND WHY IT IS NOT THAT ANY MORE ────────────────────────────────────────
 *
 * It used to be a `permanentRedirect` to `learn.ozituma.com`: the courses had their own app and their own
 * deployment, so this path existed to keep two things working — the "Learn" item in this site's own
 * navigation, and any link already shared, because `ozituma.com/learn/igbo/saying-hello` was a real
 * address before the split and a 404 there is a broken link in somebody's message.
 *
 * **THE COURSES HOST WAS RETIRED ENTIRE ON 2026-10-04** — its Worker, its DNS and its database — on the
 * owner's instruction to delete everything associated with it, with `academy.ozikoro.com` replacing it.
 * So the redirect had to go: a redirect is the most emphatic link a site can make, and pointing a reader
 * at a host that is being retired is worse than pointing at nothing. It would be worse again now, when
 * that host does not resolve at all.
 *
 * ── WHY IT IS A PAGE RATHER THAN A SECOND REDIRECT, AND RATHER THAN A 404 ───────────────────────
 *
 * `academy.ozikoro.com` has no record in the `ozikoro.com` zone today, so redirecting there would be a
 * redirect to a 404 — a worse failure than the one being fixed, because it looks correct in the source
 * and in the status line of the first hop.
 *
 * And deleting the route would 404 every shared `/learn/…` address, which is the fault the route was
 * written to prevent. **The honest interim is that this page says the academy is being prepared**, which
 * is the same rule the archive's own `/academy/` page follows: an unrecorded thing is stated rather than
 * guessed at.
 *
 * THE `[[...rest]]` CATCH-ALL IS KEPT ON PURPOSE. `/learn/igbo/saying-hello` is a real address people
 * hold; the shape of the route is what makes every one of those land here rather than on the 404 page.
 * The parameter is deliberately unread: the course it named is not on this site and there is nothing
 * course-specific this page could truthfully say.
 *
 * `OZITUMA_LEARN_URL` IS NO LONGER READ HERE, AND THAT IS THE POINT. It defaulted to the retiring host,
 * so a deployment that had never set it would have kept redirecting readers there. The variable is still
 * documented in `.env.example` for the academy's own build to use; this route no longer depends on it.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'The Academy',
  description:
    'The Ozikoro Academy is being prepared. Its courses in Igbo language and culture will be taught at academy.ozikoro.com.',
};

export default function LearnPage() {
  return (
    <div className="wrap wrap-narrow">
      <h1>The Academy is being prepared</h1>

      <p className="hero-lede">
        The language courses are moving to the Ozikoro Academy at{' '}
        <span className="mono">academy.ozikoro.com</span>. That host does not answer yet, so there is
        nothing here to send you to — and this page says so rather than redirecting you to a door that
        is not built.
      </p>

      <section className="section">
        <h2>What this means for a link you already have</h2>
        <p>
          Every course address under <span className="mono">ozituma.com/learn/…</span> still resolves, and
          it lands here. Nothing you saved or shared has become a broken link.
        </p>
        <p>
          While the academy is being built, the dictionary itself is unchanged and complete: the words,
          their meanings, their pronunciations and their example sentences are all at{' '}
          <a href="/">the dictionary home</a>, and the history and archive behind them is at{' '}
          <a href="https://ozikoro.com/">ozikoro.com</a>.
        </p>
      </section>
    </div>
  );
}
