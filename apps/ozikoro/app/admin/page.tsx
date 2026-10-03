/**
 * /admin — the administration landing page.
 *
 * One card per thing an administrator can actually do, and nothing that is not built. The archive, the
 * researchers' network and the Academy are all still to come; listing them here would make this page a
 * promise rather than a menu, so they are named as forthcoming in one sentence at the bottom instead of as
 * links that lead nowhere.
 *
 * WHY EACH CARD CARRIES A COUNT READ FROM THE DATABASE
 *
 * The nav bar already links every screen, and this page was three cards repeating three of them. **A landing
 * page that does not show the state of the thing it links to makes the reader open eight screens to find out
 * whether anything needs them.** Each figure below is a `count(*)` over the rows its screen lists — the
 * review backlog, the untagged records, the media with no rights recorded, the claims waiting, the audit
 * entries — and **a zero is printed as a zero rather than hidden**, because "nothing is waiting" is the fact
 * an administrator most wants confirmed.
 *
 * THE TWO GATED COUNTS ARE NOT SHOWN TO EVERYBODY.
 *
 * The account list and the audit trail both require `manage_users`, because they name accounts and their
 * addresses. An editor who can work the editorial queues is not thereby entitled to a count of the archive's
 * accounts, so those two cards appear only for an account that holds the capability — and the query is not
 * run for anyone else either, rather than being run and then hidden.
 */
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import {
  capabilitiesFor,
  countContributorClaims,
  getArticleStatusCounts,
  getAuditOverview,
  getEditorialProgress,
  getMediaStats,
  getRightsProgress,
  getUserOverview,
  listArticleClaims,
  narrationCounts,
  spotifyConnectionView,
} from '@ozikoro/platform';
import { requireBackOfficeOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head } from './ui';

export const dynamic = 'force-dynamic';

const num = (n: number) => n.toLocaleString('en-GB');

const pct = (part: number, whole: number) => `${Math.round((part / Math.max(whole, 1)) * 100)}%`;

export default async function Page() {
  /*
   * The page's own guard, FIRST. The layout admits editors; this page prints the archive's counts and, for an
   * administrator, the number of accounts — and **a page beneath the guarded layout still renders
   * concurrently with it**, so an anonymous request for `/admin/` answered 307 with 22 KB of this page in the
   * body. See `requireBackOfficeOrRedirect`.
   */
  const { account } = await requireBackOfficeOrRedirect('/admin');

  const db = await getDb();
  const capabilities = await capabilitiesFor(db, account.account.id);
  const maySeeAccounts = capabilities.has('manage_users');

  const [
    articles,
    editorial,
    rights,
    media,
    pendingClaims,
    recordClaims,
    narration,
    spotify,
    users,
    audit,
  ] = await Promise.all([
    getArticleStatusCounts(db),
    getEditorialProgress(db),
    getRightsProgress(db),
    getMediaStats(db),
    countContributorClaims(db, 'pending'),
    listArticleClaims(db, { limit: 1 }),
    narrationCounts(db),
    spotifyConnectionView(db),
    maySeeAccounts ? getUserOverview(db) : Promise.resolve(null),
    maySeeAccounts ? getAuditOverview(db) : Promise.resolve(null),
  ]);

  const proposals = narration
    .filter((c) => c.status === 'proposed' || c.status === 'corrections' || c.status === 'pending_review')
    .reduce((sum, c) => sum + c.count, 0);
  const rendered = narration
    .filter((c) => c.status === 'rendered' || c.status === 'approved' || c.status === 'published')
    .reduce((sum, c) => sum + c.count, 0);

  return (
    <>
      <Head title="Administration" />

      <Card title="Records waiting for review">
        <p>
          Every record whose status is <span className="mono">review</span>, oldest first, with the contributor
          and the moment it entered review where that was recorded. The decision itself is made on the
          record&rsquo;s own page, so there is one write path and one audit row.
        </p>
        <AtAGlance
          rows={[
            ['In review', num(articles.review)],
            ['Published records', num(articles.published)],
            ['Draft', num(articles.draft)],
            ['Archived', num(articles.archived)],
          ]}
        />
        <p className="actions">
          <Link className="btn btn--primary" href="/admin/reviews">
            Review queue
          </Link>
        </p>
      </Card>

      <Card title="Editorial queue">
        <p>
          The migrated records, worst documented first: no source, no period, no clan, town or place. This is
          the re-tagging work the technical scope names, and it is deliberately plain.
        </p>
        <AtAGlance
          rows={[
            ['Records', num(editorial.records)],
            ['Rest on a source', num(editorial.withSources)],
            ['Have a period', num(editorial.withPeriod)],
            ['Name a clan, town or place', num(editorial.withEntities)],
            ['Sources in the archive', num(editorial.sources)],
          ]}
        />
        <p className="actions">
          <Link className="btn btn--primary" href="/admin/archive">
            Editorial queue
          </Link>
        </p>
      </Card>

      <Card title="Media and rights">
        <p>
          The register is what the archive holds; the rights queue is the items nobody has checked, ordered by
          how many published records rest on each one. <strong>Nothing is guessed</strong> — an item with no
          rights recorded permits nothing rather than everything.
        </p>
        <AtAGlance
          rows={[
            ['Media items', num(media.total)],
            ['Photographs', num(media.images)],
            ['Used by a published record', num(media.usedByArticles)],
            ['Checked for rights', `${num(rights.checked)} of ${num(media.total)} (${pct(rights.checked, media.total)})`],
            ['Published placements on an unchecked item', num(rights.articlesUsingUnchecked)],
          ]}
        />
        <p className="actions">
          <Link className="btn btn--primary" href="/admin/media">
            Media register
          </Link>
          <Link className="btn" href="/admin/rights">
            Rights queue
          </Link>
        </p>
      </Card>

      <Card title="Claims">
        <p>
          Two different things the archive calls a claim: a person asking to be recognised as the author of a
          byline, and a statement a record itself makes. Both are listed, each named for the table it reads.
        </p>
        <AtAGlance
          rows={[
            ['Authorship claims waiting', num(pendingClaims)],
            ['Claims made by records', num(recordClaims.total)],
          ]}
        />
        <p className="actions">
          <Link className="btn btn--primary" href="/admin/claims">
            Claims
          </Link>
        </p>
      </Card>

      <Card title="Audio review">
        <p>
          The narration queue: read the spoken script and its cost before anything is rendered, decline a
          proposal at no cost, listen to a rendered take, download the raw file, and approve the one that puts
          the player on the article. A proposal spends nothing; only an approved render does.
        </p>
        <AtAGlance
          rows={[
            ['Awaiting a decision', num(proposals)],
            ['Rendered or published', num(rendered)],
          ]}
        />
        <p className="actions">
          <Link className="btn btn--primary" href="/admin/audio">
            Audio review queue
          </Link>
        </p>
      </Card>

      <Card title="Spotify">
        <p>
          Connect the Spotify account Ozikoro publishes from, see whether it is still authorised, and check it
          against Spotify on demand.
        </p>
        <AtAGlance rows={[['Connection', spotify.label]]} />
        <p className="actions">
          <Link className="btn btn--primary" href="/admin/spotify">
            Spotify connection
          </Link>
        </p>
      </Card>

      {maySeeAccounts && users ? (
        <Card title="Users and contributors">
          <p>
            Every account in the database, and every byline the archive credits — including the contributors
            who wrote for it and have no account, because WordPress stores no password hash and nothing could
            be carried across.
          </p>
          <AtAGlance
            rows={[
              ['Accounts', num(users.accounts)],
              ['Contributors in the archive', num(users.contributors)],
              ['Contributors with no account', num(users.contributorsWithoutAccount)],
            ]}
          />
          <p className="actions">
            <Link className="btn btn--primary" href="/admin/users">
              User table
            </Link>
          </p>
        </Card>
      ) : null}

      {maySeeAccounts && audit ? (
        <Card title="Audit trail">
          <p>
            What changed, who changed it, and when. It is written by every privileged write path; this is the
            screen that reads it back. An entry that records no actor is shown rather than hidden.
          </p>
          <AtAGlance
            rows={[
              ['Entries', num(audit.records)],
              ['With no actor recorded', num(audit.unattributed)],
            ]}
          />
          <p className="actions">
            <Link className="btn btn--primary" href="/admin/audit">
              Audit trail
            </Link>
          </p>
        </Card>
      ) : null}

      <Card title="Coming to this area" quiet>
        <p>
          The history archive, its sources and citations, the researchers&rsquo; network and the
          Academy all belong here too. They are not built yet, so they are not listed as though they
          were.
        </p>
      </Card>
    </>
  );
}
