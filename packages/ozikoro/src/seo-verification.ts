/**
 * The site-verification tokens: what each search engine asks for, and where the owner's own token is kept.
 *
 * ── WHAT THE OWNER ASKED FOR, IN HIS WORDS ──────────────────────────────────────────────────────────
 *
 *   "i gave you yoast seo premium to replicate it's functions. now i want to see the seo in my dashboard
 *    and it it function like the original yoast so i can see where to add google web master search engine
 *    code, yandex, bing and others"
 *
 * Yoast's "Site verification" tab (Webmaster tools) is one row per engine: a field to paste the code the
 * engine gave you, and a switch for whether it is on. **What it actually does is put a `<meta>` tag in the
 * `<head>` of every page**, which is what a crawler reads to decide that the person who holds the token also
 * holds this site. This module holds the part that decides what that tag is; `seo-head.ts` is the one place
 * every page's `<head>` is built, so that is where it is emitted.
 *
 * ── THE TOKEN, NOT THE TAG. AND THE TAG WHEN THAT IS WHAT HE HAS. ────────────────────────────────────
 *
 * Google gives `<meta name="google-site-verification" content="…">`; Bing gives
 * `<meta name="msvalidate.01" content="…">`; Yandex gives `<meta name="yandex-verification" content="…">`.
 * **The token is the value of `content`, and that is what is stored.** Storing the whole tag would mean the
 * archive echoing markup the owner pasted, which is how a `<script>` gets into a `<head>`; storing the value
 * means the emitted markup is this archive's own and is escaped here.
 *
 * **But an owner's clipboard holds the tag, not the token** — that is what the Search Console screen shows
 * him, and it is what "paste this in your `<head>`" means. So `readPastedToken` accepts either, extracts the
 * `content` value when one is present, and reports which engine a pasted tag names so the screen can say
 * "that was a Bing tag, and the token is this".
 *
 * ── AN EMPTY SETTING IS A REAL SETTING, AND IT EMITS NOTHING ─────────────────────────────────────────
 *
 * Before anything is pasted there are no rows in `site_setting`, and `verificationTags` returns an empty
 * list. **It never emits `<meta name="google-site-verification" content="">`.** A verification tag with an
 * empty content is worse than no tag: it is a claim of verification that cannot succeed, and Google reads it
 * as a failed attempt rather than as an absence. So the absence is tested for explicitly, twice — once here
 * (`token.length === 0` is skipped) and once in the screen (which says "nothing is emitted for this engine"
 * rather than drawing an empty tag).
 *
 * ── WHERE THE TOKENS LIVE, AND WHY NO NEW TABLE ──────────────────────────────────────────────────────
 *
 * In `site_setting`, the key/value table migration 0031 created for exactly this shape of thing —
 * "the things an administrator changes without a deploy" — under the namespaced keys `seo.verify.<id>`.
 * `ozikoro_design_override` was the other candidate and it is the wrong table: it is keyed on a DESIGN SCREEN
 * and a CSS selector, its values describe a change to the approved deliverable, and it is read by
 * `applyDesignOverrides` as an edit to markup. A verification token is not an edit to a screen; it is a
 * fact about the site's identity, true on all of them. Adding a table would have been a third place for
 * "a small setting" to live beside the two that already exist, and the key/value table was built for this.
 *
 * **No migration was needed for this feature, and that is a measurement rather than a hope:**
 * `site_setting(key text primary key, value jsonb not null, updated_at, updated_by bigint references
 * account(id))` is what migration 0031 already created, it is empty in this database, and nothing in this
 * repository wrote to it before now. A key is added by writing a row; there is no schema to change.
 *
 * The dictionary's own settings (`code.googleVerification`, `code.bingVerification` in
 * `@ozituma/db/settings`) are a DIFFERENT table read through a DIFFERENT allow-list and are not touched:
 * a browser's verification for ozituma.com says nothing about ozikoro.com, and the two sites are verified
 * separately.
 *
 * ── WHO MAY CHANGE THEM ──────────────────────────────────────────────────────────────────────────────
 *
 * `manage_design` — decided in the screen and in its endpoint, and explained there rather than here.
 */
import type { Db } from '@ozituma/db/client';

/** One crawler that verifies a site by a `<meta>` tag in the `<head>`. */
export interface VerifyEngine {
  /** The key this engine is stored under: `seo.verify.<id>`. Also the screen's anchor. */
  id: string;
  /** What the owner calls it. */
  label: string;
  /** The exact `name` attribute the engine's documentation gives. Emitted verbatim. */
  metaName: string;
  /** Where the engine asks for it, so a reader can check the tag rather than trust it. */
  source: string;
  /** What it verifies, in the archive's own words. */
  note: string;
  /**
   * A prefix that only this engine's tokens have, where one exists.
   *
   * USED ONLY TO DECIDE WHICH ENGINE A PASTED TAG BELONGS TO, never to validate a token. `msvalidate.01`
   * carries a 32-character hexadecimal GUID and `p:domain_verify` carries 32 hex digits, and those are
   * conventions rather than published requirements — so a token that fails the prefix is still stored when
   * the owner types it against the engine by name. **The tag name is the authority when a tag is pasted;
   * this is only how a bare token is routed.**
   */
  tokenPrefix?: string;
}

/**
 * The engines this screen offers, each with the tag it emits.
 *
 * `msvalidate.01` IS THE NAME BING ACTUALLY ASKS FOR, not a mistake. Bing Webmaster Tools' "HTML Meta Tag"
 * option emits `<meta name="msvalidate.01" content="…">`, and `.01` is part of the attribute value the
 * crawler looks for. A tidy `bing-site-verification` would be a tag nothing reads.
 */
export const VERIFY_ENGINES: readonly VerifyEngine[] = [
  {
    id: 'google',
    label: 'Google Search Console',
    metaName: 'google-site-verification',
    source: 'https://search.google.com/search-console',
    note:
      'Search Console, and everything downstream of it: indexing, the sitemap, the URL inspection tool and ' +
      'the query report.',
    tokenPrefix: 'google',
  },
  {
    id: 'bing',
    label: 'Bing Webmaster Tools',
    metaName: 'msvalidate.01',
    source: 'https://www.bing.com/webmasters',
    note: 'Bing Webmaster Tools, which also feeds DuckDuckGo and the other engines that read Bing’s index.',
  },
  {
    id: 'yandex',
    label: 'Yandex Webmaster',
    metaName: 'yandex-verification',
    source: 'https://webmaster.yandex.com',
    note: 'Yandex Webmaster. The owner named this one himself.',
  },
  {
    id: 'baidu',
    label: 'Baidu Webmaster Tools',
    metaName: 'baidu-site-verification',
    source: 'https://ziyuan.baidu.com',
    note: 'Baidu, which is how the archive is reachable from search in China.',
  },
  {
    id: 'pinterest',
    label: 'Pinterest',
    metaName: 'p:domain_verify',
    source: 'https://www.pinterest.com/settings/claim',
    note: 'Pinterest’s claim of the domain, which is what makes a photograph pinned from the archive credit Ozikoro.',
  },
  {
    id: 'facebook',
    label: 'Facebook and Meta',
    metaName: 'facebook-domain-verification',
    source: 'https://business.facebook.com/settings/owned-domains',
    note: 'Meta’s domain verification, used for the link preview and for the owned-domains list.',
  },
  {
    id: 'naver',
    label: 'Naver',
    metaName: 'naver-site-verification',
    source: 'https://searchadvisor.naver.com',
    note: 'Naver, the search engine most used in South Korea.',
  },
  {
    id: 'ahrefs',
    label: 'Ahrefs Webmaster Tools',
    metaName: 'ahrefs-site-verification',
    source: 'https://ahrefs.com/webmaster-tools',
    note:
      'Not a search engine: Ahrefs is an analysis tool, and verifying the site is what lets it crawl the ' +
      'archive and report on it honestly rather than from an estimate.',
  },
];

/** The slot for an engine that is not in the list above. Stored under a key of its own, with the owner's name for it. */
export const OTHER_ENGINE_ID = 'other';

/** The `site_setting` key prefix. Namespaced so the dictionary's own keys can never collide with these. */
export const VERIFY_KEY_PREFIX = 'seo.verify.';

/** The setting key for one engine, whether or not it is in the catalogue. */
export function verifyKey(engineId: string): string {
  return `${VERIFY_KEY_PREFIX}${engineId}`;
}

/** The engines the screen draws, the extra one last. */
export function engineById(id: string): VerifyEngine | null {
  if (id === OTHER_ENGINE_ID) {
    return {
      id: OTHER_ENGINE_ID,
      label: 'Another engine',
      metaName: '',
      source: '',
      note:
        'For a platform that gives a `<meta>` tag and is not in the list above. Paste the tag and the name ' +
        'is read out of it; if the platform gave only a token, type the name it asks for.',
    };
  }
  return VERIFY_ENGINES.find((engine) => engine.id === id) ?? null;
}

/* ================================================================================================
 * 1. WHAT THE OWNER PASTES, AND WHAT IS KEPT FROM IT
 * ============================================================================================== */

/**
 * The five entities that can appear INSIDE an attribute value, decoded once.
 *
 * Order matters and is the whole correctness: `&amp;` must become `&` LAST, or `&amp;lt;` — the literal
 * text `&lt;` — would decode twice and turn a harmless string into a `<`. There is no third pass, so a
 * doubly-encoded payload stays encoded, which is the safe direction.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

/**
 * The characters a real verification token is made of. Anything else is refused rather than escaped.
 *
 * **THE `&` IS HERE BECAUSE A REAL TOKEN CAN CONTAIN ONE.** Some engines issue a token with a query string in
 * it — `…?site=abc&key=def`, which arrives in the tag as a single `&amp;` — so refusing an ampersand would
 * refuse a token an engine actually issued, and the owner would have no way to tell why. It is safe to allow:
 * it is escaped on the way out like every other value, it cannot end an attribute, and the one-pass entity
 * decode above cannot be walked twice into a `<`.
 *
 * WHAT IS NOT HERE IS THE POINT: no quote, no angle bracket, no backtick, no backslash and no whitespace, so
 * nothing that could end the attribute, open a tag or continue one.
 */
const TOKEN_SHAPE = /^[A-Za-z0-9._:~+/=&-]+$/;

/** How long a token may be. The real ones are 16–70 characters; this is the ceiling, not a target. */
export const VERIFY_TOKEN_MAX = 200;

/**
 * Why a value cannot be stored, or null when it can.
 *
 * **REFUSED, NOT ESCAPED AWAY.** `seoHead` escapes every attribute it writes, so a token carrying `"` could
 * not break out of the tag even if it were stored. This is the layer above that, and it exists because a
 * value with a quote or an angle bracket in it is not a token: it is either a mistake or an attempt, and in
 * both cases the honest answer is to refuse it and say so rather than to store something that renders as
 * text the owner did not paste. The same rule the design editor follows for owner-supplied values.
 */
export function tokenProblem(token: string): string | null {
  if (token.length === 0) {
    return 'That is empty. Nothing is stored for an engine until a token is pasted, and an empty setting emits no tag at all.';
  }
  if (token.length > VERIFY_TOKEN_MAX) {
    return `That is ${token.length} characters. A verification token is the value of one tag's \`content\` attribute — under ${VERIFY_TOKEN_MAX} characters — so this looks like more than a token was pasted.`;
  }
  if (!TOKEN_SHAPE.test(token)) {
    return 'A verification token contains letters, digits and a few punctuation marks, and nothing else — no quotes, no angle brackets and no spaces. If a whole tag was pasted, only the value of its "content" attribute is stored.';
  }
  return null;
}

export interface PastedToken {
  /** The token to store. Empty when nothing usable was found. */
  token: string;
  /** Whether a whole `<meta …>` tag was recognised in the paste. */
  fromTag: boolean;
  /** The `name` attribute of that tag, when one was pasted. */
  metaName: string | null;
  /** The engine that tag names, when it is one of the catalogue's. */
  detected: VerifyEngine | null;
  /** Why nothing was extracted, when nothing was. */
  problem: string | null;
}

/**
 * A pasted token or a pasted `<meta>` tag, as the token to store.
 *
 * ORDER OF ATTEMPTS, AND EACH ONE HAS A REASON:
 *
 *   1. a `<meta …>` element anywhere in the paste — this is what the engine's own screen offers to copy;
 *   2. a bare `content="…"` attribute, for a paste that lost its angle brackets;
 *   3. the whole trimmed paste, **unquoted first**: a quotation mark is not part of a token, and an owner
 *      who copies from a JSON or a documentation snippet brings them along.
 *
 * A tag with no `content` attribute extracts nothing and says so, rather than being stored as a token —
 * which would put `<meta name="…">` inside the emitted tag's own attribute.
 */
export function readPastedToken(pasted: string): PastedToken {
  const raw = pasted ?? '';
  const text = raw.trim();

  const tag = /<meta\b[^>]*>/i.exec(text);
  if (tag) {
    const nameMatch = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(tag[0]);
    const contentMatch = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(tag[0]);
    const metaName = decodeEntities((nameMatch?.[1] ?? nameMatch?.[2] ?? nameMatch?.[3] ?? '')).trim();
    const token = decodeEntities((contentMatch?.[1] ?? contentMatch?.[2] ?? contentMatch?.[3] ?? '')).trim();
    const detected =
      VERIFY_ENGINES.find((engine) => engine.metaName.toLowerCase() === metaName.toLowerCase()) ?? null;
    const problem = token.length === 0
      ? 'That is a `<meta>` tag with no `content` attribute, so there is no token inside it to store. Copy the tag the engine gave you, or paste the token on its own.'
      : tokenProblem(token);
    return { token: problem ? '' : token, fromTag: true, metaName: metaName.length > 0 ? metaName : null, detected, problem };
  }

  const contentAttr = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(text);
  if (contentAttr) {
    const token = decodeEntities((contentAttr[1] ?? contentAttr[2] ?? '')).trim();
    const problem = tokenProblem(token);
    return { token: problem ? '' : token, fromTag: true, metaName: null, detected: null, problem };
  }

  const unquoted = text.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();
  const prefixProblem = tokenProblem(unquoted);
  if (prefixProblem && /["'`]/.test(text)) {
    /*
     * A paste that is not a token BECAUSE of the quotes around it is stripped and tried again, so an owner
     * who copied `"abc123"` is not refused for a character he did not type. A paste that fails for any other
     * reason is reported as it stands rather than progressively repaired — repairing an unknown string is how
     * something that is not a token comes to be stored as one.
     */
    const strippedProblem = tokenProblem(text);
    if (!strippedProblem) {
      return { token: text, fromTag: false, metaName: null, detected: null, problem: null };
    }
  }
  const problem = tokenProblem(unquoted);
  return {
    token: problem ? '' : unquoted,
    fromTag: false,
    metaName: null,
    detected: VERIFY_ENGINES.find((engine) => engine.tokenPrefix && unquoted.startsWith(engine.tokenPrefix)) ?? null,
    problem: unquoted.length === 0 ? tokenProblem('') : problem,
  };
}

/**
 * The meta name for a paste, when it can be worked out: the tag's own, then the engine's, then the owner's.
 *
 * Returns null when there is no honest answer, and the caller refuses rather than guessing — a custom engine
 * with no name would emit `<meta name="" content="…">`, which verifies nothing.
 */
export function resolveMetaName(input: {
  engineId: string;
  detected: VerifyEngine | null;
  pastedMetaName: string | null;
  customName?: string | null;
}): { metaName: string | null; problem: string | null } {
  const pasted = (input.pastedMetaName ?? '').trim();
  if (pasted.length > 0 && /^[A-Za-z0-9._:-]+$/.test(pasted)) return { metaName: pasted, problem: null };
  if (pasted.length > 0) {
    return { metaName: null, problem: `The tag's \`name\` attribute — “${pasted.slice(0, 60)}” — is not a name a meta tag can carry.` };
  }
  if (input.detected) return { metaName: input.detected.metaName, problem: null };
  const known = VERIFY_ENGINES.find((engine) => engine.id === input.engineId);
  if (known) return { metaName: known.metaName, problem: null };
  const custom = (input.customName ?? '').trim();
  if (custom.length === 0) {
    return {
      metaName: null,
      problem: 'This is an engine the archive does not know by name, so it needs the `name` attribute its tag uses — for example `example-site-verification`. Without one the tag would carry an empty name and verify nothing.',
    };
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(custom)) {
    return { metaName: null, problem: `“${custom.slice(0, 60)}” is not a name a meta tag can carry; use letters, digits, dots, colons or hyphens.` };
  }
  return { metaName: custom, problem: null };
}

/* ================================================================================================
 * 2. THE TOKENS IN FORCE
 * ============================================================================================== */

/** One engine's stored token, with who set it and when. */
export interface SiteVerification {
  engineId: string;
  metaName: string;
  token: string;
  /** What the engine is called: the catalogue's label, or the owner's own name for a custom entry. */
  label: string | null;
  actorId: number | null;
  actorName: string | null;
  updatedAt: string | null;
}

interface SettingRow {
  key: string;
  value: unknown;
  updated_at: Date | string | null;
  actor_name: string | null;
  actor_id: number | string | null;
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function toVerification(row: SettingRow): SiteVerification | null {
  const value = jsonObject(row.value);
  const token = typeof value.token === 'string' ? value.token.trim() : '';
  const metaName = typeof value.metaName === 'string' ? value.metaName.trim() : '';
  /*
   * A ROW WITH NO TOKEN OR NO NAME IS NOT A VERIFICATION, and it is skipped rather than emitted. This is the
   * empty-setting rule at the read end: a half-written row — which a hand-written SQL insert could produce —
   * must not become `<meta name="" content="">` on every page of the archive.
   */
  if (token.length === 0 || metaName.length === 0) return null;
  return {
    engineId: row.key.startsWith(VERIFY_KEY_PREFIX) ? row.key.slice(VERIFY_KEY_PREFIX.length) : row.key,
    metaName,
    token,
    label: typeof value.label === 'string' && value.label.trim().length > 0 ? value.label.trim() : null,
    actorId: row.actor_id === null || row.actor_id === undefined ? null : Number(row.actor_id),
    actorName: row.actor_name,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

/**
 * Every verification token in force, ready to be written into a head.
 *
 * ORDER IS THE CATALOGUE'S, so a diff of two served heads is readable and the emitted order does not depend
 * on the order rows happened to be inserted in. Anything whose key is not in the catalogue sorts after it,
 * by key.
 */
export async function loadSeoVerification(db: Db): Promise<SiteVerification[]> {
  try {
    const rows = await db.rows<SettingRow>(
      `select s.key, s.value, s.updated_at, s.updated_by as actor_id,
              coalesce(m.display_name, a.email) as actor_name
         from site_setting s
         left join account a on a.id = s.updated_by
         left join ozikoro_member m on m.account_id = s.updated_by
        where s.key like $1
        order by s.key`,
      [`${VERIFY_KEY_PREFIX}%`]
    );
    const parsed = rows.map(toVerification).filter((row): row is SiteVerification => row !== null);
    const rank = (row: SiteVerification): number => {
      const at = VERIFY_ENGINES.findIndex((engine) => engine.id === row.engineId);
      return at === -1 ? (row.engineId === OTHER_ENGINE_ID ? VERIFY_ENGINES.length : VERIFY_ENGINES.length + 1) : at;
    };
    return parsed.sort((a, b) => rank(a) - rank(b) || a.engineId.localeCompare(b.engineId));
  } catch (error) {
    /*
     * DEGRADE TO NO TAGS. A database that is briefly unavailable must not cost every page its head, and a
     * missing verification tag is a thing the owner can see on his own screen. The alternative — throwing —
     * would turn one unreadable settings row into a 500 for the whole archive.
     */
    console.error('[ozikoro/seo-verification] could not read the verification tokens:', String(error).slice(0, 200));
    return [];
  }
}

/* ================================================================================================
 * 3. THE MARKUP
 * ============================================================================================== */

/** HTML-escape for an attribute value. The same five characters `seo-head.ts` escapes. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The verification tags, as complete `<meta>` elements.
 *
 * **THIS IS THE ONLY PLACE THEY ARE WRITTEN, and it returns an empty array when there is nothing to
 * verify** — which is the whole of the "an empty setting is a real setting" rule. A caller gets `[]`, joins
 * it, and emits nothing; there is no path through this function that produces `content=""`.
 *
 * The name goes through a second shape test here even though `resolveMetaName` already made one, because
 * this function is also reachable from `loadSeoVerification`, which reads the database and does not know how
 * a row was written.
 */
export function verificationTags(verification: readonly SiteVerification[]): string[] {
  const tags: string[] = [];
  for (const entry of verification) {
    const name = entry.metaName.trim();
    const token = entry.token.trim();
    if (name.length === 0 || token.length === 0) continue;
    if (!/^[A-Za-z0-9._:-]+$/.test(name)) continue;
    tags.push(`<meta name="${esc(name)}" content="${esc(token)}">`);
  }
  return tags;
}

/* ================================================================================================
 * 4. THE WRITE PATH — ONE ROW, ONE AUDIT LINE, NO WAY ROUND EITHER
 * ============================================================================================== */

/**
 * A refusal an owner can read, thrown by the write path and turned into a notice by the endpoint.
 *
 * `message` is written for the person who pasted the token, not for a log: it says what is wrong with the
 * paste and what to do instead, because the alternative is a form that silently does nothing.
 */
export class SeoVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeoVerificationError';
  }
}

/**
 * One audit row, and **a failure to write it never fails the change.**
 *
 * `entity_id` is `bigint not null` and `site_setting` has a TEXT primary key and no numeric id, so there is
 * no honest number to point at. The alternative was inventing one — a running count, or zero — and an audit
 * row whose `entity_id` is a lie is worse than one that is the number of the account that made the change,
 * which is a real, checkable number and is named in the note beside it. `entity_type` is
 * `site_verification_token` and the note carries the ENGINE, so the trail reads
 * "site_verification_token · 199 · set_verification_token · google" and the number the reader needs is there.
 */
async function audit(
  db: Db,
  event: {
    action: string;
    engineId: string;
    before?: unknown;
    after?: unknown;
    actorId: number | null;
    note?: string | null;
  }
): Promise<void> {
  try {
    await db.query(
      `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
       values ('site_verification_token', $1, $2, $3::jsonb, $4::jsonb, $5, $6)`,
      [
        // See the note above: the actor's own id stands in for a subject that has no numeric id at all.
        event.actorId ?? 0,
        event.action,
        event.before === undefined ? null : JSON.stringify(event.before),
        event.after === undefined ? null : JSON.stringify(event.after),
        event.actorId,
        event.note ?? event.engineId,
      ]
    );
  } catch (error) {
    console.error('[ozikoro/seo-verification] could not record the audit event:', String(error).slice(0, 160));
  }
}

/**
 * Store one engine's token, or clear it.
 *
 * **A TOKEN IS TRIMMED BEFORE IT IS WRITTEN, AND IT IS VALIDATED BEFORE IT IS.** A trailing space pasted
 * from the Search Console's own page is the single commonest reason a verification silently fails — the tag
 * is emitted, the crawler reads a different string from the one on the other side, and nothing anywhere says
 * so. The shape test then refuses anything that is not a token: see `tokenProblem`.
 *
 * `token === null` REMOVES the row rather than writing an empty string, which is what makes "clear this
 * engine" the same act as "never set it": the read returns nothing for it, and no tag is emitted.
 */
export async function setSeoVerification(
  db: Db,
  input: {
    engineId: string;
    metaName: string;
    /** The token to store, or null to clear this engine. */
    token: string | null;
    label?: string | null;
    actorId: number | null;
    note?: string | null;
  }
): Promise<{ cleared: boolean; stored: SiteVerification | null }> {
  const engineId = input.engineId.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(engineId)) {
    throw new SeoVerificationError('That is not an engine this screen knows. Reload the page and choose one of the engines it lists.');
  }
  const key = verifyKey(engineId);
  const before = await loadSeoVerification(db);
  const was = before.find((entry) => entry.engineId === engineId) ?? null;

  if (input.token === null || input.token.trim().length === 0) {
    if (!was) return { cleared: false, stored: null };
    await db.query(`delete from site_setting where key = $1`, [key]);
    await audit(db, {
      action: 'clear_verification_token',
      engineId,
      before: { metaName: was.metaName, tokenLength: was.token.length },
      after: { removed: true },
      actorId: input.actorId,
      note: `Cleared the site-verification token for ${engineId}. No tag is emitted for it.`,
    });
    return { cleared: true, stored: null };
  }

  const token = input.token.trim();
  const problem = tokenProblem(token);
  if (problem) throw new SeoVerificationError(problem);
  const metaName = input.metaName.trim();
  if (!/^[A-Za-z0-9._:-]+$/.test(metaName)) {
    throw new SeoVerificationError(
      'That tag has no usable `name` attribute, so it would verify nothing. Paste the engine’s whole tag, or choose an engine from the list.'
    );
  }

  const value: Record<string, string> = { token, metaName };
  const label = (input.label ?? '').trim();
  if (label.length > 0) value.label = label;

  await db.query(
    `insert into site_setting (key, value, updated_at, updated_by)
     values ($1, $2::jsonb, now(), $3)
     on conflict (key) do update
        set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
    [key, JSON.stringify(value), input.actorId]
  );

  await audit(db, {
    action: was ? 'update_verification_token' : 'set_verification_token',
    engineId,
    /*
     * THE TOKEN IS NOT WRITTEN INTO THE AUDIT ROW.
     *
     * `before` and `after` are jsonb and are read back by `/admin/audit/`, which every editor holding
     * `view_audit` can open. **A verification token is a credential**: anybody who can read it can claim to
     * be this site to Google, which is a worse outcome than the one verification prevents. So the trail
     * records that the token CHANGED, which engine, how long it is and who did it — and not the value. The
     * value is on the screen the owner owns, behind the same capability that let him set it.
     */
    before: was ? { metaName: was.metaName, tokenLength: was.token.length } : undefined,
    after: { metaName, tokenLength: token.length, label: label.length > 0 ? label : null },
    actorId: input.actorId,
    note: `Set the site-verification token for ${engineId} (${metaName}).`,
  });

  const stored = (await loadSeoVerification(db)).find((entry) => entry.engineId === engineId) ?? null;
  return { cleared: false, stored };
}

