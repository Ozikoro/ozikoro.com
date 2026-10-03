/**
 * The request page, at /forgot.
 *
 * THE OWNER'S OWN DESIGN, SERVED RATHER THAN REBUILT.
 *
 * `public/design/screens/account.html` carries the whole page and is not edited — the ground, the card,
 * the header with the three sites, the footer, and the field styles. A password request needs one field,
 * so this route serves the same screen with the parts that are not that field removed and the heading, the
 * lede and the button's words changed. **Every one of those changes is asserted by `accountScreen`**,
 * which refuses to serve the page if the design no longer contains the line it means to rewrite, rather
 * than quietly returning a page whose form posts the wrong thing.
 *
 * THE MESSAGE IS DRAWN FROM THE QUERY, SO THE PAGE WORKS WITHOUT JAVASCRIPT.
 *
 * The form posts to `/api/auth/forgot` and the endpoint answers with a 303 back here carrying `?sent=1` or
 * `?error=…`. A browser with JavaScript off follows that and reads the sentence, which is the behaviour of
 * every other form on this site. With JavaScript on, `/account-forgot.js` posts the same form with
 * `accept: application/json` and writes the same sentence into the same element without leaving the page.
 * **Both paths exist on purpose**: recovery is the one flow a person reaches when something has already
 * gone wrong for them, and it must not additionally require a working script.
 */
import { RESET_TTL_MINUTES } from '@ozituma/db/passwords';
import { ACCOUNT_LINES, accountScreen, screenResponse } from '@/lib/account-screen';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const sent = url.searchParams.get('sent') === '1';
  // Clamped: this text is reflected into the page, and reflected text is unbounded unless it is bounded.
  const error = (url.searchParams.get('error') ?? '').slice(0, 300);

  const notice = error
    ? { text: error, bad: true }
    : sent
      ? {
          text:
            'If that address has an account here, a link to set a new password has been sent to it. ' +
            `It works once, and it stops working in ${RESET_TTL_MINUTES} minutes.`,
        }
      : { text: '' };

  const html = await accountScreen({
    notice,
    scripts: ['/account-forgot.js'],
    replace: [
      [ACCOUNT_LINES.intro, '<h1 id="intro">A way back into <em>the archive.</em></h1>'],
      [
        ACCOUNT_LINES.introcopy,
        `<p id="introcopy">A recovery link is sent to the address the account was created with. It works once, and it stops working ${RESET_TTL_MINUTES} minutes after it is sent.</p>`,
      ],
      [ACCOUNT_LINES.crumb, '<span id="crumb">Reset password</span>'],
      [
        ACCOUNT_LINES.heading,
        '<p class="kicker" id="kicker">Account recovery</p><h2 id="title">Reset your password</h2>' +
          '<p class="lede" id="lede">Type the address you joined with. If it has an account here, a link to set a new password is on its way to it.</p>',
      ],
      [ACCOUNT_LINES.submit, '<button class="primary" type="submit" id="submit">Send the link&nbsp; →</button>'],
      [ACCOUNT_LINES.switcher, '<p class="switch" id="switch">Remembered it? <a href="/signin/">Sign in</a></p>'],
      [ACCOUNT_LINES.openInMode, '/* the design’s mode toggle is not used on this page */'],
    ],
    remove: [
      ACCOUNT_LINES.password,
      ACCOUNT_LINES.confirm,
      ACCOUNT_LINES.remember,
      ACCOUNT_LINES.terms,
      ACCOUNT_LINES.google,
    ],
  });

  return screenResponse(html);
}
