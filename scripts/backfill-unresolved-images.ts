/**
 * The six published articles whose image the archive holds but cannot resolve.
 *
 * THE FAULT, MEASURED
 *
 * Six published articles embed an image in `body_html` and the article route could not turn that
 * address into one of the archive's own. Running the archive's OWN resolver (`mediaUrlResolver`)
 * over every body address and comparing the result with the table:
 *
 *   address in the body                                      why the resolver misses
 *   2025/06/WhatsApp-Image-2025-06-10-at-03.11.02.jpeg       the row holds …-e1749521699771.jpeg
 *   2025/05/sddefault.jpg                                    the row holds 2025/05/sddefault-e1746143562689.jpg
 *   2025/01/rev-taylor.jpg                                   the row holds …-e1737398447245.jpg
 *   2024/09/IMG_9629.jpeg                                    the row holds …-e1727198617216.jpeg
 *   2024/09/…Northcote-300x148.png                           the row holds …Northcote-scaled.png
 *   2024/09/Onitsha-Women-…-300x221.jpg                      the row holds …-e1725463971549.jpg
 *
 * **WordPress appends `-e<timestamp>` when an image is edited and `-scaled` when it is larger than
 * the big-image threshold, and it keeps serving the ORIGINAL address afterwards.** The importer
 * catalogued the attachment's own final filename, so a body written before that edit quotes an
 * address no row holds. This is the same class of fault the resolver's `-WxH` stripping already
 * handles for resized copies — one WordPress suffix further out.
 *
 * The seventh hole, `/about/`'s `2020/01/image-1-copyright.jpg`, is NOT here: there is no file for
 * it anywhere on disk or in the fallback directory, so no row can make it render. See the report.
 *
 * WHAT THIS WRITES, AND WHAT IT REFUSES TO
 *
 * For each of the six, one `ozikoro_media` row whose `source_url` is the exact address the article
 * body holds, and whose `storage_key` addresses the file that IS on disk — the same file the
 * reconciliation named, in `data/media/ozikoro-wp/`. The file is put into the served store through
 * `getStorage()`, which is the interface the media route reads, because **a file placed in the
 * fallback directory is on disk, correctly named, and serves 404 from the store the site reads**.
 *
 * NOTHING IS INVENTED. No title, caption, credit or dimension is composed: every value written is
 * read from one of three places and named as such — the file's own name, the body's address, or the
 * article whose body carries it. `wp_media_id` is deliberately left NULL, because the WordPress
 * attachment id it would name is already taken by the row that holds the edited file, and
 * `wp_media_id` is UNIQUE — putting the same id on two rows would be claiming two attachments where
 * WordPress had one. The link back is in `source_url` and in the audit row.
 *
 * Usage:
 *   node scripts/backfill-unresolved-images.ts --check
 *   node scripts/backfill-unresolved-images.ts --apply
 *   node scripts/backfill-unresolved-images.ts --check --data-dir .data/scratch-r341-pg
 */
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join } from 'node:path';
import { closeDb, createDb, type Db } from '@ozituma/db/client';
import { getStorage, localStorageRoot } from '@ozituma/db/storage';

/** Where the extraction downloaded the WordPress files to. Mirrors the media route's fallback. */
const FALLBACK_DIR = join(process.cwd(), 'data', 'media', 'ozikoro-wp');

/**
 * The six, named. `archiveFile` is the file the reconciliation measured on disk; `address` is the
 * address the body holds, character for character; `slug` is derived from the file's own name and
 * made unique against the rows already present.
 */
interface Hole {
  article: string;
  address: string;
  archiveFile: string;
  slug: string;
  /** The WordPress attachment these bytes belong to, recorded on the audit row only. */
  attachmentId: number;
}

const HOLES: Hole[] = [
  {
    article: 'the-power-of-culture-what-igbo-omugwo-can-teach-us-about-postpartum-care',
    address: 'https://ozikoro.com/wp-content/uploads/2025/06/WhatsApp-Image-2025-06-10-at-03.11.02.jpeg',
    archiveFile: '3625-WhatsApp-Image-2025-06-10-at-03.11.02.jpeg',
    slug: 'whatsapp-image-2025-06-10-at-03-11-02-3625',
    attachmentId: 6783,
  },
  {
    article: 'ugbo-a-living-archive-of-ancient-igbo-civilization-and-cultural-resilience-in-enugu-state',
    address: 'https://ozikoro.com/wp-content/uploads/2025/05/sddefault.jpg',
    archiveFile: '3701-sddefault.jpg',
    slug: 'sddefault-2025-05-3701',
    attachmentId: 5999,
  },
  {
    article: 'how-sunday-became-known-as-uka-in-igbo-language',
    address: 'https://ozikoro.com/wp-content/uploads/2025/01/rev-taylor.jpg',
    archiveFile: '3734-rev-taylor.jpg',
    slug: 'rev-taylor-3734',
    attachmentId: 3578,
  },
  {
    article: 'the-influence-of-nri-leadership-titles-and-cultural-heritage-in-igbo-land',
    address: 'https://ozikoro.com/wp-content/uploads/2024/09/IMG_9629.jpeg',
    archiveFile: '3779-IMG_9629.jpeg',
    slug: 'img-9629-3779',
    attachmentId: 871,
  },
  {
    article: 'ichi-mark-the-igbo-scarification',
    address: 'https://ozikoro.com/wp-content/uploads/2024/09/Igbo-Men-with-Ichi-Scarification-Thomas-W.-Northcote-300x148.png',
    archiveFile: '3780-Igbo-Men-with-Ichi-Scarification-Thomas-W.-Northcote-300x148.png',
    slug: 'igbo-men-with-ichi-scarification-thomas-w-northcote-300x148-3780',
    attachmentId: 400,
  },
  {
    article: 'umuada-women-leadership-roles-in-the-igbo-society',
    address: 'https://ozikoro.com/wp-content/uploads/2024/09/Onitsha-Women-G.-F.-Packer-in-the-1880s-300x221.jpg',
    archiveFile: '3801-Onitsha-Women-G.-F.-Packer-in-the-1880s-300x221.jpg',
    slug: 'onitsha-women-g-f-packer-in-the-1880s-300x221-3801',
    attachmentId: 336,
  },
];

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp',
};

function parseArgs(argv: string[]) {
  const args = { apply: false, dataDir: null as string | null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--check') args.apply = false;
    else if (argv[i] === '--data-dir') args.dataDir = argv[++i] ?? null;
  }
  return args;
}

/**
 * Whether the archive can already resolve an address. Deliberately a copy of nothing: the question
 * is answered by the two columns the resolver keys on, and it is asked here rather than by the
 * resolver so a re-run reports "already present" instead of "wrote nothing".
 */
async function canResolve(db: Db, address: string): Promise<boolean> {
  const row = await db.one<{ n: number }>(
    `select count(*)::int as n from ozikoro_media where source_url = $1 and storage_key is not null`,
    [address]
  );
  return Number(row?.n ?? 0) > 0;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = await createDb(args.dataDir ? { dataDir: args.dataDir } : {});
  const storage = getStorage();

  console.log(`\n  Store:      ${localStorageRoot()}`);
  console.log(`  Fallback:   ${FALLBACK_DIR}`);
  console.log(`  Cluster:    ${args.dataDir ?? '.data/pg (default)'}`);
  console.log(`  Mode:       ${args.apply ? 'APPLY' : 'DRY RUN — nothing written'}\n`);

  let planned = 0;
  const ready: { hole: Hole; bytes: Buffer; key: string; mime: string; sha: string }[] = [];

  for (const hole of HOLES) {
    const from = join(FALLBACK_DIR, hole.archiveFile);
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(from);
    } catch {
      throw new Error(`the file the reconciliation named is not on disk: ${from}`);
    }

    const bytes = await readFile(from);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const ext = extname(hole.archiveFile).toLowerCase();
    const mime = MIME[ext];
    if (!mime) throw new Error(`no content type known for ${ext}`);

    /*
     * The storage key keeps the file's own name exactly, including the WordPress counter prefix the
     * extraction wrote, so the key and the file on disk are the same string and a reader can check
     * one against the other without a lookup table.
     */
    const key = `ozikoro/${hole.archiveFile}`;
    const resolvable = await canResolve(db, hole.address);
    const held = await storage.get(key);

    console.log(`  ${resolvable ? 'already resolves' : planned === 0 && !args.apply ? 'WOULD ADD      ' : args.apply ? 'ADDING         ' : 'WOULD ADD      '}  ${hole.slug}`);
    console.log(`      address   ${hole.address}`);
    console.log(`      file      ${hole.archiveFile}  ${info.size} bytes  ${mime}  sha256 ${sha.slice(0, 16)}…`);
    console.log(`      key       ${key}  ${held ? '(already in the store)' : '(NOT in the store — will be put there)'}`);
    console.log(`      article   /${hole.article}/`);

    if (!resolvable || !held) {
      planned += 1;
      ready.push({ hole, bytes, key, mime, sha });
    }
  }

  console.log(`\n  ${ready.length} of ${HOLES.length} need a write.\n`);

  if (!args.apply) {
    console.log('  DRY RUN — nothing written. Add --apply to publish these.\n');
    await db.close();
    return;
  }

  let wrote = 0;
  let reused = 0;
  for (const item of ready) {
    const { hole, bytes, key, mime, sha } = item;

    const existing = await db.one<{ id: number; storage_key: string | null }>(
      `select id, storage_key from ozikoro_media where source_url = $1`,
      [hole.address]
    );

    let mediaId: number;
    if (existing) {
      mediaId = Number(existing.id);
      if (existing.storage_key !== key) {
        await db.query(`update ozikoro_media set storage_key = $2, updated_at = now() where id = $1`, [mediaId, key]);
      }
      reused += 1;
    } else {
      await storage.put(key, bytes, mime);
      const row = await db.one<{ id: number }>(
        `insert into ozikoro_media
           (slug, kind, title, source_url, storage_key, mime_type, filesize_bytes, uploaded_at)
         values ($1, 'image', $2, $3, $4, $5, $6, now())
         returning id`,
        [hole.slug, hole.archiveFile, hole.address, key, mime, bytes.length]
      );
      if (!row) throw new Error(`insert returned no row for ${hole.slug}`);
      mediaId = Number(row.id);
      wrote += 1;
    }

    /*
     * THE AUDIT ROW. `actor_id` is null and the actor is named in the note, deliberately: this is a
     * scripted migration, not a decision the owner sat down and made, and `ozikoro_audit`'s read-back
     * is written to surface an unattributed change rather than hide it. Every field either side is
     * evidence — the address the body holds, the file it now resolves to, the digest of the bytes
     * that were put in the store, and the WordPress attachment the bytes came from.
     */
    await db.query(
      `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
       values ('ozikoro_media', $1, 'backfill_unresolved_image', $2::jsonb, $3::jsonb, null, $4)`,
      [
        mediaId,
        JSON.stringify({
          body_address: hole.address,
          resolution: 'null — the body address matches no media row',
          reason: 'WordPress appends -e<timestamp> when an image is edited and -scaled above the big-image threshold; the row catalogued the edited name while the body quotes the original',
        }),
        JSON.stringify({
          source_url: hole.address,
          storage_key: key,
          file_on_disk: hole.archiveFile,
          bytes: bytes.length,
          mime_type: mime,
          sha256: sha,
          wordpress_attachment_id: hole.attachmentId,
          article_slug: hole.article,
          served_at: `/media/${key}`,
        }),
        `Scripted reconciliation backfill by DSH Agent (round 341), no signed-in actor. Widens the archive's URL map by the one row the address in the article body needs, so the image the archive already holds resolves at render time instead of falling back to ozikoro.com. The file was put into the served store through getStorage(). Nothing was composed: the row's name is the file's own name and its address is the address the body holds.`,
      ]
    );
    console.log(`  wrote media ${mediaId}  ${key}  (audit row written)`);
  }

  console.log(`\n  inserted ${wrote}, completed ${reused}. Audit rows written for all ${ready.length}.\n`);
  await db.close();
}

await main();
