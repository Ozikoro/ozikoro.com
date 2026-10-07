/**
 * Object storage for pronunciation audio.
 *
 * ONE INTERFACE, TWO DRIVERS
 *
 *   S3_BUCKET set   -> S3 (or any S3-compatible service: MinIO, R2, Spaces)
 *   S3_BUCKET unset -> local filesystem under .data/media
 *
 * The local driver exists so the whole record -> review -> publish -> play path
 * can be built and tested without cloud credentials. That is the same reasoning
 * as PGlite for the database, and it has the same caveat, which is stated
 * loudly at startup rather than discovered in production: a container
 * filesystem is ephemeral, so the local driver loses every upload on redeploy
 * and must not be used in production.
 *
 * WHY UPLOADS GO THROUGH THE SERVER
 *
 * Presigned direct-to-S3 uploads would avoid proxying bytes, and are the right
 * answer at scale. At this size — voice clips of a few tens of kilobytes — they
 * would add a second authentication mechanism, a bucket-policy surface and a
 * CORS configuration to defend, in exchange for bandwidth the application can
 * easily carry. The route validates the bytes before they reach storage, which
 * presigned uploads cannot do.
 *
 * WHY MAGIC BYTES ARE CHECKED
 *
 * These files are served back to browsers from our own origin. A file that is
 * declared `audio/webm` but is really HTML would be a stored-XSS vector, and
 * the declaration is attacker-controlled. We sniff the container signature and
 * reject anything that does not match, rather than trusting the client.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCAL_MEDIA_ROOT = resolve(HERE, '..', '..', '..', '.data', 'media');

/** Hard ceiling per recording. Enforced on the real byte length. */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024; // 5 MB

/** Audio containers we accept, with the signature used to verify them. */
const ACCEPTED_AUDIO_TYPES: Record<
  string,
  { extension: string; matches: (head: Buffer) => boolean }
> = {
  'audio/webm': {
    extension: 'webm',
    // EBML header, which WebM and Matroska share. MediaRecorder produces WebM
    // in Chromium and Firefox.
    matches: (h) => h.length >= 4 && h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3,
  },
  'audio/ogg': {
    extension: 'ogg',
    matches: (h) => h.length >= 4 && h.toString('ascii', 0, 4) === 'OggS',
  },
  'audio/mpeg': {
    extension: 'mp3',
    // ID3-tagged MP3, or a bare MPEG audio frame (0xFFEx / 0xFFFx).
    matches: (h) =>
      h.length >= 3 &&
      ((h.toString('ascii', 0, 3) === 'ID3') || (h[0] === 0xff && (h[1]! & 0xe0) === 0xe0)),
  },
  'audio/wav': {
    extension: 'wav',
    matches: (h) =>
      h.length >= 12 &&
      h.toString('ascii', 0, 4) === 'RIFF' &&
      h.toString('ascii', 8, 12) === 'WAVE',
  },
  'audio/mp4': {
    extension: 'm4a',
    // ISO base media file format: a box length then 'ftyp'.
    matches: (h) => h.length >= 12 && h.toString('ascii', 4, 8) === 'ftyp',
  },
  'audio/x-m4a': {
    extension: 'm4a',
    matches: (h) => h.length >= 12 && h.toString('ascii', 4, 8) === 'ftyp',
  },
};

/** Safari records audio/mp4; some Android browsers send audio/3gpp. */
const MIME_ALIASES: Record<string, string> = {
  'audio/mp4a-latm': 'audio/mp4',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
};

export class StorageError extends Error {
  /** Set explicitly: without it every subclass reports its name as "Error". */
  override readonly name = 'StorageError';
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface StoredObject {
  key: string;
  url: string;
  byteSize: number;
  contentType: string;
}

export interface StoredObjectBody {
  body: Buffer;
  contentType: string;
}

/**
 * What is stored under a key, WITHOUT the bytes.
 *
 * WHY THIS EXISTS SEPARATELY FROM `get()`
 *
 * `get()` downloads the object. That is right for serving a file and wrong for asking a question about it,
 * and the question this was added for is the one the archive's media move turns on: **is this key already
 * there, and is it the right size?**
 *
 * Asking with `get()` answers it by transferring 838 MB twice over a set of 3,441 files, which on a
 * domestic connection is the difference between a resume that takes a minute and one that takes an hour.
 * More importantly it cannot answer the second half at all: an object that was truncated by an interrupted
 * upload has the right key and the wrong length, and a bare existence check skips it and reports success.
 */
export interface StoredObjectInfo {
  byteSize: number;
  contentType: string;
}

export interface Storage {
  readonly driver: 's3' | 'local';
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<StoredObjectBody | null>;
  /** Metadata only, or null when the key holds nothing. */
  head(key: string): Promise<StoredObjectInfo | null>;
  remove(key: string): Promise<void>;
  publicUrl(key: string): string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Resolve a declared content type to one we accept, or throw.
 * Aliases are folded first so a browser that reports `audio/x-wav` is not
 * rejected for a spelling difference.
 */
export function normaliseAudioType(declared: string): string {
  const base = declared.split(';')[0]!.trim().toLowerCase();
  const resolved = MIME_ALIASES[base] ?? base;
  if (!(resolved in ACCEPTED_AUDIO_TYPES)) {
    throw new StorageError(
      'unsupported_audio_type',
      `Unsupported audio format "${declared}". Use WebM, Ogg, MP3, WAV or M4A.`
    );
  }
  return resolved;
}

/**
 * Check the file's actual bytes against its declared type.
 * This is what stops an HTML or SVG payload being stored under an audio
 * content type and then served from our origin.
 */
export function verifyAudioSignature(body: Buffer, contentType: string): void {
  if (body.length === 0) {
    throw new StorageError('empty_file', 'The recording was empty.');
  }
  const spec = ACCEPTED_AUDIO_TYPES[contentType];
  if (!spec) {
    throw new StorageError('unsupported_audio_type', `Unsupported audio format "${contentType}".`);
  }
  const head = body.subarray(0, 16);
  if (!spec.matches(head)) {
    throw new StorageError(
      'content_type_mismatch',
      `That file does not look like ${contentType}. It may be corrupt or mislabelled.`
    );
  }
}

export function extensionFor(contentType: string): string {
  return ACCEPTED_AUDIO_TYPES[contentType]?.extension ?? 'bin';
}

/**
 * Build the storage key for a recording.
 *
 * Layout: audio/<language>/<wordId>/<uuid>.<ext>
 * Partitioned by language and word so a bucket lifecycle rule can be scoped by
 * prefix, and so browsing the bucket is comprehensible — which matters the
 * first time somebody has to find and delete one recording by hand.
 */
export function audioKey(languageCode: string, wordId: number, contentType: string): string {
  return `audio/${languageCode}/${wordId}/${randomUUID()}.${extensionFor(contentType)}`;
}

// ---------------------------------------------------------------------------
// Local filesystem driver — development and tests only
// ---------------------------------------------------------------------------

class LocalStorage implements Storage {
  readonly driver = 'local' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  /** Refuse to escape the media root via a crafted key. */
  private pathFor(key: string): string {
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + '/')) {
      throw new StorageError('invalid_key', 'Storage key escapes the media root.');
    }
    return full;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return { key, url: this.publicUrl(key), byteSize: body.length, contentType };
  }

  async get(key: string): Promise<StoredObjectBody | null> {
    try {
      const body = await readFile(this.pathFor(key));
      return { body, contentType: contentTypeForExtension(key) };
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch {
      // Already gone is a success for a delete.
    }
  }

  /**
   * The local driver stores no content type of its own, so the extension is the only answer available —
   * the same one `get()` gives, so a caller cannot see two different types for one file.
   */
  async head(key: string): Promise<StoredObjectInfo | null> {
    try {
      const info = await stat(this.pathFor(key));
      if (!info.isFile()) return null;
      return { byteSize: info.size, contentType: contentTypeForExtension(key) };
    } catch {
      return null;
    }
  }

  /**
   * Local media is served by the application at /media/<key>, because a
   * filesystem path is not a URL a browser can fetch.
   */
  publicUrl(key: string): string {
    return `/media/${key}`;
  }
}

function contentTypeForExtension(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  for (const [type, spec] of Object.entries(ACCEPTED_AUDIO_TYPES)) {
    if (spec.extension === ext) return type;
  }
  return 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// S3 driver
// ---------------------------------------------------------------------------

class S3Storage implements Storage {
  readonly driver = 's3' as const;
  private client: import('@aws-sdk/client-s3').S3Client | null = null;
  private readonly bucket: string;
  private readonly publicBase: string | null;

  constructor(bucket: string, publicBase: string | null) {
    this.bucket = bucket;
    this.publicBase = publicBase;
  }

  private async sdk(): Promise<typeof import('@aws-sdk/client-s3')> {
    return import('@aws-sdk/client-s3');
  }

  private async getClient(): Promise<import('@aws-sdk/client-s3').S3Client> {
    if (this.client) return this.client;
    const { S3Client } = await this.sdk();

    const region = process.env.S3_REGION ?? 'us-east-1';
    const endpoint = process.env.S3_ENDPOINT;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

    this.client = new S3Client({
      region,
      // Omitting an endpoint uses AWS itself. Setting one targets MinIO/R2.
      ...(endpoint ? { endpoint } : {}),
      // MinIO and most non-AWS providers need path-style addressing.
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true' || Boolean(endpoint),
      // With no static keys the SDK falls back to the ECS task role, which is
      // the preferred production setup: no long-lived credential exists.
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    });
    return this.client;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const { PutObjectCommand } = await this.sdk();
    const client = await this.getClient();
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Immutable: keys contain a UUID, so a given key never changes content.
        CacheControl: 'public, max-age=31536000, immutable',
      })
    );
    return { key, url: this.publicUrl(key), byteSize: body.length, contentType };
  }

  async get(key: string): Promise<StoredObjectBody | null> {
    const { GetObjectCommand } = await this.sdk();
    const client = await this.getClient();
    try {
      const result = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!result.Body) return null;
      const bytes = await result.Body.transformToByteArray();
      return {
        body: Buffer.from(bytes),
        contentType: result.ContentType ?? contentTypeForExtension(key),
      };
    } catch (error) {
      if (error instanceof Error && /NoSuchKey|NotFound/.test(error.name)) return null;
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    const { DeleteObjectCommand } = await this.sdk();
    const client = await this.getClient();
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /**
   * A HEAD, so asking whether a key is already stored costs no bytes.
   *
   * A missing key is `null` rather than a thrown error, which is what makes "already there?" a question a
   * caller can ask in a loop — see `StoredObjectInfo`.
   */
  async head(key: string): Promise<StoredObjectInfo | null> {
    const { HeadObjectCommand } = await this.sdk();
    const client = await this.getClient();
    try {
      const result = await client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      if (result.ContentLength === undefined) return null;
      return {
        byteSize: result.ContentLength,
        contentType: result.ContentType ?? contentTypeForExtension(key),
      };
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      // S3 answers a HEAD for a missing key with 404 and no body, which the SDK reports as NotFound.
      if (/NoSuchKey|NotFound|404/.test(name)) return null;
      const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw error;
    }
  }

  /**
   * A public URL needs either a CDN base or a public bucket. With neither, callers
   * should stream through the application instead — see getObjectStreamingHint.
   */
  publicUrl(key: string): string {
    if (this.publicBase) return `${this.publicBase.replace(/\/$/, '')}/${key}`;
    const endpoint = process.env.S3_ENDPOINT;
    if (endpoint) {
      const region = process.env.S3_REGION ?? 'us-east-1';
      void region;
      return `${endpoint.replace(/\/$/, '')}/${this.bucket}/${key}`;
    }
    const region = process.env.S3_REGION ?? 'us-east-1';
    return `https://${this.bucket}.s3.${region}.amazonaws.com/${key}`;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let singleton: Storage | null = null;

export function getStorage(): Storage {
  if (singleton) return singleton;

  const bucket = process.env.S3_BUCKET?.trim();
  if (bucket) {
    singleton = new S3Storage(bucket, process.env.MEDIA_PUBLIC_BASE_URL?.trim() || null);
    return singleton;
  }

  // Loud, because the failure mode is silent data loss: recordings survive until
  // the container is replaced and then vanish, with the database still pointing
  // at keys that no longer exist.
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[storage] S3_BUCKET is not set. Falling back to local filesystem storage at ' +
        `${LOCAL_MEDIA_ROOT}, which is EPHEMERAL on a container platform — every upload ` +
        'will be lost on redeploy. Set S3_BUCKET before accepting recordings.'
    );
  }

  singleton = new LocalStorage(LOCAL_MEDIA_ROOT);
  return singleton;
}

/** Test seam: drop the memoised driver so a changed environment takes effect. */
export function resetStorage(): void {
  singleton = null;
}

/**
 * Test seam: install a driver directly, or `null` to go back to the environment.
 *
 * WHY THIS EXISTS RATHER THAN ONLY `resetStorage()`
 *
 * The publication builder reads figure bytes through `getStorage()`, and the fault it was fixed for only
 * happens in an environment where the local media root does not exist and the object store does — **which is
 * the container and is not this checkout.** `resetStorage()` can only re-derive a driver from the
 * environment, so a test of that branch would need a bucket, credentials and a network. Installing a
 * `Storage` the test owns is what makes "a figure that is in neither the media root nor a local file is
 * still placed" a unit test rather than a deploy.
 */
export function setStorageForTest(storage: Storage | null): void {
  singleton = storage;
}

export function localStorageRoot(): string {
  return LOCAL_MEDIA_ROOT;
}
