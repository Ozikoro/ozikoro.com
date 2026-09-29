/**
 * POST /api/audio — accept a pronunciation recording.
 *
 * Flow: validate the bytes, store them, then create an `audio` *suggestion*.
 * Nothing becomes public here — the recording waits in the review queue like
 * every other contribution, because an unreviewed voice recording is harder to
 * take back than an unreviewed definition.
 *
 * The file is a multipart form field, so this works from a plain HTML form and
 * can be exercised with curl. Recording in the browser is a progressive
 * enhancement on top of that: the same endpoint accepts a file upload.
 */
import { NextResponse } from 'next/server';
import { languageUrlSlug } from '@ozituma/core';
import { getDb } from '@ozituma/db/client';
import { ContributionError, submitSuggestion } from '@ozituma/db/contributions';
import {
  MAX_AUDIO_BYTES,
  StorageError,
  audioKey,
  getStorage,
  normaliseAudioType,
  verifyAudioSignature,
} from '@ozituma/db/storage';
import { getCurrentAccount } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function redirectTo(path: string, params: Record<string, string> = {}): NextResponse {
  const search = new URLSearchParams(params).toString();
  return new NextResponse(null, {
    status: 303,
    headers: { Location: search.length > 0 ? `${path}?${search}` : path },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const current = await getCurrentAccount();
  if (!current) {
    return redirectTo('/signin', { error: 'Sign in to add a recording.' });
  }

  const form = await request.formData();
  const wordIdRaw = form.get('wordId');
  const wordId = Number(typeof wordIdRaw === 'string' ? wordIdRaw : NaN);
  const language = String(form.get('language') ?? 'ibo');

  if (!Number.isInteger(wordId) || wordId <= 0) {
    return redirectTo('/contribute', { error: 'A recording must be attached to a word.' });
  }

  const file = form.get('file');
  if (!(file instanceof Blob)) {
    return redirectTo(`/contribute`, { error: 'No recording was uploaded.' });
  }

  const db = await getDb();

  // Confirm the target exists before storing anything, so a bad id does not
  // leave an orphaned object in the bucket.
  const word = await db.one<{ id: string; headword: string; slug: string; language_code: string }>(
    `select id, headword, slug, language_code from word where id = $1 and language_code = $2`,
    [wordId, language]
  );
  if (!word) {
    return redirectTo('/contribute', { error: `No entry ${wordId} exists in ${language}.` });
  }
  const wordPath = `/word/${languageUrlSlug(word.language_code)}/${encodeURIComponent(word.slug)}`;

  try {
    const bytes = Buffer.from(await file.arrayBuffer());

    // Size is checked on the ACTUAL byte length. The reference implementation
    // measures a base64 string while its UI promises a smaller limit, so its
    // stated limit is never the enforced one.
    if (bytes.length === 0) {
      throw new StorageError('empty_file', 'The recording was empty.');
    }
    if (bytes.length > MAX_AUDIO_BYTES) {
      throw new StorageError(
        'file_too_large',
        `Recording is ${Math.round(bytes.length / 1024)} KB; the limit is ${Math.round(MAX_AUDIO_BYTES / 1024)} KB.`
      );
    }

    // Content type comes from the client, so it is only a hint. `normaliseAudioType`
    // folds aliases; `verifyAudioSignature` then checks the actual bytes match.
    const contentType = normaliseAudioType(file.type || 'application/octet-stream');
    verifyAudioSignature(bytes, contentType);

    const storage = getStorage();
    const key = audioKey(language, wordId, contentType);
    const stored = await storage.put(key, bytes, contentType);

    const durationRaw = form.get('durationMs');
    const durationMs =
      typeof durationRaw === 'string' && durationRaw.trim() !== '' ? Number(durationRaw) : null;
    const dialectCode = String(form.get('dialectCode') ?? '').trim();
    const provenanceNote = String(form.get('provenanceNote') ?? '').trim();

    const suggestion = await submitSuggestion(db, current.account.id, {
      kind: 'audio',
      language,
      targetWordId: wordId,
      payload: {
        storageKey: stored.key,
        mimeType: stored.contentType,
        byteSize: stored.byteSize,
        durationMs,
        dialectCode: dialectCode || null,
        provenanceNote: provenanceNote || null,
      },
    });

    return redirectTo(wordPath, { recorded: '1', submission: String(suggestion.id) });
  } catch (error) {
    // A file that failed validation must not be left in storage.
    if (error instanceof StorageError || error instanceof ContributionError) {
      return redirectTo(wordPath, { error: error.message });
    }
    console.error('[audio]', error);
    return redirectTo(wordPath, { error: 'Could not accept that recording.' });
  }
}
