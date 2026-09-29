/**
 * Reference data seeding.
 *
 * Reference data is generated from two sources of truth rather than typed by
 * hand into SQL:
 *
 *   1. `@ozituma/core`'s language registry — so the set of languages the
 *      database knows about can never drift from the set the application
 *      knows about.
 *   2. `seed-data/igbo-reference.json` — Igbo's 48 dialects, 21 grammar
 *      classes and 7 form categories, adapted from the Igbo API constants.
 *      The reference implementation hardcodes these as TypeScript enums; here
 *      they become rows keyed by language_code, which is exactly the
 *      generalisation Ozikoro's technical scope asks for.
 *
 * Everything here is idempotent, so `npm run seed` is safe to re-run.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGLISH, LANGUAGES, type LanguageDefinition } from '@ozituma/core';
import type { Db } from './client.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED_DATA = join(HERE, '..', 'seed-data');

interface IgboReference {
  dialects: { code: string; name: string }[];
  partsOfSpeech: { code: string; name: string; description?: string }[];
  formTypes: { code: string; name: string }[];
}

/**
 * Part-of-speech categories that apply to every language. Language-specific
 * sets (Igbo's active/medial/passive verb distinction, for example) are seeded
 * per language on top of these.
 */
const UNIVERSAL_PARTS_OF_SPEECH = [
  { code: 'NNC', name: 'Noun', abbreviation: 'n.', sort: 10 },
  { code: 'PRN', name: 'Pronoun', abbreviation: 'pron.', sort: 20 },
  { code: 'VRB', name: 'Verb', abbreviation: 'v.', sort: 30 },
  { code: 'ADJ', name: 'Adjective', abbreviation: 'adj.', sort: 40 },
  { code: 'ADV', name: 'Adverb', abbreviation: 'adv.', sort: 50 },
  { code: 'PRE', name: 'Preposition', abbreviation: 'prep.', sort: 60 },
  { code: 'CJN', name: 'Conjunction', abbreviation: 'conj.', sort: 70 },
  { code: 'INT', name: 'Interjection', abbreviation: 'interj.', sort: 80 },
  { code: 'NUM', name: 'Numeral', abbreviation: 'num.', sort: 90 },
  { code: 'PRT', name: 'Particle', abbreviation: 'part.', sort: 100 },
  { code: 'IDM', name: 'Idiom', abbreviation: 'idiom', sort: 110 },
  { code: 'PHR', name: 'Phrase', abbreviation: 'phr.', sort: 120 },
  { code: 'UNK', name: 'Unclassified', abbreviation: '—', sort: 999 },
];

const UNIVERSAL_FORM_TYPES = [
  { code: 'plural', name: 'Plural', sort: 10 },
  { code: 'diminutive', name: 'Diminutive', sort: 20 },
  { code: 'agentive', name: 'Agentive noun', sort: 30 },
  // Alternate spellings that are not dialect-attributed — the Igbo API
  // corpus's `variations` array maps onto this.
  { code: 'variant', name: 'Variant spelling', sort: 40 },
];

/**
 * Attribution records for every corpus we import from. These are not
 * documentation — the API returns them with each entry, because both
 * CC-BY-4.0 and Apache-2.0 require attribution to travel with the work.
 */
const SOURCES = [
  {
    slug: 'igbo-api',
    name: 'Igbo API (nkowaokwu/igbo_api)',
    url: 'https://github.com/nkowaokwu/igbo_api',
    license: 'Apache-2.0',
    licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
    attribution:
      'Igbo dialect, grammar and tense reference data adapted from the Igbo API (nkowaokwu/igbo_api), used under the Apache License 2.0.',
    citation:
      'Ijemma Onwuzulike et al., "The IgboAPI Dataset: Empowering Igbo Language Technologies through Multi-dialectal Enrichment", arXiv:2405.00997.',
    notes:
      'Provides the Igbo headword corpus (8,223 entries), dialect enumeration and grammar classifications.',
  },
  {
    slug: 'ibo-dict',
    name: 'Igbo Dictionary audio corpus (nkowaokwu/ibo-dict)',
    url: 'https://huggingface.co/datasets/nkowaokwu/ibo-dict',
    license: 'CC-BY-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution:
      'Audio pronunciations from the nkowaokwu/ibo-dict dataset, used under CC BY 4.0. Contains 25,500 dialectal word recordings and 25,000 sentence recordings contributed by Igbo speakers.',
    citation:
      'Ijemma Onwuzulike et al., "The IgboAPI Dataset: Empowering Igbo Language Technologies through Multi-dialectal Enrichment", arXiv:2405.00997.',
    notes: 'Gated on Hugging Face; requires an access token to download.',
  },
  {
    slug: 'ibo-dict-expansion',
    name: 'Igbo Dictionary expansion corpus (nkowaokwu/ibo-dict-expansion)',
    url: 'https://huggingface.co/datasets/nkowaokwu/ibo-dict-expansion',
    license: 'CC-BY-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution:
      'Additional Igbo audio recordings from the nkowaokwu/ibo-dict-expansion dataset, used under CC BY 4.0.',
    notes: 'Gated on Hugging Face; requires an access token to download.',
  },
  {
    slug: 'iwaju-yoruba-dictionary',
    name: 'English-Yoruba Dictionary (IwajuAI)',
    url: 'https://huggingface.co/datasets/IwajuAI/English-Yoruba-Dictionary',
    license: 'Apache-2.0',
    licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
    attribution:
      'Yoruba vocabulary from the IwajuAI English-Yoruba Dictionary, used under the Apache License 2.0. ' +
      'The source is an English-to-Yoruba word list; Ozituma inverts it so each Yoruba term becomes a headword.',
    notes:
      'Inverted on import: the source maps English words to Yoruba translations, so each Yoruba term becomes ' +
      'a headword with the English word as its gloss. Entries whose translation field is corrupted by OCR ' +
      'artefacts are rejected rather than imported.',
  },
  {
    slug: 'blench-ekpeye',
    name: 'A Dictionary of Ekpeye (Blench 2013, after Clark and Williamson)',
    url: 'https://archive.org/details/ekpeyedictionary',
    license: 'UNRESOLVED',
    licenseUrl: null,
    attribution:
      'Ekpeye vocabulary from Roger Blench, "A Dictionary of Ekpeye: An Igboid Language of Southern ' +
      'Nigeria" (Cambridge, 2013), based on manuscripts by David Clark and Kay Williamson.',
    notes:
      'LICENCE UNRESOLVED — no licence or rights statement on the source. Imported as draft, so it is not ' +
      'served publicly pending clearance. Treated as a DIALECT OF IGBO rather than a separate language, ' +
      'which follows the source itself: Blench titles it "an Igboid language of Southern Nigeria", and the ' +
      'dialect code EKP already came from the Igbo API list. Ekpeye entries therefore carry ' +
      "language_code 'ibo' and an EKP word_dialect row, so they appear inside the Igbo dictionary as one of " +
      'its dialects, not beside it.',
  },
  {
    slug: 'gambia-wolof',
    name: 'Wollof-English Dictionary (Gambia resource page)',
    url: 'https://resourcepage.gambia.dk/ftp/wollof.pdf',
    license: 'UNRESOLVED',
    licenseUrl: null,
    attribution:
      'Wolof vocabulary from a Wollof-English dictionary published as a public resource for The Gambia. ' +
      'Rights status is unresolved.',
    notes:
      'LICENCE UNRESOLVED, and the text needed recovery. The PDF has a text layer in which every glyph is ' +
      'encoded 29 code points below its true value, so it extracts as real letters that are simply the ' +
      'wrong ones. scripts/decode-shifted-text.ts reverses the offset. Imported as draft: not served ' +
      'publicly until the rights holder is identified and an editor reviews the text.',
  },
  {
    slug: 'gambia-mandinka',
    name: 'Mandinka-English Dictionary (Gambia resource page)',
    url: 'https://resourcepage.gambia.dk/ftp/mandinka.pdf',
    license: 'UNRESOLVED',
    licenseUrl: null,
    attribution:
      'Mandinka vocabulary from a Mandinka-English dictionary published as a public resource for The Gambia. ' +
      'Rights status is unresolved.',
    notes:
      'LICENCE UNRESOLVED, and the text needed recovery: the same +29 glyph offset as the Gambia Wolof ' +
      'dictionary. Imported as draft, not served publicly pending clearance and review.',
  },
  {
    slug: 'ukere-urhobo',
    name: 'Urhobo Dictionary (Ukere 1986, web edition Blench 2005)',
    url: 'http://www.urhobo.net/Resources/UrhoboDictionary.pdf',
    license: 'UNRESOLVED',
    licenseUrl: null,
    attribution:
      'Urhobo vocabulary from Anthony Obakponovwe Ukere, "Urhobo Dictionary" (1986), ' +
      'typed by George Sider for Kay Williamson and edited for the web by Roger Blench (2005). ' +
      'Rights status is unresolved.',
    notes:
      'LICENCE UNRESOLVED. A 1986 locally published Nigerian print dictionary, re-typed and ' +
      'republished on urhobo.net with no licence statement. Imported as draft so it is NOT served ' +
      'publicly: entries stay out of the API and the site until permission is obtained from the ' +
      'rights holder and the text is reviewed by an Urhobo speaker. Do not publish this source ' +
      'without clearance.',
  },
  // Entries that did not come from an upstream corpus still need a source row,
  // or the "every headword names a source" invariant becomes meaningless and
  // attribution silently stops describing reality. These two record the honest
  // provenance: written by our editors, or contributed by the community and
  // verified by an editor.
  {
    slug: 'ozituma-editorial',
    name: 'Ozituma editorial',
    url: null,
    license: 'CC-BY-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution:
      'Written or verified by the Ozituma editorial team and published under CC BY 4.0.',
    notes:
      'Used for entries created or corrected in the review queue rather than imported from an upstream corpus.',
  },
  {
    slug: 'ozituma-community',
    name: 'Ozituma community contributions',
    url: null,
    license: 'CC-BY-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution:
      'Contributed by Ozituma community members and approved by an editor, published under CC BY 4.0.',
    notes:
      'Contributors retain credit for their submission; the reviewing editor is recorded on the suggestion row.',
  },
];

const TAGS = [
  { slug: 'common', name: 'Common word', kind: 'status' },
  { slug: 'greeting', name: 'Greeting', kind: 'domain' },
  { slug: 'proverb', name: 'Proverb', kind: 'domain' },
  { slug: 'kinship', name: 'Kinship', kind: 'domain' },
  { slug: 'agriculture', name: 'Agriculture', kind: 'domain' },
  { slug: 'archaic', name: 'Archaic', kind: 'register' },
  { slug: 'borrowed', name: 'Borrowed', kind: 'register' },
  { slug: 'christian', name: 'Christian usage', kind: 'register' },
  { slug: 'traditional', name: 'Traditional religion', kind: 'domain' },
];

/**
 * Plan limits.
 *
 * This table exists to fix a specific, documented failure in the reference
 * implementation: igboapi.com advertises 500 requests/day on its free Starter
 * tier and 2,500/day on Team, but its `authorizeDeveloperUsage` middleware
 * applies a flat 2,500/day to every tier because it never reads the
 * developer's plan. Rather than repeat that, Ozituma resolves the limit from
 * this table at request time, so the number in the pricing copy and the number
 * enforced are the same row.
 *
 * Resolution order per request: (plan, endpoint) wins, else (plan, '*').
 */
const PLAN_LIMITS: { plan: string; endpoint: string; daily: number; monthly: number | null }[] = [
  // Free: generous enough to build a real project against, capped enough to
  // protect the database.
  { plan: 'free', endpoint: '*', daily: 1_000, monthly: 20_000 },
  { plan: 'free', endpoint: 'translate', daily: 50, monthly: 1_000 },
  { plan: 'free', endpoint: 'speech_to_text', daily: 20, monthly: 400 },

  // Team: the paid tier, matching what the pricing page advertises.
  { plan: 'team', endpoint: '*', daily: 50_000, monthly: 1_000_000 },
  { plan: 'team', endpoint: 'translate', daily: 5_000, monthly: 100_000 },
  { plan: 'team', endpoint: 'speech_to_text', daily: 1_000, monthly: 20_000 },

  // Institution: universities and research partners. No monthly ceiling.
  { plan: 'institution', endpoint: '*', daily: 500_000, monthly: null },
];

const PLAN_FEATURES: { plan: string; feature: string; enabled: boolean }[] = [
  { plan: 'free', feature: 'dictionary_api', enabled: true },
  { plan: 'free', feature: 'audio_download', enabled: false },
  { plan: 'free', feature: 'bulk_export', enabled: false },
  { plan: 'free', feature: 'commercial_use', enabled: true },
  { plan: 'team', feature: 'dictionary_api', enabled: true },
  { plan: 'team', feature: 'audio_download', enabled: true },
  { plan: 'team', feature: 'bulk_export', enabled: true },
  { plan: 'team', feature: 'commercial_use', enabled: true },
  { plan: 'institution', feature: 'dictionary_api', enabled: true },
  { plan: 'institution', feature: 'audio_download', enabled: true },
  { plan: 'institution', feature: 'bulk_export', enabled: true },
  { plan: 'institution', feature: 'commercial_use', enabled: true },
  { plan: 'institution', feature: 'research_export', enabled: true },
];

async function upsertLanguage(db: Db, language: LanguageDefinition, sortOrder: number): Promise<void> {
  await db.query(
    `insert into language
       (code, url_slug, name, native_name, direction, family, countries, scripts, tier,
        marks_tone, speaker_count, sort_order)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     on conflict (code) do update set
       url_slug      = excluded.url_slug,
       name          = excluded.name,
       native_name   = excluded.native_name,
       direction     = excluded.direction,
       family        = excluded.family,
       countries     = excluded.countries,
       scripts       = excluded.scripts,
       tier          = excluded.tier,
       marks_tone    = excluded.marks_tone,
       speaker_count = excluded.speaker_count,
       sort_order    = excluded.sort_order`,
    [
      language.code,
      language.urlSlug,
      language.name,
      language.nativeName,
      language.direction,
      language.family,
      language.countries,
      language.scripts,
      language.tier,
      language.marksTone,
      language.speakers,
      sortOrder,
    ]
  );
}

/**
 * Upsert into a table whose natural key includes a NULLable language_code.
 * A plain `on conflict` cannot target our expression index conveniently, so we
 * do an explicit update-then-insert, which is portable and obvious.
 */
async function upsertScoped(
  db: Db,
  table: 'part_of_speech' | 'form_type',
  languageCode: string | null,
  code: string,
  name: string,
  extra: { abbreviation?: string; description?: string; sort?: number }
): Promise<void> {
  const columns =
    table === 'part_of_speech'
      ? '(language_code, code, name, abbreviation, description, sort_order)'
      : '(language_code, code, name, description, sort_order)';
  const values =
    table === 'part_of_speech'
      ? [languageCode, code, name, extra.abbreviation ?? '—', extra.description ?? null, extra.sort ?? 100]
      : [languageCode, code, name, extra.description ?? null, extra.sort ?? 100];

  const updated = await db.query(
    `update ${table}
        set name = $3,
            sort_order = $4
      where code = $2
        and language_code is not distinct from $1
      returning id`,
    [languageCode, code, name, extra.sort ?? 100]
  );

  if (updated.rowCount > 0) {
    // Refresh the non-key descriptive columns too.
    if (table === 'part_of_speech') {
      await db.query(
        `update part_of_speech set abbreviation = $3, description = $4
          where code = $2 and language_code is not distinct from $1`,
        [languageCode, code, extra.abbreviation ?? '—', extra.description ?? null]
      );
    } else {
      await db.query(
        `update form_type set description = $3
          where code = $2 and language_code is not distinct from $1`,
        [languageCode, code, extra.description ?? null]
      );
    }
    return;
  }

  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
  await db.query(`insert into ${table} ${columns} values (${placeholders})`, values);
}

export async function seedReferenceData(db: Db): Promise<void> {
  console.log('Seeding reference data\n');

  // --- Languages -----------------------------------------------------------
  let sort = 10;
  for (const language of LANGUAGES) {
    await upsertLanguage(db, language, sort);
    sort += 10;
  }
  // English is a definition language, not a target language, but definitions
  // and translations reference it as a foreign key.
  await upsertLanguage(db, ENGLISH, 900);
  const languageCount = await db.one<{ n: string }>(`select count(*)::text as n from language`);
  console.log(`  languages            ${languageCount?.n}`);

  // --- Igbo reference data -------------------------------------------------
  const igbo = JSON.parse(
    await readFile(join(SEED_DATA, 'igbo-reference.json'), 'utf8')
  ) as IgboReference;

  for (const dialect of igbo.dialects) {
    await db.query(
      `insert into dialect (language_code, code, name)
       values ('ibo', $1, $2)
       on conflict (language_code, code) do update set name = excluded.name`,
      [dialect.code, dialect.name]
    );
  }
  console.log(`  igbo dialects        ${igbo.dialects.length}`);

  for (const [index, form] of igbo.formTypes.entries()) {
    await upsertScoped(db, 'form_type', 'ibo', form.code, form.name, { sort: index * 10 + 10 });
  }
  console.log(`  igbo form types      ${igbo.formTypes.length}`);

  // --- Grammar categories --------------------------------------------------
  for (const [index, pos] of UNIVERSAL_PARTS_OF_SPEECH.entries()) {
    await upsertScoped(db, 'part_of_speech', null, pos.code, pos.name, {
      abbreviation: pos.abbreviation,
      sort: pos.sort ?? index * 10,
    });
  }
  for (const [index, pos] of igbo.partsOfSpeech.entries()) {
    // Igbo's own classes (Active/Medial/Passive verb, Name, Demonstrative,
    // Interrogative, ...) sit alongside the universal set, scoped to 'ibo'.
    await upsertScoped(db, 'part_of_speech', 'ibo', pos.code, pos.name, {
      abbreviation: pos.code.toLowerCase(),
      description: pos.description,
      sort: index * 10 + 10,
    });
  }
  const posCount = await db.one<{ n: string }>(`select count(*)::text as n from part_of_speech`);
  console.log(`  grammar categories   ${posCount?.n}`);

  for (const [index, form] of UNIVERSAL_FORM_TYPES.entries()) {
    await upsertScoped(db, 'form_type', null, form.code, form.name, { sort: index * 10 + 100 });
  }

  // --- Attribution sources -------------------------------------------------
  for (const source of SOURCES) {
    await db.query(
      `insert into source (slug, name, url, license_code, license_url, attribution_text, citation, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (slug) do update set
         name             = excluded.name,
         url              = excluded.url,
         license_code     = excluded.license_code,
         license_url      = excluded.license_url,
         attribution_text = excluded.attribution_text,
         citation         = excluded.citation,
         notes            = excluded.notes`,
      [
        source.slug,
        source.name,
        source.url,
        source.license,
        source.licenseUrl ?? null,
        source.attribution,
        source.citation ?? null,
        source.notes ?? null,
      ]
    );
  }
  console.log(`  sources              ${SOURCES.length}`);

  // --- Tags ----------------------------------------------------------------
  for (const tag of TAGS) {
    await db.query(
      `insert into tag (slug, name, kind) values ($1,$2,$3)
       on conflict (slug) do update set name = excluded.name, kind = excluded.kind`,
      [tag.slug, tag.name, tag.kind]
    );
  }
  console.log(`  tags                 ${TAGS.length}`);

  // --- Plan limits and features -------------------------------------------
  for (const limit of PLAN_LIMITS) {
    await db.query(
      `insert into plan_limit (plan, endpoint, daily_limit, monthly_limit)
       values ($1,$2,$3,$4)
       on conflict (plan, endpoint) do update set
         daily_limit = excluded.daily_limit,
         monthly_limit = excluded.monthly_limit`,
      [limit.plan, limit.endpoint, limit.daily, limit.monthly]
    );
  }
  for (const feature of PLAN_FEATURES) {
    await db.query(
      `insert into plan_feature (plan, feature, enabled) values ($1,$2,$3)
       on conflict (plan, feature) do update set enabled = excluded.enabled`,
      [feature.plan, feature.feature, feature.enabled]
    );
  }
  console.log(`  plan limits          ${PLAN_LIMITS.length} (free/team/institution)`);

  console.log('\nReference data seeded.\n');
}
