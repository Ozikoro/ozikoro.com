import Link from 'next/link';
import { sourceTypeChipClass, sourceTypeLabel, type ArticleSummary } from '@ozikoro/platform';

/**
 * One article as a list entry, in the design's own markup.
 *
 * THE CARD IS THE DESIGN'S, NOT AN INVENTION
 *
 * `archive-index.html` draws each entry as a heading, a paragraph and a row of provenance chips:
 *
 *     <article class="entry">
 *       <h3><a href="article.html">The founding and the four markets of Ǹrì</a></h3>
 *       <p>How the ritual authority of Ǹrì travelled, …</p>
 *       <div class="chips">
 *         <span class="chip chip-place"><span class="k">Place</span> Ǹrì, Anambra</span>
 *         <span class="chip chip-period"><span class="k">Period</span> pre-1500 – 1911</span>
 *         <span class="chip chip-oral"><span class="k">Source</span> Oral history</span>
 *         <span class="chip"><span class="k">Sources</span> 3 attached</span>
 *       </div>
 *     </article>
 *
 * **There is no image and no eyebrow line in that markup, and this component now emits neither.**
 * This is the change the owner asked for in his own words — *"it has no thumbnail, remove it
 * completely"* — and the eyebrow was the served page's own addition, carrying the topic and the
 * publication date where the design carries provenance.
 *
 * A CHIP IS A CLAIM, SO ONLY A RECORDED VALUE GETS ONE
 *
 * The design draws four chips because its four example records have four facts each. **Almost no
 * record in the archive does.** Measured against the served archive: 1,051 published records, of
 * which **55 carry a place** (an entity link of a kind that reads as a place — see
 * `PLACE_ENTITY_KINDS`), **0 carry a period**, **0 carry a source type**, and **0 have a source
 * attached**. So a card built to the four-chip shape could fill one chip on roughly one card in
 * twenty, and nothing at all on the other nineteen.
 *
 * The treatment for the empty ones is **omission, and it is the design's own rule rather than a
 * liberty taken here**: the fourth example card in `archive-index.html` carries three chips, not
 * four, because it has no attached sources to count. The design omits a chip it cannot fill. Copying
 * that is what keeps *"a chip with no value must not be invented, and must not print an empty
 * label"* true at the same time as *"a record with neither should still look like a complete card"* —
 * a card of heading, paragraph and the chips it has is the design's card, not a broken one.
 *
 * **What is NOT done here is as deliberate.** No `Period` chip reading "Not recorded" is stamped on
 * 1,051 cards. The three absent facets are absent **archive-wide**, and the page already states that
 * where it belongs, in the rail, in the archive's own measured words: *"No record in the archive has
 * a period recorded yet. Dating is editorial work, and this filter fills when it is done rather than
 * being approximated now."* Repeating that sentence on every card would turn one honest statement
 * into a thousand identical ones and bury the 55 cards that do have something to say.
 *
 * **The fourth chip, `Sources N attached`, is omitted for the same reason and one of its own.** No
 * record has an attached source to count — `ozikoro_article_source` holds 0 rows against published
 * records — so there is no count to print, and the branch is not written rather than written and
 * left unexercised. The rail says the same thing where it belongs: *"Fully sourced only 0"*.
 *
 * Shared by the archive index, a topic, a label, a contributor's page and folklore, so a reader does
 * not have to relearn what an entry looks like when they move between them.
 *
 * **`showImage` was removed rather than left as a prop that draws nothing.** It had one behaviour —
 * true — which is now the wrong one, so a caller passing it would get a quiet no-op instead of an
 * image. A prop that cannot do what its name says is worse than an absent one.
 */
export function ArticleEntry({ article }: { article: ArticleSummary }) {
  const chips: { className: string; key: string; value: string }[] = [];
  if (article.place) {
    chips.push({ className: 'chip chip-place', key: 'Place', value: article.place });
  }
  if (article.periodLabel) {
    chips.push({ className: 'chip chip-period', key: 'Period', value: article.periodLabel });
  }
  if (article.sourceType) {
    chips.push({
      className: `chip ${sourceTypeChipClass(article.sourceType)}`,
      key: 'Source',
      value: sourceTypeLabel(article.sourceType),
    });
  }

  return (
    <article className="entry">
      <h3>
        <Link href={article.url}>{article.title}</Link>
      </h3>
      {article.standfirst ? <p>{article.standfirst}</p> : null}
      {chips.length > 0 ? (
        <div className="chips">
          {chips.map((chip) => (
            <span className={chip.className} key={`${chip.key}:${chip.value}`}>
              <span className="k">{chip.key}</span> {chip.value}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
