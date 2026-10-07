/**
 * WHAT A FILE ACTUALLY IS, DECIDED BY ITS FIRST BYTES — one definition, two callers.
 *
 * ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────────────────────────────────────
 *
 * There are now **two doors** a file can come through and only one of them is a person:
 *
 *   1. `app/api/admin/media/upload/route.ts` — a person chooses a file on the media screen.
 *   2. `scripts/import-inbody-images.ts` — a body's own `<img src>` names a file on the live site or on
 *      somebody else's, and the archive fetches it.
 *
 * Door 2 did not exist when door 1's rules were written, and it is the one that is **fed by a remote
 * server rather than by a person** — which is exactly the case the rules were written for and the case
 * where a second copy of them would drift. The measured fault both copies exist to prevent:
 *
 *   **an origin that answers `200` with an HTML error page.** Door 2's first version trusted `res.ok` and
 *   the declared `content-type`, so `https://ozikoro.com/wp-content/uploads/…/photo.jpg` answering a
 *   WordPress "not found" page would have been written to disk, given a row with `mime_type = image/jpeg`
 *   and served back to a reader as a photograph. `HTTP 200` is not a file and a declared type is not a
 *   fact.
 *
 * So the signature test lives here, where the uploading route and the fetching importer read the same
 * constant, and neither can accept something the other would refuse.
 *
 * ── THE DECLARED TYPE IS CONSULTED IN EXACTLY ONE PLACE, AND WHY IT MUST BE ───────────────────────────
 *
 * The `ftyp` box is shared by MP4 video, M4A audio, QuickTime film and AVIF stills. Their brands overlap in
 * the wild and the byte signature alone cannot separate a video MP4 from an audio one. The declared type is
 * used there to choose between two types whose bytes are genuinely the same container, and **it never
 * grants access to a type the signature did not first establish.** Everything else is decided by the
 * signature alone.
 *
 * ── SVG IS REFUSED, AND WHY ───────────────────────────────────────────────────────────────────────────
 *
 * It is an image, it is the one image format that is a script container, and the archive's own sanitiser
 * already drops `svg` from every stored body (`DROPPED_WITH_CONTENT` in `content.ts`). Accepting one would
 * store exactly the file the rest of the pipeline refuses to carry. `looksLikeSvg` is a separate export
 * because a caller that only needs the refusal still needs to *name* the format rather than say
 * "unrecognised".
 *
 * ── AND A FILE NAME THE MEDIA ROUTE CAN SERVE ─────────────────────────────────────────────────────────
 *
 * `safeMediaFilename` exists because the key is `ozikoro/<id>-<name>` and the route enforces
 * `MEDIA_KEY_PATTERN` over the whole thing: a name carrying a character that pattern does not admit
 * produces **a key no upload can make reachable** — 3,443 objects in a bucket and some of them permanently
 * unaddressable, reported as success. So a name is cleaned to the admitted class, and **the extension is
 * the sniffed one, never the arriving one**: a file called `photo.html` whose bytes are a JPEG is stored as
 * `.jpg`.
 */

/** The kinds `ozikoro_media.kind` accepts, per the check constraint in migration 0035. */
export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'dataset' | 'other';

export interface Sniffed {
  mime: string;
  kind: MediaKind;
  /** The extension the BYTES proved, which is what the stored name is given. */
  extension: string;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * What the bytes actually are, from their first bytes and — for the ISO-BMFF family only — the declaration.
 *
 * `declared` must already be lower-cased and stripped of its parameters (`image/jpeg; charset=…` →
 * `image/jpeg`); both callers do that so this function has one rule rather than two.
 */
export function sniffMediaBytes(head: Buffer, declared: string): Sniffed | null {
  const ascii = (start: number, end: number) => head.subarray(start, end).toString('latin1');

  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { mime: 'image/jpeg', kind: 'image', extension: 'jpg' };
  }
  if (head.length >= 8 && head.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { mime: 'image/png', kind: 'image', extension: 'png' };
  }
  if (head.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) {
    return { mime: 'image/gif', kind: 'image', extension: 'gif' };
  }
  if (head.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return { mime: 'image/webp', kind: 'image', extension: 'webp' };
  }
  if (head.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') {
    return { mime: 'audio/wav', kind: 'audio', extension: 'wav' };
  }
  if (head.length >= 4 && ascii(0, 4) === 'OggS') {
    return { mime: 'audio/ogg', kind: 'audio', extension: 'ogg' };
  }
  if (
    head.length >= 3 &&
    (ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0))
  ) {
    return { mime: 'audio/mpeg', kind: 'audio', extension: 'mp3' };
  }
  if (head.length >= 4 && ascii(0, 4) === '%PDF') {
    return { mime: 'application/pdf', kind: 'document', extension: 'pdf' };
  }
  // WebM and Matroska share the EBML header; MediaRecorder produces WebM.
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return declared.startsWith('audio/')
      ? { mime: 'audio/webm', kind: 'audio', extension: 'webm' }
      : { mime: 'video/webm', kind: 'video', extension: 'webm' };
  }
  if (head.length >= 12 && ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (brand.startsWith('avif') || brand.startsWith('avis')) {
      return { mime: 'image/avif', kind: 'image', extension: 'avif' };
    }
    if (brand.startsWith('qt')) {
      return { mime: 'video/quicktime', kind: 'video', extension: 'mov' };
    }
    if (declared === 'audio/mp4' || declared === 'audio/x-m4a' || declared === 'audio/m4a') {
      return { mime: 'audio/mp4', kind: 'audio', extension: 'm4a' };
    }
    return { mime: 'video/mp4', kind: 'video', extension: 'mp4' };
  }
  return null;
}

/** Whether the first bytes say "this is an SVG", so the refusal can name the format rather than guess. */
export function looksLikeSvg(head: Buffer): boolean {
  const text = head.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  return text.startsWith('<svg') || text.startsWith('<?xml');
}

/**
 * A file name the media pattern will accept, and the extension the bytes proved.
 *
 * `MEDIA_KEY_PATTERN` admits exactly the characters a WordPress file name carries
 * (`A-Za-z0-9._- ()[],'&+@` and the space — see that module's measurement). Anything else becomes `-`, the
 * name is capped so the whole key stays inside the 255-character class, and the extension is the sniffed
 * one. The cap is 120 characters of name rather than 255 of key because the key also carries the
 * `ozikoro/<id>-` prefix, which is what the pattern's own 255-character class measures.
 */
export function safeMediaFilename(original: string, extension: string): string {
  const base = original.replace(/\.[^.]*$/, '');
  const cleaned = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._ ()[\],'&+@-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.\-\s]+|[.\-\s]+$/g, '')
    .slice(0, 120);
  return `${cleaned.length > 0 ? cleaned : 'upload'}.${extension}`;
}
