/**
 * What every page in the dashboard needs to know before it can show a form.
 *
 * Gathered once here rather than in each page, because six pages asking the same four
 * questions of the database is six chances for them to disagree about which language is
 * the default.
 */
import { getDb } from '@ozituma/db/client';
import { listLanguages } from '@ozituma/db/repository';
import { listTribes } from '@ozituma/db/clans';
import { requireLanguage } from '@ozituma/core';

export interface ContributorContext {
  /** Languages that actually hold entries, so a contribution cannot land where nobody reviews it. */
  available: Awaited<ReturnType<typeof listLanguages>>;
  /** The language forms default to. */
  language: { code: string; name: string; nativeName: string };
  divisions: string[];
  dialects: { code: string; name: string }[];
  /** True when no language has any content yet, so the word-shaped forms cannot be used. */
  empty: boolean;
}

export async function contributorContext(): Promise<ContributorContext> {
  const db = await getDb();
  const [languages, tribes] = await Promise.all([listLanguages(db), listTribes(db)]);
  const available = languages.filter((l) => l.wordCount > 0);
  const first = available[0];
  const def = first ? requireLanguage(first.code) : requireLanguage('ibo');
  const dialects = await db.rows<{ code: string; name: string }>(
    `select code, name from dialect where language_code = $1 and is_active order by name`,
    [def.code]
  );
  return {
    available,
    language: { code: def.code, name: def.name, nativeName: def.nativeName ?? def.name },
    divisions: tribes.map((t) => t.name),
    dialects,
    empty: available.length === 0,
  };
}
