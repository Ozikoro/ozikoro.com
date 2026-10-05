/**
 * /admin/access — institutional access: who may read a record held by agreement, on what terms, and which
 * records are held.
 *
 * ── WHY THIS SCREEN EXISTS, AND WHY THE DOOR IS WHERE IT IS ────────────────────────────────────────
 *
 * The archive now marks a record in a second way. `restricted` on a media item means *"read it here, do not
 * republish it"*; a record at `access_tier = by_agreement` means *"you may not read this at all without an
 * agreement"*. **This is the screen where an agreement is made, and where a record is placed under one.**
 *
 * The door is `grant_institutional_access`, and the owner decided who holds it: *"then let only the owner
 * 'idenzeme@gmail.com' hold it since you think it is the best"*. So the capability is on the `owner` role and
 * on no other — not the administrator, not an editor — and this page calls the capability by name rather
 * than testing for an address or a role, because a capability attached to an email address breaks the day the
 * address changes. An account that reaches this page without the capability never sees it: the guard runs
 * first and renders nothing.
 *
 * ── ⚠️ THE DESIGN DRAWS NO SCREEN FOR THIS. MEASURED, NOT ASSUMED. ────────────────────────────────
 *
 * Fifty-two screens are served, and a search of all of them finds no access register, no agreement form and
 * no refusal page. So there is no drawn control to copy, and inventing one is forbidden. **What is copied is
 * the archive's own working vocabulary, which is the vocabulary the trash and rights screens already use**:
 * a `<table class="record">` with `<th scope="col">` heads, a `.btn` per action, `.btn--primary` for the safe
 * action and `.btn--danger` for a withdrawal, `.help` where a list is empty, and a `.mono` reference. The
 * refusal screen a reader meets is the other half of this change and it is composed in
 * `@ozikoro/platform`, inside the design's own reading frame.
 *
 * ── AND IT MEASURES BEFORE IT RENDERS ─────────────────────────────────────────────────────────────
 *
 * The counts at the top are read from the database, and **if no record carries the mark the screen says so
 * rather than drawing an empty table**: a tier with no members is a real state, and the number is the fact
 * the owner asked for.
 */
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import {
  ACCESS_TIERS,
  ACCESS_TIER_CLAIM,
  ACCESS_TIER_LABEL,
  GRANT_ACCESS_CAPABILITY,
  institutionalAccessOverview,
  listInstitutionalAccess,
  listRecordsByAgreement,
} from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { Card, Head, Notices } from '../ui';

export const dynamic = 'force-dynamic';

export default async function InstitutionalAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; info?: string }>;
}) {
  const notices = await searchParams;

  /*
   * THE GUARD IS THE PAGE'S FIRST STATEMENT, before anything is read or rendered. `app/admin/layout.tsx`
   * guards the area, but React renders a layout and its children CONCURRENTLY — so a page beneath it runs
   * its queries and produces its markup before the layout's redirect throws, and the body carries them. A
   * page whose own first statement is a guard renders nothing to leak.
   */
  await requireCapabilityOrRedirect(GRANT_ACCESS_CAPABILITY, '/admin/access');

  const db = await getDb();
  const [overview, grants, records] = await Promise.all([
    institutionalAccessOverview(db),
    listInstitutionalAccess(db, { limit: 200 }),
    listRecordsByAgreement(db, { limit: 200 }),
  ]);

  const live = grants.filter((g) => g.active);
  const withdrawn = grants.filter((g) => !g.active);

  return (
    <>
      <Head title="Institutional access">
        <Link className="btn btn--sm" href="/admin/audit">Audit trail</Link>
        <Link className="btn btn--sm" href="/admin/rights">Media rights</Link>
      </Head>

      <Notices saved={notices.saved} error={notices.error} info={notices.info} />

      <Card title="What this screen is for, and what it is not">
        <p>
          A record can be marked in two different ways and the two mean different things.{' '}
          <strong>An item the media register marks as unavailable for reuse can still be read by anyone</strong> —
          that mark is a claim about republishing. <strong>A record held by agreement cannot be read at all</strong>,
          and this screen is where that agreement is made. The two share no column and no word, and the refusal a
          reader meets does not use the word “restricted” anywhere.
        </p>
        <table className="record">
          <thead>
            <tr>
              <th scope="col">Tier</th>
              <th scope="col">What it claims</th>
            </tr>
          </thead>
          <tbody>
            {ACCESS_TIERS.map((tier) => (
              <tr key={tier}>
                <th scope="row">{ACCESS_TIER_LABEL[tier]}</th>
                <td className="small">{ACCESS_TIER_CLAIM[tier]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Where the archive stands">
        <p className="small muted">
          {overview.live.toLocaleString('en-GB')} agreement{overview.live === 1 ? '' : 's'} in force ·{' '}
          {overview.withdrawn.toLocaleString('en-GB')} withdrawn ·{' '}
          <strong>{overview.gated.toLocaleString('en-GB')} record{overview.gated === 1 ? '' : 's'} held by agreement</strong>{' '}
          of {overview.published.toLocaleString('en-GB')} published.
        </p>
        {overview.gated === 0 ? (
          <p className="help">
            <strong>No record is held by agreement.</strong> That is the archive’s real state and not a failure
            to load: the tier exists, the refusal screen exists, and nothing has been placed in it. Until a
            record is placed here, no reader meets the refusal anywhere on the site.
          </p>
        ) : null}
        {overview.live === 0 ? (
          <p className="help">
            No agreement is in force, so nobody holds reading access by agreement.{' '}
            <strong>If a record is held by agreement while no agreement is in force, nobody can read it</strong> —
            including the proprietor, who holds the capability only through this screen rather than through the
            tier.
          </p>
        ) : null}
      </Card>

      <Card title="Make an agreement">
        <p className="help">
          The agreement is made with the archive’s proprietor and recorded against the account that will read
          the record. <strong>A second live agreement for the same account is refused</strong>, so “what are the
          terms?” has one answer; withdraw the first to replace it.
        </p>
        <form method="post" action="/api/admin/access" className="stack">
          <input type="hidden" name="action" value="grant" />
          <p>
            <label htmlFor="grant-email">The account the agreement is for, by its address</label>
            <input id="grant-email" name="email" type="email" required autoComplete="off" style={{ width: '100%' }} />
            <span className="help">
              The address the account signs in with. The agreement is recorded against the account, and the
              capability it opens follows that account rather than the address.
            </span>
          </p>
          <p>
            <label htmlFor="grant-holder">The institution or party it is made with</label>
            <input id="grant-holder" name="holder" type="text" required maxLength={200} style={{ width: '100%' }} />
            <span className="help">
              Recorded as stated. <strong>Nothing on the site is generated from this field</strong> — the refusal
              screen does not read it, so it cannot describe an agreement to a reader from a name nobody checked.
            </span>
          </p>
          <p>
            <label htmlFor="grant-instrument">The instrument, where there is one</label>
            <input id="grant-instrument" name="instrument" type="text" maxLength={300} style={{ width: '100%' }} />
            <span className="help">
              A reference to a signed agreement or a letter. Optional, because the archive’s media rights already
              accept a verbal permission, and refusing a real permission for want of a document number would be
              the form refusing the fact.
            </span>
          </p>
          <p>
            <label htmlFor="grant-terms">The terms, in the words they were stated in</label>
            <textarea id="grant-terms" name="terms" required rows={3} maxLength={2000} style={{ width: '100%' }} />
            <span className="help">
              Required. An agreement with no terms recorded is an assertion rather than an instrument.
            </span>
          </p>
          <button className="btn btn--primary" type="submit">Record the agreement</button>
        </form>
      </Card>

      <Card title="Place a record under an agreement">
        <p className="help">
          Marking a record here changes <strong>who may read the archive’s holdings</strong>, not what the record
          says — so it needs the same permission an agreement does, and an editor’s permission to edit is
          deliberately not enough. A reader without an agreement is refused by name at the record’s own address:
          a real screen that says the record is held, never a 404 that teaches them it does not exist.
        </p>
        <form method="post" action="/api/admin/access" className="stack">
          <input type="hidden" name="action" value="mark" />
          <p>
            <label htmlFor="mark-record">The record — its reference, its address, or its id</label>
            <input
              id="mark-record"
              name="record"
              type="text"
              required
              autoComplete="off"
              placeholder="OZ-H-0000"
              style={{ width: '100%' }}
            />
          </p>
          <p>
            <label htmlFor="mark-tier">The tier it belongs in</label>
            <select id="mark-tier" name="tier" defaultValue="by_agreement">
              {ACCESS_TIERS.map((tier) => (
                <option key={tier} value={tier}>{ACCESS_TIER_LABEL[tier]}</option>
              ))}
            </select>
          </p>
          <p>
            <label htmlFor="mark-reason">Why</label>
            <input id="mark-reason" name="reason" type="text" required maxLength={500} style={{ width: '100%' }} />
            <span className="help">
              Required in both directions. The reason is written to the audit trail, so the decision can be read
              back later — including a decision to open a record again.
            </span>
          </p>
          <button className="btn btn--primary" type="submit">Record the tier</button>
        </form>
      </Card>

      <Card title="Agreements in force">
        {live.length === 0 ? (
          <p className="help">
            None. Nobody holds reading access by agreement, so a record held by agreement would be readable by
            nobody at all.
          </p>
        ) : (
          <table className="record">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Party</th>
                <th scope="col">Terms</th>
                <th scope="col">Granted</th>
                <th scope="col">Withdraw</th>
              </tr>
            </thead>
            <tbody>
              {live.map((grant) => (
                <tr key={grant.id}>
                  <td>
                    <div>{grant.displayName ?? grant.email}</div>
                    <div className="history__when">{grant.email}</div>
                  </td>
                  <td className="small">
                    <div>{grant.holder}</div>
                    {grant.instrument ? <div className="history__when">{grant.instrument}</div> : null}
                  </td>
                  <td className="small">{grant.terms}</td>
                  <td className="small">
                    {grant.grantedAt.slice(0, 10)}
                    <div className="history__when">{grant.grantedByEmail ?? 'an account since deleted'}</div>
                  </td>
                  <td>
                    <form method="post" action="/api/admin/access">
                      <input type="hidden" name="action" value="revoke" />
                      <input type="hidden" name="id" value={grant.id} />
                      <label className="visually-hidden" htmlFor={`revoke-${grant.id}`}>
                        Why access is being withdrawn
                      </label>
                      <input
                        id={`revoke-${grant.id}`}
                        name="reason"
                        type="text"
                        required
                        maxLength={500}
                        placeholder="Why it is being withdrawn"
                        style={{ width: '100%' }}
                      />
                      <button className="btn btn--sm btn--danger" type="submit" style={{ marginTop: '.4rem' }}>
                        Withdraw access
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="help">
          <strong>The reason you type is shown to the person whose access is withdrawn</strong>, on the refusal
          they meet when they next ask for a record held by agreement. They are told that the agreement was
          withdrawn, when, and why, rather than being left to conclude the record has vanished — and the
          withdrawal is recorded as its own entry in the audit trail rather than erasing the agreement.
        </p>
      </Card>

      <Card title="Records held by agreement">
        {records.length === 0 ? (
          <p className="help">
            None. No record in the archive is held by agreement, so the refusal screen is not reached anywhere on
            the site. It is exercised by the test suite, which places a record in the tier and fetches it.
          </p>
        ) : (
          <table className="record">
            <thead>
              <tr>
                <th scope="col">Record</th>
                <th scope="col">State</th>
                <th scope="col">Address</th>
                <th scope="col">Open again</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>
                    <span className="mono small">{record.reference}</span>
                    <div>{record.title}</div>
                  </td>
                  <td className="small">{record.status}</td>
                  <td className="small"><span className="mono">/{record.slug}/</span></td>
                  <td>
                    <form method="post" action="/api/admin/access">
                      <input type="hidden" name="action" value="mark" />
                      <input type="hidden" name="record" value={record.reference} />
                      <input type="hidden" name="tier" value="open" />
                      <label className="visually-hidden" htmlFor={`open-${record.id}`}>
                        Why this record is being opened again
                      </label>
                      <input
                        id={`open-${record.id}`}
                        name="reason"
                        type="text"
                        required
                        maxLength={500}
                        placeholder="Why it is being opened"
                        style={{ width: '100%' }}
                      />
                      <button className="btn btn--sm" type="submit" style={{ marginTop: '.4rem' }}>
                        Open to read
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Agreements that have been withdrawn" quiet>
        {withdrawn.length === 0 ? (
          <p className="help">None. No agreement has been withdrawn.</p>
        ) : (
          <>
            <p className="help">
              Kept rather than deleted: <strong>“was this account ever allowed to read it?” is the question asked
              after an incident</strong>, and a withdrawn agreement that had been erased could not answer it.
            </p>
            <table className="record">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Party</th>
                  <th scope="col">Granted</th>
                  <th scope="col">Withdrawn</th>
                  <th scope="col">Why</th>
                </tr>
              </thead>
              <tbody>
                {withdrawn.map((grant) => (
                  <tr key={grant.id}>
                    <td className="small">
                      <div>{grant.email}</div>
                      <div className="history__when">
                        granted by {grant.grantedByEmail ?? 'an account since deleted'}
                      </div>
                    </td>
                    <td className="small">{grant.holder}</td>
                    <td className="small">{grant.grantedAt.slice(0, 10)}</td>
                    <td className="small">
                      {(grant.revokedAt ?? '').slice(0, 10)}
                      <div className="history__when">
                        by {grant.revokedByEmail ?? 'an account since deleted'}
                      </div>
                    </td>
                    <td className="small">{grant.revocationReason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>

      <Card title="The one limit of a single grantor, stated rather than hidden" quiet>
        <p>
          The owner chose that <strong>only the owner role holds this permission</strong>, and no administrator
          does. The reason is that an institutional access agreement is an instrument about the archive’s own
          holdings and it is the proprietor’s to sign, not an operator’s.
        </p>
        <p>
          <strong>The failure mode that accepts is availability.</strong> While the proprietor’s account is
          unavailable, no agreement can be made and none can be withdrawn — so a record placed under an
          agreement stays closed until that account returns. That is the cost of the narrower set, and it is
          written here so it is a decision rather than a surprise. <strong>Widening it is one row</strong> in
          <span className="mono"> ozikoro_role_capability</span>, and it would be a decision for the owner.
        </p>
      </Card>
    </>
  );
}
