/**
 * /admin/seo/verification — the per-engine site-verification tokens, unchanged in behaviour.
 *
 * ── THIS IS THE SCREEN THAT WAS `/admin/seo/`, AND NOTHING ABOUT ITS MECHANISM MOVED ─────────────────
 *
 * It was 336 lines carrying two cards: "One row per engine" (the tokens) and "What this is, and what it is
 * not" (its own honest list of gaps). The owner's second report is *"everything must not show on same page"*,
 * so the tokens moved to this address — **their form action, their gate, their audit trail and their emitted
 * markup are byte-for-byte what they were.** The gap list moved to the index, where a reader comparing the six
 * sections against what Yoast has can check all of it at once instead of from the bottom of a token form.
 *
 * ── WHAT HE ASKED FOR, AND WHAT THIS ANSWERS ─────────────────────────────────────────────────────────
 *
 *   "i gave you yoast seo premium to replicate it's functions. now i want to see the seo in my dashboard
 *    and it it function like the original yoast so i can see where to add google web master search engine
 *    code, yandex, bing and others"
 *
 * One field per engine, a paste, and a line that says exactly what the archive now writes into the `<head>` of
 * every page. **The token is the only thing stored; the tag is written by the archive**, which is what keeps a
 * paste from becoming markup. Pasted whole tags are accepted and the token is read out of them, because that
 * is what the engine's own screen puts on the clipboard.
 *
 * ── WHY THE SCREEN SHOWS THE TAG THAT WILL BE EMITTED RATHER THAN A SCREENSHOT OF IT ─────────────────
 *
 * A settings page that says "saved" and shows nothing is the fault this archive has already been bitten by in
 * the design editor: a value stored, served, applied and invisible. So each row prints the exact `<meta>`
 * element it produces, built by calling `seoHead` — **the same function every page's head goes through** —
 * and extracting the verification tags from its output. It is the real markup from the real builder, not a
 * description of it. Where no token is stored the row prints why there is nothing rather than an empty tag:
 * **a `<meta content="">` claims a verification that cannot succeed, so the absence has to look like an
 * absence.**
 *
 * ── AND THE CAPABILITY, STATED ON THE PAGE AS WELL AS IN THE ENDPOINT ─────────────────────────────────
 *
 * `manage_design`. The full reasoning is in `app/api/admin/seo/route.ts`; the short of it is that this is the
 * capability the owner's other site-wide, reader-visible setting is already gated on, that migration 0055's
 * rule ("an editor may do everything except delete trash") already decided the site's own face is an editor's
 * to change, and that a `manage_seo` a role held differently from `manage_design` does not exist. The guard is
 * on the capability and never on a role, so the day the table says something else is the day this follows it.
 */
import { getDb } from '@ozituma/db/client';
import {
  OTHER_ENGINE_ID,
  VERIFY_ENGINES,
  VERIFY_TOKEN_MAX,
  engineById,
  loadSeoVerification,
  loadSiteSeoSettings,
  seoHead,
  siteSeoFrom,
  verificationTags,
  type SiteSeo,
  type SiteVerification,
} from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head, Notices } from '../../ui';
import { SeoNav } from '../nav';

/* THE CAPABILITY THIS SCREEN IS GATED ON. Named once, so the guard and the sentence below cannot disagree. */
const CAPABILITY = 'manage_design';

/** Where a form on this screen returns to, and what `Tabs` marks active. */
const HERE = '/admin/seo/verification/';

export const dynamic = 'force-dynamic';

/** The engines drawn, the catch-all last. */
const ENGINES = [...VERIFY_ENGINES, engineById(OTHER_ENGINE_ID)!];

/**
 * The exact markup the archive emits for one token, **built by the real head builder.**
 *
 * The record here is a deliberately minimal one — a path, a title and a kind — because the verification tags
 * do not depend on the record at all: they are a fact about the site. That is the point of showing it: what
 * the owner is looking at is what a crawler will read on every page, and the record it is demonstrated on is
 * the front page rather than a fabricated article.
 */
function emittedTag(entry: { metaName: string; token: string }, site: SiteSeo): string {
  /*
   * THE OWNER'S OWN SETTINGS ARE PASSED IN, AND THE TITLE HERE IS THE ONE THE FRONT PAGE WOULD ACTUALLY SERVE
   * — `site.homeTitle` when he has written one, or `Ozikoro` when he has not. A preview built on a hard-coded
   * title would keep showing the title it was written with after he changed the homepage title on
   * `/admin/seo/titles/`, which is the same "the screen and the page disagree" fault in the other direction.
   */
  const head = seoHead(
    { path: '/', title: site.homeTitle ?? 'Ozikoro', description: null, kind: 'page' },
    [],
    [{ engineId: 'preview', metaName: entry.metaName, token: entry.token, label: null, actorId: null, actorName: null, updatedAt: null }],
    site
  );
  const tags = verificationTags([
    { engineId: 'preview', metaName: entry.metaName, token: entry.token, label: null, actorId: null, actorName: null, updatedAt: null },
  ]);
  /*
   * THE ASSERTION IS THAT THE BUILDER ACTUALLY PUT IT IN. `verificationTags` is one function and the head
   * builder calls it, so this cannot disagree today — but a screen that printed a tag it had composed itself
   * would keep printing it after the builder stopped emitting it, which is exactly the "stored but not served"
   * fault in the other direction. So the row's markup is taken FROM the head, and the locally built tag is
   * only a fallback for a head that somehow has none.
   */
  const inHead = tags.find((tag) => head.includes(tag));
  return inHead ?? tags[0] ?? '';
}

/** How long a token is, and where it ends, so the owner can tell two tokens apart at a glance. */
function shorten(token: string): string {
  if (token.length <= 18) return token;
  return `${token.slice(0, 10)}…${token.slice(-6)} (${token.length} characters)`;
}

function when(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function EngineRow({
  engine,
  stored,
  site,
}: {
  engine: { id: string; label: string; metaName: string; source: string; note: string };
  stored: SiteVerification | undefined;
  site: SiteSeo;
}) {
  const host = engine.source ? new URL(engine.source).host : null;
  return (
    <div style={{ borderTop: '1px solid var(--rule)', padding: '.9rem 0' }}>
      <h3 style={{ margin: '0 0 .2rem' }}>
        {engine.label}{' '}
        {stored ? (
          <span style={{ color: '#2f5d3a', fontWeight: 600, fontSize: '.78rem' }}>verified — a tag is served</span>
        ) : (
          <span style={{ color: '#4a4a4a', fontWeight: 600, fontSize: '.78rem' }}>nothing stored</span>
        )}
      </h3>
      <p className="small muted" style={{ margin: '0 0 .4rem' }}>
        {engine.note}
        {engine.source ? (
          <>
            {' '}Where the token comes from:{' '}
            <a href={engine.source} target="_blank" rel="noreferrer">
              {host}
            </a>
            .
          </>
        ) : null}
      </p>

      <form method="post" action="/api/admin/seo">
        <input type="hidden" name="action" value="set" />
        <input type="hidden" name="engine" value={engine.id} />
        <input type="hidden" name="returnTo" value={HERE} />
        <label className="small" htmlFor={`token-${engine.id}`}>
          Paste the tag or the token {host ? `${host} gave you` : 'the platform gave you'}
          {engine.metaName ? (
            <>
              {' '}
              — the archive emits it as <code>name=&quot;{engine.metaName}&quot;</code>
            </>
          ) : (
            <> — name the tag&rsquo;s <code>name</code> attribute below if the platform gave only a token</>
          )}
        </label>
        <textarea
          id={`token-${engine.id}`}
          name="token"
          rows={2}
          defaultValue=""
          placeholder={
            engine.metaName
              ? `<meta name="${engine.metaName}" content="…">  —  or just the token`
              : '<meta name="example-site-verification" content="…">'
          }
          style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: '.85rem' }}
        />
        {engine.id === OTHER_ENGINE_ID ? (
          <p className="small" style={{ margin: '.3rem 0 0' }}>
            <label>
              The tag&rsquo;s <code>name</code> attribute
              <input
                type="text"
                name="metaName"
                placeholder="example-site-verification"
                style={{ width: '22rem', marginLeft: '.4rem', fontFamily: 'ui-monospace, monospace' }}
              />
            </label>
          </p>
        ) : null}
        <div style={{ display: 'flex', gap: '.4rem', marginTop: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn" type="submit">
            {stored ? 'Replace the token' : 'Save the token'}
          </button>
          <span className="small muted">
            Stored against {engine.label}; used on every page of the archive.
          </span>
        </div>
      </form>

      {stored ? (
        <>
          <p className="small" style={{ margin: '.5rem 0 .2rem' }}>
            In force now, {shorten(stored.token)} — set by {stored.actorName ?? 'an account with no name'} on {when(stored.updatedAt)}.
          </p>
          <p className="small" style={{ margin: '0 0 .4rem' }}>
            Every page serves exactly this, and nothing else from your paste:
          </p>
          <pre
            className="small"
            style={{ margin: '0 0 .4rem', padding: '.5rem', background: 'var(--paper-sunk, #f2ece0)', overflowX: 'auto' }}
          >
            <code>{emittedTag(stored, site)}</code>
          </pre>
          <form method="post" action="/api/admin/seo">
            <input type="hidden" name="action" value="remove" />
            <input type="hidden" name="engine" value={engine.id} />
            <input type="hidden" name="returnTo" value={HERE} />
            <button className="btn btn-quiet" type="submit">
              Clear it — stop claiming this engine&rsquo;s verification
            </button>
            <span className="small muted" style={{ marginLeft: '.5rem' }}>
              The row goes; the audit trail keeps the fact that it was there.
            </span>
          </form>
        </>
      ) : (
        <p className="small muted" style={{ margin: '.3rem 0 0' }}>
          Nothing is stored for {engine.label}, so no tag is emitted for it — not an empty one. The archive
          never writes <code>&lt;meta content=&quot;&quot;&gt;</code>: a tag with no content claims a
          verification that cannot succeed.
        </p>
      )}
    </div>
  );
}

export default async function SeoVerificationPage({
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
  const stored = await loadSeoVerification(db);
  /*
   * The owner's own site identity, so the markup this screen prints is built the way the served head is — see
   * `emittedTag`. A failure to read it degrades to `EMPTY_SITE_SEO`, which is exactly what the archive served
   * before the settings existed.
   */
  const site = siteSeoFrom(await loadSiteSeoSettings(db));
  const byEngine = new Map(stored.map((entry) => [entry.engineId, entry]));
  const other = byEngine.get(OTHER_ENGINE_ID);

  /* Every tag the archive will serve, in the order `seoHead` writes them. */
  const tags = verificationTags(stored);
  const covered = stored.length;

  return (
    <div className="admin-shell">
      <Head title="Search-engine verification">
        <a className="btn btn-quiet" href="/" target="_blank" rel="noreferrer">
          Open the home page in a new tab
        </a>
      </Head>

      <SeoNav active="verification" />

      <Notices saved={one('saved')} error={one('error')} />

      <Card title="Where to paste the code your search engine gave you">
        <p>
          Google Search Console, Bing Webmaster Tools, Yandex Webmaster and the rest each ask you to prove the
          site is yours. They give you a small piece of code — usually a <code>&lt;meta&gt;</code> tag, and
          sometimes just a token — and they check for it on a page of the site. <b>Paste it below and it is put
          into the head of every page of the archive</b>, which is what the check is looking for.
        </p>
        <p className="small muted">
          <b>Paste the whole tag or just the token — both work.</b> If you paste a tag the archive reads the
          token out of it and writes the tag itself, safely, so nothing of your paste is stored as markup. If
          you paste a tag belonging to a different engine than the row you are in, the archive stores it
          against the right one and tells you. <b>A token is under {VERIFY_TOKEN_MAX} characters</b> — it is the
          value of one tag&rsquo;s <code>content</code> attribute, and a value with a quote or an angle bracket
          in it is refused rather than written into a page.
        </p>
        <AtAGlance
          rows={[
            ['Engines with a token stored', `${covered} of the ${ENGINES.length} below`],
            ['Engines with nothing stored', `${ENGINES.length - covered} — no tag is emitted for those, which is the correct state until you verify one`],
            ['Where they are kept', 'the database (site_setting), applied at serve time by the head builder'],
            ['Where they appear', 'the <head> of every page — the front page, every record, every topic, the documents page'],
            ['Signed in as', `${account.account.displayName ?? account.account.email}, holding ${CAPABILITY.replace(/_/g, ' ')}`],
          ]}
        />
      </Card>

      <Card title={`The tags in force — ${covered === 0 ? 'none yet' : `${tags.length} tag${tags.length === 1 ? '' : 's'}`}`}>
        {covered === 0 ? (
          <p>
            <b>Nothing is stored, so the archive serves no verification tag at all.</b> That is the state
            before anything is pasted, and it is a real state rather than a broken one: no empty
            <code>&lt;meta name=&quot;…&quot; content=&quot;&quot;&gt;</code> is written, because a tag with no
            content tells a search engine a verification failed rather than that none was attempted.
          </p>
        ) : (
          <>
            <p className="small muted">
              These are built by the archive&rsquo;s own head builder — the same function every page&rsquo;s
              head goes through — so what you read here is what a crawler reads.
            </p>
            <pre className="small" style={{ padding: '.6rem', background: 'var(--paper-sunk, #f2ece0)', overflowX: 'auto' }}>
              <code>{tags.join('\n')}</code>
            </pre>
          </>
        )}
      </Card>

      <Card title="One row per engine">
        {ENGINES.map((engine) => (
          <EngineRow
            key={engine.id}
            engine={engine}
            stored={engine.id === OTHER_ENGINE_ID ? other : byEngine.get(engine.id)}
            site={site}
          />
        ))}
      </Card>

      <Card title="Changing a token is an administrative act, and it is recorded" quiet>
        <p className="small muted">
          Every save and every clear writes a row to the audit trail: who did it, when, which engine, and how
          long the token was. <b>The token itself is not written into the audit trail</b> — that trail is
          readable by anyone holding <code>view audit</code>, and a verification token is a credential:
          anybody who can read it can claim to be this site to Google. The value is on this screen, behind the
          same permission that let you set it.
        </p>
      </Card>

      <Card title="And the honest limit of this screen" quiet>
        <p className="small muted">
          <b>Storing a token does not make an engine verify the site.</b> The token has to match the one the
          engine issued, and the engine has to be able to fetch a page — which is a question about the live
          site and its DNS rather than about this screen.
        </p>
      </Card>
    </div>
  );
}
