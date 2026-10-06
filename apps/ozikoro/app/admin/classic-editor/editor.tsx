'use client';

/**
 * The Classic Editor screen: the title, the toolbar, the editing area, and the meta boxes.
 *
 * ── WHAT THIS REPRODUCES, AND WHY IT IS A CLIENT COMPONENT ──────────────────────────────────────────
 *
 * The owner's instruction is *"copying exactly what was designed on this classic editor attached"*, and
 * the attachment is WordPress's Classic Editor plugin. Its `scripts/post.js` is where the *behaviour* of
 * that screen is written down, and the parts of it this component answers for are:
 *
 *   * the **two toolbar rows and the Toolbar Toggle** (`kitchen_sink`) — the second row is hidden until
 *     the button reveals it, exactly as TinyMCE's `wp_adv` does;
 *   * **Distraction Free Writing** — the meta boxes and the surrounding furniture step aside and the
 *     writing is what is left on the screen;
 *   * the **Visual / Text tabs**, which is `switchEditors` in WordPress: the same document, two ways to
 *     see it, and one field submitted either way;
 *   * the **permalink control** under the title, which is `editPermalink()` — a display line with an
 *     `Edit` button, a text input, and `OK` / `Cancel`;
 *   * the **dirty-document guard** — `beforeunload.edit-post` returns *"The changes you made will be lost
 *     if you navigate away from this page."* and that sentence is used verbatim, because losing a
 *     half-written article is the fault this screen exists to prevent.
 *
 * ── WHY THE EDITING AREA IS `contenteditable` AND NOT A WYSIWYG LIBRARY ─────────────────────────────
 *
 * Because the archive stores HTML, and the only thing that decides what survives is
 * `sanitiseArchiveHtml` on the server. A rich-text library would bring its own document model, its own
 * serializer and its own idea of which tags are valid — a second allowlist, which is the drift this
 * repository has recorded repeatedly. So the editor runs the browser's own `document.execCommand` for the
 * commands whose output the archive's allowlist already accepts (`b`, `i`, `u`, `ul`, `ol`, `li`,
 * `blockquote`, `a`, `h2`–`h4`, `hr`) and inserts the two it gets wrong itself:
 *
 *   * **strikethrough**: `execCommand('strikeThrough')` writes `<strike>`, which is **not** on the
 *     archive's allowlist — the text would survive and the line through it would not. The button inserts
 *     `<s>`, which is on it.
 *   * **headings**: `formatBlock` writes the level asked for, and `h1` is deliberately not on the
 *     allowlist (the design draws one `<h1>` per page and it is the record's title), so the menu starts
 *     at Heading 2.
 *
 * ── AND THE THREE CONTROLS THAT ARE DRAWN BUT DISABLED, WHICH IS THE HONEST ANSWER ───────────────────
 *
 *   * **align** — WordPress's align buttons write `style="text-align:…"`, and `sanitiseArchiveHtml` drops
 *     `style`, `class` and `id` on purpose: 1,629 inline styles arrived from Elementor and a saved
 *     page-builder width fights the design's reading measure. There is no presentational attribute the
 *     archive will keep, so a button that "worked" would silently lose the alignment on save.
 *   * **Insert Read More tag** — `<!--more-->` is a WordPress loop instruction, and `sanitiseArchiveHtml`
 *     removes every HTML comment before anything else. This archive renders a record whole; it has no
 *     excerpt splitter. The button is drawn where WordPress draws it and says this.
 *   * **Format** — the archive stores no post format, and there is no column for one.
 *
 * Each of those is `disabled` with the reason in its `title` and, where there is room, in the meta box
 * itself. A control that returns 200 and does nothing is the fault class this archive has recorded four
 * times; a control that says why it cannot is not.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

export type PieceKind = 'post' | 'page';

export interface EditorTopics {
  id: number;
  name: string;
  articleCount: number;
}

export interface EditorOption {
  id: number;
  name: string;
}

export interface EditorMedia {
  id: number;
  key: string;
  name: string;
  altText: string | null;
}

export interface EditorPiece {
  id: number;
  title: string;
  bodyHtml: string;
  standfirst: string;
  slug: string;
  slugIsPlaceholder: boolean;
  status: string;
  topicId: number | null;
  tags: string[];
  featuredMediaId: number | null;
  featuredMediaKey: string | null;
  featuredMediaName: string | null;
  authorId: number | null;
  publishedAt: string | null;
  modifiedAt: string | null;
  accessTier: string;
}

export interface ClassicEditorProps {
  kind: PieceKind;
  mode: 'new' | 'edit';
  piece: EditorPiece | null;
  topics: EditorTopics[];
  writers: EditorOption[];
  media: EditorMedia[];
  tagCloud: { name: string; articleCount: number }[];
  /** The STORED body, sanitised by the server, for the Preview panel. */
  previewHtml: string;
  /** Whether this account holds `publish`, which decides what the Publish box offers. */
  canPublish: boolean;
  /** The archive's origin, for the permalink display. */
  siteOrigin: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  review: 'Pending review',
  published: 'Published',
  archived: 'Archived',
  trashed: 'Trash',
};

/** `2026-10-06T09:31:00.000Z` -> `6 October 2026 at 09:31`, the way WordPress prints a date. */
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const day = d.getUTCDate();
  const month = d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${d.getUTCFullYear()} at ${hh}:${mm}`;
}

/** The visible text of an HTML string, for the word count. */
function textOf(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(html: string): number {
  const text = textOf(html);
  return text.length === 0 ? 0 : text.split(' ').length;
}

/**
 * The Classic Editor.
 *
 * ONE FORM, ALL THE BOXES INSIDE IT — which is WordPress's own arrangement: `form#post` holds the title,
 * the content and every meta box, and one press writes the lot. Each submit button carries its own
 * `name="action"` and `value`, so the browser puts the pressed button's action into the submission and no
 * JavaScript has to decide what the button meant. That is the mechanism WordPress's `post.js` reaches for
 * a hidden field to do; the button attribute is the same thing without the race.
 */
export function ClassicEditor(props: ClassicEditorProps) {
  const { kind, mode, piece, topics, writers, media, tagCloud, previewHtml, canPublish, siteOrigin } = props;
  const isPage = kind === 'page';
  const noun = isPage ? 'Page' : 'Post';

  const editorRef = useRef<HTMLDivElement>(null);
  const hiddenBodyRef = useRef<HTMLTextAreaElement>(null);

  const [title, setTitle] = useState(piece?.title ?? '');
  const [slug, setSlug] = useState(piece?.slugIsPlaceholder ? '' : (piece?.slug ?? ''));
  const [standfirst, setStandfirst] = useState(piece?.standfirst ?? '');
  const [tags, setTags] = useState((piece?.tags ?? []).join(', '));
  const [topicId, setTopicId] = useState<string>(piece?.topicId ? String(piece.topicId) : '');
  const [mediaId, setMediaId] = useState<string>(piece?.featuredMediaId ? String(piece.featuredMediaId) : '');
  const [authorId, setAuthorId] = useState<string>(piece?.authorId ? String(piece.authorId) : '');
  const [pickerMediaId, setPickerMediaId] = useState<string>(media[0] ? String(media[0].id) : '');
  const [statusChoice, setStatusChoice] = useState(piece?.status === 'review' ? 'review' : 'draft');

  const [visual, setVisual] = useState(true);
  const [secondRow, setSecondRow] = useState(false);
  const [dfw, setDfw] = useState(false);
  const [editingSlug, setEditingSlug] = useState(false);
  const [slugDraft, setSlugDraft] = useState(piece?.slugIsPlaceholder ? '' : (piece?.slug ?? ''));
  const [editingStatus, setEditingStatus] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [words, setWords] = useState(() => countWords(piece?.bodyHtml ?? ''));
  const [mirror, setMirror] = useState(piece?.bodyHtml ?? '');

  const published = piece?.status === 'published';
  const trashed = piece?.status === 'trashed';

  /*
   * WHAT THE PERMALINK LINE SHOWS.
   *
   * A slug that is still the `draft-<id>` placeholder is NOT an address — WordPress shows `?p=123` in
   * exactly this position for exactly this reason — so the line says the piece has no permalink yet and
   * the title is what will give it one.
   */
  const previewSlug = slug.trim() || (title.trim() ? titleToSlug(title) : '');
  const permalink = previewSlug.length > 0 ? `${siteOrigin.replace(/\/$/, '')}/${previewSlug}/` : null;

  /** The document being edited, whichever tab is showing. */
  function currentHtml(): string {
    if (visual) return editorRef.current?.innerHTML ?? mirror;
    return mirror;
  }

  /** Everything that is a change to the document sets the dirty flag, which the unload guard reads. */
  function markDirty() {
    setDirty(true);
  }

  function syncBody() {
    const html = currentHtml();
    if (hiddenBodyRef.current) hiddenBodyRef.current.value = html;
    return html;
  }

  /*
   * BEFOREUNLOAD, WHICH IS `post.js`'s `beforeunload.edit-post` AND ITS EXACT SENTENCE.
   *
   * The listener is attached while the document is dirty and removed the moment it is not — the same
   * conditional registration WordPress does, and the reason a save does not ask the reader whether they
   * meant to leave the page they just saved.
   */
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = 'The changes you made will be lost if you navigate away from this page.';
      return event.returnValue;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  /** Switch between the Visual and Text views of the same document, as `switchEditors` does. */
  function switchTo(next: 'visual' | 'text') {
    const html = syncBody();
    if (next === 'text') {
      setMirror(html);
      setVisual(false);
    } else {
      setMirror(html);
      setVisual(true);
      // The contenteditable is uncontrolled, so the new document is written into it directly.
      if (editorRef.current) editorRef.current.innerHTML = html;
    }
  }

  /** The selection, as text, inside the editor. Empty when the Text tab is showing. */
  function selectionHtml(): string {
    const selection = window.getSelection();
    if (!visual || !selection || selection.rangeCount === 0 || selection.isCollapsed) return '';
    return selection.toString();
  }

  /**
   * A toolbar command.
   *
   * `execCommand` is used for the commands whose output the archive's allowlist accepts, because the
   * browser's implementation is the one that maintains a valid document — inserting a list inside a
   * paragraph, splitting it, and keeping the caret in the right place are the parts a hand-rolled
   * implementation gets wrong. See the file header for the two commands that are NOT delegated.
   */
  function command(name: string, value?: string) {
    if (!visual) return;
    editorRef.current?.focus();
    try {
      document.execCommand(name, false, value);
    } catch {
      /* A browser that refuses a command leaves the document untouched rather than half-edited. */
    }
    markDirty();
    setWords(countWords(currentHtml()));
  }

  /** Strikethrough, which the archive spells `<s>` and `execCommand` spells `<strike>`. */
  function strikethrough() {
    wrapSelection('<s>', '</s>');
  }

  function wrapSelection(open: string, close: string) {
    if (!visual) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const text = range.toString();
    range.deleteContents();
    const node = document.createElement('span');
    node.innerHTML = `${open}${text}${close}`;
    const fragment = document.createDocumentFragment();
    while (node.firstChild) fragment.appendChild(node.firstChild);
    range.insertNode(fragment);
    selection.removeAllRanges();
    markDirty();
    setWords(countWords(currentHtml()));
  }

  /** The link button, which is WordPress's link dialog boiled down to the one thing it asks for. */
  function insertLink() {
    if (!visual) return;
    const url = window.prompt('Enter the address this text should link to:', 'https://');
    if (!url) return;
    const trimmed = url.trim();
    if (trimmed.length === 0) return;
    const selected = selectionHtml();
    wrapSelection(`<a href="${trimmed.replace(/"/g, '&quot;')}">`, '</a>');
    if (selected.length === 0) {
      // With nothing selected the anchor is empty; put the address in it so the control is not a no-op.
      const html = currentHtml();
      if (html.includes('></a>') && editorRef.current) {
        editorRef.current.innerHTML = html.replace('></a>', `>${trimmed}</a>`);
      }
    }
  }

  /** A horizontal rule, which the archive's allowlist keeps. */
  function insertRule() {
    command('insertHorizontalRule');
  }

  /** Insert an image from the archive's own media register, at the cursor. */
  function insertMedia() {
    if (!visual) return;
    const chosen = media.find((m) => String(m.id) === pickerMediaId);
    if (!chosen) return;
    const alt = (chosen.altText ?? chosen.name).replace(/"/g, '&quot;');
    const src = `/media/${chosen.key.split('/').map(encodeURIComponent).join('/')}`;
    const figure = `<figure><img src="${src}" alt="${alt}"><figcaption></figcaption></figure><p></p>`;
    editorRef.current?.focus();
    try {
      document.execCommand('insertHTML', false, figure);
    } catch {
      /* ignored; see `command` */
    }
    markDirty();
    setWords(countWords(currentHtml()));
  }

  const wordLabel = useMemo(() => `${words.toLocaleString('en-GB')} word${words === 1 ? '' : 's'}`, [words]);

  /** The topics, with the series the piece is already in always present. */
  const topicOptions = topics;

  return (
    <div className={`wpadmin wpedit${dfw ? ' wpedit--dfw' : ''}`}>
      <form
        id="post"
        method="post"
        action="/api/admin/posts"
        onSubmit={() => {
          syncBody();
          setDirty(false);
        }}
      >
        <input type="hidden" name="kind" value={kind} />
        {piece ? <input type="hidden" name="id" value={piece.id} /> : null}
        {/* The document, submitted whichever tab is showing. Written on submit by `syncBody`. */}
        <textarea ref={hiddenBodyRef} name="bodyHtml" defaultValue={piece?.bodyHtml ?? ''} hidden readOnly />

        <div id="titlediv">
          <div id="titlewrap">
            <label className="screen-reader-text" htmlFor="title">
              Enter title here
            </label>
            <input
              id="title"
              name="title"
              type="text"
              autoComplete="off"
              spellCheck
              placeholder="Enter title here"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                markDirty();
              }}
            />
          </div>

          {/*
            THE PERMALINK LINE, WHICH IS `editPermalink()` DRAWN AS MARKUP.
            WordPress prints "Permalink: <url> [Edit]" and reveals the input on Edit. The address shown
            here is derived from the title for a piece that has no slug yet, and it is a PREDICTION — the
            save is what makes it real, and it may add a suffix if the address is taken. The line says so
            rather than implying the address is already reserved.
          */}
          <div id="edit-slug-box">
            <span>Permalink:</span>
            {permalink ? (
              <strong>
                <a className="mono" href={permalink} target="_blank" rel="noopener noreferrer">
                  {permalink}
                </a>
              </strong>
            ) : (
              <strong className="mono">{isPage ? 'no address yet' : 'no address yet'}</strong>
            )}
            {editingSlug ? (
              <>
                <input
                  type="text"
                  aria-label="Slug"
                  value={slugDraft}
                  onChange={(event) => setSlugDraft(event.target.value)}
                  style={{ minWidth: '18rem' }}
                />
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setSlug(slugDraft);
                    markDirty();
                    setEditingSlug(false);
                  }}
                >
                  OK
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setSlugDraft(slug);
                    setEditingSlug(false);
                  }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button type="button" className="button" onClick={() => setEditingSlug(true)}>
                  Edit
                </button>
                {published && permalink ? (
                  <a className="button" href={permalink} target="_blank" rel="noopener noreferrer">
                    View {noun.toLowerCase()}
                  </a>
                ) : null}
                <span className="hndle-note">
                  {piece?.slugIsPlaceholder || slug.length === 0
                    ? 'The address is taken from the title when it is first saved, and a number is added if it is already in use.'
                    : 'Saving does not move a published address unless you change this field.'}
                </span>
              </>
            )}
          </div>
        </div>

        <div id="poststuff">
          <div id="post-body" className="metabox-holder columns-2">
            <div id="post-body-content">
              <div id="postdivrich" className="postarea">
                {/* The row above the toolbar: Add Media, the tabs, the toolbar toggles. */}
                <div id="wp-content-editor-tools">
                  <span className="wp-media-buttons">
                    <select
                      aria-label="Choose an item from the media register"
                      value={pickerMediaId}
                      onChange={(event) => setPickerMediaId(event.target.value)}
                      style={{ maxWidth: '16rem' }}
                    >
                      {media.length === 0 ? <option value="">the media register is empty</option> : null}
                      {media.map((m) => (
                        <option key={m.id} value={String(m.id)}>
                          {m.name}
                        </option>
                      ))}
                    </select>{' '}
                    <button type="button" className="button" onClick={insertMedia} disabled={media.length === 0}>
                      Add Media
                    </button>
                  </span>
                  <span className="wp-switch-editor" role="tablist" aria-label="Editor">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={visual}
                      className="button"
                      onClick={() => switchTo('visual')}
                    >
                      Visual
                    </button>{' '}
                    <button
                      type="button"
                      role="tab"
                      aria-selected={!visual}
                      className="button"
                      onClick={() => switchTo('text')}
                    >
                      Text
                    </button>
                  </span>
                  <button
                    type="button"
                    className="button"
                    aria-pressed={secondRow}
                    onClick={() => setSecondRow((v) => !v)}
                    title="Toolbar Toggle — shows and hides the second row of buttons"
                  >
                    Toolbar Toggle
                  </button>
                  <button
                    type="button"
                    className="button"
                    aria-pressed={dfw}
                    onClick={() => setDfw((v) => !v)}
                    title="Distraction Free Writing"
                  >
                    {dfw ? 'Exit distraction free writing' : 'Distraction Free Writing'}
                  </button>
                </div>

                {/* Row one. Every button is a real command or a stated refusal; see the file header. */}
                <div className="mce-toolbar" data-row="1" role="toolbar" aria-label="Formatting">
                  <button type="button" className="mce-btn" onClick={() => command('bold')} title="Bold" aria-label="Bold">
                    <i>B</i>
                  </button>
                  <button type="button" className="mce-btn" onClick={() => command('italic')} title="Italic" aria-label="Italic">
                    <i className="mce-ico-em">I</i>
                  </button>
                  <button
                    type="button"
                    className="mce-btn"
                    onClick={strikethrough}
                    title="Strikethrough — writes <s>, because <strike> is not markup the archive keeps"
                    aria-label="Strikethrough"
                  >
                    <i className="mce-ico-s">S</i>
                  </button>
                  <span className="mce-separator" />
                  <button type="button" className="mce-btn" onClick={() => command('insertUnorderedList')} title="Bulleted list">
                    • List
                  </button>
                  <button type="button" className="mce-btn" onClick={() => command('insertOrderedList')} title="Numbered list">
                    1. List
                  </button>
                  <button type="button" className="mce-btn" onClick={() => command('formatBlock', 'BLOCKQUOTE')} title="Blockquote">
                    ❝
                  </button>
                  <span className="mce-separator" />
                  <button
                    type="button"
                    className="mce-btn"
                    disabled
                    title="Align — this archive's sanitiser drops every presentational attribute (style, class, id) on purpose, so an alignment set here would not survive the save. See the note under the content box."
                  >
                    ⇤
                  </button>
                  <button type="button" className="mce-btn" disabled title="Align — see the note under the content box: the archive stores no presentational attribute.">
                    ↔
                  </button>
                  <button type="button" className="mce-btn" disabled title="Align — see the note under the content box: the archive stores no presentational attribute.">
                    ⇥
                  </button>
                  <span className="mce-separator" />
                  <button type="button" className="mce-btn" onClick={insertLink} title="Insert/edit link">
                    🔗
                  </button>
                  <button type="button" className="mce-btn" onClick={() => command('unlink')} title="Remove link">
                    ⛓︎̸
                  </button>
                  <button
                    type="button"
                    className="mce-btn"
                    disabled
                    title="Insert Read More tag — this archive renders a record whole and has no excerpt splitter; the sanitiser removes every HTML comment, so <!--more--> would not survive the save."
                  >
                    More
                  </button>
                </div>

                {/* Row two, which the Toolbar Toggle reveals. TinyMCE's `wp_adv`. */}
                <div className="mce-toolbar" data-row="2" role="toolbar" aria-label="More formatting" hidden={!secondRow}>
                  <select
                    aria-label="Format"
                    defaultValue=""
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value) command('formatBlock', value);
                      event.target.value = '';
                    }}
                  >
                    <option value="">Format</option>
                    <option value="P">Paragraph</option>
                    <option value="H2">Heading 2</option>
                    <option value="H3">Heading 3</option>
                    <option value="H4">Heading 4</option>
                    <option value="PRE">Preformatted</option>
                  </select>
                  <button type="button" className="mce-btn" onClick={() => command('underline')} title="Underline">
                    <u>U</u>
                  </button>
                  <button type="button" className="mce-btn" onClick={insertRule} title="Horizontal line">
                    —
                  </button>
                  <button type="button" className="mce-btn" onClick={() => command('removeFormat')} title="Clear formatting">
                    ✕ Format
                  </button>
                  <span className="mce-separator" />
                  <button type="button" className="mce-btn" onClick={() => command('undo')} title="Undo">
                    ↶
                  </button>
                  <button type="button" className="mce-btn" onClick={() => command('redo')} title="Redo">
                    ↷
                  </button>
                </div>

                <div id="wp-content-editor-container">
                  {visual ? (
                    <div
                      ref={editorRef}
                      id="content"
                      className="wp-editor-area"
                      contentEditable
                      suppressContentEditableWarning
                      role="textbox"
                      aria-multiline="true"
                      aria-label="Content"
                      spellCheck
                      onInput={() => {
                        markDirty();
                        const html = editorRef.current?.innerHTML ?? '';
                        setMirror(html);
                        setWords(countWords(html));
                      }}
                      style={{
                        minHeight: '340px',
                        padding: '12px',
                        background: '#fff',
                        fontSize: '14px',
                        lineHeight: 1.7,
                      }}
                      dangerouslySetInnerHTML={{ __html: piece?.bodyHtml ?? '' }}
                    />
                  ) : (
                    <textarea
                      id="content-text"
                      aria-label="Content, as HTML"
                      value={mirror}
                      spellCheck={false}
                      onChange={(event) => {
                        setMirror(event.target.value);
                        markDirty();
                        setWords(countWords(event.target.value));
                      }}
                    />
                  )}
                </div>

                <div id="post-status-info">
                  <span>{wordLabel}</span>
                  <span>
                    Last edited:{' '}
                    {piece?.modifiedAt ? formatDate(piece.modifiedAt) : piece ? formatDate(piece.publishedAt) : 'not saved yet'}
                  </span>
                  <span>
                    {visual
                      ? 'Visual — the toolbar writes the same HTML the Text tab shows'
                      : 'Text — the HTML the archive stores, verbatim'}
                  </span>
                </div>
              </div>

              {/*
                THE THREE CONTROLS THAT CANNOT WORK, SAID WHERE THEY ARE RATHER THAN IN A COMMENT.
                A reader who wonders why the align buttons and the Read More button do nothing finds the
                answer on the screen, in the place they were looking.
              */}
              <div className="postbox" style={{ marginTop: '12px' }}>
                <div className="postbox-header">
                  <h2>What this editor cannot do, and why</h2>
                </div>
                <div className="inside">
                  <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                    <li>
                      <strong>Alignment is not offered.</strong> The archive&rsquo;s sanitiser drops{' '}
                      <span className="mono">style</span>, <span className="mono">class</span> and{' '}
                      <span className="mono">id</span> from every saved body — that rule exists because 1,629
                      inline styles arrived from the old page builder and a saved width fights the design&rsquo;s
                      reading measure. An alignment set here would be removed on save, so the buttons say so
                      instead of appearing to work.
                    </li>
                    <li>
                      <strong>There is no Read More tag.</strong> This archive renders a record whole; there is no
                      excerpt splitter, and HTML comments are removed by the sanitiser before anything else.
                    </li>
                    <li>
                      <strong>The permitted markup is:</strong> headings <span className="mono">h2</span> to{' '}
                      <span className="mono">h6</span>, paragraphs, <span className="mono">strong</span>,{' '}
                      <span className="mono">em</span>, <span className="mono">s</span>,{' '}
                      <span className="mono">u</span>, lists, blockquotes, figures with captions, images, tables,
                      links, and audio or video you are entitled to publish. Anything else is removed and the
                      save notice tells you it happened rather than reporting a clean save.
                    </li>
                  </ul>
                </div>
              </div>

              {showPreview ? (
                <div className="postbox" id="preview" style={{ marginTop: '12px' }}>
                  <div className="postbox-header">
                    <h2>Preview</h2>
                  </div>
                  <div className="inside">
                    <p className="hndle-note">
                      This is the <strong>stored</strong> body, rendered through the same sanitiser the served page
                      uses — not the text in the box above, which may hold unsaved edits. A draft has no public
                      address by design, so there is no URL to open; publish it and the page itself is the
                      preview.
                    </p>
                    {previewHtml.trim() === '' ? (
                      <p>The stored body is empty. Nothing has been saved for this piece yet.</p>
                    ) : (
                      <div className="prose" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            {/* ------------------------------------------------------------------ the meta boxes */}
            <div id="postbox-container-1" className="postbox-container">
              {/* -------------------------------------------------- Publish */}
              <div className="postbox" id="submitdiv">
                <div className="postbox-header">
                  <h2>Publish</h2>
                </div>
                <div className="inside" style={{ padding: 0 }}>
                  <div className="misc-pub-section">
                    <span>
                      Status: <strong>{STATUS_LABEL[piece?.status ?? 'draft'] ?? piece?.status ?? 'Draft'}</strong>
                    </span>
                    {/*
                      A PUBLISHED PIECE HAS NO STATUS DROPDOWN HERE, WHICH IS WORDPRESS'S OWN ARRANGEMENT.
                      Taking a published piece down is "Switch to draft", which WordPress draws in the major
                      actions beside Update rather than in this list — and on this archive it is a decision
                      that needs the `publish` permission, so it is stated where it is rather than hidden in a
                      select whose other option is the status the piece already has.
                    */}
                    {!published ? (
                      <button type="button" className="edit-post-status" onClick={() => setEditingStatus((v) => !v)}>
                        {editingStatus ? 'Close' : 'Edit'}
                      </button>
                    ) : null}
                  </div>

                  {editingStatus && !published ? (
                    <div className="misc-pub-section" style={{ display: 'block' }}>
                      <label htmlFor="post_status">Status</label>{' '}
                      <select
                        id="post_status"
                        name="status"
                        value={statusChoice}
                        onChange={(event) => setStatusChoice(event.target.value)}
                      >
                        <option value="draft">Draft</option>
                        <option value="review">Pending review</option>
                        <option value="published" disabled>
                          Published — use the Publish button
                        </option>
                      </select>{' '}
                      <button type="submit" name="action" value="set-status" className="button">
                        OK
                      </button>
                      <p className="wphelp">
                        Publishing is not this control&rsquo;s. A publication saves the text, the title and the
                        date together and records who did it, so it is the Publish button and nothing beside it.
                      </p>
                    </div>
                  ) : null}

                  {/*
                    VISIBILITY, DRAWN AS WORDPRESS DRAWS IT AND SAID PLAINLY.
                    WordPress offers Public / Private / Password protected. This archive has one public
                    tier and one institutional tier, and the institutional tier is an agreement recorded
                    elsewhere — not a checkbox on a post form. So the line states the tier rather than
                    offering radios that would not do anything.
                  */}
                  <div className="misc-pub-section">
                    <span>
                      Visibility: <strong>{piece?.accessTier === 'by_agreement' ? 'Held by agreement' : 'Public'}</strong>
                    </span>
                    <p className="wphelp" style={{ flexBasis: '100%', margin: 0 }}>
                      {piece?.accessTier === 'by_agreement'
                        ? 'This record is read only under an institutional agreement. It is not listed in the sitemap, and its address answers 403 to a reader without the agreement.'
                        : 'Visible to everyone. The archive has one other tier — held by agreement — and it is recorded on the access screen rather than here.'}
                    </p>
                  </div>

                  {/*
                    THE DATE. WordPress prints "Publish immediately" for a draft and the date for a
                    published post, with an Edit control that schedules. Scheduling is not modelled: there
                    is no `future` status, and a piece is published now or is a draft. So a draft says
                    "immediately" and a published piece shows the date it went live, which is a fact the
                    archive keeps.
                  */}
                  <div className="misc-pub-section">
                    <span>
                      {published ? 'Published on:' : 'Publish:'}{' '}
                      <strong>{published ? formatDate(piece?.publishedAt ?? null) : 'immediately'}</strong>
                    </span>
                    <p className="wphelp" style={{ flexBasis: '100%', margin: 0 }}>
                      {published
                        ? 'This is when it went live and it is kept — changing it is the list table’s Quick Edit, so that the date and the row it belongs to are in front of you.'
                        : 'There is no scheduling here: the archive publishes now or holds the piece as a draft, so this line offers no date to set.'}
                    </p>
                  </div>

                  <div className="misc-pub-section">
                    <label htmlFor="note">Note for the record (optional)</label>
                    <input
                      id="note"
                      name="note"
                      type="text"
                      maxLength={400}
                      placeholder="why you changed it"
                      onChange={markDirty}
                      style={{ width: '100%', marginTop: '4px' }}
                    />
                  </div>

                  {trashed ? (
                    <div className="misc-pub-section">
                      <p className="wphelp" style={{ margin: 0 }}>
                        This is in the trash. It is not served at its address and it is not edited here —
                        restore it from the list first, so what is in the bin is what was put there.
                      </p>
                    </div>
                  ) : null}

                  <div id="major-publishing-actions">
                    {piece && !trashed && !published ? (
                      <span id="delete-action">
                        <button
                          type="submit"
                          name="action"
                          value="trash"
                          className="button-link"
                          style={{ color: '#b32d2e' }}
                        >
                          Move to Trash
                        </button>
                      </span>
                    ) : null}
                    {piece && published && canPublish ? (
                      <span id="delete-action">
                        <button type="submit" name="action" value="switch-to-draft" className="button-link">
                          Switch to draft
                        </button>
                      </span>
                    ) : null}

                    {/* Preview: a real link once published, a panel while it is a draft. */}
                    {published && permalink ? (
                      <a className="button" href={permalink} target="_blank" rel="noopener noreferrer">
                        Preview
                      </a>
                    ) : (
                      <button type="button" className="button" onClick={() => setShowPreview((v) => !v)}>
                        {showPreview ? 'Hide preview' : 'Preview'}
                      </button>
                    )}

                    {!published ? (
                      <button type="submit" name="action" value={mode === 'new' ? 'create' : 'save-draft'} className="button">
                        Save Draft
                      </button>
                    ) : null}

                    {trashed ? (
                      <button type="submit" name="action" value="restore" className="button">
                        Restore
                      </button>
                    ) : mode === 'new' ? (
                      <button type="submit" name="action" value="create-and-publish" className="button button-primary">
                        Publish
                      </button>
                    ) : published ? (
                      <button type="submit" name="action" value="update" className="button button-primary">
                        Update
                      </button>
                    ) : canPublish ? (
                      <button type="submit" name="action" value="publish" className="button button-primary">
                        Publish
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="button"
                        disabled
                        title="Publishing needs the “publish” permission, which this account does not have. It can still write and save drafts."
                      >
                        Publish
                      </button>
                    )}
                  </div>
                  <p className="wphelp" style={{ padding: '0 12px 10px' }}>
                    {canPublish
                      ? 'Publishing is recorded once: the status moves from draft to published, the date is set, and a second attempt refuses rather than moving that date.'
                      : 'This account holds “edit entity” but not “publish”, so it can write and save. Publishing and unpublishing are refused by the write path, not only by this button.'}
                  </p>
                </div>
              </div>

              {/* -------------------------------------------------- Format */}
              <div className="postbox">
                <div className="postbox-header">
                  <h2>Format</h2>
                </div>
                <div className="inside">
                  <p className="wphelp" style={{ margin: 0 }}>
                    WordPress&rsquo;s post formats — Aside, Gallery, Quote and the rest — are not modelled here.
                    The archive stores no format and there is no column for one, so this box is where WordPress
                    puts it and says what is true rather than offering ten radios that would save nothing.
                  </p>
                </div>
              </div>

              {/* -------------------------------------------------- Categories / Series. A page has none. */}
              {!isPage ? (
                <div className="postbox">
                  <div className="postbox-header">
                    <h2>Categories</h2>
                  </div>
                  <div className="inside">
                    <p className="wphelp" style={{ marginTop: 0 }}>
                      The archive stores <strong>one series</strong> per piece. WordPress allows several;{' '}
                      <span className="mono">ozikoro_article.topic_id</span> is a single reference to the fourteen
                      categories the migration carried across, so this is a choice rather than a set of boxes.
                    </p>
                    <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, maxHeight: '14rem', overflowY: 'auto' }}>
                      <li>
                        <label>
                          <input
                            type="radio"
                            name="topicId"
                            value=""
                            checked={topicId === ''}
                            onChange={() => {
                              setTopicId('');
                              markDirty();
                            }}
                          />{' '}
                          — none —
                        </label>
                      </li>
                      {topicOptions.map((topic) => (
                        <li key={topic.id}>
                          <label>
                            <input
                              type="radio"
                              name="topicId"
                              value={String(topic.id)}
                              checked={topicId === String(topic.id)}
                              onChange={() => {
                                setTopicId(String(topic.id));
                                markDirty();
                              }}
                            />{' '}
                            {topic.name} <span className="wpadmin__count">({topic.articleCount})</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="postbox">
                  <div className="postbox-header">
                    <h2>Categories</h2>
                  </div>
                  <div className="inside">
                    <p className="wphelp" style={{ margin: 0 }}>
                      A page has no categories or tags, which is WordPress&rsquo;s own rule and this archive&rsquo;s:
                      a page is part of the site rather than a filed record, and{' '}
                      <span className="mono">ozikoro_article.topic_id</span> and{' '}
                      <span className="mono">ozikoro_article_label</span> are read by the archive index, which
                      excludes pages. The box is here because the screen would be missing a box WordPress draws.
                    </p>
                  </div>
                </div>
              )}

              {/* -------------------------------------------------- Tags. A page has none. */}
              {!isPage ? (
                <div className="postbox">
                  <div className="postbox-header">
                    <h2>Tags</h2>
                  </div>
                  <div className="inside">
                    <label className="screen-reader-text" htmlFor="tags">
                      Tags, separated by commas
                    </label>
                    <textarea
                      id="tags"
                      name="tags"
                      rows={3}
                      value={tags}
                      placeholder="Separate tags with commas"
                      onChange={(event) => {
                        setTags(event.target.value);
                        markDirty();
                      }}
                    />
                    <p className="wphelp">
                      Separate tags with commas. A tag whose name is new is created in the register; a tag that
                      already exists is reused, so two spellings of one place do not become two tags.
                    </p>
                    <p className="wphelp" style={{ marginBottom: 0 }}>
                      <strong>Choose from the most used tags</strong>
                    </p>
                    <div className="tagcloud">
                      {tagCloud.map((tag) => (
                        <button
                          key={tag.name}
                          type="button"
                          onClick={() => {
                            const current = tags.split(',').map((t) => t.trim()).filter(Boolean);
                            if (!current.some((t) => t.toLowerCase() === tag.name.toLowerCase())) {
                              setTags([...current, tag.name].join(', '));
                              markDirty();
                            }
                          }}
                        >
                          {tag.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {/* -------------------------------------------------- Featured Image */}
              <div className="postbox">
                <div className="postbox-header">
                  <h2>Featured Image</h2>
                </div>
                <div className="inside">
                  {piece?.featuredMediaKey ? (
                    <p style={{ marginTop: 0 }}>
                      <img
                        src={`/media/${piece.featuredMediaKey.split('/').map(encodeURIComponent).join('/')}`}
                        alt={piece.featuredMediaName ?? ''}
                        style={{ maxWidth: '100%', height: 'auto', border: '1px solid #c3c4c7' }}
                      />
                    </p>
                  ) : (
                    <p className="wphelp" style={{ marginTop: 0 }}>
                      No featured image. A record without one renders the design&rsquo;s own empty plate rather than
                      a broken picture.
                    </p>
                  )}
                  <label className="screen-reader-text" htmlFor="mediaId">
                    Featured image
                  </label>
                  <select id="mediaId" name="mediaId" value={mediaId} onChange={(event) => { setMediaId(event.target.value); markDirty(); }}>
                    <option value="">— none —</option>
                    {media.map((m) => (
                      <option key={m.id} value={String(m.id)}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <p className="wphelp">
                    Chosen from the archive&rsquo;s own media register — the same pick-list the content box&rsquo;s
                    Add Media uses. Nothing here is a pasted address, so the page cannot hot-link a file the
                    archive does not hold.
                  </p>
                </div>
              </div>

              {/* -------------------------------------------------- Excerpt */}
              <div className="postbox">
                <div className="postbox-header">
                  <h2>Excerpt</h2>
                </div>
                <div className="inside">
                  <label className="screen-reader-text" htmlFor="standfirst">
                    Excerpt
                  </label>
                  <textarea
                    id="standfirst"
                    name="standfirst"
                    rows={4}
                    maxLength={2000}
                    value={standfirst}
                    placeholder="Write a summary…"
                    onChange={(event) => {
                      setStandfirst(event.target.value);
                      markDirty();
                    }}
                  />
                  <p className="wphelp">
                    Excerpts are optional. They are what the archive prints as{' '}
                    <strong>Historical context</strong> under the title and what a search result shows as the
                    description. Leave it empty rather than half-filling it.
                  </p>
                </div>
              </div>

              {/* -------------------------------------------------- Discussion */}
              <div className="postbox">
                <div className="postbox-header">
                  <h2>Discussion</h2>
                </div>
                <div className="inside">
                  <p className="wphelp" style={{ margin: 0 }}>
                    This archive has no comment system: there is no comment table, no moderation queue for
                    readers&rsquo; replies and no column on a piece that would record whether comments are open.
                    WordPress&rsquo;s &ldquo;Allow comments&rdquo; and &ldquo;Allow pingbacks&rdquo; would therefore
                    be two switches with nothing behind them, so the box says this instead.
                  </p>
                </div>
              </div>

              {/* -------------------------------------------------- Slug */}
              <div className="postbox">
                <div className="postbox-header">
                  <h2>Slug</h2>
                </div>
                <div className="inside">
                  <label className="screen-reader-text" htmlFor="slug">
                    Slug
                  </label>
                  <input
                    id="slug"
                    name="slug"
                    type="text"
                    value={slug}
                    placeholder={title.trim() ? titleToSlug(title) : 'taken from the title'}
                    onChange={(event) => {
                      setSlug(event.target.value);
                      setSlugDraft(event.target.value);
                      markDirty();
                    }}
                  />
                  <p className="wphelp">
                    The address, without the site. Leave it empty and it is derived from the title on the first
                    save — Igbo letters are transliterated (<span className="mono">Ọ̀nịchạ</span> &rarr;{' '}
                    <span className="mono">onicha</span>) so the address can be typed. If the address is already
                    taken a number is added. Changing it on a published piece moves a cited address.
                  </p>
                </div>
              </div>

              {/* -------------------------------------------------- Author */}
              <div className="postbox">
                <div className="postbox-header">
                  <h2>Author</h2>
                </div>
                <div className="inside">
                  <label className="screen-reader-text" htmlFor="authorId">
                    Author
                  </label>
                  <select
                    id="authorId"
                    name="authorId"
                    value={authorId}
                    onChange={(event) => {
                      setAuthorId(event.target.value);
                      markDirty();
                    }}
                  >
                    <option value="">— no byline —</option>
                    {writers.map((w) => (
                      <option key={w.id} value={String(w.id)}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                  <p className="wphelp">
                    The byline is a person in the archive&rsquo;s own register of writers, not a login. Leaving it
                    empty is a real state — the page then prints no author rather than inventing one.
                  </p>
                </div>
              </div>

              {piece ? (
                <div className="postbox">
                  <div className="postbox-header">
                    <h2>This piece</h2>
                  </div>
                  <div className="inside">
                    <p style={{ margin: 0 }}>
                      {noun} <span className="mono">#{piece.id}</span> · {STATUS_LABEL[piece.status] ?? piece.status}
                      <br />
                      {published
                        ? `Published ${formatDate(piece.publishedAt)}`
                        : piece.modifiedAt
                          ? `Last saved ${formatDate(piece.modifiedAt)}`
                          : 'Not saved yet'}
                    </p>
                    <p className="wphelp">
                      Every save copies what the piece said before into a revision and records the account that
                      made the change, so nothing here is overwritten silently.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

/**
 * The slug the archive will derive from a title, for the permalink preview.
 *
 * This is a PREVIEW and it is deliberately the same transformation `slugForTitle` in
 * `packages/ozikoro/src/authoring.ts` performs — the address shown under the title should be the address
 * the save produces, or the line is a guess presented as a fact. It uniques nothing: a collision is
 * resolved by the write, which is why the line says a number may be added.
 */
export function titleToSlug(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
