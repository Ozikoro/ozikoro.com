/**
 * /admin/seo/schema — the structured data: what the publisher is called, and what each page declares itself to be.
 *
 * ── WHAT IS EDITABLE, AND WHY IT IS ONLY THIS ────────────────────────────────────────────────────────
 *
 * The JSON-LD graph is generated per record kind by `seoHead`, and **the old `/admin/seo/` named
 * "schema/structured-data controls" as one of the things it did not have.** The one field worth exposing is the
 * publisher: `Organization.name` is emitted on every page of the archive, a machine reads it as who publishes
 * this material, and it is a fact about the institution rather than about any record.
 *
 * **THE NODE TYPES ARE NOT EDITABLE, AND THAT IS A DECISION RATHER THAN AN OMISSION.** A record is an
 * `Article`, a person is a `ProfilePage`, a town is a `Place`, a collection is a `CollectionPage`. A screen that
 * let an owner re-type a node would be a screen that could tell a search engine a history is a recipe — and the
 * graph is what a machine believes about the archive, so being able to make it say something untrue is not a
 * setting, it is a liability. What this page does instead is **name what every kind of page emits**, so the
 * graph is inspectable without being editable.
 *
 * ── WHAT IS DELIBERATELY ABSENT FROM THE GRAPH, STATED WHERE AN OWNER WOULD LOOK ──────────────────────
 *
 *   * **No `license` on any image.** All 3,750 media records hold no licence and the rights basis is `unknown`;
 *     emitting one would assert a permission that does not exist. See `imageNode` in `seo-head.ts`.
 *   * **No coordinates for any place.** 188 places, each with a name, a region and an ethnic group — and no
 *     latitude or longitude for any of them. A fabricated coordinate is the most convincing kind of invented
 *     content there is, because it renders. See `placeNode`.
 *   * **No `sameAs` for a host that does not answer.** `ozituma.com` is named because it is one publisher with
 *     this archive; the academy's host is not named until it is live.
 */
import { getDb } from '@ozituma/db/client';
import { PUBLISHER_KEY, SITE_NAME_MAX, loadSeoVerification, loadSiteSeoSettings, seoHead, siteSeoFrom } from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head, Notices } from '../../ui';
import { Field } from '../fields';
import { SeoNav } from '../nav';

const CAPABILITY = 'manage_design';
const HERE = '/admin/seo/schema/';

export const dynamic = 'force-dynamic';

/** Every node the graph can hold, and where each comes from. Printed so the graph is inspectable. */
const NODES: [string, string][] = [
  ['Organization', 'The publisher — the name set on this screen, and `sameAs` for ozituma.com, which is the same publisher.'],
  ['WebSite', 'The site itself, with the sitelinks `SearchAction` that points at /search?q={search_term_string}.'],
  ['WebPage / Article / CollectionPage / ProfilePage / Place', 'The page’s own node, chosen from the record’s kind. `name`, `description`, `url` and the dates come from the record.'],
  ['Person', 'The named author, when a record has one. Emitted only when a byline is recorded.'],
  ['ImageObject', 'The record’s lead image, when it has one — with `caption` from its alt text and no `license`, because the archive holds none.'],
  ['BreadcrumbList', 'The trail, when it is longer than one item, so a result can show the path rather than a bare address.'],
];

/** The kinds of page and the node each declares itself to be. Read from the tables in `seo-head.ts`. */
const KINDS: [string, string][] = [
  ['A record — a history', 'Article · og:type article'],
  ['A page — the front page, About, Documents', 'WebPage · og:type website'],
  ['A topic, a collection, an index', 'CollectionPage · og:type website'],
  ['A researcher’s profile', 'ProfilePage · og:type profile'],
  ['A town, clan or place', 'Place · og:type place'],
];

/** One stored value, as the form's `defaultValue`. */
function valueOf(settings: Map<string, { value: unknown }>, key: string): string {
  const setting = settings.get(key);
  if (!setting) return '';
  const value = setting.value;
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object' && typeof (value as Record<string, unknown>).value === 'string') {
    return (value as Record<string, unknown>).value as string;
  }
  return '';
}

export default async function SeoSchemaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { account } = await requireCapabilityOrRedirect(CAPABILITY, HERE);
  const one = (key: string): string => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? '';
  };

  const db = await getDb();
  const settings = await loadSiteSeoSettings(db);
  const site = siteSeoFrom(settings);

  /*
   * THE GRAPH ITSELF, READ BACK OUT OF THE REAL BUILDER. A screen that described the structured data in prose
   * would keep describing it after the builder changed; this reads the script tag out of `seoHead`'s own output
   * for the front page, which is the graph every page is a variant of.
   */
  const head = seoHead(
    { path: '/', title: site.homeTitle ?? 'Ozikoro', description: null, kind: 'page' },
    [],
    /*
     * THE REAL VERIFICATION TOKENS, so the graph printed below is the one a crawler is actually served rather
     * than one built with an empty list. A preview that omitted them would be a preview of a page nobody gets.
     */
    await loadSeoVerification(db),
    site
  );
  const graph = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(head)?.[1] ?? '';

  return (
    <div className="admin-shell">
      <Head title="Structured data" />
      <SeoNav active="schema" />
      <Notices saved={one('saved')} error={one('error')} />

      <Card title="The publisher a machine reads">
        <p>
          Every page of the archive carries one JSON-LD graph, and its first node names who publishes this
          material. <b>That name is a fact about the institution and it is the one field here that is
          editable.</b> Empty means the archive’s own constant is served — <i>Ozi Ikoro Limited</i> — exactly as
          it was before this screen existed.
        </p>
        <Field
          settingKey={PUBLISHER_KEY}
          label="Publisher"
          hint="How the archive’s publisher is named in the structured data and in the citation metadata."
          value={valueOf(settings, PUBLISHER_KEY)}
          placeholder="Ozi Ikoro Limited"
          reads="packages/ozikoro/src/seo-head.ts — seoHead(); the Organization node’s name and the citation_publisher tag"
          provedBy="/"
          unit={`${SITE_NAME_MAX} characters`}
          stored={settings.get(PUBLISHER_KEY) ?? null}
        />
      </Card>

      <Card title="The graph the front page actually emits, read out of the head builder">
        <p className="small muted">
          This is the real JSON-LD from <code>seoHead</code>’s output with the settings in force — not a summary
          of it. Every other page emits the same <code>Organization</code> and <code>WebSite</code> nodes and a
          different page node.
        </p>
        <pre className="small" style={{ padding: '.6rem', background: 'var(--paper-sunk, #f2ece0)', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
          <code>{graph}</code>
        </pre>
      </Card>

      <Card title="What each kind of page declares itself to be">
        <p className="small muted">
          <b>These are not editable.</b> The node type is a claim about what the page is, and a page that could
          be re-typed would be a page that could tell a search engine something untrue about itself. The mapping
          is in <code>packages/ozikoro/src/seo-head.ts</code>, in <code>SCHEMA_TYPE</code> and{' '}
          <code>OG_TYPE</code>.
        </p>
        <dl className="pairs">
          {KINDS.map(([kind, node]) => (
            <div key={kind} style={{ display: 'contents' }}>
              <dt>{kind}</dt>
              <dd>
                <code>{node}</code>
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="The nodes the graph can carry">
        <dl className="pairs">
          {NODES.map(([node, what]) => (
            <div key={node} style={{ display: 'contents' }}>
              <dt>
                <code>{node}</code>
              </dt>
              <dd className="small">{what}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="What is deliberately not in the graph">
        <ul className="small">
          <li>
            <b>No <code>license</code> on any image.</b> All 3,750 media records hold no licence and the rights
            basis is <code>unknown</code>. Emitting one would assert a permission that does not exist, and a
            search engine — or a person reading the source — would take it as one. The absence is the accurate
            statement, and <code>copyrightNotice</code> says why.
          </li>
          <li>
            <b>No coordinates for any place.</b> 188 places, each with a name, a region and an ethnic group —{' '}
            <b>and no latitude or longitude for any of them</b>. A fabricated coordinate is the most convincing
            kind of invented content there is, because it renders on a map.
          </li>
          <li>
            <b>No <code>sameAs</code> for a host that does not answer.</b> <code>ozituma.com</code> is named
            because it is one publisher with this archive. A second host is named only when it is live — an
            assertion that two addresses are the same entity is read by machines that will fetch both.
          </li>
          <li>
            <b>No keyphrase or rating markup.</b> The archive holds no keyphrase and no review score, and a
            schema.org claim with nothing behind it is an invention with a machine-readable shape.
          </li>
        </ul>
        <AtAGlance
          rows={[
            ['Publisher in force', settings.has(PUBLISHER_KEY) ? site.publisherName : `${site.publisherName} (the archive’s own constant)`],
            ['Signed in as', `${account.account.displayName ?? account.account.email}, holding ${CAPABILITY.replace(/_/g, ' ')}`],
          ]}
        />
      </Card>
    </div>
  );
}
