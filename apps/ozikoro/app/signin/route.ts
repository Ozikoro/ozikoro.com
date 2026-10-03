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
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const screen = join(process.cwd(), 'public', 'design', 'screens', 'account.html');
  let html = await readFile(screen, 'utf8');

  /*
   * signin.toUpperCase() OPENS IN ITS OWN MODE.
   *
   * The design decides its mode from `location.hash`, and its own "Create one" link sets that. **A reader who
   * arrives at /$addr directly has set no hash**, so the page would open on whichever mode the design calls
   * its default — which is signing in. The hash is therefore set once, before the wiring script runs, and the
   * design's own toggle does everything after that.
   */
  html = html.replace(
    '</head>',
    '<script>if(!location.hash)location.replace("#signin");</script></head>'
  );
  html = html.replace('</body>', '<script src="/account-auth.js" defer></script></body>');

  return new NextResponse(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
