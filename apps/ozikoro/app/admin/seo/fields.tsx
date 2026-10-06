import type { StoredSetting } from '@ozikoro/platform';
import { SEO_ACTION } from './settings';

/**
 * The three pieces every settings field in the search-engine area is made of.
 *
 * ── WHY THEY ARE SHARED RATHER THAN TYPED INTO FIVE SCREENS ──────────────────────────────────────────
 *
 * Forty fields across five screens, and every one of them has the same four obligations: post the key, post
 * the value, say where the value is read from, and say what happens when it is empty. **A field that forgot the
 * third would be a stored-but-invisible setting; a field that forgot the fourth would be one where an owner
 * cannot tell whether blank means "default" or "broken".** So each responsibility is one component, and no
 * screen writes a form by hand.
 *
 * ── THE `READS` LINE IS THE POINT OF THE WHOLE FILE ─────────────────────────────────────────────────
 *
 * This project has had a "stored but never read" failure — a value saved, served, applied and invisible, and a
 * comment about it in `design-theme.css/route.ts`. **So every field names the file and function that READS the
 * value and, where there is one, the served address that proves it.** That is a claim a reader can check by
 * opening the file, which is the only kind of claim worth printing.
 */

/** One field, with everything a reader needs to judge whether it works. */
export function Field({
  settingKey,
  label,
  hint,
  value,
  placeholder,
  reads,
  provedBy,
  multiline,
  rows,
  children,
  stored,
  unit,
}: {
  /** The `site_setting` key this form writes. */
  settingKey: string;
  label: string;
  /** One line about what the field does, in the archive's own words. */
  hint?: string;
  /** The stored value as a string, or undefined/empty when nothing is stored. */
  value: string;
  placeholder?: string;
  /** The file and function that reads it. Never omitted — see the header. */
  reads: string;
  /** A served address a reader can open to see the value in force, when there is one. */
  provedBy?: string;
  multiline?: boolean;
  rows?: number;
  /** Anything drawn under the input — a preview, a list of refusals, the current effect. */
  children?: React.ReactNode;
  /** The stored row, so the form can show who set it and when. */
  stored?: StoredSetting | null;
  /** What the value is measured in, when it has a length worth showing. */
  unit?: string;
}) {
  const id = `field-${settingKey.replace(/[^a-zA-Z0-9]+/g, '-')}`;
  return (
    <div style={{ borderTop: '1px solid var(--rule)', padding: '.9rem 0' }}>
      <h3 style={{ margin: '0 0 .2rem' }}>{label}</h3>
      {hint ? (
        <p className="small muted" style={{ margin: '0 0 .4rem' }}>
          {hint}
        </p>
      ) : null}
      <form method="post" action={SEO_ACTION}>
        <input type="hidden" name="action" value="set" />
        <input type="hidden" name="key" value={settingKey} />
        <label className="small" htmlFor={id}>
          <span className="visually-hidden">{label}</span>
        </label>
        {multiline ? (
          <textarea
            id={id}
            name="value"
            rows={rows ?? 2}
            defaultValue={value}
            placeholder={placeholder}
            style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: '.85rem' }}
          />
        ) : (
          <input
            id={id}
            type="text"
            name="value"
            defaultValue={value}
            placeholder={placeholder}
            style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: '.85rem' }}
          />
        )}
        <div style={{ display: 'flex', gap: '.4rem', marginTop: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn" type="submit">
            {stored ? 'Replace it' : 'Save it'}
          </button>
          {stored ? (
            <button className="btn btn-quiet" type="submit" name="action" value="clear">
              Clear it — serve the archive’s own again
            </button>
          ) : null}
          <span className="small muted">
            {stored
              ? `Set by ${stored.actorName ?? 'an account with no name'} on ${new Date(stored.updatedAt ?? 0).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.`
              : 'Nothing is stored for this, so the archive serves its own value — exactly as it did before this screen existed.'}
            {unit ? ` ${value.length} of ${unit}.` : ''}
          </span>
        </div>
      </form>
      <p className="small muted" style={{ margin: '.4rem 0 0' }}>
        <b>Read by</b> <code>{reads}</code>
        {provedBy ? (
          <>
            {' '}
            — see it on <a href={provedBy} target="_blank" rel="noreferrer">{provedBy}</a>.
          </>
        ) : null}
      </p>
      {children}
    </div>
  );
}

/** A form that adds or removes one redirect. Used by the Tools section and the permalink history. */
export function RedirectForm({
  from,
  to,
  add,
  note,
}: {
  from?: string;
  to?: string;
  /** True for the add form, false for the remove button beside an existing entry. */
  add: boolean;
  note?: string;
}) {
  return (
    <form method="post" action={SEO_ACTION} style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
      <input type="hidden" name="action" value={add ? 'addRedirect' : 'removeRedirect'} />
      <input
        type="text"
        name="from"
        defaultValue={from}
        readOnly={!add}
        aria-label="The address to redirect from"
        placeholder="/old-address/"
        style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.85rem', flex: '1 1 14rem' }}
      />
      {add ? (
        <input
          type="text"
          name="to"
          defaultValue={to}
          aria-label="The address to redirect to"
          placeholder="/new-address/"
          style={{ fontFamily: 'ui-monospace, monospace', fontSize: '.85rem', flex: '1 1 14rem' }}
        />
      ) : null}
      <button className={add ? 'btn' : 'btn btn-quiet'} type="submit">
        {add ? 'Add the redirect' : 'Remove it'}
      </button>
      {note ? <span className="small muted">{note}</span> : null}
    </form>
  );
}
