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
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { getDb } from '@ozituma/db/client';
import { ArticlePdf, type ArticleLogo, type Block, type Raster } from '@ozikoro/platform';

/** Where the media route's storage puts files. */
const MEDIA_ROOT = join(process.cwd(), '.data', 'media', 'ozikoro');

/**
 * A JPEG the PDF can embed directly.
 *
 * **A PDF embeds JPEG natively and nothing else.** A PNG or a WebP has to be re-encoded, and this does not
 * pretend otherwise: it returns null and the caller leaves the image out. **A missing figure is a smaller
 * fault than a corrupt one**, and the alternative — writing a WebP's bytes into an image object that claims
 * DCTDecode — produces a page that renders grey or not at all.
 */
/**
 * THE ARCHIVE IS 229 WEBP AND 438 PNG FILES, AND A PDF EMBEDS NEITHER.
 *
 * A PDF carries a JPEG natively through `DCTDecode` and nothing else. **So a record whose only figure is a
 * WebP got a publication with no figure at all** — `ute-okpu-an-ika-igbo-clan-and-its-nri-roots` references
 * exactly one image, `11234-ute-king.webp`, and its seven pages had nothing in them. The same is true of PNG.
 *
 * `sips` is part of macOS and converts both, **so nothing has to be installed** — and the conversion is done
 * once per file into a cache, because a publication is built on every download and reconverting on each is
 * work nobody asked for twice.
 *
 * **A conversion failure returns null and the figure is left out**, which is the same rule as before: a
 * missing figure is a smaller fault than a corrupt one.
 */
const CONVERT_CACHE = join(process.cwd(), '.data', 'publication-images');

function toJpeg(path: string, name: string): Buffer | null {
  const cached = join(CONVERT_CACHE, `${name.replace(/[\/]/g, '_')}.jpg`);
  if (existsSync(cached)) {
    const cachedData: Buffer = readFileSync(cached);
    return cachedData[0] === 0xff && cachedData[1] === 0xd8 ? cachedData : null;
  }
  try {
    mkdirSync(CONVERT_CACHE, { recursive: true });
    /*
     * `-s format jpeg` and a quality of 88.
     *
     * **High enough that a printed page shows no artefacts and low enough that a five-image publication is
     * not fifty megabytes.** The reference publication's own images are photographic plates, and this is the
     * setting those are reproduced at.
     */
    const r = spawnSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '88', path, '--out', cached], {
      stdio: 'ignore',
    });
    if (r.status !== 0 || !existsSync(cached)) return null;
    const cachedData: Buffer = readFileSync(cached);
    return cachedData[0] === 0xff && cachedData[1] === 0xd8 ? cachedData : null;
  } catch {
    return null;
  }
}

function jpegOf(storageKey: string | null | undefined): { data: Buffer; width: number; height: number } | null {
  if (!storageKey) return null;
  const name = storageKey.replace(/^ozikoro\//, '');
  const path = join(MEDIA_ROOT, name);
  if (!existsSync(path)) return null;
  let data: Buffer = readFileSync(path);
  // Not a JPEG: convert it, and if that fails the caller leaves the figure out.
  if (data[0] !== 0xff || data[1] !== 0xd8) {
    const converted = toJpeg(path, name);
    if (!converted) return null;
    data = converted;
  }
  const size = jpegSize(data);
  return size ? { data, ...size } : null;
}

/** Pixel dimensions from the JPEG's own start-of-frame marker. */
function jpegSize(b: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1] as number;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

/**
 * THE LOGO, READ FROM THE REPOSITORY RATHER THAN FETCHED.
 *
 * The two files are the approved reference's own artwork, taken out of `data/pdf-template/reference.pdf`
 * byte for byte and described at `ArticleLogo` in the layout. **They live in the repository, so a download
 * never depends on a CDN, and the image object is written into the PDF itself** rather than linked from it.
 *
 * WHY THE DIRECTORY IS SEARCHED RATHER THAN COMPUTED
 *
 * This one function serves three callers with three different working directories, and **a path built from
 * `process.cwd()` alone is right for exactly one of them**: the command-line generator runs from the
 * repository root, `next dev` runs from `apps/ozikoro`, and the deployed image runs `node
 * apps/ozikoro/server.js` from `/app`. A wrong guess here does not throw — it silently drops the wordmark
 * and prints the type-set fallback instead, which is the kind of fault that is only noticed on the printed
 * page. So the directory is looked for upwards from the working directory, and the wordmark file is what
 * identifies it.
 */
function assetsDir(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'packages', 'ozikoro', 'assets');
    if (existsSync(join(candidate, 'ozikoro-wordmark.jpg'))) return candidate;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

let logoCache: ArticleLogo | null | undefined;
function logo(): ArticleLogo | null {
  if (logoCache !== undefined) return logoCache;
  const dir = assetsDir();
  if (!dir) {
    logoCache = null;
    return null;
  }
  const read = (name: string): Raster | null => {
    try {
      const data: Buffer = readFileSync(join(dir, name));
      if (data[0] !== 0xff || data[1] !== 0xd8) return null;
      const size = jpegSize(data);
      return size ? { data, ...size } : null;
    } catch {
      return null;
    }
  };
  logoCache = { wordmark: read('ozikoro-wordmark.jpg'), mark: read('ozikoro-mark.jpg') };
  return logoCache;
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
        const jpeg = jpegOf((img[1] as string).replace(/^\/media\//, ''));
        const caption = clean(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(fig)?.[1] ?? '') || null;
        if (jpeg) blocks.push({ kind: 'image', ...jpeg, caption, credit: null });
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

export type PublicationResult = { pdf: Buffer; title: string; pages: number };

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
  const featuredJpeg = jpegOf(a.featured_key);

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
    featured: featuredJpeg ? { ...featuredJpeg, caption: a.featured_caption } : null,
    blocks: toBlocks(body),
    references: referencesOf(body),
    tags: [],
    logo: logo(),
  }).render();

  return { pdf: doc, title: a.title, pages: 0 };
}
