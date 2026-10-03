/**
 * A design screen, served with the archive's real records in it.
 *
 * WHY A ROUTE RATHER THAN THE STATIC FILE
 *
 * The deliverable at `public/design/screens/` is the visual contract and **is never edited.** To show real
 * records inside it, the file is read as a TEMPLATE and its example regions are replaced at request time. This
 * route is that step.
 *
 * The middleware rewrites a reader's address (`/archive-index`) to this route, so the browser's URL, and
 * therefore the base the design's relative links resolve against, is unchanged. **The page a reader gets is the
 * design's own HTML with the archive's titles, summaries and places in it.**
 *
 * A SCREEN WITH NO FILL IS SERVED EXACTLY AS IT IS
 *
 * Only the screens listed in `FILLED` are transformed. Everything else — and every failure inside a fill — is
 * returned byte-for-byte from the file, so **a fault here degrades to the design rather than to a broken
 * page.**
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb } from '@ozituma/db/client';
import {
  imageNode,
  mediaPath,
  placeNode,
  seoHead,
  withSeoHead,
  fillMasthead,
  fillAbout,
} from '@ozikoro/platform';
import { getCurrentAccount } from '@/lib/session';
import {
  fillArchiveIndex, fillCollections, fillDashboard, fillDocuments, fillFolklore, fillHome, fillListen,
  fillPhotographs, fillTopics, fillTowns, fillWatch,
  type DashboardWho, type RealAzEntry, type RealCollection, type RealDocument, type RealEntry, type RealFilm,
  type RealPhotograph, type RealStory, type RealTown, type RealTrack,
} from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

const SCREEN_DIR = join(process.cwd(), 'public', 'design', 'screens');

/** What each screen should be called, and described as, in a search result. */
const SCREEN_SEO: Record<string, { title: string; description: string; kind?: 'article' | 'page' | 'place' | 'list' | 'profile' }> = {
  home: { title: 'Ozikoro — Igbo and African history, archives and scholarship', description: 'Town and clan histories, archive photographs and documents, and the work of African researchers. Published by Ozi Ikoro Limited.', kind: 'page' },
  'archive-index': { title: 'Histories — the Ozikoro archive', description: 'Every history in the archive, filed by ethnic group, clan, place, period and source type. Cite any record by its permanent address.', kind: 'list' },
  topics: { title: 'Topics A–Z — Ozikoro', description: 'A flat index across the archive: categories, places and media, from Anthropology to Video.', kind: 'list' },
  towns: { title: 'Towns and clans — Ozikoro', description: 'The towns, clans and communities the archive holds records for, with their region and their connected histories.', kind: 'list' },
  photographs: { title: 'Photographs — Ozikoro', description: 'Historic photographs held in the archive, each shown with its source and its reuse terms.', kind: 'list' },
  documents: { title: 'Documents — Ozikoro', description: 'Downloadable documents held in the archive, with their provenance and rights recorded.', kind: 'list' },
  watch: { title: 'Watch — Ozikoro', description: 'Films and recordings from the archive, each credited to the article and publisher it came from.', kind: 'list' },
  listen: { title: 'Listen — Ozikoro', description: 'The listening library. Records are read aloud from their written form; no recording is claimed that does not exist.', kind: 'list' },
  folklore: { title: 'Folklores — Ozikoro', description: 'Stories, customs and memories kept as a library of oral tradition, given the same standing as written sources.', kind: 'list' },
  collections: { title: 'Collections — Ozikoro', description: 'Photographs, documents, recordings and material culture, with the size of each collection stated as it is.', kind: 'list' },
  about: { title: 'About Ozi Ikoro Limited', description: 'Who keeps the archive, how material is held, and who may read it.', kind: 'page' },
  cite: { title: 'How to cite Ozikoro', description: 'Ready-made citation formats by record type, with a permanent address for every history.', kind: 'page' },
  careers: { title: 'Careers — Ozikoro', description: 'Roles at Ozi Ikoro Limited and how the application journey works.', kind: 'page' },
  donate: { title: 'Donate — Ozikoro', description: 'Support the preservation of African histories and public access to them.', kind: 'page' },
  sponsors: { title: 'Sponsor a programme — Ozikoro', description: 'Partnership with institutions, sponsors and media.', kind: 'page' },
  investors: { title: 'Investors — Ozikoro', description: 'The infrastructure behind the archive and what investment supports.', kind: 'page' },
  academy: { title: 'Academy — Ozikoro', description: 'Learning the languages the archive is written in, with Ozituma Learn.', kind: 'page' },
  ledger: { title: 'Public ledger — Ozikoro', description: 'Donors, contributors, researchers, translators and volunteers, and where funds go.', kind: 'page' },
  projects: { title: 'Projects — Ozikoro', description: 'Programmes the archive has embarked on.', kind: 'list' },
  publications: { title: 'Publications — Ozikoro', description: 'Research papers, essays and reports, each stating whether it completed peer review.', kind: 'list' },
  igbo_calendar: { title: 'Igbo calendar — Ozikoro', description: 'The four-day market cycle, date lookup and month view.', kind: 'page' },
  'igbo-calendar': { title: 'Igbo calendar — Ozikoro', description: 'The four-day market cycle, date lookup and month view, with the anchor stated as a demonstration.', kind: 'page' },
  'cultural-calendar': { title: 'African cultural calendar — Ozikoro', description: 'Events by date, with organiser, place and verification status recorded per event.', kind: 'list' },
  journeys: { title: 'Journeys & Places — Ozikoro', description: 'Discovery by place and time across the archive.', kind: 'list' },
  'material-culture': { title: 'Material culture — Ozikoro', description: 'Objects, makers and communities held in the archive.', kind: 'list' },
  'oral-recordings': { title: 'Oral recordings — Ozikoro', description: 'Voices, consent and transcripts, given equal standing with written sources.', kind: 'list' },
  researchers: { title: 'Researchers — Ozikoro', description: 'The people who contribute to the archive, with no institution required.', kind: 'list' },
  'type-test': { title: 'Typography — Ozikoro', description: 'The type test: dotted vowels, tone marks, and the marked dotted vowels that usually break.', kind: 'page' },
  notfound: { title: 'This address does not resolve to an entry — Ozikoro', description: 'Either the entry has not been written yet, or the address has changed.', kind: 'page' },
};

/** Screens this route fills. Anything else is served untouched. */
const DASHBOARDS = [
  'dashboard-reader', 'dashboard-student', 'dashboard-teacher', 'dashboard-researcher',
  'dashboard-independent-researcher', 'dashboard-knowledge-holder', 'dashboard-editor',
  'dashboard-reviewer', 'dashboard-admin', 'dashboard-account', 'dashboard-moderation',
  'dashboard-review', 'dashboard-states', 'dashboard-workflow',
];

/** The screen name to the role it speaks for, and the label the design prints. */
const DASHBOARD_ROLE: Record<string, { role: string; label: string }> = {
  'dashboard-reader': { role: 'reader', label: 'Reader' },
  'dashboard-student': { role: 'student', label: 'Student' },
  'dashboard-teacher': { role: 'teacher', label: 'Teacher' },
  'dashboard-researcher': { role: 'researcher', label: 'Researcher' },
  'dashboard-independent-researcher': { role: 'independent_researcher', label: 'Independent researcher' },
  'dashboard-knowledge-holder': { role: 'community_knowledge_holder', label: 'Community knowledge holder' },
  'dashboard-editor': { role: 'editor', label: 'Editor' },
  'dashboard-reviewer': { role: 'expert_reviewer', label: 'Expert reviewer' },
  'dashboard-admin': { role: 'admin', label: 'Administrator' },
  'dashboard-account': { role: 'reader', label: 'Account & profile' },
  'dashboard-moderation': { role: 'moderator', label: 'Moderation queue' },
  'dashboard-review': { role: 'expert_reviewer', label: 'Evidence review' },
  'dashboard-states': { role: 'reader', label: 'Every state has a next step' },
  'dashboard-workflow': { role: 'editor', label: 'Publishing workflow' },
};

/**
 * THE SCREENS THAT ARE FILLED WITH THE ARCHIVE'S OWN CONTENT.
 *
 * **A SCREEN ABSENT FROM THIS SET IS SERVED EXACTLY AS THE DESIGN HAS IT** — and the design's text is a
 * walkthrough's, so a screen left out of this list shows a reader example people and example numbers while
 * looking entirely deliberate.
 *
 * `about` was missing from it, so `fillAbout` was written, wired, typechecked, **and never called.** The page
 * rendered the design's four invented people and nothing said so.
 */
const FILLED = new Set([
  'archive-index', 'watch', 'home', 'photographs', 'folklore', 'listen', 'topics', 'towns', 'collections',
  'documents', 'about',
  ...DASHBOARDS,
]);

async function realEntries(topicSlug: string | null, limit = 24): Promise<RealEntry[]> {
  const db = await getDb();
  const rows = await db.rows<{
    slug: string; title: string; standfirst: string | null;
    place: string | null; period: string | null; source: string | null; attached: number;
  }>(
    `select a.slug, a.title, a.standfirst,
            (select string_agg(e.name, ', ' order by e.name)
               from ozikoro_article_entity ae join ozikoro_entity e on e.id = ae.entity_id
              where ae.article_id = a.id) as place,
            a.period_label as period,
            a.source_type  as source,
            (select count(*)::int from ozikoro_article_source s where s.article_id = a.id) as attached
       from ozikoro_article a
       left join ozikoro_topic t on t.id = a.topic_id
      where a.status = 'published' and a.is_page = false
        and ($1::text is null or t.slug = $1)
      order by a.published_at desc nulls last, a.id desc
      limit $2`,
    [topicSlug, limit]
  );
  return rows.map((r) => ({
    title: r.title,
    href: `/${r.slug}/`,
    summary: r.standfirst,
    place: r.place,
    period: r.period,
    source: r.source,
    attached: Number(r.attached) || 0,
  }));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ screen: string }> }
) {
  const { screen } = await params;
  const name = screen.replace(/\.html$/, '');

  let html: string;
  try {
    html = await readFile(join(SCREEN_DIR, `${name}.html`), 'utf8');

    /*
     * THE MENU SAYS WHO THE READER IS, ON EVERY SCREEN.
     *
     * The design's last item is `My Ozikoro`, pointing at the reader dashboard — **a link that goes to a
     * dashboard whether or not anybody is signed in, and so lands a stranger on a page addressed to somebody
     * they are not.** It becomes `My account` for a signed-in reader and `Sign in / Sign up` for anybody else,
     * and it is moved to sit last, after About, as the owner asked.
     *
     * It runs here rather than inside a fill because the menu is on all 52 screens, and it runs at SERVE time
     * rather than in the design because **both states cannot be stored in one static file — which one is right
     * depends on who is asking.**
     */
    const viewer = await getCurrentAccount().catch(() => null);
    html = fillMasthead(html, { signedIn: Boolean(viewer) });
  } catch {
    return new Response('Not found', { status: 404 });
  }

  if (!FILLED.has(name)) {
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  /*
   * DECLARED OUTSIDE THE TRY, because the head is written after it — and a fill that throws must still leave a
   * page with its own title rather than falling back to the design's demonstration one.
   */
  let extraNodes: Record<string, unknown>[] = [];

  try {
    if (name === 'about') {
      /*
       * THE ABOUT PAGE, WITH THE ARCHIVE'S OWN NUMBERS.
       *
       * **Counted here rather than written into the design**, because a figure typed into a static file is true
       * on the day it is typed and quietly wrong afterwards. The uncomfortable counts are included: the records
       * held in review, and **0 recorded licences for 3,488 media items** — the archive's largest open problem,
       * and the one a reader is least likely to guess.
       */
      const db = await getDb();
      const counts = await db.one<{ published: number; review: number; media: number }>(
        `select
           (select count(*) from ozikoro_article where status='published' and is_page=false)::int published,
           (select count(*) from ozikoro_article where status='review')::int review,
           (select count(*) from ozikoro_media)::int media`
      );
      const people = await db.rows<{ slug: string; name: string; records: number; bio: string | null }>(
        `select c.slug, c.display_name as name, count(a.id)::int as records, c.bio
           from ozikoro_contributor c
           left join ozikoro_article a on a.author_id = c.id and a.status = 'published' and a.is_page = false
          group by c.id, c.slug, c.display_name, c.bio
          order by records desc, c.display_name`
      );
      const rights = await db.one<{ sources: number; licences: number }>(
        /*
         * THE COLUMN IS `licence`, NOT `licence_code`.
         *
         * `licence_code` failed with `column "licence_code" does not exist` — and **the catch serves the design
         * unfilled, so a wrong column name looks exactly like a page nobody has written a fill for.** That is
         * how this was found: an expected figure was missing from the output.
         */
        `select (select count(*) from ozikoro_article
                  where status='published' and body_html ~* '<h[1-6][^>]*>[^<]*(references|sources|bibliography)')::int sources,
                (select count(*) from ozikoro_media_rights where licence is not null and licence <> '')::int licences`
      );
      html = fillAbout(html, {
        published: counts?.published ?? 0,
        inReview: counts?.review ?? 0,
        media: counts?.media ?? 0,
        towns: counts?.published ?? 0,
        sources: rights?.sources ?? 0,
        licences: rights?.licences ?? 0,
        contributors: people,
      });
    }

    if (name === 'archive-index') {
      const url = new URL(request.url);
      const topic = url.searchParams.get('topic');
      const db = await getDb();
      const [entries, ethnic, topics, total] = await Promise.all([
        realEntries(topic),
        db.rows<{ ethnic_group: string; n: number }>(
          `select coalesce(ethnic_group, 'Unrecorded') ethnic_group, count(*)::int n
             from clan where published = true group by 1 order by n desc, 1 limit 6`
        ),
        db.rows<{ slug: string; name: string; n: number }>(
          `select t.slug, t.name, count(a.id)::int n from ozikoro_topic t
             left join ozikoro_article a on a.topic_id = t.id and a.status = 'published' and a.is_page = false
            group by t.slug, t.name order by n desc`
        ),
        db.one<{ n: number }>(
          `select count(*)::int n from ozikoro_article where status = 'published' and is_page = false`
        ),
      ]);
      html = fillArchiveIndex(html, {
        entries,
        ethnic: ethnic.map((e) => ({ name: e.ethnic_group, count: e.n })),
        topics: topics.map((t) => ({ slug: t.slug, name: t.name, count: t.n })),
        total: total?.n ?? 0,
      });
    }
    /*
     * FURTHER GRAPH NODES, FOR THE PAGES THAT DESCRIBE MORE THAN THEMSELVES.
     *
     * `/towns` is a list of 188 places and `/photographs` is a collection of images with a rights state on
     * each. **Those are facts about the page's subject rather than about the page**, so they go into the same
     * graph rather than into a second head.
     */
    if (name === 'documents') {
      /*
       * ONLY THE FILES. Eight of the twelve records the migration called `document` are `text/html` — saved
       * web pages — and **a capture is not a document a reader can download.** Listing them would repeat the
       * fault this archive already recorded once: presenting web captures as documents.
       */
      const db = await getDb();
      const rows = await db.rows<{ id: number; title: string | null; storage_key: string; filesize_bytes: number | null }>(
        `select id, title, storage_key, filesize_bytes from ozikoro_media
          where kind = 'document' and mime_type = 'application/pdf' and storage_key is not null
          order by id`
      );
      const docs: RealDocument[] = rows.map((r) => ({
        title: r.title?.trim() || `Document ${r.id}`,
        // THE KEY CAN CONTAIN SPACES. `storage_key` is derived from the WordPress filename, and a filename
        // like `11237-Igbo Folk Idioms in Caribbean Phrase.pdf` is stored verbatim. **An unencoded space
        // truncates the URL at the space**, so the link 404s on exactly the files whose names are most
        // descriptive. Each segment is encoded, and `/` between them is preserved.
        href: `/media/${r.storage_key.split('/').map(encodeURIComponent).join('/')}`,
        label: 'Held by the archive · PDF',
        note: 'Downloadable file held in the archive. Rights and reuse terms are recorded with the record.',
        size: r.filesize_bytes ? `${Math.max(1, Math.round(r.filesize_bytes / 1024))} KB` : null,
      }));
      if (docs.length > 0) html = fillDocuments(html, docs);
    }

    if (DASHBOARDS.includes(name)) {
      /*
       * A ROLE DASHBOARD, FILLED WITH WHAT THE ACCOUNT ACTUALLY HOLDS.
       *
       * **The design's metrics are examples — "Saved histories 12" — and a member who joined a minute ago has
       * none of them.** So every count is real, the work panel becomes an honest empty state, and the
       * capabilities shown are the ones the account's roles genuinely grant.
       *
       * **A visitor who is not signed in gets the page too**, told plainly that the workspace is theirs to
       * claim. That is the owner's point about "My Ozikoro": **it must not open on a sign-in form, because a
       * sign-in form is no use to somebody who has not joined.**
       */
      const current = await getCurrentAccount();
      const db = await getDb();
      let who: DashboardWho = {
        signedIn: false,
        name: null,
        roleLabel: DASHBOARD_ROLE[name]?.label ?? 'Reader',
        roles: [],
        capabilities: [],
        today: new Date().toLocaleDateString('en-GB', {
          weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
        }),
      };
      if (current) {
        const account = current.account;
        const roles = await db.rows<{ role: string }>(
          `select role from ozikoro_member_role where account_id = $1 order by role`, [account.id]
        );
        const caps = await db.rows<{ capability: string }>(
          // A set-returning function's column is named after the FUNCTION, not after what it returns.
          // `select capability from ozikoro_capabilities($1)` failed with `column "capability" does not exist`
          // on every dashboard render — and the catch swallowed it, **so the page quietly fell back to the
          // design's example content and looked like it had never been filled at all.**
          `select ozikoro_capabilities as capability from ozikoro_capabilities($1) order by 1`, [account.id]
        );
        who = {
          ...who,
          signedIn: true,
          name: account.displayName ?? null,
          roles: roles.map((r) => r.role),
          capabilities: caps.map((c) => c.capability),
        };
      }
      html = fillDashboard(html, who);
    }

    if (name === 'towns') {
      /*
       * THE 188 PUBLISHED TOWNS AND CLANS.
       *
       * A town with no linked record says so in place of a count — **`No records yet` rather than `0 records`
       * or, worse, a number that flatters the page.** A photograph is used only where the record has one from
       * a linked article; the rest are drawn without an image rather than given a stand-in.
       */
      const db = await getDb();
      const rows = await db.rows<{ slug: string; name: string; region: string | null; n: number; img: string | null }>(
        `select c.slug, c.name, c.region,
                (select count(*)::int from ozikoro_article_entity ae where ae.entity_id = e.id) as n,
                (select m.storage_key
                   from ozikoro_article a
                   join ozikoro_media m on m.id = a.featured_media_id
                  where a.status = 'published' and a.is_page = false
                    and a.id in (select ae2.article_id from ozikoro_article_entity ae2 where ae2.entity_id = e.id)
                  limit 1) as img
           from clan c left join ozikoro_entity e on e.clan_id = c.id
          where c.published = true
          order by c.name`
      );
      const towns: RealTown[] = rows.map((r) => ({
        name: r.name, href: `/town/${r.slug}/`, region: r.region, image: r.img ? mediaPath(r.img) : null, records: Number(r.n) || 0,
      }));
      if (towns.length > 0) html = fillTowns(html, towns);
      // A Place per town. **No coordinates**: the archive holds none, and a pin that looks like evidence is
      // the most convincing kind of invented content there is.
      extraNodes = towns.map((t) =>
        placeNode({
          name: t.name,
          url: `https://ozikoro.com${t.href}`,
          region: t.region,
          description: t.records > 0 ? `${t.records} record(s) in the archive.` : 'No records yet.',
        })
      );
    }

    if (name === 'collections') {
      /*
       * THE FOUR COLLECTIONS, WITH THE ARCHIVE'S OWN SIZES.
       *
       * **The counts are what the archive holds**, and the oral-recordings card says plainly that it holds no
       * recording — 13 video records and no audio — rather than borrowing a number from another collection.
       */
      const db = await getDb();
      const counts = await db.one<{ images: number; videos: number; docs: number }>(
        `select count(*) filter (where kind = 'image')::int images,
                count(*) filter (where kind = 'video')::int videos,
                count(*) filter (where kind = 'document')::int docs
           from ozikoro_media`
      );
      const hero = await db.one<{ img: string | null }>(
        `select storage_key as img from ozikoro_media
          where kind = 'image' and storage_key is not null order by id limit 1`
      );
      const collections: RealCollection[] = [
        { label: 'Visual archive', name: 'Photographs', href: '/photographs',
          cta: `${(counts?.images ?? 0).toLocaleString('en-GB')} image records`, image: hero?.img ?? null, glyph: null },
        { label: 'Written archive', name: 'Documents & maps', href: '/documents',
          cta: `${(counts?.docs ?? 0).toLocaleString('en-GB')} document records`, image: null, glyph: '≡' },
        { label: 'Recorded archive', name: 'Oral recordings', href: '/listen',
          cta: 'No recording held yet', image: null, glyph: '◉' },
        { label: 'Material archive', name: 'Material culture', href: '/material-culture',
          cta: `${(counts?.videos ?? 0).toLocaleString('en-GB')} video records`, image: null, glyph: '◈' },
      ];
      html = fillCollections(html, collections);
    }

    if (name === 'folklore') {
      // The 17 records the archive files under Folklores, with a photograph from the record where it has one.
      const db = await getDb();
      const rows = await db.rows<{ slug: string; title: string; topic: string | null; img: string | null }>(
        `select a.slug, a.title, t.name as topic,
                (select m.storage_key from ozikoro_media m where m.id = a.featured_media_id) as img
           from ozikoro_article a
           join ozikoro_topic t on t.id = a.topic_id
          where a.status = 'published' and a.is_page = false and t.slug = 'folklores'
          order by a.title limit 24`
      );
      if (rows.length > 0) {
        html = fillFolklore(html, rows.map((r) => ({
          title: r.title, href: `/${r.slug}/`, topic: r.topic, image: r.img ? mediaPath(r.img) : null, alt: r.title,
        })));
      }
    }

    if (name === 'listen') {
      /*
       * THE ARCHIVE HOLDS NO AUDIO. It holds 13 video records and no recording, so nothing here is presented
       * as one: each row is the written record, and the length column says `Read` rather than a duration
       * nobody measured. **A listen page that claimed episodes would be the plainest kind of invention.**
       */
      const db = await getDb();
      const rows = await db.rows<{ slug: string; title: string; topic: string | null; img: string | null }>(
        `select a.slug, a.title, t.name as topic,
                (select m.storage_key from ozikoro_media m where m.id = a.featured_media_id) as img
           from ozikoro_article a
           left join ozikoro_topic t on t.id = a.topic_id
          where a.status = 'published' and a.is_page = false
          order by a.published_at desc nulls last limit 12`
      );
      const tracks: RealTrack[] = rows.map((r) => ({
        title: r.title, href: `/${r.slug}/`, series: r.topic ?? 'The archive', image: r.img ? mediaPath(r.img) : null, length: 'Read',
      }));
      if (tracks.length > 0) html = fillListen(html, tracks);
    }

    if (name === 'topics') {
      // The archive's fourteen categories and its 188 towns, in the design's A–Z shape.
      const db = await getDb();
      const [cats, towns] = await Promise.all([
        db.rows<{ slug: string; name: string; n: number }>(
          `select t.slug, t.name, count(a.id)::int n from ozikoro_topic t
             left join ozikoro_article a on a.topic_id = t.id and a.status = 'published' and a.is_page = false
            group by t.slug, t.name order by t.name`
        ),
        db.rows<{ slug: string; name: string }>(
          `select slug, name from clan where published = true order by name`
        ),
      ]);
      const entries: RealAzEntry[] = [
        ...cats.map((c) => ({ name: c.name.trim(), href: `/archive-index?topic=${c.slug}`, kind: 'Category' as const })),
        ...towns.map((t) => ({ name: t.name, href: `/town/${t.slug}/`, kind: 'Place' as const })),
      ];
      if (entries.length > 0) html = fillTopics(html, entries);
    }

    if (name === 'photographs') {
      /*
       * THE PHOTOGRAPHS, SERVED FROM THIS ARCHIVE RATHER THAN HOT-LINKED.
       *
       * The design's example image points at `https://ozikoro.com/wp-content/uploads/…`, which is the live
       * WordPress install. These point at `/media/…` on this site, where the archive's own 3,437 files are
       * served, so the page does not depend on the system it is replacing.
       */
      const db = await getDb();
      const rows = await db.rows<{
        id: number; title: string | null; alt_text: string | null; storage_key: string | null;
        creator: string | null; credit: string | null; licence: string | null; captured_at: Date | null;
      }>(
        `select id, title, alt_text, storage_key, creator, credit, licence, captured_at
           from ozikoro_media
          where kind = 'image' and storage_key is not null
          order by id limit 24`
      );
      const photos: RealPhotograph[] = rows.filter((r) => r.storage_key).map((r) => ({
        id: r.id,
        title: r.title?.trim() || `Photograph ${r.id}`,
        alt: r.alt_text?.trim() || r.title?.trim() || 'Archive photograph',
        // `filter` does not narrow the property, and the guard above is what makes this safe.
        src: mediaPath(r.storage_key as string),
        creator: r.creator,
        credit: r.credit,
        licence: r.licence,
        captured: r.captured_at ? new Date(r.captured_at).toISOString().slice(0, 10) : null,
      }));
      if (photos.length > 0) html = fillPhotographs(html, photos);
      // An ImageObject per photograph. `licence` is null for every one of them, so `imageNode` emits a
      // `copyrightNotice` saying so rather than a `license` asserting a permission nobody granted.
      extraNodes = photos.map((ph) =>
        imageNode({
          url: `https://ozikoro.com/photographs/`,
          contentUrl: `https://ozikoro.com${ph.src}`,
          caption: ph.title,
          creator: ph.creator,
          credit: ph.credit,
          licence: ph.licence,
        })
      );
    }

    if (name === 'home') {
      // The five most recent published records, with their topic as the design's `<span class="tag">`.
      const db = await getDb();
      const rows = await db.rows<{ slug: string; title: string; topic: string | null }>(
        `select a.slug, a.title, t.name as topic
           from ozikoro_article a left join ozikoro_topic t on t.id = a.topic_id
          where a.status = 'published' and a.is_page = false
          order by a.published_at desc nulls last, a.id desc limit 5`
      );
      if (rows.length > 0) {
        html = fillHome(html, rows.map((r) => ({ title: r.title, href: `/${r.slug}/`, topic: r.topic })));
      }
    }

    if (name === 'watch') {
      /*
       * THE FILMS THE ARCHIVE ACTUALLY HOLDS.
       *
       * 24 published articles embed a YouTube video and 23 have a readable id, so **no video was sourced from
       * outside the archive** — the owner's fallback was not needed. The title is the article's own, the href
       * is the article, and the poster frame is YouTube's for that id.
       */
      const db = await getDb();
      const rows = await db.rows<{ slug: string; title: string; ytid: string }>(
        `select a.slug, a.title,
                substring(a.body_html from '(?:youtube\\.com/embed/|youtu\\.be/|youtube\\.com/watch\\?v=)([A-Za-z0-9_-]{11})') as ytid
           from ozikoro_article a
          where a.status = 'published' and a.is_page = false
            and a.body_html ~ '(youtube\\.com/embed/|youtu\\.be/|youtube\\.com/watch\\?v=)'
          order by a.published_at desc nulls last`
      );
      const films: RealFilm[] = rows
        .filter((r) => r.ytid)
        .map((r) => ({ id: r.ytid, title: r.title, source: 'Ozikoro archive film', href: `/${r.slug}/` }));
      if (films.length > 0) html = fillWatch(html, films);
    }
  } catch (error) {
    // Degrade to the design rather than to an error page, and say so in the log.
    console.error(`design fill failed for ${name}:`, error);
  }

  /*
   * EVERY SCREEN GETS A REAL HEAD, NOT THE WALKTHROUGH'S.
   *
   * The deliverable's screens each carry the design's own `<title>` — "Nwagu Aneke", "Ozikoro article reader"
   * and so on — because they were written for a walkthrough. **Served as the site, all fifty-one announced
   * themselves as the same demonstration.** `SCREEN_SEO` gives each the title and description it should have,
   * and anything not listed falls back to a generic one rather than to the design's example.
   */
  const meta = SCREEN_SEO[name] ?? {
    title: `${name.replace(/-/g, ' ')} — Ozikoro`,
    description: 'A page in the Ozikoro archive of Igbo and African histories, culture and scholarship.',
  };
  const trail = [
    { name: 'Ozikoro', path: '/' },
    ...(name === 'home' ? [] : [{ name: meta.title.split(' — ')[0] ?? name, path: `/${name}/` }]),
  ];
  html = withSeoHead(
    html,
    seoHead(
      {
        path: name === 'home' ? '/' : `/${name}/`,
        title: meta.title,
        description: meta.description,
        kind: meta.kind ?? 'page',
        image: null,
        trail,
        extraNodes,
        // A dashboard, a search page and the form behind the auth gate are not for indexing.
        noindex: name.startsWith('dashboard') || name === 'search' || name === 'upload' || name === 'signin',
      },
      ['/design/styles/main.css', '/design/styles/showcase.css', '/a11y.css']
    )
  );

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
