/**
 * /admin/media/[id] — what ONE media record says about itself.
 *
 * WHY THIS EXISTS, AND WHAT IT REPLACES
 *
 * `/admin/media` said, in its own words, that it "is read-only. There is no upload, no replace, no delete and
 * no alt-text editing, because **the archive has no write path for media**". That was true and it was the
 * whole of the media story: 3,488 migrated records whose name, caption, alternative text and description
 * could be read and not corrected. An editor who found a photograph captioned with its own file name — and
 * 1,742 of them are — had no way to fix it.
 *
 * SO WHAT IS EDITABLE HERE, AND WHY EACH
 *
 *   title         the stored name. Often the uploaded file's own name; frequently worth replacing.
 *   caption       the text the previous site published WITH the item, and the first thing `mediaName` reads.
 *   alt text      the description written for a reader who cannot see the picture.
 *   description   the record's own description, and the second thing `mediaName` reads.
 *   creator       who made it. A catalogue fact, not a permission.
 *   credit        how it should be credited. Also a catalogue fact.
 *
 * Every one of these is a statement about the object rather than a decision about who may use it. That is
 * why they are here, behind `edit_entity`, and why the licence and the permission are not.
 *
 * WHAT IS NOT HERE, AND WHERE IT LIVES INSTEAD
 *
 *   The rights record — holder, permission basis, publication permission, derivative and commercial rights,
 *   living-subject consent, restriction. That is `manage_media_rights`, it is admin-only on the archive's own
 *   stated reasoning, and the screen links to the rights queue rather than offering a control that this
 *   endpoint would refuse.
 *
 *   The file. No upload, no replace, no delete — see the card at the foot of the page for the measurement
 *   behind that scope.
 *
 *   A link to a record or an entity. There is no media-to-entity table in this schema at all, and the design
 *   draws no control for either relationship, so nothing is offered. See the report.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import {
  MEDIA_KIND_LABEL,
  MEDIA_TEXT_LIMITS,
  getMediaArticles,
  getMediaForEdit,
  mediaName,
} from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { Card, Head, Notices } from '../../ui';

export const dynamic = 'force-dynamic';

export default async function EditMediaRecord({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; info?: string }>;
}) {
  const { id } = await params;
  const notices = await searchParams;
  const mediaId = Number.parseInt(id, 10);
  if (!Number.isInteger(mediaId) || mediaId <= 0) notFound();

  // The page's own guard, FIRST and before the record is read. The layout's guard does not stop a page
  // beneath it rendering — see `requireCapabilityOrRedirect`.
  await requireCapabilityOrRedirect('edit_entity', `/admin/media/${mediaId}`);

  const db = await getDb();
  const item = await getMediaForEdit(db, mediaId);
  if (!item) notFound();

  const using = await getMediaArticles(db, mediaId);
  /*
   * WHAT A READER CURRENTLY SEES AS THE NAME. `mediaName` is the archive's one answer to that question, with
   * the documented order caption → description → alt text → title → honest fallback, so the page shows the
   * reader's heading rather than the stored title and lets an editor see the difference between the two.
   */
  const named = mediaName({
    kind: item.kind,
    slug: item.slug,
    storedTitle: item.title,
    caption: item.caption,
    description: item.description,
    altText: item.altText,
  });

  return (
    <>
      <Head title={named.name}>
        <Link className="btn btn--sm" href="/admin/media">Back to the register</Link>
        <Link className="btn btn--sm" href={`/documents/${item.slug}/`}>Open the record</Link>
      </Head>

      <Notices saved={notices.saved} error={notices.error} info={notices.info} />

      <Card title="What this record is">
        <p className="small muted">
          <span className="mono">{item.reference}</span> · {MEDIA_KIND_LABEL[item.kind] ?? item.kind} ·{' '}
          <Link href={`/documents/${item.slug}/`}>/documents/{item.slug}/</Link>
          {item.held ? null : ' · the archive does not hold the file'}
        </p>
        <p className="help">
          A reader currently sees the heading <strong>{named.name}</strong>
          {named.from === 'fallback'
            ? ' — the name of the file as it was uploaded, because nothing describes this record yet. Writing a caption or a summary below is how that becomes the record’s own name.'
            : `, taken from the record’s ${named.from === 'alt' ? 'alternative text' : named.from}.`}
        </p>
      </Card>

      <Card title="What this record says about itself">
        <form method="post" action="/api/admin/media">
          <input type="hidden" name="action" value="save-description" />
          <input type="hidden" name="mediaId" value={mediaId} />

          <div className="wpgrid">
            <div className="wpfield">
              <label htmlFor="title">Stored title</label>
              <input id="title" name="title" type="text" maxLength={MEDIA_TEXT_LIMITS.title} defaultValue={item.title ?? ''} />
              <p className="wphelp">
                The name the record holds. On 1,742 of the archive&apos;s 3,488 records this is the uploaded
                file&apos;s own name — <span className="mono">opta</span> rather than a title — which is why
                the heading a reader sees is composed from the caption and the description first.
              </p>
            </div>

            <div className="wpfield">
              <label htmlFor="creator">Creator</label>
              <input id="creator" name="creator" type="text" maxLength={MEDIA_TEXT_LIMITS.creator} defaultValue={item.creator ?? ''} placeholder="who made it, if the record states it" />
              <p className="wphelp">A catalogue fact, not a permission. Leave it empty rather than guessing.</p>
            </div>

            <div className="wpfield">
              <label htmlFor="credit">Credit line</label>
              <input id="credit" name="credit" type="text" maxLength={MEDIA_TEXT_LIMITS.credit} defaultValue={item.credit ?? ''} placeholder="how it should be credited" />
              <p className="wphelp">
                What a reader is told when the item is shown. The rights queue also writes this field when a
                permission names a credit, and leaves it alone otherwise, so the two do not overwrite each
                other by accident.
              </p>
            </div>
          </div>

          <div className="wpfield wpfield--wide">
            <label htmlFor="caption">Caption</label>
            <textarea id="caption" name="caption" rows={3} maxLength={MEDIA_TEXT_LIMITS.caption} defaultValue={item.caption ?? ''} />
            <p className="wphelp">
              The text published <em>with</em> the item. It is the first field a reader is shown as the
              record&apos;s name, so a caption fixes a record whose heading is a file name.
            </p>
          </div>

          <div className="wpfield wpfield--wide">
            <label htmlFor="altText">Alternative text</label>
            <textarea id="altText" name="altText" rows={3} maxLength={MEDIA_TEXT_LIMITS.altText} defaultValue={item.altText ?? ''} />
            <p className="wphelp">
              What is read aloud in place of the picture, and what shows if the file fails to load. Describe
              what is in the image rather than repeating the caption — a screen reader already has the caption.
            </p>
          </div>

          <div className="wpfield wpfield--wide">
            <label htmlFor="description">Description</label>
            <textarea id="description" name="description" rows={6} maxLength={MEDIA_TEXT_LIMITS.description} defaultValue={item.description ?? ''} />
            <p className="wphelp">
              The record&apos;s own description of the object, shown as prose under it. The second field a
              reader is shown as the record&apos;s name.
            </p>
          </div>

          <div className="row" style={{ gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn--primary" type="submit">Save what this record says</button>
            <span className="small muted">
              Recorded against your account. A save that changes nothing writes nothing.
            </span>
          </div>
        </form>
      </Card>

      {/*
        HOW IT READS. Assembled from the SAME values the form holds and the same order `mediaName` and the
        record's own page use, so an editor sees the reader's heading and the reader's caption side by side
        with the fields that produce them.
      */}
      <Card title="How this record reads now">
        <p className="eyebrow">{MEDIA_KIND_LABEL[item.kind] ?? item.kind} · {item.reference}</p>
        <h2 style={{ marginTop: 'var(--s-2)' }}>{named.name}</h2>
        {item.caption || item.altText ? (
          <p className="small muted">— shown under the file: {item.caption ?? item.altText}</p>
        ) : (
          <p className="help">No caption and no alternative text, so nothing is shown under the file.</p>
        )}
        {item.description ? <div className="prose"><p>{item.description}</p></div> : null}
        <table className="record" style={{ marginTop: '0.75rem' }}>
          <tbody>
            <tr><th scope="row">Creator</th><td>{item.creator ?? 'not recorded'}</td></tr>
            <tr><th scope="row">Credit</th><td>{item.credit ?? 'not recorded'}</td></tr>
            <tr><th scope="row">Rights</th><td>{item.licence ?? item.rightsNote ?? 'not recorded'}</td></tr>
          </tbody>
        </table>
        <p className="help">
          Rendered from the stored values, not from the form above, which may hold unsaved edits.
        </p>
      </Card>

      <Card title="Where this record is used">
        {using.length > 0 ? (
          <ul className="history">
            {using.map((a) => (
              <li key={a.slug}>
                <Link href={`/${a.slug}/`}>{a.title}</Link>{' '}
                <span className="small muted">
                  {a.role === 'featured' ? '— its featured image' : '— shown in its text'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="help">
            No published record uses this item — neither as a featured image nor in its own text.
          </p>
        )}
      </Card>

      {/*
        THE RIGHTS DECISION, WHICH IS A DIFFERENT DECISION AND A DIFFERENT CAPABILITY.
        The link is offered and the controls are not, because an editor may describe a record and may not
        permit its publication.
      */}
      <Card title="Rights, which are decided elsewhere">
        <p>
          {item.rightsRecorded
            ? `Currently recorded: ${item.licence ?? item.rightsNote ?? 'a rights record exists, with no licence string'}.`
            : 'No rights record exists for this item, so nothing is permitted either way — an absent row is not permission.'}
        </p>
        <p className="help">
          Whether this may be published, on what basis, and with what consent for a living subject is a legal
          decision rather than a catalogue one, so it is recorded in the rights queue against
          <span className="mono"> ozikoro_media_rights</span> and needs the
          <span className="mono"> manage_media_rights</span> permission — an administrator&apos;s. Nothing on
          this page has touched it and this form cannot.
        </p>
        <p>
          <Link className="btn btn--sm" href={`/admin/rights/?filter=all&item=${mediaId}`}>
            Open this item in the rights queue
          </Link>
        </p>
      </Card>

      <Card title="What this screen cannot do" quiet>
        <p>
          It cannot change the file. There is no upload, no replace, no delete and no re-keying, and the
          reason is measured rather than cautious: <strong>3,443 objects are in the bucket and there are 3,488
          records</strong>, and a further <strong>307 files sit in <span className="mono">data/media/ozikoro-wp</span>
          with no record at all</strong>. A previous round declined to key those, because keying them would
          mean inventing keys. <strong>An upload control beside this form is how those keys would get invented
          by accident</strong>, so the form has none. Replacing a file properly needs an object-store path
          that writes the new object, repoints the row and removes the old one in one operation, and that is
          not half-built here.
        </p>
        <p className="help">
          The four kinds in the data are not four different forms. They are one table,
          <span className="mono"> ozikoro_media</span>, discriminated by <span className="mono">kind</span> —
          3,488 migrated records, of which <span className="mono">media.ts</span> measures 3,462 as images, 13
          as video and 12 as documents. The video rows are <em>not</em> the films the Watch section plays:
          those are ids inside an article&apos;s body, extracted by
          <span className="mono"> extractArchiveFilms</span>, and the record that carries them is the article,
          which is edited at <Link href="/admin/archive">the archive queue</Link>.
        </p>
      </Card>
    </>
  );
}
