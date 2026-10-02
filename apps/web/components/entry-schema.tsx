/**
 * The structured data for a dictionary entry, and for the dictionary itself.
 *
 * WHY A DICTIONARY NEEDS ITS OWN SCHEMA
 *
 * schema.org has types written for exactly this: **`DefinedTermSet` is a dictionary, and `DefinedTerm` is an
 * entry in one.** A page that emits them can be understood as a definition rather than as prose that happens to
 * mention a word — which is the difference between a result that shows a definition and a result that shows a
 * snippet.
 *
 * **The Ozikoro archive emits `Article`; this one emits `DefinedTerm`.** The two sites share a database and an
 * account table, and their structured data should share a vocabulary without pretending to be the same kind of
 * thing. A dictionary entry is not an article and an article is not a definition.
 *
 * WHAT IS OMITTED, AND WHY THAT IS THE POINT
 *
 * Every value comes from the entry. **An entry with no part of speech has no `termCode`; one with no recording
 * has no `audio`.** Nothing is emitted empty, because a property with no value is a claim that the value is
 * empty rather than that it is unknown.
 */
import type { JSONValue } from './json-value.ts';

export type EntrySchemaInput = {
  /** The headword as it is displayed. */
  headword: string;
  /** The language's own name, e.g. `Igbo`. */
  languageName: string;
  /** The language's slug, e.g. `ig`. */
  languageSlug: string;
  /** The entry's address on ozituma.com. */
  url: string;
  /** The glosses, in order. The first becomes the definition. */
  glosses: string[];
  /** The part of speech, where one is recorded. */
  partOfSpeech?: string | null;
  /** An audio file for the headword, where one exists. */
  audioUrl?: string | null;
  /** Dialect or variety, where recorded. */
  dialect?: string | null;
};

export function EntrySchema({ entry }: { entry: EntrySchemaInput }) {
  const graph: Record<string, JSONValue>[] = [
    {
      '@type': 'Organization',
      '@id': 'https://ozituma.com/#organization',
      name: 'Ozi Ikoro Limited',
      url: 'https://ozituma.com/',
      // The three sites are one publisher. Saying so is what lets an index connect them.
      sameAs: ['https://ozikoro.com/', 'https://learn.ozituma.com/'],
    },
    {
      '@type': 'WebSite',
      '@id': 'https://ozituma.com/#website',
      url: 'https://ozituma.com/',
      name: 'Ozituma',
      publisher: { '@id': 'https://ozituma.com/#organization' },
      inLanguage: 'en',
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: 'https://ozituma.com/search?q={search_term_string}' },
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'DefinedTermSet',
      '@id': `https://ozituma.com/languages/${entry.languageSlug}/#termset`,
      name: `Ozituma ${entry.languageName} dictionary`,
      url: `https://ozituma.com/languages/${entry.languageSlug}/`,
      inLanguage: entry.languageSlug,
      publisher: { '@id': 'https://ozituma.com/#organization' },
    },
  ];

  const term: Record<string, JSONValue> = {
    '@type': 'DefinedTerm',
    '@id': `${entry.url}#term`,
    name: entry.headword,
    url: entry.url,
    inDefinedTermSet: { '@id': `https://ozituma.com/languages/${entry.languageSlug}/#termset` },
    inLanguage: entry.languageSlug,
  };
  const firstGloss = entry.glosses[0];
  if (firstGloss) term.description = firstGloss;
  if (entry.partOfSpeech) term.termCode = entry.partOfSpeech as string;
  if (entry.dialect) term.alternateName = entry.dialect as string;
  if (entry.audioUrl) term.audio = { '@type': 'AudioObject', contentUrl: entry.audioUrl as string };
  graph.push(term);

  return (
    <script
      type="application/ld+json"
      // The graph is built from the entry, not from user input, and the values are data rather than markup.
      dangerouslySetInnerHTML={{ __html: JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }) }}
    />
  );
}
