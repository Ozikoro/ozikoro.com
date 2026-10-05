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
  getEntityGraphState,
  getMediaStats,
  getRightsProgress,
  getUserOverview,
  listArticleClaims,
  narrationCounts,
  queueCounts,
  spotifyConnectionView,
  VERIFY_ENGINES,
  loadSeoVerification,
  verificationTags,
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
    pronunciation,
    spotify,
    users,
    audit,
    graph,
  ] = await Promise.all([
    getArticleStatusCounts(db),
    getEditorialProgress(db),
    getRightsProgress(db),
    getMediaStats(db),
    countContributorClaims(db, 'pending'),
    listArticleClaims(db, { limit: 1 }),
    narrationCounts(db),
    queueCounts(db),
    spotifyConnectionView(db),
    maySeeAccounts ? getUserOverview(db) : Promise.resolve(null),
    maySeeAccounts ? getAuditOverview(db) : Promise.resolve(null),
    /*
     * The graph's state is shown to everybody who can open the back office, not only to an
     * administrator: `edit_entity` is what `/admin/entities` asks for and it is held by editors, so a
     * count that only an administrator could see would describe a screen the editor cannot reach.
     */
    getEntityGraphState(db),
  ]);

  /*
   * THE OWNER'S SITE-VERIFICATION TOKENS, COUNTED RATHER THAN DESCRIBED.
   *
   * The card below says how many engines are verified and names the tags the archive is actually serving,
   * because "is my Google verification live" is the question the owner opened the back office to answer and a
   * link alone would make him click to find out. `verificationTags` is the same function the head builder
   * uses, so the names printed here are read out of the markup a crawler would get.
   */
  const verification = await loadSeoVerification(db);
  const tags = verificationTags(verification);

  const proposals = narration
    .filter((c) => c.status === 'proposed' || c.status === 'corrections' || c.status === 'pending_review')
    .reduce((sum, c) => sum + c.count, 0);
  const rendered = narration
    .filter((c) => c.status === 'rendered' || c.status === 'approved' || c.status === 'published')
    .reduce((sum, c) => sum + c.count, 0);

  return (
    /*
     * ── THE DESIGN'S OWN LANDING SHAPE, WHICH THIS PAGE DID NOT HAVE ─────────────────────────────────────
     *
     * The owner: *"i clicked on it to see the admin, and it was completely scattred. this is not exactly as
     * it was in the demo."* `public/design/screens/dashboard-admin.html` opens with a title row, a
     * `section.sx-metrics` of four figures and a `div.sx-work-grid` of two panels, and only then the modules.
     * This page had a heading and eleven cards in a single column — **stacked where the design has columns**,
     * which is the fault the owner was describing.
     *
     * So the frame is the design's and the eleven cards are unchanged inside it: every control, every sentence
     * and every count the page had, it still has. `admin-overview` is the one class the application adds — the
     * design's own grid step, for cards that carry prose rather than being link tiles — and it is defined in
     * `globals.css` beside the other additions to the back office.
     *
     * THE FOUR FIGURES ARE THE ONES THE CARDS BELOW ALREADY MEASURE, not a second set of queries: they are the
     * headline of the page, and each card is the detail of one. A figure the page did not already count would
     * have to be asked for twice.
     */
    <div className="admin-overview">
      <Head title="Administration" />

      <section className="sx-metrics" aria-label="Workspace summary">
        <article className="sx-metric">
          <span className="small muted">Records waiting for review</span>
          <b>{num(articles.review)}</b>
        </article>
        <article className="sx-metric">
          <span className="small muted">Records in the editorial queue</span>
          <b>{num(editorial.records)}</b>
        </article>
        <article className="sx-metric">
          <span className="small muted">Media items in the register</span>
          <b>{num(media.total)}</b>
        </article>
        <article className="sx-metric">
          <span className="small muted">Entities in the knowledge graph</span>
          <b>{num(graph.entities)}</b>
        </article>
      </section>

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

      <Card title="Knowledge graph">
        <p>
          The clans, towns, kingdoms and peoples a record can name. <strong>188 published clans and
          their 995 towns already exist in the dictionary</strong>, and nothing about them is restated
          here — an entity points at the dictionary row, so the two cannot disagree about a name. Every
          filter on the public archive that offers a clan, a town or an ethnic group reads this graph,
          which is why it is the first thing to fill.
        </p>
        <AtAGlance
          rows={[
            ['Entities in the graph', num(graph.entities)],
            ['Records naming a place', `${num(graph.articlesWithAPlace)} of ${num(graph.records)}`],
            ['Links from a record to an entity', num(graph.articleLinks)],
            ['With coordinates', `${num(graph.withCoordinates)} — the dictionary holds none, and the brief forbids inventing them`],
          ]}
        />
        <p className="actions">
          <Link className="btn btn--primary" href="/admin/entities">
            Knowledge graph
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

      {/*
        THE OTHER HALF OF THE SAME PIPELINE, AND THE ONE THAT PROTECTS THE CREDITS.
        The audio card above is where a render is authorised; this is where the words it will speak are
        checked. **A record whose Igbo words the archive cannot pronounce is refused by the render**, so an
        editor looking at a blocked proposal should be able to reach the queue that unblocks it in one click.
      */}
      <Card title="Pronunciations and credits">
        <p>
          What the ElevenLabs plan allows in a month, how many records that buys, and what one record costs
          before it is rendered. Below that, the queue of Igbo words the dictionary cannot pronounce: record
          one, approve it, and the narration waiting on it is released. A word that is never approved never
          reaches the API.
        </p>
        <AtAGlance
          rows={[
            ['Words blocking a narration', num(pronunciation.blocking)],
            ['Composed from parts, not blocking', num(pronunciation.open - pronunciation.blocking)],
          ]}
        />
        <p className="actions">
          <Link className="btn btn--primary" href="/admin/pronunciation">
            Pronunciations and credits
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

      <Card title="Search engines">
        <p>
          Where the owner pastes the verification code Google Search Console, Bing Webmaster Tools and Yandex
          Webmaster issue. Paste the tag or just the token, and the archive writes it into the head of{' '}
          <b>every page</b> — the front page, every record, every topic, the documents page.
        </p>
        <AtAGlance
          rows={[
            ['Engines with a token stored', `${verification.length} of ${VERIFY_ENGINES.length + 1}`],
            ['Verification tags served now', `${tags.length}${tags.length === 0 ? ' — nothing is claimed yet, and no empty tag is written' : `: ${tags.map((tag) => tag.replace(/^<meta name="([^"]+)".*$/, '$1')).join(', ')}`}`],
          ]}
        />
        <p className="actions">
          <Link className="btn btn--primary" href="/admin/seo">
            Search engines
          </Link>
        </p>
      </Card>

      <Card title="Coming to this area" quiet>
        <p>
          The history archive, its sources and citations, the researchers&rsquo; network and the
          Academy all belong here too. They are not built yet, so they are not listed as though they
          were.
        </p>
      </Card>
    </div>
  );
}
