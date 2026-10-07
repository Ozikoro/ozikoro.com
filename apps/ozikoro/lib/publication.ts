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
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { getDb } from '@ozituma/db/client';
import { getStorage } from '@ozituma/db/storage';
import {
  ArticlePdf, citationForSource, decodePng, isJpeg, isPng, jpegSize, mediaUrlResolver,
  type ArticleLogo, type Block, type FontSet, type MediaUrlResolver, type Raster, type SourceRow,
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

/**
 * THE NAMESPACE EVERY FIGURE'S KEY CARRIES, AND THE ONE PLACE IT IS SPELLED.
 *
 * `MEDIA_KEY_PATTERN` in `packages/ozikoro/src/media-key.ts` admits exactly `ozikoro/<wp attachment id>-<file>`,
 * so the key a figure is stored under is the stored name this file already resolves, with this prefix in
 * front of it.
 */
const STORAGE_PREFIX = 'ozikoro/';

/**
 * PERCENT-ENCODING IS HOW A KEY IS WRITTEN INTO A URL, AND THE DISK AND THE BUCKET HOLD THE DECODED NAME.
 *
 * `mediaPath` (`packages/ozikoro/src/design-fill.ts`) builds `/media/<key>` with `encodeURIComponent` per
 * segment, so a body holding `/media/ozikoro/foo%20bar.jpg` names a file called `foo bar.jpg`. Joining the
 * encoded form onto the media root — or asking the object store for it — 404s on the records with the most
 * descriptive names, which is a fault this lookup has always had and never had a reason to reach.
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

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

/**
 * The stored name a reference points at, whether it arrives as a key, a URL path or a bare filename.
 *
 * ── THE FOUR LAYERS, AND WHY THE CONTAINER NEEDED THE THIRD ONE ──────────────────────────────────────
 *
 *   1. **the local media directory** — exact name, then the directory's own index, then the attachment
 *      prefix (`11234-ute-king.webp` for `ute-king.webp`). This is the development path and **it is
 *      unchanged: every reference that resolved on this machine before resolves to the same name now**, so
 *      nothing that relied on the filesystem was traded away for the container.
 *   2. **the archive's own URL map** — `mediaUrlResolver`, the same map `rewriteBodyImages` puts in front of
 *      a reader on the article page. **This is the layer the container lives on.** In production the media
 *      directory does not exist at all (`.dockerignore` excludes `data/media` and no volume is mounted), so
 *      layer 1 answers with nothing and there is no directory to `readdir` — which is why every figure
 *      whose body still quotes the old site's address was dropped, **silently, because a reference that
 *      cannot be resolved and a record that has no figure render the same page.** The map is a database
 *      query, not a directory listing, so it answers inside the container.
 *   3. **the bare last segment** — a body the importer already rewrote holds `/media/ozikoro/<id>-<file>`,
 *      which names the stored object exactly; the object store is the thing that decides whether it is
 *      there. Returning the tail lets `imageOf` ask it rather than assuming the answer is no.
 *
 * Returning `null` is still possible and still means "no figure", but it is now reserved for a reference
 * with no last path segment at all — a malformed address rather than an unreachable file.
 */
function storedName(reference: string, resolveImage: MediaUrlResolver | null): string | null {
  const decoded = safeDecode(reference);
  const cleaned = decoded.replace(/^ozikoro\//, '').replace(/[?#].*$/, '');
  const tail = cleaned.includes('/') ? (cleaned.split('/').pop() as string) : cleaned;
  if (!tail) return null;

  // 1 · the local media directory, exactly as before.
  if (existsSync(join(MEDIA_ROOT, tail))) return tail;
  const index = mediaIndex();
  if (index.includes(tail)) return tail;
  // The attachment prefix is an id and a hyphen: `11234-ute-king.webp` for `ute-king.webp`.
  const suffixed = index.find((name) => name.endsWith(`-${tail}`));
  if (suffixed) return suffixed;

  // 2 · the archive's own mapping from the address a body quotes to the key this archive serves.
  const mapped = resolveImage?.(reference) ?? resolveImage?.(decoded);
  if (mapped) {
    const key = safeDecode(mapped.replace(/^\/media\//, ''));
    const name = key.includes('/') ? (key.split('/').pop() as string) : key;
    if (name) return name;
  }

  // 3 · the last segment, for the object store to accept or refuse.
  return tail;
}

/**
 * A RASTER THE WRITER CAN EMBED, FROM WHATEVER FORMAT THE FILE IS IN.
 *
 * `-s format jpeg` and a quality of 88. **High enough that a printed page shows no artefacts and low enough
 * that a five-image publication is not fifty megabytes.** This path is only reached for formats the writer
 * cannot embed itself — WebP — and it needs `sips`, which exists on macOS and **not on the Linux host the
 * archive deploys to.** There, a WebP figure is still left out; PNG does not depend on this at all.
 *
 * THE SOURCE IS NOW EITHER A PATH OR A BUFFER, AND THAT IS THE POINT OF THE ARGUMENT. A figure found in the
 * media directory has a path; **a figure found in the object store has only bytes, because there is no file
 * on this machine to point `sips` at.** So bytes are written to a scratch file inside the conversion cache,
 * converted, and the scratch file is removed — the same `sips` call either way, so a figure is converted
 * identically whether it came off the disk or out of the bucket.
 */
function toJpeg(name: string, source: { path: string } | { data: Buffer }): Buffer | null {
  const cached = join(CONVERT_CACHE, `${name.replace(/[\/]/g, '_')}.jpg`);
  if (existsSync(cached)) {
    const cachedData: Buffer = readFileSync(cached);
    return isJpeg(cachedData) ? cachedData : null;
  }
  let scratch: string | null = null;
  try {
    mkdirSync(CONVERT_CACHE, { recursive: true });
    let input: string;
    if ('path' in source) {
      input = source.path;
    } else {
      scratch = join(CONVERT_CACHE, `${name.replace(/[\/]/g, '_')}.src`);
      writeFileSync(scratch, source.data);
      input = scratch;
    }
    const r = spawnSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '88', input, '--out', cached], {
      stdio: 'ignore',
    });
    if (r.status !== 0 || !existsSync(cached)) return null;
    const cachedData: Buffer = readFileSync(cached);
    return isJpeg(cachedData) ? cachedData : null;
  } catch {
    return null;
  } finally {
    if (scratch) {
      try {
        unlinkSync(scratch);
      } catch {
        // Already gone is a success for a delete.
      }
    }
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
 *
 * ── AND THE CALLER CAN NOW COUNT THEM, WHICH IS WHAT STOPS A DROP BEING MADE PERMANENT ───────────────
 *
 * `onDrop` is called for every figure this function refuses, so a build can report how many pictures it
 * lost instead of only writing them to a log nobody reads. `publication-cache.ts` is the caller that needs
 * it: it refuses to KEEP a render that dropped a figure, because in production the container cannot see its
 * media at all and a kept render would freeze a pictureless document under the record's own revision.
 * **The callback is threaded rather than held in a module variable** on purpose — two builds can interleave
 * across the database awaits in `buildPublication`, and a shared counter would attribute one record's drops
 * to another.
 *
 * ── AND THE BYTES ARE NOT READ FROM THE FILESYSTEM ALONE ANY MORE ─────────────────────────────────────
 *
 * **This function used to fail in production on every figure, and it was the last reader-facing fault in
 * this file.** `existsSync`/`readFileSync` against `MEDIA_ROOT` are the only two things it asked, and in the
 * container there is no media root: `.dockerignore` excludes `data/media`, the image copies no `.data`, and
 * the service mounts no volume for it. So every lookup returned `null`, every figure was dropped, and the
 * route served a valid, beautifully typeset document with twenty-four of its twenty-five photographs
 * absent — which is why `x-ozikoro-publication` read `built` on every request rather than `cache`.
 *
 * **The archive's media is in the object store, and `getStorage()` is the interface to it** — the same one
 * `apps/ozikoro/app/media/[...key]/route.ts` serves `/media/<key>` from, and the same shape
 * `scripts/import-inbody-images.ts` already uses for the in-body images. So a figure is read from the media
 * directory **when it is there** — the development path, kept first so local rendering does not pay a
 * network round trip and so every agent working on this tree sees exactly what they saw before — and
 * otherwise from storage. A store that is unconfigured, unreachable or refusing the key is a **named drop**
 * rather than a silent one, and the drop still reaches `onDrop`, so a partial render is still never cached.
 */
async function imageOf(
  reference: string | null | undefined,
  lookup: { resolve: MediaUrlResolver | null; onDrop?: (reference: string) => void }
): Promise<Raster | null> {
  const drop = (reason: string): null => {
    console.error(`publication: dropped figure — ${reason}`);
    /*
     * REPORTED WHENEVER A REFERENCE WAS GIVEN, INCLUDING AN EMPTY ONE. `if (reference)` here would swallow the
     * empty address the check below exists to catch, and an uncounted drop is a partial render the cache is
     * then willing to keep.
     */
    if (reference !== null && reference !== undefined) lookup.onDrop?.(reference);
    return null;
  };
  if (reference === null || reference === undefined) return null;
  /*
   * AN EMPTY ADDRESS IS A LOST FIGURE, AND IT USED TO BE AN UNCOUNTED ONE.
   *
   * `toBlocks` strips `/media/` before calling this, so `<img src="/media/">` — or any `src` that reduces to
   * nothing — arrived as `''`. The guard at the top of this function then returned `null` **without calling
   * `onDrop`**, and `figureReferences` counted the `<figure>` it sits in. So the record reported
   * `referenced 1, placed 0, dropped 0`, and `publication-cache.ts` — whose whole test is `dropped > 0` —
   * would have KEPT a document with a photograph missing, which is the one thing that guard exists to
   * prevent. **A record with no featured image is a different thing and must still produce no drop**, which
   * is why absence is `null`/`undefined` and only a present-but-empty address is a fault.
   */
  if (reference.trim().length === 0) {
    return drop('an empty image address names no file');
  }
  const name = storedName(reference, lookup.resolve);
  if (!name) {
    return drop(`no stored file matches ${reference}`);
  }
  const path = join(MEDIA_ROOT, name);
  let data: Buffer;
  let localPath: string | null = null;
  if (existsSync(path)) {
    data = readFileSync(path);
    localPath = path;
  } else {
    /*
     * THE CONTAINER'S PATH. The key is spelled here rather than derived from the reference, because
     * `storedName` has already reduced the reference to the object's own file name and `MEDIA_KEY_PATTERN`
     * fixes everything before it.
     */
    const key = `${STORAGE_PREFIX}${name}`;
    let held: { body: Buffer } | null = null;
    try {
      held = await getStorage().get(key);
    } catch (error) {
      return drop(`${key} could not be read from object storage: ${String(error).slice(0, 200)}`);
    }
    if (!held) {
      return drop(`${name} is in neither the media root (${MEDIA_ROOT}) nor the object store (${key})`);
    }
    data = held.body;
  }
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
      return drop(`${name} could not be decoded as PNG: ${String(error)}`);
    }
  }
  if (!isJpeg(data)) {
    const converted = toJpeg(name, localPath ? { path: localPath } : { data });
    if (!converted) {
      return drop(
        `${name} is neither JPEG nor PNG and could not be converted. ` +
          'WebP needs a decoder this repository does not have (the PNG decoder is in-process; WebP is not), ' +
          'and `sips` is macOS-only. The figure is absent from the PDF; the page shows it normally.'
      );
    }
    const size = jpegSize(converted);
    if (!size) return drop(`${name} converted to a JPEG whose dimensions could not be read`);
    return { data: converted, ...size };
  }
  const size = jpegSize(data);
  if (!size) {
    return drop(`${name} is a JPEG whose dimensions could not be read`);
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
 *
 * `onDrop` is called with the reference of every figure whose file could not be read — see `imageOf`. It is
 * optional so the existing callers and tests are unchanged, and it is the signal `publication-cache.ts`
 * uses to refuse to KEEP a pictureless render.
 *
 * **ASYNC, BECAUSE A FIGURE CAN NOW COME OUT OF THE OBJECT STORE.** `getStorage().get()` is a promise, so the
 * one function that asks for a picture has to be awaited. The alternative — a synchronous read that only
 * knows about the filesystem — is the fault this file just had.
 */
export async function toBlocks(
  html: string,
  onDrop?: (reference: string) => void,
  resolveImage: MediaUrlResolver | null = null
): Promise<Block[]> {
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
        const picture = await imageOf((img[1] as string).replace(/^\/media\//, ''), {
          resolve: resolveImage,
          onDrop,
        });
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
  /**
   * HOW MANY FIGURES THE RECORD REFERENCES, AND HOW MANY REACHED THE FILE.
   *
   * **`referenced` is counted from the record's own markup and not from what was found**, which is the
   * whole point: `toBlocks` emits an image block only for a figure whose file resolved, so a block count
   * cannot tell a record with no pictures from a record whose pictures are all missing. The count here is
   * of `<figure>` blocks that name an `<img>`, so a host that cannot reach its media produces
   * `placed < referenced` and says so rather than producing an authoritative-looking pictureless document.
   *
   * This was a MEASUREMENT of the live archive rather than a hypothetical: in production there was no media
   * on the container's filesystem, and `https://ozikoro.com/animal-totems-…/pdf` served **18 pages carrying 2
   * image objects** where this checkout rendered 33 pages carrying 26. **That is fixed** — the figure bytes
   * are read through `getStorage()` now — and the count is kept because it is still the only thing that can
   * see a drop at all: a lost figure and a record with no figure render the same page. A render that drops
   * one is served and not cached; see `publication-cache.ts`. See `diagnostics().images`.
   */
  figures: { referenced: number; placed: number; dropped: number };
};

/**
 * The figures a record's own body references, counted from the markup rather than from the render.
 *
 * **`<figure>` is the unit because that is the unit the layout sets**: an `<img>` outside a figure has no
 * caption and no measured size, and the renderer has never drawn one. So a bare `<img>` is not counted here
 * either — the two agree by construction, and `placed` cannot exceed `referenced` on a complete render.
 */
export function figureReferences(bodyHtml: string): number {
  return [...bodyHtml.matchAll(/<figure[^>]*>[\s\S]*?<img[^>]*>/gi)].length;
}

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

  /*
   * EVERY FIGURE THIS BUILD LOSES, COLLECTED AS IT LOSES THEM.
   *
   * `imageOf` is the single place a picture disappears, and it is the same function for the featured image
   * and for a figure in the body, so both are reported through the one callback. **A drop is a failure and
   * not a decision** — a body figure whose bytes are identical to the featured image is suppressed by the
   * layout on purpose and is not counted here, which is what makes this count usable as a completeness test.
   */
  const droppedFigures: string[] = [];
  const noteDrop = (reference: string) => { droppedFigures.push(reference); };

  /*
   * THE ARCHIVE'S OWN ADDRESS MAP, READ ONCE AND SHARED BY THE COVER AND THE BODY.
   *
   * `mediaUrlResolver` is the same mapping the article page resolves its images through, so **the figure a
   * reader sees on the page and the figure printed in the document are now found by one rule rather than
   * two.** It is a database query rather than a directory listing, which is the whole reason the container
   * can use it and `readdirSync(MEDIA_ROOT)` never could.
   */
  const resolveImage = await mediaUrlResolver(db);
  const featuredImage = await imageOf(a.featured_key, { resolve: resolveImage, onDrop: noteDrop });

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
    blocks: await toBlocks(body, noteDrop, resolveImage),
    references,
    referencesFromSources: fromSources.length > 0,
    tags: [],
    logo: logo(),
    fonts: fonts(),
  });
  const pdf = doc.render();
  const report = doc.diagnostics();

  /*
   * THE FIGURES, COUNTED FROM THREE ANGLES THAT CANNOT AGREE BY ACCIDENT.
   *
   * `referenced` comes from the record's markup, `placed` from the file the writer produced, and `dropped`
   * from the single function that loses a picture. **The brand mark is excluded from `placed`** because the
   * logo is the template's furniture and not the record's picture, and so is `featured`, which is the cover
   * panel's own object rather than a body figure.
   *
   * **`placed` CAN BE ONE LESS THAN `referenced` ON A COMPLETE RENDER, AND THAT IS NOT A FAULT.** The layout
   * suppresses a body figure whose bytes are identical to the featured image, deliberately, because the same
   * photograph printed twice on facing pages is a duplication rather than a figure. That is why the test a
   * caller makes is `dropped`, and not the difference between the other two — measured on
   * `aya-adesuwa-the-ubulu-uku-bini-war`, whose opening photograph is also its featured image: 2 referenced,
   * 1 placed, 0 dropped.
   */
  const figures = {
    referenced: figureReferences(body),
    placed: report.images.filter((name) => !name.startsWith('ozikoro-icon') && name !== 'featured').length,
    dropped: droppedFigures.length,
  };

  return { pdf, title: a.title, pages: report.pages, diagnostics: report, figures };
}
