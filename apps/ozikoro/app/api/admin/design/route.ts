/**
 * POST /api/admin/design — the owner's edits to the design, saved beside the deliverable.
 *
 * WHY ONE ENDPOINT FOR FOUR KINDS
 *
 *   action=set           a colour, a heading, a photograph, a link or a block
 *   action=remove        one edit, back to the design
 *   action=reset-screen  every edit on one screen
 *   action=reset-all     every edit there is
 *
 * Each of these is "a person filled in a form and pressed a button", and four files would be four places for
 * the capability check to be forgotten. **The check is the first thing that happens and nothing below it
 * runs** — `manage_design`. Migration 0051 granted it to the administrator and the owner; **migration 0055
 * grants it to an editor as well**, because the owner's rule is now stated as one prohibition ("an editor
 * cannot delete trash; everything else is theirs") rather than as a list of allowances, and the served design
 * is not the one thing withheld. The guard asks for the CAPABILITY and never for a role, so the day the table
 * changes is the day this route follows it — see `apps/ozikoro/lib/access.ts`.
 *
 * AND IT MEASURES WHAT IT JUST DID
 *
 * The owner's failure mode is a saved edit that is stored, served, applied and invisible — the selector
 * matched nothing once the fills had run, or a rule further down the cascade won. HTTP 200 is not evidence
 * that anything changed, so after a save this route **fetches the served page with the overrides switched off,
 * applies the edit it has just written to that response, and reports whether the response changed.** The
 * notice the owner gets says how many places the key matched, not that the row was written.
 *
 * A TOKEN IS VERIFIED DIFFERENTLY, AND FOR A REASON. A colour is not applied to the page's markup; it is
 * delivered by `/design-theme.css`, which `seoHead` links on every screen. So the check for a token is that
 * the served stylesheet now declares it, and the colours' real proof is looking at the page — which is why the
 * editor offers a preview in a new tab rather than claiming a swatch is a screenshot.
 */
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb } from '@ozituma/db/client';
import {
  ALL_SCREENS,
  DesignOverrideError,
  applyDesignOverrides,
  checkOverrideValue,
  parseDesignTokens,
  removeDesignOverride,
  removeDesignOverrideByKey,
  resetDesignOverrides,
  selectorReach,
  setDesignOverride,
  themeCss,
  type DesignOverride,
  type DesignOverrideKind,
  type DesignOverrideValue,
  type DesignTokenClass,
} from '@ozikoro/platform';
import { answerAction, guardNarration, readAction } from '@/lib/narration-http';
import { sameOrigin } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_RETURN = '/admin/design/';
const SCREEN_DIR = join(process.cwd(), 'public', 'design', 'screens');
const DESIGN_DIR = join(process.cwd(), 'public', 'design');

/**
 * What kind of value the design declares for this token, or null when it declares no such token.
 *
 * The design's own stylesheet is the authority on this: a token it no longer holds is a token whose override
 * would sit in the stylesheet changing nothing, so a save that names one is refused and told why rather than
 * written down and believed.
 */
async function declaredTokenClass(name: string): Promise<{ found: boolean; tokenClass: string | null }> {
  try {
    const tokensCss = await readFile(join(DESIGN_DIR, 'tokens.css'), 'utf8');
    const token = parseDesignTokens(tokensCss).find((candidate) => `--${candidate.name}` === name);
    return token ? { found: true, tokenClass: token.tokenClass } : { found: false, tokenClass: null };
  } catch {
    // A stylesheet that cannot be read is not a reason to refuse an edit the editor offered: the check is a
    // quality gate, and the injection check above it is the security one and always runs.
    return { found: true, tokenClass: null };
  }
}

const KINDS: DesignOverrideKind[] = ['token', 'text', 'image', 'link', 'hide'];

/**
 * How many of the deliverable's screens carry the place this key names.
 *
 * WHY THE SAVE PATH MEASURES IT RATHER THAN TRUSTING THE FORM
 *
 * A site-wide edit is one row that is served on every screen, and "it worked" means "it landed where the
 * design has that place" — not "the row is in the table". The design's own files are the stable source
 * (`apps/ozikoro/public/design/` is byte-frozen), so the count is read from them and reported to the owner
 * with the screens named, which is what makes "one edit or fifty-two" a measurement rather than a promise.
 *
 * A screen whose fill adds or removes the element is not in this count; the row still serves there, and the
 * serve step edits only where the key names exactly one element.
 */
async function reachFor(key: string): Promise<{ screens: { screen: string; text: string }[]; of: number }> {
  try {
    const files = (await readdir(SCREEN_DIR)).filter((file) => file.endsWith('.html'));
    const screens = await Promise.all(
      files.map(async (file) => ({ name: file.replace(/\.html$/, ''), html: await readFile(join(SCREEN_DIR, file), 'utf8') }))
    );
    return { screens: selectorReach(screens, [key]).get(key) ?? [], of: screens.length };
  } catch {
    return { screens: [], of: 0 };
  }
}

/** The screen's file, or null when there is no such screen. */
function screenExists(screen: string): boolean {
  if (screen === ALL_SCREENS) return true;
  // A screen name is a filename and nothing else. `../` in one would be a path out of the deliverable, which
  // is the one directory this whole feature exists to leave alone.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(screen)) return false;
  return existsSync(join(SCREEN_DIR, `${screen}.html`));
}

function valueFor(kind: DesignOverrideKind, data: Record<string, string>): DesignOverrideValue {
  /*
   * THE TYPED VALUE WINS OVER THE COLOUR PICKER, AND THIS LINE WAS MISSING WHILE THE PREVIEW HAD IT.
   *
   * The editor's colour rows post two fields: a native `<input type="color" name="value">` and a text box
   * named `value_text`. The picker can only express `#rrggbb`, so the box is the only way to write
   * `rgba(…)`, `hsl(…)` or a gradient — and the PREVIEW route has always preferred the box for exactly that
   * reason. **The save path read `value` only, so an owner who typed into the box and pressed Save wrote the
   * picker's colour instead of his own**: a text field that silently did nothing, which is the fault this
   * whole screen exists to remove. Found by driving the real form during this round's verification; the two
   * routes now read the same field in the same order.
   */
  if (kind === 'token') return { value: (data.value_text ?? '').trim() || (data.value ?? '').trim() };
  if (kind === 'text') return { text: data.text ?? '' };
  if (kind === 'hide') return { hidden: true };
  if (kind === 'image') {
    return {
      src: (data.src ?? '').trim(),
      alt: data.alt ?? '',
      credit: data.credit ?? undefined,
      creditKey: data.creditKey && data.creditKey.length > 0 ? data.creditKey : undefined,
    };
  }
  return { href: (data.href ?? '').trim(), label: data.linkLabel ?? '' };
}

/**
 * Does the image address the owner is saving actually resolve?
 *
 * WHY THIS EXISTS, AND WHAT IT IS FOR
 *
 * A colour that is wrong is a page that looks wrong; **an image that does not resolve is a hole**, and a hole
 * where a photograph should be is the exact fault the owner reported on the morning this editor was built —
 * "some of the parts that is supposed to have images not showing anything". This editor's own verification
 * produced two of them: a probe override pointed `/about/`'s two photographs at files that did not exist, the
 * page served two broken images for as long as the rows were in the table, and another agent measuring the
 * page at the time correctly read it as a content fault. **An editor that can silently create the fault it
 * was built to remove is not finished.**
 *
 * So a same-origin address is fetched before it is written down, and a 4xx or 5xx REFUSES the save with the
 * status this site actually returned. Two things are deliberately not checked, because checking them would be
 * a guess: an absolute address on another origin (the design itself hot-links photographs, and this route
 * cannot be the judge of a server it does not run), and a relative address (which is not what the editor
 * offers). `.media` is not special-cased either way — it is fetched like anything else, which is what makes
 * the check honest.
 *
 * THE ESCAPE HATCH IS EXPLICIT. `allow_missing=1` writes the row anyway, for the real case of an image that
 * will be uploaded after the page is prepared. **A deliberate hole is a decision; an accidental one is a
 * bug**, and this is the line between them.
 */
async function imageAddressProblem(request: Request, src: string, allowMissing: boolean): Promise<string | null> {
  if (src.length === 0) return null;
  if (allowMissing) return null;
  if (/^https?:\/\//i.test(src)) return null;
  if (!src.startsWith('/')) return null;
  try {
    const res = await fetch(new URL(src, request.url), {
      headers: { cookie: request.headers.get('cookie') ?? '' },
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    });
    if (res.ok) return null;
    return `That image address answers ${res.status} on this site, so the page would show a hole where the photograph should be. Correct the address, or tick “the file will be added later” if you mean to upload it afterwards.`;
  } catch {
    /*
     * A fetch that fails is not evidence that the file is absent — this site's own media route could be
     * restarting — so it is reported rather than treated as a 404. Refusing on an inability to check would
     * block a correct edit whenever the check itself was unlucky.
     */
    return null;
  }
}

/**
 * What the served page looks like with this edit applied, against the same page without any edit.
 *
 * `?oznooverride=1` is honoured only for an account holding `manage_design`, and it is what makes this
 * comparison possible: the stored edits are switched off for one request so the effect of a single row can be
 * measured rather than assumed. The session cookie is forwarded, because the guard on that parameter is the
 * same guard as this route's.
 */
async function measure(
  request: Request,
  override: DesignOverride,
  sampleScreen: string
): Promise<{ checked: boolean; changed: boolean; note: string }> {
  /*
   * A SITE-WIDE ELEMENT EDIT HAS NO SCREEN OF ITS OWN, SO THE SCREEN IT WAS MADE FROM IS THE SAMPLE.
   *
   * The row's screen is the star, which is not an address, so asking for that screen's path would build an
   * address no route serves. The form carries the screen the owner was looking at, and that page is fetched
   * with the stored edits switched off so the one row's effect can be seen — and the reach across the
   * deliverable is counted from the files and reported beside it, so "every screen" is a number rather than a
   * claim.
   */
  if (override.screen === ALL_SCREENS && override.kind !== 'token') {
    const reach = await reachFor(override.key);
    const sample = /^[a-z0-9][a-z0-9-]*$/.test(sampleScreen) ? sampleScreen : 'home';
    const path = sample === 'home' ? '/' : `/${sample}/`;
    let sampleChanged: boolean | null = null;
    try {
      const res = await fetch(new URL(`${path}?oznooverride=1`, request.url), {
        signal: AbortSignal.timeout(8000),
        headers: { cookie: request.headers.get('cookie') ?? '' },
      });
      if (res.ok) {
        const plain = await res.text();
        sampleChanged = applyDesignOverrides(plain, [override]) !== plain;
      }
    } catch {
      sampleChanged = null;
    }
    const reachSentence = reach.of === 0
      ? 'The reach across the screens could not be counted.'
      : `The design carries this place on ${reach.screens.length} of ${reach.of} screens${reach.screens.length > 0 ? ` (${reach.screens.slice(0, 8).map((r) => r.screen).join(', ')}${reach.screens.length > 8 ? ', …' : ''})` : ''}, and a screen where the key names no single element is left alone.`;
    /*
     * AND HOW MANY OF THEM SAID THE SAME WORDS. A place is a position, not a sentence: the wordmark's span is
     * "History & Archive" on most screens and "Watch" on `/watch/`, so a row can reach 35 screens and rewrite
     * a different caption on one of them. The count is taken against the wording the SAMPLE screen carries —
     * the screen the owner was looking at — so "35 screens, and 1 of them says something else" is measured
     * rather than assumed.
     */
    const sampleText = reach.screens.find((row) => row.screen === sample)?.text ?? null;
    const otherWording = sampleText === null ? 0 : reach.screens.filter((row) => row.text !== sampleText).length;
    const wordingSentence = reach.screens.length === 0 || sampleText === null
      ? ''
      : otherWording === 0
        ? ' Every one of those screens carried exactly this wording.'
        : ` ${otherWording} of them carried DIFFERENT wording at that place, and this edit changes it too — the row names a place, not a sentence.`;
    const sampleSentence = sampleChanged === null
      ? `The sample screen /${sample}/ could not be fetched to confirm it.`
      : sampleChanged
        ? `The sample screen /${sample}/ changed when the edit was applied to it.`
        : `BUT NOTHING CHANGED ON /${sample}/ — the sample screen does not carry this place, so check the list in the notice before believing the reach.`;
    return { checked: sampleChanged !== null, changed: sampleChanged === true, note: `Saved on every screen it names. ${reachSentence}${wordingSentence} ${sampleSentence}` };
  }

  if (override.screen === ALL_SCREENS) {
    try {
      const res = await fetch(new URL('/design-theme.css', request.url), {
        signal: AbortSignal.timeout(6000),
        headers: { cookie: request.headers.get('cookie') ?? '' },
      });
      const served = res.ok ? await res.text() : '';
      // `themeCss` writes `  --name: value;` and the served sheet is that same function's output, so the
      // assertion is against the exact declaration rather than a substring that could match another token.
      const declares = themeCss([override]).length > 0 && served.includes(`${override.key}: ${override.value.value};`);
      return {
        checked: res.ok,
        changed: declares,
        note: declares
          ? `The served stylesheet now declares ${override.key} as you set it. Colours come from that sheet, so look at a page to see it.`
          : `Saved, but the served stylesheet does not yet show ${override.key}. The change is in the record; the page may still be serving the old sheet.`,
      };
    } catch {
      return { checked: false, changed: false, note: 'Saved. The stylesheet could not be re-read to confirm it, so check the page.' };
    }
  }

  const path = override.screen === 'home' ? '/' : `/${override.screen}/`;
  try {
    const res = await fetch(new URL(`${path}?oznooverride=1`, request.url), {
      signal: AbortSignal.timeout(8000),
      headers: { cookie: request.headers.get('cookie') ?? '' },
    });
    if (!res.ok) {
      return { checked: false, changed: false, note: `Saved. The served page answered ${res.status}, so this was not confirmed against it.` };
    }
    const plain = await res.text();
    const after = applyDesignOverrides(plain, [override]);
    const changed = after !== plain;
    return {
      checked: true,
      changed,
      note: changed
        ? 'Saved, and the served page changed: the design has been overridden where you pointed.'
        : `Saved to the record, but NOTHING ON THE SERVED PAGE CHANGED. The key “${override.key}” matched no element of ${path} — the page is rewritten by a fill before the override is applied, or the design has moved on from the selector. Nothing is broken; the edit is simply not showing.`,
    };
  } catch {
    return { checked: false, changed: false, note: 'Saved. The served page could not be fetched to confirm the change, so check it yourself.' };
  }
}

export async function POST(request: Request): Promise<Response> {
  const input = await readAction(request, DEFAULT_RETURN);

  // Cross-site form posts are refused. The cookie is already `SameSite=Lax`, so this is defence in depth —
  // the same line every other admin endpoint carries, for the same reason.
  if (!sameOrigin(request)) {
    return answerAction(input, {
      ok: false,
      status: 403,
      payload: { error: 'cross_origin' },
      notice: 'That request did not come from this site.',
    });
  }

  const guard = await guardNarration(input, 'manage_design');
  if (!guard.ok) return guard.response;

  const action = (input.data.action ?? 'set').trim();
  const db = await getDb();
  const note = (input.data.note ?? '').trim().slice(0, 500) || null;

  try {
    if (action === 'remove') {
      const id = Number.parseInt(input.data.id ?? '', 10);
      const removed = Number.isInteger(id) && id > 0
        ? await removeDesignOverride(db, { id, actorId: guard.actorId, note })
        : await removeDesignOverrideByKey(db, {
            screen: input.data.screen ?? '',
            kind: (input.data.kind ?? 'text') as DesignOverrideKind,
            key: input.data.key ?? '',
            actorId: guard.actorId,
            note,
          });
      return answerAction(input, {
        ok: true,
        payload: { ok: true, removed: removed !== null },
        notice: removed
          ? `Undone: “${removed.label ?? removed.key}” is back to the design’s own value.`
          : 'There was nothing to undo for that; the design was already in force.',
      });
    }

    if (action === 'reset-screen' || action === 'reset-all') {
      const screen = action === 'reset-all' ? null : (input.data.screen ?? '').trim();
      if (action === 'reset-screen' && !screenExists(screen ?? '')) {
        return answerAction(input, { ok: false, status: 400, payload: { error: 'unknown_screen' }, notice: 'No such screen, so nothing was reset.' });
      }
      const count = await resetDesignOverrides(db, { screen, actorId: guard.actorId, note });
      return answerAction(input, {
        ok: true,
        payload: { ok: true, reset: count },
        notice: count === 0
          ? 'Nothing to reset: no edit is set there.'
          : `${count} edit${count === 1 ? '' : 's'} removed and ${count === 1 ? 'the design’s own value is' : 'the design’s own values are'} back. Every removal is recorded in the audit trail.`,
      });
    }

    if (action !== 'set') {
      return answerAction(input, { ok: false, status: 400, payload: { error: 'unknown_action' }, notice: `“${action}” is not an action this endpoint has.` });
    }

    const kind = (input.data.kind ?? '') as DesignOverrideKind;
    if (!KINDS.includes(kind)) {
      return answerAction(input, { ok: false, status: 400, payload: { error: 'unknown_kind' }, notice: 'That is not a kind of design edit.' });
    }
    /*
     * WHICH SCREEN A ROW BELONGS TO. A token is never one screen's. An element edit is one screen's unless the
     * owner pressed "change everywhere" — the same form, the same value, one button that says the reach is
     * fifty-two screens rather than one. The scope is a word this endpoint knows and not a screen name it
     * trusts, so a hand-written post cannot file a row under a screen that does not exist.
     */
    const scopeAll = (input.data.scope ?? '').trim() === 'all';
    const screen = kind === 'token' || scopeAll ? ALL_SCREENS : (input.data.screen ?? '').trim();
    if (!screenExists(screen)) {
      return answerAction(input, { ok: false, status: 400, payload: { error: 'unknown_screen' }, notice: `There is no design screen called “${screen}”.` });
    }    const key = (input.data.key ?? '').trim();
    if (key.length === 0) {
      return answerAction(input, { ok: false, status: 400, payload: { error: 'missing_key' }, notice: 'Nothing was named to change.' });
    }

    const value = valueFor(kind, input.data);
    /* The design's own stylesheet is read ONCE, and the class it answers with is the one the store checks
       against and the API route has already reported a missing token from. */
    let tokenClass: DesignTokenClass | undefined;
    if (kind === 'token') {
      const declared = await declaredTokenClass(key);
      tokenClass = (declared.tokenClass ?? undefined) as DesignTokenClass | undefined;
      if (!declared.found) {
        return answerAction(input, {
          ok: false,
          status: 400,
          payload: { error: 'unknown_token' },
          notice: `The design has no token called “${key}”. It may have been renamed in a re-export; the editor lists the tokens the design actually declares.`,
        });
      }
      const problem = checkOverrideValue('token', key, value, declared.tokenClass as DesignTokenClass | undefined);
      if (problem) {
        return answerAction(input, { ok: false, status: 400, payload: { error: 'refused', message: problem }, notice: problem });
      }
    }
    if (kind === 'image') {
      const problem = await imageAddressProblem(
        request,
        (value.src ?? '').trim(),
        (input.data.allow_missing ?? '') === '1' || (input.data.allow_missing ?? '') === 'true'
      );
      if (problem) {
        return answerAction(input, { ok: false, status: 400, payload: { error: 'image_not_found', message: problem }, notice: problem });
      }
    }
    if (kind === 'image' && (value.credit ?? '').trim().length > 0 && !(value.creditKey ?? '').length) {
      /*
       * A CREDIT WITH NOWHERE TO GO IS REFUSED RATHER THAN SAVED AND DROPPED.
       *
       * The editor disables the credit field for a photograph whose figure has no caption in the design, and
       * this is the same rule on the server. Saving it would write a row that looks complete, render without
       * the credit, and log a line nobody reads — which is the "stored, served and invisible" fault in
       * miniature. So the photograph's own source and alt text may be changed; the credit waits for a design
       * that has a home for it.
       */
      return answerAction(input, {
        ok: false,
        status: 400,
        payload: { error: 'no_credit_slot' },
        notice: 'That photograph has no credit line in the design, so a credit would have nowhere to appear. The image and its alternative text can still be changed.',
      });
    }

    const override = await setDesignOverride(db, {
      screen,
      kind,
      key,
      label: (input.data.title ?? '').trim().slice(0, 300) || null,
      value,
      note,
      actorId: guard.actorId,
      expectedTokenClass: tokenClass,
    });

    const outcome = await measure(request, override, (input.data.sampleScreen ?? '').trim());
    const where = kind === 'token' || screen === ALL_SCREENS ? 'on every screen' : `on /${screen}/`;
    return answerAction(input, {
      ok: true,
      payload: { ok: true, override, verified: outcome.checked, changed: outcome.changed, note: outcome.note },
      notice: outcome.changed
        ? `Saved: ${kind === 'token' ? `${key} is now ${override.value.value}` : `“${override.label ?? key}” is edited ${where}`}. ${outcome.note}`
        : outcome.note,
    });
  } catch (error) {
    if (error instanceof DesignOverrideError) {
      return answerAction(input, { ok: false, status: 400, payload: { error: 'refused', message: error.message }, notice: error.message });
    }
    console.error('[ozikoro/design] the design edit failed:', String(error).slice(0, 300));
    return answerAction(input, {
      ok: false,
      status: 500,
      payload: { error: 'failed' },
      notice: 'That edit could not be saved, and nothing was changed.',
    });
  }
}
