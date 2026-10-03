
/**
 * The article's own words, prepared for speaking.
 *
 * **This is where the archive refuses to dramatise.** The pipeline this was built from asks for scripts
 * rewritten into the tone of a dramatic audiobook — grim maxims, heavy pauses, a chilling closing law. The
 * archive's rules are that nothing is invented and that no generated text is put above primary evidence, and
 * a history rewritten into a menacing register asserts a tone the record does not have **in a way a listener
 * cannot detect**.
 *
 * So each transformation here removes only what cannot be HEARD: markup, figure captions, raw URLs, and the
 * citation brackets a listener cannot follow. **Nothing is reordered, shortened, or added.**
 */
/**
 * The article's words, prepared for speaking.
 *
 * **Every transformation here removes something a listener cannot use. None of them changes a word the article
 * says.** That distinction is the whole function.
 */
export function toSpokenScript(html: string): { script: string; transcript: string } {
  let t = html;

  // Blocks that mean nothing out loud.
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  t = t.replace(/<figure[\s\S]*?<\/figure>/gi, ''); // captions and credits are seen, not heard
  t = t.replace(/<aside[\s\S]*?<\/aside>/gi, '');

  // Headings become sentences, so a heading does not run into the paragraph after it.
  t = t.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_m, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    return text ? `\n\n${text}.\n\n` : '\n\n';
  });

  // Paragraphs and list items become their own lines.
  t = t.replace(/<\/(p|li|blockquote)>/gi, '\n\n');
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<li[^>]*>/gi, '— ');

  // Everything else is markup.
  t = t.replace(/<[^>]+>/g, '');

  // Citation brackets and reference numbers, which cannot be followed by ear.
  t = t.replace(/\[\s*\d+\s*\]/g, '');
  t = t.replace(/\((?:see|cf\.?|ibid\.?)[^)]{0,60}\)/gi, '');
  t = t.replace(/https?:\/\/\S+/g, '');

  // Entities and spacing.
  t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
       .replace(/&#8217;|&rsquo;/g, '’').replace(/&#8216;|&lsquo;/g, '‘')
       .replace(/&#8220;|&ldquo;/g, '“').replace(/&#8221;|&rdquo;/g, '”')
       .replace(/&#8211;|&ndash;/g, '–').replace(/&#8212;|&mdash;/g, '—');
  t = t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  const transcript = t;
  return { script: t, transcript };
}
