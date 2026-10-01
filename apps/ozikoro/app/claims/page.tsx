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
 */
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { listClaimableBylines } from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your bylines',
  robots: { index: false, follow: false },
};

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const notices = await searchParams;
  // Any signed-in person, no capability: see the note in `requireUser`.
  const guard = await requireCapabilityOrRedirect('read', '/claims/');

  const db = await getDb();
  const bylines = await listClaimableBylines(db, guard.account.account.id);

  return (
    <div className="wrap section">
      <header>
        <p className="eyebrow">Authorship</p>
        <h1>Your bylines</h1>
        <p className="lede">
          If your name is on records in this archive, claim it here. Nobody else can correct your work
          for you, and a byline nobody has claimed is one the archive cannot keep accurate.
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
        <div className="stack-lg section">
          {bylines.map((b) => (
            <section className="panel" key={b.id}>
              <div className="panel__head">
                <h2 className="panel__title">{b.name}</h2>
              </div>
              <div className="panel__body">
                <p className="small muted">
                  {b.articleCount} {b.articleCount === 1 ? 'record' : 'records'} in the archive
                </p>

                {b.claimStatus === 'pending' ? (
                  <div className="notice notice--info" role="status" style={{ marginTop: 'var(--s-4)' }}>
                    <div>
                      <p className="notice__body">
                        Your claim is waiting for an editor to check it. You will be able to correct
                        these records once it is approved.
                      </p>
                    </div>
                  </div>
                ) : b.claimStatus === 'rejected' ? (
                  <div className="notice notice--error" role="alert" style={{ marginTop: 'var(--s-4)' }}>
                    <div>
                      <p className="notice__body">
                        A previous claim on this byline was not granted. If that was wrong, write to the
                        archive with more evidence rather than claiming it again unchanged.
                      </p>
                    </div>
                  </div>
                ) : (
                  <form method="post" action="/api/claims" style={{ marginTop: 'var(--s-4)' }}>
                    <input type="hidden" name="action" value="request" />
                    <input type="hidden" name="contributorId" value={b.id} />
                    <input type="hidden" name="returnTo" value="/claims/" />
                    <div className="wpfield">
                      <label htmlFor={`ev-${b.id}`}>How an editor can check this is you</label>
                      <textarea
                        id={`ev-${b.id}`}
                        name="evidence"
                        rows={3}
                        maxLength={2000}
                        placeholder="Where you published it, who you wrote it for, an address the archive can reach you at"
                      />
                      <p className="wphelp">
                        The archive holds no email address for the migrated contributors, so there is
                        nothing to match automatically — an editor checks this by hand.
                      </p>
                    </div>
                    <button className="btn btn--primary" type="submit">Claim this byline</button>
                  </form>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
