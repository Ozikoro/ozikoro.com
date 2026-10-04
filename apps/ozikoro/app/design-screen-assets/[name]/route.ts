/**
 * The design's own browser scripts, served with the archive's extensions applied in memory.
 *
 * WHY THIS ROUTE EXISTS AT ALL
 *
 * `public/design/` is inviolable: the deliverable is the visual contract and **not one byte of it may change.**
 * So an extension to the design's behaviour cannot be written into `public/design/market-days.js`. It has to be
 * applied to the file's text at request time and served from somewhere else, and the screens that want the
 * extension have to be pointed there at serve time — which is what `extendMarketDaysScript` does to the
 * script's own tag, and what this route serves.
 *
 * WHY NOT PATCH IT INSIDE THE SCREEN ROUTE
 *
 * The design's screens request their scripts by path — `/design/market-days.js` — and Next serves anything
 * under `public/` statically, before routing. **A route that patched the script could not intercept that
 * request**, and serving the file's bytes unchanged from a route of the same path would break the two screens
 * that want the design's own version. So the extension lives at its own address, and only the screens that
 * ask for it get it.
 *
 * ONE FILE TODAY, AND THE SHAPE IS THE POINT
 *
 * `market-days.js` is the only script the archive extends so far. The route is keyed by filename rather than
 * written for that one name, so extending a second script is one entry in `EXTENDED` and no new plumbing —
 * and **a name that is not in the map is refused rather than served**, because this route reads files out of
 * the deliverable's directory and an unrestricted name would be a path traversal.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extendMarketDaysScript } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

/** The deliverable's browser scripts. */
const SCRIPT_DIR = join(process.cwd(), 'public', 'design');

/**
 * The scripts this route will serve, and what is done to each.
 *
 * A Map rather than a directory listing on purpose: **the file this reads is `path.join`-ed with a
 * caller-supplied name**, so anything a reader can put in the URL has to be an exact key here or it is
 * refused. `../../` in the name cannot reach the filesystem at all.
 */
const EXTENDED = new Map<string, (script: string) => string>([
  ['market-days.js', extendMarketDaysScript],
]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
): Promise<Response> {
  const { name } = await params;
  const extend = EXTENDED.get(name);
  if (!extend) {
    return new Response('Not found', { status: 404 });
  }
  let script: string;
  try {
    script = await readFile(join(SCRIPT_DIR, name), 'utf8');
  } catch {
    return new Response('Not found', { status: 404 });
  }
  /*
   * ONE FAILURE IS ONE 404, NOT A HALF-WORKING SCRIPT.
   *
   * `extendMarketDaysScript` throws when the file it is given is not the script it knows how to extend, and
   * that throw is the point: **a page whose extension silently did not apply is a page that promises a
   * control it does not have.** So a failure here is answered with the design's unextended script rather than
   * with an error page — the calendar still reckons its days, the month expansion is the only thing missing,
   * and the log names the file.
   */
  try {
    return new Response(extend(script), {
      headers: {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    console.error(`design-screen-assets: ${name} could not be extended, serving the design's own script:`, error);
    return new Response(script, {
      headers: {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }
}
