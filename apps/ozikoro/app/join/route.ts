/**
 * The account page, at /join.
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
 * THE "Forgot password?" LINK IS REWRITTEN HERE TOO, AND THAT IS NOT TIDINESS.
 *
 * The design hides the sign-in row in join mode, and its own "Sign in" link reveals it *in this same
 * document* — so the reader can reach that link from `/join` without the page being reloaded from
 * `/signin`. A rewrite applied only on `/signin` would leave a dead "Forgot password?" link on this address,
 * which is the defect this work exists to fix, at the other door.
 */
import { ACCOUNT_LINES, accountScreen, screenResponse } from '@/lib/account-screen';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const html = await accountScreen({
    replace: [
      [ACCOUNT_LINES.forgotLink, '<a class="link" href="/forgot/">Forgot password?</a>'],
      /*
       * join.toUpperCase() OPENS IN ITS OWN MODE.
       *
       * The design decides its mode from `location.hash`, and its own "Create one" link sets that. **A reader
       * who arrives at /join directly has set no hash**, so the page would open on whichever mode the design
       * calls its default — which is signing in. The hash is therefore set once, before the wiring script
       * runs, and the design's own toggle does everything after that.
       */
      ['</head>', '<script>if(!location.hash)location.replace("#signup");</script></head>'],
    ],
    scripts: ['/account-auth.js'],
  });

  return screenResponse(html);
}
