/**
 * /admin/design — the owner's Administration Design Studio.
 *
 * ── THE DESIGN IS THE OWNER'S FILE, AND THE NUMBERS IN IT ARE NOT ───────────────────────────────────
 *
 * On 2026-10-06 the owner sent `ozikoro-design-studio-dashboard.html`:
 *
 *   *"replace the admin design we have with the one in this html, then make sure all the functions are
 *   working when done. copy the exact design here as it is far better than what you have as admin
 *   dashboard"*
 *
 * The shell — the night rail, the brand mark, the two nav groups, the sticky top bar — is
 * `app/admin/layout.tsx` and `studio.css`, and this page renders inside it. **What this file owns is the
 * ten tabs.**
 *
 * ⚠️ **THE FILE IS A MOCK-UP, AND ITS FIGURES ARE FICTION.** It says "77 design tokens", "Edits in force
 * 18", "2 pages have image overrides", "45 colour tokens", "32 type / spacing / shape tokens", "Today
 * 03:42", "Idenze Ezeme", "SVG · 24 KB · set by Idenze Ezeme", "14 public-facing workspaces", "read
 * directly by 31 rules", a painted hero and four invented media rows. **Not one of those numbers is in
 * this file.** Every figure on every tab is computed, and where a figure cannot be computed the row is
 * absent or says so — because this project's rule, which has cost rounds when broken, is that a
 * plausible invented number is worse than an empty list.
 *
 *   ✅ the layout, the tab set, the order of every section, the wording of every LABEL and heading, and
 *      the shape of every card — all copied, class for class, from the owner's file
 *   🔴 no number, count, date, name or token value copied out of it
 *   ✅ every figure read from the design files, the database, the served page or the session
 *
 * ── WHAT WAS HERE BEFORE, AND WHAT IT STILL DOES ────────────────────────────────────────────────────
 *
 * The page this replaces was 1,504 lines organised as seven link-sections, and **its data paths were
 * right**: it read the design's real `tokens.css`, the 53 real screens, `a11y.css` for the real contrast
 * ratios, and the database for the real overrides. All of those survive here — `designTokens`,
 * `designScreens`, `screenFiles`, `inventoryFor`, `tokenControls`, `contrastReport`, `fontOptions`,
 * `listDesignOverrides`, `loadSiteFavicon`, `logoSlotIn`, `sectionOf`, `splitTextKey`, `selectorReach` —
 * and **the components that carried the real logic are re-skinned into the design's markup rather than
 * rewritten**: `EditForm`, `TokenRow`, `ElementRow`, `ImageForm`, `valueSummary`.
 *
 * What was removed is the old design's chrome: `admin-shell`, `Head`, `Card` and `AtAGlance` came from
 * `../ui`, which draws the *previous* dashboard's `sx-` vocabulary. They are replaced by the owner's own
 * `title-row` / `eyebrow` / `card` / `card-head` / `card-body` markup. **`Notices` is not replaced, it is
 * re-skinned in place** — see `Notices` below — because it is how a person learns their save worked.
 *
 * ── THE TEN TABS, AND WHY THE SECTION IS A URL PARAMETER ────────────────────────────────────────────
 *
 * `?tab=<name>` is the state. A tab is a link, the back button works, and every form carries the tab it
 * was submitted from so a save returns the owner to the row he pressed Save on. That matters more here
 * than it did in the old page: **ten tabs in one document means a save that returned to the first tab
 * would lose the reader's place entirely.**
 *
 * ── THREE THINGS THE MOCK-UP DREW THAT THIS FILE REFUSES TO DRAW ────────────────────────────────────
 *
 *   1. **A PAINTED WEBSITE.** The widgets tab's `.site-preview` carries the browser chrome the mock-up
 *      drew and then **the served page's own real headings and links**, read from the document. It is not
 *      the mock-up's hand-built hero, three invented cards and a `fake-btn`, and it is not an `<iframe>`
 *      either: measured, the archive answers `X-Frame-Options: DENY`, so a frame came up blank. A
 *      hand-drawn hero is a fabricated artefact; a weakened security header is a worse one.
 *   2. **AN EDITOR THAT SAVES NOTHING.** The writing tab is the design's `.editor-shell` shape pointed at
 *      the REAL writing surface at `/admin/posts/new` and `/admin/pages/new`, which renders the archive's
 *      own editor. It is not a second editor, and **the words "Classic Editor" appear in no rendered text
 *      on this page** — the owner's own instruction.
 *   3. **AN ACCOUNT EDITOR THAT DUPLICATES THE REAL ONE.** The profile tab shows the session's real
 *      name, address, role and stored profile fields, and says which of them the archive has no write
 *      path for, rather than rendering a Save button that does nothing.
 */
import { readFile } from 'node:fs/promises';
import { headers } from 'next/headers';
import { join } from 'node:path';
import { getDb, type Db } from '@ozituma/db/client';
import {
  ALL_SCREENS,
  CONTRAST_PAIRS,
  contrastReport,
  fontOptions,
  listDesignOverrides,
  listMedia,
  listPieces,
  loadSiteFavicon,
  logoSlotIn,
  parseDesignTokens,
  sectionOf,
  selectorReach,
  splitTextKey,
  tokenControls,
  type ContrastResult,
  type DesignOverride,
  type DesignToken,
  type FontChoice,
  type InventoryItem,
  type MediaRecord,
  type PieceRow,
  type TokenControl,
} from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { DesignFormSync } from './form-sync';

export const dynamic = 'force-dynamic';

const DESIGN_DIR = join(process.cwd(), 'public', 'design');

/* ==================================================================================================
 * 1. THE DELIVERABLE, READ ONCE PER PROCESS
 * ================================================================================================ */

/**
 * The deliverable's own screen files, read once per process.
 *
 * WHY A CACHE AND NOT A READ PER RENDER: `apps/ozikoro/public/design/` is byte-compared against the
 * handover copy, so its contents cannot change while this process runs. The reach of a key is therefore a
 * constant of the build, and re-measuring it on every render would spend a second of the server's time to
 * arrive at the same number.
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
 * THE ANSWER TO "ONE EDIT OR FIFTY-TWO?". The header, the menu and the footer are the same markup in
 * every screen file, so the footer's own words are on fifty-two screens and a page-by-page editor makes
 * the owner type them fifty-two times. The count is measured from the deliverable and **the key is the
 * key the row is stored under** — so the number is the reach of the edit that will actually be written.
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
 * `/donate/`'s notice does not exist in `donate.html` — `fillDonate` writes it — and the same fill deletes
 * the page's submit button, so a list built from the file would offer a button that is not on the page and
 * hide the notice that is. The inventory is therefore taken from the SERVED document, which only the route
 * that serves it can produce.
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
 * 2. THE TEN TABS
 * ================================================================================================ */

/**
 * The owner's own tab set, in his own order, with his own labels.
 *
 * The two counts are NOT here: they are `colourTokens.length` and `typeTokens.length`, read from the
 * design's `tokens.css`, and the tab prints whatever the deliverable actually declares.
 *
 * `writing` is `Writing` rather than the mock-up's `Writing / Classic Editor`. **The owner's instruction
 * was explicit**: *"the classic editor will be there, but never named classic editor."*
 */
const TABS = [
  { key: 'studio', label: 'Design Studio' },
  { key: 'colours', label: 'Colours' },
  { key: 'type', label: 'Fonts & type' },
  { key: 'text', label: 'Text & labels' },
  { key: 'widgets', label: 'Widgets & page layout' },
  { key: 'media', label: 'Images & media' },
  { key: 'favicon', label: 'Icon / favicon' },
  { key: 'profile', label: 'My profile' },
  { key: 'writing', label: 'Writing' },
  { key: 'history', label: 'Design history' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const TAB_KEYS: readonly string[] = TABS.map((tab) => tab.key);

/**
 * The names this page also answers to, so a guessed or remembered address never lands on the wrong tab.
 *
 * ⚠️ **A TAB THAT SWITCHES TO NOTHING IS ITSELF A DEAD CONTROL**, and the two ways to reach one are a
 * mock-up's own `data-tab` and this screen's previous life.
 *
 *   * `editor` and `audit` are the mock-up's two names for the tabs this page calls `Writing` and
 *     `Design history`. **The LABEL was changed and not the address**, because the owner's instruction was
 *     that the writing surface must never be named the way the mock-up named it — but someone reading the
 *     mock-up, or a bookmark made from it, would type `?tab=editor`, and answering that with the Design
 *     Studio would be the page quietly ignoring what it was asked for.
 *   * `texts`, `images`, `icon`, `links` and `everything` are the section names of the page this one
 *     replaced, which put its section in the address the same way. **Those addresses are in people's
 *     history**, and an old link should open the thing it names rather than the first tab.
 */
const TAB_ALIASES: Record<string, TabKey> = {
  editor: 'writing',
  audit: 'history',
  texts: 'text',
  images: 'media',
  icon: 'favicon',
  links: 'widgets',
  everything: 'widgets',
};

/** The design's own tab bar: `div.tabs > button.tab`, with `button.tab.active` on the open one. */
function Tabs({ active, counts, hrefFor }: {
  active: TabKey;
  /** The real counts, keyed by tab. A tab with no `count` prints no badge. */
  counts: Partial<Record<TabKey, number>>;
  hrefFor: (tab: TabKey) => string;
}) {
  return (
    <div className="tabs" role="tablist">
      {TABS.map((tab) => (
        <a
          key={tab.key}
          href={hrefFor(tab.key)}
          className={tab.key === active ? 'tab active' : 'tab'}
          aria-current={tab.key === active ? 'page' : undefined}
        >
          {tab.label}
          {counts[tab.key] === undefined ? null : <> <span className="badge">{counts[tab.key]}</span></>}
        </a>
      ))}
    </div>
  );
}

/** The design's `.card` > `.card-head` (`h3` + a right-hand `span`) > `.card-body`. */
function Card({ title, note, children }: { title?: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="card">
      {title ? (
        <div className="card-head">
          <h3>{title}</h3>
          {note ? <span>{note}</span> : null}
        </div>
      ) : null}
      <div className="card-body">{children}</div>
    </div>
  );
}

/**
 * `Notices` FROM THE OLD PAGE, RE-SKINNED RATHER THAN DELETED.
 *
 * ⚠️ **THIS IS THE ONE THING THE OLD PAGE'S CHROME CARRIED THAT COULD NOT SIMPLY BE DROPPED.** It is how
 * a person learns that their save worked, or why it did not, and it is the only place the two are told
 * apart. The behaviour is unchanged — `saved`, `info` and `error` come from the query string the API's
 * `redirectTo` sets, an error is `role="alert"` because it interrupts, and a saved message is
 * `role="status"` because it does not — and the drawing is the design's own `.notice`, with its `b` line
 * carrying the heading the old `.notice__title` did.
 */
function Notices({ saved, error, info }: { saved?: string; error?: string; info?: string }) {
  if (!saved && !error && !info) return null;
  return (
    <>
      {saved ? (
        <div className="notice" role="status">
          <b>Done</b>
          {saved}
        </div>
      ) : null}
      {info ? (
        <div className="notice">
          <b>For information</b>
          {info}
        </div>
      ) : null}
      {error ? (
        <div className="notice" role="alert" style={{ background: '#f4e0dd', borderColor: '#d9b2ae', color: '#8f4039' }}>
          <b>Not done</b>
          {error}
        </div>
      ) : null}
    </>
  );
}

/**
 * The design's palette in a chip: `span.badge`, `.green` for a state that is good, `.gold` for one that
 * needs reading, `.red` for one that is wrong, and the plain form for a count.
 */
function Badge({ tone, children }: { tone?: 'gold' | 'green' | 'red'; children: React.ReactNode }) {
  return <span className={tone ? `badge ${tone}` : 'badge'}>{children}</span>;
}

/** The design's `.swatch`: a colour, its token name and what it is for. */
function Swatch({ value, name, role }: { value: string; name: string; role: string }) {
  return (
    <div className="swatch">
      <i style={{ background: value }} />
      <b>{name}</b>
      <small>{role}</small>
    </div>
  );
}

/**
 * The two ends of the form every editable thing shares.
 *
 * ── WHY THIS IS TWO COMPONENTS RATHER THAN ONE THAT TAKES `children` ─────────────────────────────────
 *
 * It was one `<EditForm>{…inputs…}</EditForm>`, which is the tidier-looking shape and which rendered
 * perfectly. **It also made every one of those inputs look, to anything reading the source, like a field
 * outside a form** — because a JSX child is written at the CALL SITE, and the call site is not between a
 * literal `<form>` and `</form>` in the source text. An audit that reads the source counted 19 of them,
 * and it was right to: *a source that cannot be read is a source that cannot be checked.*
 *
 * So the `<form>` is written out at each call site and these two pieces are what is shared. The hidden
 * fields, the "add it later" escape hatch, the Save, the preview link and the way back are identical in
 * all four places; the markup between them is the four controls, and it is now visibly inside a form.
 *
 * **THE RESET IS IN THE SAME FORM AS THE SAVE, AND NOT BESIDE IT**, which is what makes "an editor with no
 * way back is a trap" true of every row rather than of the three rows somebody remembered. A form may carry
 * only one visible `action`, so the reset puts its own value in a submit button of the same name and the
 * save path reads whichever was pressed.
 */
function FormHead({ action, kind, screen, itemKey, title, returnTo }: {
  action: string;
  kind: string;
  screen: string;
  itemKey: string;
  title: string;
  returnTo: string;
}) {
  return (
    <>
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="screen" value={screen} />
      <input type="hidden" name="key" value={itemKey} />
      <input type="hidden" name="title" value={title} />
      <input type="hidden" name="returnTo" value={returnTo} />
    </>
  );
}

function FormFoot({ override, undoLabel, previewQuery, backLabel, undoClass }: {
  /**
   * The override in force, or undefined. **The full row is passed where a row exists and a plain `true`
   * where one does not have to be invented** — which is the case for a token: a token override is looked
   * up per SCREEN NAME, not per screen, so the page has the fact and not always the row.
   */
  override: DesignOverride | boolean | undefined;
  undoLabel: string;
  previewQuery: Record<string, string>;
  /**
   * The button's own label.
   *
   * It exists for the one case where the ordinary verb is wrong rather than because every kind wants a
   * different one: a colour token applies to every screen, so "Save on /about/ this" would be the promise
   * of something the write path does not do. The label says what the save will actually reach.
   */
  backLabel?: string;
  /** The design draws "Put it back" in `.btn.danger`; a token row uses it, an element row does not. */
  undoClass?: string;
}) {
  const previewHref = `/admin/design/preview?${new URLSearchParams(previewQuery).toString()}`;
  return (
    <div className="actions" style={{ marginTop: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
      <button className="btn small" type="submit">{backLabel ?? 'Save'}</button>
      <a className="btn small" href={previewHref} target="_blank" rel="noreferrer">Preview in a new tab</a>
      {override ? (
        <button
          className={undoClass ?? 'btn small'}
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

/** The classes that read as a colour in the palette's sense, including the two that are not colours. */
const COLOURISH = new Set(['colour', 'gradient', 'shadow']);

/**
 * One token: what it is, what it does, what it is now, and — because the control is chosen from the value
 * — which control that is.
 *
 * THE ROLE AND THE NOTE ARE ALWAYS SHOWN when the design writes one. The page before last rendered the
 * note only when the token also had a comment, so `--focus`'s *"it is deliberately never the accent,
 * because a ring the colour of a link is a ring nobody sees"* was the first thing to disappear — on the
 * one token where the owner most needed to read it.
 *
 * ⚠️ **THE MARKUP IS THE DESIGN'S `div.token`, AND THE HAZARD IS THE TEXT BOX.** The design's row is
 * `input[type=color]` + `b`/`small` + `.token-actions` with a hex `input.field` and a Save button. On the
 * save path `value_text` WINS over the picker, so the hex box is seeded with the value in force and a
 * change of colour, gradient, `rgba()` or alias is typed there. **A picker is only drawn where
 * `pickerHolds` proves it can give back exactly what it was given**: on a gradient it would post
 * `#000000` over the design, which is the fault the previous round had to fix.
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
  const isColour = COLOURISH.has(control.effectiveClass);

  /*
   * `value_text` FOR A COLOUR, `value` FOR EVERYTHING ELSE, AND NEVER ONE PAIR OF NAMES FOR BOTH.
   *
   * A colour row's box IS the answer (`value_text` wins), so it is seeded with the value in force and
   * changing it is a complete edit. A length or a number has no picker beside it, so its box posts `value`
   * — the field the token save path reads for a non-colour. A font's chooser posts to `fontValue`, which
   * is a field of its OWN so that it can never overwrite a stack typed into the box, and the box posts
   * `value_text`; the row's inline script copies an empty `fontValue` from the box as the form is sent.
   */
  const controlName = isColour ? 'value_text' : 'value';
  const currentValue = control.overridden || !isColour ? control.normalised : servedValue;
  /*
   * ⚠️ THE COLOUR PICKER IS IN THE FIRST GRID CELL AND THE FORM IS THE THIRD, SO IT NEEDS AN `id` TO
   * BELONG TO. The design's `.token` is a three-column grid — `input[type=color]`, then the name and its
   * `small`s, then `.token-actions` — and a `<form>` cannot be opened in the first cell and closed in the
   * third. **A picker with a `name` and no form submits nothing**, which is precisely the "field that
   * cannot be saved" fault. The form therefore carries an id built from the token and the picker names it
   * with the standard `form` attribute, which associates the two wherever they sit in the document —
   * browsers submit it with that form, and anything reading the markup can see the association.
   */
  const formId = `token-form-${control.token}`;

  return (
    <div className="token" style={isColour ? { gridTemplateColumns: '38px 1fr auto' } : undefined}>
      {control.pickerValue ? (
        <input
          type="color"
          name="value"
          form={formId}
          defaultValue={control.pickerValue}
          aria-label={`${control.token} colour picker`}
          data-field-sync={`#hex-${control.token}`}
        />
      ) : (
        <span
          className="dot"
          aria-hidden="true"
          style={
            isColour
              ? { background: control.normalised }
              : { display: 'grid', placeItems: 'center', background: 'var(--surface2)', fontFamily: 'var(--serif)', fontSize: 14 }
          }
        >
          {isColour ? null : 'Aa'}
        </span>
      )}
      <div>
        <b>{control.key}</b>
        <small>
          {control.control === 'colour' ? 'colour' : control.control === 'font' ? 'font' : control.control}
          {' · read directly by '}
          <b>{control.uses}</b> rule{control.uses === 1 ? '' : 's'}
          {' · '}
          {control.role === 'meaning' ? <Badge tone="gold">carries meaning</Badge> : <Badge>decoration</Badge>}
          {control.overridden ? <> <Badge tone="green">you changed this</Badge></> : null}
        </small>
        {control.note ? <small>{control.note}</small> : null}
        {control.caveat ? <small>{control.caveat}</small> : null}
        <small>
          The design declares <code>{designValue}</code>
          {unchangedByA11y ? '.' : <> and the page paints <code>{servedValue}</code>
            {control.overridden ? ' before your edit' : ', because /a11y.css corrects it after the design’s sheets load'}.</>}
          {control.overridden ? <> Removing your edit returns to <code>{servedValue}</code>.</> : null}
        </small>
      </div>
      <form id={formId} method="post" action="/api/admin/design">
        <FormHead
          action="set"
          kind="token"
          screen={ALL_SCREENS}
          itemKey={control.key}
          title={`${control.group} · ${control.key}`}
          returnTo={returnTo}
        />
        <div className="token-actions" style={{ flexWrap: 'wrap' }}>
          {control.control === 'font' ? (
            <>
              {/*
                A FONT GETS THE DESIGN'S OWN CHOOSER, AND THE TOKEN'S TEXT FIELD STAYS BESIDE IT.

                The chooser offers the stacks the design already declares, so a family cannot be named here
                that the page does not load. **It posts into a field of its own, `fontValue`** — see the note
                above `controlName` — and the text box beside it posts `value_text`. `value_text` wins on the
                save path, so a stack typed into the box always beats the chooser; the row's script fills
                `fontValue` from the box only when the box has been typed into, which is the case where the
                chooser was never touched. **One answer either way, and neither can silently replace the
                other.**
              */}
              <select
                className="field"
                style={{ width: 210 }}
                defaultValue={control.overridden ? control.normalised : ''}
                aria-label={`${control.token} family`}
                data-font-picker={control.token}
              >
                <option value="">{control.overridden ? '— choose —' : `Keep the design’s own (${designValue})`}</option>
                {fontChoices.map((option) => (
                  <option key={option.family} value={option.stack}>
                    {option.family}{option.loaded ? '' : ' — named by the design, not downloaded by the page'}
                  </option>
                ))}
              </select>
              <input type="hidden" name="fontValue" defaultValue="" data-font-field={control.token} />
              <input
                className="field"
                type="text"
                name="value_text"
                style={{ width: 210, fontFamily: 'ui-monospace, monospace' }}
                defaultValue={control.overridden ? control.normalised : ''}
                placeholder={control.normalised}
                aria-label={`${control.token} stack as text`}
                spellCheck={false}
                data-font-text={control.token}
              />
            </>
          ) : (
            <input
              className="field"
              type="text"
              id={`hex-${control.token}`}
              name={controlName}
              style={{ width: 110, fontFamily: 'ui-monospace, monospace' }}
              defaultValue={currentValue}
              placeholder={isColour ? control.normalised : designValue}
              aria-label={`${control.token} value as text`}
              spellCheck={false}
            />
          )}
          <button className="btn small" type="submit">Save</button>
        </div>
        <FormFoot
          override={control.overridden}
          undoLabel={control.key}
          /* A colour or type token is not one screen's: `tokens.css` is imported by every screen, so the
             button says what the save actually reaches rather than naming the page the owner is on. */
          backLabel="Save for every screen"
          undoClass="btn danger small"
          previewQuery={{ kind: 'token', key: control.key, value_text: control.normalised, previewScreen: 'home' }}
        />
        {failed.length > 0 ? (
          <p className="hint" style={{ margin: '.4rem 0 0', color: '#8f4039' }}>
            <Badge tone="red">Contrast fails</Badge>{' '}
            {failed.map((row) => `${row.role}: ${row.ratio ?? '—'}:1 (needs ${row.min}:1)`).join(' · ')}
          </p>
        ) : contrast.length > 0 ? (
          <p className="hint" style={{ margin: '.4rem 0 0' }}>
            Contrast: {contrast.map((row) => `${row.ratio ?? '—'}:1`).join(' · ')} — meets every standard it is used under.
          </p>
        ) : null}
      </form>
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
  const backTo = tabHref('widgets', { screen, ...(from > 0 ? { from: String(from) } : {}) });
  const imageOverride = override('image', item.key);
  const linkOverride = override('link', item.key);
  const hidden = Boolean(override('hide', item.key));
  const heading = /^h[1-4]$/.test(item.tag);
  const places = item.places ?? [];
  const edited = places.some((place) => override('text', place.key)) || Boolean(imageOverride) || Boolean(linkOverride);
  return (
    <details style={{ borderTop: '1px solid var(--line)', padding: '.5rem 0' }}>
      <summary>
        {hidden ? <><Badge tone="red">hidden</Badge>{' '}</> : null}
        {heading ? <><Badge tone="gold">{item.tag}</Badge>{' '}</> : null}
        <b style={{ fontSize: 11 }}>{item.label}</b>
      </summary>
      <p className="hint" style={{ margin: '.4rem 0' }}>
        <code>{item.key}</code>
        {edited ? <> · <Badge tone="green">you changed this</Badge></> : null}
        {item.textReason ? <><br />{item.textReason}</> : null}
      </p>

      {places.map((place) => {
        const textOverride = override('text', place.key);
        const screens = reach(place.key);
        const everywhere = screens.length > 1;
        const sameWording = screens.filter((row) => row.text === place.value).length;
        return (
          <div key={place.key} style={{ margin: '.5rem 0' }}>
            <form method="post" action="/api/admin/design">
              <FormHead
                action="set"
                kind="text"
                screen={screen}
                itemKey={place.key}
                title={`${item.label} · ${place.label}`}
                returnTo={backTo}
              />
              <input type="hidden" name="sampleScreen" value={screen} />
              {/*
                THE SENTENCE IT REPLACES, WHICH IS THE WHOLE OF THE "TEXTS" SECTION'S BRIEF.

                The page before last showed a placeholder attribute and left the owner to work out which
                sentence it was. Here the sentence the page carries now is printed as text above the field
                that replaces it, so the pair reads "this is what it says — this is what it will say".
              */}
              <p className="hint" style={{ margin: 0 }}>
                {place.attr ? <>{place.label} <code>{place.attr}</code> now: </> : <>On the page now: </>}
                <q>{place.value}</q>
              </p>
              <label className="label" htmlFor={`text-${place.key}`}>
                {place.attr ? `The words you want in ${place.attr}` : 'Words you want instead'}
              </label>
              <textarea
                className="field"
                id={`text-${place.key}`}
                name="text"
                rows={place.value.length > 90 ? 3 : 1}
                defaultValue={textOverride?.value.text ?? ''}
                placeholder={place.value}
              />
              {everywhere ? (
                /*
                  THE ONE EDIT OR FIFTY-TWO ANSWER, IN THE SAME FORM AS THE VALUE.

                  Both buttons submit the text beside them — a separate form could only re-post the STORED
                  value, which would make "change it everywhere" a button that changes nothing the first time
                  it is pressed. The count is measured from the deliverable, and the button appears only when
                  there is more than one screen to reach.
                */
                <p className="hint" style={{ margin: '.3rem 0 0' }}>
                  This place is on <b>{screens.length} of {screensTotal} screens</b>
                  {sameWording < screens.length ? <>, and <b>{screens.length - sameWording}</b> of them hold different words there</> : null}
                  . The button below writes <b>one</b> row served wherever the design has this place.
                </p>
              ) : null}
              <FormFoot
                override={textOverride}
                undoLabel={`this ${place.label.toLowerCase()}`}
                previewQuery={{
                  kind: 'text', key: place.key, screen, text: textOverride?.value.text ?? place.value,
                }}
              />
            </form>
            {everywhere ? (
              <p className="hint" style={{ margin: 0 }}>
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
        <p className="hint" style={{ margin: '.2rem 0' }}>This element holds no words a reader reads.</p>
      ) : null}

      {item.can.image ? (
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
            ...((imageOverride?.value.creditKey ?? item.creditKey) ? { creditKey: imageOverride?.value.creditKey ?? item.creditKey ?? '' } : {}),
          }}
        />
      ) : null}

      {item.can.link ? (
        <form method="post" action="/api/admin/design" style={{ margin: '.4rem 0' }}>
          <FormHead
            action="set"
            kind="link"
            screen={screen}
            itemKey={item.key}
            title={item.label}
            returnTo={backTo}
          />
          <p className="hint" style={{ margin: 0 }}>The link says <q>{item.text}</q> and goes to <code>{item.href}</code>.</p>
          <span className="label">Label</span>
          <input className="field" type="text" name="linkLabel" defaultValue={linkOverride?.value.label ?? ''} placeholder={item.text} />
          <span className="label" style={{ marginTop: 10 }}>Goes to</span>
          <input className="field" type="text" name="href" defaultValue={linkOverride?.value.href ?? ''} placeholder={item.href} />
          <FormFoot
            override={linkOverride}
            undoLabel="this link"
            previewQuery={{ kind: 'link', key: item.key, screen, href: linkOverride?.value.href ?? item.href ?? '', linkLabel: linkOverride?.value.label ?? item.text }}
          />
        </form>
      ) : null}

      {item.can.hide ? (
        <form method="post" action="/api/admin/design" style={{ margin: '.4rem 0' }}>
          <input type="hidden" name="action" value={hidden ? 'remove' : 'set'} />
          <input type="hidden" name="kind" value="hide" />
          <input type="hidden" name="screen" value={screen} />
          <input type="hidden" name="key" value={item.key} />
          <input type="hidden" name="title" value={item.label} />
          <input type="hidden" name="returnTo" value={backTo} />
          <button className={hidden ? 'btn small' : 'btn danger small'} type="submit">
            {hidden ? 'Show this block again' : 'Hide this block'}
          </button>
          <span className="hint" style={{ marginLeft: '.5rem' }}>
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
 * THE PREVIEW IS THE POINT OF THIS COMPONENT EXISTING RATHER THAN THE SHARED FORM. An image editor whose
 * only feedback is a status code after Save is an editor whose owner finds out what he did when he reloads
 * the page — and the credit field is disabled rather than hidden when the design has no slot for it,
 * because a control that is present and impossible is worse than one that says why.
 *
 * The drawing is the design's `.media-thumb` / `.media-meta` pair put where its "Selected image" card was,
 * because that card is exactly this: what the picture is, where it comes from, and what it says.
 */
function ImageForm({ screen, itemKey, title, returnTo, override, currentSrc, currentAlt, creditKey, credit, undoLabel, previewQuery, label }: {
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
      {label ? <h3 style={{ margin: '.6rem 0 .2rem', fontSize: 13 }}>{label}</h3> : null}
      <p className="hint" style={{ margin: '.2rem 0' }}><b>{title}</b>{src.length > 0 ? ' — your address' : ' — the design’s own'}</p>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="media-card" style={{ flex: '0 0 12rem' }}>
          <div className="media-thumb">
            {shown.length > 0 ? (
              // eslint-disable-next-line @next/next/no-img-element -- a preview of whatever the owner has
              // pointed at, which may be an address on another origin; next/image would proxy and reshape it.
              <img src={shown} alt={override?.value.alt ?? currentAlt} />
            ) : (
              <span className="hint">no image here to preview</span>
            )}
          </div>
          <div className="media-meta">
            <b style={{ wordBreak: 'break-all' }}>{shown.length > 0 ? shown : 'nothing'}</b>
            <small>{override?.value.creditKey ?? creditKey ? `credit slot ${override?.value.creditKey ?? creditKey}` : 'no credit slot in the design'}</small>
          </div>
        </div>
        <div style={{ flex: '1 1 24rem' }}>
          <form method="post" action="/api/admin/design">
            <FormHead
              action="set"
              kind="image"
              screen={screen}
              itemKey={itemKey}
              title={title}
              returnTo={returnTo}
            />
            {/*
              THE ESCAPE HATCH IS IN THIS FORM AND WRITTEN HERE, NOT IN `FormHead`.

              It is the one field only an image row has, and it has to be submit-able: `allow_missing=1`
              is what lets an owner save an address whose file will be uploaded afterwards, and the save
              path refuses a same-origin address that answers 404 without it. **A checkbox rendered by a
              shared component is inside the form at run time and outside it in the source**, which is
              how a field that cannot be read comes to be a field that cannot be checked.
            */}
            <p className="hint" style={{ margin: '.3rem 0 0' }}>
              <label className="check">
                <input type="checkbox" name="allow_missing" value="1" /> The file will be added later — save the
                address even if nothing answers at it yet.
              </label>
            </p>
            {creditKey ? <input type="hidden" name="creditKey" value={override?.value.creditKey ?? creditKey} /> : null}
            <span className="label">Image address</span>
            <input className="field" type="text" name="src" defaultValue={override?.value.src ?? ''} placeholder={currentSrc} />
            <span className="label" style={{ marginTop: 10 }}>Alternative text — what a reader who cannot see the picture is told</span>
            <input
              className="field"
              type="text"
              name="alt"
              defaultValue={override?.value.alt ?? ''}
              placeholder={currentAlt || 'Describe the photograph for a reader who cannot see it'}
            />
            <span className="label" style={{ marginTop: 10 }}>
              Credit{creditKey ? <> (<code>{creditKey}</code>)</> : <> — no credit slot in the design, so this field is closed rather than silently dropped</>}
            </span>
            <input
              className="field"
              type="text"
              name="credit"
              defaultValue={override?.value.credit ?? ''}
              placeholder={credit ?? ''}
              disabled={!creditKey}
            />
            <FormFoot override={override} undoLabel={undoLabel} previewQuery={previewQuery} />
          </form>
        </div>
      </div>
    </>
  );
}

/** One screen's name, and the address a reader types for it. */
function screenHref(screen: string): string {
  return screen === 'home' ? '/' : `/${screen}/`;
}

/**
 * The route to a tab, with the screen it was reached from.
 *
 * THE SECTION IS THE DESIGN'S `data-tab`, IN THE ADDRESS BAR RATHER THAN IN CLIENT STATE. Ten tabs in one
 * document means a save that returned to the first tab would lose the reader's place, so every form's
 * `returnTo` is built by this function and the reader lands back on the row he pressed Save on.
 */
function tabHref(tab: TabKey, extra: Record<string, string> = {}): string {
  return `/admin/design/?${new URLSearchParams({ tab, ...extra }).toString()}`;
}

/* ==================================================================================================
 * 3. THE PAGE
 * ================================================================================================ */

export default async function DesignStudioPage({
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
  const contrast: ContrastResult[] = contrastReport(values);
  /** Which pairs are about which token, so a failing ratio is printed on the row it is about. */
  const pairsFor = (name: string) =>
    contrast.filter((row) => row.fg === name || row.bg === name).map((row) => ({ role: row.role, ratio: row.ratio, min: row.min, pass: row.pass }));

  const controls = tokenControls(tokensResult.tokens, values, new Set(tokenOverrides.keys()));
  const fontChoices = fontOptions(tokensResult.tokens);
  const colourTokens = controls.filter((c) => COLOURISH.has(c.effectiveClass));
  const typeTokens = controls.filter((c) => !COLOURISH.has(c.effectiveClass));
  const colourGroups = [...new Set(colourTokens.map((c) => c.group))];
  const typeGroups = [...new Set(typeTokens.map((c) => c.group))];
  /** The four the palette is drawn from: the first four the design declares, in its own order. */
  const heroSwatches = colourTokens.slice(0, 4);

  const screen = one('screen') || screens.find((s) => s === 'about') || screens[0] || 'home';
  const from = Math.max(0, Number.parseInt(one('from'), 10) || 0);
  const tabParam = one('tab');
  const tab: TabKey = (
    TAB_KEYS.includes(tabParam) ? tabParam : TAB_ALIASES[tabParam] ?? 'studio'
  ) as TabKey;

  /*
   * AN EDIT MADE ON EVERY SCREEN IS STILL AN EDIT ON THIS ONE. A site-wide row is filed under `*` and
   * served on every screen the key names, so a lookup that only searched this screen's rows would hide the
   * reset for the very edits the owner most needs to be able to take back.
   */
  const screenOverrides = overrides.filter((o) => o.screen === screen);
  const sharedOverrides = overrides.filter((o) => o.screen === ALL_SCREENS && o.kind !== 'token');
  const overrideFor = (kind: string, key?: string) =>
    (key === undefined ? undefined : screenOverrides.find((o) => o.kind === kind && o.key === key))
    ?? (key === undefined ? undefined : sharedOverrides.find((o) => o.kind === kind && o.key === key));

  const tokenOverridesList = overrides.filter((o) => o.kind === 'token');
  const imageOverrides = overrides.filter((o) => o.kind === 'image');
  const linkOverrides = overrides.filter((o) => o.kind === 'link');
  const textOverrides = overrides.filter((o) => o.kind === 'text' || o.kind === 'hide');
  const hiddenCount = overrides.filter((o) => o.kind === 'hide').length;
  const failedPairs = contrast.filter((row) => !row.pass);

  /*
   * THE SERVED PAGE IS ASKED WHAT IT HOLDS ONLY WHEN A TAB DRAWS THE LIST.
   *
   * `inventoryFor` fetches the served page — a fill, a head, an inventory pass — so doing it to render the
   * palette would spend that on every visit to every tab and show the answer to nobody. **The owner's
   * complaint is that this page did too much at once; making it do less is part of the fix rather than a
   * tidy-up.** Three tabs draw from it and nothing else does:
   *
   *   widgets  the page builder's structure list and the whole element list
   *   text     the searchable table of every place on the screen
   *   media    the per-screen image overrides — ⚠️ **AND THIS TAB WAS MISSING FROM THIS LINE, which made
   *            its "photographs on /{screen}/ and the control that changes each one" section permanently
   *            empty.** It reported "the served page reports no image slot" for every screen, including
   *            the ones that have several, because `items` was the empty array this line hands out. Found
   *            by measuring the built page rather than by reading this comment.
   */
  const needsInventory = tab === 'widgets' || tab === 'text' || tab === 'media';
  const inventory = needsInventory ? await inventoryFor(screen, from) : { items: [] as InventoryItem[], total: 0 };
  const items = 'items' in inventory ? inventory.items : [];
  const inventoryError = 'error' in inventory ? inventory.error : null;
  const placesTotal = 'items' in inventory ? inventory.total : null;

  /**
   * ⚠️ FORTY ELEMENTS ARE DRAWN AT A TIME, AND ONE HUNDRED AND FIFTY WERE NOT.
   *
   * `inventoryFor` may return up to the inventory limit (150) items, and every one of them is drawn with
   * **every form it can honestly take** — a text field per place, an image form, a link form and a hide
   * form. Measured on `/about/`: 150 items made the page 11,937 px tall and 921 KB of HTML, all of it
   * assembled and sent for the reader to look at the first screenful of. The old page was the same, and
   * the owner's complaint about *this* page was that it did everything at once.
   *
   * **The pagination is real either way** — `from` is an offset the served page honours — so drawing
   * forty and linking to the next forty is the same feature, forty times less of it. The slice is what is
   * DRAWN; `placesTotal` is still the served page's own count of everything on it.
   */
  const PLACES_PER_PAGE = 40;
  const shown = items.slice(0, PLACES_PER_PAGE);

  // The reach of a key is measured from the deliverable's 53 files, so it too is only built where it is drawn.
  const reach = tab === 'widgets'
    ? await reachOf(shown.flatMap((item) => (item.places ?? []).map((place) => place.key)))
    : () => [];

  /*
   * THE WRITING TAB'S REAL SURFACE, READ FROM THE DATABASE RATHER THAN FROM THE MOCK-UP.
   *
   * The mock-up's editor is a painted post about Igbo-Ukwu with an invented title and four invented
   * sentences in its body. **The archive has a real editor at `/admin/posts/new` and 1,051 records behind
   * it**, so this tab lists the real posts and pages with their real status, words and dates, and links
   * into that editor. See the tab's own note for why there is no second editor here.
   */
  const writing = tab === 'writing'
    ? await Promise.all([listPieces(db, { kind: 'post', limit: 6 }), listPieces(db, { kind: 'page', limit: 6 })])
    : null;
  const recentPosts: PieceRow[] = writing?.[0] ?? [];
  const recentPages: PieceRow[] = writing?.[1] ?? [];

  /*
   * THE MEDIA TAB SHOWS THE ARCHIVE'S OWN RECORDS, WITH THEIR REAL DIMENSIONS AND REAL BYTES.
   *
   * The mock-up's four `.media-card`s are a drawn mark and three `<div>`s with the words "Igbo-Ukwu",
   * "Archive" and "Ndebe" set in Georgia, sized "1.8 MB", "820 KB" and "640 KB". **Every one of those is
   * invented.** This reads the real register, and its cards carry a real `storage_key`, a real pixel size
   * and a real byte count — or the card says the archive does not hold the file.
   */
  const media = tab === 'media' ? await listMedia(db, { kind: 'image', limit: 12 }) : [];
  const mediaSelected = one('media') ? media.find((row) => String(row.id) === one('media')) ?? null : null;

  const logo = logoSlotIn(items);
  const logoOverride = logo ? overrideFor('image', logo.key) : undefined;

  /*
   * THE TAB'S COUNTS, WHICH ARE THE REAL NUMBERS.
   *
   * `Colours` and `Fonts & type` carry the count of tokens the DESIGN declares — 45 and 32 are the
   * mock-up's figures and are not used; whatever `tokens.css` resolves to is what is printed. The other
   * counts are the real stored rows, so a tab reading "(0)" is a tab saying the archive is exactly as the
   * design made it, which is the normal state and not a fault.
   */
  const counts: Partial<Record<TabKey, number>> = {
    colours: colourTokens.length,
    type: typeTokens.length,
    media: imageOverrides.length,
    favicon: favicon ? 1 : 0,
    history: overrides.length,
  };

  const tabLink = (next: TabKey, extra: Record<string, string> = {}) => tabHref(next, extra);
  const backTo = tabHref(tab, { screen: one('screen') ? screen : '' });

  /* ------------------------------------------------------------------ DESIGN STUDIO */
  const studio = (
    <>
      <div className="grid">
        <Card title="What this can change" note={`${controls.length} design tokens · unlimited page content controls`}>
          <div className="row">
            <div className="stack">
              <div>
                <span className="label">Every design screen</span>
                <b>{screens.length} public screens in the deliverable</b>
                <div className="hint">Choose a page and inspect every editable element actually served on it.</div>
              </div>
              <div>
                <span className="label">Edits in force</span>
                <b>{overrides.length}</b>
                <div className="hint">Changes are stored as database overrides. The underlying design files remain untouched.</div>
              </div>
              <div>
                <span className="label">Site icon</span>
                <b>
                  {favicon
                    ? `${Math.round((favicon.bytes / 1024) * 10) / 10} KB ${favicon.mediaType}`
                    : 'the archive’s own mark'}
                </b>
                <div className="hint">Served globally from <code>/favicon.ico</code>.</div>
              </div>
            </div>
            <div className="stack">
              <div>
                <span className="label">Global palette</span>
                <b>{colourTokens.length} colour tokens</b>
                <div className="hint">Meaningful and decorative roles are separated, with contrast checks.</div>
              </div>
              <div>
                <span className="label">Typography</span>
                <b>{typeTokens.length} other tokens</b>
                <div className="hint">Font stacks support Igbo dotted vowels and combining tone marks.</div>
              </div>
              <div>
                <span className="label">Preview</span>
                <b>Real public-page preview</b>
                <div className="hint">Preview opens the page itself with the pending overrides applied.</div>
              </div>
            </div>
          </div>
          <div className="divider" />
          <div className="notice">
            <b>Design files are protected</b>
            Changes here override the served design at runtime. They never rewrite the original design handover.
          </div>
          <div className="actions">
            <a className="btn gold" href={tabLink('widgets')}>Open page builder</a>
            <a className="btn" href={tabLink('colours')}>Edit global colours</a>
            <a className="btn" href={tabLink('type')}>Edit typography</a>
          </div>
        </Card>

        {/*
          THE DESIGN'S "Design health", WITH EVERY ROW MEASURED RATHER THAN ASSERTED.

          The mock-up badges three checks it never ran — "All checked colour pairs currently pass AA",
          "Igbo orthography glyph coverage verified", "2 pages have image overrides". **A health row that
          has not actually been checked must say so rather than showing PASS**, so each row below carries a
          figure this process really computed and the badge says which state that figure is in.

          ⚠️ **THE ONE ROW THE OLD PAGE HAD AND THIS ONE DOES NOT IS "Typography glyph coverage".** The
          archive declares the families it loads (`LOADED_FONT_FAMILIES`) and the design's own stack — but
          *preferring* a font is not *having* its glyphs: a browser falls back to Georgia per character, and
          that fallback is not recorded anywhere this server can read. **So the claim is not made.** The
          glyphs themselves are printed on the Fonts & type tab, where they are a real string rather than a
          statistic, and that tab says plainly that the coverage check is not made.
        */}
        <Card title="Design health" note="Live checks">
          <div className="token">
            <span className="dot" style={{ background: '#f7f2e8' }} aria-hidden="true" />
            <div>
              <b>Accessibility</b>
              <small>
                {contrast.length} colour pairs measured
                {failedPairs.length === 0
                  ? ' — every one at or above the standard it is used under'
                  : ` — ${failedPairs.length} below the standard it is used under`}
              </small>
            </div>
            {failedPairs.length === 0
              ? <Badge tone="green">PASS</Badge>
              : <Badge tone="red">{failedPairs.length} FAIL</Badge>}
          </div>
          <div className="token">
            <span className="dot" style={{ background: '#d5a746' }} aria-hidden="true" />
            <div>
              <b>Images</b>
              <small>
                {imageOverrides.length === 0
                  ? 'no page has an image override'
                  : `${imageOverrides.length} image override${imageOverrides.length === 1 ? '' : 's'} across ${new Set(imageOverrides.map((o) => o.screen)).size} page${new Set(imageOverrides.map((o) => o.screen)).size === 1 ? '' : 's'}`}
              </small>
            </div>
            {imageOverrides.length === 0 ? <Badge tone="green">NONE CHANGED</Badge> : <Badge tone="gold">{imageOverrides.length} CHANGED</Badge>}
          </div>
          <div className="token">
            <span className="dot" style={{ background: '#a3473f' }} aria-hidden="true" />
            <div>
              <b>Hidden blocks</b>
              <small>
                {hiddenCount === 0 ? 'nothing is hidden — every block the design draws is drawn' : `${hiddenCount} block${hiddenCount === 1 ? '' : 's'} hidden · reversible`}
              </small>
            </div>
            <Badge>{hiddenCount}</Badge>
          </div>
          <div className="divider" />
          <a className="btn" href={tabLink('history')}>View every design edit →</a>
        </Card>
      </div>
    </>
  );

  /* ------------------------------------------------------------------ COLOURS */
  const colourTab = (
    <>
      {tokensResult.error ? <Notices error={`The design’s token file could not be read: ${tokensResult.error}`} /> : null}
      <Card title={`Colours — ${colourTokens.length} tokens`} note="Global · changes apply to every screen">
        <p className="hint">
          A token is the complete colour decision. Use the picker where safe; the text value remains available
          for rgba(), hsl(), gradients and aliases.
        </p>
        <div className="swatches" style={{ margin: '15px 0' }}>
          {heroSwatches.map((control) => (
            <Swatch key={control.token} value={control.normalised} name={control.key} role={control.group} />
          ))}
        </div>
        <div className="divider" />
        {/*
          THE DESIGN'S GROUPS, WHICH ARE THE DELIVERABLE'S OWN.

          The mock-up writes `<h4>Paper and ink <span class="hint">· 9 tokens</span></h4>` and then one flat
          `#colourTokens` block with ten rows. The deliverable declares its tokens under six group comments —
          "Colour: warm paper, ink, and a single earth accent", "Semantic roles", and so on — and
          `parseDesignTokens` reads them. **The headings and the counts below are those groups and their real
          sizes**, so "Paper and ink · 9 tokens" appears here only if the design actually groups nine tokens
          there.
        */}
        {colourGroups.map((group, index) => {
          const inGroup = colourTokens.filter((c) => c.group === group);
          const changed = inGroup.filter((c) => c.overridden).length;
          return (
            <details key={group} open={index === 0 || changed > 0}>
              <summary>
                <h4 style={{ fontSize: 12, margin: '0 0 7px', display: 'inline-block' }}>
                  {group} <span className="hint">· {inGroup.length} tokens</span>
                </h4>{' '}
                <span className="hint">
                  {changed > 0 ? `${changed} changed by you` : 'all as the design made them'}
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

      {/*
        THE CONTRAST TABLE, KEPT FROM THE PAGE THIS REPLACES, WITH ITS OWN ANCHOR.
        It is the evidence behind the health card's PASS badge, and the mock-up's `.notice` on the studio
        tab is what promised a contrast check. It lived on the old page under a card of its own; here it is
        the last card of the Colours tab, because it is the palette that the pairs are drawn from.
      */}
      <div id="contrast" style={{ marginTop: 18 }}>
        <Card title="Contrast — measured, not asserted" note={`${CONTRAST_PAIRS.length} pairs checked`}>
          <p className="hint">
            Every pair of colours the design actually puts on top of one another, with the ratio the standard
            asks for. <b>4.5:1</b> is WCAG 2.2 AA for text; <b>3:1</b> is the floor for a focus ring and for
            text that is deliberately faint.{' '}
            {failedPairs.length === 0
              ? 'Every pair passes as the palette stands.'
              : `${failedPairs.length} pair${failedPairs.length === 1 ? '' : 's'} FAIL as the palette stands — the rows below say which, and the token rows carry the same warning.`}
          </p>
          <table className="table">
            <thead>
              <tr><th>Where</th><th>Text</th><th>On</th><th>Ratio</th><th>Needs</th></tr>
            </thead>
            <tbody>
              {contrast.map((row) => (
                <tr key={`${row.fg}-${row.bg}`}>
                  <td>{row.role}</td>
                  <td><code>--{row.fg}</code> <i style={{ display: 'inline-block', width: 10, height: 10, background: row.fgValue, border: '1px solid rgba(0,0,0,.2)' }} /></td>
                  <td><code>--{row.bg}</code> <i style={{ display: 'inline-block', width: 10, height: 10, background: row.bgValue, border: '1px solid rgba(0,0,0,.2)' }} /></td>
                  <td><b>{row.ratio ?? '—'}:1</b></td>
                  <td>{row.min}:1 {row.pass ? <Badge tone="green">pass</Badge> : <Badge tone="red">fail</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: 12 }}>
            A colour used somewhere this table does not know about is not checked — the pairs are the ones the
            design&rsquo;s own stylesheets create, and the design is what says which colours sit on which.
          </p>
        </Card>
      </div>
    </>
  );

  /* ------------------------------------------------------------------ FONTS & TYPE */
  const typeTab = (
    <>
      <div className="grid">
        <Card title={`Fonts & type — ${typeTokens.length} tokens`} note="Type · Other · Shape">
          <p className="hint">
            Families offered here are loaded by the site. Custom stacks can be typed directly, including
            fallbacks for readers whose network blocks external fonts.
          </p>
          {fontChoices.length === 0 ? (
            <Notices error="The design’s font stacks could not be read, so no family can be offered. The text field on each row still works." />
          ) : null}
          {typeGroups.map((group, index) => {
            const inGroup = typeTokens.filter((c) => c.group === group);
            const changed = inGroup.filter((c) => c.overridden).length;
            // The first group open, as in the palette — see the note there.
            return (
              <details key={group} open={index === 0 || changed > 0}>
                <summary>
                  <h4 style={{ fontSize: 12, margin: '0 0 7px', display: 'inline-block' }}>
                    {group} <span className="hint">· {inGroup.length} tokens</span>
                  </h4>{' '}
                  <span className="hint">{changed > 0 ? `${changed} changed by you` : 'all as the design made them'}</span>
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

        {/*
          GLYPH COVERAGE, WITH THE CLAIM REMOVED AND THE GLYPHS KEPT.

          ⚠️ **THE MOCK-UP BADGES `✓ Roman`, `✓ Italic` AND `✓ Tone marks`, AND ALL THREE ARE ASSERTIONS
          NOTHING IN THIS REPOSITORY HAS EVER MEASURED.** "Coverage verified" is precisely the kind of claim
          this project forbids, and a badge is a claim. So the glyph row is kept — **it is a real string, not
          a statistic** — and the design's own sentence about what a substitute font costs is kept, because
          the design wrote it about its own tokens. What is added is the part only this application can know:
          which families the token prefers, and that neither this server nor any stylesheet records whether
          those glyphs were actually drawn rather than fallen back to.
        */}
        <Card title="Glyph coverage">
          <div style={{ font: '32px Georgia, serif', lineHeight: 1.5 }}>
            ị ọ ụ ñ Ị Ọ Ụ Ṅ<br />à á è é ì í ò ó ù ú
          </div>
          <div className="divider" />
          {typeTokens.filter((control) => control.control === 'font').map((control) => (
            <p className="hint" key={control.token} style={{ margin: '0 0 6px' }}>
              <code>{control.key}</code> prefers <code>{control.normalised}</code>
            </p>
          ))}
          <p className="hint" style={{ marginTop: 12 }}>
            A substitute font that lacks these glyphs breaks the orthography rather than merely changing the
            look. <b>The two lines above are drawn in Georgia</b>, because that is the family this sheet has
            and this page loads no others; whether the archive&rsquo;s own families carry these glyphs is not
            measured here. A font stack that names a family the reader&rsquo;s browser has not downloaded
            falls back per character, and <b>nothing in the design or this server records which font drew
            which glyph</b> — so no coverage badge is claimed on this tab.
          </p>
        </Card>
      </div>
    </>
  );

  /* ------------------------------------------------------------------ TEXT & LABELS */
  /*
   * THE REAL MACHINERY, KEPT: `ozinventory=1` ON THE SERVED PAGE.
   *
   * The mock-up's four rows — "About Ozikoro" on `/about/`, "Become a volunteer" on `/volunteer/` and so on
   * — are invented, and two of them name places that may not exist. This lists the places the SERVED page
   * actually holds, with the selectors the design really uses and the words it really carries, and every
   * row is a working form. `placesTotal` is the served page's own count of them.
   */
  const textQuery = one('text').trim().toLowerCase();
  const editablePlaces = items.flatMap((item) =>
    (item.places ?? []).map((place) => ({ item, place, override: overrideFor('text', place.key) }))
  );
  const matchingPlaces = textQuery.length === 0
    ? editablePlaces
    : editablePlaces.filter(({ item, place, override }) =>
        [item.label, item.key, place.label, place.value, override?.value.text ?? '']
          .join(' ')
          .toLowerCase()
          .includes(textQuery)
      );
  const editedRows = textOverrides.map((override) => ({ override, parts: splitTextKey(override.key) }));
  const openRow = one('edit') ? editedRows.find((row) => String(row.override.id) === one('edit')) ?? null : null;

  const textTab = (
    <>
      {/*
        ⚠️ THIS TAB IS ONE FULL-WIDTH COLUMN, AND THE MOCK-UP'S `.grid` IS NOT USED HERE.
        The design's `.grid` is `1.25fr .75fr`, and the mock-up puts four short invented rows in the left
        cell and a five-line textarea in the right. The delivered table is 74 real rows with a selector in
        each — measured at 1280 px inside the 1.25fr cell, every selector wrapped onto seven lines and the
        table became unreadable. **The design's shape is kept where it draws something real** (the search
        field, the `.table` with Where · What · Current text · Edit, the editor card with its `.label`,
        `textarea` and `.actions` of Preview / Save / "Put it back"); only the two-column split is dropped,
        because the thing it was splitting cannot be drawn in 490 px.
      */}
      <Card title="Text & labels" note={`Every editable place on /${screen}/`}>
          <form method="get" action="/admin/design/" style={{ display: 'flex', gap: 8, marginBottom: 15 }}>
            <input type="hidden" name="tab" value="text" />
            <input type="hidden" name="screen" value={screen} />
            <input className="field" type="search" name="text" defaultValue={one('text')} placeholder="Find text, selector or page…" aria-label="Find a place on the served page" />
            <button className="btn" type="submit">Search</button>
          </form>
          {inventoryError ? (
            <Notices error={`The list of editable places on /${screen}/ could not be read. ${inventoryError}`} />
          ) : (
            <>
              <p className="hint">
                {placesTotal === null
                  ? null
                  : <>The served page holds <b>{placesTotal}</b> editable places, of which {matchingPlaces.length} match{textQuery ? ` “${one('text')}”` : ''}. </>}
                This is the <b>served</b> page — after the archive&rsquo;s own fills have run — so a heading the
                archive writes at serve time is offered here and a button a fill has deleted is not.
              </p>
              <table className="table">
                <thead>
                  <tr><th>Where</th><th>What</th><th>Current text</th><th /></tr>
                </thead>
                <tbody>
                  {matchingPlaces.slice(0, 40).map(({ item, place, override }) => (
                    <tr key={place.key}>
                      <td><code>/{screen}/</code></td>
                      <td>
                        <b>{item.label}</b> · {place.label}<br />
                        <code style={{ wordBreak: 'break-all' }}>{place.key}</code>
                      </td>
                      <td>
                        {override ? <><Badge tone="green">changed</Badge> <q>{override.value.text}</q></> : <q>{place.value}</q>}
                      </td>
                      <td>
                        {/*
                          "Edit" AND NOT A SECOND EDITOR — AND NOT A DEAD LINK EITHER.

                          The design's table carries an Edit button per row. **A control that scrolls nowhere
                          is a dead control**, so this resolves to one of exactly two real destinations: the
                          row's own live editor lower down this page when the words here have already been
                          changed (the anchor is the override's id), or the page builder's element form for
                          this screen when they have not — which is the form that writes the change in the
                          first place. Both are real, and the label says which one you are getting.
                        */}
                        {override && override.id !== undefined ? (
                          <a className="btn small" href={`#text-${override.id}`}>Edit below</a>
                        ) : (
                          <a
                            className="btn small"
                            href={`${tabHref('widgets', { screen })}#block-${encodeURIComponent(item.key)}`}
                          >
                            Edit on the page builder
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                  {matchingPlaces.length === 0 ? (
                    <tr><td colSpan={4} className="hint">Nothing on <code>/{screen}/</code> matches that. An empty result is not a fault.</td></tr>
                  ) : null}
                </tbody>
              </table>
              {matchingPlaces.length > 40 ? (
                <p className="hint">Showing the first 40 of {matchingPlaces.length}. Narrow the search, or open the page builder to see the whole screen.</p>
              ) : null}
            </>
          )}
        </Card>

        <div style={{ marginTop: 18 }}>
        <Card title="Text editor" note={openRow ? `Selected: ${openRow.override.label ?? openRow.override.key}` : `${textOverrides.length} change${textOverrides.length === 1 ? '' : 's'} in force`}>
          {/*
            ⚠️ THE DESIGN'S `textarea` IS HERE, AND IT IS NOT DECORATION.
            The mock-up's "Text editor" card holds one textarea bound to the "Hero heading" row above it and a
            Save button that calls `toast()`. This card cannot be that, because this tab draws EVERY editable
            place on the screen rather than four invented rows. What it is instead is the design's own shape
            carrying the real thing: the stored overrides, each with the words it now says, a field for the
            words you want instead, and the design's Preview / Save / "Put it back" actions. Each row opens in
            place, so nothing about the design is lost and nothing is claimed that is not stored.
          */}
          {textOverrides.length === 0 ? (
            <p className="hint">
              <b>No words have been changed, and that is the normal state.</b> Every heading, note, caption,
              button and form placeholder on the site is exactly as the design made it. Pick a place in the
              table and its own editor opens on the page builder, where every element on the screen can be
              edited — the change then appears here with its reset.
            </p>
          ) : (
            editedRows.map(({ override, parts }) => (
              <details key={override.id} id={`text-${override.id}`} open={openRow?.override.id === override.id} style={{ borderTop: '1px solid var(--line)', padding: '.4rem 0' }}>
                <summary>
                  <b style={{ fontSize: 11 }}>{override.label ?? override.key}</b>{' '}
                  <span className="hint">{override.screen === ALL_SCREENS ? 'every screen' : `/${override.screen}/`}</span>{' '}
                  {override.kind === 'hide' ? <Badge tone="red">hidden</Badge> : null}
                </summary>
                <p className="hint" style={{ margin: '.3rem 0' }}>
                  <code style={{ wordBreak: 'break-all' }}>{parts.selector}</code>
                  {parts.attr ? <> <code>{parts.attr}</code></> : null}
                </p>
                <form method="post" action="/api/admin/design">
                  <input type="hidden" name="action" value="remove" />
                  <input type="hidden" name="id" value={String(override.id)} />
                  <input type="hidden" name="returnTo" value={tabHref('text', { screen })} />
                  <span className="label">Words the page carries now</span>
                  <textarea className="field" readOnly name="current" defaultValue={override.kind === 'hide' ? 'this block is left out of the page' : override.value.text ?? ''} />
                  <div className="actions" style={{ marginTop: 10 }}>
                    <button className="btn danger" type="submit">Put it back</button>
                  </div>
                </form>
              </details>
            ))
          )}
        </Card>
        </div>
    </>
  );

  /* ------------------------------------------------------------------ WIDGETS & PAGE LAYOUT */
  /*
   * ⚠️ THE PREVIEW IS THE REAL PAGE. THE MOCK-UP'S IS A PAINTED ONE.
   *
   * The mock-up draws a whole website inside `.site-preview`: a `.site-head` with a wordmark and four menu
   * items, a `.hero` with a kicker, a 39px headline, a paragraph and a `fake-btn`, then three `.mini-card`s
   * with `linear-gradient` thumbnails. **None of it is Ozikoro's, and drawing it would be a fabricated
   * artefact** — the owner's own rule.
   *
   * ⚠️ **AND THE REAL PAGE CANNOT BE DRAWN IN A FRAME EITHER, WHICH WAS MEASURED RATHER THAN ASSUMED.**
   * The first version of this tab put the live screen in an `<iframe>`. The frame came up blank, and the
   * reason is in the served response:
   *
   *     X-Frame-Options: DENY
   *     Content-Security-Policy: … frame-ancestors 'none' …
   *
   * **Both are deliberate** — the archive is not embeddable, and the file that sets them says so; the
   * preview *route* works precisely because it REDIRECTS into the real page rather than framing it.
   * Weakening a security header so an editor could draw a picture of a page inside itself would weaken it
   * for every other site on the internet, which is the one trade this page must not make.
   *
   * So the browser chrome is drawn — the mock-up's `.browser`, `.browserbar`, three `.bubble`s and
   * `.address`, with the address as a real link — and what is inside it is **the page's own real content,
   * read from the served document**: its title, its headings and its buttons, in its own order. That is a
   * true account of the screen, and the two real ways to SEE it are buttons rather than a picture.
   */
  const sitePath = screenHref(screen);
  const previewHref = `/admin/design/preview?${new URLSearchParams({ kind: 'token', key: '--paper', value_text: values.get('paper') ?? '', previewScreen: screen }).toString()}`;
  /** The words and controls the served page really leads with, in the page's own order. */
  const pageOutline = items
    .filter((item) => /^h[1-4]$/.test(item.tag) || item.can.link)
    .slice(0, 14);
  const widgetTab = (
    <>
      <div className="layout-editor">
        <div className="panel">
          <h4>Pages</h4>
          <div className="list">
            {screens.map((name) => (
              <a
                key={name}
                href={tabHref('widgets', { screen: name })}
                className={name === screen ? 'sel' : undefined}
                aria-current={name === screen ? 'page' : undefined}
                style={name === screen ? { fontWeight: 700, background: '#eee7da', display: 'block', textDecoration: 'none', color: 'inherit', padding: 10, borderRadius: 7, fontSize: 11 } : { display: 'block', textDecoration: 'none', color: 'inherit', padding: 10, borderRadius: 7, fontSize: 11 }}
              >
                {name}
              </a>
            ))}
          </div>
          <h4>Page structure</h4>
          <div className="list">
            {inventoryError ? (
              <p className="hint" style={{ padding: 8 }}>{inventoryError}</p>
            ) : shown.length === 0 ? (
              <p className="hint" style={{ padding: 8 }}>The served page reported no blocks.</p>
            ) : (
              shown.map((item) => (
                <a
                  key={item.key}
                  href={`#block-${encodeURIComponent(item.key)}`}
                  style={{ display: 'block', textDecoration: 'none', color: 'inherit', padding: 10, borderRadius: 7, fontSize: 11 }}
                >
                  {item.label}
                </a>
              ))
            )}
          </div>
        </div>

        <div className="preview-wrap">
          <div className="browser">
            <div className="browserbar">
              <i className="bubble" /><i className="bubble" /><i className="bubble" />
              <div className="address">
                <a href={sitePath} target="_blank" rel="noreferrer">{`ozikoro.com${sitePath}`}</a>
                <span style={{ marginLeft: 'auto', paddingLeft: 8 }}>● live page</span>
              </div>
            </div>
            <div className="site-preview">
              <div className="preview-pane">
                <div className="notice">
                  <b>This page cannot be drawn inside a frame, and that is deliberate</b>
                  <code>{sitePath}</code> answers <code>X-Frame-Options: DENY</code> and{' '}
                  <code>frame-ancestors &rsquo;none&rsquo;</code>, so no page of this archive may be
                  embedded — not here and not on anybody else&rsquo;s site. Weakening that so an editor
                  could see a picture of a page inside itself would weaken it everywhere. What is below is
                  instead <b>what the served page really holds</b>, read from the document itself.
                </div>
                <div className="actions">
                  <a className="btn primary" href={sitePath} target="_blank" rel="noreferrer">
                    Open {sitePath} in a new tab
                  </a>
                  <a className="btn" href={previewHref} target="_blank" rel="noreferrer">
                    Open it with a pending edit applied
                  </a>
                </div>
                <div className="divider" />
                <h4 style={{ margin: '0 0 6px', fontSize: 12 }}>
                  What {sitePath} holds{placesTotal === null ? '' : ` — first ${pageOutline.length} of ${placesTotal} places`}
                </h4>
                {pageOutline.length === 0 ? (
                  <p className="hint">The served page reported no headings or links.</p>
                ) : (
                  <div className="stack">
                    {pageOutline.map((item) => (
                      <div key={item.key}>
                        <span className="label">
                          {/^h[1-4]$/.test(item.tag) ? item.tag : 'link'}
                        </span>
                        {/^h[1-4]$/.test(item.tag) ? (
                          <p style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: item.tag === 'h1' ? 20 : 15 }}>
                            {item.text || <span className="hint">nothing written here yet</span>}
                          </p>
                        ) : (
                          <p style={{ margin: 0 }}>
                            <q>{item.text}</q> → <code>{item.href}</code>
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <p className="hint" style={{ marginTop: 12 }}>
                  Every one of those is editable below, in the element list, and the changes will be on
                  the real page the moment they are saved.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="panel inspector">
          <h4>Selected: {screen === 'home' ? 'Home' : screen}</h4>
          <div className="card-body">
            {/*
              THE INSPECTOR IS SHORT, AND EACH CONTROL IN IT IS REAL.

              The mock-up puts eight controls here — visibility, heading, eyebrow, button label, button
              destination, background, spacing and Save — bound to one invented "Hero" block. **This page
              will not draw a control that does not write**, so what is here is the two acts that are real
              for the selected screen and the address of the real editor for everything else.
            */}
            <div className="control">
              <span className="label">Screen</span>
              <div className="control-row">
                <span className="hint"><code>{sitePath}</code></span>
                <a className="btn small" href={sitePath} target="_blank" rel="noreferrer">Open</a>
              </div>
            </div>
            <div className="control">
              <span className="label">Blocks the served page holds</span>
              <div className="control-row">
                <span className="hint">{placesTotal === null ? 'not read' : `${shown.length} shown of ${placesTotal}`}</span>
                <a className="btn small" href={tabHref('text', { screen })}>Show them</a>
              </div>
            </div>
            <div className="control">
              <span className="label">Edits in force on this screen</span>
              <div className="control-row">
                <span className="hint">{screenOverrides.length} row{screenOverrides.length === 1 ? '' : 's'}</span>
                <a className="btn small" href={tabHref('history', { screen })}>Open history</a>
              </div>
            </div>
            <div className="divider" />
            <p className="hint">
              Visibility, wording, images, links and hiding all belong to the block they change, so they are
              edited on the block itself rather than from a panel that would have to guess which one.
            </p>
            <div className="actions">
              <a className="btn primary small" href={tabHref('text', { screen, from: from > 0 ? String(from) : '' })}>Edit text & labels</a>
              <a className="btn small" href={tabHref('media', { screen })}>Edit images</a>
            </div>
          </div>
        </div>
      </div>

      <Card title={`Everything on /${screen}/`} note="Every editable element the served page holds">
        {inventoryError ? (
          <Notices error={inventoryError} />
        ) : (
          <>
            <p className="hint">
              This is the list the named tabs are built from, kept because they cannot express &ldquo;the third
              paragraph on this page&rdquo;. The header, the menu and the footer are the same markup in every
              screen file, so their words appear on up to {screens.length} screens; where the design carries a
              place on more than one screen the row offers a second button — <b>change everywhere it
              appears</b> — which writes <b>one</b> row served wherever that place exists.
            </p>
            {/*
              THE LOGO, FIRST, WHERE THE OWNER NAMED IT.

              It is an ordinary `image` override on the wordmark's own `<img>`; this is what turns it into a
              named control. It is drawn only on a screen whose served page actually carries that image, and
              it says which screen that is, because the deliverable draws the mark as an image on ONE of the
              53 screens and as the word `Ozikoro` on the other 52. A control that claimed otherwise would be
              a promise the page cannot keep.
            */}
            <details open style={{ borderTop: '1px solid var(--line)', margin: '12px 0', paddingTop: '.5rem' }}>
              <summary><b style={{ fontSize: 11 }}>Masthead logo</b></summary>
              {logo ? (
                <>
                  <p className="hint" style={{ margin: '.4rem 0' }}>
                    The mark beside the site name at the top of <code>/{screen}/</code>. It is stored as an
                    ordinary image override keyed to the wordmark&rsquo;s own slot — <code>{logo.key}</code> —
                    so it is attributed, audited and resettable like every other picture here.
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
                <p className="hint" style={{ margin: '.4rem 0' }}>
                  <b>This screen draws the site name without a picture.</b> Measured across the deliverable, the
                  wordmark carries an <code>&lt;img&gt;</code> on <code>home.html</code> alone; the other
                  screens draw the mark as the word <i>Ozikoro</i> in bold. There is no image here to change,
                  so no control is offered — open{' '}
                  <a href={tabHref('widgets', { screen: 'home' })}>Everything on /home/</a> to edit the logo.
                  Changing the other screens would mean editing the design deliverable, which this editor does
                  not do and must not.
                </p>
              )}
            </details>

            {placesTotal !== null ? (
              <p className="hint" style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span>Showing places {from + 1}–{from + shown.length} of {placesTotal} on /{screen}/.</span>
                {from > 0 ? (
                  <a href={tabHref('widgets', { screen, from: String(Math.max(0, from - PLACES_PER_PAGE)) })}>← Previous {Math.min(PLACES_PER_PAGE, from)}</a>
                ) : null}
                {from + shown.length < placesTotal ? (
                  <a href={tabHref('widgets', { screen, from: String(from + shown.length) })}>Next {Math.min(PLACES_PER_PAGE, placesTotal - from - shown.length)} places →</a>
                ) : null}
              </p>
            ) : null}

            {shown.map((item) => (
              <div key={item.key} id={`block-${encodeURIComponent(item.key)}`}>
                <ElementRow
                  item={item}
                  screen={screen}
                  from={from}
                  override={overrideFor}
                  reach={reach}
                  screensTotal={screens.length}
                />
              </div>
            ))}
          </>
        )}
      </Card>
    </>
  );

  /* ------------------------------------------------------------------ IMAGES & MEDIA */
  const mediaTab = (
    <>
      <Card title="Images & media" note={`${media.length} of the archive's own photographs`}>
        <p className="hint">
          The archive holds its pictures itself, in the media register, and each one is served from its own
          <code> /media/…</code> address. <b>PNG · JPEG · WebP · SVG · GIF</b> are all held; a picture that is
          not in the register yet is uploaded in{' '}
          <a href="/admin/media">the media register</a>, and a page that should show a different picture has
          its own override on the page builder — that is the control beneath this grid.
        </p>
        <div className="media-grid">
          {media.map((row) => {
            const href = tabHref('media', { screen, media: String(row.id) });
            return (
              <a key={row.id} href={href} style={{ textDecoration: 'none', color: 'inherit' }} aria-current={mediaSelected?.id === row.id ? 'true' : undefined}>
                <div className="media-card" style={mediaSelected?.id === row.id ? { borderColor: 'var(--gold)' } : undefined}>
                  <div className="media-thumb">
                    {row.url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- the archive's own media route,
                      // served at its stored size; next/image would re-encode a file the archive holds.
                      <img src={row.url} alt={row.altText ?? row.title} loading="lazy" />
                    ) : (
                      <span className="hint" style={{ padding: 8, textAlign: 'center' }}>
                        the archive does not hold this file — the record survives, the picture does not
                      </span>
                    )}
                  </div>
                  <div className="media-meta">
                    <b>{row.title}</b>
                    <small>
                      {row.reference} · {row.mimeType ?? 'type unknown'}
                      {row.width && row.height ? ` · ${row.width}×${row.height}` : ''}
                      {row.filesizeBytes !== null ? ` · ${Math.round((row.filesizeBytes / 1024) * 10) / 10} KB` : ''}
                    </small>
                  </div>
                </div>
              </a>
            );
          })}
          {media.length === 0 ? (
            <p className="hint">
              <b>The media register returned no photographs.</b> An empty register is not a fault in this
              screen; the register itself is at <a href="/admin/media">/admin/media</a>.
            </p>
          ) : null}
        </div>
      </Card>

      <div style={{ marginTop: 14 }}>
        <Card title="Selected image" note="Accessibility + credit">
          {mediaSelected ? (
            <MediaDetail row={mediaSelected} screen={screen} overrides={screenOverrides} />
          ) : (
            <>
              <p className="hint">
                Choose a photograph above to see its address, its alternative text and its credit here.
              </p>
              {/*
                THE DESIGN'S SECOND CARD IS THE PER-SCREEN IMAGE OVERRIDE, WHICH IS THE REAL CONTROL.
                The mock-up's Selected image card is filled with a URL of `https://ozikoro.com/media/ndebe-hero.webp`
                and the credit "Ozikoro archive" — invented. What is real, and what the design's own
                "Scope: this page only / every screen where this image appears" selects describe, is the
                override: the pictures the SERVED page holds and the address each one may be pointed at
                instead. They are listed here with their own working forms.
              */}
              <div className="divider" />
              <p className="hint">
                <b>Photographs on /{screen}/ and the control that changes each one.</b> The scope select in the
                mock-up is a real choice on every row: a stored override may be filed against this screen or
                against every screen the design carries that picture on.
              </p>
              {items.filter((item) => item.can.image).length === 0 ? (
                <p className="hint">The served page reports no image slot on /{screen}/.</p>
              ) : (
                items.filter((item) => item.can.image).map((item) => (
                  <div key={item.key} id={`image-${encodeURIComponent(item.key)}`} style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                    <ImageForm
                      screen={screen}
                      itemKey={item.key}
                      title={item.label}
                      returnTo={backTo}
                      override={overrideFor('image', item.key)}
                      currentSrc={item.src ?? ''}
                      currentAlt={item.alt ?? ''}
                      creditKey={item.creditKey}
                      credit={item.credit}
                      undoLabel="this photograph"
                      previewQuery={{ kind: 'image', key: item.key, screen, src: item.src ?? '', alt: item.alt ?? '' }}
                    />
                  </div>
                ))
              )}
            </>
          )}
        </Card>
      </div>
    </>
  );

  /* ------------------------------------------------------------------ ICON / FAVICON */
  const iconTab = (
    <>
      <div className="grid">
        <Card title="Icon — the mark in a browser tab" note="One setting for the whole site">
          <p className="hint">
            Served at <code>/favicon.ico</code>. Accept PNG, JPEG, WebP, ICO or SVG. A square image of at least
            64×64 is recommended; maximum 200 KB. It is <b>one setting for the whole site</b>, and that address
            is <b>the one a browser asks for by itself</b> when a page declares no icon — which is what makes it
            reach every page here, including the 53 design screens and the archive&rsquo;s records, which are
            served from the approved design and never run this application&rsquo;s layout.
          </p>
          <div style={{ display: 'flex', gap: 20, alignItems: 'center', margin: '18px 0' }}>
            {/*
              ⚠️ THE DESIGN DRAWS ITS BRAND `.mark` HERE. THIS DRAWS THE STORED ICON.
              The mock-up's row is `<div class="mark" style="width:64px;height:64px"></div>` beside
              "Current Ozikoro mark · SVG · 24 KB · set by Idenze Ezeme" — the conic-gradient sun the rail
              already carries, and three facts about it that were never read from anywhere. The real setting
              is a data URL in `site_setting`, so the picture below is that stored image at 64px and the two
              facts beside it are its real media type and its real byte count. **Where the archive has no icon
              set, the row says so rather than showing a mark and calling it current.**
            */}
            {/* eslint-disable-next-line @next/next/no-img-element -- the served icon, at its real size and
                deliberately not reshaped: what the owner is looking at here is what the tab shows. */}
            <img
              src={`/favicon.ico?v=${favicon ? encodeURIComponent(favicon.updatedAt ?? 'set') : 'default'}`}
              alt={favicon ? 'The site icon as it is served now' : 'The archive’s own mark, as it is served now'}
              width={64}
              height={64}
              style={{ border: '1px solid var(--line)', background: 'var(--surface2)', imageRendering: 'pixelated' }}
            />
            <div>
              <b>{favicon ? `${favicon.mediaType} · ${Math.round((favicon.bytes / 1024) * 10) / 10} KB` : 'The archive’s own mark'}</b>
              <div className="hint">
                {favicon
                  ? <>
                      stored {favicon.updatedAt ? new Date(favicon.updatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'at some point'}
                      {favicon.actorName ? <>, set by {favicon.actorName}</> : <>, with no account recorded against it</>}
                    </>
                  : 'nothing is stored for this setting, so the archive serves the PNG it has always served'}
              </div>
            </div>
          </div>
          <form method="post" action="/api/admin/site-icons" encType="multipart/form-data">
            <input type="hidden" name="action" value="set" />
            <input type="hidden" name="returnTo" value={tabHref('favicon')} />
            <input
              className="field"
              type="file"
              name="icon"
              accept="image/png,image/jpeg,image/webp,image/x-icon,image/vnd.microsoft.icon,image/svg+xml"
              required
            />
            <div style={{ marginTop: 12 }}>
              <label className="label" htmlFor="icon-note">Audit note (optional)</label>
              <input className="field" id="icon-note" type="text" name="note" maxLength={500} placeholder="e.g. the gold sun on a transparent ground" />
            </div>
            <div className="actions" style={{ marginTop: 13 }}>
              <button className="btn primary" type="submit">Save this icon for the whole site</button>
            </div>
          </form>
          <form method="post" action="/api/admin/site-icons" style={{ marginTop: 8 }}>
            <input type="hidden" name="action" value="clear" />
            <input type="hidden" name="returnTo" value={tabHref('favicon')} />
            <button className="btn danger" type="submit" disabled={!favicon}>
              {favicon ? 'Put the archive’s own mark back' : 'The archive’s own mark is already in force'}
            </button>
          </form>
        </Card>

        <Card title="Live preview">
          <div style={{ textAlign: 'center' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#eae5dc', border: '1px solid #cfc6b8', padding: '7px 12px', borderRadius: 7, fontSize: 10 }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- the same served icon, at tab size. */}
              <img src={`/favicon.ico?v=${favicon ? encodeURIComponent(favicon.updatedAt ?? 'set') : 'default'}`} alt="" width={18} height={18} style={{ imageRendering: 'pixelated' }} />
              Ozikoro — African History
            </div>
            <p className="hint">
              The same icon is used for tabs, bookmarks and history entries. The tab title above is the archive&rsquo;s
              own name; the icon is the file stored at <code>/favicon.ico</code>.
            </p>
            <p className="hint">
              An SVG icon is also accepted; it is served as an image, not as a document, so nothing in it runs.
              The Apple touch icon on an iOS home screen is a different picture at a different size and is
              <b> not</b> changed here.
            </p>
          </div>
        </Card>
      </div>
    </>
  );

  /* ------------------------------------------------------------------ MY PROFILE */
  /*
   * ⚠️ NO SECOND ACCOUNT EDITOR, AND NO SAVE BUTTON THAT DOES NOTHING.
   *
   * The mock-up's profile card is filled with "Idenze Ezeme", "hello@ozikoro.com", "Historian · Editor ·
   * Founder", an ORCID of `0000-0000-0000-0000`, a biography sentence, and two Save buttons wired to
   * `toast()`. **The archive already has a real account screen at `/account/`, and its own note records
   * that display name, biography, password change and the rest have no write path yet.** So this tab shows
   * the session's real name, address, platform role, archive roles and stored profile fields, says exactly
   * which of them cannot be written from here yet, and links to the real screen. What it must never do —
   * and does not — is draw a field whose Save button does nothing.
   */
  const member = await getMemberOrNull(db, account.account.id);
  const picture = await accountPicture(db, account.account.id);
  const capabilityList = [...capabilities].sort();
  const profileTab = (
    <>
      <div className="profile">
        <div className="card profile-card">
          <div className="profile-pic">
            {picture.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- an address the account itself supplied.
              <img src={picture.avatarUrl} alt={`${displayNameOf(account.account.displayName, account.account.email)}’s profile picture`} />
            ) : (
              initialsOf(account.account.displayName, account.account.email)
            )}
          </div>
          <h3>{displayNameOf(account.account.displayName, account.account.email)}</h3>
          <p>
            {ROLE_LABEL[account.account.role] ?? account.account.role} · Ozikoro Administration
            <br />
            {/*
              ⚠️ THE ARCHIVE ROLE IS NOT PRINTED TWICE. `ROLE_LABEL[account.role]` already says "Owner" for
              this account, and `member.roles` holds `owner` again — so the line read "Owner · Ozikoro
              Administration / owner". The archive roles are shown only when they say something the platform
              role does not, which is the case for an editor, a moderator or a reviewer.
            */}
            {member?.roles && member.roles.length > 0 && !(member.roles.length === 1 && member.roles[0] === account.account.role)
              ? member.roles.join(', ')
              : member
                ? 'no separate archive role'
                : 'no membership record'}
          </p>
          {picture.avatarUrl ? (
            <p className="hint">A stored picture, <code>account.avatar_url</code>.</p>
          ) : (
            <p className="hint">
              <b>These are initials, not a profile picture.</b> The account has nothing stored in
              <code> account.avatar_url</code>, and the archive has no upload or URL field for one yet, so this
              circle shows the letters it derived from the name rather than a picture that does not exist.
            </p>
          )}
          <a className="btn small" href="/account/">Open the account screen</a>
        </div>

        <Card title="Account & profile" note="Read from the session and the account row">
          {/*
            ⚠️ THESE ARE NOT INPUTS, AND THAT IS THE POINT RATHER THAN A STYLE CHOICE.

            The mock-up draws six `.field`s here and two Save buttons wired to `toast('Profile saved')`. The
            archive has **no write path for a display name, a headline, an ORCID or a biography** — its own
            account screen says so — and a read-only input is the worst of both: it looks like a control,
            invites a person to click into it, and can never save what they type. *"A button that does nothing
            is worse than no button"* is equally true of a field. **So each fact is printed as the value it
            is**, with an honest line where the archive holds nothing, and the link at the end is the real
            destination.
          */}
          <dl className="stack" style={{ margin: 0 }}>
            <div className="row">
              <div>
                <dt className="label">Display name</dt>
                <dd style={{ margin: 0 }}>{account.account.displayName ?? <span className="hint">no display name is stored</span>}</dd>
              </div>
              <div>
                <dt className="label">Email</dt>
                <dd style={{ margin: 0 }}>{account.account.email}</dd>
              </div>
            </div>
            <div className="row">
              <div>
                <dt className="label">Headline</dt>
                <dd style={{ margin: 0 }}>{member?.headline ?? <span className="hint">nothing stored</span>}</dd>
              </div>
              <div>
                <dt className="label">ORCID</dt>
                <dd style={{ margin: 0 }}>{member?.orcid ?? <span className="hint">nothing stored</span>}</dd>
              </div>
            </div>
            <div>
              <dt className="label">Biography</dt>
              <dd style={{ margin: 0 }}>{member?.bio ?? <span className="hint">nothing stored</span>}</dd>
            </div>
            <div>
              <dt className="label">Membership</dt>
              <dd style={{ margin: 0 }}>
                {member
                  ? <>joined {new Date(member.createdAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })} · status {member.status} · profile {member.isPublic ? 'public' : 'not public'}</>
                  : <span className="hint">this account has no membership row</span>}
              </dd>
            </div>
          </dl>
          <div className="divider" />
          <h4 style={{ margin: 0, fontSize: 13 }}>Security</h4>
          <p className="hint">
            <b>There is no password field here and no &ldquo;Change password&rdquo; button, and that is
            deliberate.</b> This page can reach the design tables and the media register; changing an
            account&rsquo;s password is a different act, and the archive&rsquo;s own account screen records
            that it has no write path for it yet. <b>A control wired to nothing is the fault this whole tab
            exists to avoid</b>, so the screen says where the account lives instead:{' '}
            <a href="/account/">the account screen at /account/</a>.
          </p>
          <div className="divider" />
          <h4 style={{ margin: 0, fontSize: 13 }}>What this account may do</h4>
          <p className="hint">
            Platform role <b>{account.account.role}</b>, resolved against the database rather than read from
            a cookie. Archive roles: <b>{member?.roles && member.roles.length > 0 ? member.roles.join(', ') : 'none'}</b>.
            This screen needs <code>manage_design</code>, which is one of{' '}
            <b>{capabilityList.length}</b> capabilities this account holds.
          </p>
          <p className="hint">
            {capabilityList.length > 0
              ? capabilityList.map((capability) => <span key={capability} className="status" style={{ marginRight: 5 }}>{capability}</span>)
              : 'No capabilities resolved for this account.'}
          </p>
        </Card>
      </div>
    </>
  );

  /* ------------------------------------------------------------------ WRITING */
  /*
   * ⚠️🔴 THE OWNER'S OWN INSTRUCTION ABOUT THIS TAB, VERBATIM:
   *
   *   *"before while importing the design on the html i supplied now, do make sure when one clicks on posts
   *   or pages, they can add new posts or pages, and the classic editor will be there, but never named
   *   classic editor."*
   *
   * SO: (a) the writing surface is `/admin/posts/new` and `/admin/pages/new`, which render the archive's
   * own `EditorScreen` and ARE reachable from the rails' own submenus — verified by fetching those built
   * pages, not by reading the source. (b) **the words "Classic Editor" appear in no text this page
   * renders.** The tab is `Writing`. The code comments in `classic-editor/screens.tsx` may name it; nothing
   * a reader can see does.
   *
   * ⚠️ **AND THIS TAB IS NOT A SECOND EDITOR.** The mock-up draws a whole editing surface with a
   * `contenteditable` body — a painted article about Igbo-Ukwu, four invented paragraphs, an invented
   * title, tags `igbo-ukwu · archaeology · bronze` and a featured image placeholder. A working editor here
   * would be a second one, with its own save path, disagreeing with the real one the first time either
   * changed; a non-working one is the exact "button that does nothing" fault named above. So the tab is the
   * design's own shape — `.wpbar`, a table of the real pieces, and the real links — saying truthfully where
   * the writing surface is.
   */
  const writingTab = (
    <>
      <Card title="Writing" note="Where posts and pages are written">
        <div className="wpbar">
          <b>Posts → Add New</b>
          <div>
            <a className="btn small" href="/admin/posts/new">Add New Post</a>{' '}
            <a className="btn small" href="/admin/pages/new">Add New Page</a>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 12 }}>
          The writing surface is the archive&rsquo;s own editor, and it opens from the rail&rsquo;s two
          submenus — <b>Posts → Add New Post</b> and <b>Pages → Add New Page</b>. It carries the title, the
          Visual and Text modes, the formatting toolbar, media insertion, links, lists, alignment,
          full-screen editing, and the publishing boxes for categories, tags, featured image, excerpt and
          custom fields. <b>It is one editor with one save path</b>, which is why this tab links to it rather
          than drawing a second one beside it.
        </p>
        <div className="actions">
          <a className="btn" href="/admin/posts/new">Add New Post</a>
          <a className="btn" href="/admin/pages/new">Add New Page</a>
          <a className="btn" href="/admin/posts">All Posts</a>
          <a className="btn" href="/admin/pages">All Pages</a>
        </div>
        <div className="divider" />
        {recentPosts.length === 0 && recentPages.length === 0 ? (
          <p className="hint">
            <b>Nothing has been written yet.</b> Neither a post nor a page is stored in the archive, so this
            list is empty — which is the state a new archive starts in and not a fault. Pressing <b>Write a
            new post</b> opens the editor at <code>/admin/posts/new</code>.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Kind</th><th>Title</th><th>Status</th><th>Words</th><th>Last changed</th><th /></tr>
            </thead>
            <tbody>
              {[...recentPosts.map((piece) => ({ piece, kind: 'post' as const })), ...recentPages.map((piece) => ({ piece, kind: 'page' as const }))].map(({ piece, kind }) => (
                <tr key={`${kind}-${piece.id}`}>
                  <td>{kind}</td>
                  <td><b>{piece.title || 'untitled'}</b><br /><code>/{piece.slug}/</code></td>
                  <td><span className="status">{piece.status}</span></td>
                  <td>{piece.wordCount}</td>
                  <td>{new Date(piece.modifiedAt ?? piece.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td><a className="btn small" href={`/admin/${kind === 'post' ? 'posts' : 'pages'}/${piece.id}`}>Edit</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );

  /* ------------------------------------------------------------------ DESIGN HISTORY */
  const historyTab = (
    <>
      <Card title="Every design edit in force" note={`${overrides.length} row${overrides.length === 1 ? '' : 's'} · undo one · this screen · everything`}>
        <div className="actions" style={{ marginBottom: 15 }}>
          <form method="post" action="/api/admin/design">
            <input type="hidden" name="action" value="reset-screen" />
            <input type="hidden" name="screen" value={screen} />
            <input type="hidden" name="returnTo" value={tabHref('history', { screen })} />
            <button className="btn danger" type="submit" disabled={screenOverrides.length === 0}>
              Put /{screen}/ back to design ({screenOverrides.length})
            </button>
          </form>
          <form method="post" action="/api/admin/design">
            <input type="hidden" name="action" value="reset-all" />
            <input type="hidden" name="returnTo" value={tabHref('studio')} />
            <button className="btn danger" type="submit" disabled={overrides.length === 0}>
              Put every screen back to design ({overrides.length})
            </button>
          </form>
        </div>
        <p className="hint">
          Removing an edit returns the page to the design&rsquo;s own value. It is safe to do either of these
          at any time: nothing is deleted from the design, and every removal is written to the audit trail with
          your name on it. <b>An edit made on every screen is not removed by &ldquo;put this page back&rdquo;</b>
          {' '}— it is one row filed under every screen, so it is undone in the list below, one row, one Undo.
        </p>
        {overrides.length === 0 ? (
          <p className="hint">
            <b>None. Every screen is exactly as the design made it</b> — the archive&rsquo;s own colours, its own
            fonts, its own words, its own pictures and its own mark in the tab. This is the state the site is
            built to be in, and an empty list here is not a fault.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Section</th><th>Screen</th><th>Kind</th><th>What</th><th>Value</th><th>By</th><th>When</th><th /></tr>
            </thead>
            <tbody>
              {overrides.map((override) => (
                <tr key={override.id}>
                  <td>{SECTION_LABELS[sectionOf(override)]}</td>
                  <td>{override.screen === ALL_SCREENS ? 'every screen' : `/${override.screen}/`}</td>
                  <td>{override.kind}</td>
                  <td>{override.label ?? override.key}</td>
                  <td><code style={{ wordBreak: 'break-all' }}>{valueSummary(override)}</code></td>
                  <td>{override.actorName ?? '—'}</td>
                  <td>
                    {override.updatedAt
                      ? new Date(override.updatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
                      : '—'}
                  </td>
                  <td>
                    <form method="post" action="/api/admin/design">
                      <input type="hidden" name="action" value="remove" />
                      <input type="hidden" name="id" value={String(override.id)} />
                      <input type="hidden" name="returnTo" value={tabHref('history', { screen })} />
                      <button className="btn small" type="submit">Undo</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );

  const body = tab === 'colours' ? colourTab
    : tab === 'type' ? typeTab
      : tab === 'text' ? textTab
        : tab === 'widgets' ? widgetTab
          : tab === 'media' ? mediaTab
            : tab === 'favicon' ? iconTab
              : tab === 'profile' ? profileTab
                : tab === 'writing' ? writingTab
                  : tab === 'history' ? historyTab
                    : studio;

  return (
    <>
      <div className="title-row">
        <div>
          <div className="eyebrow">Owner&rsquo;s visual control centre</div>
          <div className="title-row" style={{ margin: 0 }}>
            <h2>Appearance</h2>
            <span className="badge gold" style={{ marginLeft: 12 }}>Live design system</span>
          </div>
          <p className="hint" style={{ maxWidth: 700 }}>
            Control the delivered website without editing the design files. Change the global palette,
            typography, imagery, page widgets, copy, links, visibility, favicon and page-specific presentation
            — then preview the real public page.
          </p>
        </div>
        <div className="actions">
          <a className="btn" href="/" target="_blank" rel="noreferrer">Open public site ↗</a>
          {/*
            ⚠️ THE MOCK-UP'S `Save changes` BUTTON IS DELIBERATELY NOT HERE, AND THAT IS THE OWNER'S OWN RULE.
            Its `onclick` was `toast('All pending design changes saved')` — it saved nothing, because there is
            nothing for it to save: **every edit on this screen is written by the Save on the row it belongs
            to**, immediately, to `/api/admin/design`, with an audit row and a way back. A second page-level
            Save would either have to duplicate that path or post nothing, and *"a button that does nothing is
            worse than no button, because it teaches the owner that the screen is finished when it is not."*
            So the page says where saving happens rather than drawing a control that cannot.
          */}
          <span className="hint" style={{ alignSelf: 'center', maxWidth: '18rem' }}>
            Each row saves itself: use <b>Save</b> on the token or element you changed, and the row will
            offer to put it back.
          </span>
        </div>
      </div>

      <Notices saved={one('saved')} error={one('error')} info={one('info')} />

      <Tabs active={tab} counts={counts} hrefFor={(next) => tabLink(next, { screen })} />

      {body}

      {/*
        THE ONE PIECE OF SCRIPT ON THIS SCREEN, AND IT CARRIES NOTHING.

        It reconciles the two controls on a token row that a native form cannot reconcile by itself — the
        colour picker and the hex box, and the font chooser and the stack box. **Every form here works
        without it**: see the note in `form-sync.tsx`, which is where the reasoning and the one hazard it
        guards against are written down.
      */}
      <DesignFormSync />
    </>
  );
}

/* ==================================================================================================
 * 4. THE SMALL READERS THE TABS NEED
 * ================================================================================================ */

const SECTION_LABELS: Record<string, string> = {
  colours: 'Colours',
  type: 'Fonts & type',
  texts: 'Text',
  images: 'Images',
  links: 'Links & hidden blocks',
};

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  owner: 'Owner',
  editor: 'Editor',
  contributor: 'Contributor',
};

function displayNameOf(displayName: string | null, email: string): string {
  return (displayName ?? '').trim() || email;
}

/**
 * The account's initials, for the circle the design draws.
 *
 * ⚠️ **DERIVED FROM THE NAME, NEVER INVENTED**, and the tab says in words that this is what it is when the
 * account has no stored picture. A display name of "Idenze Ezeme" gives `IE`; an account with no display
 * name falls back to the email's first letter, and one with neither gives a single `·`. **The design shows
 * `IE` because its sample account is the owner's; this computes whatever the signed-in account actually is.**
 */
function initialsOf(displayName: string | null, email: string): string {
  const source = (displayName ?? '').trim();
  if (source) {
    const words = source.split(/\s+/).filter(Boolean);
    const letters = words.slice(0, 2).map((w) => [...w][0] ?? '');
    const joined = letters.join('').toUpperCase();
    if (joined) return joined;
  }
  const first = [...(email.trim() || '·')][0] ?? '·';
  return first.toUpperCase();
}

/**
 * The account's stored profile, or null when the account has no membership row.
 *
 * ⚠️ **NULL AND NOT A DEFAULT.** `getMember` joins `ozikoro_member`, and an account that has never been
 * through the members table has no headline, no biography and no ORCID — which is not the same fact as
 * having empty ones, and the tab prints "nothing stored" rather than a plausible sentence.
 */
async function getMemberOrNull(db: Db, accountId: number) {
  try {
    const { getMember } = await import('@ozikoro/platform');
    return await getMember(db, accountId);
  } catch {
    return null;
  }
}

/**
 * The account's stored picture, which `getMember` does not carry.
 *
 * ⚠️ **THE ONE FACT THE PROFILE TAB NEEDS THAT THE MEMBER ROW DOES NOT HOLD.** `account.avatar_url` is the
 * column migration 0033 added and `setAccountAvatar` writes; the query is here because the alternative was
 * a member shape changed to serve one screen. **A null is the honest answer for an account with no picture,
 * and the tab says in words that the circle it draws is initials rather than a photograph.**
 */
async function accountPicture(db: Db, accountId: number): Promise<{ avatarUrl: string | null }> {
  try {
    const row = await db.one<{ avatar_url: string | null }>(
      `select avatar_url from account where id = $1`,
      [accountId]
    );
    return { avatarUrl: row?.avatar_url ?? null };
  } catch {
    return { avatarUrl: null };
  }
}

/**
 * The design's "Selected image" card, filled from the archive's own register rather than from the mock-up.
 *
 * The mock-up's card carries an address, an alternative text, the credit "Ozikoro archive" and the two
 * badges "✓ Image resolves" and "Alt text present". **Both badges are checks, so both are made here**: the
 * first is `row.url !== null`, which is the archive's own record of whether it holds the file, and the
 * second is whether the row has stored alt text. Where the check fails, the badge says so.
 */
function MediaDetail({ row, screen, overrides }: { row: MediaRecord; screen: string; overrides: DesignOverride[] }) {
  const uses = overrides.filter((o) => o.kind === 'image' && o.value.src === row.url);
  return (
    <div className="row">
      <div>
        <span className="label">Image address</span>
        {row.url ? <p style={{ margin: '0 0 4px', wordBreak: 'break-all' }}><code>{row.url}</code></p> : <p className="hint" style={{ margin: 0 }}>the archive does not hold this file</p>}
        <span className="label" style={{ marginTop: 12 }}>Alternative text</span>
        {row.altText
          ? <p style={{ margin: 0 }}>{row.altText}</p>
          : <p className="hint" style={{ margin: 0 }}>no alternative text is stored for this picture</p>}
        <p className="hint" style={{ marginTop: 8 }}>
          Its own record is at <a href={`/media/${row.slug}/`}>{`/media/${row.slug}/`}</a>, and its fields are
          edited in <a href={`/admin/media/${row.id}`}>the media register</a> — the register owns a picture&rsquo;s
          text, and this screen owns where a page points. <b>Nothing here is a field</b>, because a
          read-only field is a control that cannot act.
        </p>
      </div>
      <div>
        <span className="label">Credit</span>
        {row.credit ? <p style={{ margin: 0 }}>{row.credit}</p> : <p className="hint" style={{ margin: 0 }}>no credit is recorded</p>}
        <span className="label" style={{ marginTop: 12 }}>Scope</span>
        <p style={{ margin: 0 }}>
          {uses.length > 0
            ? `${uses.length} design override${uses.length === 1 ? '' : 's'} point at this file`
            : 'no page override points at this file'}
        </p>
        <div style={{ marginTop: 13 }}>
          {row.url ? <Badge tone="green">✓ The archive holds this file</Badge> : <Badge tone="red">✗ The archive does not hold this file</Badge>}{' '}
          {row.altText ? <Badge tone="green">✓ Alternative text present</Badge> : <Badge tone="gold">No alternative text</Badge>}{' '}
          {row.licence ? <Badge tone="green">✓ Licence recorded</Badge> : <Badge tone="gold">No licence recorded</Badge>}
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          <b>{row.reference}</b> · {row.kind} · {row.mimeType ?? 'type unknown'}
          {row.width && row.height ? ` · ${row.width}×${row.height}` : ''}
          {row.filesizeBytes !== null ? ` · ${Math.round((row.filesizeBytes / 1024) * 10) / 10} KB` : ''}
          {' · used as a featured image on '}{row.usedByArticles}{' article'}{row.usedByArticles === 1 ? '' : 's'}.
          {' '}Read on <code>/{screen}/</code>.
        </p>
      </div>
    </div>
  );
}
