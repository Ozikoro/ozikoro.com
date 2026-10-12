/**
 * Claiming your own byline.
 *
 * Eleven people wrote the 1,051 records migrated from the old site. Their names are on the work and
 * they have no accounts, so the archive currently attributes writing to names that cannot answer for
 * it or correct it.
 *
 * This screen closes that: an author signs in, sees the bylines that might be theirs, and asks for
 * one with whatever evidence they can give. An editor then checks it against the archive before it is
 * granted, because approving a claim hands somebody the authorship of published records.
 *
 * It is deliberately reachable by anybody with an account, with no role required. The person who
 * wrote the work is not an editor.
 *
 * ── WHAT THIS SCREEN GOT WRONG, AND THE OWNER FOUND BY USING IT ──────────────────────────────────────
 *
 * Its heading said "Your bylines" and its copy said "If your name is on records in this archive, claim
 * it here" — and what it actually served was **every unclaimed byline in the archive, largest first, for
 * every signed-in person.** The owner opened it, pressed "Claim this byline" on the first row, and was
 * shown *"Emeka Esogbue — 524 records in the archive"*, a name that is not his. He was right to be
 * confused: three separate things were wrong with that one row.
 *
 *   1 · The list was not about him at all. `$1` decided only his own claim status per row; it never
 *       decided which rows appeared.
 *   2 · "524 records" counted DRAFTS. All 524 of Emeka Esogbue's records are WordPress imports left in
 *       `review`, and **none is published** — while the third row, Kosisochukwu Nzeribe, carried 282
 *       records a reader can actually open. So the page led with the byline with nothing to show.
 *   3 · It was sorted by that count, so the largest number came first — which is also the most valuable
 *       byline to claim falsely.
 *
 * The three are answered where they belong rather than here: the counting and the ordering are in
 * `listClaimableBylines`, and the matching is in its documented match rule beside it. This file renders
 * what that returns, puts the account's own matches first and says why each is there, and states the
 * draft count honestly instead of presenting imports as findable work.
 *
 * ── AND IT DOES NOT HIDE ANYBODY ─────────────────────────────────────────────────────────────────────
 *
 * The bylines that matched no rule stay on the page. A spelling the matcher missed is exactly the
 * legitimate case this screen exists for, so the empty-state warning that was already here — *write to
 * the archive rather than claiming a name that is not yours* — is what the rest of the list is for.
 */
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { listClaimableBylines, type ClaimableByline } from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your bylines',
  robots: { index: false, follow: false },
};

/**
 * WHAT A BYLINE HOLDS, AS A SENTENCE A READER CAN CHECK.
 *
 * The fault this replaces said "524 records in the archive" about a byline with none published. The
 * numbers here are two and they are named: what a reader can open, and what they cannot. **A byline with
 * nothing published says so in those words**, because the alternative presented 524 imports as the prize
 * for a claim.
 *
 * Nothing here is ever phrased as "0 records published", because a count of zero is a sentence about a
 * database rather than about a shelf. "None published yet" is the same fact said to a reader.
 */
function holdings(byline: ClaimableByline): string {
  const drafts = `${byline.draftCount} ${byline.draftCount === 1 ? 'record' : 'records'}`;
  if (byline.publishedCount === 0) {
    return byline.draftCount === 0
      ? 'No records in the archive yet.'
      : `${drafts} in the archive, none published yet.`;
  }
  const published = `${byline.publishedCount} ${byline.publishedCount === 1 ? 'record' : 'records'} published`;
  if (byline.draftCount === 0) {
    return `${published} in the archive.`;
  }
  return `${published}, and ${drafts} not published.`;
}

/** The panel for one byline: what it holds, why it is here, and the form or the state of a claim. */
function BylinePanel({ byline }: { byline: ClaimableByline }) {
  return (
    <section className="panel" key={byline.id}>
      <div className="panel__head">
        <h3 className="panel__title">{byline.name}</h3>
      </div>
      <div className="panel__body">
        <p className="small muted">{holdings(byline)}</p>

        {/*
          THE REASON IS SHOWN, NOT ASSERTED. A wrong "this looks like you" is worse than none, because
          the button beside it asks an editor to hand over published records — so the reader is told
          exactly which of their own fields matched and which words, and told plainly that it is not a
          decision. `likelyBylineReason` produces this sentence and only ever for a whole-word match.
        */}
        {byline.likely && byline.matchReason ? (
          <div className="notice notice--info" style={{ marginTop: 'var(--s-4)' }}>
            <div>
              <p className="notice__title">Why this is here</p>
              <p className="notice__body">
                {byline.matchReason} That is a guess from your own account details, not a decision — an
                editor still checks it against the archive before anything changes.
              </p>
            </div>
          </div>
        ) : null}

        {byline.claimStatus === 'pending' ? (
          <div className="notice notice--info" role="status" style={{ marginTop: 'var(--s-4)' }}>
            <div>
              <p className="notice__body">
                Your claim is waiting for an editor to check it. You will be able to correct these
                records once it is approved.
              </p>
            </div>
          </div>
        ) : byline.claimStatus === 'rejected' ? (
          <div className="notice notice--error" role="alert" style={{ marginTop: 'var(--s-4)' }}>
            <div>
              <p className="notice__body">
                A previous claim on this byline was not granted. If that was wrong, write to the archive
                with more evidence rather than claiming it again unchanged.
              </p>
            </div>
          </div>
        ) : (
          <form method="post" action="/api/claims" style={{ marginTop: 'var(--s-4)' }}>
            <input type="hidden" name="action" value="request" />
            <input type="hidden" name="contributorId" value={byline.id} />
            <input type="hidden" name="returnTo" value="/claims/" />
            <div className="wpfield">
              <label htmlFor={`ev-${byline.id}`}>How an editor can check this is you</label>
              <textarea
                id={`ev-${byline.id}`}
                name="evidence"
                rows={3}
                maxLength={2000}
                placeholder="Where you published it, who you wrote it for, an address the archive can reach you at"
              />
              {/*
                THIS HELP TEXT USED TO SAY THE OPPOSITE OF WHAT THE PAGE DID. It read: *"The archive
                holds no email address for the migrated contributors, so there is nothing to match
                automatically"* — true of the contributors, who were imported from WordPress without
                contact details, and false of the reader, whose account holds both an email address and
                a display name. The only matching there is to do is the account against the byline, and
                the screen does it above; saying otherwise under a claim button was the copy the owner
                met. See `likelyBylineReason` in `members.ts` for the rule.
              */}
              <p className="wphelp">
                The migrated contributors have no email address in the archive, so nothing can be
                confirmed automatically — an editor checks this by hand. The archive does compare your
                own account name and email against these bylines, and this page says so under any byline
                that matched; if the name above is not yours, this is not your byline and an editor will
                say no.
              </p>
            </div>
            <button className="btn btn--primary" type="submit">Claim this byline</button>
          </form>
        )}
      </div>
    </section>
  );
}

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const notices = await searchParams;
  // Any signed-in person, no capability: see the note in `requireUser`.
  const guard = await requireCapabilityOrRedirect('read', '/claims/');

  const db = await getDb();
  const account = guard.account.account;
  /*
   * BOTH of the account's own identifiers are given to the matcher, because either can be the one the
   * byline was written under. Neither is invented: `displayName` is the account's own name and `email`
   * is the address they signed in with, and both are shown back to them in the reason when they match.
   */
  const bylines = await listClaimableBylines(db, account.id, {
    email: account.email,
    displayName: account.displayName,
  });

  const likely = bylines.filter((byline) => byline.likely);
  const rest = bylines.filter((byline) => !byline.likely);

  return (
    <div className="wrap section">
      <header>
        <p className="eyebrow">Authorship</p>
        <h1>Your bylines</h1>
        <p className="lede">
          If your name is on records in this archive, claim it here. Nobody else can correct your work
          for you, and a byline nobody has claimed is one the archive cannot keep accurate. The bylines
          your own name and email address match are listed first, with the reason; everything else in the
          archive that nobody has claimed follows.
        </p>
      </header>

      {notices.saved ? <div className="notice notice--success" role="status"><div><p className="notice__body">{notices.saved}</p></div></div> : null}
      {notices.error ? <div className="notice notice--error" role="alert"><div><p className="notice__body">{notices.error}</p></div></div> : null}

      {bylines.length === 0 ? (
        <div className="empty section">
          <p className="eyebrow">No bylines to claim</p>
          <p>
            Every byline in the archive has already been claimed, or none exists yet. If your work is
            here under a name you do not recognise, write to the archive rather than claiming a name
            that is not yours.
          </p>
        </div>
      ) : (
        <>
          {likely.length > 0 ? (
            <section className="section">
              <h2>Matching your account</h2>
              <p className="small muted">
                {likely.length === 1
                  ? 'One byline in the archive matches the name or email address on your account.'
                  : `${likely.length} bylines in the archive match the name or email address on your account.`}{' '}
                A match is a guess from your own details, not a decision: an editor checks every claim
                against the archive before it is granted.
              </p>
              <div className="stack-lg section">
                {likely.map((byline) => (
                  <BylinePanel byline={byline} key={byline.id} />
                ))}
              </div>
            </section>
          ) : null}

          <section className="section">
            <h2>{likely.length > 0 ? 'Everything else nobody has claimed' : 'Bylines nobody has claimed'}</h2>
            {likely.length === 0 ? (
              /*
                WHEN NOTHING MATCHED, THE PAGE MUST NOT IMPLY OTHERWISE. This is the sentence for a person
                whose byline is spelled in a way the matcher does not know — the case that made hiding the
                unmatched a bad idea — and it names what was compared, so it cannot read as "none of this
                is yours".
              */
              <p className="small muted">
                Nothing here matches the name or email address on your account. That is not proof your
                byline is absent: it may be here under a spelling or a form of your name this page does
                not know. Browse the list, and if you find your work, claim it. If you cannot, write to
                the archive rather than claiming a name that is not yours.
              </p>
            ) : (
              <p className="small muted">
                These did not match your account’s name or email address. If your byline is here under a
                spelling the match missed, claim it and give an editor what they need to check it.
              </p>
            )}
            <div className="stack-lg section">
              {rest.map((byline) => (
                <BylinePanel byline={byline} key={byline.id} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
