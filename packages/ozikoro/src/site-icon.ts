/**
 * The site's own icon: the mark in a browser tab, and what it is read FROM so that it reaches every page.
 *
 * ── THE PROBLEM, MEASURED ─────────────────────────────────────────────────────────────────────────────
 *
 * There was no icon setting anywhere in this repository. `favicon` appeared in no admin screen and in no
 * override module; the three files in `apps/ozikoro/public/` (`favicon.ico`, `favicon.png`,
 * `apple-touch-icon.png`) were written by hand in an earlier round and were the whole of it. The owner named
 * the favicon in the same breath as the logo.
 *
 * ── WHERE AN ICON HAS TO BE READ TO REACH EVERY PAGE, WHICH IS THE REAL QUESTION ───────────────────────
 *
 * `app/layout.tsx` links the icons, and **it does not reach `/` or the design screens at all.** Measured:
 * `GET /` is served from `public/design/screens/home.html` through the middleware's rewrite, and it contains
 * zero `/_next/` references — it never enters the React tree, so no layout of this application runs for it.
 * An icon whose only declaration is in `app/layout.tsx` therefore reaches the React routes and **not one of
 * the fifty-three design screens, and not any of the 1,051 articles**, which are served by
 * `app/[slug]/route.ts` from the same deliverable.
 *
 * There are two honest ways to reach all of them: rewrite every design screen's `<head>` — which is
 * `seoHead`'s job and would mean touching it and its four callers — or **answer the one address EVERY
 * browser asks for unprompted**. That second one is this module's whole design:
 *
 *   * `/favicon.ico` is requested by a browser for any page that declares no icon, which is every design
 *     screen and every article. It needs no markup at all.
 *   * `app/favicon.ico/route.ts` answers it from the stored setting. **The two static files that used to
 *     answer it were removed in the same change**, so there is one source and not two — a static file in
 *     `public/` is served BEFORE the router and would shadow the route silently.
 *   * `app/layout.tsx`'s own `<link>` tags still name `/favicon.ico`, so the React routes ask for the same
 *     address the design screens fall back to. One endpoint, every page, and no head rewritten.
 *
 * **AND THE DESIGN'S OWN MARK IS NOT LOST BY REMOVING THOSE FILES.** `DEFAULT_ICON` below is the exact PNG
 * they held, byte for byte (`sha256 c6c3adfd9daaf000e5f96f0655e819927f2dcd10856494eb68daa5d478639ce4`, 1,493
 * bytes), so an archive with no icon set serves what it serves today. Nothing is redrawn.
 *
 * ── WHAT IS STORED, AND WHY IT IS NOT A PATH ─────────────────────────────────────────────────────────
 *
 * A path into `public/` would be a file the application cannot write — the archive is deployed as a
 * container and `public/` is inside the image. So the owner's icon is stored **in the database**, as a
 * `data:` URL, which is the same place every other owner-supplied setting lives and is read the same way
 * `loadSeoVerification` reads a verification token. It costs one row and one indexed read per page, which is
 * the price `/design-theme.css` already pays for a colour.
 *
 * `site_setting` IS THE RIGHT TABLE AND NO MIGRATION IS NEEDED, for the reason `seo-verification.ts` gives
 * for its own keys: it is the key/value table migration 0031 created for "the things an administrator changes
 * without a deploy", and a key/value table takes a new key by receiving a row.
 *
 * ── THE CAPABILITY AND THE AUDIT ARE THE EXISTING ONES ────────────────────────────────────────────────
 *
 * `manage_design` gates the write, exactly as it gates `/admin/design/`, `/admin/seo/` and
 * `/design-theme.css`; and every change writes an `ozikoro_audit` row under `entity_type = 'site_icon'`, the
 * same shape `setSeoVerification` uses. **Nothing here loosens either.**
 */
import type { Db } from '@ozituma/db';

/** The one `site_setting` key. Namespaced under `design.` so the dictionary's keys cannot collide with it. */
export const FAVICON_KEY = 'design.favicon';

/**
 * The icon an archive with no setting serves: the PNG that was at `apps/ozikoro/public/favicon.png`.
 *
 * It is 32×32, RGBA, 1,493 bytes — the archive's own gold sun, `486-cropped-Ozi-Ikoro-Icon-Yellow-1.png`,
 * scaled by the earlier round that put it there. **It is embedded rather than read from disk** so that the
 * route has no dependency on a file tree, and so that deleting the two shadowing files in `public/` cannot
 * leave the site with no icon at all.
 */
export const DEFAULT_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAHhlWElmTU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAABgAAAAAQAAAGAAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAACCgAwAEAAAAAQAAACAAAAAAcFS6AwAAAAlwSFlzAAAOxAAADsQBlSsOGwAABPZJREFUWAmtVl1sG0UQnt09n+38NA1NRRFt/imRktpOeKCCh4SiIiEorloJqlJFvKBK/ClS+YlUiYq+oaqgVrzwWwkeQJTGdlNFlSANj0FqcJMokSIntpOKSgjRJJAmse9ulznHa+d8NnZ+Rj7PzdzM7LezM7sLsEWaDrbtmw16jsgwsSv1rpk+734pF+O0mEHu99nr3tZowHtG6glhh3VBn5Wy2FX1OhByUsrFeFEAQgCJ9bV3ykCGEDpQeCUW8O00dUInU0CEZ2ioS0nZCKhDeVHaF+NFARCCgzD+bjzke8EM1ugfmyIcxhHE+6bsVEUcTRqbl+YfNmUQsAeDVqbeS/jLC+B2/xNlkUBbU9ofk0A/4kJcjAU9T5o6DmJACJFad02jNaiinPDldFY60WE47VuU5QVQvQIORtjn032eQ2aEJn/4Ns7sSw7wWSoio3OYmerYUJcLmF6FOl734vg8ocK01xt2Vt9K2ZXwlxdA08sji5yQc4pCLsRCvnNmHMzAdwRIrZmFJSefFABhWFjYIxLqKC7B6ZQNiAmD8x7yzK96CWPbTaIh3+FoqG1tLfHzTH9rbTTo/TMa9HSb1jMB78exoPdDu+fmNWuVK/0Fr2JM6Zu74b3JE8pX9UdG5qYDvtOUwDeRkHe80T/aC0NdTJpvB8fsWWk61NGsUuMMdt/zPMlPNBwfG46GvKc0g44/fiw8Kq0jl5ud7obKFp3zh6RuMzwFIHLNs9dQEost/ql/ZRBc63cURs9qBnmz8Wj4J6k3ORbnCdVBe7HaW7EYrVlcb1jCe8qZMtGigvuDuze8s4LABF9Vfqg/OnI5fv1ARFBqSflMwNfjVOFTM7amCxDYGluhzBJEr7XXOVTegcFexa20HZ9L9/82vvZ2jz2QA2CBerA9fwMgLoNjH2wDZdLXeDw8i/HMJzCL3eBwwHsVO9gkyr9kx2HdLid1PVjZ4rSzAUHBk+uYosCjmMxlKpiKfKzOf+dntDEfKwk4oBvbM3MZmDoYHRaCuHCTaTZAHAQCX9wb8P0eDfrOSqMMF6DijritpNT6w/cw4gUZdfRbT/mu3eygEIZUZTgWqG14h0LAfP6PsFtgNYkniM0b7C2ULrrBvAFxfdbrVRw4qYt+ncMtzhFeAULcbnTsZYRW4pZuscoUoUWLgsDzPb54/w1Foc9huznS331m60nCswI0AwYbXrpzSery8chAs5Mly9/CHRUBWC0KAogvzr9dUaZ8Yg5I1bXJaRrHQ8kaAEXVqrFLKneXYX1RbG3zZ6GCAPC892uY29VkzogW99KEv/5Ql2oe0U4SQZwkB0FhAEAnnSrtTOrZYjR3vc3AadinuBeS+nm8L9RgrVhQFwRAVcf5f5aTezFvT+Gul9qO0bUCM2jxwbrMIrSEzgqGe4mThLJfYWR3TgKw64uQeT9I4gXJpVPBmX5VdZCnk9raLHBXhJUEx3OBXyF6/i7AFhWcsB14mQ1SSmwZKApgPT68kAy6VHIokQaQ/mbuy9a8rnfKvlsONam2pFMqC3Is4txvqMBVytXa5Zz2zxhsCAD2sW2mKYVNm4lf9CXvpbSQl+DiLmMlTLdQgDz6jQGg9KqBp+F2QtgQgJHEYzfxUPm+vIzZdrQ8kytJteHJTPzYWlHmUi4yQl7DvlbNU24rtGEAcrB4v6eDEnoKl6QHdaRQlUv7Qvw/CTPQ0ZuBfCsAAAAASUVORK5CYII=';

/** The bytes of the default icon, decoded once. */
export function defaultIcon(): Buffer {
  return Buffer.from(DEFAULT_ICON_BASE64, 'base64');
}

/**
 * The image types an icon may be, with the extension the archive reports for each.
 *
 * SVG IS HERE AND IS NOT A LICENCE TO WRITE SCRIPT. The `data:image/svg+xml` form below is accepted and
 * served with `content-type: image/svg+xml`, which a browser renders as an image and **does not execute** —
 * an SVG loaded through `<link rel="icon">` is not a document and its scripts do not run. It is still a
 * value an owner controls, so it is stored as a data URL that has already been checked for the shapes that
 * could end the attribute it is written into; see `checkFaviconDataUrl`.
 */
const TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/svg+xml': 'svg',
};

/**
 * The largest icon an owner may store, in bytes of the decoded image.
 *
 * 200 KB is far above any real favicon — a 512×512 PNG is tens of kilobytes and an ICO carrying five sizes is
 * ~20 KB — and far below the point at which a base64 row read on every page request becomes a cost. A file
 * that is larger than this is not a favicon, so the sentence says what the limit is rather than only refusing.
 */
export const FAVICON_MAX_BYTES = 200 * 1024;

/** A stored icon: the data URL, its media type, and how big the image is. */
export interface SiteFavicon {
  /** The whole `data:` URL, exactly as it is served and as it is written into a `<link>`. */
  dataUrl: string;
  mediaType: string;
  bytes: number;
  /** Who set it and when, for the screen. Null for an icon nobody has set. */
  actorName?: string | null;
  updatedAt?: string | null;
}

export interface FaviconProblem {
  message: string;
}

/**
 * Why a proposed value is not an icon, or null when it is one.
 *
 * REFUSED RATHER THAN ESCAPED AWAY, the same rule the verification tokens follow. The value is written into
 * a `href="…"` attribute by the layout below, which escapes it — so a quote could not break out of it even
 * if it were stored. This is the layer above that, and it exists because a string that is not an icon is
 * either a mistake or an attempt, and in both cases the honest answer is a sentence rather than a stored row
 * that renders as nothing.
 *
 * THE `<` AND `>` TEST IS NOT DECORATION. `base64` cannot carry either, but the SVG form is utf8-encoded and
 * can, so the shape test is applied to the decoded form for every type rather than to the base64 alphabet
 * alone — which is exactly the assumption that would have been wrong.
 */
export function checkFaviconDataUrl(raw: string): FaviconProblem | null {
  const value = raw.trim();
  if (value.length === 0) return { message: 'There is no image here.' };
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(value);
  if (!match) {
    return {
      message:
        'An icon must be an image the browser can draw: a PNG, a JPEG, a WebP, an ICO or an SVG. That value is not one.',
    };
  }
  const mediaType = (match[1] ?? '').toLowerCase();
  if (!(mediaType in TYPES)) {
    return { message: `“${mediaType}” is not an image type a browser will use as a site icon.` };
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(match[2] ?? '', 'base64');
  } catch {
    return { message: 'That image could not be decoded, so it would render as nothing.' };
  }
  if (decoded.byteLength === 0) return { message: 'That image is empty.' };
  if (decoded.byteLength > FAVICON_MAX_BYTES) {
    const kb = Math.round(FAVICON_MAX_BYTES / 1024);
    return {
      message: `That image is ${Math.round(decoded.byteLength / 1024)} KB. A site icon may be up to ${kb} KB — a favicon is a few hundred pixels square, not a photograph.`,
    };
  }
  /*
   * ── THE MARKUP TEST APPLIES TO THE IMAGE THE BROWSER PARSES AS TEXT, AND TO NOTHING ELSE ────────────
   *
   ***SVG IS THE ONE TYPE HERE THAT A BROWSER READS AS MARKUP**, so it is the one that needs the test. The
   * first version of this function applied `/[<>]/` to the decoded bytes of EVERY type — and it refused the
   * archive's own 1,493-byte PNG, whose compressed bytes contain a `<` by chance. A validation that rejects
   * the file it was written to protect is not a strict validation, it is a broken one, and this was found by
   * the test that loads the default icon rather than by a person clicking Save.
   */
  if (mediaType === 'image/svg+xml') {
    const text = decoded.toString('utf8');
    if (!/<svg[\s>]/i.test(text)) {
      return { message: 'That SVG does not contain an <svg> element, so there is nothing for a browser to draw.' };
    }
    if (/<script|onload\s*=|onerror\s*=|<foreignObject/i.test(text)) {
      return { message: 'An SVG icon may not carry script or a foreign object; the mark itself is all that is needed.' };
    }
  }
  return null;
}

/**
 * A refusal an owner can read, thrown by the write path and turned into a notice by the endpoint.
 *
 * The same shape as `SeoVerificationError`: the message is written for the person who chose the file, not for
 * a log, because the alternative is a form that silently does nothing.
 */
export class SiteIconError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiteIconError';
  }
}

/**
 * One audit row per change, and **a failure to write it never fails the change.**
 *
 * `entity_id` is `bigint not null` and `site_setting` has a TEXT primary key and no numeric id, so there is no
 * honest number to point at. `199` — the account that made the change — stands in, exactly as
 * `setSeoVerification` does it and for the same reason: an invented number is worse than a real one that
 * means something else and is named in the note beside it.
 *
 * The trail records the icon's TYPE and its SIZE and not its bytes. A 60 KB data URL copied into every audit
 * row would make `/admin/audit/` unreadable while adding nothing: "it changed from a 1.4 KB PNG to an 8 KB
 * PNG" is the whole of what a trail can honestly say about an image.
 */
async function auditIcon(
  db: Db,
  event: {
    action: string;
    before: { mediaType: string; bytes: number } | null;
    after: { mediaType: string; bytes: number } | null;
    actorId: number | null;
    note?: string | null;
  }
): Promise<void> {
  try {
    await db.query(
      `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
       values ('site_icon', $1, $2, $3::jsonb, $4::jsonb, $5, $6)`,
      [
        event.actorId ?? 0,
        event.action,
        event.before === null ? null : JSON.stringify(event.before),
        event.after === null ? null : JSON.stringify(event.after),
        event.actorId,
        event.note ?? null,
      ]
    );
  } catch (error) {
    console.error('[ozikoro/site-icon] could not record the audit event:', String(error).slice(0, 160));
  }
}

/**
 * Store the site's icon, or clear it back to the design's own mark.
 *
 * `dataUrl === null` REMOVES THE ROW rather than writing an empty one, which is what makes "clear this" the
 * same act as "never set it" — the same rule `setSeoVerification` follows, and the reason the empty state is
 * honest: there is nothing stored, and the archive serves the mark it shipped with.
 */
export async function setSiteFavicon(
  db: Db,
  input: { dataUrl: string | null; actorId: number | null; note?: string | null }
): Promise<{ cleared: boolean; stored: SiteFavicon | null }> {
  const before = await loadSiteFavicon(db);

  if (input.dataUrl === null) {
    if (!before) return { cleared: false, stored: null };
    await db.query(`delete from site_setting where key = $1`, [FAVICON_KEY]);
    await auditIcon(db, {
      action: 'clear_site_icon',
      before: { mediaType: before.mediaType, bytes: before.bytes },
      after: null,
      actorId: input.actorId,
      note: 'Cleared the site icon. The archive serves the mark it shipped with.',
    });
    return { cleared: true, stored: null };
  }

  const dataUrl = input.dataUrl.trim();
  const problem = checkFaviconDataUrl(dataUrl);
  if (problem) throw new SiteIconError(problem.message);

  await db.query(
    `insert into site_setting (key, value, updated_at, updated_by)
     values ($1, $2::jsonb, now(), $3)
     on conflict (key) do update
        set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
    [FAVICON_KEY, JSON.stringify({ dataUrl }), input.actorId]
  );

  const stored = await loadSiteFavicon(db);
  await auditIcon(db, {
    action: before ? 'update_site_icon' : 'set_site_icon',
    before: before ? { mediaType: before.mediaType, bytes: before.bytes } : null,
    after: { mediaType: faviconMediaType(dataUrl) ?? 'image/png', bytes: faviconBytes(dataUrl) },
    actorId: input.actorId,
    note: input.note ?? null,
  });
  return { cleared: false, stored };
}

/**
 * Turn an uploaded file into the data URL this setting stores, or say why it cannot.
 *
 * THE THREE TESTS ARE THE FILE'S OWN, AND NONE OF THEM IS A GUESS: the type is what the browser reported,
 * the size is measured, and the bytes are read rather than trusted. A file the browser described as
 * `image/png` whose bytes are not a PNG is refused by the same test a pasted data URL goes through, because
 * the shape check decodes it — so there is one rule for both ways in, not two.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO IS RE-ENCODE THE IMAGE. Re-encoding would need an image library and
 * would change the owner's artwork — a resampled favicon is a favicon somebody else drew. The size ceiling in
 * `checkFaviconDataUrl` is what keeps that from being a way to store an arbitrary file, and the sentence
 * names the ceiling rather than only refusing.
 */
export function faviconFromUpload(file: { type: string; bytes: Buffer }): { dataUrl: string } | { problem: string } {
  const type = (file.type || '').toLowerCase().trim();
  if (!(type in TYPES)) {
    return {
      problem:
        'That file is not an image a browser will use as an icon. Choose a PNG, a JPEG, a WebP, an ICO or an SVG.',
    };
  }
  if (file.bytes.byteLength === 0) return { problem: 'That file is empty.' };
  const dataUrl = `data:${type};base64,${file.bytes.toString('base64')}`;
  const problem = checkFaviconDataUrl(dataUrl);
  if (problem) return { problem: problem.message };
  return { dataUrl };
}

/** The media type of a stored data URL, or null when it is not one. */
export function faviconMediaType(dataUrl: string): string | null {
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,/i.exec(dataUrl.trim());
  return match ? (match[1] ?? '').toLowerCase() : null;
}

/** How big the decoded image is, in bytes. */
export function faviconBytes(dataUrl: string): number {
  const match = /^data:[^;]+;base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl.trim());
  if (!match) return 0;
  // 3 bytes per 4 base64 characters, less the padding — computed rather than decoded, because this is called
  // on a value that may be about to be refused and decoding it first would be work on a bad input.
  const body = match[1] ?? '';
  const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
}

/**
 * The icon in force, or null when the owner has never set one.
 *
 * **DEGRADES TO null, NEVER THROWS.** A settings row that cannot be read must not cost every page its icon —
 * the route falls back to `DEFAULT_ICON` and the site keeps the mark it has today. A row whose value is not
 * an icon is treated as absent for the same reason: a hand-written insert must not become a broken `<link>`
 * on 1,104 pages.
 */
export async function loadSiteFavicon(db: Db): Promise<SiteFavicon | null> {
  try {
    const row = await db.one<{ value: unknown; actor_name: string | null; updated_at: Date | null }>(
      `select s.value, coalesce(m.display_name, a.email) as actor_name, s.updated_at
         from site_setting s
         left join account a on a.id = s.updated_by
         left join ozikoro_member m on m.account_id = s.updated_by
        where s.key = $1`,
      [FAVICON_KEY]
    );
    if (!row) return null;
    const value = typeof row.value === 'string' ? (JSON.parse(row.value) as unknown) : row.value;
    const dataUrl =
      value !== null && typeof value === 'object' && 'dataUrl' in value
        ? String((value as { dataUrl: unknown }).dataUrl ?? '')
        : '';
    if (checkFaviconDataUrl(dataUrl) !== null) return null;
    return {
      dataUrl: dataUrl.trim(),
      mediaType: faviconMediaType(dataUrl) ?? 'image/png',
      bytes: faviconBytes(dataUrl),
      actorName: row.actor_name,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    };
  } catch (error) {
    console.error('[ozikoro/site-icon] could not read the site icon:', String(error).slice(0, 200));
    return null;
  }
}

/**
 * The address every page's icon is served from.
 *
 * IT IS `.ico` BECAUSE THAT IS THE ADDRESS A BROWSER ASKS FOR BY ITSELF. Every design screen and all 1,051
 * articles reach the reader through a document whose head this application does not write, and a browser with
 * no `<link rel="icon">` asks for `/favicon.ico` unprompted. **A prettier address such as
 * `/site-icon.png` would need every one of those heads rewritten to be seen at all.**
 */
export const FAVICON_HREF = '/favicon.ico';

/**
 * The address of the Apple touch icon, which is a FILE and not this setting.
 *
 * **IT IS NAMED HERE SO THAT THE ROUTE AND THE LAYOUT CANNOT DISAGREE ABOUT EITHER ADDRESS.** The layout used
 * to spell `/favicon.ico`, `/favicon.png` and `/apple-touch-icon.png` out by hand, and the third of those is
 * the one that must stay a file: an iOS home-screen icon is a different picture at a different size, and this
 * setting does not pretend to replace it. Keeping the two strings in the package that owns the setting means
 * a change to either is one edit rather than two that have to be found.
 */
export const APPLE_TOUCH_ICON_HREF = '/apple-touch-icon.png';

/**
 * The `<link>` elements the React routes declare, for `app/layout.tsx`.
 *
 * WHY IT IS A LIST OF PAIRS RATHER THAN A STRING OF MARKUP: the layout is JSX and a string of HTML there would
 * have to cross a `dangerouslySetInnerHTML` boundary for no gain. The design screens and the articles need
 * NOTHING from this function and that is the point of the whole design — a browser asks for `/favicon.ico` by
 * itself when a document declares no icon, so the setting reaches those pages through the route rather than
 * through their heads. See the module header.
 */
export const FAVICON_LINKS: readonly { rel: string; href: string; sizes?: string }[] = [
  { rel: 'icon', href: FAVICON_HREF },
  { rel: 'shortcut icon', href: FAVICON_HREF },
  { rel: 'apple-touch-icon', href: APPLE_TOUCH_ICON_HREF, sizes: '180x180' },
];
