/**
 * POST /api/contributions — submit a word, a clan, a name, a proverb, or a correction.
 *
 * A form endpoint, so contributing needs no JavaScript. Requires a signed-in
 * account so that every submission has an accountable author — anonymous
 * contributions to a dictionary make the review queue unusable, because there is
 * nobody to ask about a doubtful entry.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { ContributionError, submitSuggestion } from '@ozituma/db/contributions';
import { getCurrentAccount } from '@/lib/session';
import { languageUrlSlug } from '@ozituma/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A 303 redirect to a RELATIVE location — see the note in app/api/auth for why
 * relative rather than absolute (no configured-base drift, no Host-header
 * open-redirect vector).
 */
function redirectTo(path: string, params: Record<string, string> = {}): NextResponse {
  const search = new URLSearchParams(params).toString();
  const location = search.length > 0 ? `${path}?${search}` : path;
  return new NextResponse(null, { status: 303, headers: { Location: location } });
}

export async function POST(request: Request): Promise<NextResponse> {
  const current = await getCurrentAccount();
  if (!current) {
    return redirectTo('/signin', { error: 'Sign in to contribute.' });
  }

  const form = await request.formData();
  const kind = String(form.get('kind') ?? '');
  const language = String(form.get('language') ?? 'ibo');
  const db = await getDb();

  const text = (name: string, max: number): string => {
    const raw = form.get(name);
    return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
  };

  try {
    if (kind === 'new_word') {
      const exampleText = text('example', 500);
      const exampleTranslation = text('exampleTranslation', 500);

      const result = await submitSuggestion(db, current.account.id, {
        kind: 'new_word',
        language,
        payload: {
          headword: text('headword', 120),
          // One definition per line, which is how a person naturally writes them.
          definitions: text('definitions', 4000)
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0),
          partOfSpeech: text('partOfSpeech', 20) || null,
          example: exampleText
            ? { text: exampleText, translation: exampleTranslation || null }
            : null,
          dialectNote: text('dialectNote', 1000) || null,
          note: text('note', 1000) || null,
        },
      });
      return redirectTo('/contribute', { submitted: String(result.id) });
    }

    if (kind === 'new_definition') {
      const targetWordId = text('wordId', 20);
      const result = await submitSuggestion(db, current.account.id, {
        kind: 'new_definition',
        language,
        targetWordId: targetWordId ? Number(targetWordId) : null,
        payload: {
          headword: text('headword', 120) || null,
          definitions: text('definitions', 4000)
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0),
          note: text('note', 1000) || null,
        },
      });
      return redirectTo('/contribute', { submitted: String(result.id) });
    }

    if (kind === 'proverb_edit') {
      const result = await submitSuggestion(db, current.account.id, {
        kind: 'proverb_edit',
        language,
        // The proverb IS the target here, and `target_word_id` means a word, so
        // the example id travels in the payload instead of being forced into a
        // column that would then lie about what it points at.
        targetWordId: null,
        payload: {
          exampleId: Number(text('exampleId', 20)),
          previousText: text('previousText', 600),
          text: text('text', 600),
          translation: text('translation', 600) || null,
          note: text('note', 1000) || null,
        },
      });
      // Back to the proverb, told that its edit is queued.
      return redirectTo(`/proverbs/${Number(text('exampleId', 20))}`, {
        suggested: String(result.id),
      });
    }

    if (kind === 'word_edit') {
      const wordId = Number(text('wordId', 20));
      const result = await submitSuggestion(db, current.account.id, {
        kind: 'word_edit',
        language,
        // The entry being edited is the target, so it can point at the word column properly.
        targetWordId: Number.isInteger(wordId) && wordId > 0 ? wordId : null,
        payload: {
          wordId,
          previousHeadword: text('previousHeadword', 120),
          previousMeanings: text('previousMeanings', 4000),
          headword: text('headword', 120),
          meanings: text('meanings', 4000),
          /*
           * Repeated fields, paired by index: the form renders one Igbo box and one English box per
           * example, in order, so the two arrive as two lists that line up. Zipping them here keeps
           * the pair together, which matters — an Igbo sentence and its translation are one
           * quotation, not two lists that can drift apart.
           */
          examples: form
            .getAll('exampleText')
            .map((value, index) => {
              const id = Number(form.getAll('exampleId')[index]);
              return {
                exampleId: Number.isInteger(id) && id > 0 ? id : null,
                text: String(value).trim().slice(0, 600),
                translation:
                  String(form.getAll('exampleTranslation')[index] ?? '').trim().slice(0, 600) || null,
              };
            })
            .filter((row) => row.text.length > 0),
          previousExamples: form
            .getAll('previousExampleText')
            .map((value, index) => {
              const id = Number(form.getAll('previousExampleId')[index]);
              return {
                exampleId: Number.isInteger(id) && id > 0 ? id : null,
                text: String(value).trim().slice(0, 600),
                translation:
                  String(form.getAll('previousExampleTranslation')[index] ?? '').trim().slice(0, 600) ||
                  null,
              };
            })
            .filter((row) => row.text.length > 0),
          /*
           * Dialects arrive as parallel lists too: one hidden dialect code per row, and the spelling
           * beside it. Only rows with a spelling are sent, so clearing a spelling removes that
           * variety's entry rather than recording an empty one.
           */
          dialects: form
            .getAll('dialectCode')
            .map((code, index) => ({
              dialectCode: String(code).trim(),
              spelling: String(form.getAll('dialectSpelling')[index] ?? '').trim().slice(0, 120),
            }))
            .filter((row) => row.dialectCode.length > 0 && row.spelling.length > 0),
          previousDialects: form
            .getAll('previousDialectCode')
            .map((code, index) => ({
              dialectCode: String(code).trim(),
              spelling: String(form.getAll('previousDialectSpelling')[index] ?? '').trim().slice(0, 120),
            }))
            .filter((row) => row.dialectCode.length > 0 && row.spelling.length > 0),
          note: text('note', 1000) || null,
        },
      });
      // Back to the entry, told that its edit is queued.
      return redirectTo(`/word/${languageUrlSlug(language)}/${encodeURIComponent(text('previousHeadword', 120))}`, {
        suggested: String(result.id),
      });
    }

    if (kind === 'name_edit') {
      const nameId = Number(text('nameId', 20));
      /*
       * Variants arrive one per field, so the form can submit each with its own hidden input and
       * keep the order the page shows. They are also accepted as one comma-separated line, because
       * that is how the form asks a person to type them.
       */
      const many = form.getAll('variants').map((value) => String(value).trim()).filter(Boolean);
      const fromLine = many
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean);
      const previousVariants = form
        .getAll('previousVariants')
        .map((value) => String(value).trim())
        .filter(Boolean);
      const result = await submitSuggestion(db, current.account.id, {
        kind: 'name_edit',
        language,
        targetWordId: null,
        payload: {
          nameId,
          previousName: text('previousName', 120),
          previousMeaning: text('previousMeaning', 1000),
          previousGender: text('previousGender', 20),
          previousVariants,
          name: text('name', 120),
          meaning: text('meaning', 1000),
          gender: text('gender', 20),
          variants: fromLine,
          note: text('note', 1000) || null,
        },
      });
      return redirectTo(`/names/${encodeURIComponent(text('previousName', 120))}`, {
        suggested: String(result.id),
      });
    }

    if (kind === 'clan_edit') {
      const clanId = Number(text('clanId', 20));
      /*
       * The lists arrive as repeated hidden fields, one per value, so a town name containing a comma
       * is not split in two. The textarea fields also accept a comma or newline separated line, and
       * both are flattened into the same array.
       */
      const lines = (name: string) =>
        form
          .getAll(name)
          .flatMap((value) => String(value).split(/[,\n]/))
          .map((value) => value.trim())
          .filter((value) => value.length > 0);
      const paragraphs = (name: string) =>
        form
          .getAll(name)
          .flatMap((value) => String(value).split(/\n\s*\n/))
          .map((value) => value.trim())
          .filter((value) => value.length > 0);

      const result = await submitSuggestion(db, current.account.id, {
        kind: 'clan_edit',
        language,
        targetWordId: null,
        payload: {
          clanId,
          previousName: text('previousName', 120),
          previousOrigin: text('previousOrigin', 4000),
          previousDescription: paragraphs('previousDescription'),
          previousStates: lines('previousState'),
          previousLgas: lines('previousLga'),
          previousTowns: lines('previousTown'),
          name: text('name', 120),
          origin: text('origin', 4000),
          description: paragraphs('description'),
          states: lines('state'),
          lgas: lines('lga'),
          towns: lines('town'),
          note: text('note', 1000) || null,
        },
      });
      return redirectTo(`/clans/${encodeURIComponent(text('previousSlug', 120))}`, {
        suggested: String(result.id),
      });
    }

    /*
     * The three things a contributor can add that are not words. Each is its own branch rather than
     * one generic one, because each lands in a different table with different required fields, and a
     * branch that guessed would have to be told which table it was writing to anyway.
     */
    if (kind === 'new_clan') {
      /*
       * Divisions and local government areas arrive as free text, one per line, because the person
       * filling the form knows the name of the place and not our slugs. An unknown value is not an
       * error: the server resolves what it can and leaves the rest out.
       */
      const lines = (name: string) =>
        String(form.get(name) ?? '')
          .split(/[,\n]/)
          .map((value) => value.trim())
          .filter((value) => value.length > 0);
      const paragraphs = (name: string) =>
        String(form.get(name) ?? '')
          .split(/\n\s*\n/)
          .map((value) => value.trim())
          .filter((value) => value.length > 0);

      const result = await submitSuggestion(db, current.account.id, {
        kind: 'new_clan',
        // A clan is not a thing in a language, so it carries no language code and no word target.
        language: undefined,
        targetWordId: null,
        payload: {
          name: text('name', 120),
          kind: text('entryKind', 20) || 'clan',
          division: text('division', 120) || null,
          origin: text('origin', 600) || null,
          description: paragraphs('description'),
          states: lines('states'),
          lgas: lines('lgas'),
          towns: lines('towns'),
          note: text('note', 1000) || null,
        },
      });
      return redirectTo('/contribute', { submitted: String(result.id) });
    }

    if (kind === 'new_name') {
      const result = await submitSuggestion(db, current.account.id, {
        kind: 'new_name',
        language,
        targetWordId: null,
        payload: {
          name: text('name', 120),
          meaning: text('meaning', 600) || null,
          gender: text('gender', 20) || 'unisex',
          variants: text('variants', 600)
            .split(',')
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
          origins: text('origins', 600)
            .split(/[,\n]/)
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
          note: text('note', 1000) || null,
        },
      });
      return redirectTo('/contribute', { submitted: String(result.id) });
    }

    if (kind === 'new_dialect') {
      const result = await submitSuggestion(db, current.account.id, {
        kind: 'new_dialect',
        language,
        targetWordId: null,
        payload: {
          code: text('code', 24),
          name: text('name', 120),
          nativeName: text('nativeName', 120) || null,
          region: text('region', 120) || null,
          note: text('note', 1000) || null,
        },
      });
      return redirectTo('/contribute', { submitted: String(result.id) });
    }

    if (kind === 'new_proverb') {
      const result = await submitSuggestion(db, current.account.id, {
        kind: 'new_proverb',
        language,
        targetWordId: null,
        payload: {
          text: text('text', 600),
          translation: text('translation', 600) || null,
          note: text('note', 1000) || null,
        },
      });
      return redirectTo('/contribute', { submitted: String(result.id) });
    }

    if (kind === 'correction') {
      const result = await submitSuggestion(db, current.account.id, {
        kind: 'correction',
        language,
        targetWordId: text('wordId', 20) ? Number(text('wordId', 20)) : null,
        payload: {
          headword: text('headword', 120) || null,
          note: text('note', 1000),
        },
      });
      return redirectTo('/contribute', { submitted: String(result.id) });
    }

    return redirectTo('/contribute', { error: 'Choose what kind of contribution this is.' });
  } catch (error) {
    if (error instanceof ContributionError) {
      return redirectTo('/contribute', { error: error.message });
    }
    console.error('[contributions]', error);
    return redirectTo('/contribute', { error: 'Could not record that submission.' });
  }
}
