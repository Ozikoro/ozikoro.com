/**
 * Where a recovery link lands, at /reset?token=…
 *
 * THE OWNER'S OWN DESIGN, SERVED RATHER THAN REBUILT.
 *
 * The same screen `/signin` serves, with the fields a new password needs and nothing else: the email field
 * goes, the design's own `#pw` and `#confirm` fields stay with their `toggle()` and `toggle2()` buttons, so
 * showing the password behaves exactly as it does on the page the owner already approved. The password
 * fields gain `minlength`, taken from `MIN_PASSWORD_LENGTH` rather than typed, because a number copied into
 * a template is a number that disagrees with the server the first time the policy moves.
 *
 * THE TOKEN IS CHECKED BEFORE THE FORM IS DRAWN, AND AGAIN WHEN IT IS POSTED.
 *
 * A link that has expired or has already been used says so instead of inviting somebody to choose a
 * password twice and then refusing it. That check is a read and not a claim: the password is only written
 * by the POST, which checks the token again — through `resetPasswordWithToken`, the one function that may
 * write `account.password_hash`.
 *
 * A TOKEN THAT CANNOT BE USED SENDS THE PERSON TO /forgot, WHICH IS THE SAME DESIGN AND THE PLACE THE FIX IS.
 *
 * There is nothing to do on this page without a working link, and the alternative — drawing the form and
 * refusing the submission — asks somebody to do work that was never going to be accepted.
 */
import { MIN_PASSWORD_LENGTH } from '@ozituma/db/accounts';
import { checkResetToken } from '@ozituma/db/passwords';
import { getDb } from '@ozituma/db/client';
import { ACCOUNT_LINES, accountScreen, escapeHtml, screenResponse } from '@/lib/account-screen';
import { redirectTo } from '@/lib/access';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = (url.searchParams.get('token') ?? '').slice(0, 400);
  const error = (url.searchParams.get('error') ?? '').slice(0, 300);

  const db = await getDb();
  const found = token ? await checkResetToken(db, token) : null;

  if (!found) {
    return redirectTo('/forgot/', {
      error:
        'That link has expired or has already been used. A link works once, and it stops working an ' +
        'hour after it is sent.',
    });
  }

  const html = await accountScreen({
    notice: error ? { text: error, bad: true } : { text: '' },
    scripts: ['/account-reset.js'],
    /*
     * The token travels in the BODY of the form, not only in the address. A bookmark, a shared URL or a
     * browser history entry then holds the address without the key, and the POST still carries the token
     * the server is expecting.
     */
    formFields: `<input type="hidden" name="token" value="${escapeHtml(token)}">`,
    replace: [
      [ACCOUNT_LINES.intro, '<h1 id="intro">Choose a new <em>password.</em></h1>'],
      [
        ACCOUNT_LINES.introcopy,
        '<p id="introcopy">The link in the message reaches one account. Setting a new password signs out every device that is signed in, including any you have forgotten about.</p>',
      ],
      [ACCOUNT_LINES.crumb, '<span id="crumb">Set a new password</span>'],
      [
        ACCOUNT_LINES.heading,
        '<p class="kicker" id="kicker">Account recovery</p><h2 id="title">Set a new password</h2>' +
          `<p class="lede" id="lede">For the account this link was sent to. At least ${MIN_PASSWORD_LENGTH} characters — length is the only rule, so a phrase you will remember is a good password.</p>`,
      ],
      [
        ACCOUNT_LINES.password,
        '<div class="group"><label>New password</label><div class="pass">' +
          `<input id="pw" type="password" placeholder="Your new password" required minlength="${MIN_PASSWORD_LENGTH}" autocomplete="new-password">` +
          '<button class="show" type="button" onclick="toggle()">Show</button></div></div>\n',
      ],
      /*
       * The confirm field is drawn, not hidden. The design hides it until its own `signup()` runs, and this
       * page does not run it — so the `display:none` comes off here, with `required` and the same
       * `minlength` put on, since the design's `signup()` is what would have set those.
       */
      [
        ACCOUNT_LINES.confirm,
        '<div class="group" id="confirmgroup"><label>Confirm password</label><div class="pass">' +
          `<input id="confirm" type="password" placeholder="The same password again" required minlength="${MIN_PASSWORD_LENGTH}" autocomplete="new-password">` +
          '<button class="show" type="button" onclick="toggle2()">Show</button></div></div>\n',
      ],
      [
        ACCOUNT_LINES.submit,
        '<button class="primary" type="submit" id="submit">Set the new password&nbsp; →</button>',
      ],
      [ACCOUNT_LINES.switcher, '<p class="switch" id="switch">Remembered it? <a href="/signin/">Sign in</a></p>'],
      [ACCOUNT_LINES.openInMode, '/* the design’s mode toggle is not used on this page */'],
    ],
    remove: [ACCOUNT_LINES.email, ACCOUNT_LINES.remember, ACCOUNT_LINES.terms, ACCOUNT_LINES.google],
  });

  return screenResponse(html);
}
