/**
 * The account page, at /signin.
 *
 * THE OWNER'S OWN DESIGN, SERVED RATHER THAN REBUILT.
 *
 * `public/design/screens/account.html` carries the whole page — the ground, the card, the fields, the three
 * sites in the header, the footer, and its own `signin()` and `signup()` functions that move the heading, the
 * lede and the button. **It is the design and it is not edited.** What it does not carry is a server, so
 * `/account-auth.js` is added to it here and reads the same fields the design draws.
 *
 * **Both addresses serve it, because the design holds both modes.** `/signin` opens on signing in and
 * `/join` on joining, and the design's own links move between them without a second document, which is what
 * the design was drawn to do.
 *
 * THE "Forgot password?" LINK NOW GOES SOMEWHERE, IN THE SERVED COPY.
 *
 * The design draws it as `<a class="link" href="#">`. The owner's complaint is that it does nothing, and
 * the fix is a substitution here rather than an edit to the design — the same way the wiring script is
 * added. It is done on `/join` too, because the design's own "Sign in" link reveals that row without
 * reloading, so a link left pointing at `#` would still be reachable from there.
 *
 * A MESSAGE IN THE ADDRESS IS DRAWN, WHICH IS WHAT MAKES THE ENDPOINTS WORK WITHOUT JAVASCRIPT.
 *
 * Every form endpoint answers a plain post with a 303 back to a page carrying `?error=…` or `?reset=1`.
 * Until now this route ignored both, so a sign-in that failed with JavaScript off said nothing at all.
 * The message goes into the element `/account-auth.js` also writes into, so a JavaScript answer and a
 * redirect answer appear in the same place. The text is escaped and clamped: it arrives in a URL, and a URL
 * is something anybody can write.
 */
import { ACCOUNT_LINES, accountScreen, escapeHtml, screenResponse } from '@/lib/account-screen';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const reset = url.searchParams.get('reset') === '1';
  const error = (url.searchParams.get('error') ?? '').slice(0, 300);
  const email = (url.searchParams.get('email') ?? '').trim().slice(0, 200);

  const replace: Array<[string, string]> = [
    [ACCOUNT_LINES.forgotLink, '<a class="link" href="/forgot/">Forgot password?</a>'],
    /*
     * signin.toUpperCase() OPENS IN ITS OWN MODE.
     *
     * The design decides its mode from `location.hash`, and its own "Create one" link sets that. **A reader who
     * arrives at /signin directly has set no hash**, so the page would open on whichever mode the design calls
     * its default — which is signing in. The hash is therefore set once, before the wiring script runs, and the
     * design's own toggle does everything after that.
     */
    ['</head>', '<script>if(!location.hash)location.replace("#signin");</script></head>'],
  ];

  /*
   * The address is put back in the field after a reset, so the person types only the password they have just
   * chosen. `replaceOnce` requires the design's email line exactly as it is, so the value is added to the
   * design's own markup rather than to a rewrite of it.
   */
  if (email) {
    replace.push([
      ACCOUNT_LINES.email,
      `<div class="group"><label>Email address</label><input type="email" placeholder="you@example.com" required value="${escapeHtml(email)}"></div>\n`,
    ]);
  }

  const html = await accountScreen({
    replace,
    scripts: ['/account-auth.js'],
    notice: error
      ? { text: error, bad: true }
      : reset
        ? { text: 'Your password has been changed. Sign in with the new one.' }
        : { text: '' },
  });

  return screenResponse(html);
}
