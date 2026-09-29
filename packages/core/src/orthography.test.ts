/**
 * The orthography layer is the load-bearing generalisation in Ozituma, so it
 * gets real assertions against real words from several languages — not Igbo
 * alone. Run with: npm -w @ozituma/core test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveForms,
  toExactForm,
  toSearchForm,
  slugify,
  tokenize,
  tidy,
} from './orthography.ts';
import { requireLanguage, getLanguage, LANGUAGES } from './languages.ts';

const igbo = requireLanguage('ibo');
const yoruba = requireLanguage('yor');

test('searchForm strips every diacritic so tone-blind typing still matches', () => {
  // Igbo: àkwà (bed) and ákwá (cry) must share a search key.
  assert.equal(toSearchForm('àkwà', igbo), 'akwa');
  assert.equal(toSearchForm('ákwá', igbo), 'akwa');
  // Underdot letters fold too, so "oria" finds ọria.
  assert.equal(toSearchForm('ọria', igbo), 'oria');
  assert.equal(toSearchForm('ịhụnanya', igbo), 'ihunanya');
  assert.equal(toSearchForm('ụlọ', igbo), 'ulo');
  // ṅ is a dot ABOVE and must still fold.
  assert.equal(toSearchForm('ṅ', igbo), 'n');
  assert.equal(toSearchForm('ọ́nụ', igbo), 'onu');
});

test('exactForm keeps letter-defining marks but drops tone', () => {
  // Tone goes: àkwà -> akwa, ákwá -> akwa.
  assert.equal(toExactForm('àkwà', igbo), 'akwa');
  assert.equal(toExactForm('ákwá', igbo), 'akwa');
  // The underdot stays, because ọ is a different letter from o.
  assert.equal(toExactForm('ọria', igbo), 'ọria');
  assert.equal(toExactForm('ọ́ria', igbo), 'ọria');
  assert.equal(toExactForm('ịhụnanya', igbo), 'ịhụnanya');
  // Dot above (U+0307) is also letter-defining: ṅ is Igbo's velar nasal letter.
  assert.equal(toExactForm('ṅnụ', igbo), 'ṅnụ');
  // But an ACUTE accent on a syllabic nasal is tone, not letter identity —
  // so it goes, while the underdot on the following vowel stays.
  assert.equal(toExactForm('ńnụ', igbo), 'nnụ');
  assert.equal(toSearchForm('ńnụ', igbo), 'nnu');
});

test('exactForm distinguishes words that searchForm deliberately merges', () => {
  // This is the whole reason both forms exist.
  assert.notEqual(toExactForm('ọria', igbo), toExactForm('oria', igbo));
  assert.equal(toSearchForm('ọria', igbo), toSearchForm('oria', igbo));
});

test('the same rules work for Yoruba without any code change', () => {
  assert.equal(toSearchForm('ọmọ', yoruba), 'omo');
  assert.equal(toExactForm('ọmọ', yoruba), 'ọmọ');
  assert.equal(toSearchForm('ẹ̀kọ́', yoruba), 'eko');
  assert.equal(toExactForm('ẹ̀kọ́', yoruba), 'ẹkọ');
  // ṣ is a distinct Yoruba letter and must survive exactForm.
  assert.equal(toExactForm('ṣe', yoruba), 'ṣe');
  assert.equal(toSearchForm('ṣe', yoruba), 'se');
});

test('apostrophes, dashes and whitespace are normalised consistently', () => {
  // Curly apostrophe from copy-paste must equal the straight one.
  assert.equal(tidy('n\u2019elu'), "n'elu");
  assert.equal(tidy('n\'elu'), "n'elu");
  // Non-breaking / en dash unify.
  assert.equal(tidy('m\u2013eme'), 'm-eme');
  // Collapse runs of whitespace and trim.
  assert.equal(tidy('  ọ   dị  mma  '), 'ọ dị mma');
});

test('deriveForms returns mutually consistent forms', () => {
  const forms = deriveForms('Ọ̀dị́nàlà', igbo);
  // The headword keeps its case, because case is orthographically meaningful
  // in these corpora (Àba the town vs àba the common noun).
  assert.equal(forms.headword, 'Ọ̀dị́nàlà');
  // Both derived keys fold case, so search stays case-insensitive.
  assert.equal(forms.exactForm, 'ọdịnala');
  assert.equal(forms.searchForm, 'odinala');
  // searchForm is always the fully-folded projection of exactForm.
  assert.equal(toSearchForm(forms.exactForm, igbo), forms.searchForm);
});

test('case is preserved in the headword but never in the search keys', () => {
  // The Igbo corpus carries both "Àba" (town) and "àba" (common noun). They
  // must stay two rows, so the headword cannot be lowercased — but a user
  // typing either casing must find both.
  const town = deriveForms('Àba', igbo);
  const common = deriveForms('àba', igbo);
  assert.notEqual(town.headword, common.headword);
  assert.equal(town.searchForm, common.searchForm);
  assert.equal(town.searchForm, 'aba');
  // Both fold to the same search keys: the grave accent is tone, so it goes,
  // and case is folded. Only the stored headword tells them apart.
  assert.equal(town.exactForm, 'aba');
  assert.equal(common.exactForm, 'aba');
  assert.equal(town.exactForm, common.exactForm);

  // And the same for a proper noun that is otherwise identical.
  assert.equal(deriveForms('Igbo', igbo).searchForm, deriveForms('igbo', igbo).searchForm);
});

test('slugify produces stable, URL-safe, diacritic-free slugs', () => {
  assert.equal(slugify('àkwà', igbo), 'akwa');
  assert.equal(slugify('ọria', igbo), 'oria');
  assert.equal(slugify("n'elu", igbo), 'nelu');
  assert.equal(slugify('m na-eme', igbo), 'm-na-eme');
  // Never returns an empty string, even for pure punctuation.
  assert.equal(slugify('!!!', igbo), 'word');
  assert.match(slugify('Ọ̀dị́nàlà', igbo), /^[a-z0-9-]+$/);
});

test('tokenize splits multi-word entries for partial matching', () => {
  assert.deepEqual(tokenize('m na-eme', igbo), ['m', 'na', 'eme']);
  assert.deepEqual(tokenize(' ọ dị mma ', igbo), ['o', 'di', 'mma']);
});

test('every registered language resolves and is internally consistent', () => {
  for (const language of LANGUAGES) {
    assert.equal(getLanguage(language.code)?.code, language.code);
    assert.match(language.code, /^[a-z]{3}$/, `${language.code} must be ISO 639-3 shaped`);
    assert.ok(language.name.length > 0);
    assert.ok(language.nativeName.length > 0);
    assert.ok([1, 2, 3].includes(language.tier));
  }
  // Codes must be unique, or the registry silently loses a language.
  const codes = LANGUAGES.map((l) => l.code);
  assert.equal(new Set(codes).size, codes.length);
});

test('unknown language codes fail loudly rather than silently', () => {
  assert.throws(() => requireLanguage('zzz'), /Unknown language code/);
  assert.equal(getLanguage('zzz'), undefined);
});

test('non-decomposable African letters are left intact', () => {
  // ɛ, ɔ and ʋ are base letters, not accented Latin — nothing should fold them.
  assert.equal(toSearchForm('ɛsɛ', igbo), 'ɛsɛ');
  assert.equal(toSearchForm('ɔdɔ', igbo), 'ɔdɔ');
  // And Hausa hooked letters ḇ / ɗ / ƙ.
  const hausa = requireLanguage('hau');
  assert.equal(toSearchForm('ɗan', hausa), 'ɗan');
});
