/**
 * The owner's account screen, served at each address with the parts that address needs.
 *
 * `public/design/screens/account.html` is the design and it is NOT edited — not for the reset flow, not
 * for anything. It carries the whole page: the ground, the card, the fields, the three sites in the
 * header, the footer, and its own `signin()` and `signup()` functions. What it does not carry is a
 * server, and `/signin`, `/join`, `/forgot` and `/reset` are four different conversations with one form.
 *
 * WHY THE SUBSTITUTIONS ARE ASSERTED RATHER THAN PERFORMED
 *
 * `String.replace` is happy to change nothing at all. A design file that no longer contains the line a
 * route means to change would produce a page that looks right and posts the wrong field, and the failure
 * would surface as "the reset link did nothing" — the exact complaint this work exists to answer. **So
 * every find is required to appear EXACTLY ONCE, and the page refuses to be served otherwise.** A loud
 * 500 on a broken template is worth more than a quiet 200 on a wrong one.
 *
 * This is the same rule the services' own checkers follow: a check that cannot fail is not a check.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ScreenNotice {
  /** Empty means no message is shown, and the element stays hidden. */
  text: string;
  /** A refusal rather than an explanation. */
  bad?: boolean;
}

export interface AccountScreenOptions {
  /** Literal `[find, replace]` pairs, each applied once. */
  replace?: Array<[string, string]>;
  /** Literal substrings to delete outright, each applied once. */
  remove?: string[];
  /** Paths added as `<script defer>` before `</body>`, in order. */
  scripts?: string[];
  /**
   * The message shown above the form: the one the server can know before the page is drawn, such as
   * "that link has expired". A message produced by JavaScript goes into the same element, by id.
   */
  notice?: ScreenNotice;
  /** Markup placed immediately inside `<form id="form">`, such as a hidden token field. */
  formFields?: string;
}

/** Escape for HTML text and attribute values alike, so a value cannot end the element it sits in. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The address of the screen on disk, resolved from the app directory rather than the process's. */
const SCREEN = join(process.cwd(), 'public', 'design', 'screens', 'account.html');

/** The element JavaScript writes into, and the one the server may pre-fill. It is always present. */
const NOTICE_ID = 'screen-notice';

/** Where the form begins, and therefore where a notice goes just above it. */
const FORM = '<form id="form">';

/**
 * The design's own lines, quoted exactly, in one place.
 *
 * Four routes rewrite the same screen, and a line copied into two of them is a line that will be fixed in
 * one. Quoting them here means a change the design makes breaks loudly in every route at once, through
 * `replaceOnce`, rather than breaking the two nobody re-read. **The trailing newline is part of the line**
 * for the block elements: removing the text without it leaves a blank line behind.
 */
export const ACCOUNT_LINES = {
  intro: '<h1 id="intro">Welcome back to <em>the archive.</em></h1>',
  introcopy:
    '<p id="introcopy">Access your Ozikoro account to continue reading histories, saving research, and managing the material you contribute to the archive.</p>',
  crumb: '<span id="crumb">Sign in</span>',
  heading:
    '<p class="kicker" id="kicker">Member access</p><h2 id="title">Sign in to Ozikoro</h2><p class="lede" id="lede">Continue your work across histories, documents, collections and research.</p>',
  email:
    '<div class="group"><label>Email address</label><input type="email" placeholder="you@example.com" required></div>\n',
  password:
    '<div class="group"><label>Password</label><div class="pass"><input id="pw" type="password" placeholder="Your password" required><button class="show" type="button" onclick="toggle()">Show</button></div></div>\n',
  confirm:
    '<div class="group" id="confirmgroup" style="display:none"><label>Confirm password</label><div class="pass"><input id="confirm" type="password" placeholder="Confirm your password"><button class="show" type="button" onclick="toggle2()">Show</button></div></div>\n',
  remember:
    '<div class="row" id="signinrow"><label class="check"><input type="checkbox"> Remember me</label><a class="link" href="#">Forgot password?</a></div>\n',
  /**
   * The design's "Forgot password?" link, which points at `#`.
   *
   * It is replaced in the served copy rather than in the file, because the design is not edited — and it
   * has to be replaced on `/join` as well as `/signin`, since the design's own "Sign in" link shows the row
   * without changing the document. **A link that only works on one of the two pages that draw it is the
   * same defect this work exists to fix**, one address along.
   */
  forgotLink: '<a class="link" href="#">Forgot password?</a>',
  terms:
    /*
     * A HIDDEN CONSENT BOX MUST NOT BE `required`, AND THIS ONE WAS.
     *
     * The design hides this row (`style="display:none"`) and its `signup()` reveals it. **The `required`
     * attribute was in the markup, so it applied while the box was hidden** — and a hidden `required` field
     * stops a form submitting exactly as a visible one does.
     *
     * The result was the worst kind of fault: the browser refused to submit, told the reader to fill in a field
     * it could not point at, **and the one control it wanted was invisible.** The owner filled in the email and
     * the password, pressed Sign in, and was told to tick a consent box that was not on the page.
     *
     * **The attribute is set by `/account-auth.js` when joining and only then**, which is where the decision
     * belongs — the box and its requirement are both the join form's, and neither should exist while signing in.
     */
    /*
     * THIS IS A **FIND** STRING, NOT OUTPUT, AND IT MUST MATCH THE DESIGN EXACTLY.
     *
     * `/forgot` and `/reset` use it to locate the row they replace. **Editing it to drop `required` — which is
     * what happened here — made it stop matching the design, and `replaceOnce` then refused to serve the page
     * at all:**
     *
     *     Error: The account design no longer contains "<div class="terms" id="terms" …"
     *     Refusing to serve a page whose fields were not rewritten
     *
     * **The refusal is correct and it is the reason this was found.** `required` is removed from the SERVED
     * copy by the `replace` below, which is the right place for it — a find string describes the document as it
     * is, never as it should become.
     */
    '<div class="terms" id="terms" style="display:none"><label class="check"><input type="checkbox" required><span>I agree to the <a class="link" href="#">Terms of Use</a> and <a class="link" href="#">Privacy Policy</a>.</span></label></div>\n',
  submit: '<button class="primary" type="submit" id="submit">Sign in&nbsp; →</button>',
  google:
    '<div class="or">or continue with</div><button class="google" type="button">G&nbsp;&nbsp; Continue with Google</button>\n',
  switcher:
    '<p class="switch" id="switch">Don’t have an account? <a href="#" onclick="signup();return false">Create one</a></p>',
  /*
   * The design opens in join mode when the address says so. A page with no join mode must remove this call
   * with the fields it refers to: left in, `signup()` looks for a name field that is not on the page and
   * throws, which turns a hash in a URL into a broken page.
   */
  openInMode: "if(location.hash==='#signup')signup();",
} as const;

function replaceOnce(html: string, find: string, replacement: string): string {
  const at = html.indexOf(find);
  if (at < 0) {
    throw new Error(
      `The account design no longer contains ${JSON.stringify(find.slice(0, 70))}. ` +
        'Refusing to serve a page whose fields were not rewritten — fix the find in the route that ' +
        'serves it, rather than editing the design.'
    );
  }
  if (html.indexOf(find, at + 1) >= 0) {
    throw new Error(
      `The account design contains ${JSON.stringify(find.slice(0, 70))} more than once, so the ` +
        'replacement is ambiguous. Make the find specific enough to name one occurrence.'
    );
  }
  return html.slice(0, at) + replacement + html.slice(at + find.length);
}

/**
 * The notice, always drawn once so JavaScript has somewhere to write.
 *
 * `display:none` when there is nothing to say, because an empty paragraph still occupies its margin and
 * a gap above the form with no reason for it reads as a layout fault.
 */
function noticeHtml(notice: ScreenNotice): string {
  const hidden = notice.text ? '' : ';display:none';
  const colour = notice.bad ? '#8a2b1f' : 'var(--green2,#08402f)';
  const style = `margin:0 0 18px;font-size:.95rem;line-height:1.55;color:${colour}${hidden}`;
  return `<p id="${NOTICE_ID}" role="status" style="${style}">${escapeHtml(notice.text)}</p>\n`;
}

/**
 * THE EIGHTEEN CONTROLS THE ACCOUNT SCREEN WRITES AS `href="#"`, DECIDED ONE AT A TIME (round 338).
 *
 * WHY THIS IS NOT `fillDashboardLinks`, AND WHY THAT MATTERS
 *
 * The shared transform already turns a placeholder into either a real address or an inert non-link, and
 * adding `account` to `LINKED_SCREENS` would have been one line. **It would also have been wrong on every
 * one of them.** `fillDashboardLinks` reads a label and looks it up in a table written for the dashboards
 * and the eleven record screens; the account screen's labels are the SITE's own menu, and only some of them
 * are in that table. The rest — `ozituma.com — dictionary`, `Terms of Use`, `Create one` — would have
 * become "— Not built yet" text, replacing eighteen live controls with a statement that is not true of all
 * of them. **A label is only meaningful in the page it is written on**, so each is decided here.
 *
 * THE THREE ANSWERS, AND WHY EACH ONE IS THE HONEST ONE
 *
 *   1. THE NAV, WIRED TO THE DESIGN'S OWN DESTINATIONS. The account screen's seven-item menu is `home.html`'s
 *      menu written with placeholders — measured: `home.html` carries the identical seven labels and the
 *      sibling filenames the other fifty screens use. So each label takes the address the same label has on
 *      every other screen once `designScreenLinks` has resolved it. **`Researchers` follows that rule rather
 *      than the design's `researcher-profile.html`, because the design's profile is one stranger and the
 *      label is a directory's** — the fault `design-paths.ts` records.
 *   2. THE BRAND, THE SECTION TAB AND THE THREE HOST LINKS. `ozikoro.com — archive & research` and the brand
 *      go to `/`; the section tab `History & Archive` is this site, so it goes to `/` as well. The other two
 *      hosts are the addresses `home.html`'s own platform bar prints — `https://ozituma.com/` and
 *      `https://learn.ozituma.com/` — and that host is being retired, so the destination is this
 *      archive's own `/academy/`, which is the page that says the academy is being prepared.
 *   3. `Terms of Use` AND `Privacy Policy` GO TO `/about/#terms`, WHICH IS THE DESIGN'S OWN ANSWER. The
 *      deliverable's own footer has one link, "Terms & privacy", pointing at `about.html#terms`, and the
 *      section it lands on states plainly that binding terms and a data-controller notice must be supplied.
 *      That is the page for both labels; inventing a `/terms/` would be inventing a page.
 *   4. THE THREE `onclick` CONTROLS KEEP THEIR HANDLER AND GAIN A REAL ADDRESS. `Create one` and `Sign in`
 *      call the screen's own `signup()`/`signin()` and `return false`, so with JavaScript they switch the
 *      form in place exactly as the design drew them. **Without it, `href="#"` scrolled to the top of the
 *      page and did nothing** — the control the reader needs to reach the other form was dead. Pointed at
 *      `/join/` and `/signin/` it is a working link in that case and an unchanged control in the other.
 *      *Removing the `href` instead would have been worse than the fault: an `<a>` without one is not
 *      focusable and not keyboard-operable, so the fix would have taken these two controls away from exactly
 *      the readers who cannot fall back on a mouse.*
 *   5. AND ONE LABEL IS LEFT ALONE RATHER THAN GUESSED AT. A placeholder whose text is not in the table is
 *      reported to the log and left as it was, because the only two options for an unknown label are a
 *      destination invented for it or a rewrite that changes what the control says — and both are worse than
 *      a fault that is visible in the log on the first request.
 */
const ACCOUNT_LINK_TARGETS: Record<string, string> = {
  // The platform bar and the masthead — `home.html`'s own addresses.
  'ozikoro.com — archive & research': '/',
  'ozituma.com — dictionary': 'https://ozituma.com/',
  // The design's platform bar names the retired host; the label is what is looked up, so the KEY
  // stays as the design wrote it and only the destination moves. `/academy/` is this archive's own
  // page and it answers — see the retirement rule in `design-paths.ts`.
  'learn.ozituma.com — Learn Igbo': '/academy/',
  'History & Archive': '/',
  // The seven-item menu, at the addresses the same labels reach on the other fifty-one screens.
  Histories: '/archive/',
  Folklores: '/folklore/',
  Watch: '/watch/',
  Archive: '/documents/',
  Researchers: '/researchers/',
  Calendars: '/cultural-calendar/',
  About: '/about/',
  // The deliverable's own "Terms & privacy" destination.
  'Terms of Use': '/about/#terms',
  'Privacy Policy': '/about/#terms',
  // Live controls with a fallback address for a reader whose browser runs no scripts.
  'Create one': '/join/',
  'Sign in': '/signin/',
  /*
   * `Forgot password?` IS NOT IN THE DESIGN'S OWN ADDRESS — the sign-in and join routes replace it with
   * `/forgot/` before this function runs, and the two reset routes remove the row it sits in. It is in the
   * table anyway, because the table is what decides what an *unhandled* placeholder becomes: without the
   * entry, a route that stopped replacing it would leave a dead "Forgot password?" on a sign-in page, which
   * is the one control a locked-out reader needs.
   */
  'Forgot password?': '/forgot/',
};

/**
 * The brand is matched by its class rather than by its text.
 *
 * Its inner text is `<span>O</span>` + `<strong>Ozikoro</strong>` + `<small>History & Archive</small>` — three
 * pieces of a masthead, not a label, and reading it as one gives `OOzikoroHistory & Archive`. **A class is
 * what the element is; a concatenation of its children is not a name for it.**
 */
const ACCOUNT_LINK_TARGET_BY_CLASS: Array<[RegExp, string]> = [[/\bclass="brand"/, '/']];

/**
 * The one label that has to change with its address, and the reason it is a second table rather than a
 * `[href, label]` pair in the first.
 *
 * `design-paths.ts` retires `learn.ozituma.com`: the address becomes `/academy/`, **and the label becomes
 * `Academy — Learn Igbo`**, because the label named a host rather than the place and the host is going. This
 * screen is the eighteenth that carries the three-host platform bar and the only one not served through
 * `designScreenLinks`, so the rule has to be repeated here or the bar would disagree with itself across the
 * site. **A table keyed by the design's own label cannot also change that label**, which is why the labels
 * are their own map.
 */
const ACCOUNT_LINK_LABELS: Record<string, string> = {
  'learn.ozituma.com — Learn Igbo': 'Academy — Learn Igbo',
};

/** The handful of entities the design's own labels carry, decoded before the table is consulted. */
function decodeLabel(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8217;/g, '\u2019')
    .replace(/\s+/g, ' ')
    .trim();
}

export function accountScreenLinks(html: string): string {
  let out = html;
  let from = 0;
  for (;;) {
    const at = out.indexOf('<a ', from);
    if (at === -1) break;
    const openEnd = out.indexOf('>', at);
    if (openEnd === -1) break;
    from = openEnd + 1;

    const attrs = out.slice(at + 2, openEnd);
    /* Only the placeholder. A real address is some other pass's business, and the forged one is not a link. */
    if (!/\shref="#"/.test(attrs)) continue;

    const close = out.slice(openEnd + 1).search(/<\/a\s*>/);
    if (close === -1) continue;
    const inner = out.slice(openEnd + 1, openEnd + 1 + close);
    const label = decodeLabel(inner.replace(/<[^>]+>/g, ''));
    const target = ACCOUNT_LINK_TARGETS[label] ?? ACCOUNT_LINK_TARGET_BY_CLASS.find(([re]) => re.test(attrs))?.[1];
    if (!target) {
      console.warn(`account-screen: a placeholder link with no decided destination was left alone: ${label}`);
      continue;
    }
    const renamed = ACCOUNT_LINK_LABELS[label];
    const replacement = `<a ${attrs.replace(/\shref="#"/, ` href="${target}"`).trim()}>`;
    out = out.slice(0, at) + replacement
      + (renamed ? escapeHtml(renamed) : out.slice(openEnd + 1, openEnd + 1 + close))
      + out.slice(openEnd + 1 + close);
    from = at + replacement.length;
  }
  return out;
}

/** Read the design, apply the substitutions, and return the page to send. */
export async function accountScreen(options: AccountScreenOptions = {}): Promise<string> {
  let html = await readFile(SCREEN, 'utf8');

  for (const [find, replacement] of options.replace ?? []) {
    html = replaceOnce(html, find, replacement);
  }
  for (const find of options.remove ?? []) {
    html = replaceOnce(html, find, '');
  }

  /*
   * A HIDDEN CONSENT BOX MUST NOT BE `required`, AND THE DESIGN'S OWN MARKUP MAKES IT ONE.
   *
   * `account.html` carries:
   *
   *     <div class="terms" id="terms" style="display:none"><label class="check">
   *       <input type="checkbox" required>  I agree to the Terms of Use…
   *
   * **Hidden, and required.** A `required` field stops a form submitting whether or not anybody can see it, so
   * the browser refused every sign-in and told the reader to fill in a field it could not point at. The one
   * control it wanted was invisible.
   *
   * The owner's words were *"the login is not going, and it is asking me to tick the consent box"* — while the
   * box was not on the page at all.
   *
   * **It is stripped here, in the served copy, rather than in `account.html`**, because the design is not
   * edited. `/account-auth.js` sets the attribute back when the form is joining and only then, which is where
   * the requirement belongs: **the consent is the join form's, and neither it nor its box should exist while
   * signing in.**
   */
  html = html.replace('type="checkbox" required', 'type="checkbox"');

  html = accountScreenLinks(html);

  html = replaceOnce(html, FORM, `${noticeHtml(options.notice ?? { text: '' })}${FORM}`);

  if (options.formFields) {
    html = replaceOnce(html, FORM, `${FORM}${options.formFields}`);
  }
  for (const script of options.scripts ?? []) {
    html = replaceOnce(html, '</body>', `<script src="${escapeHtml(script)}" defer></script></body>`);
  }

  return html;
}

/**
 * The response every one of these pages is sent with.
 *
 * `no-store`, because a password form is the last thing anything in the middle should keep, and
 * `X-Robots-Tag`, because a recovery link is a key and a search engine that indexed one would be
 * publishing it.
 */
export function screenResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
