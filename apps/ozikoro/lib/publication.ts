/**
 * ONE DEFINITION OF "ARTICLE TO PUBLICATION".
 *
 * The download route and the command-line generator both call this. **They must not each have their own** —
 * earlier in this project the narration had two renderers, the chunking was added to one, and the other failed
 * on an article the first handled. The same shape of mistake is available here and is not being repeated.
 *
 * WHAT IT READS, AND WHAT IT REFUSES TO GUESS
 *
 * The article's own title, standfirst, body, captions, featured image and references. **Every field is read
 * from the database and none is assumed to exist** — the schema is inspected rather than imagined, and a record
 * with no subtitle, no biography or no image simply has no subtitle, no biography or no image.
 */
import { readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { getDb } from '@ozituma/db/client';
import {
  ArticlePdf, citationForSource, decodePng, isJpeg, isPng, jpegSize,
  type ArticleLogo, type Block, type FontSet, type Raster, type SourceRow,
} from '@ozikoro/platform';

/**
 * Where the media and the logo live, found by walking up rather than by assuming a working directory.
 *
 * **This was `join(process.cwd(), '.data', 'media', 'ozikoro')` and it silently produced publications with no
 * figures at all.** The command-line generator runs from the repository root, where that path is right; the
 * standalone server runs from `apps/ozikoro/.next/standalone`, where it is not — **and the failure was
 * invisible, because a record with no image and a record whose image cannot be found render the same page.**
 *
 * The download route returned 200, `application/pdf`, `%PDF-1.4` … `%%EOF`, seven pages — and not one image
 * object in it. **A valid document with the pictures missing is exactly the fault that survives every check
 * except looking at it.**
 */
function findRoot(): string {
  let dir = process.cwd();
  /*
   * EIGHT LEVELS, BECAUSE THE SERVER'S WORKING DIRECTORY IS SEVEN ABOVE THE DATA.
   *
   * `serve-review.sh` runs `node apps/ozikoro/server.js` from the standalone root, **but the standalone's own
   * server.js moves into its app directory**, so `process.cwd()` is:
   *
   *     staging/apps/ozikoro/.next/standalone/apps/ozikoro
   *
   * From there `staging/.data` is **six** directories up, and this loop ran `i < 6` — meaning it tested levels
   * 0 to 5 and stopped at `staging/apps`, one short. So it never found the media, `jpegOf` returned null for
   * every figure and the logo, and the route served a valid seven-page PDF with no pictures in it.
   *
   * **The count was a guess and the guess was one too small.** Being generous costs one `existsSync` per level
   * and cannot be wrong in the direction that matters.
   */
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, '.data', 'media', 'ozikoro');
    if (existsSync(candidate)) return candidate;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  // Not found: the caller's `existsSync` check then leaves each figure out rather than throwing.
  return join(process.cwd(), '.data', 'media', 'ozikoro');
}

const MEDIA_ROOT = findRoot();

/**
 * AN IMAGE THE PDF CAN EMBED, FOUND FROM THE RECORD'S OWN REFERENCE TO IT.
 *
 * A PDF carries a JPEG natively and any raster as raw samples. **It carries neither a WebP nor a URL**, and
 * two silent faults came out of that gap:
 *
 *   1. **A body figure whose `src` was a full WordPress URL was never found at all**, because the lookup
 *      joined the whole URL onto the media directory. `https://ozikoro.com/wp-content/uploads/2026/09/
 *      ute-king.webp` is not a filename, so `existsSync` said no and the figure was left out — a record
 *      whose text describes a photograph printed without one, and nothing said so.
 *   2. **The media directory stores the same picture under a WordPress attachment prefix** — the file is
 *      `11234-ute-king.webp`, not `ute-king.webp` — so even the basename does not join to it directly.
 *
 * So the reference is reduced to its last path segment, looked for exactly, and then looked for as the
 * suffix of a stored name. **The same URL resolution applies to the featured image and to a figure in the
 * body**, because they are the same problem and were not.
 *
 * A conversion failure returns null and the figure is left out: a missing figure is a smaller fault than a
 * corrupt one, which is the rule this file already followed.
 */
const CONVERT_CACHE = join(process.cwd(), '.data', 'publication-images');

/** Every stored media name, read once. **3438 entries, and one `readdir` rather than one per figure.** */
let mediaIndexCache: string[] | null = null;
function mediaIndex(): string[] {
  if (mediaIndexCache) return mediaIndexCache;
  try {
    mediaIndexCache = readdirSync(MEDIA_ROOT);
  } catch {
    mediaIndexCache = [];
  }
  return mediaIndexCache;
}

/** The stored name a reference points at, whether it arrives as a key, a URL path or a bare filename. */
function storedName(key: string): string | null {
  const cleaned = key.replace(/^ozikoro\//, '').replace(/[?#].*$/, '');
  const tail = cleaned.includes('/') ? (cleaned.split('/').pop() as string) : cleaned;
  if (!tail) return null;
  if (existsSync(join(MEDIA_ROOT, tail))) return tail;
  const index = mediaIndex();
  if (index.includes(tail)) return tail;
  // The attachment prefix is an id and a hyphen: `11234-ute-king.webp` for `ute-king.webp`.
  const suffixed = index.find((name) => name.endsWith(`-${tail}`));
  return suffixed ?? null;
}

function toJpeg(path: string, name: string): Buffer | null {
  const cached = join(CONVERT_CACHE, `${name.replace(/[\/]/g, '_')}.jpg`);
  if (existsSync(cached)) {
    const cachedData: Buffer = readFileSync(cached);
    return isJpeg(cachedData) ? cachedData : null;
  }
  try {
    mkdirSync(CONVERT_CACHE, { recursive: true });
    /*
     * `-s format jpeg` and a quality of 88.
     *
     * **High enough that a printed page shows no artefacts and low enough that a five-image publication is
     * not fifty megabytes.** This path is only reached for formats the writer cannot embed itself — WebP —
     * and it needs `sips`, which exists on macOS and **not on the Linux host the archive deploys to.**
     * There, a WebP figure is still left out; PNG no longer depends on this at all.
     */
    const r = spawnSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '88', path, '--out', cached], {
      stdio: 'ignore',
    });
    if (r.status !== 0 || !existsSync(cached)) return null;
    const cachedData: Buffer = readFileSync(cached);
    return isJpeg(cachedData) ? cachedData : null;
  } catch {
    return null;
  }
}

/**
 * One image, ready for the layout: **JPEG or PNG, with its real pixel dimensions.**
 *
 * WHY EVERY DROP IS NAMED IN THE LOG, AND WHY THAT IS THE FIX RATHER THAN A COURTESY
 *
 * This function returning `null` is the whole mechanism by which a figure disappears from a publication,
 * and it used to do it **without a word**. The measured cost of that silence: a PNG with transparency was
 * shelled out to `sips` to become a JPEG, `sips` exists on macOS and not on the Linux host the archive
 * deploys to, and **on that host every PNG figure vanished from the PDF while the build reported success**
 * — 438 figures, no error, nothing in any log. The PNG half of that is fixed in-process
 * (`decodePng`, `packages/ozikoro/src/pdf/png.ts`), and this comment is the record of why.
 *
 * THE WEBP HALF IS NOT FIXED, AND IT IS STILL SILENT WITHOUT THIS. There is no WebP decoder in this
 * repository: the format needs the container parsed and a VP8/VP8L/VP8X frame decoded, which is a codec
 * rather than an afternoon, and **pretending otherwise is how a WebP's bytes end up in an image object that
 * claims to be a JPEG.** The archive holds 229 WebP figures. So the honest state is: WebP is dropped, and
 * now it is dropped BY NAME, with the reason and the file, instead of not at all.
 *
 * A dropped figure is not a fault the reader can report, because the reader never sees it — the page looks
 * finished and one photograph is simply absent. **This log line is therefore the only place the fault is
 * observable, and it is written at warn level with a greppable prefix so an operator can count it across a
 * build:**
 *
 *     grep -c 'publication: dropped figure' <log>
 */
function imageOf(reference: string | null | undefined): Raster | null {
  if (!reference) return null;
  const name = storedName(reference);
  if (!name) {
    console.error(`publication: dropped figure — no stored file matches ${reference}`);
    return null;
  }
  const path = join(MEDIA_ROOT, name);
  if (!existsSync(path)) {
    console.error(`publication: dropped figure — ${name} is not in the media root`);
    return null;
  }
  const data: Buffer = readFileSync(path);
  if (isPng(data)) {
    try {
      const png = decodePng(data);
      return { data, width: png.width, height: png.height };
    } catch (error) {
      /*
       * A named refusal rather than a half-decoded picture: a PNG decoded wrongly looks like a photograph
       * of noise, which nobody reports as a bug. The decoder refuses bit depths other than 8 and Adam7
       * interlacing by name.
       */
      console.error(`publication: dropped figure — ${name} could not be decoded as PNG: ${String(error)}`);
      return null;
    }
  }
  if (!isJpeg(data)) {
    const converted = toJpeg(path, name);
    if (!converted) {
      console.error(
        `publication: dropped figure — ${name} is neither JPEG nor PNG and could not be converted. ` +
          'WebP needs a decoder this repository does not have (the PNG decoder is in-process; WebP is not), ' +
          'and `sips` is macOS-only. The figure is absent from the PDF; the page shows it normally.'
      );
      return null;
    }
    const size = jpegSize(converted);
    return size ? { data: converted, ...size } : null;
  }
  const size = jpegSize(data);
  if (!size) {
    console.error(`publication: dropped figure — ${name} is a JPEG whose dimensions could not be read`);
    return null;
  }
  return { data, ...size };
}

/**
 * THE OFFICIAL ASSETS, READ FROM THE REPOSITORY RATHER THAN FETCHED.
 *
 * Two things are read here and both are the writer's own type:
 *
 *   `assets/official/ozikoro-icon-yellow.png` — the brand's icon, rendered from its own SVG so that the
 *   transparency survives into the PDF through an `/SMask`. **It replaced two JPEGs that had been cut out of
 *   an unrelated reference PDF**, whose artwork was not this brand's and whose transparent pixels had been
 *   composited onto a guessed ivory. Nothing about that composite was right on a charcoal cover.
 *
 *   `assets/fonts/DejaVuSerif*.ttf` and `DejaVuSans*.ttf` — the faces the reference itself embeds. **With
 *   them the writer can draw `ọ ụ ị ṅ`; without them it falls back to the base-14 fonts, which cannot**, and
 *   every one of those letters becomes a `?` in an Igbo article. They are the same family the approved
 *   reference uses, under the DejaVu licence shipped beside them.
 *
 * WHY THE DIRECTORY IS SEARCHED RATHER THAN COMPUTED
 *
 * This one function serves three callers with three different working directories, and **a path built from
 * `process.cwd()` alone is right for exactly one of them**: the command-line generator runs from the
 * repository root, `next dev` runs from `apps/ozikoro`, and the deployed image runs `node
 * apps/ozikoro/server.js` from `/app`. A wrong guess here does not throw — it silently drops the wordmark
 * and prints the type-set fallback instead, which is the kind of fault that is only noticed on the printed
 * page. So the directory is looked for upwards from the working directory, and the icon file is what
 * identifies it.
 */
function assetsRoot(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'packages', 'ozikoro', 'assets');
    if (existsSync(join(candidate, 'official', 'ozikoro-icon-yellow.png'))) return candidate;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

let logoCache: ArticleLogo | null | undefined;
function logo(): ArticleLogo | null {
  if (logoCache !== undefined) return logoCache;
  const root = assetsRoot();
  if (!root) {
    logoCache = null;
    return null;
  }
  let icon: Raster | null = null;
  try {
    const data: Buffer = readFileSync(join(root, 'official', 'ozikoro-icon-yellow.png'));
    const png = decodePng(data);
    icon = { data, width: png.width, height: png.height };
  } catch {
    icon = null;
  }
  logoCache = { icon };
  return logoCache;
}

/** The five faces, by role. **Null when they are absent, which the layout treats as the fallback.** */
let fontCache: FontSet | null | undefined;
function fonts(): FontSet | null {
  if (fontCache !== undefined) return fontCache;
  const root = assetsRoot();
  if (!root) {
    fontCache = null;
    return null;
  }
  const read = (name: string): Buffer | undefined => {
    try {
      return readFileSync(join(root, 'fonts', name));
    } catch {
      return undefined;
    }
  };
  const set: FontSet = {
    serif: read('DejaVuSerif.ttf'),
    serifBold: read('DejaVuSerif-Bold.ttf'),
    serifItalic: read('DejaVuSerif-Italic.ttf'),
    sans: read('DejaVuSans.ttf'),
    sansBold: read('DejaVuSans-Bold.ttf'),
  };
  const any = Object.values(set).some(Boolean);
  fontCache = any ? set : null;
  return fontCache;
}

/**
 * WordPress writes curly punctuation as numeric entities, so every string that reaches the page is decoded.
 *
 * **The first PDF said `Ute-Okpu&#8217;s own`**, because stripping tags does not decode what the tags held.
 */
const ENT: [RegExp, string][] = [
  [/&#8217;|&rsquo;/g, '\u2019'], [/&#8216;|&lsquo;/g, '\u2018'],
  [/&#8220;|&ldquo;/g, '\u201c'], [/&#8221;|&rdquo;/g, '\u201d'],
  [/&#8211;|&ndash;/g, '\u2013'], [/&#8212;|&mdash;/g, '\u2014'],
  [/&#8230;|&hellip;/g, '\u2026'], [/&nbsp;/g, ' '], [/&amp;/g, '&'],
  [/&lt;/g, '<'], [/&gt;/g, '>'], [/&quot;/g, '"'], [/&#39;|&apos;/g, "'"],
];
export function decodeEntities(text: string): string {
  let t = text;
  for (const [re, ch] of ENT) t = t.replace(re, ch);
  return t.replace(/&#\d+;/g, ' ');
}
/**
 * Text from markup.
 *
 * **A tag is replaced with a space, which is right between two words and wrong before punctuation.** A list
 * item ending in a link came out as `…ApartmentGuide.com .` — the closing tag's space, then the full stop that
 * belonged to the sentence. The space is removed where the character after it is punctuation that does not
 * begin a word.
 */
const clean = (s: string) =>
  decodeEntities(s.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?)\u2019\u201d])/g, '$1')
    .trim();

/**
 * The article's structure, as blocks.
 *
 * **A heading stays a heading, a paragraph stays a paragraph, and an image keeps its own caption.** The
 * renderer is not allowed to reorder, summarise or merge any of it.
 */
export function toBlocks(html: string): Block[] {
  /*
   * THE REFERENCES ARE TAKEN OUT OF THE BODY, BECAUSE THE LAYOUT PRINTS THEM ITSELF.
   *
   * `referencesOf` reads the record's own list and the layout sets it as a numbered scholarly section. **But
   * the body parser also walked straight into that same list and emitted it as bullets**, so every record with
   * references printed them twice — once as `· Isichei, E. (1976)…` at the end of the article and once as `01
   * Isichei, E. (1976)…` under References. Visible on two consecutive pages of the Ute-Okpu publication.
   *
   * The body stops where the references begin. **A record with no references heading is unaffected, because
   * there is nothing to stop at.**
   */
  const refAt = html.search(/<h[1-6][^>]*>[^<]*\b(references?|bibliography|sources?)\b[^<]*<\/h[1-6]>/i);
  const body = refAt === -1 ? html : html.slice(0, refAt);
  const blocks: Block[] = [];
  const re =
    /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>|<figure[^>]*>([\s\S]*?)<\/figure>|<p[^>]*>([\s\S]*?)<\/p>|<(ul|ol)[^>]*>([\s\S]*?)<\/\5>|<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi;
  for (const m of body.matchAll(re)) {
    if (m[1]) {
      const text = clean(m[2] ?? '');
      // The references heading is dropped here because the layout writes its own, with numbering.
      if (text && !/^(references?|sources?|bibliography)$/i.test(text)) {
        blocks.push({ kind: 'heading', level: m[1] === 'h1' || m[1] === 'h2' ? 2 : 3, text });
      }
    } else if (m[3] !== undefined) {
      const fig = m[3];
      const img = /<img[^>]*src="([^"]+)"[^>]*>/i.exec(fig);
      if (img) {
        const picture = imageOf((img[1] as string).replace(/^\/media\//, ''));
        const caption = clean(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(fig)?.[1] ?? '') || null;
        if (picture) blocks.push({ kind: 'image', ...picture, caption, credit: null });
      }
    } else if (m[4] !== undefined) {
      const text = clean(m[4]);
      if (text.length > 40) blocks.push({ kind: 'paragraph', text });
    } else if (m[5]) {
      const items = [...(m[6] ?? '').matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((x) => clean(x[1] ?? '')).filter(Boolean);
      if (items.length) blocks.push({ kind: 'list', items });
    } else if (m[7] !== undefined) {
      /*
       * A PULL QUOTE IS PERMITTED, NEVER WRITTEN.
       *
       * The brief allows a pull quote where the article has one, and **the only thing that produces a quote
       * block is a `<blockquote>` the record already carries — the text goes in whole and verbatim.** Nothing
       * here shortens a quotation to fit a measure, lifts a sentence out of a paragraph, or writes one for an
       * article that has none: a record with no blockquote gets no pull quote, and **that empty space is the
       * correct outcome rather than a gap to fill.** The filter below is a length floor, not a choice of which
       * lines are worth quoting.
       */
      const text = clean(m[7]);
      if (text.length > 30) blocks.push({ kind: 'quote', text });
    }
  }
  return withInfobox(blocks);
}

/**
 * A KEY/VALUE ROW, AS THE ARTICLE ITSELF WRITES ONE.
 *
 * `Label: value`, with a short label — letters, spaces and the few marks a label contains — so that a
 * **citation cannot be mistaken for one**: `Finnegan, R. (201:2). Oral literature in Africa` fails on the
 * comma before it ever reaches its colon, and a label is capped at 24 characters so an address's `https:`
 * cannot become a label either.
 */
const FACT_ROW = /^([A-Z][A-Za-z0-9 &/'\u2019-]{1,23}):\s*(\S.*)$/;

/**
 * AN INFORMATION BOX, AND THE RULE THAT DECIDES WHETHER ONE EXISTS AT ALL.
 *
 * **This only ever permits. It never composes, and there is no branch here that writes a label or a value** —
 * both are cut out of a list the record already contains, and the box is drawn with no title because a title
 * would be a heading this renderer had to think of. "Quick reference" over four facts the article never
 * grouped under one is exactly the invention the brief forbids, and it is the easy thing to do here.
 *
 * The conditions are deliberately narrow, and **the positional one is what stops the commonest false
 * positive**: a record's references are a `<ul>` or `<ol>` too, so a list is only considered when it falls in
 * the first third of the body, and the closing apparatus is never boxed. The shape test then refuses the
 * rest — an achievements list has no labels to lay out, only sentences.
 *
 *   - the article's FIRST list, and only that one;
 *   - inside the first third of the body's blocks;
 *   - 2 to 8 items, none longer than 140 characters;
 *   - every item shaped `Label: value`.
 *
 * Where a record fails any of these it gets a plain bulleted list, exactly as before. **Most records fail
 * them and get no box, which is the intended outcome**: an absent box costs a reader nothing, and a
 * synthesised one puts words in the article's mouth.
 */
function withInfobox(blocks: Block[]): Block[] {
  const at = blocks.findIndex((b) => b.kind === 'list');
  if (at < 0) return blocks;
  if (at >= Math.ceil(blocks.length / 3)) return blocks;
  const list = blocks[at] as Extract<Block, { kind: 'list' }>;
  if (list.items.length < 2 || list.items.length > 8) return blocks;
  const rows: { label: string; value: string }[] = [];
  for (const item of list.items) {
    const row = FACT_ROW.exec(item);
    if (!row || item.length > 140) return blocks;
    rows.push({ label: (row[1] as string).trim(), value: (row[2] as string).trim() });
  }
  const out = blocks.slice();
  out[at] = { kind: 'infobox', rows };
  return out;
}

/** The references the record carries. **No heading means no section, never an invented one.** */
export function referencesOf(html: string): string[] {
  const m = /<h[1-6][^>]*>[^<]*\b(references?|bibliography|sources?)\b[^<]*<\/h[1-6]>([\s\S]*)/i.exec(html);
  if (!m) return [];
  const region = (m[2] ?? '').split(/<h[1-6][^>]*>/i)[0] ?? '';
  const items = [...region.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((x) => clean(x[1] ?? ''))
    .filter((t) => t.length > 12);
  if (items.length) return items;
  return [...region.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((x) => clean(x[1] ?? '')).filter((t) => t.length > 25);
}

export type PublicationResult = {
  pdf: Buffer;
  title: string;
  pages: number;
  /** What was embedded, and which characters had no glyph. **Empty `missingGlyphs` is the proof.** */
  diagnostics: ReturnType<ArticlePdf['diagnostics']>;
};

/** Build the publication for one published record, or null if there is no such record. */
export async function buildPublication(slug: string): Promise<PublicationResult | null> {
  const db = await getDb();
  const a = await db.one<{
    slug: string; title: string; standfirst: string | null; body_html: string | null;
    published_at: Date | null; updated_at: Date | null; word_count: number | null;
    author: string | null; author_bio: string | null; topic: string | null;
    featured_key: string | null; featured_caption: string | null;
  }>(
    `select a.slug, a.title, a.standfirst, a.body_html, a.published_at, a.updated_at, a.word_count,
            c.display_name as author, c.bio as author_bio, t.name as topic,
            m.storage_key as featured_key, m.caption as featured_caption
       from ozikoro_article a
       left join ozikoro_contributor c on c.id = a.author_id
       left join ozikoro_topic t on t.id = a.topic_id
       left join ozikoro_media m on m.id = a.featured_media_id
      where a.slug = $1 and a.status = 'published'`,
    [slug]
  );
  if (!a) return null;

  const body = a.body_html ?? '';
  const words = a.word_count ?? body.split(/\s+/).length;
  const fmt = (d: Date | null) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  const featuredImage = imageOf(a.featured_key);

  /*
   * THE ARTICLE'S OWN SOURCE RECORDS, WHICH ARE WHAT THE REFERENCES PAGE IS FOR.
   *
   * The owner's template says it in its own HTML — *"In the production system, this section should be
   * generated directly from the article's reference data"* — and the archive holds exactly that: a join
   * table `ozikoro_article_source` carrying the order the article cites in, and `ozikoro_source` carrying
   * the citation itself. **Ten real sources exist, and this is how they reach the page.**
   *
   * WHY THE ORDER IS `l.position, s.year nulls last, s.title`: `position` is the article's own order and is
   * what a reader expects. The two tie-breakers are only for rows that share a position — an import that
   * left them all at zero — and they are **deterministic**, so the same article produces the same file
   * twice rather than a citation order that depends on the query planner.
   *
   * `referencesOf(body)` REMAINS THE FALLBACK, and it is used exactly when this returns nothing: a record
   * whose bibliography exists only as prose in its own body. **Where both are empty the page is designed
   * away — `references()` returns without drawing — rather than a citation being invented to fill it.**
   */
  const sourceRows = await db.rows<SourceRow>(
    `select s.kind, s.title, s.authors, s.year, s.year_note, s.publisher, s.journal,
            s.volume, s.issue, s.pages, s.url, s.identifier, s.archive, s.collection
       from ozikoro_article_source l
       join ozikoro_source s on s.id = l.source_id
      where l.article_id = (select id from ozikoro_article where slug = $1)
      order by l.position, s.year nulls last, s.title`,
    [a.slug]
  );
  const fromSources = sourceRows.map(citationForSource).filter((line) => line.trim().length > 0);
  const references = fromSources.length > 0 ? fromSources : referencesOf(body);

  const doc = new ArticlePdf({
    slug: a.slug,
    title: a.title,
    subtitle: a.standfirst,
    author: a.author,
    authorBio: a.author_bio,
    category: a.topic,
    published: fmt(a.published_at),
    updated: fmt(a.updated_at),
    readingMinutes: Math.max(1, Math.round(words / 220)),
    featured: featuredImage ? { ...featuredImage, caption: a.featured_caption } : null,
    blocks: toBlocks(body),
    references,
    referencesFromSources: fromSources.length > 0,
    tags: [],
    logo: logo(),
    fonts: fonts(),
  });
  const pdf = doc.render();
  const report = doc.diagnostics();

  return { pdf, title: a.title, pages: report.pages, diagnostics: report };
}
