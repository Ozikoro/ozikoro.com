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
 * ── AND THE TWO CONTROLS THAT ARE DRAWN BUT DISABLED, WHICH IS THE HONEST ANSWER ────────────────────
 *
 *   * **align** — WordPress's align buttons write `style="text-align:…"`, and `sanitiseArchiveHtml` drops
 *     `style`, `class` and `id` on purpose: 1,629 inline styles arrived from Elementor and a saved
 *     page-builder width fights the design's reading measure. There is no presentational attribute the
 *     archive will keep, so a button that "worked" would silently lose the alignment on save.
 *   * **Insert Read More tag** — `<!--more-->` is a WordPress loop instruction, and `sanitiseArchiveHtml`
 *     removes every HTML comment before anything else. This archive renders a record whole; it has no
 *     excerpt splitter. The button is drawn where WordPress draws it and says this.
 *
 * Each is `disabled` with the reason in its `title`. A control that returns 200 and does nothing is the
 * fault class this archive has recorded four times; a control that says why it cannot is not.
 *
 * ── ADD MEDIA, THE FEATURED IMAGE, AND THE BOXES THAT FOLD ──────────────────────────────────────────
 *
 * **Add Media and Set Featured Image are the same picker** — `./media-picker.tsx` — because the owner asked
 * for the same behaviour on both: *"i should be able to upload new media or select the existing one which
 * will show in thumbnail for me to know what i am selecting."* The control here used to be a `<select>` of
 * forty names, which asked a person to recognise a photograph by its file name; it is now a button that
 * opens a grid of the real register. What the chosen record becomes is decided by the body, on `kind`:
 * the archive's sanitiser keeps `img`, `video`, `audio` and `a`, so a picture becomes a `<figure>`, a film a
 * `<video>`, a recording an `<audio>`, and a document a link to its own address. See `mediaMarkupFor`.
 *
 * **Every box in the right column folds from its title bar** — `./meta-box.tsx` — and remembers that it is
 * folded, which is the owner's *"one should be able to minimise any of them like it works in wordpress"*.
 * The fold is one boolean per box, and the document being edited is not inside any of them: the content box
 * is a sibling in the other column, so a fold cannot touch the typed document, and the seeding effect above
 * survives unchanged.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  TOOLBAR_ROW_1,
  TOOLBAR_ROW_2,
  documentToSubmit,
  switchEditorView,
  type ToolbarControl,
} from '@/lib/classic-editor';
import { bodyLostBeforeSave, visualBoxDocument } from '@/lib/classic-editor-content';
import { MetaBox } from './meta-box';
import { MediaPicker, mediaSrc, type PickerItem } from './media-picker';

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
  /**
   * What the file is: `image`, `video`, `audio`, `document`, `dataset` or `other` (`ozikoro_media.kind`).
   *
   * IT DECIDES THREE THINGS AND ALL THREE ARE VISIBLE: whether the picker draws a picture or a labelled
   * plate, what the chosen record becomes when it is placed in the body, and whether it may be a featured
   * image at all.
   */
  kind: string;
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

  /*
   * THE ONE THING REACT MUST NOT DO TO THE CONTENT BOX, AND HOW THAT IS ENFORCED.
   *
   * `#content` is a contenteditable the browser owns while a person types into it. The first version of this
   * screen gave it `dangerouslySetInnerHTML={{ __html: piece?.bodyHtml ?? '' }}` and set state from its
   * `onInput` — and **on a NEW piece, where that string is empty, React wrote the empty string back over the
   * box on the re-render the input handler caused.** Measured in a browser: one keystroke, or one paste,
   * emptied the box; the mutation observer confirmed the same node was emptied rather than replaced. The
   * body field then submitted `''` and the screen reported "Draft created" over an empty record.
   *
   * So React is given no children and no `dangerouslySetInnerHTML` for this node at all, and the document
   * is written into it **once, when the box appears**, from the effect below. React has nothing to reconcile
   * on the way in, so a re-render cannot touch it — which is also why a toolbar command, an undo and a
   * keystroke all survive a state update now.
   *
   * `pendingVisualHtml` is what keeps the TWO TABS ONE DOCUMENT. The box is a different element every time
   * the Visual tab is shown, so it has to be handed the document on the way back; `switchTo` puts the
   * in-progress document here before it flips the tab, and the effect prefers it to the stored body. Without
   * it, leaving the Text tab would show the reader the body as it was saved and quietly drop their edits.
   */
  const pendingVisualHtml = useRef<string | null>(null);
  /** Set when a submit was refused because the content box had lost what was typed into it. */
  const [lostBody, setLostBody] = useState(false);
  const [title, setTitle] = useState(piece?.title ?? '');
  const [slug, setSlug] = useState(piece?.slugIsPlaceholder ? '' : (piece?.slug ?? ''));
  const [standfirst, setStandfirst] = useState(piece?.standfirst ?? '');
  const [tags, setTags] = useState((piece?.tags ?? []).join(', '));
  const [topicId, setTopicId] = useState<string>(piece?.topicId ? String(piece.topicId) : '');
  const [mediaId, setMediaId] = useState<string>(piece?.featuredMediaId ? String(piece.featuredMediaId) : '');
  /*
   * THE FEATURED IMAGE AS THIS SCREEN KNOWS IT.
   *
   * The server sends the stored record; this is the same five facts with a local override, because a picture
   * chosen in the picker has to appear under the title bar BEFORE the piece is saved. Waiting for the save to
   * show the one thing the box is about would make the control read as a no-op, which is the fault this
   * screen's own history is full of.
   */
  const [featured, setFeatured] = useState<PickerItem | null>(() => {
    if (!piece?.featuredMediaKey) return null;
    const known = media.find((m) => m.id === piece.featuredMediaId);
    return {
      id: piece.featuredMediaId ?? 0,
      key: piece.featuredMediaKey,
      name: piece.featuredMediaName ?? piece.featuredMediaKey,
      altText: known?.altText ?? null,
      kind: known?.kind ?? 'image',
    };
  });
  /** Which picker is open, if any: the one that places media in the body, or the one for the featured image. */
  const [picker, setPicker] = useState<'insert' | 'featured' | null>(null);
  const [authorId, setAuthorId] = useState<string>(piece?.authorId ? String(piece.authorId) : '');
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

  /**
   * The document being edited, whichever tab is showing.
   *
   * `documentToSubmit` answers with the showing tab's document, so the form can never post the mirror —
   * the docstring on it says what that failure looks like.
   */
  function currentHtml(): string {
    return documentToSubmit(visual ? 'visual' : 'text', editorRef.current?.innerHTML ?? mirror, mirror);
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

  /*
   * WRITE THE DOCUMENT INTO THE CONTENT BOX ONCE, WHEN THE BOX APPEARS — AND NEVER AGAIN.
   *
   * This effect is the whole of React's involvement with the contenteditable's contents. It runs when the
   * Visual tab is shown (including the first render) and not when the document changes, because the box is
   * destroyed and re-created by the tab switch and `dangerouslySetInnerHTML` used to be what refilled it —
   * the same prop that emptied it on every keystroke. `visual` is therefore the only dependency on purpose:
   * **adding `mirror` here would put the clobber back**, writing the last-known document over the box a
   * millisecond after each character was typed.
   *
   * The document it writes comes from `switchTo` when the reader is coming back from the Text tab, and from
   * the record the screen was rendered with on first load. Those are the only two ways the box is ever
   * populated, which is what makes the tabs one document rather than two.
   */
  useEffect(() => {
    if (!visual) return;
    const box = editorRef.current;
    if (!box) return;
    box.innerHTML = visualBoxDocument(pendingVisualHtml.current, piece?.bodyHtml ?? '');
    pendingVisualHtml.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see the note above: `mirror` must NOT be here.
  }, [visual]);

  /**
   * Switch between the Visual and Text views of the same document, as `switchEditors` does.
   *
   * The box the Visual tab draws is a NEW element each time, so the document is handed to it through
   * `pendingVisualHtml` and written by the seeding effect below — not here, where `editorRef.current` is
   * still null because React has not committed the new box yet.
   */
  function switchTo(next: 'visual' | 'text') {
    const { view, html } = switchEditorView(next, syncBody());
    setMirror(html);
    if (view === 'visual') pendingVisualHtml.current = html;
    setVisual(view === 'visual');
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

  /**
   * Put two strings around the selection.
   *
   * `execCommand` is used for the commands whose output the archive's allowlist accepts; this is used for
   * the two it gets wrong — strikethrough, which the browser spells `<strike>` and the archive spells
   * `<s>`, and code, which no browser command writes at all.
   */
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

  /**
   * One toolbar entry as markup.
   *
   * A `separator` is the rule WordPress draws between groups; an `unavailable` entry is a real disabled
   * button whose tooltip carries its reason; anything else is a button that runs its entry. **Nothing
   * here can be a button with no behaviour**, because the list it reads from will not hold one.
   */
  function renderControl(control: ToolbarControl) {
    if (control.kind === 'separator') return <span key={control.id} className="mce-separator" />;
    if (control.kind === 'unavailable') {
      return (
        <button key={control.id} type="button" className="mce-btn" disabled title={`${control.title} — ${control.why}.`}>
          {control.label}
        </button>
      );
    }
    return (
      <button
        key={control.id}
        type="button"
        className="mce-btn"
        onClick={() => runControl(control)}
        title={control.title}
      >
        <i className={control.labelClass ?? 'mce-ico-plain'}>{control.label}</i>
      </button>
    );
  }

  /** The link control, once the address has been asked for. */
  function insertLinkAt(url: string) {
    if (!visual) return;
    const selected = selectionHtml();
    wrapSelection(`<a href="${url.replace(/"/g, '&quot;')}">`, '</a>');
    if (selected.length === 0) {
      // With nothing selected the anchor is empty; put the address in it so the control is not a no-op.
      const html = currentHtml();
      if (html.includes('></a>') && editorRef.current) {
        editorRef.current.innerHTML = html.replace('></a>', `>${url}</a>`);
      }
    }
  }

  /**
   * Run one toolbar entry, from the list in `@/lib/classic-editor`.
   *
   * The three kinds are the whole of the toolbar's behaviour, so this is the only place a button's click
   * turns into an edit: a `command` goes to the browser (asking first if the entry carries a question), a
   * `wrap` inserts the two strings the archive keeps, and an `unavailable` entry never reaches here
   * because it is drawn disabled.
   */
  function runControl(control: ToolbarControl) {
    if (control.kind === 'command') {
      if (control.prompt) {
        const answer = window.prompt(control.prompt.message, control.prompt.initial);
        const url = (answer ?? '').trim();
        if (url.length === 0) return;
        insertLinkAt(url);
        return;
      }
      command(control.command, control.value);
      return;
    }
    if (control.kind === 'wrap') wrapSelection(control.open, control.close);
  }

  /**
   * What a chosen register record becomes in the body, per kind.
   *
   * ── WHY THE KIND DECIDES THE MARKUP, RATHER THAN EVERYTHING BECOMING AN `<img>` ─────────────────────
   *
   * The register holds photographs, films, recordings and documents. The old control wrapped every one of
   * them in `<figure><img>`, which for a film was a broken picture — a control that "worked" and produced a
   * fault on the page. The archive's own sanitiser (`ALLOWED_TAGS` / `ALLOWED_ATTRIBUTES` in
   * `packages/ozikoro/src/content.ts`) keeps `img`, `video`, `audio`, `source` and `a` with their `src`, so
   * each kind can be placed honestly with something the served page will actually render:
   *
   *   image           `<figure><img src alt><figcaption></figcaption></figure>`
   *   video           `<figure><video controls src></video><figcaption></figcaption></figure>`
   *   audio           `<figure><audio controls src></audio><figcaption></figcaption></figure>`
   *   document, other a paragraph linking to the file, because a PDF is not a picture and pretending
   *                   otherwise would put a broken `<img>` into a published record
   *
   * `src` is the record's own `storage_key` through `/media/<key>` — never a pasted address, so the page
   * cannot hot-link a file the archive does not hold. `alt` is the record's alternative text when it has
   * one; when it does not, the file's name is used, and the empty `<figcaption>` is left for the writer
   * rather than filled with invented words.
   */
  function mediaMarkupFor(item: PickerItem): string {
    const src = mediaSrc(item.key);
    const name = (item.altText ?? item.name).replace(/</g, '&lt;').replace(/"/g, '&quot;');
    if (item.kind === 'image') {
      return `<figure><img src="${src}" alt="${name}"><figcaption></figcaption></figure><p></p>`;
    }
    if (item.kind === 'video') {
      return `<figure><video controls src="${src}"></video><figcaption>${name}</figcaption></figure><p></p>`;
    }
    if (item.kind === 'audio') {
      return `<figure><audio controls src="${src}"></audio><figcaption>${name}</figcaption></figure><p></p>`;
    }
    return `<p><a href="${src}">${name}</a></p>`;
  }

  /** Place a record from the register at the cursor. */
  function insertMedia(item: PickerItem) {
    setPicker(null);
    if (!visual) {
      /*
       * THE TEXT TAB IS SHOWING, so there is no caret to place anything at. The markup goes into the box at
       * the end rather than nowhere, which is the honest half of the gesture: the writer can see what arrived
       * and move it, instead of a click that did nothing at all.
       */
      const next = `${mirror}${mediaMarkupFor(item)}`;
      setMirror(next);
      markDirty();
      setWords(countWords(next));
      return;
    }
    editorRef.current?.focus();
    try {
      document.execCommand('insertHTML', false, mediaMarkupFor(item));
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
        onSubmit={(event) => {
          const submitting = syncBody();
          /*
           * A SAVE THAT WOULD WRITE NOTHING IS REFUSED HERE, IN FRONT OF THE READER.
           *
           * The measured fault was not only that the box lost its text: the save then posted an empty
           * `bodyHtml` and the screen said "Draft created", which is a success message over a record with
           * nothing in it — the one failure this archive must never produce. The seeding effect above is
           * what stops the box losing text; this is the guard for the day something else does, and it is
           * deliberately the loud kind: the submit is cancelled and the reader is told, rather than a
           * plausible-looking confirmation being printed over an empty draft.
           *
           * The condition is narrow on purpose. An empty body is a legitimate thing to save — WordPress
           * saves an untitled, empty draft — so the refusal is only for the case that cannot be
           * legitimate: the box is empty while the last document React saw typed into it was not.
           */
          if (bodyLostBeforeSave(submitting, mirror, visual)) {
            event.preventDefault();
            setLostBody(true);
            setDirty(false);
            return;
          }
          setLostBody(false);
          setDirty(false);
        }}
      >
        <input type="hidden" name="kind" value={kind} />
        {piece ? <input type="hidden" name="id" value={piece.id} /> : null}
        {/* The document, submitted whichever tab is showing. Written on submit by `syncBody`. */}
        <textarea ref={hiddenBodyRef} name="bodyHtml" defaultValue={piece?.bodyHtml ?? ''} hidden readOnly />

        {/*
          THE REFUSAL IS SHOWN, NOT SWALLOWED. A cancelled submit with no explanation reads as a broken
          button, so the reason is drawn where the reader is looking, in the archive's own notice shape.
        */}
        {lostBody ? (
          <div className="notice notice--error" role="alert">
            <div>
              <p className="notice__title">Nothing has been saved</p>
              <p className="notice__body">
                The content box is empty and the last document written into it was not, so saving now would
                replace the body with nothing. Type or paste it again, or switch to the <strong>Text</strong>{' '}
                tab and check the HTML there — then save. Nothing you had before this screen was changed.
              </p>
            </div>
          </div>
        ) : null}

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
                    {/*
                      THE BUTTON THAT REPLACED THE PICK-LIST.

                      What stood here was a `<select>` of the forty most recent names and a button that
                      inserted whichever was highlighted — a control that asked a person to recognise a
                      photograph by its file name, which is the thing the owner reported. It is now one
                      button that opens the picker: the register shown as thumbnails, searchable, with an
                      Upload door beside the library. See `./media-picker.tsx`.
                    */}
                    <button
                      type="button"
                      className="button"
                      onClick={() => setPicker('insert')}
                      title="Add Media — place a picture, film or recording from the archive's register in the body"
                    >
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

                {/*
                  ROW ONE, RENDERED FROM THE LIST IN `@/lib/classic-editor`.

                  Every entry there is a `command`, a `wrap` or an `unavailable` with its reason, and the
                  type will not accept an entry that says nothing — so a button that is drawn here is a
                  button that does something, or one that is visibly disabled and says why. The test in
                  `lib/classic-editor.test.ts` is what holds the list to the archive's allowlist.
                */}
                <div className="mce-toolbar" data-row="1" role="toolbar" aria-label="Formatting">
                  {/*
                    THE FORMAT MENU, WHICH WORDPRESS PUTS AT THE HEAD OF ROW ONE (`formatselect` is the
                    first entry in its `mce_buttons`). "Preformatted" writes `<pre>`, and the archive's
                    sanitiser now keeps it — see the note on `ALLOWED_TAGS` in `packages/ozikoro/src/content.ts`.
                  */}
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
                  {TOOLBAR_ROW_1.map((control) => renderControl(control))}
                </div>

                {/* Row two, which the Toolbar Toggle reveals. TinyMCE's `wp_adv`. */}
                <div className="mce-toolbar" data-row="2" role="toolbar" aria-label="More formatting" hidden={!secondRow}>
                  {TOOLBAR_ROW_2.map((control) => renderControl(control))}
                </div>

                <div id="wp-content-editor-container">
                  {visual ? (
                    /*
                     * NO `children` AND NO `dangerouslySetInnerHTML`, DELIBERATELY. React must not own this
                     * node's contents: it is a contenteditable the browser and the reader own, and the
                     * document is written into it once by the seeding effect above. See the note on
                     * `pendingVisualHtml` for what the prop did when it was here.
                     */
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
                  {/*
                    WHAT THE TEXT TAB HOLDS, SAID ACCURATELY.
                    
                    It used to say the box held "the HTML the archive stores, verbatim", and that is not
                    true: the document reaches the box by being parsed, so a stored `&quot;` or `&#8220;`
                    shows as the character it names and the line endings are normalised. Measured on record
                    5207 — the column holds 10,745 bytes with 165 `&quot;` tokens, and the box holds the same
                    document at 9,846 bytes. **It is stable, and nothing is lost** (three consecutive saves of
                    it produced byte-identical stored bodies), but a screen that says "verbatim" over a
                    re-serialised document is the kind of claim this archive has had to withdraw before.
                  */}
                  <span>
                    {visual
                      ? 'Visual — the toolbar writes the same HTML the Text tab shows'
                      : 'Text — the document as HTML, parsed by the browser, so a stored entity shows as the character it names. A save writes this box.'}
                  </span>
                </div>
              </div>

              {/*
                THE CONTROLS THAT CANNOT WORK ARE DRAWN DISABLED, AND THE REASON IS IN EACH ONE'S `title`.

                They used to be explained by a meta box headed "What this editor cannot do, and why",
                which put a paragraph about inline styles and HTML comments in front of every editor.
                That is the archive's own reasoning, not the screen's content, and it has been taken off
                the page: a disabled control says it is unavailable, and hovering it says why. Those are
                the alignment buttons (the sanitiser drops `style`, `class` and `id` from every saved
                body) and Insert Read More (this archive renders a record whole, and every HTML comment
                is removed). Neither is a control that pretends to work.
              */}

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
              <MetaBox id="submitdiv" title="Publish" insideStyle={{ padding: 0 }}>
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
              </MetaBox>

              {/* -------------------------------------------------- Categories / Series. A page has none. */}
              {!isPage ? (
                <MetaBox id="categorydiv" title="Categories">
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
                </MetaBox>
              ) : (
                <MetaBox id="categorydiv" title="Categories">
                    <p className="wphelp" style={{ margin: 0 }}>
                      A page has no categories or tags, which is WordPress&rsquo;s own rule and this archive&rsquo;s:
                      a page is part of the site rather than a filed record, and{' '}
                      <span className="mono">ozikoro_article.topic_id</span> and{' '}
                      <span className="mono">ozikoro_article_label</span> are read by the archive index, which
                      excludes pages. The box is here because the screen would be missing a box WordPress draws.
                    </p>
                </MetaBox>
              )}

              {/* -------------------------------------------------- Tags. A page has none. */}
              {!isPage ? (
                <MetaBox id="tagsdiv" title="Tags">
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
                </MetaBox>
              ) : null}

              {/* -------------------------------------------------- Featured Image */}
              <MetaBox id="postimagediv" title="Featured Image">
                  {featured ? (
                    <p style={{ marginTop: 0 }}>
                      <img
                        src={mediaSrc(featured.key)}
                        alt={featured.altText ?? featured.name}
                        style={{ maxWidth: '100%', height: 'auto', border: '1px solid #c3c4c7' }}
                      />
                      <span className="wphelp" style={{ display: 'block', marginTop: '6px' }}>
                        {featured.name}
                      </span>
                    </p>
                  ) : (
                    <p className="wphelp" style={{ marginTop: 0 }}>
                      No featured image. A record without one renders the design&rsquo;s own empty plate rather than
                      a broken picture.
                    </p>
                  )}
                  <p className="row" style={{ gap: '8px', flexWrap: 'wrap' }}>
                    <button type="button" className="button" onClick={() => setPicker('featured')}>
                      {featured ? 'Replace featured image' : 'Set featured image'}
                    </button>
                    {featured ? (
                      <button
                        type="button"
                        className="button"
                        onClick={() => {
                          setFeatured(null);
                          setMediaId('');
                          markDirty();
                        }}
                      >
                        Remove featured image
                      </button>
                    ) : null}
                  </p>
                  {/*
                    THE NAME AND THE VALUE THE WRITE PATH READS ARE UNCHANGED.

                    `/api/admin/posts` reads `form.get('mediaId')` and nothing else, so the field that carried
                    it stays — as a hidden input rather than the `<select>` that stood here, because the
                    choosing now happens in the picker. An empty value is a real state and the route already
                    reads it as "no featured image".
                  */}
                  <input type="hidden" name="mediaId" value={mediaId} readOnly />
                  <p className="wphelp">
                    Chosen from the archive&rsquo;s own media register — the same picker the content box&rsquo;s
                    Add Media opens. Nothing here is a pasted address, so the page cannot hot-link a file the
                    archive does not hold. Only an image record can be a featured image: the article frame draws
                    it with an <span className="mono">&lt;img&gt;</span>.
                  </p>
              </MetaBox>

              {/* -------------------------------------------------- Excerpt */}
              <MetaBox id="excerptdiv" title="Excerpt">
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
              </MetaBox>

              {/* -------------------------------------------------- Discussion */}
              <MetaBox id="commentstatusdiv" title="Discussion">
                  <p className="wphelp" style={{ margin: 0 }}>
                    This archive has no comment system: there is no comment table, no moderation queue for
                    readers&rsquo; replies and no column on a piece that would record whether comments are open.
                    WordPress&rsquo;s &ldquo;Allow comments&rdquo; and &ldquo;Allow pingbacks&rdquo; would therefore
                    be two switches with nothing behind them, so the box says this instead.
                  </p>
              </MetaBox>

              {/* -------------------------------------------------- Slug */}
              <MetaBox id="slugdiv" title="Slug">
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
              </MetaBox>

              {/* -------------------------------------------------- Author */}
              <MetaBox id="authordiv" title="Author">
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
              </MetaBox>

              {piece ? (
                <MetaBox id="pieceinfodiv" title="This piece">
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
                    {/*
                      THE WAY TO THE OTHER HALF OF THE RECORD. The editor writes what the piece SAYS; the
                      archive's own screen — clan, period, source type and citations — writes what it is
                      ABOUT, and it lives at `<id>/record` so that this address is the Classic Editor.
                    */}
                    <p className="wphelp" style={{ marginBottom: 0 }}>
                      <a href={`/admin/archive/${piece.id}/record`}>Clan, period and sources</a>
                    </p>
                </MetaBox>
              ) : null}
            </div>
          </div>
        </div>

        {/*
          THE PICKER, WHICH IS ONE COMPONENT FOR BOTH CONTROLS.

          It is rendered inside the form element here, but it renders itself into `document.body` through a
          portal, so its search box and its file input are outside the form that saves the piece. See the
          note on the portal in `./media-picker.tsx` — a search box whose Enter key saved the article is the
          fault that arrangement exists to prevent.
        */}
        <MediaPicker
          open={picker !== null}
          purpose={picker ?? 'insert'}
          initial={media}
          selectedId={picker === 'featured' && mediaId.length > 0 ? Number(mediaId) : null}
          onChoose={(item) => {
            if (picker === 'featured') {
              setFeatured(item);
              setMediaId(String(item.id));
              markDirty();
              setPicker(null);
              return;
            }
            insertMedia(item);
          }}
          onClose={() => setPicker(null)}
        />
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
