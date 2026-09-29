import { AudioButton } from '@/components/audio-button';
import type { LessonBlock, LearnPhrase, LearnVocabItem } from '@ozituma/db/learn';

/**
 * Renders a lesson body.
 *
 * Server component: lesson content is static per request and there is nothing to
 * interact with except the audio buttons, which are their own client component.
 * Keeping the prose on the server means the text a learner reads is in the
 * initial HTML — which matters for a page whose entire value is reading.
 *
 * The `vocab` and `phrases` block types are placement markers: the author writes
 * the prose and says where the word list belongs. That is why this component
 * takes the lists as props rather than reading them itself.
 */

const DICTIONARY_URL = process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com';

/**
 * One vocabulary entry.
 *
 * The Igbo is set larger than the English on purpose. The learner's job is to
 * produce the Igbo, and the English is the prompt; sizing them equally makes the
 * card read as a dictionary definition, which is the opposite of the intent.
 */
function VocabCard({ item }: { item: LearnVocabItem }) {
  return (
    <li className="learn-vocab-card">
      <div className="learn-vocab-head">
        <span className="learn-vocab-igbo">{item.igbo}</span>
        {item.audioUrl ? (
          <AudioButton src={item.audioUrl} label={`Play the recording of ${item.igbo}`} />
        ) : null}
      </div>

      <span className="learn-vocab-english">{item.english}</span>

      <div className="learn-vocab-meta">
        {item.pos ? <span className="chip chip-pos">{item.pos}</span> : null}
        {item.pronunciation ? (
          <span className="learn-pronunciation" title="Say it like this">
            {item.pronunciation}
          </span>
        ) : null}
      </div>

      {item.literal ? (
        <p className="learn-vocab-note">
          Literally <em>{item.literal}</em>.
        </p>
      ) : null}

      {item.note ? <p className="learn-vocab-note">{item.note}</p> : null}

      {item.dictionarySlug ? (
        <a className="learn-vocab-link" href={`${DICTIONARY_URL}/word/${item.dictionarySlug}`}>
          Dictionary entry →
        </a>
      ) : null}
    </li>
  );
}

function VocabList({ vocab }: { vocab: LearnVocabItem[] }) {
  if (vocab.length === 0) return null;
  return (
    <section className="learn-section" aria-labelledby="lesson-vocab">
      <h2 id="lesson-vocab" className="learn-section-title">
        Words in this lesson
      </h2>
      <ul className="learn-vocab-list">
        {vocab.map((item) => (
          <VocabCard key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}

function PhraseList({ phrases }: { phrases: LearnPhrase[] }) {
  if (phrases.length === 0) return null;
  return (
    <section className="learn-section" aria-labelledby="lesson-phrases">
      <h2 id="lesson-phrases" className="learn-section-title">
        Say it
      </h2>
      <ul className="learn-phrase-list">
        {phrases.map((phrase) => (
          <li key={phrase.id} className="learn-phrase">
            <div className="learn-phrase-head">
              <span className="learn-phrase-igbo">{phrase.igbo}</span>
              {phrase.audioUrl ? (
                <AudioButton src={phrase.audioUrl} label={`Play: ${phrase.igbo}`} />
              ) : null}
            </div>
            <span className="learn-phrase-english">{phrase.english}</span>
            {phrase.pronunciation ? (
              <span className="learn-pronunciation">{phrase.pronunciation}</span>
            ) : null}
            {phrase.note ? <p className="learn-vocab-note">{phrase.note}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Block({
  block,
  vocab,
  phrases,
}: {
  block: LessonBlock;
  vocab: LearnVocabItem[];
  phrases: LearnPhrase[];
}) {
  switch (block.type) {
    case 'paragraph':
      return <p className="learn-prose">{block.text}</p>;

    case 'heading':
      return <h2 className="learn-section-title">{block.text}</h2>;

    case 'grammar':
      return (
        <section className="learn-grammar">
          <h3 className="learn-grammar-title">{block.title}</h3>
          <p className="learn-prose">{block.text}</p>
          {block.examples?.length ? (
            <ul className="learn-examples">
              {block.examples.map((example) => (
                <li key={example.igbo} className="learn-example">
                  <span className="learn-example-igbo">{example.igbo}</span>
                  <span className="learn-example-english">{example.english}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      );

    case 'table':
      return (
        <figure className="learn-table-figure">
          {block.title ? <figcaption className="learn-table-title">{block.title}</figcaption> : null}
          <div className="learn-table-scroll">
            <table className="learn-table">
              <thead>
                <tr>
                  {block.columns.map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, index) => (
                  <tr key={index}>
                    {row.map((cell, cellIndex) =>
                      // The first cell is the label of the row, so it is a header
                      // cell — which also lets it be styled as the anchor the eye
                      // returns to. The other cells are the content.
                      cellIndex === 0 ? (
                        <th key={cellIndex} scope="row">
                          {cell}
                        </th>
                      ) : (
                        <td key={cellIndex}>{cell}</td>
                      )
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </figure>
      );

    case 'dialogue':
      return (
        <section className="learn-dialogue">
          {block.title ? <h3 className="learn-grammar-title">{block.title}</h3> : null}
          <ol className="learn-dialogue-lines">
            {block.lines.map((line, index) => (
              <li key={index} className="learn-dialogue-line">
                <span className="learn-dialogue-speaker">{line.speaker}</span>
                <span className="learn-dialogue-body">
                  <span className="learn-dialogue-igbo">{line.igbo}</span>
                  <span className="learn-dialogue-english">{line.english}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      );

    case 'tip':
    case 'note':
      return (
        <aside className={`learn-callout learn-callout-${block.type}`}>
          <strong className="learn-callout-title">
            {block.title ?? (block.type === 'tip' ? 'Tip' : 'Worth knowing')}
          </strong>
          <p className="learn-callout-text">{block.text}</p>
        </aside>
      );

    case 'vocab':
      return <VocabList vocab={vocab} />;

    case 'phrases':
      return <PhraseList phrases={phrases} />;

    default:
      // parseLessonBody rejects unknown types on the way in, so this is
      // unreachable for stored content. Returning null rather than throwing
      // means a lesson written by a newer version of the schema degrades to
      // missing one block instead of failing the whole page.
      return null;
  }
}

export function LessonBody({
  blocks,
  vocab,
  phrases,
}: {
  blocks: LessonBlock[];
  vocab: LearnVocabItem[];
  phrases: LearnPhrase[];
}) {
  if (blocks.length === 0) {
    return (
      <p className="muted">
        This lesson has no written content yet. Its vocabulary is still listed below.
      </p>
    );
  }

  return (
    <div className="learn-body">
      {blocks.map((block, index) => (
        // Blocks have no ids and no natural key. The index is stable for a given
        // lesson body, and the list is never reordered in place — a change to the
        // body is a new import, which re-renders the whole page anyway.
        <Block key={index} block={block} vocab={vocab} phrases={phrases} />
      ))}
    </div>
  );
}

/** Rendered by the lesson page, which owns the heading and the navigation. */
export { VocabList as LessonVocabList, PhraseList as LessonPhraseList };
