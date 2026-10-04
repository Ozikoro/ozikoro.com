/**
 * /admin/design — the owner's own design editor.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * `apps/ozikoro/public/design/` is the approved deliverable and is byte-compared against the handover copy, so
 * nothing here writes to it. The owner's edits are rows in `ozikoro_design_override`, applied at serve time on
 * top of the rendered page — which is why they can be undone one at a time, compared, and attributed to the
 * person who made them. **A file mutated in place can do none of those three things**, and that is the whole
 * argument for this screen existing beside the deliverable rather than inside it.
 *
 * WHY THE COLOURS COME FIRST
 *
 * The owner asked for "every single part of the design, including the colours", and named the colours first.
 * The palette is also the one edit whose reach is not obvious: **`--accent` is read by hundreds of rules**, so
 * a change to it lands in places no single-component edit could reach. Each row therefore says how many rules
 * read the token — "read by 34 rules" is the difference between a swatch and a site-wide decision.
 *
 * WHY SOME SWATCHES CARRY A WARNING
 *
 * A token that encodes a state is not a decoration: `--moss` is the VERIFIED state, `--accent` is the link
 * colour, `--focus` is the focus ring, and `--ink-faint` is the tone a control disappears at. Those rows are
 * marked, the contrast each one must reach is measured against the surfaces it actually sits on, and a pair
 * that fails says so in red with the ratio. **Nothing is blocked** — the owner asked to be able to edit every
 * part, and a refusal would be a lie about what the tool can do — **but nothing is silent either.**
 *
 * WHERE THE ELEMENT LIST COMES FROM
 *
 * From the SERVED page, fetched from this same server with the caller's own cookie. `/donate/`'s notice does
 * not exist in `donate.html` — `fillDonate` writes it — and the same fill deletes the page's submit button, so
 * a list built from the file would offer a button that is not on the page and hide the notice that is.
 */
import { readFile } from 'node:fs/promises';
import { headers } from 'next/headers';
import { join } from 'node:path';
import { getDb } from '@ozituma/db/client';
import {
  ALL_SCREENS,
  CONTRAST_PAIRS,
  contrastReport,
  listDesignOverrides,
  parseDesignTokens,
  type DesignOverride,
  type DesignToken,
  type InventoryItem,
} from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head, Notices } from '../ui';

export const dynamic = 'force-dynamic';

const DESIGN_DIR = join(process.cwd(), 'public', 'design');

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
     * the design's own #8d8577 measures 3.24:1 on the page ground and is used for real text (a placeholder, a
     * count beside a filter, and the empty state). **A catalogue built from `tokens.css` alone would show the
     * owner a value the page does not paint, and "restoring" it would undo an accessibility fix.** So the
     * served baseline is the design's value with the application's own corrections laid over it, and each row
     * says which of the two it is showing.
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
 * The inventory needs the FILLED document, and only the route that serves it can produce that — so this asks
 * that route, at this same origin, with the caller's cookie, because the inventory is gated on the same
 * capability as this screen. A failure is reported rather than hidden: an editor that silently showed the
 * design file's elements instead would offer the owner keys that match nothing on the page he is looking at.
 */
async function inventoryFor(screen: string): Promise<{ items: InventoryItem[]; total: number } | { error: string }> {
  const h = await headers();
  const host = h.get('host') ?? '';
  if (host.length === 0) return { error: 'This server could not be reached to read the served page.' };
  const proto = h.get('x-forwarded-proto') ?? (/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host) ? 'http' : 'https');
  try {
    /*
     * THE PUBLIC ADDRESS, NOT THE ROUTE'S OWN. `/<screen>/` is what a reader types and what the middleware
     * rewrites to `/design-screen/<screen>`, so asking a reader's address means the fills, the head and the
     * stylesheets are exactly the ones the owner sees. Asking the route directly works now that the
     * middleware knows it is a route — but it would be a second way in, and the address a reader uses is the
     * one that has to be right.
     */
    const path = screen === 'home' ? '/' : `/${screen}/`;
    const res = await fetch(`${proto}://${host}${path}?ozinventory=1`, {
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

/**
 * The token's value in force: the owner's edit if there is one, otherwise what the page actually paints —
 * which is the design's declaration overlaid with the application's own accessibility correction.
 */
function inForce(token: DesignToken, overrides: Map<string, DesignOverride>, servedBase: Map<string, string>): { value: string; overridden: boolean } {
  const override = overrides.get(token.name);
  if (override && typeof override.value.value === 'string' && override.value.value.length > 0) {
    return { value: override.value.value, overridden: true };
  }
  return { value: servedBase.get(token.name) ?? token.value, overridden: false };
}

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

/** The one way an edit is removed, used by every row. */
function UndoForm({ screen, kind, itemKey, label }: { screen: string; kind: string; itemKey: string; label: string }) {
  return (
    <form method="post" action="/api/admin/design" style={{ marginTop: '.3rem' }}>
      <input type="hidden" name="action" value="remove" />
      <input type="hidden" name="screen" value={screen} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="key" value={itemKey} />
      <input type="hidden" name="returnTo" value={screen === ALL_SCREENS ? '/admin/design/' : `/admin/design/?screen=${screen}`} />
      <button className="btn btn-quiet" type="submit">Undo — put {label} back to the design</button>
    </form>
  );
}

/** One token: what it is, what it does, what it is now, and the three things that can be done to it. */
function TokenRow({ token, override, value, contrast }: {
  token: DesignToken;
  override: DesignOverride | undefined;
  value: string;
  contrast: { role: string; ratio: number | null; min: number; pass: boolean }[];
}) {
  const isColour = token.tokenClass === 'colour';
  const failed = contrast.filter((row) => !row.pass);
  return (
    <form method="post" action="/api/admin/design" className="design-row" style={{ padding: '.75rem 0', borderTop: '1px solid var(--rule)' }}>
      <input type="hidden" name="action" value="set" />
      <input type="hidden" name="kind" value="token" />
      <input type="hidden" name="key" value={`--${token.name}`} />
      <input type="hidden" name="title" value={`${token.group} · --${token.name}`} />
      <input type="hidden" name="returnTo" value="/admin/design/" />
      <div className="spread" style={{ gap: 'var(--s-4)', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div style={{ minWidth: '18rem', flex: '1 1 20rem' }}>
          <p style={{ margin: 0 }}>
            <Swatch value={value} /> <code>--{token.name}</code>{' '}
            {token.role === 'meaning' ? <Badge tone="meaning">carries meaning</Badge> : <Badge tone="decoration">decoration</Badge>}
            {override ? <>{' '}<Badge tone="meaning">edited</Badge></> : null}
          </p>
          <p className="small muted" style={{ margin: '.2rem 0 0' }}>
            {token.comment ?? token.note ?? `${token.group} · ${token.tokenClass}`}
            {' '}Read by <b>{token.uses}</b> rule{token.uses === 1 ? '' : 's'} in the design’s stylesheets.
          </p>
          {!override && value !== token.value ? (
            <p className="small muted" style={{ margin: '.2rem 0 0' }}>
              The design declares <code>{token.value}</code>; the page paints <code>{value}</code>, because{' '}
              <code>/a11y.css</code> corrects this one for accessibility after the design’s sheets load. Editing it
              here overrides both.
            </p>
          ) : null}
          {token.note && token.comment ? <p className="small muted" style={{ margin: '.2rem 0 0' }}>{token.note}</p> : null}
        </div>
        <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {isColour ? <input type="color" name="value" defaultValue={value.startsWith('#') ? value : '#000000'} aria-label={`${token.name} colour picker`} /> : null}
          <input
            type="text"
            name={isColour ? 'value_text' : 'value'}
            defaultValue={override ? value : ''}
            placeholder={token.value}
            aria-label={`${token.name} value`}
            style={{ width: '16rem', fontFamily: 'ui-monospace, monospace' }}
          />
          <button className="btn" type="submit">Save</button>
          <button className="btn btn-quiet" type="submit" formAction="/admin/design/preview" formMethod="get" formTarget="_blank"
            name="previewScreen" value="home">
            Preview
          </button>
        </div>
      </div>
      {/* UNDO IS ITS OWN FORM. Two inputs named `action` in one form would be resolved by document order,
          which is a rule nobody reading the markup can see — so the removal names its own action. */}
      {override ? (
        <UndoForm screen={ALL_SCREENS} kind="token" itemKey={`--${token.name}`} label={`--${token.name}`} />
      ) : null}
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
    </form>
  );
}

/** One place on a screen, with every action that is honest for it. */
function ElementRow({ item, screen, override }: {
  item: InventoryItem;
  screen: string;
  override: (kind: 'text' | 'image' | 'link' | 'hide') => DesignOverride | undefined;
}) {
  const textOverride = override('text');
  const imageOverride = override('image');
  const linkOverride = override('link');
  const hidden = Boolean(override('hide'));
  const heading = /^h[1-4]$/.test(item.tag);
  return (
    <details style={{ borderTop: '1px solid var(--rule)', padding: '.5rem 0' }}>
      <summary style={{ cursor: 'pointer' }}>
        {hidden ? <Badge tone="fail">hidden</Badge> : null}{' '}
        {heading ? <Badge tone="meaning">{item.tag}</Badge> : null}{' '}
        <span className="small">{item.label}</span>
      </summary>
      <p className="small muted" style={{ margin: '.4rem 0' }}>
        <code>{item.key}</code>
        {textOverride || imageOverride || linkOverride ? <> · <Badge tone="meaning">edited</Badge></> : null}
        {item.textReason ? <><br />{item.textReason}</> : null}
      </p>

      {item.can.text ? (
        <form method="post" action="/api/admin/design" style={{ margin: '.4rem 0' }}>
          <input type="hidden" name="action" value="set" />
          <input type="hidden" name="kind" value="text" />
          <input type="hidden" name="screen" value={screen} />
          <input type="hidden" name="key" value={item.key} />
          <input type="hidden" name="title" value={item.label} />
          <input type="hidden" name="returnTo" value={`/admin/design/?screen=${screen}`} />
          <label className="small" htmlFor={`text-${item.key}`}>Text</label>
          <textarea
            id={`text-${item.key}`}
            name="text"
            rows={item.text.length > 90 ? 3 : 1}
            defaultValue={textOverride?.value.text ?? ''}
            placeholder={item.text}
            style={{ width: '100%', fontFamily: 'inherit' }}
          />
          <div style={{ display: 'flex', gap: '.4rem', marginTop: '.3rem', flexWrap: 'wrap' }}>
            <button className="btn" type="submit">Save text</button>
            <button className="btn btn-quiet" type="submit" formAction="/admin/design/preview" formMethod="get" formTarget="_blank">Preview</button>
          </div>
        </form>
      ) : null}
      {textOverride ? (
        <UndoForm screen={screen} kind="text" itemKey={item.key} label="this text" />
      ) : null}

      {item.can.image ? (
        <form method="post" action="/api/admin/design" style={{ margin: '.4rem 0' }}>
          <input type="hidden" name="action" value="set" />
          <input type="hidden" name="kind" value="image" />
          <input type="hidden" name="screen" value={screen} />
          <input type="hidden" name="key" value={item.key} />
          <input type="hidden" name="title" value={item.label} />
          {item.creditKey ? <input type="hidden" name="creditKey" value={item.creditKey} /> : null}
          <input type="hidden" name="returnTo" value={`/admin/design/?screen=${screen}`} />
          <p className="small" style={{ margin: 0 }}>Image address<input type="text" name="src" defaultValue={imageOverride?.value.src ?? ''} placeholder={item.src} style={{ width: '100%' }} /></p>
          <p className="small" style={{ margin: 0 }}>Alternative text<input type="text" name="alt" defaultValue={imageOverride?.value.alt ?? ''} placeholder={item.alt || 'Describe the photograph for a reader who cannot see it'} style={{ width: '100%' }} /></p>
          <p className="small" style={{ margin: 0 }}>
            Credit{item.creditKey ? <> (<code>{item.creditKey}</code>)</> : <> — this photograph has no credit slot in the design</>}
            <input type="text" name="credit" defaultValue={imageOverride?.value.credit ?? ''} placeholder={item.credit ?? ''} style={{ width: '100%' }} disabled={!item.creditKey} />
          </p>
          <p className="small" style={{ margin: '.2rem 0 0' }}>
            {/*
              THE DELIBERATE HOLE. A same-origin address is fetched before it is saved, and a 404 refuses the
              save — because a broken image is the fault this editor was built to remove, and its own probing
              put two on this very page. This is the way to say you mean it: an image that will be uploaded
              after the page is prepared.
            */}
            <label>
              <input type="checkbox" name="allow_missing" value="1" /> The file will be added later — save the address even if nothing answers at it yet.
            </label>
          </p>
          <div style={{ display: 'flex', gap: '.4rem', marginTop: '.3rem', flexWrap: 'wrap' }}>
            <button className="btn" type="submit">Save photograph</button>
            <button className="btn btn-quiet" type="submit" formAction="/admin/design/preview" formMethod="get" formTarget="_blank">Preview</button>
          </div>
        </form>
      ) : null}
      {imageOverride ? (
        <UndoForm screen={screen} kind="image" itemKey={item.key} label="this photograph" />
      ) : null}

      {item.can.link ? (
        <form method="post" action="/api/admin/design" style={{ margin: '.4rem 0' }}>
          <input type="hidden" name="action" value="set" />
          <input type="hidden" name="kind" value="link" />
          <input type="hidden" name="screen" value={screen} />
          <input type="hidden" name="key" value={item.key} />
          <input type="hidden" name="title" value={item.label} />
          <input type="hidden" name="returnTo" value={`/admin/design/?screen=${screen}`} />
          <p className="small" style={{ margin: 0 }}>Label<input type="text" name="linkLabel" defaultValue={linkOverride?.value.label ?? ''} placeholder={item.text} style={{ width: '100%' }} /></p>
          <p className="small" style={{ margin: 0 }}>Goes to<input type="text" name="href" defaultValue={linkOverride?.value.href ?? ''} placeholder={item.href} style={{ width: '100%' }} /></p>
          <div style={{ display: 'flex', gap: '.4rem', marginTop: '.3rem', flexWrap: 'wrap' }}>
            <button className="btn" type="submit">Save link</button>
            <button className="btn btn-quiet" type="submit" formAction="/admin/design/preview" formMethod="get" formTarget="_blank">Preview</button>
          </div>
        </form>
      ) : null}
      {linkOverride ? (
        <UndoForm screen={screen} kind="link" itemKey={item.key} label="this link" />
      ) : null}

      {item.can.hide ? (
        <form method="post" action="/api/admin/design" style={{ margin: '.4rem 0' }}>
          <input type="hidden" name="action" value={hidden ? 'remove' : 'set'} />
          <input type="hidden" name="kind" value="hide" />
          <input type="hidden" name="screen" value={screen} />
          <input type="hidden" name="key" value={item.key} />
          <input type="hidden" name="title" value={item.label} />
          <input type="hidden" name="returnTo" value={`/admin/design/?screen=${screen}`} />
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
  const [tokensResult, screens, overrides] = await Promise.all([
    designTokens(),
    designScreens(),
    listDesignOverrides(db),
  ]);

  const tokenOverrides = new Map<string, DesignOverride>();
  for (const override of overrides) {
    if (override.kind === 'token' && override.key.startsWith('--')) tokenOverrides.set(override.key.slice(2), override);
  }
  const values = new Map<string, string>();
  for (const token of tokensResult.tokens) values.set(token.name, inForce(token, tokenOverrides, tokensResult.served).value);
  const contrast = contrastReport(values);
  // WHICH PAIRS ARE ABOUT WHICH TOKEN, so a failing ratio is printed on the row it is about rather than in a
  // table the owner has to cross-reference. Each token shows the pairs it appears in.
  const pairsFor = (name: string) =>
    contrast.filter((row) => row.fg === name || row.bg === name).map((row) => ({ role: row.role, ratio: row.ratio, min: row.min, pass: row.pass }));

  /*
   * AN ALIAS IS WHATEVER IT POINTS AT. `--bg: var(--paper)` is a colour, and filing it under "type, spacing
   * and shape" because its own value is a `var()` would put a swatch in the wrong card and offer the owner a
   * text box where he expects a colour picker.
   */
  const byName = new Map(tokensResult.tokens.map((t) => [t.name, t]));
  const effectiveClass = (token: DesignToken): string => {
    let current = token;
    const seen = new Set<string>([token.name]);
    while (current.tokenClass === 'alias') {
      const next = byName.get(current.references[0] ?? '');
      if (!next || seen.has(next.name)) break;
      seen.add(next.name);
      current = next;
    }
    return current.tokenClass;
  };
  const isColour = (t: DesignToken) => ['colour', 'gradient'].includes(effectiveClass(t));
  const colourTokens = tokensResult.tokens.filter(isColour);
  const typeTokens = tokensResult.tokens.filter((t) => !isColour(t));
  const colourGroups = [...new Set(colourTokens.map((t) => t.group))];
  const typeGroups = [...new Set(typeTokens.map((t) => t.group))];

  const screen = one('screen') || screens.find((s) => s === 'about') || screens[0] || 'home';
  const inventory = await inventoryFor(screen);
  const screenOverrides = overrides.filter((o) => o.screen === screen);
  const overrideFor = (kind: string, key: string) => screenOverrides.find((o) => o.kind === kind && o.key === key);

  const failedPairs = contrast.filter((row) => !row.pass);
  const items = 'items' in inventory ? inventory.items : [];

  return (
    <div className="admin-shell">
      <Head title="The design">
        {/*
          One page, opened the way a reader opens it. The preview is a real tab rather than an iframe because
          the site answers `X-Frame-Options: DENY` — deliberately — and that is not a header to weaken so an
          editor can embed its own pages.
        */}
        <a className="btn btn-quiet" href={screen === 'home' ? '/' : `/${screen}/`} target="_blank" rel="noreferrer">
          Open {screen === 'home' ? 'the home page' : `/${screen}/`} in a new tab
        </a>
      </Head>

      <Notices saved={one('saved')} error={one('error')} />

      <Card title="What this can change, and where it is kept">
        <AtAGlance
          rows={[
            ['Every design screen', `${screens.length} screens, served from the deliverable and editable here`],
            ['Colour tokens', `${colourTokens.length} — ${colourTokens.filter((t) => t.role === 'meaning').length} of them carry meaning, not decoration`],
            ['Type, spacing and shape tokens', `${typeTokens.length}`],
            ['Edits in force', `${overrides.length}${overrides.length === 0 ? ' — every screen is exactly as the design made it' : ''}`],
            ['Where they live', 'the database, applied at serve time'],
            ['The design files', 'not written to, ever — 63 files, checked byte for byte against the handover copy'],
            ['Signed in as', `${account.account.displayName ?? account.account.email} (${[...capabilities].filter((c) => c === 'manage_design').join('') || 'no design capability'})`],
          ]}
        />
        <p className="small muted" style={{ marginTop: 'var(--s-4)' }}>
          An edit is a row: the value, who set it and when, and an audit entry every time it changes. Removing a
          row returns the page to the design’s own value — <b>nothing here deletes anything from the design.</b>{' '}
          A heading that a serve-time fill writes (like <code>/donate/</code>’s notice) is overridden after that
          fill runs, so an edit to one wins rather than being overwritten.
        </p>
      </Card>

      <Card title={`Colours — ${colourTokens.length} tokens`}>
        <p className="small muted">
          A token is the whole of a colour decision: <code>--accent</code> is read wherever the design draws a
          link or a mark, so changing it changes every one of them at once rather than restyling one component.
          The count beside each token is how many rules read it. <b>Nothing is blocked</b> — the palette is
          yours — but a token that carries meaning is marked, and the contrast it has to reach is measured.
        </p>
        {tokensResult.error ? <Notices error={`The design’s token file could not be read: ${tokensResult.error}`} /> : null}
        {colourGroups.map((group) => (
          <div key={group}>
            <h3 style={{ marginTop: 'var(--s-5)' }}>{group}</h3>
            {colourTokens.filter((t) => t.group === group).map((token) => {
              const { value, overridden } = inForce(token, tokenOverrides, tokensResult.served);
              return (
                <TokenRow
                  key={token.name}
                  token={token}
                  override={overridden ? tokenOverrides.get(token.name) : undefined}
                  value={value}
                  contrast={pairsFor(token.name)}
                />
              );
            })}
          </div>
        ))}
      </Card>

      <Card title="Contrast — measured, not asserted">
        <p className="small muted">
          Every pair of colours the design actually puts on top of one another, with the ratio the standard asks
          for. <b>4.5:1</b> is WCAG 2.2 AA for text; <b>3:1</b> is the floor for a focus ring and for text that
          is deliberately faint. {failedPairs.length === 0
            ? 'Every pair passes as the palette stands.'
            : `${failedPairs.length} pair${failedPairs.length === 1 ? '' : 's'} FAIL as the palette stands — the rows below say which, and the token rows above carry the same warning.`}
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
          not checked — the pairs are the ones the design’s own stylesheets create, and the design is what says
          which colours sit on which.
        </p>
      </Card>

      <Card title={`Type, spacing and shape — ${typeTokens.length} tokens`}>
        <p className="small muted">
          The same mechanism as the colours: a type scale, the leading, the 4px spacing rhythm, the corner radii
          and the reading measure. Editing <code>--font-serif</code> or <code>--lh-body</code> is a real decision
          about the language rather than about the look — the design sets the leading generously so tone marks do
          not touch the line above, and a font without the dotted vowels breaks the orthography it is carrying.
        </p>
        {typeGroups.map((group) => (
          <div key={group}>
            <h3 style={{ marginTop: 'var(--s-5)' }}>{group}</h3>
            {typeTokens.filter((t) => t.group === group).map((token) => {
              const { value, overridden } = inForce(token, tokenOverrides, tokensResult.served);
              return (
                <TokenRow
                  key={token.name}
                  token={token}
                  override={overridden ? tokenOverrides.get(token.name) : undefined}
                  value={value}
                  contrast={pairsFor(token.name)}
                />
              );
            })}
          </div>
        ))}
      </Card>

      <Card title="One screen at a time">
        <p className="small muted">
          Every screen is a design file, and several share one file: <code>/about.html</code>,{' '}
          <code>/about/</code> and <code>/about</code> are the same document at three addresses, so an edit made
          here reaches About however a reader arrives at it. <b>An edit belongs to the file, not to the
          address.</b> The list below is of the <b>served</b> page — after the fills have run — which is why a
          heading the archive writes at serve time is offered and a button a fill has deleted is not.
        </p>
        <nav aria-label="Design screens">
          <p className="small" style={{ lineHeight: 2 }}>
            {screens.map((s, index) => (
              <span key={s}>
                {index > 0 ? ' · ' : null}
                <a href={`/admin/design/?screen=${s}`} aria-current={s === screen ? 'page' : undefined}>
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
                ['Places offered', `${items.length} of ${inventory.total}`],
                ['Edits on this screen', `${screenOverrides.length}`],
                ['Sections with a heading', `${items.filter((i) => /^h[1-4]$/.test(i.tag)).length}`],
                ['Photographs', `${items.filter((i) => i.can.image).length}`],
                ['Links', `${items.filter((i) => i.can.link).length}`],
              ]}
            />
            {inventory.total > items.length ? (
              <p className="small muted">
                The list stops at {items.length} places. The rest are still editable through the same route; this
                is a limit on one page of the editor, not on what may be changed.
              </p>
            ) : null}
            {items.map((item) => (
              <ElementRow
                key={item.key}
                item={item}
                screen={screen}
                override={(kind) => overrideFor(kind, item.key)}
              />
            ))}
          </>
        )}
      </Card>

      <Card title="Undo — one thing, this screen, or everything">
        <p className="small muted">
          Removing an edit returns the page to the design’s own value. It is safe to do either of these at any
          time: nothing is deleted from the design, and every removal is written to the audit trail with your
          name on it.
        </p>
        <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap' }}>
          <form method="post" action="/api/admin/design">
            <input type="hidden" name="action" value="reset-screen" />
            <input type="hidden" name="screen" value={screen} />
            <input type="hidden" name="returnTo" value={`/admin/design/?screen=${screen}`} />
            <button className="btn" type="submit" disabled={screenOverrides.length === 0}>
              Put /{screen}/ back to the design ({screenOverrides.length})
            </button>
          </form>
          <form method="post" action="/api/admin/design">
            <input type="hidden" name="action" value="reset-all" />
            <input type="hidden" name="returnTo" value={`/admin/design/?screen=${screen}`} />
            <button className="btn btn-quiet" type="submit" disabled={overrides.length === 0}>
              Put every screen back to the design ({overrides.length})
            </button>
          </form>
        </div>
        <h3 style={{ marginTop: 'var(--s-5)' }}>Every edit in force</h3>
        {overrides.length === 0 ? (
          <p className="small muted">None. Every screen is exactly as the design made it.</p>
        ) : (
          <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr><th align="left">Screen</th><th align="left">Kind</th><th align="left">What</th><th align="left">Value</th><th align="left">By</th><th align="left">When</th><th /></tr>
            </thead>
            <tbody>
              {overrides.map((override) => (
                <tr key={override.id}>
                  <td className="small">{override.screen === ALL_SCREENS ? 'every screen' : `/${override.screen}/`}</td>
                  <td className="small">{override.kind}</td>
                  <td className="small">{override.label ?? override.key}</td>
                  <td className="small"><code style={{ wordBreak: 'break-all' }}>{override.value.value ?? override.value.text ?? override.value.src ?? override.value.href ?? (override.value.hidden ? 'hidden' : '')}</code></td>
                  <td className="small">{override.actorName ?? '—'}</td>
                  <td className="small">{new Date(override.updatedAt ?? '').toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td>
                    <form method="post" action="/api/admin/design">
                      <input type="hidden" name="action" value="remove" />
                      <input type="hidden" name="id" value={String(override.id)} />
                      <input type="hidden" name="returnTo" value={`/admin/design/?screen=${screen}`} />
                      <button className="btn btn-quiet" type="submit">Undo</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
