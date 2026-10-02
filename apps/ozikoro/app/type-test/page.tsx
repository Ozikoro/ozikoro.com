import type { Metadata } from 'next';

/*
 * The typography specimen, ported from the design's `type-test.html`.
 *
 * WHY THIS PAGE EXISTS AND IS NOT DECORATION
 *
 * The archive is written in Igbo as well as English, and Igbo needs characters most web fonts either lack or
 * render badly: the dotted vowels `ị ọ ụ`, the velar nasal `ṅ`, and the combination that breaks first — **a
 * dotted vowel carrying a tone mark, where the mark must sit above and the dot below with neither clipped.**
 * A typeface that fails that turns `ọ́` into `ọ` or into a box, and a reader of Igbo is then reading a
 * different word. So this is the design's own test of its own fonts, kept because it states a hard constraint.
 *
 * NOTHING HERE IS SAMPLE CONTENT. The characters are the characters and the sizes are the sizes the site
 * uses. There is nothing to substitute and nothing to leave empty.
 */
export const metadata: Metadata = {
  title: 'Typography',
  description:
    'The typeface test for Ozikoro: dotted vowels, tone marks, and the marked dotted vowels that usually break.',
  robots: { index: false, follow: false },
};

export default function TypeTestPage() {
  return (
    <main className="wrap-narrow section">
      <p className="eyebrow">Hard constraint 1</p>
      <h1>The typeface must carry Igbo properly</h1>
      <p className="lede">
        Noto Serif (headings, long-form) and Noto Sans (interface) both cover Latin Extended Additional.
        Everything below is rendered in the fonts the site actually loads.
      </p>

      <section>
        <h2>Dotted vowels and ñ — serif, all weights, roman and italic</h2>
        <div className="stack">
          <p><span className="mono small muted">regular</span> <span lang="ig">Ị ị Ọ ọ Ụ ụ Ñ ñ</span></p>
          <p><span className="mono small muted">semibold</span> <strong lang="ig">Ị ị Ọ ọ Ụ ụ Ñ ñ</strong></p>
          <p><span className="mono small muted">bold</span> <b lang="ig">Ị ị Ọ ọ Ụ ụ Ñ ñ</b></p>
          <p><span className="mono small muted">italic</span> <em lang="ig">Ị ị Ọ ọ Ụ ụ Ñ ñ</em></p>
          <p><span className="mono small muted">bold italic</span> <strong><em lang="ig">Ị ị Ọ ọ Ụ ụ Ñ ñ</em></strong></p>
          <p><span className="mono small muted">12px</span> <span lang="ig" style={{ fontSize: '12px' }}>Ị ị Ọ ọ Ụ ụ Ñ ñ</span></p>
        </div>
      </section>

      <section>
        <h2>Tone marks — sans, all weights</h2>
        <div className="stack">
          <p lang="ig">à á è é ì í ò ó ù ú · À Á È É Ì Í Ò Ó Ù Ú</p>
          <p><strong lang="ig">à á è é ì í ò ó ù ú</strong></p>
          <p><b lang="ig">à á è é ì í ò ó ù ú</b></p>
          <p><em lang="ig">à á è é ì í ò ó ù ú</em></p>
          <p className="mono" lang="ig">À Á È É Ì Í Ò Ó Ù Ú</p>
        </div>
      </section>

      <section>
        <h2>Marked dotted vowels — the combination that usually breaks</h2>
        <p className="small muted">
          A dotted vowel carrying a tone mark: the mark sits above, the dot below, and neither is clipped.
          This is the line that decides whether the typeface is usable for Igbo or merely close.
        </p>
        <div className="stack">
          <p lang="ig">ị̀ ị́ ọ̀ ọ́ ụ̀ ụ́ · Ị̀ Ị́ Ọ̀ Ọ́ Ụ̀ Ụ́</p>
          <p lang="ig" style={{ fontSize: '1.125rem' }}>ị̀ ị́ ọ̀ ọ́ ụ̀ ụ́</p>
          <p lang="ig" style={{ fontSize: '12px' }}>ị̀ ị́ ọ̀ ọ́ ụ̀ ụ́</p>
        </div>
      </section>

      <section>
        <h2>Tight leading, stacked marks</h2>
        <p className="small muted">
          Marks that collide at normal leading are the second failure a reader notices, after clipping.
        </p>
        <p lang="ig" style={{ lineHeight: 1.15 }}>
          Ọ̀ bụ̀ ị̀màrà? Ọ̀ dị́ ụ̀bọ̀chị̀ ọ́ bụ́la. Ụ̀mụ̀ ǹwá nà-àzọ́ ahị́a.
        </p>
      </section>

      <section>
        <h2>Running text at the body setting</h2>
        <p lang="ig">
          Ozi Ikòrò na-edekọ akụkọ ihe mere eme, omenala na ọdịnala nke ala Igbo na Anioma. Ederede ọ bụla
          na-egosi ebe o si bịa, ma ọ̀ bụ̀ akwụkwọ, ma ọ̀ bụ̀ ọnụ ndị mmadụ.
        </p>
      </section>

      <section>
        <h2>Monospace — reference numbers and citations</h2>
        <p className="mono">OZ-H-0000 · OZ-H-1042 · OZ-M-3488</p>
        <p className="small muted">
          Reference numbers use a monospace face so a string copied from a citation cannot be misread.
        </p>
      </section>
    </main>
  );
}
