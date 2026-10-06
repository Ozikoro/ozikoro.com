'use client';

/**
 * The media picker: upload a file, or choose an existing record FROM ITS THUMBNAIL.
 *
 * ── WHAT THE OWNER ASKED FOR, IN HIS WORDS ──────────────────────────────────────────────────────────
 *
 * *"on the add media, inside add new post, i should be able to upload new media or select the existing one
 * which will show in thumbnail for me to know what i am selecting. same is said about featured image."*
 *
 * So there are two doors and both are open at once, which is the arrangement his own design draws:
 *
 *   the **drop zone**  takes a file and puts it in the archive's media store through
 *                      `POST /api/admin/media/upload` — drag it in or pick it;
 *   the **grid**       shows the EXISTING register as pictures, with a search over the whole register
 *                      (`GET /api/admin/media`), a selected state you can see, and a count that says how many
 *                      records the register holds rather than how many happen to be on screen.
 *
 * **The same picker answers both controls.** "Add Media" and "Set Featured Image" open this one component with
 * a different `purpose`, which decides the button's label and whether a non-image record can be chosen — a
 * featured image is drawn by the article frame with an `<img>`, so only an image record can be one, and the
 * picker says that instead of offering a film and then failing to render it.
 *
 * ── THE DESIGN THIS COPIES ──────────────────────────────────────────────────────────────────────────
 *
 * The owner's `ozikoro-posts-media-pages-clone.html` draws the panel as
 * `#modal > .modalbox > .modalhead + .modalbody`, with `.insert` a two-column grid: the upload box and
 * `.insertgrid` of `.insertthumb`s on the left, and a `.box`/`.head`/`.body` "Attachment Details" column on the
 * right. **That structure and those class names are reproduced here**, and every field in the details column
 * does something or is not drawn:
 *
 *   Title              READ-ONLY, and it is the record's own name.
 *   Alternative text   EDITABLE, and it is what this placement writes into the piece. A picture with no alt
 *                      text is a picture a screen reader cannot describe, which is the one thing this field
 *                      is for. **The record's own alternative text is a different fact and is edited on the
 *                      record's screen** — the link to it is here rather than a field that pretended to
 *                      change something it does not.
 *   File               READ-ONLY: the kind and the `storage_key` the archive serves.
 *   Alignment          NOT DRAWN. The archive's sanitiser drops `style`, `class` and `id` from every stored
 *                      body — 1,629 inline styles arrived from Elementor and a saved page-builder width
 *                      fights the design's reading measure — so an alignment control could not survive a
 *                      save. See the toolbar's own note in `editor.tsx` for the same rule.
 *   Link to            NOT DRAWN. The placement is a `<figure>` whose picture is the record's own
 *                      `/media/<key>` address; there is no attachment page in this archive to link to.
 *   Size               NOT DRAWN. The archive stores ONE file per media row and generates no intermediate
 *                      sizes, so Full/Large/Medium/Thumbnail would be four names for the same bytes.
 *
 * ── WHY A THUMBNAIL IS A REAL THUMBNAIL ─────────────────────────────────────────────────────────────
 *
 * Every tile is a real `ozikoro_media` row and its picture is fetched from `/media/<storage_key>` — the
 * archive's own media route, the same address the served article uses. **A record whose kind is not an image
 * has no picture and is NOT given a stand-in**: it is drawn as a labelled plate naming its kind and its file,
 * because a broken `<img>` or a stock placeholder would be the archive claiming to hold something it does
 * not. `storage_key is not null` is in the query for the same reason: a row with no file has nothing to show.
 *
 * ── WHY THE PANEL IS IN A PORTAL ────────────────────────────────────────────────────────────────────
 *
 * The whole editing screen is one `<form id="post">`, and this panel contains a file input and a search box.
 * Rendered in place it would be a nested form at best and, at worst, a search box whose Enter key submitted
 * the article. The panel is therefore rendered into `document.body` through a portal, outside the form, so
 * nothing typed or chosen in it can reach the post's submission. The file input carries **no `name`**, so it
 * is not part of any form's payload either.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MediaThumb } from './media-thumb';

export interface PickerItem {
  id: number;
  key: string;
  name: string;
  altText: string | null;
  kind: string;
}

export interface MediaPickerProps {
  open: boolean;
  /** What the chosen record is for: placement in the body, or the piece's featured image. */
  purpose: 'insert' | 'featured';
  /** The rows the screen already has, so the grid is populated before the first fetch answers. */
  initial: PickerItem[];
  /** The record already chosen, so opening the picker shows what is set. */
  selectedId: number | null;
  onChoose: (item: PickerItem) => void;
  onClose: () => void;
}

const KIND_FILTERS: { label: string; kind: string }[] = [
  { label: 'All', kind: '' },
  { label: 'Images', kind: 'image' },
  { label: 'Audio', kind: 'audio' },
  { label: 'Video', kind: 'video' },
  { label: 'Documents', kind: 'document' },
];

const KIND_LABEL: Record<string, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  document: 'Document',
  dataset: 'Dataset',
  other: 'File',
};

/** `/media/<key>`, with each segment encoded — the address `/media/[...key]` serves. */
export function mediaSrc(key: string): string {
  return `/media/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** The largest upload the route will read. Kept beside the text that states it on the screen. */
const MAX_UPLOAD_MB = 20;

/** The types the upload route's byte check accepts, for the file dialog's own filter. */
const ACCEPT =
  'image/jpeg,image/png,image/gif,image/webp,image/avif,video/mp4,video/quicktime,video/webm,' +
  'audio/mpeg,audio/mp4,audio/wav,audio/ogg,application/pdf';

export function MediaPicker({ open, purpose, initial, selectedId, onChoose, onClose }: MediaPickerProps) {
  const [mounted, setMounted] = useState(false);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState(purpose === 'featured' ? 'image' : '');
  const [items, setItems] = useState<PickerItem[]>(initial);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<PickerItem | null>(() =>
    selectedId === null ? null : (initial.find((m) => m.id === selectedId) ?? null)
  );
  /**
   * The file the person picked, held in STATE rather than read from the input when Upload is pressed.
   *
   * The input used to be ref-driven: nothing observed a change, so the audit's "field outside a form …
   * cannot be saved by anything" finding was correct rather than a false positive — a control whose value
   * only existed inside the DOM node. Holding it here also means the file survives the re-render that the
   * read of the register causes.
   */
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [altText, setAltText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  /*
   * OPENING THE PANEL RESETS IT, and pre-selects the record already in use, so "Set Featured Image" opens
   * showing the picture that is set rather than an empty grid.
   */
  useEffect(() => {
    if (!open) return;
    setSearch('');
    setKind(purpose === 'featured' ? 'image' : '');
    setItems(initial);
    setTotal(null);
    setReadError(null);
    setUploadNote(null);
    setUploadError(null);
    setFile(null);
    setDragging(false);
    const already = selectedId === null ? null : (initial.find((m) => m.id === selectedId) ?? null);
    setChosen(already);
    setAltText(already?.altText ?? '');
    const focus = window.setTimeout(() => searchRef.current?.focus(), 40);
    return () => window.clearTimeout(focus);
    // `initial` is a fresh array from the server on every render of the screen, so it is deliberately not a
    // dependency: the panel re-seeds when it OPENS, which is the moment a person can see it happen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, purpose, selectedId]);

  /** Read the register. The search and the kind are the server's, so the whole register is searched. */
  const read = useCallback(async (query: string, kindFilter: string) => {
    setLoading(true);
    setReadError(null);
    try {
      const params = new URLSearchParams({ limit: '60' });
      if (query.trim().length > 0) params.set('search', query.trim());
      if (kindFilter.length > 0) params.set('kind', kindFilter);
      const response = await fetch(`/api/admin/media?${params.toString()}`, {
        headers: { accept: 'application/json' },
      });
      const body = (await response.json().catch(() => null)) as
        | { ok?: boolean; items?: PickerItem[]; total?: number; message?: string }
        | null;
      if (!response.ok || !body?.ok) {
        setReadError(body?.message ?? 'The media register could not be read just now.');
        setItems([]);
        setTotal(0);
        return;
      }
      setItems(Array.isArray(body.items) ? body.items : []);
      setTotal(typeof body.total === 'number' ? body.total : null);
    } catch {
      setReadError('The media register could not be reached just now.');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  // The first read, and then a debounced read on every change of the search or the kind filter.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void read(search, kind), search.length === 0 ? 0 : 250);
    return () => window.clearTimeout(timer);
  }, [open, search, kind, read]);

  // Escape closes the panel, which is the one key a modal must answer.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /** Send one file to the archive's own media route and select what comes back. */
  const upload = useCallback(async (candidate: File) => {
    if (candidate.size === 0) {
      setUploadError('That file is empty, so there is nothing to store.');
      return;
    }
    setUploading(true);
    setUploadError(null);
    setUploadNote(null);
    try {
      const body = new FormData();
      body.append('file', candidate);
      const response = await fetch('/api/admin/media/upload', { method: 'POST', body });
      const answer = (await response.json().catch(() => null)) as
        | { ok?: boolean; item?: PickerItem; message?: string }
        | null;
      if (!response.ok || !answer?.ok || !answer.item) {
        setUploadError(answer?.message ?? 'That file could not be stored, and nothing was added.');
        return;
      }
      const item = answer.item;
      setItems((current) => [item, ...current.filter((m) => m.id !== item.id)]);
      setChosen(item);
      setAltText(item.altText ?? '');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      setUploadNote(`Stored and selected: ${item.name}.`);
    } catch {
      setUploadError('That file could not be sent, and nothing was added.');
    } finally {
      setUploading(false);
    }
  }, []);

  if (!open || !mounted) return null;

  const blocked =
    purpose === 'featured' && chosen !== null && chosen.kind !== 'image'
      ? 'A featured image is drawn by the article frame with an <img>, so only an image record can be it. ' +
        `This record is a ${(KIND_LABEL[chosen.kind] ?? chosen.kind).toLowerCase()}.`
      : null;

  const confirmLabel = purpose === 'insert' ? 'Insert into post' : 'Set featured image';

  return createPortal(
    <div className="modal show" id="modal" role="presentation">
      <div className="modalbox" role="dialog" aria-modal="true" aria-label={purpose === 'insert' ? 'Add media' : 'Set featured image'}>
        <div className="modalhead">
          <b>{purpose === 'insert' ? 'Add Media' : 'Set Featured Image'}</b>
          <button type="button" className="btn small" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modalbody">
          <div className="insert">
            <div>
              {/*
                THE UPLOAD BOX, DRAWN AS THE DESIGN DRAWS IT AND WIRED TO THE ROUTE THAT STORES THE FILE.
                Dropping a file on it and picking one through the dialog are the same act: both end in
                `upload(file)`. A drop zone that only looked like one would be the fault class this screen has
                recorded repeatedly, so the drag handlers are real.
              */}
              <div
                className={`upload${dragging ? ' upload--over' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const dropped = event.dataTransfer?.files?.[0];
                  if (dropped) {
                    setFile(dropped);
                    void upload(dropped);
                  }
                }}
              >
                <strong>Upload Files</strong>
                <span>Drag files here or select from your computer</span>
                <p>
                  <input
                    ref={fileRef}
                    id="media-picker-file"
                    className="visually-hidden"
                    type="file"
                    accept={ACCEPT}
                    onChange={(event) => {
                      const picked = event.target.files?.[0] ?? null;
                      setFile(picked);
                      setUploadError(null);
                      setUploadNote(null);
                    }}
                  />
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? 'Storing…' : 'Select Files'}
                  </button>
                </p>
                {file ? (
                  <p className="meta">
                    {file.name} · {Math.max(1, Math.round(file.size / 1024))} KB
                  </p>
                ) : (
                  <p className="meta">Up to {MAX_UPLOAD_MB} MB. The file&rsquo;s own first bytes are checked.</p>
                )}
                {file ? (
                  <p>
                    <button type="button" className="btn small" onClick={() => void upload(file)} disabled={uploading}>
                      {uploading ? 'Storing…' : 'Upload'}
                    </button>
                  </p>
                ) : null}
              </div>

              {uploadError ? (
                <div className="notice" role="alert" style={{ borderLeftColor: '#d63638', marginTop: '10px' }}>
                  {uploadError}
                </div>
              ) : null}
              {uploadNote ? (
                <div className="notice" style={{ marginTop: '10px' }}>
                  {uploadNote}
                </div>
              ) : null}

              {/*
                SEARCH AND A KIND FILTER, WHICH THE DESIGN'S MODAL DOES NOT DRAW AND WHICH IS NOT OPTIONAL.
                The design's `#modal` shows eight example thumbnails; this register holds thousands of records
                and a grid with no search over it cannot answer "where is the photograph of the Ọ̀nịchạ market".
                Both controls ask the SERVER, so they search the register rather than the sixty rows on screen.
              */}
              <div className="media-controls">
                <input
                  ref={searchRef}
                  className="input"
                  type="search"
                  value={search}
                  placeholder="Search the media register"
                  aria-label="Search the media register"
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    // A search box inside a form submits it on Enter. This panel is in a portal precisely so
                    // that cannot happen, and the key is stopped here as well.
                    if (event.key === 'Enter') event.preventDefault();
                  }}
                />
                <div className="mediamodal__chips" role="group" aria-label="Filter by kind">
                  {KIND_FILTERS.map((filter) => (
                    <button
                      key={filter.label}
                      type="button"
                      className={`btn small${kind === filter.kind ? ' primary' : ''}`}
                      aria-pressed={kind === filter.kind}
                      onClick={() => setKind(filter.kind)}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="insertgrid">
                {readError ? (
                  <p className="mediamodal__empty" style={{ gridColumn: '1 / -1' }} role="alert">
                    {readError}
                  </p>
                ) : items.length === 0 ? (
                  <p className="mediamodal__empty" style={{ gridColumn: '1 / -1' }}>
                    {loading
                      ? 'Reading the register…'
                      : search.trim().length > 0
                        ? `No record in the register matches “${search.trim()}”.`
                        : 'The register holds no record of this kind, so there is nothing to choose.'}
                  </p>
                ) : (
                  items.map((item) => {
                    const isChosen = chosen?.id === item.id;
                    const isImage = item.kind === 'image';
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`insertthumb${isChosen ? ' is-chosen' : ''}`}
                        aria-pressed={isChosen}
                        aria-label={item.name}
                        title={item.name}
                        onClick={() => {
                          setChosen(item);
                          setAltText(item.altText ?? '');
                        }}
                        onDoubleClick={() => {
                          if (purpose === 'featured' && item.kind !== 'image') return;
                          onChoose({ ...item, altText: altText.trim() || item.altText });
                        }}
                      >
                        {isImage ? (
                          // The record's own file at its own /media/<key> address, through `MediaThumb` so a
                          // row whose object is genuinely absent becomes a plate rather than a broken glyph.
                          <MediaThumb
                            src={mediaSrc(item.key)}
                            alt={item.altText ?? ''}
                            label={KIND_LABEL[item.kind] ?? item.kind}
                            file={item.key.split('/').pop() ?? item.key}
                          />
                        ) : (
                          <span className="insertthumb__plate">
                            <strong>{KIND_LABEL[item.kind] ?? item.kind}</strong>
                            <span className="insertthumb__file">{item.key.split('/').pop()}</span>
                          </span>
                        )}
                        {isChosen ? (
                          <span className="insertthumb__check" aria-hidden="true">
                            ✓
                          </span>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/*
              ATTACHMENT DETAILS. Every field is either a real fact about the selected record or a field this
              placement actually writes. Alignment, Link to and Size are named in the design and are NOT drawn
              here: the reasons are at the top of this file, and a disabled control would take the space without
              doing the work.
            */}
            <div className="box" style={{ margin: 0 }}>
              <div className="head">Attachment Details</div>
              <div className="body">
                {chosen ? (
                  <>
                    {/*
                      THE TWO FACTS ABOUT THE CHOICE ARE TEXT, NOT READ-ONLY INPUTS.

                      They were `<input readOnly>` and that is worse twice over: a box that looks editable and
                      refuses the keystroke, and — measured by `scripts/audit-buttons.mjs` — a field with no
                      form, no handler and nothing that could ever carry its value anywhere. **The audit was
                      right about both**, and the fix is to stop drawing a field where a fact belongs. They
                      keep the field's shape so the design's column still reads as a form.
                    */}
                    <span className="label">Title</span>
                    <div className="sidefield sidefield--static">{chosen.name}</div>

                    <span className="label">File</span>
                    <div className="sidefield sidefield--static">
                      {KIND_LABEL[chosen.kind] ?? chosen.kind} · {chosen.key.split('/').pop()}
                    </div>

                    {purpose === 'insert' ? (
                      <>
                        <label className="label" htmlFor="picker-alt">
                          Alternative text
                        </label>
                        <textarea
                          id="picker-alt"
                          className="sidefield"
                          rows={4}
                          value={altText}
                          placeholder="Describe the picture for a reader who cannot see it"
                          onChange={(event) => setAltText(event.target.value)}
                        />
                        <p className="meta">
                          Written into this placement. The record&rsquo;s own alternative text is edited on{' '}
                          <a href={`/admin/media/${chosen.id}`}>its record screen</a>.
                        </p>
                      </>
                    ) : (
                      <p className="meta">
                        The alternative text is the record&rsquo;s own and is edited on{' '}
                        <a href={`/admin/media/${chosen.id}`}>its record screen</a>, because the served article
                        frame reads it from there.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="meta">Choose a record from the grid to see what it is.</p>
                )}
              </div>
            </div>
          </div>

          <div className="mediamodal__foot">
            <span className="meta">
              {loading && items.length === 0
                ? 'Reading the register…'
                : total === null
                  ? `${items.length} shown`
                  : `${items.length} of ${total.toLocaleString('en-GB')} record${total === 1 ? '' : 's'} shown${
                      kind.length > 0 ? ' of this kind' : ''
                    }`}
            </span>
            {blocked ? <span className="mediamodal__blocked">{blocked}</span> : null}
            <span className="mediamodal__actions">
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={chosen === null || blocked !== null}
                title={chosen === null ? 'Choose a record first.' : undefined}
                onClick={() => {
                  if (chosen) onChoose({ ...chosen, altText: altText.trim() || chosen.altText });
                }}
              >
                {confirmLabel}
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
