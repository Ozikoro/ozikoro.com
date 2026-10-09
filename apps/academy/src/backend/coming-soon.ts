/**
 * The launch gate.
 *
 * WHY THIS IS ANSWERED IN THE SERVER ENTRY RATHER THAN AS A ROUTE
 *
 * A gate that is a route is only a gate for requests that reach the router. This one runs before the
 * page handler, so no Academy page is rendered, no route loader runs and no server function is
 * reachable while the gate is closed — which is the difference between "the public sees a Coming Soon
 * page" and "the public can still fetch the pages behind it if they know the URL".
 *
 * WHAT IT DELIBERATELY DOES NOT BLOCK
 *
 *   `/api/health`  the container healthcheck. Gating it would mark a perfectly healthy container
 *                  unhealthy and get it restarted, which is a way to take the site down by hiding it.
 *   `/api/session` the family-session contract. It answers 401 to anyone without a valid cookie, so
 *                  it discloses nothing to the public, and closing it would break the shop and the
 *                  archive joining the shared sign-in — the thing they were built for.
 *   `/robots.txt`  answered rather than blocked, and answered with a blanket Disallow.
 *
 * WHY EVERY RESPONSE ALSO CARRIES NOINDEX
 *
 * robots.txt is a request, and a crawler that already indexed the site will not un-index it because a
 * file changed. `X-Robots-Tag` on the response is what actually removes a page, so it is set on every
 * gated response including the page itself.
 *
 * THE PAGE IS SELF-CONTAINED, AND THAT IS NOT LAZYNESS
 *
 * Styles and the mark are inlined rather than served from `/assets` and `/brand`, because those are
 * gated. A Coming Soon page that depends on a blocked stylesheet renders as unstyled text, and one
 * whose logo 404s is the first thing the public sees.
 */

/** The mark, inlined from the owner's master artwork at `public/brand/ozikoro-mark.svg`. */
const MARK = `<svg viewBox="0 0 534.79 282.88" role="img" aria-label="Ozikoro" focusable="false"><g fill="currentColor">
      <path d="M47.32,143.71c-2.94-.89-6-1.61-8.8-2.72-7.56-3-15.12-5.18-23.47-4.21-5.2.61-9.74-1.59-13.53-5-1.25-1.11-2.18-2.51-.92-4,1-1.26,2.45-1,3.81-.36,5.16,2.61,10.52,2.08,16,1.57,7.16-.67,14.22,0,20.81,3.22a29.92,29.92,0,0,0,9.53,2.67c4,.5,7.51.86,6.26,6.24s-5,3-8.22,2.73a11.18,11.18,0,0,1-1.39-.32Z" />
      <path d="M52.14,119.53c-2.67-1.47-5.45-2.79-8-4.45-6.7-4.41-13.57-8.14-22-8.91-5.25-.49-9.17-3.56-12.06-7.6-.95-1.33-1.53-2.88.08-4.12,1.32-1,2.66-.5,3.82.45,4.43,3.59,9.82,4.18,15.3,4.81,7.18.82,13.93,3,19.62,7.41a29.16,29.16,0,0,0,8.7,4.55c3.82,1.32,7.15,2.38,4.61,7.33s-5.64,1.91-8.72,1a10.68,10.68,0,0,1-1.29-.59Z" />
      <path d="M62.75,97.1c-2.25-2-4.66-3.82-6.73-5.95C50.53,85.5,44.7,80.48,36.63,78c-5-1.55-8.12-5.33-10-9.85-.61-1.49-.8-3.1,1.08-4,1.53-.7,2.73.07,3.64,1.22,3.46,4.39,8.61,6.07,13.83,7.81C52.05,75.48,58.15,79,62.64,84.42a28.13,28.13,0,0,0,7.42,6.21c3.44,2.06,6.44,3.78,2.75,8.05s-6,.68-8.79-.89A9,9,0,0,1,62.9,97Z" />
      <path d="M78.63,77.57c-1.73-2.38-3.64-4.66-5.15-7.15-4-6.61-8.5-12.67-15.81-16.75-4.55-2.53-6.67-6.83-7.38-11.58-.24-1.57,0-3.17,2-3.62,1.67-.37,2.66.62,3.27,1.92,2.33,5,7,7.66,11.66,10.42C73.41,54.43,78.54,59,81.61,65.27a26.86,26.86,0,0,0,5.77,7.54c2.87,2.7,5.39,5,.73,8.36s-6-.57-8.41-2.67a9.94,9.94,0,0,1-.89-1Z" />
      <path d="M99,61.93c-1.12-2.66-2.44-5.27-3.31-8-2.32-7.22-5.25-14-11.43-19.47-3.85-3.4-4.87-8-4.41-12.75.15-1.56.74-3.07,2.87-3.08,1.73,0,2.46,1.15,2.74,2.54,1.07,5.29,5,8.84,8.9,12.49,5.15,4.77,9.06,10.3,10.56,17a25,25,0,0,0,3.81,8.49c2.16,3.21,4.08,5.94-1.32,8.25s-5.8-1.8-7.59-4.32a8.38,8.38,0,0,1-.62-1.19Z" />
      <path d="M122.72,51c-.45-2.81-1.11-5.61-1.3-8.42-.51-7.47-1.73-14.66-6.46-21.22-2.94-4.08-2.83-8.74-1.22-13.25.53-1.48,1.48-2.82,3.57-2.4,1.7.35,2.13,1.63,2.07,3-.25,5.34,2.71,9.59,5.68,13.93,3.89,5.68,6.38,11.84,6.22,18.61a24,24,0,0,0,1.67,9c1.33,3.55,2.55,6.6-3.3,7.72s-5.25-2.94-6.4-5.75a10.41,10.41,0,0,1-.32-1.28Z" />
      <path d="M148.69,45.26c.24-2.8.27-5.65.77-8.41,1.32-7.35,1.88-14.56-1.16-21.88-1.9-4.56-.65-9.06,2-13.09.88-1.33,2.13-2.43,4.08-1.58,1.59.68,1.7,2,1.29,3.35-1.53,5.13.32,9.85,2.18,14.66,2.43,6.31,3.37,12.79,1.57,19.3a23.35,23.35,0,0,0-.55,9.07c.43,3.72.89,6.91-5.13,6.79s-4.43-3.93-4.87-6.88a9.4,9.4,0,0,1,0-1.3Z" />
      <path d="M175.54,45.09c.93-2.67,1.65-5.42,2.82-8,3.08-6.84,5.38-13.71,4.19-21.43-.75-4.8,1.57-8.89,5.18-12.25,1.18-1.1,2.68-1.91,4.39-.69,1.38,1,1.17,2.3.45,3.52-2.76,4.64-2.09,9.6-1.44,14.64.84,6.61.19,13.08-3.17,19a23.47,23.47,0,0,0-2.75,8.66c-.47,3.69-.81,6.88-6.68,5.52s-3.38-4.71-3.1-7.66a8.14,8.14,0,0,1,.32-1.27Z" />
      <path d="M513.1,162h-24V131.85a47.4,47.4,0,0,0-47.4-47.4H145.6a47.4,47.4,0,0,0-47.39,47.4V162h-24a21.69,21.69,0,0,0,0,43.37h24v30.13a47.4,47.4,0,0,0,47.39,47.4H441.7a47.4,47.4,0,0,0,47.4-47.4V205.35h24a21.69,21.69,0,0,0,21.69-21.68h0A21.69,21.69,0,0,0,513.1,162Zm-71.59,50.94H354.12V187.57H233.19v25.35H145.8V154.41h87.39v25.35H354.12V154.41h87.39Z" />
    </g></svg>`;

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ozikoro Academy — coming soon</title>
<meta name="description" content="Ozikoro Academy is being prepared. Structured courses in Igbo language, African history and cultural scholarship.">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="theme-color" content="#121a16">
<meta property="og:title" content="Ozikoro Academy — coming soon">
<meta property="og:description" content="Structured courses in Igbo language, African history and cultural scholarship.">
<meta property="og:type" content="website">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='10' fill='%23231f1c'/%3E%3C/svg%3E">
<style>
  /* The brand's own values, as literals: this page cannot read the stylesheet, because the
     stylesheet is behind the gate. oklch where the browser supports it, with a hex fallback. */
  :root {
    --night: #121a16;
    --night-soft: #1b2620;
    --gold: #c9a227;
    --gold-bright: #ddb02f;
    --on-night: #f4f1ea;
    --on-night-muted: #a9b0a8;
  }
  @supports (color: oklch(0.5 0.1 100)) {
    :root {
      --night: oklch(0.22 0.025 153);
      --night-soft: oklch(0.29 0.033 153);
      --gold: oklch(0.71 0.105 82);
      --gold-bright: oklch(0.8 0.11 83);
    }
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: var(--night);
    color: var(--on-night);
    font-family: "Trebuchet MS", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.6;
    padding: 2rem 1.25rem;
    /* A quiet radial so the page reads as designed rather than as a blank error. */
    background-image: radial-gradient(60rem 40rem at 50% -10%, color-mix(in oklab, var(--gold) 10%, transparent), transparent 70%);
  }
  main { width: 100%; max-width: 40rem; text-align: center; }
  .mark { width: 9.5rem; height: auto; color: var(--gold-bright); margin: 0 auto 2.25rem; display: block; }
  .eyebrow {
    margin: 0 0 1rem;
    color: var(--gold);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  h1 {
    margin: 0 0 1.25rem;
    font-family: Georgia, "Times New Roman", serif;
    font-size: clamp(1.9rem, 6vw, 3rem);
    font-weight: 400;
    line-height: 1.15;
  }
  h1 em { color: var(--gold-bright); font-style: normal; }
  p { margin: 0 auto 1rem; max-width: 34rem; color: var(--on-night-muted); font-size: 1.05rem; }
  .rule { height: 1px; width: 4rem; margin: 2.25rem auto; background: var(--gold); opacity: 0.7; }
  .sites { margin-top: 2rem; font-size: 0.85rem; color: var(--on-night-muted); }
  .sites a { color: var(--on-night); text-decoration: none; border-bottom: 1px solid var(--gold); padding-bottom: 1px; }
  .sites a:hover { color: var(--gold-bright); }
  .sites span { opacity: 0.5; margin: 0 0.6rem; }
  footer { margin-top: 3rem; font-size: 0.75rem; color: var(--on-night-muted); opacity: 0.75; }
  a:focus-visible { outline: 2px solid var(--gold-bright); outline-offset: 3px; }
</style>
</head>
<body>
<main>
  <span class="mark">MARK_SVG</span>
  <p class="eyebrow">Ozi Ikoro Limited</p>
  <h1>Ozikoro Academy is <em>being prepared</em>.</h1>
  <p>
    Structured courses in Igbo language, African history and cultural scholarship — with reviewed
    sources, practice, assessment and a record of what you have learned.
  </p>
  <p>The doors open soon.</p>
  <div class="rule" role="presentation"></div>
  <p class="sites">
    <a href="https://ozikoro.com">Ozikoro Archive</a><span>·</span><a href="https://ozituma.com">Ozituma Dictionary</a><span>·</span><a href="https://ndebe.org">&#323;d&#233;b&#233; Script</a>
  </p>
  <footer>&copy; 2026 Ozi Ikoro Limited. Knowledge carried forward.</footer>
</main>
</body>
</html>`.replace("MARK_SVG", MARK);

/**
 * Whether the gate is closed.
 *
 * Read on every request rather than captured at start-up, so the value can be changed and picked up
 * by a restart without a rebuild — and so a test can set it.
 *
 * It accepts the several spellings an operator will reach for, because a gate that silently stays
 * open because somebody wrote `TRUE` instead of `1` is worse than no gate: it looks like it worked.
 */
export function comingSoon(): boolean {
  const raw = (process.env.ACADEMY_COMING_SOON ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Responses from a gated site must not be indexed, whatever they are.
 *
 * `X-Robots-Tag` rather than the meta tag alone, because it applies to every response including
 * assets and the API, and because a crawler that has already indexed the site honours the header on
 * the next fetch where it would not necessarily re-read a robots.txt.
 */
export const NOINDEX = "noindex, nofollow, noarchive, nosnippet";

export function comingSoonPage(): Response {
  return new Response(PAGE, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": NOINDEX,
      // A gate is a security-relevant response: keep it out of any frame and stop a browser
      // guessing at a type it was not told.
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });
}

/**
 * `GET /robots.txt`, answered for both states.
 *
 * ANSWERED HERE RATHER THAN SHIPPED AS A FILE, AND THAT IS THE WHOLE POINT: Nitro serves everything
 * in `public/` before the server entry runs, so a static `robots.txt` made this function
 * unreachable. The gate was closed and the live file still said `Allow: /` — the exact failure a
 * launch gate exists to prevent, and invisible unless the file is fetched rather than assumed.
 *
 * Disallow while closed, the ordinary rules when open. Answered rather than 404'd in either case,
 * because a crawler that finds no robots.txt assumes everything is permitted.
 */
export function robotsTxt(): Response {
  const closed = comingSoon();

  const body = closed
    ? "User-agent: *\nDisallow: /\n"
    : [
        "User-agent: Googlebot\nAllow: /",
        "User-agent: Bingbot\nAllow: /",
        "User-agent: Twitterbot\nAllow: /",
        "User-agent: facebookexternalhit\nAllow: /",
        "User-agent: *\nAllow: /",
        "",
      ].join("\n\n");

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Never cached: this response changes meaning when the gate opens, and a cached
      // `Disallow: /` would keep the site out of search results after launch.
      "cache-control": "no-store",
      ...(closed ? { "x-robots-tag": NOINDEX } : {}),
    },
  });
}
