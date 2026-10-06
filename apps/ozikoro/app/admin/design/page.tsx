/**
 * /admin/design — the owner's own design editor, organised by what a person is trying to change.
 *
 * ── WHAT WAS WRONG, IN THE OWNER'S WORDS ─────────────────────────────────────────────────────────────
 *
 * *"on this design page https://ozikoro.com/admin/design, everything is just showing in one page, instead of
 * having selection to change colours, fonts, texts, logo, favicon, etc. basically everything one can be able
 * to edit"*
 *
 * He was right, and the reason is in this file's own history: **it was organised by the shape of the
 * database row.** Eight hundred and fifty lines of cards, with every colour and type token drawn at once, the
 * whole element inventory under them, and a contrast table between the two. The `TOKEN_META` groups already
 * existed and were already used as `<h3>` headings inside one enormous card — *"Accent"*, *"Dark chrome"*,
 * *"Type"* — but a heading inside a page that never ends is not a section. And the token's `role` and its
 * written note — the design's own sentence about what breaking it would do — were rendered only when the
 * token happened to have both a comment and a note.
 *
 * ── WHAT REPLACES IT ─────────────────────────────────────────────────────────────────────────────────
 *
 * ONE SECTION AT A TIME, chosen from a row of links, and each section is the control its kind deserves:
 *
 *   Colours   a colour picker per colour token WITH the hex shown and editable, grouped by `TOKEN_META.group`,
 *             each carrying its `role` and its note
 *   Fonts     a chooser of the families the design actually loads, plus the stack as text, and the sentence
 *             about the dotted vowels and tone marks
 *   Text      the overrides shown as the sentence they replace and the sentence they become
 *   Images    a URL field per override, with a preview of what it points at
 *   Logo      the masthead's mark, which is an `image` override on the wordmark's own `<img>` — see below
 *   Icon      the favicon, which is a NEW stored setting and a new route; see `@ozikoro/platform`→`site-icon.ts`
 *   Links     the link and hide overrides, which the system already supports
 *   Everything  the served page's element inventory, kept because the named sections cannot express
 *             "the third paragraph on /about/"
 *
 * The section is a URL parameter rather than client state, because this is a server-rendered page with no
 * JavaScript of its own: a link is a section, the back button works, and a notice after a save returns the
 * owner to the section he was in.
 *
 * ── WHAT THIS FILE DOES NOT DO, AND WHY THAT MATTERS ─────────────────────────────────────────────────
 *
 * It does not decide which control a token gets. `@ozikoro/platform`→`design-editor.ts` does, over the same
 * `DesignToken[]` this page builds, and `design-editor.test.ts` asserts against the deliverable's own
 * `tokens.css` that a gradient is never handed a colour picker and that a value which is not a plain colour
 * survives a round trip unchanged. **A page cannot be tested for that**; the decision lives where it can be.
 *
 * It does not write to `public/design/`. The deliverable is byte-compared against the handover copy, so every
 * edit here is a row served on top of the rendered page, which is what makes it reversible, comparable and
 * attributable.
 *
 * ── THE THREE FAULTS THE OLD PAGE HAD THAT THIS ONE DOES NOT ─────────────────────────────────────────
 *
 *   1. **A COLOUR PICKER ON A GRADIENT.** The old filter was
 *      `['colour', 'gradient'].includes(effectiveClass(t))`, so `--gradient-gold` and both shadows were drawn
 *      beside an `<input type="color">`. The picker holds `#000000` until it is touched and **the save path
 *      reads it first**, so pressing Save on an untouched gradient row wrote black over it. Now the control
 *      is chosen from the VALUE: `pickerHolds` refuses anything but a six-digit hex, and everything else gets
 *      a text box and a sentence saying why.
 *   2. **NO EMPTY STATE.** The page said "Edits in force: 0" in a table among eight other rows. Now each
 *      section says in its own words that nothing is stored and the design's own values are in force, which
 *      is the normal state and not a fault.
 *   3. **A RESET NOBODY COULD FIND.** Reset existed, at the bottom, per row and per screen. Now every row
 *      shows the design's own value beside the field, and every row carries its own "put this back" button
 *      where the edit is.
 */
import { readFile } from 'node:fs/promises';
import { headers } from 'next/headers';
import { join } from 'node:path';
import { getDb } from '@ozituma/db/client';
import {
  ALL_SCREENS,
  CONTRAST_PAIRS,
  contrastReport,
  EDITOR_SECTIONS,
  INVENTORY_LIMIT,
  listDesignOverrides,
  loadSiteFavicon,
  logoSlotIn,
  parseDesignTokens,
  sectionOf,
  selectorReach,
  splitTextKey,
  tokenControls,
  fontOptions,
  type DesignOverride,
  type DesignToken,
  type EditorSection,
  type FontChoice,
  type InventoryItem,
  type TokenControl,
} from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head, Notices } from '../ui';

export const dynamic = 'force-dynamic';

const DESIGN_DIR = join(process.cwd(), 'public', 'design');

/* ==================================================================================================
 * 1. THE DELIVERABLE, READ ONCE PER PROCESS
 * ================================================================================================ */

/**
 * The deliverable's own screen files, read once per process.
 *
 * WHY A CACHE AND NOT A READ PER RENDER: `apps/ozikoro/public/design/` is byte-compared against the handover
 * copy, so its contents cannot change while this process runs. The reach of a key is therefore a constant of
 * the build, and re-measuring it on every render would spend a second of the server's time to arrive at the
 * same number.
 */
let SCREEN_FILES: { name: string; html: string }[] | null = null;
async function screenFiles(): Promise<{ name: string; html: string }[]> {
  if (SCREEN_FILES) return SCREEN_FILES;
  try {
    const { readdir } = await import('node:fs/promises');
    const names = (await readdir(join(DESIGN_DIR, 'screens'))).filter((file) => file.endsWith('.html'));
    SCREEN_FILES = await Promise.all(
      names.map(async (file) => ({ name: file.replace(/\.html$/, ''), html: await readFile(join(DESIGN_DIR, 'screens', file), 'utf8') }))
    );
  } catch {
    SCREEN_FILES = [];
  }
  return SCREEN_FILES;
}

const REACH = new Map<string, { screen: string; text: string }[]>();

/**
 * Which screens each key names exactly one element on.
 *
 * THIS IS THE ANSWER TO "ONE EDIT OR FIFTY-TWO?". The header, the menu and the footer are the same markup in
 * every screen file, so the footer's own words are on fifty-two screens and a page-by-page editor makes the
 * owner type them fifty-two times. The count is measured from the deliverable and the KEY IS THE KEY THE ROW
 * IS STORED UNDER — so the number is the reach of the edit that will actually be written.
 */
async function reachOf(keys: string[]): Promise<(key: string) => { screen: string; text: string }[]> {
  const wanted = [...new Set(keys)].filter((key) => key.length > 0 && !REACH.has(key));
  if (wanted.length > 0) {
    const reached = selectorReach(await screenFiles(), wanted);
    for (const key of wanted) REACH.set(key, reached.get(key) ?? []);
  }
  return (key: string) => REACH.get(key) ?? [];
}

/** The screens the deliverable ships, discovered rather than typed, so a new screen appears here by itself. */
async function designScreens(): Promise<string[]> {
  try {
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(join(DESIGN_DIR, 'screens'));
    return files.filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')).sort();
  } catch {
    return [];
  }
}

async function designTokens(): Promise<{ tokens: DesignToken[]; served: Map<string, string>; error: string | null }> {
  try {
    const tokensCss = await readFile(join(DESIGN_DIR, 'tokens.css'), 'utf8');
    const stylesheets = await Promise.all(
      ['main.css', 'showcase.css'].map((f) => readFile(join(DESIGN_DIR, 'styles', f), 'utf8').catch(() => ''))
    );
    const tokens = parseDesignTokens(tokensCss, stylesheets);

    /*
     * THE APPLICATION CORRECTS ONE TOKEN, AND THE EDITOR MUST SAY SO.
     *
     * `public/a11y.css` is linked after the design's sheets and re-declares `--ink-faint` as #655d51, because
     * the design's own #8d8577 measures 3.24:1 on the page ground and is used for real text. **A catalogue
     * built from `tokens.css` alone would show the owner a value the page does not paint, and "restoring" it
     * would undo an accessibility fix.** So the served baseline is the design's value with the application's
     * own corrections laid over it, and each row says which of the two it is showing.
     */
    const served = new Map(tokens.map((token) => [token.name, token.value]));
    try {
      const a11yCss = await readFile(join(process.cwd(), 'public', 'a11y.css'), 'utf8');
      for (const token of parseDesignTokens(a11yCss)) served.set(token.name, token.value);
    } catch {
      // An application stylesheet that cannot be read leaves the design's own values, which is the honest
      // fallback: they are what the design says, and the page's correction is a separate file's business.
    }

    return { tokens, served, error: null };
  } catch (error) {
    return { tokens: [], served: new Map(), error: String(error).slice(0, 200) };
  }
}

/**
 * What is on the page, asked of the page.
 *
 * `/donate/`'s notice does not exist in `donate.html` — `fillDonate` writes it — and the same fill deletes the
 * page's submit button, so a list built from the file would offer a button that is not on the page and hide
 * the notice that is. The inventory is therefore taken from the SERVED document, which only the route that
 * serves it can produce.
 */
async function inventoryFor(screen: string, from: number): Promise<{ items: InventoryItem[]; total: number } | { error: string }> {
  const h = await headers();
  const host = h.get('host') ?? '';
  if (host.length === 0) return { error: 'This server could not be reached to read the served page.' };
  const proto = h.get('x-forwarded-proto') ?? (/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host) ? 'http' : 'https');
  try {
    const path = screen === 'home' ? '/' : `/${screen}/`;
    const res = await fetch(`${proto}://${host}${path}?ozinventory=1&from=${Math.max(0, from)}`, {
      headers: { cookie: h.get('cookie') ?? '' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { error: `The served page answered ${res.status} when asked what is on it.` };
    return (await res.json()) as { items: InventoryItem[]; total: number };
  } catch (error) {
    return { error: `The served page could not be read: ${String(error).slice(0, 120)}` };
  }
}

/* ==================================================================================================
 * 2. THE SMALL PIECES THE SECTIONS ARE BUILT FROM
 * ================================================================================================ */

function Swatch({ value }: { value: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block', width: '1.1rem', height: '1.1rem', borderRadius: '3px',
        border: '1px solid rgba(0,0,0,.25)', background: value, verticalAlign: '-.2rem',
      }}
    />
  );
}

function Badge({ tone, children }: { tone: 'meaning' | 'decoration' | 'pass' | 'fail'; children: React.ReactNode }) {
  const colour = tone === 'fail' ? '#8a1f1f' : tone === 'pass' ? '#2f5d3a' : tone === 'meaning' ? '#7a4a12' : '#4a4a4a';
  return <span style={{ color: colour, fontWeight: 600, fontSize: '.78rem', whiteSpace: 'nowrap' }}>{children}</span>;
}

/**
 * The form every editable thing shares: a value, the design's own value beside it, Save, Preview, and — when
 * an override is in force — the way back.
 *
 * ONE COMPONENT FOR ALL FIVE KINDS, because the five differ only in the hidden fields and the input. **The
 * reset is inside this form and not beside it**, which is what makes "an editor with no way back is a trap"
 * true of every row rather than of the three rows somebody remembered.
 */
function EditForm({
  action,
  kind,
  screen,
  itemKey,
  title,
  returnTo,
  children,
  override,
  undoLabel,
  previewQuery,
  allowMissing,
  backLabel,
}: {
  action: string;
  kind: string;
  screen: string;
  itemKey: string;
  title: string;
  returnTo: string;
  children: React.ReactNode;
  /**
   * The override in force, or undefined. **The full row is passed where a row exists and a plain `true` where
   * one does not have to be invented**, which is the case for a token: a token override is looked up per
   * SCREEN NAME, not per screen, so the page has the fact and not always the row.
   */
  override: DesignOverride | boolean | undefined;
  undoLabel: string;
  previewQuery: Record<string, string>;
  /** The image-only escape hatch: save an address that does not answer yet. */
  allowMissing?: boolean;
  /**
   * The button's own label.
   *
   * It exists for the one case where the ordinary verb is wrong rather than because every kind wants a
   * different one: a colour token applies to every screen, so "Save on /about/ this" would be the promise of
   * something the write path does not do. The label says what the save will actually reach.
   */
  backLabel?: string;
}) {
  const isSet = Boolean(override);
  const previewHref = `/admin/design/preview?${new URLSearchParams(previewQuery).toString()}`;
  return (
    <form method="post" action="/api/admin/design" style={{ margin: '.35rem 0' }}>
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="screen" value={screen} />
      <input type="hidden" name="key" value={itemKey} />
      <input type="hidden" name="title" value={title} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {children}
      {allowMissing ? (
        <p className="small" style={{ margin: '.2rem 0 0' }}>
          <label>
            <input type="checkbox" name="allow_missing" value="1" /> The file will be added later — save the
            address even if nothing answers at it yet.
          </label>
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: '.4rem', marginTop: '.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn" type="submit">{backLabel ?? 'Save'}</button>
        <a className="btn btn-quiet" href={previewHref} target="_blank" rel="noreferrer">Preview in a new tab</a>
        {isSet ? (
          /*
           * THE WAY BACK, IN THE SAME FORM AND ONE BUTTON AWAY.
           *
           * A form may carry only one `action` value that a reader can see, so the reset puts its OWN value in
           * its own hidden field and the button in the same form overrides it with `formAction`. The earlier
           * version of this page had the reset in a SECOND form below, which is a fine shape and one more
           * thing to keep in step; this is one form, one row, and the way back is beside the way forward.
           */
          <button
            className="btn btn-quiet"
            type="submit"
            formNoValidate
            name="action"
            value="remove"
            title={`Remove this row and return to ${undoLabel}`}
          >
            Put {undoLabel} back to the design
          </button>
        ) : null}
      </div>
    </form>
  );
}

/** The words a save is told apart by, in the list of what is in force. */
function valueSummary(override: DesignOverride): string {
  return (
    override.value.value ??
    override.value.text ??
    override.value.src ??
    override.value.href ??
    (override.value.hidden ? 'hidden' : '')
  );
}

/* ==================================================================================================
 * 3. THE SECTIONS
 * ================================================================================================ */

/**
 * One token: what it is, what it does, what it is now, and — because the control is chosen from the value —
 * which control that is.
 *
 * THE ROLE AND THE NOTE ARE ALWAYS SHOWN when the design writes one. The old page rendered the note only when
 * the token also had a comment, so `--focus`'s *"it is deliberately never the accent, because a ring the
 * colour of a link is a ring nobody sees"* was the first thing to disappear — on the one token where the
 * owner most needed to read it.
 */
function TokenRow({
  control,
  servedValue,
  contrast,
  returnTo,
  fontChoices,
}: {
  control: TokenControl;
  /** The value the page actually paints, which differs from the design's for the token `a11y.css` corrects. */
  servedValue: string;
  contrast: { role: string; ratio: number | null; min: number; pass: boolean }[];
  returnTo: string;
  /** What the font picker may offer: the stacks the design itself already declares. */
  fontChoices: FontChoice[];
}) {
  const failed = contrast.filter((row) => !row.pass);
  const designValue = control.designValue;
  const unchangedByA11y = !control.overridden && designValue === servedValue;
  return (
    <div style={{ padding: '.75rem 0', borderTop: '1px solid var(--rule)' }}>
      <div className="spread" style={{ gap: 'var(--s-4)', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div style={{ minWidth: '20rem', flex: '1 1 22rem' }}>
          <p style={{ margin: 0 }}>
            {control.effectiveClass === 'colour' || control.effectiveClass === 'gradient' ? <Swatch value={control.normalised} /> : null}{' '}
            <code>--{control.token}</code>{' '}
            {control.role === 'meaning' ? <Badge tone="meaning">carries meaning</Badge> : <Badge tone="decoration">decoration</Badge>}{' '}
            {control.overridden ? <><Badge tone="meaning">you changed this</Badge>{' '}</> : null}
            <span className="small muted">
              {control.control === 'colour' ? 'colour' : control.control === 'font' ? 'font' : control.control}{' '}
              · read directly by <b>{control.uses}</b> rule{control.uses === 1 ? '' : 's'}
            </span>
          </p>
          {control.note ? <p className="small" style={{ margin: '.25rem 0 0' }}>{control.note}</p> : null}
          {control.caveat ? (
            <p className="small muted" style={{ margin: '.25rem 0 0' }}>{control.caveat}</p>
          ) : null}
          <p className="small muted" style={{ margin: '.25rem 0 0' }}>
            The design declares <code>{designValue}</code>
            {unchangedByA11y ? '.' : <> and the page paints <code>{servedValue}</code>
              {control.overridden ? ' before your edit' : ', because /a11y.css corrects it after the design’s sheets load'}.</>}
            {control.overridden ? <> Removing your edit returns to <code>{servedValue}</code>.</> : null}
          </p>
        </div>
        <div style={{ flex: '1 1 26rem' }}>
          <EditForm
            action="set"
            kind="token"
            screen={ALL_SCREENS}
            itemKey={control.key}
            title={`${control.group} · ${control.key}`}
            returnTo={returnTo}
            override={control.overridden}
            undoLabel={control.key}
            /* A colour or type token is not one screen's: `tokens.css` is imported by every screen, so
               the button says what the save actually reaches rather than naming the page the owner is on. */
            backLabel="Save for every screen"
            previewQuery={{ kind: 'token', key: control.key, value_text: control.normalised, previewScreen: 'home' }}
          >
            <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {control.control === 'colour' && control.pickerValue ? (
                <input
                  type="color"
                  name="value"
                  defaultValue={control.pickerValue}
                  aria-label={`${control.token} colour picker`}
                  style={{ width: '3rem', height: '2rem' }}
                />
              ) : null}
              {/*
                A FONT GETS A CHOOSER, AND THE TOKEN'S OWN TEXT FIELD STAYS.

                The chooser offers the stacks the design already declares, so a family cannot be named here that
                the page does not load. It writes into the SAME field the text box does — `value_text` — and the
                box is empty on a row nobody has edited, so the two cannot both submit an answer. Choosing a
                family therefore means selecting it and pressing Save; typing a stack of your own means typing
                it and pressing Save. **One field, one answer, and neither can silently override the other.**
              */}
              {control.control === 'font' ? (
                <>
                  <select
                    name="value_text"
                    defaultValue={control.overridden ? control.normalised : ''}
                    aria-label={`${control.token} family`}
                    style={{ width: '22rem', maxWidth: '100%' }}
                  >
                    <option value="">{control.overridden ? '— choose —' : `Keep the design’s own (${designValue})`}</option>
                    {fontChoices.map((option) => (
                      <option key={option.family} value={option.stack}>
                        {option.family}{option.loaded ? '' : ' — named by the design, not downloaded by the page'}
                      </option>
                    ))}
                  </select>
                  <span className="small muted">or type a stack of your own:</span>
                </>
              ) : null}
              {/*
                THE TEXT FIELD IS ALWAYS HERE, INCLUDING BESIDE A PICKER, AND EXCEPT BESIDE THE FONT CHOOSER.

                A native colour input cannot express `rgba(…)`, `hsl(…)`, a gradient or a `color-mix()`, and the
                SAVE PATH READS THIS FIELD FIRST (`value_text` before `value`) — which is the rule the previous
                round had to add after a box that was typed into did nothing. So the hex is shown and editable
                on every colour row, and the picker is a convenience beside it rather than the only way in.
              */}
              {control.control === 'font' ? null : (
                <input
                  type="text"
                  name={control.control === 'colour' ? 'value_text' : 'value'}
                  defaultValue={control.overridden ? control.normalised : ''}
                  placeholder={control.normalised}
                  aria-label={`${control.token} value as text`}
                  spellCheck={false}
                  style={{ flex: '1 1 18rem', minWidth: '14rem', fontFamily: 'ui-monospace, monospace' }}
                />
              )}
            </div>
          </EditForm>
        </div>
      </div>
      {failed.length > 0 ? (
        <p className="small" style={{ margin: '.4rem 0 0', color: '#8a1f1f' }}>
          <Badge tone="fail">Contrast fails</Badge>{' '}
          {failed.map((row) => `${row.role}: ${row.ratio ?? '—'}:1 (needs ${row.min}:1)`).join(' · ')}
        </p>
      ) : contrast.length > 0 ? (
        <p className="small muted" style={{ margin: '.4rem 0 0' }}>
          Contrast: {contrast.map((row) => `${row.ratio ?? '—'}:1`).join(' · ')} — meets every standard it is used under.
        </p>
      ) : null}
    </div>
  );
}

/** One place on a screen, with every action that is honest for it. */
function ElementRow({ item, screen, from, override, reach, screensTotal }: {
  item: InventoryItem;
  screen: string;
  /** Which page of the place list this row is on, so a save comes back to the same 150. */
  from: number;
  override: (kind: 'text' | 'image' | 'link' | 'hide', key?: string) => DesignOverride | undefined;
  /** Which screens each key names exactly one element on, with the words that screen holds there. */
  reach: (key: string) => { screen: string; text: string }[];
  /** How many screens the deliverable ships, so the reach reads as a proportion. */
  screensTotal: number;
}) {
  const backTo = `/admin/design/?section=everything&screen=${screen}${from > 0 ? `&from=${from}` : ''}`;
  const imageOverride = override('image', item.key);
  const linkOverride = override('link', item.key);
  const hidden = Boolean(override('hide', item.key));
  const heading = /^h[1-4]$/.test(item.tag);
  const places = item.places ?? [];
  const edited = places.some((place) => override('text', place.key)) || imageOverride || linkOverride;
  return (
    <details style={{ borderTop: '1px solid var(--rule)', padding: '.5rem 0' }}>
      <summary style={{ cursor: 'pointer' }}>
        {hidden ? <Badge tone="fail">hidden</Badge> : null}{' '}
        {heading ? <Badge tone="meaning">{item.tag}</Badge> : null}{' '}
        <span className="small">{item.label}</span>
      </summary>
      <p className="small muted" style={{ margin: '.4rem 0' }}>
        <code>{item.key}</code>
        {edited ? <> · <Badge tone="meaning">you changed this</Badge></> : null}
        {item.textReason ? <><br />{item.textReason}</> : null}
      </p>

      {places.map((place) => {
        const textOverride = override('text', place.key);
        const screens = reach(place.key);
        const everywhere = screens.length > 1;
        const sameWording = screens.filter((row) => row.text === place.value).length;
        return (
          <div key={place.key} style={{ margin: '.5rem 0' }}>
            <EditForm
              action="set"
              kind="text"
              screen={screen}
              itemKey={place.key}
              title={`${item.label} · ${place.label}`}
              returnTo={backTo}
              override={textOverride}
              undoLabel={`this ${place.label.toLowerCase()}`}
              previewQuery={{
                kind: 'text', key: place.key, screen, text: textOverride?.value.text ?? place.value,
              }}
            >
              <input type="hidden" name="sampleScreen" value={screen} />
              {/*
                THE SENTENCE IT REPLACES, WHICH IS THE WHOLE OF THE "TEXTS" SECTION'S BRIEF.

                The previous page showed a placeholder attribute and left the owner to work out which sentence it
                was. Here the sentence the page carries now is printed as text above the field that replaces it,
                so the pair reads "this is what it says — this is what it will say".
              */}
              <p className="small muted" style={{ margin: 0 }}>
                {place.attr ? <>{place.label} <code>{place.attr}</code> now: </> : <>On the page now: </>}
                <q>{place.value}</q>
              </p>
              <label className="small" htmlFor={`text-${place.key}`}>
                {place.attr ? `The words you want in ${place.attr}` : 'The words you want instead'}
              </label>
              <textarea
                id={`text-${place.key}`}
                name="text"
                rows={place.value.length > 90 ? 3 : 1}
                defaultValue={textOverride?.value.text ?? ''}
                placeholder={place.value}
                style={{ width: '100%', fontFamily: 'inherit' }}
              />
              {everywhere ? (
                /*
                  THE ONE EDIT OR FIFTY-TWO ANSWER, IN THE SAME FORM AS THE VALUE.

                  Both buttons submit the text beside them — a separate form could only re-post the STORED value,
                  which would make "change it everywhere" a button that changes nothing the first time it is
                  pressed. The count is measured from the deliverable, and the button appears only when there is
                  more than one screen to reach.
                */
                <p className="small muted" style={{ margin: '.3rem 0 0' }}>
                  This place is on <b>{screens.length} of {screensTotal} screens</b>
                  {sameWording < screens.length ? <>, and <b>{screens.length - sameWording}</b> of them hold different words there</> : null}
                  . The button below writes <b>one</b> row served wherever the design has this place.
                </p>
              ) : null}
            </EditForm>
            {everywhere ? (
              <p className="small muted" style={{ margin: 0 }}>
                Screens it reaches: {screens.slice(0, 6).map((row) => row.screen).join(', ')}
                {screens.length > 6 ? `, and ${screens.length - 6} more` : ''}.
                {sameWording < screens.length ? (
                  <>
                    {' '}It replaces their words too, because a row names a <b>place</b> and not a sentence —{' '}
                    {screens.filter((row) => row.text !== place.value).slice(0, 4).map((row) => row.screen).join(', ')}.
                  </>
                ) : ' Every one of them holds exactly these words.'}
              </p>
            ) : null}
          </div>
        );
      })}
      {places.length === 0 && !item.textReason ? (
        <p className="small muted" style={{ margin: '.2rem 0' }}>This element holds no words a reader reads.</p>
      ) : null}

      {item.can.image ? (
        <div style={{ margin: '.4rem 0' }}>
          <ImageForm
            screen={screen}
            itemKey={item.key}
            title={item.label}
            returnTo={backTo}
            override={imageOverride}
            currentSrc={item.src ?? ''}
            currentAlt={item.alt ?? ''}
            creditKey={item.creditKey}
            credit={item.credit}
            undoLabel="this photograph"
            previewQuery={{
              kind: 'image', key: item.key, screen,
              src: imageOverride?.value.src ?? item.src ?? '',
              alt: imageOverride?.value.alt ?? item.alt ?? '',
              ...(imageOverride?.value.creditKey ?? item.creditKey ? { creditKey: imageOverride?.value.creditKey ?? item.creditKey ?? '' } : {}),
            }}
          />
        </div>
      ) : null}

      {item.can.link ? (
        <EditForm
          action="set"
          kind="link"
          screen={screen}
          itemKey={item.key}
          title={item.label}
          returnTo={backTo}
          override={linkOverride}
          undoLabel="this link"
          previewQuery={{ kind: 'link', key: item.key, screen, href: linkOverride?.value.href ?? item.href ?? '', linkLabel: linkOverride?.value.label ?? item.text }}
        >
          <p className="small muted" style={{ margin: 0 }}>The link says <q>{item.text}</q> and goes to <code>{item.href}</code>.</p>
          <p className="small" style={{ margin: 0 }}>
            Label
            <input type="text" name="linkLabel" defaultValue={linkOverride?.value.label ?? ''} placeholder={item.text} style={{ width: '100%' }} />
          </p>
          <p className="small" style={{ margin: 0 }}>
            Goes to
            <input type="text" name="href" defaultValue={linkOverride?.value.href ?? ''} placeholder={item.href} style={{ width: '100%' }} />
          </p>
        </EditForm>
      ) : null}

      {item.can.hide ? (
        <form method="post" action="/api/admin/design" style={{ margin: '.4rem 0' }}>
          <input type="hidden" name="action" value={hidden ? 'remove' : 'set'} />
          <input type="hidden" name="kind" value="hide" />
          <input type="hidden" name="screen" value={screen} />
          <input type="hidden" name="key" value={item.key} />
          <input type="hidden" name="title" value={item.label} />
          <input type="hidden" name="returnTo" value={backTo} />
          <button className="btn btn-quiet" type="submit">{hidden ? 'Show this block again' : 'Hide this block'}</button>
          <span className="small muted" style={{ marginLeft: '.5rem' }}>
            {hidden
              ? 'The block is omitted from the page. Showing it again removes the row; nothing was deleted.'
              : 'The block is left out of the response. The design file keeps it, and this can be undone.'}
          </span>
        </form>
      ) : null}
    </details>
  );
}

/**
 * An image override: the address, what the picture looks like, the alternative text and the credit.
 *
 * THE PREVIEW IS THE POINT OF THIS COMPONENT EXISTING RATHER THAN THE SHARED FORM. An image editor whose only
 * feedback is a status code after Save is an editor whose owner finds out what he did when he reloads the
 * page — and the credit field is disabled rather than hidden when the design has no slot for it, because a
 * control that is present and impossible is worse than one that says why.
 */
function ImageForm({
  screen, itemKey, title, returnTo, override, currentSrc, currentAlt, creditKey, credit, undoLabel, previewQuery, label,
}: {
  screen: string;
  itemKey: string;
  title: string;
  returnTo: string;
  override: DesignOverride | undefined;
  currentSrc: string;
  currentAlt: string;
  creditKey?: string;
  credit?: string;
  undoLabel: string;
  previewQuery: Record<string, string>;
  /** The logo's own heading, which is not the design's alt text. */
  label?: string;
}) {
  const src = override?.value.src ?? '';
  const shown = src.length > 0 ? src : currentSrc;
  return (
    <>
      {label ? <h3 style={{ margin: '.6rem 0 .2rem' }}>{label}</h3> : null}
      <div style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 12rem' }}>
          {shown.length > 0 ? (
            // eslint-disable-next-line @next/next/no-img-element -- a preview of whatever the owner has pointed
            // at, which may be an address on another origin; next/image would proxy and reshape it.
            <img
              src={shown}
              alt={override?.value.alt ?? currentAlt}
              style={{ maxWidth: '11rem', maxHeight: '8rem', border: '1px solid var(--rule)', background: 'var(--surface-sunk, #efe6d2)' }}
            />
          ) : (
            <p className="small muted">There is no image here to preview.</p>
          )}
          <p className="small muted" style={{ margin: '.2rem 0 0', wordBreak: 'break-all' }}>
            {src.length > 0 ? <>Your address: <code>{src}</code></> : <>The design’s own: <code>{currentSrc}</code></>}
          </p>
        </div>
        <div style={{ flex: '1 1 24rem' }}>
          <EditForm
            action="set"
            kind="image"
            screen={screen}
            itemKey={itemKey}
            title={title}
            returnTo={returnTo}
            override={override}
            undoLabel={undoLabel}
            previewQuery={previewQuery}
            allowMissing
          >
            {creditKey ? <input type="hidden" name="creditKey" value={override?.value.creditKey ?? creditKey} /> : null}
            <p className="small" style={{ margin: 0 }}>
              Image address
              <input type="text" name="src" defaultValue={override?.value.src ?? ''} placeholder={currentSrc} style={{ width: '100%' }} />
            </p>
            <p className="small" style={{ margin: 0 }}>
              Alternative text — what a reader who cannot see the picture is told
              <input
                type="text"
                name="alt"
                defaultValue={override?.value.alt ?? ''}
                placeholder={currentAlt || 'Describe the photograph for a reader who cannot see it'}
                style={{ width: '100%' }}
              />
            </p>
            <p className="small" style={{ margin: 0 }}>
              Credit
              {creditKey ? (
                <> (<code>{creditKey}</code>)</>
              ) : (
                <> — this image has no credit slot in the design, so the field is closed rather than silently dropped</>
              )}
              <input
                type="text"
                name="credit"
                defaultValue={override?.value.credit ?? ''}
                placeholder={credit ?? ''}
                style={{ width: '100%' }}
                disabled={!creditKey}
              />
            </p>
          </EditForm>
        </div>
      </div>
    </>
  );
}

/* ==================================================================================================
 * 4. THE PAGE
 * ================================================================================================ */

const SECTION_LABELS: Record<EditorSection, string> = {
  colours: 'Colours',
  type: 'Fonts & type',
  texts: 'Text',
  images: 'Images',
  links: 'Links & hidden blocks',
};

export default async function DesignEditorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { account, capabilities } = await requireCapabilityOrRedirect('manage_design', '/admin/design/');
  const one = (key: string): string => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? '';
  };

  const db = await getDb();
  const [tokensResult, screens, overrides, favicon] = await Promise.all([
    designTokens(),
    designScreens(),
    listDesignOverrides(db),
    loadSiteFavicon(db),
  ]);

  const tokenOverrides = new Map<string, DesignOverride>();
  for (const override of overrides) {
    if (override.kind === 'token' && override.key.startsWith('--')) tokenOverrides.set(override.key.slice(2), override);
  }
  const values = new Map<string, string>();
  for (const token of tokensResult.tokens) {
    const override = tokenOverrides.get(token.name);
    values.set(
      token.name,
      override && typeof override.value.value === 'string' && override.value.value.length > 0
        ? override.value.value
        : tokensResult.served.get(token.name) ?? token.value
    );
  }
  const contrast = contrastReport(values);
  /** Which pairs are about which token, so a failing ratio is printed on the row it is about. */
  const pairsFor = (name: string) =>
    contrast.filter((row) => row.fg === name || row.bg === name).map((row) => ({ role: row.role, ratio: row.ratio, min: row.min, pass: row.pass }));

  const controls = tokenControls(tokensResult.tokens, values, new Set(tokenOverrides.keys()));
  const fontChoices = fontOptions(tokensResult.tokens);
  /** The classes that read as a colour in the palette's sense, including the two that are not colours. */
  const COLOURISH = new Set(['colour', 'gradient', 'shadow']);
  const colourTokens = controls.filter((c) => COLOURISH.has(c.effectiveClass));
  const typeTokens = controls.filter((c) => !COLOURISH.has(c.effectiveClass));
  const colourGroups = [...new Set(colourTokens.map((c) => c.group))];
  const typeGroups = [...new Set(typeTokens.map((c) => c.group))];

  const screen = one('screen') || screens.find((s) => s === 'about') || screens[0] || 'home';
  const from = Math.max(0, Number.parseInt(one('from'), 10) || 0);
  const sectionParam = one('section');
  const section: EditorSection | 'everything' | 'icon' = (
    sectionParam === 'everything' || sectionParam === 'icon'
      ? sectionParam
      : (EDITOR_SECTIONS as readonly string[]).includes(sectionParam)
        ? (sectionParam as EditorSection)
        : 'colours'
  ) as EditorSection | 'everything' | 'icon';

  /*
   * THE SERVED PAGE IS ASKED WHAT IT HOLDS ONLY WHEN THE LIST IS BEING DRAWN.
   *
   * `inventoryFor` fetches the served page — a fill, a head, an inventory pass — so doing it to render the
   * palette would spend that on every visit to every section and show the answer to nobody. **The owner's
   * complaint is that this page did too much at once; making it do less is part of the fix rather than a
   * tidy-up.** `allOnThisPage` is the one section that needs it.
   */
  const allOnThisPage = section === 'everything';
  const inventory = allOnThisPage ? await inventoryFor(screen, from) : { items: [] as InventoryItem[], total: 0 };
  const items = 'items' in inventory ? inventory.items : [];

  /*
   * AN EDIT MADE ON EVERY SCREEN IS STILL AN EDIT ON THIS ONE. A site-wide row is filed under `*` and served
   * on every screen the key names, so a lookup that only searched this screen's rows would hide the reset for
   * the very edits the owner most needs to be able to take back.
   */
  const screenOverrides = overrides.filter((o) => o.screen === screen);
  const sharedOverrides = overrides.filter((o) => o.screen === ALL_SCREENS && o.kind !== 'token');
  const overrideFor = (kind: string, key?: string) =>
    (key === undefined ? undefined : screenOverrides.find((o) => o.kind === kind && o.key === key))
    ?? (key === undefined ? undefined : sharedOverrides.find((o) => o.kind === kind && o.key === key));

  // The reach of a key is measured from the deliverable's 53 files, so it too is only built for the list.
  const reach = allOnThisPage
    ? await reachOf(items.flatMap((item) => (item.places ?? []).map((place) => place.key)))
    : () => [];
  const sectionHref = (next: string, extra: Record<string, string> = {}) =>
    `/admin/design/?${new URLSearchParams({ section: next, ...extra }).toString()}`;
  const backTo = sectionHref(section, { screen, ...(from > 0 ? { from: String(from) } : {}) });

  const tokenOverridesList = overrides.filter((o) => o.kind === 'token');
  const imageOverrides = overrides.filter((o) => o.kind === 'image');
  const linkOverrides = overrides.filter((o) => o.kind === 'link');
  const textOverrides = overrides.filter((o) => o.kind === 'text' || o.kind === 'hide');
  const failedPairs = contrast.filter((row) => !row.pass);
  const nextFrom = from + items.length;
  const placesTotal = allOnThisPage && 'items' in inventory ? inventory.total : null;

  /*
   * THE LOGO IS FOUND IN THE SERVED PAGE'S OWN INVENTORY, NOT HARD-CODED.
   *
   * Measured across the deliverable: the wordmark carries an `<img>` on exactly ONE of the 53 screens —
   * `home.html` — and every other screen draws the mark as the word `Ozikoro` in `<b>`. So this section says
   * which screen it is about rather than claiming to be site-wide, and the control is an ordinary `image`
   * override on `a.wordmark img`, which means it is already audited and already resettable.
   */
  const logo = logoSlotIn(items);
  const logoOverride = logo ? overrideFor('image', logo.key) : undefined;

  const nav: { key: EditorSection | 'everything' | 'icon'; label: string; count: number | null }[] = [
    { key: 'colours', label: SECTION_LABELS.colours, count: colourTokens.length },
    { key: 'type', label: SECTION_LABELS.type, count: typeTokens.length },
    { key: 'texts', label: SECTION_LABELS.texts, count: textOverrides.length },
    { key: 'images', label: SECTION_LABELS.images, count: imageOverrides.length },
    { key: 'icon', label: 'Icon (favicon)', count: favicon ? 1 : 0 },
    { key: 'links', label: SECTION_LABELS.links, count: linkOverrides.length },
    { key: 'everything', label: 'Everything on this page', count: placesTotal },
  ];

  return (
    <div className="admin-shell">
      <Head title="Appearance">
        <a className="btn btn-quiet" href={screen === 'home' ? '/' : `/${screen}/`} target="_blank" rel="noreferrer">
          Open {screen === 'home' ? 'the home page' : `/${screen}/`} in a new tab
        </a>
      </Head>

      <Notices saved={one('saved')} error={one('error')} />

      {/*
        ONE SECTION AT A TIME, AND THE SECTION IS A LINK.
        The owner's complaint is that everything was on one page; a row of links that changes what is drawn is
        the smallest answer that is also a real one. It is server-rendered with no JavaScript of its own, so
        the address bar says which section is open and a save returns to it.
      */}
      <nav className="admin-nav" aria-label="Design sections">
        <div className="admin-nav__inner">
          {nav.map((entry) => (
            <a
              key={entry.key}
              href={sectionHref(entry.key, entry.key === 'everything' ? { screen } : {})}
              aria-current={entry.key === section ? 'page' : undefined}
            >
              {entry.label}
              {entry.count === null ? null : <span className="small muted"> ({entry.count})</span>}
            </a>
          ))}
        </div>
      </nav>

      <Card title="What this can change, and where it is kept">
        <AtAGlance
          rows={[
            ['Every design screen', `${screens.length} screens, served from the deliverable and editable here`],
            ['Colour tokens', `${colourTokens.length} — ${colourTokens.filter((t) => t.role === 'meaning').length} of them carry meaning, not decoration`],
            ['Type, spacing and shape tokens', `${typeTokens.length}, of which ${typeTokens.filter((t) => t.control === 'font').length} are font families`],
            ['Edits in force', `${overrides.length}${overrides.length === 0 ? ' — nothing is stored, so every screen is exactly as the design made it' : ` — ${sharedOverrides.length + tokenOverridesList.length} of them reach more than one screen`}`],
            ['The site icon', favicon ? `${Math.round((favicon.bytes / 1024) * 10) / 10} KB ${favicon.mediaType}${favicon.actorName ? `, set by ${favicon.actorName}` : ''}` : 'not set — the archive serves its own mark'],
            ['Where they live', 'the database, applied at serve time'],
            ['The design files', 'not written to, ever — checked byte for byte against the handover copy'],
            ['Signed in as', `${account.account.displayName ?? account.account.email} (${[...capabilities].filter((c) => c === 'manage_design').join('') || 'no design capability'})`],
          ]}
        />
        <p className="small muted" style={{ marginTop: 'var(--s-4)' }}>
          An edit is a row: the value, who set it and when, and an audit entry every time it changes. It can be
          removed one at a time — every row below carries its own <b>put it back to the design</b> — or a whole
          screen at once, and <b>nothing here deletes anything from the design.</b> A heading that a serve-time
          fill writes (like <code>/donate/</code>&rsquo;s notice) is overridden after that fill runs, so an edit
          to one wins rather than being overwritten.
        </p>
      </Card>

      {/* ------------------------------------------------------------------ COLOURS */}
      {section === 'colours' ? (
        <Card title={`Colours — ${colourTokens.length} tokens`}>
          <p className="small muted">
            A token is the whole of a colour decision: <code>--accent</code> is read wherever the design draws a
            link or a mark, so changing it changes every one of them at once rather than restyling one
            component. The controls are grouped the way the design groups them, and each row prints the number
            of rules that read it <b>directly</b> — a token with 0 there is read through another token&rsquo;s
            value rather than by a rule, which is why <code>--paper-edge-firm</code> can be read 0 times and
            still be the rule on every hairline. <b>Nothing is blocked</b> — the palette is yours — but a token
            that carries meaning is marked and the contrast it has to reach is measured.
          </p>
          <p className="small muted">
            <b>A colour picker is only drawn where it cannot lose your value.</b> It holds <code>#rrggbb</code>
            and nothing else, so a gradient, a shadow, an <code>rgba()</code> colour or a token that points at
            another token gets a text field and a sentence instead of a picker that would quietly post black
            over it. <b>The hex is shown and editable on every colour row.</b>
          </p>
          {tokensResult.error ? <Notices error={`The design’s token file could not be read: ${tokensResult.error}`} /> : null}
          {colourGroups.map((group, index) => {
            const inGroup = colourTokens.filter((c) => c.group === group);
            const changed = inGroup.filter((c) => c.overridden).length;
            return (
              /*
                THE FIRST GROUP IS OPEN, AND THE REST ARE COLLAPSED.
                A heading with nothing under it is a page that looks broken, and a page with every token on it is
                the page the owner complained about. One group open says "the pickers are here"; the group names
                say where the others are; and a group the owner has already changed opens by itself so his own
                edits are never the thing he has to go looking for.
              */
              <details key={group} open={index === 0 || changed > 0} style={{ marginTop: 'var(--s-4)', borderTop: '1px solid var(--rule)', paddingTop: '.5rem' }}>
                <summary style={{ cursor: 'pointer' }}>
                  <b>{group}</b>{' '}
                  <span className="small muted">
                    {inGroup.length} token{inGroup.length === 1 ? '' : 's'}
                    {changed > 0 ? ` — ${changed} changed by you` : ' — all as the design made them'}
                  </span>
                </summary>
                {inGroup.map((control) => (
                  <TokenRow
                    key={control.token}
                    control={control}
                    servedValue={tokensResult.served.get(control.token) ?? ''}
                    contrast={pairsFor(control.token)}
                    returnTo={backTo}
                    fontChoices={fontChoices}
                  />
                ))}
              </details>
            );
          })}
        </Card>
      ) : null}

      {/* ------------------------------------------------------------------ FONTS & TYPE */}
      {section === 'type' ? (
        <Card title={`Fonts & type — ${typeTokens.length} tokens`}>
          <p className="small muted">
            The same mechanism as the colours, and a heavier decision. The design sets the leading generously so
            that tone marks do not touch the line above, and it chooses families that carry the Igbo dotted
            vowels and combining tone marks — <b>ị ọ ụ ñ Ị Ọ Ụ Ṅ and à á è é ì í ò ó ù ú</b> — in roman and in
            italic, in every weight. A substitute without them breaks the orthography rather than the look.
          </p>
          <p className="small muted">
            The <b>font families on offer are the ones the page actually loads</b>, read from the design&rsquo;s
            own request rather than typed here — so a choice cannot name a family the page will not render. The
            token&rsquo;s own stack is always editable as text, and it is where the design&rsquo;s fallbacks for
            a reader whose network blocks Google Fonts are written.
          </p>
          {fontChoices.length === 0 ? (
            <Notices error="The design’s font stacks could not be read, so no family can be offered. The text field on each row still works." />
          ) : null}
          {typeGroups.map((group, index) => {
            const inGroup = typeTokens.filter((c) => c.group === group);
            const changed = inGroup.filter((c) => c.overridden).length;
            // The first group open, as in the palette — see the note there.
            return (
              <details key={group} open={index === 0 || changed > 0} style={{ marginTop: 'var(--s-4)', borderTop: '1px solid var(--rule)', paddingTop: '.5rem' }}>
                <summary style={{ cursor: 'pointer' }}>
                  <b>{group}</b>{' '}
                  <span className="small muted">
                    {inGroup.length} token{inGroup.length === 1 ? '' : 's'}
                    {changed > 0 ? ` — ${changed} changed by you` : ' — all as the design made them'}
                  </span>
                </summary>
                {inGroup.map((control) => (
                  <TokenRow
                    key={control.token}
                    control={control}
                    servedValue={tokensResult.served.get(control.token) ?? ''}
                    contrast={pairsFor(control.token)}
                    returnTo={backTo}
                    fontChoices={fontChoices}
                  />
                ))}
              </details>
            );
          })}
        </Card>
      ) : null}

      {/* ------------------------------------------------------------------ TEXT */}
      {section === 'texts' ? (
        <Card title={`Text — ${textOverrides.length} change${textOverrides.length === 1 ? '' : 's'} in force`}>
          <p className="small muted">
            Each row below is <b>the sentence the page carries now</b> and <b>the sentence it will carry
            instead</b>. A text edit belongs to a place on a page rather than to a sentence, so a row filed
            under <i>every screen</i> changes that place wherever the design has it — the button beside the
            field says how many screens that is, measured from the deliverable.
          </p>
          {textOverrides.length === 0 ? (
            <p className="small muted">
              <b>Nothing here is changed, and that is the normal state.</b> Every heading, note, caption, button
              and form placeholder on the site is exactly as the design made it. To change one, open
              <a href={sectionHref('everything', { screen })}> Everything on this page</a>, find it by its words
              or its selector, and edit it — it will then appear here with its reset.
            </p>
          ) : (
            <>
              <AtAGlance
                rows={[
                  ['On every screen', `${textOverrides.filter((o) => o.screen === ALL_SCREENS).length} — served wherever the design carries that place`],
                  ['On /' + screen + '/', `${textOverrides.filter((o) => o.screen === screen).length}`],
                  ['On other screens', `${textOverrides.filter((o) => o.screen !== screen && o.screen !== ALL_SCREENS).length} — open that screen below to see and reset them`],
                ]}
              />
              <p className="small muted">
                Screens with a text edit:{' '}
                {[...new Set(textOverrides.map((o) => o.screen))].map((name, index) => (
                  <span key={name}>
                    {index > 0 ? ' · ' : null}
                    <a href={sectionHref('texts', { screen: name })}>{name === ALL_SCREENS ? 'every screen' : `/${name}/`}</a>
                  </span>
                ))}
              </p>
              <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr><th align="left">Where</th><th align="left">What</th><th align="left">It now says</th><th align="left">Reset</th></tr>
                </thead>
                <tbody>
                  {textOverrides.map((override) => (
                    <tr key={override.id} style={{ borderTop: '1px solid var(--rule)' }}>
                      <td className="small">{override.screen === ALL_SCREENS ? 'every screen' : `/${override.screen}/`}</td>
                      <td className="small">
                        <b>{override.label ?? override.key}</b>
                        <br /><code style={{ wordBreak: 'break-all' }}>{splitTextKey(override.key).selector}</code>
                        {splitTextKey(override.key).attr ? <> <code>{splitTextKey(override.key).attr}</code></> : null}
                      </td>
                      <td className="small">
                        {override.kind === 'hide' ? <Badge tone="fail">hidden — this block is left out of the page</Badge> : <q>{override.value.text}</q>}
                      </td>
                      <td>
                        <form method="post" action="/api/admin/design">
                          <input type="hidden" name="action" value="remove" />
                          <input type="hidden" name="id" value={String(override.id)} />
                          <input type="hidden" name="returnTo" value={sectionHref('texts')} />
                          <button className="btn btn-quiet" type="submit">Put it back</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Card>
      ) : null}

      {/* ------------------------------------------------------------------ IMAGES */}
      {section === 'images' ? (
        <Card title={`Images — ${imageOverrides.length} change${imageOverrides.length === 1 ? '' : 's'} in force`}>
          <p className="small muted">
            A photograph is its address, its alternative text and its credit, and they move together: a
            picture swapped without its credit is a picture whose reader cannot tell who took it, and one
            swapped without its alt text is one a screen reader describes wrongly. An address on this site is
            fetched before it is saved and a 404 refuses the save — with an explicit tick box for an image that
            will be uploaded afterwards.
          </p>
          {imageOverrides.length === 0 ? (
            <p className="small muted">
              <b>No photograph has been changed.</b> Every image on the site is the one the design put there.
              Images are edited in the list on each screen — <a href={sectionHref('everything', { screen })}>Everything on this page</a>{' '}
              for <code>/{screen}/</code> — where each one is shown with a preview as it is edited.
            </p>
          ) : (
            imageOverrides.map((override) => (
              <details key={override.id} open style={{ borderTop: '1px solid var(--rule)', padding: '.5rem 0' }}>
                <summary style={{ cursor: 'pointer' }}>
                  <b>{override.label ?? override.key}</b>{' '}
                  <span className="small muted">{override.screen === ALL_SCREENS ? 'on every screen' : `on /${override.screen}/`}</span>
                </summary>
                <ImageForm
                  screen={override.screen === ALL_SCREENS ? screen : override.screen}
                  itemKey={override.key}
                  title={override.label ?? override.key}
                  returnTo={sectionHref('images')}
                  override={override}
                  currentSrc=""
                  currentAlt=""
                  creditKey={override.value.creditKey}
                  credit={override.value.credit}
                  undoLabel="this photograph"
                  previewQuery={{
                    kind: 'image',
                    key: override.key,
                    screen: override.screen === ALL_SCREENS ? screen : override.screen,
                    src: override.value.src ?? '',
                    alt: override.value.alt ?? '',
                  }}
                />
              </details>
            ))
          )}
        </Card>
      ) : null}

      {/* ------------------------------------------------------------------ ICON (FAVICON) */}
      {section === 'icon' ? (
        <Card title="Icon — the mark in a browser tab">
          <p className="small muted">
            This is the favicon: the small picture beside the page title in a tab, in a bookmark and in a
            history list. It is <b>one setting for the whole site</b>, and it is served from{' '}
            <code>/favicon.ico</code> — <b>the address a browser asks for by itself</b> when a page declares no
            icon. That is what makes it reach every page here, including the fifty-three design screens and the
            archive&rsquo;s records, which are served from the approved design and never run this
            application&rsquo;s layout.
          </p>
          <p className="small muted">
            An SVG icon is also accepted; it is served as an image, not as a document, so nothing in it runs.
            The Apple touch icon on an iOS home screen is a different picture at a different size and is
            <b> not</b> changed here.
          </p>
          <AtAGlance
            rows={[
              ['Served at', <code key="h">/favicon.ico</code>],
              [
                'Now showing',
                favicon
                  ? `${Math.round((favicon.bytes / 1024) * 10) / 10} KB ${favicon.mediaType}${favicon.actorName ? `, set by ${favicon.actorName}` : ''}${favicon.updatedAt ? ` on ${new Date(favicon.updatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}`
                  : 'the archive’s own mark — nothing is stored for this setting',
              ],
              ['Who may change it', 'any account holding manage_design, and every change is written to the audit trail'],
            ]}
          />
          <div style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 'var(--s-4)' }}>
            <div style={{ flex: '0 0 12rem' }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- the served icon, at its real size and
                  deliberately not reshaped: what the owner is looking at here is what the tab shows. */}
              <img
                src={`/favicon.ico?v=${favicon ? encodeURIComponent(favicon.updatedAt ?? 'set') : 'default'}`}
                alt={favicon ? 'The site icon as it is served now' : 'The archive’s own mark, as it is served now'}
                width={64}
                height={64}
                style={{ border: '1px solid var(--rule)', background: 'var(--surface-sunk, #efe6d2)', imageRendering: 'pixelated' }}
              />
              <p className="small muted" style={{ margin: '.2rem 0 0' }}>
                What a tab shows now. The address carries the time it was set so that a change is visible here
                immediately rather than from a cache.
              </p>
            </div>
            <div style={{ flex: '1 1 24rem' }}>
              <form method="post" action="/api/admin/site-icons" encType="multipart/form-data">
                <input type="hidden" name="action" value="set" />
                <input type="hidden" name="returnTo" value={sectionHref('icon')} />
                <p className="small" style={{ margin: 0 }}>
                  Choose the image
                  <input type="file" name="icon" accept="image/png,image/jpeg,image/webp,image/x-icon,image/vnd.microsoft.icon,image/svg+xml" required style={{ display: 'block', width: '100%' }} />
                </p>
                <p className="small muted" style={{ margin: '.2rem 0' }}>
                  A PNG, JPEG, WebP, ICO or SVG. A square image of at least 64×64 is what a browser tab and a
                  bookmark both scale well; the setting accepts up to 200 KB.
                </p>
                <p className="small" style={{ margin: '.2rem 0' }}>
                  Note for the audit trail (optional)
                  <input type="text" name="note" maxLength={500} placeholder="e.g. the gold sun on a transparent ground" style={{ width: '100%' }} />
                </p>
                <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                  <button className="btn" type="submit">Save this icon for the whole site</button>
                </div>
              </form>
              <form method="post" action="/api/admin/site-icons" style={{ marginTop: '.5rem' }}>
                <input type="hidden" name="action" value="clear" />
                <input type="hidden" name="returnTo" value={sectionHref('icon')} />
                <button className="btn btn-quiet" type="submit" disabled={!favicon}>
                  {favicon ? 'Put the archive’s own mark back' : 'The archive’s own mark is already in force'}
                </button>
              </form>
            </div>
          </div>
        </Card>
      ) : null}

      {/* ------------------------------------------------------------------ LINKS & HIDDEN */}
      {section === 'links' ? (
        <Card title={`Links & hidden blocks — ${linkOverrides.length + overrides.filter((o) => o.kind === 'hide').length} in force`}>
          <p className="small muted">
            A link is where it goes and what it says; hiding a block leaves it out of the response without
            deleting anything, so the design file keeps it and the block can be shown again. Both are stored
            the same way as everything else on this page, and both can be put back one at a time.
          </p>
          {linkOverrides.length === 0 && overrides.filter((o) => o.kind === 'hide').length === 0 ? (
            <p className="small muted">
              <b>No link has been redirected and no block is hidden.</b> Every link goes where the design sends
              it and every block the design draws is drawn. To change one, open{' '}
              <a href={sectionHref('everything', { screen })}>Everything on this page</a>.
            </p>
          ) : (
            <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr><th align="left">Where</th><th align="left">What</th><th align="left">Now</th><th align="left">Reset</th></tr>
              </thead>
              <tbody>
                {[...linkOverrides, ...overrides.filter((o) => o.kind === 'hide')].map((override) => (
                  <tr key={override.id} style={{ borderTop: '1px solid var(--rule)' }}>
                    <td className="small">{override.screen === ALL_SCREENS ? 'every screen' : `/${override.screen}/`}</td>
                    <td className="small"><b>{override.label ?? override.key}</b><br /><code style={{ wordBreak: 'break-all' }}>{override.key}</code></td>
                    <td className="small">
                      {override.kind === 'hide'
                        ? <Badge tone="fail">hidden — left out of the page</Badge>
                        : <>{override.value.label ? <><q>{override.value.label}</q> → </> : null}<code>{override.value.href}</code></>}
                    </td>
                    <td>
                      <form method="post" action="/api/admin/design">
                        <input type="hidden" name="action" value="remove" />
                        <input type="hidden" name="id" value={String(override.id)} />
                        <input type="hidden" name="returnTo" value={sectionHref('links')} />
                        <button className="btn btn-quiet" type="submit">Put it back</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}

      {/* ------------------------------------------------------------------ EVERYTHING ON THIS PAGE */}
      {section === 'everything' ? (
        <>
          <Card title={`Everything on /${screen}/`}>
            <p className="small muted">
              This is the <b>served</b> page — after the archive&rsquo;s own fills have run — so a heading the
              archive writes at serve time is offered here and a button a fill has deleted is not. It is the
              list the named sections are built from, kept because they cannot express
              &ldquo;the third paragraph on this page&rdquo;.
            </p>
            <p className="small muted">
              The header, the menu and the footer are the same markup in every screen file, so their words
              appear on up to {screens.length} screens. Where the design carries a place on more than one
              screen the row offers a second button — <b>change everywhere it appears</b> — which writes{' '}
              <b>one</b> row served wherever that place exists, instead of the same edit typed {screens.length}
              {' '}times.
            </p>
            {/*
              THE LOGO, FIRST, WHERE THE OWNER NAMED IT.

              It is an ordinary `image` override on the wordmark's own `<img>`; this section is what turns it
              into a named control. It is drawn only on a screen whose served page actually carries that image,
              and it says which screen that is, because the deliverable draws the mark as an image on ONE of
              the 53 screens and as the word `Ozikoro` on the other 52. A control that claimed otherwise would
              be a promise the page cannot keep.
            */}
            <details open style={{ borderTop: '1px solid var(--rule)', marginTop: 'var(--s-4)', paddingTop: '.5rem' }}>
              <summary style={{ cursor: 'pointer' }}><b>Masthead logo</b>{' '}</summary>
              {logo ? (
                <>
                  <p className="small muted" style={{ margin: '.4rem 0' }}>
                    The mark beside the site name at the top of <code>/{screen}/</code>. It is stored as an
                    ordinary image override keyed to the wordmark&rsquo;s own slot — <code>{logo.key}</code> — so
                    it is attributed, audited and resettable like every other picture here.
                  </p>
                  <ImageForm
                    screen={screen}
                    itemKey={logo.key}
                    title="Masthead logo"
                    returnTo={backTo}
                    override={logoOverride}
                    currentSrc={logo.src}
                    currentAlt={logo.alt}
                    undoLabel="the logo"
                    previewQuery={{ kind: 'image', key: logo.key, screen, src: logoOverride?.value.src ?? logo.src, alt: logoOverride?.value.alt ?? logo.alt }}
                  />
                </>
              ) : (
                <p className="small muted" style={{ margin: '.4rem 0' }}>
                  <b>This screen draws the site name without a picture.</b> Measured across the deliverable, the
                  wordmark carries an <code>&lt;img&gt;</code> on <code>home.html</code> alone; the other screens
                  draw the mark as the word <i>Ozikoro</i> in bold. There is no image here to change, so no
                  control is offered — open <a href={sectionHref('everything', { screen: 'home' })}>Everything on /home/</a>{' '}
                  to edit the logo. Changing the 52 wordmark screens would mean editing the design deliverable,
                  which this editor does not do and must not.
                </p>
              )}
            </details>

            <nav aria-label="Design screens">
              <p className="small" style={{ lineHeight: 2 }}>
                {screens.map((s, index) => (
                  <span key={s}>
                    {index > 0 ? ' · ' : null}
                    <a href={sectionHref('everything', { screen: s })} aria-current={s === screen ? 'page' : undefined}>
                      {s === screen ? <b>{s}</b> : s}
                    </a>
                  </span>
                ))}
              </p>
            </nav>

            {'error' in inventory ? (
              <Notices error={`The list of editable places on /${screen}/ could not be read. ${inventory.error}`} />
            ) : (
              <>
                <AtAGlance
                  rows={[
                    ['Screen', <code key="s">/{screen}/</code>],
                    ['Places on this screen', `${items.length} shown of ${inventory.total}${from > 0 ? `, from number ${from + 1}` : ''}`],
                    ['Text places offered', `${items.reduce((n, i) => n + (i.places?.length ?? 0), 0)}`],
                    ['Edits on this screen', `${screenOverrides.length}`],
                    ['Edits on every screen', `${sharedOverrides.length + tokenOverridesList.length}${sharedOverrides.length + tokenOverridesList.length === 0 ? ' — nothing is changed site-wide' : ''}`],
                    ['Photographs', `${items.filter((i) => i.can.image).length}`],
                    ['Links', `${items.filter((i) => i.can.link).length}`],
                  ]}
                />
                {inventory.total > items.length || from > 0 ? (
                  <p className="small" style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span className="muted">Showing places {from + 1}–{from + items.length} of {inventory.total} on /{screen}/.</span>
                    {from > 0 ? (
                      <a href={sectionHref('everything', { screen, from: String(Math.max(0, from - INVENTORY_LIMIT)) })}>← Previous {INVENTORY_LIMIT}</a>
                    ) : null}
                    {nextFrom < inventory.total ? (
                      <a href={sectionHref('everything', { screen, from: String(nextFrom) })}>Next {Math.min(INVENTORY_LIMIT, inventory.total - nextFrom)} places →</a>
                    ) : null}
                  </p>
                ) : null}
                {items.map((item) => (
                  <ElementRow
                    key={item.key}
                    item={item}
                    screen={screen}
                    from={from}
                    override={overrideFor}
                    reach={reach}
                    screensTotal={screens.length}
                  />
                ))}
                {nextFrom < inventory.total ? (
                  <p style={{ marginTop: 'var(--s-4)' }}>
                    <a className="btn btn-quiet" href={sectionHref('everything', { screen, from: String(nextFrom) })}>
                      Next {Math.min(INVENTORY_LIMIT, inventory.total - nextFrom)} places on /{screen}/ →
                    </a>
                  </p>
                ) : null}
              </>
            )}
          </Card>
        </>
      ) : null}

      {/* ------------------------------------------------------------------ UNDO */}
      <Card title="Undo — one thing, this screen, or everything">
        <p className="small muted">
          Removing an edit returns the page to the design&rsquo;s own value. It is safe to do either of these
          at any time: nothing is deleted from the design, and every removal is written to the audit trail with
          your name on it.
        </p>
        <p className="small muted">
          <b>An edit made on every screen is not removed by &ldquo;put this page back&rdquo;.</b> It is one row
          filed under every screen, so it is undone in the list below — one row, one Undo — or by &ldquo;put
          every screen back&rdquo;. That is deliberate: a site-wide change belongs to no single page, and a
          button on the page you happen to be looking at is the wrong place to delete it from.
        </p>
        <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap' }}>
          <form method="post" action="/api/admin/design">
            <input type="hidden" name="action" value="reset-screen" />
            <input type="hidden" name="screen" value={screen} />
            <input type="hidden" name="returnTo" value={backTo} />
            <button className="btn" type="submit" disabled={screenOverrides.length === 0}>
              Put /{screen}/ back to the design ({screenOverrides.length})
            </button>
          </form>
          <form method="post" action="/api/admin/design">
            <input type="hidden" name="action" value="reset-all" />
            <input type="hidden" name="returnTo" value={sectionHref('colours')} />
            <button className="btn btn-quiet" type="submit" disabled={overrides.length === 0}>
              Put every screen back to the design ({overrides.length})
            </button>
          </form>
        </div>
        <h3 style={{ marginTop: 'var(--s-5)' }}>Every edit in force</h3>
        {overrides.length === 0 ? (
          <p className="small muted">
            <b>None. Every screen is exactly as the design made it</b> — the archive&rsquo;s own colours, its own
            fonts, its own words, its own pictures and its own mark in the tab. This is the state the site is
            built to be in, and an empty list here is not a fault.
          </p>
        ) : (
          <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr><th align="left">Section</th><th align="left">Screen</th><th align="left">Kind</th><th align="left">What</th><th align="left">Value</th><th align="left">By</th><th align="left">When</th><th /></tr>
            </thead>
            <tbody>
              {overrides.map((override) => (
                <tr key={override.id} style={{ borderTop: '1px solid var(--rule)' }}>
                  <td className="small">{SECTION_LABELS[sectionOf(override)]}</td>
                  <td className="small">{override.screen === ALL_SCREENS ? 'every screen' : `/${override.screen}/`}</td>
                  <td className="small">{override.kind}</td>
                  <td className="small">{override.label ?? override.key}</td>
                  <td className="small"><code style={{ wordBreak: 'break-all' }}>{valueSummary(override)}</code></td>
                  <td className="small">{override.actorName ?? '—'}</td>
                  <td className="small">{new Date(override.updatedAt ?? '').toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td>
                    <form method="post" action="/api/admin/design">
                      <input type="hidden" name="action" value="remove" />
                      <input type="hidden" name="id" value={String(override.id)} />
                      <input type="hidden" name="returnTo" value={backTo} />
                      <button className="btn btn-quiet" type="submit">Undo</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ------------------------------------------------------------------ CONTRAST */}
      <Card title="Contrast — measured, not asserted">
        <p className="small muted">
          Every pair of colours the design actually puts on top of one another, with the ratio the standard asks
          for. <b>4.5:1</b> is WCAG 2.2 AA for text; <b>3:1</b> is the floor for a focus ring and for text that
          is deliberately faint.{' '}
          {failedPairs.length === 0
            ? 'Every pair passes as the palette stands.'
            : `${failedPairs.length} pair${failedPairs.length === 1 ? '' : 's'} FAIL as the palette stands — the rows below say which, and the token rows carry the same warning.`}
        </p>
        <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr><th align="left">Where</th><th align="left">Text</th><th align="left">On</th><th align="left">Ratio</th><th align="left">Needs</th></tr>
          </thead>
          <tbody>
            {contrast.map((row) => (
              <tr key={`${row.fg}-${row.bg}`}>
                <td className="small">{row.role}</td>
                <td className="small"><code>--{row.fg}</code> <Swatch value={row.fgValue} /></td>
                <td className="small"><code>--{row.bg}</code> <Swatch value={row.bgValue} /></td>
                <td className="small"><b>{row.ratio ?? '—'}:1</b></td>
                <td className="small">{row.min}:1 {row.pass ? <Badge tone="pass">pass</Badge> : <Badge tone="fail">fail</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted" style={{ marginTop: 'var(--s-4)' }}>
          {CONTRAST_PAIRS.length} pairs are checked. A colour used somewhere this table does not know about is
          not checked — the pairs are the ones the design&rsquo;s own stylesheets create, and the design is what
          says which colours sit on which.
        </p>
      </Card>
    </div>
  );
}
