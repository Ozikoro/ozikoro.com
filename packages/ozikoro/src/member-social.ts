/**
 * The social networks an account may publish a handle for, and the ONE rule that makes the handle safe to
 * render.
 *
 * ── THE PROBLEM THIS MODULE EXISTS TO SOLVE ──────────────────────────────────────────────────────────
 *
 * The owner asked for *"social media networks username"* on a profile. **A username that only writes a
 * string is half a feature** — nothing renders it — and a username rendered as a link is a security
 * surface, because the value comes from a reader. The naive implementation stores whatever was typed and
 * puts it in an `href`. That is a stored-XSS and open-redirect surface in one field:
 *
 *     javascript:alert(1)                       -> script execution in the archive's own origin
 *     https://evil.example.invalid/phish        -> the archive's page linking to somebody else's site
 *     " onmouseover="…                           -> an attribute break in the rendered markup
 *
 * ── THE RULE: THE VALUE IS A HANDLE, AND THE ADDRESS IS BUILT. NEVER STORED. ──────────────────────────
 *
 * **The user never supplies a URL.** They supply a bare handle, this module refuses anything that is not a
 * bare handle, and the address is assembled at render time from a **constant host written here in the
 * source**. So:
 *
 *   * `SOCIAL_NETWORKS[].href` is the only thing that decides a destination. There is no code path in which
 *     a stored value becomes the beginning of an `href`.
 *   * `socialHref()` returns `null` for anything it does not recognise — an unknown network, an empty
 *     handle, a handle with a character that means something to a URL parser. A `null` href is rendered as
 *     TEXT with no `<a>` around it, which is the failing-safe behaviour: **the handle is still shown, it
 *     is simply not a link.**
 *   * `javascript:`, `https://…`, a quote and a space are all refused by `SOCIAL_USERNAME_PATTERN` before
 *     they can be stored — and refused again by the table's own check constraint in migration 0067, so a
 *     row that could escape the host cannot exist even if some future writer to that table never reads
 *     this file.
 *
 * ⚠️ **MASTODON IS DELIBERATELY ABSENT, AND ITS ABSENCE IS THE POINT.** A Mastodon address is
 * `@user@instance` and its profile lives at `https://<instance>/@user` — **the reader supplies the host**.
 * Supporting it means the `href` is no longer assembled from a constant, which is the whole property
 * above. A version of this feature that validated the instance against a list would be a second, weaker
 * mechanism doing the same job; the honest answer is to leave the network out and say so, which the
 * `/account/` page does where a reader would look for it.
 *
 * ── WHY `@` IS STRIPPED RATHER THAN REFUSED ──────────────────────────────────────────────────────────
 *
 * Because `@ozikoro` is what a person types when asked for a username, and refusing it would make the form
 * refuse the most natural correct answer. **A leading `@` is removed before validation and is never
 * stored** — each network's own template supplies whatever punctuation its addresses actually have
 * (`instagram.com/<handle>`, `youtube.com/@<handle>`), so storing one would produce `@@handle` on two of
 * the six.
 */
import type { Db } from '@ozituma/db/client';

/**
 * The six networks this archive addresses, and nothing else.
 *
 * NAMED RATHER THAN FREE TEXT, and held in one place because three things must agree about the set: the
 * form that draws the fields, the table's `network` check constraint (migration 0067), and the renderer
 * that builds the address. **A network added to the application but not to the constraint is a handle that
 * cannot be saved**, which is the failure this array exists to make impossible to reach by accident.
 *
 * `prefix` is drawn beside the input so a reader can see what their handle is becoming, and `href` is the
 * only place a host is written.
 */
export interface SocialNetwork {
  /** The value stored in `ozikoro_member_social.network`, and the `check` in migration 0067. */
  key: 'x' | 'instagram' | 'facebook' | 'linkedin' | 'youtube' | 'tiktok';
  /** What the form and the profile call it. */
  label: string;
  /** The address text shown before the input, so the field says what it is appending to. */
  prefix: string;
  /** The name of the form field on `/account/`. */
  field: string;
  /** The only place a destination is decided. Takes an ALREADY VALIDATED handle. */
  href: (handle: string) => string;
}

export const SOCIAL_NETWORKS: readonly SocialNetwork[] = [
  {
    key: 'x',
    label: 'X',
    prefix: 'x.com/',
    field: 'social_x',
    href: (h) => `https://x.com/${h}`,
  },
  {
    key: 'instagram',
    label: 'Instagram',
    prefix: 'instagram.com/',
    field: 'social_instagram',
    href: (h) => `https://www.instagram.com/${h}`,
  },
  {
    key: 'facebook',
    label: 'Facebook',
    prefix: 'facebook.com/',
    field: 'social_facebook',
    href: (h) => `https://www.facebook.com/${h}`,
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    prefix: 'linkedin.com/in/',
    field: 'social_linkedin',
    href: (h) => `https://www.linkedin.com/in/${h}`,
  },
  {
    key: 'youtube',
    label: 'YouTube',
    prefix: 'youtube.com/@',
    field: 'social_youtube',
    href: (h) => `https://www.youtube.com/@${h}`,
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    prefix: 'tiktok.com/@',
    field: 'social_tiktok',
    href: (h) => `https://www.tiktok.com/@${h}`,
  },
] as const;

/**
 * A bare handle: letters, digits, dot, underscore, hyphen; first and last character alphanumeric; at most 64.
 *
 * ── WHY EACH PART OF THAT IS THERE, AND WHY IT IS NOT A "SANITISER" ──────────────────────────────────
 *
 * It is an **allow-list**, not a list of things to strip. A blocklist of "dangerous" characters is a list
 * that is wrong the first time a new URL syntax appears; a class that admits six characters cannot be wrong
 * about a seventh. The characters admitted are the ones real handles use.
 *
 *   * **No `:`** — this is the one that matters most. `javascript:alert(1)` is refused by the `:` alone, and
 *     so is `https://evil.example.invalid`, which is what makes "the reader cannot supply a destination"
 *     true even if this value ever reached an `href` by some future code path.
 *   * **No `/`, `?`, `#`, `\`** — each ends or alters a URL rather than belonging to one. `/` is also what
 *     turns a path segment into a different path.
 *   * **No `@`** — an `@` inside a path is how a second host is smuggled into an address, and the leading
 *     one a person types has already been stripped by `normaliseSocialUsername` before this test runs.
 *   * **No space, quote, `<` or `>`** — a value rendered inside an attribute cannot end that attribute, and
 *     `escapeHtml` in the page is the second half of that; this is the first.
 *   * **First and last character alphanumeric** — which refuses `..`, `.hidden`, `-x` and `x-`. `..` is a
 *     traversal-shaped path segment and there is no reason for a handle to be one.
 *
 * The identical expression is the `check` on `ozikoro_member_social.username` in migration 0067. **Two
 * copies of one rule is normally a drift risk; this one is deliberate** — the TypeScript copy is what gives
 * a reader a sentence explaining the refusal, and the SQL copy is what makes the renderer's promise true of
 * every row that can exist rather than only of the rows this application writes.
 */
export const SOCIAL_USERNAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/;

/** One stored handle, as a page reads it. */
export interface SocialHandle {
  network: SocialNetwork['key'];
  label: string;
  username: string;
}

/** The shape `SOCIAL_NETWORKS` is looked up by, without trusting that the key came from this file. */
export function socialNetwork(key: string): SocialNetwork | undefined {
  return SOCIAL_NETWORKS.find((n) => n.key === key);
}

/**
 * What was typed, turned into what may be stored — or `null` for "nothing to store".
 *
 * Empty input is `null` rather than an error: clearing a handle is a legitimate act — it is how a person
 * removes one — and the caller deletes the row rather than complaining.
 *
 * A leading `@` is removed (see the header). Everything else is returned unchanged so the caller can hand it
 * to `SOCIAL_USERNAME_PATTERN`, and so a refusal can quote back **the value that was actually rejected**
 * rather than a silently rewritten version of it. **A field that quietly "fixes" what you typed and saves
 * something else is the defect this archive keeps finding**, so nothing here strips a character to make an
 * invalid handle valid.
 */
export function normaliseSocialUsername(raw: string): string | null {
  const trimmed = raw.trim().replace(/^@+/, '');
  return trimmed.length === 0 ? null : trimmed;
}

/** Whether a normalised handle is one this archive will store and address. */
export function isValidSocialUsername(handle: string): boolean {
  return SOCIAL_USERNAME_PATTERN.test(handle);
}

/**
 * The address for a stored handle — **or `null`, which the renderer draws as plain text.**
 *
 * ⚠️ **THIS FUNCTION IS THE ENTIRE SECURITY BOUNDARY AND IT IS DELIBERATELY NARROW.** It returns a string
 * only when it can build it from `SOCIAL_NETWORKS`'s own constant host plus a handle that passed
 * `SOCIAL_USERNAME_PATTERN`. Every other input — an unknown network, an empty handle, `javascript:alert(1)`,
 * a pasted URL, a value with a quote in it, a handle that somehow reached the database before the
 * constraint existed — returns `null`. **There is no branch in which a stored value becomes the beginning of
 * an address.**
 *
 * It re-validates rather than trusting its caller, because the caller is a page reading a row, and the row
 * may predate the constraint. **A renderer that trusted the database would be a renderer whose safety
 * depended on a migration having been applied**, and this archive has been bitten by exactly that shape of
 * assumption more than once.
 */
export function socialHref(network: string, username: string): string | null {
  const spec = socialNetwork(network);
  if (!spec) return null;
  const handle = normaliseSocialUsername(username);
  if (handle === null || !isValidSocialUsername(handle)) return null;
  return spec.href(handle);
}

/**
 * Why a handle was refused, in words a reader can act on — or `null` when it is acceptable.
 *
 * A refusal that only says "invalid" teaches nobody anything, and the owner's standing complaint is controls
 * that do not explain themselves.
 */
export function socialUsernameProblem(raw: string): string | null {
  const handle = normaliseSocialUsername(raw);
  if (handle === null) return null;
  if (isValidSocialUsername(handle)) return null;
  if (handle.length > 64) return 'A username is at most 64 characters.';
  if (/[:/?#\\@]/.test(handle)) {
    return 'Enter the username only — not a whole address and not a link. For example “ozikoro”.';
  }
  return (
    'A username may use letters, digits, dots, underscores and hyphens, and must begin and end with a ' +
    'letter or a digit. For example “ozikoro” or “ozi.koro_1”.'
  );
}

/**
 * The first problem with a whole submitted set of handles, or `null` when the set is acceptable.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM THE WRITE, AND WHY IT MATTERS MORE THAN IT LOOKS ──────────────────
 *
 * ⚠️ **A REFUSAL MUST HAPPEN BEFORE ANYTHING IS WRITTEN, OR THE SAVE IS HALF-APPLIED.** The first version of
 * the profile route validated the handles inside `saveOwnSocialLinks`, which the route called *after*
 * `saveOwnProfile` — and `saveOwnProfile` had already committed the biography and the visibility by the time
 * the bad handle was noticed. So a form with one unusable username came back with an error **and a saved
 * biography**, and the person had no way to tell from the screen which half of their form had gone in. It was
 * found by submitting a hostile value and reading the page back, not by reading the code — the error message
 * looked like a refusal.
 *
 * This function is pure and touches no database, so the route can call it as the FIRST thing it does and
 * refuse the entire submission before the first write. `saveOwnSocialLinks` still validates on its own as
 * well: this call site is the one that makes the save atomic, and that check is the one that keeps the rule
 * true for any future caller that forgets to ask.
 *
 * The network's own label is put in front of the message, because a form with six username boxes and one
 * refusal has to say WHICH box — "a username is invalid" on a six-field form is not an answer.
 */
export function socialHandlesProblem(handles: Record<string, string>): string | null {
  for (const spec of SOCIAL_NETWORKS) {
    const problem = socialUsernameProblem(handles[spec.field] ?? '');
    if (problem) return `${spec.label}: ${problem}`;
  }
  return null;
}

/**
 * Every handle this account has stored, in the order the networks are declared.
 *
 * Read with a join against the network list rather than returned in table order, so a profile page draws the
 * same sequence for everybody and adding a network to `SOCIAL_NETWORKS` places it rather than appending it
 * wherever its row happens to sort.
 *
 * ⚠️ **THE TABLE IS READ AND THE READ IS TOLERANT OF IT NOT EXISTING YET.** `ozikoro_member_social` arrives
 * with migration 0067, and a server started against a database that has not run it must not turn every
 * profile page into a 500. This is the archive's own rule, written in the discussion code: *"a box that will
 * not draw is a missing box, not a 404 on 1,051 published histories."*
 */
export async function listMemberSocial(db: Db, accountId: number): Promise<SocialHandle[]> {
  let rows: Array<Record<string, unknown>>;
  try {
    rows = await db.rows<Record<string, unknown>>(
      `select network, username from ozikoro_member_social where account_id = $1`,
      [accountId]
    );
  } catch (error) {
    /*
     * A MISSING TABLE IS AN EMPTY LIST, NOT A BROKEN PAGE. The social block is an addition to a profile; the
     * profile itself is the biography, the portrait and the publication list, and none of those should be
     * lost because one optional table has not been created yet. The failure is logged at warn rather than
     * swallowed silently, because a table that is missing when it should be present is a deploy fault an
     * operator needs to see — and a page that 500s is not a better way of telling them.
     */
    console.warn(
      `[ozikoro/member-social] could not read handles for account ${accountId}: ${String(error).slice(0, 200)}`
    );
    return [];
  }

  const byNetwork = new Map(rows.map((r) => [String(r.network), String(r.username)]));
  return SOCIAL_NETWORKS.flatMap((spec) => {
    const username = byNetwork.get(spec.key);
    return username === undefined ? [] : [{ network: spec.key, label: spec.label, username }];
  });
}
