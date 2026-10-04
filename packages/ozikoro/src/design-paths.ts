/**
 * The design's own scripts, at the path they are actually served from.
 *
 * ── THE FAULT THIS EXISTS TO MAKE IMPOSSIBLE ─────────────────────────────────────────────────────
 *
 * The design's screens load their behaviour with sibling references:
 *
 *     <script src="../reader.js"></script>
 *     <script src="../mobile-nav.js" defer></script>
 *     <script src="../market-days.js" defer></script>
 *
 * Those are correct **relative to the deliverable's own address** — `/design/screens/article.html` — and wrong
 * at every clean address this site serves a screen from, because the same link resolves one level shallower.
 * At `/how-tortoise-got-his-bumpy-shell/`, `../reader.js` asks for `/reader.js`, which does not exist.
 *
 * **The page is correct and the control is dead.** `reader.js` is the article's share button, its copy-link
 * button, its print button and its browser read-aloud control — four controls, one missing file, and a 200 on
 * every one of 1,051 records. The calendar sat on "Today — Loading date…" for the same reason.
 *
 * ── WHY IT IS ONE FUNCTION AND NOT TWO LINES ─────────────────────────────────────────────────────
 *
 * It was fixed once, in `design-screen/[screen]/route.ts`, and **the article screen is a different route that
 * had no copy of it** — so the article kept the fault through the fix that was meant to remove it. That is not
 * carelessness that a note would have prevented; it is two routes independently responsible for the same rule.
 * A shared function is the only arrangement in which they cannot disagree, and the test beside this file
 * asserts the pair that a second copy would break.
 *
 * The rule is deliberately narrow — **a bare sibling filename, with no path segment in it** — because that is
 * the entire grammar the deliverable uses for its own scripts. Anything already rooted, such as
 * `/design/styles/main.css` or a script this archive injects, is left exactly as it is.
 */
export function designScriptPaths(html: string): string {
  return html.replace(/src="\.\.\/([^"/]+\.js)"/g, 'src="/design/$1"');
}

/**
 * The design's own relative LINKS and STYLESHEETS, at the addresses this site actually serves.
 *
 * ── THE SAME FAULT AS THE SCRIPTS, ONE ELEMENT OVER ─────────────────────────────────────────────
 *
 * Every screen writes its menu the way the walkthrough needs it — a bare sibling filename, `home.html`,
 * `archive-index.html`, `listen.html` — because in the deliverable those files sit beside each other in
 * `public/design/screens/`. Served at `/<name>/` the browser resolves them against `/<name>/` instead,
 * so a control that reads as working answers with a 404. **Measured on the served pages, 4 October
 * 2026: 29 of the 52 screens carried a relative link and 316 anchors between them** — `/about/`
 * alone resolves 42 — and the eleven role dashboards refuse a signed-out reader, so the true count is
 * higher than 29. The addresses are `/about/listen.html`, `/folklore/listen.html`,
 * `/cultural-event/article.html`, `/oral-recordings/listen.html` and the rest of the same shape.
 *
 * **AND THE DESIGN'S OWN TRANSCRIPT CONTROL IS ONE OF THEM.** `screens/listen.html` writes
 * `<a class="btn btn-ghost" href="article.html">Read the transcript</a>`, which on a screen with no
 * `<base>` and no rewrite resolves one level too deep. That is the owner's report — a transcript
 * control that answers with nothing — and it is a class of fault rather than one control.
 *
 * ── WHY A `<base>` AND A REWRITE, AND WHY BOTH ──────────────────────────────────────────────────
 *
 * A `<base href="/">` is the one line that makes every relative address on the screen resolve against
 * the site root, which is what the deliverable's own sibling grammar means once it is served. The
 * rewrite beside it makes the same addresses **absolute in the served HTML**, so a reader of the
 * markup — a crawler, or the owner looking at source — sees the address a browser will actually get.
 * Neither touches a byte of the deliverable.
 *
 * ── WHY IT TAKES NO SCREEN NAME, AND WHY IT IS CALLED TWICE ─────────────────────────────────────
 *
 * Nothing here depends on which screen is being served, which is exactly what makes it usable as the
 * LAST pass of a request: **the fills write relative addresses of their own.** `/publication/` carried
 * `cite.html`, `publications.html` and `upload.html`; `/researcher-profile/` carried two of them; all
 * were written by a fill, all resolved one segment too deep, and a rule that ran only before the fills
 * would walk past every one. This is the lesson the market-days script rewrite already records in the
 * route: a rewrite that runs before a fill misses everything the fill writes, and by the time this
 * runs a link is a link whether the design wrote it or a fill did.
 *
 * It is idempotent, so being called twice costs nothing: the `<base>` is added only when the document
 * has none — a second one would silently change what every relative address on the page means, since
 * the last base wins — and every rewrite is anchored on a relative form the first pass removed.
 */
export function designScreenLinks(html: string): string {
  let out = html;

  // THE `<base>` IS ADDED ONCE. This runs early and again late in the same request, and two `<base>`
  // elements would leave the last one deciding every relative address on the page.
  if (!/<base\s/i.test(out)) out = out.replace(/<head>/, '<head><base href="/">');

  // `../styles/main.css` and `../screens/style.css` -> `/styles/main.css`. The deliverable's own assets
  // live under `/design/`, and `next.config.ts` rewrites `/styles/…` to them.
  out = out.replace(/href="\.\.\/((?:styles|screens)\/[^"]+)"/g, 'href="/$1"');

  /*
   * EVERY OTHER `../` IS A FILE BESIDE THE SCREENS, SO IT BELONGS AT `/design/…`.
   *
   * `screens/` is one directory inside `public/design/`, so a sibling reference is a reference to
   * `/design/<file>` — that is the whole meaning of the `..`. Two of them are live on served screens and
   * neither resolved:
   *
   *   `../downloads/research-download-demonstration.pdf`  on `/documents/`, the download itself. The
   *        file answers 200 at `/design/downloads/…` and 404 at `/downloads/…`, so the design's own
   *        download link was dead — and a `<base href="/">` alone would only have made it dead at a
   *        tidier address.
   *   `../index.html`  on `/type-test/`, the walkthrough's own index. It is not an address this site
   *        serves any more — the walkthrough is closed — so it points at the site's home, which is the
   *        same screen filled.
   *
   * The styles rule above runs first and has already rewritten what it owns, so this one only ever sees
   * the leftovers and cannot shorten an address that is already absolute.
   */
  out = out.replace(/href="\.\.\/index\.html"/g, 'href="/"');
  out = out.replace(/href="\.\.\/([^"]+)"/g, 'href="/design/$1"');

  /*
   * THE RELATIVE SCREEN LINKS BECOME THE ADDRESSES THE SITE ACTUALLY SERVES.
   *
   * Each entry is a design screen whose own page is not the page the link promised: the design's
   * `dashboard-account.html` IS the account screen, and its address on this site is `/account/`.
   * **`/dashboard-account/` also answers — it serves the design's screen — so a generic rewrite would
   * look as though it worked while sending every "Account settings" link on the site to a dashboard
   * instead of to the account.**
   */
  const screenLinks: Record<string, string> = {
    'home.html': '/',
    'dashboard-account.html': '/account/',
    'dashboard-states.html': '/dashboard-states/',
    // The design's own name for the archive index is not an address this site serves. `/archive-index/`
    // answers only because the middleware rewrites it to this route — **a link that reaches the design
    // screen rather than the archive**, and the archive's own page is one segment away.
    'archive-index.html': '/archive/',
    /*
     * `researcher-profile.html` IS ONE PERSON'S PAGE AND EVERY LABEL ON IT IS A DIRECTORY'S.
     *
     * The design's profile screen is a demonstration of a profile, and the person in it — "Dr Chinwe
     * Ị̀kẹ̀jìànị̀", with an invented institution, ORCID and seven papers — does not exist. `fillResearcherProfile`
     * serves that screen as **one real contributor**, which is right for a profile and wrong for a directory.
     *
     * Measured across the deliverable: **twenty anchors in nine screens name this file, and seventeen of them
     * say *Researchers*, *Researcher profiles* or *Researchers and publications*.** The directory's address is
     * `/researchers/`, it is served by the application's own route, and the design's own breadcrumb already
     * points there (`fillResearcherProfile` writes it). Without this entry the fallback below resolved all
     * seventeen to `/researcher-profile/` — **which answers 200 with one stranger's profile.** That is the
     * owner's report: "on the menu, the 'Researchers' is not working, it is dead link." It was not dead. It
     * reached the wrong page, and a 200 is what let it survive every check.
     *
     * The remaining three anchors name the design's example person: two bylines and a citation on the design's
     * one publication record. They resolve here with the rest, because **the archive holds no such person and
     * a link to the directory is honest where a link to a stranger is** — and on the screen they are written
     * on, `fillPublicationRecord` removes them outright: there is no publication to carry a byline or a
     * citation, and the page says so.
     */
    'researcher-profile.html': '/researchers/',
  };
  /*
   * THE SUFFIX IS CARRIED, AND THAT IS NOT A DETAIL.
   *
   * The design links to `about.html#terms` thirteen times, `upload.html#community-knowledge` three times and
   * `projects.html?status=ongoing` once. The earlier pattern required the closing quote straight after
   * `.html`, so **every one of those links kept its relative address** — and once the served page's head lost
   * its `<base>` (see `withSeoHead`), they resolved to `/archive-index/about.html#terms` and 404'd while
   * looking exactly like working links in the source.
   *
   * The fragment or query is preserved and appended to the resolved address, because `upload.html#community-knowledge`
   * promises a *section of the upload page* and dropping the fragment would land the reader at the top of it.
   *
   * AND `action` IS MATCHED BESIDE `href`, BECAUSE THE DELIVERABLE'S FORMS ARE WRITTEN THE SAME WAY.
   * Ten screens carry a search or filter `<form action="archive-index.html" method="get">` — and an
   * `action` is a relative address with the same grammar and the same meaning. Leaving it out would send
   * every search through a 301 whose query survives only because this file happens to preserve it: the
   * form would work by accident, on a redirect, for `GET` only. It is rewritten here so it works by
   * construction, at the address itself.
   */
  out = out.replace(
    /(href|action)="(?!\/|https?:|#|mailto:|tel:)([a-z0-9-]+\.html)((?:[?#][^"]*)?)"/g,
    (_m, attr: string, file: string, suffix: string) =>
      `${attr}="${screenLinks[file] ?? `/${file.replace(/\.html$/, '')}/`}${suffix}"`
  );

  /*
   * AN `aria-current="page"` THAT NAMES ANOTHER PAGE GOES.
   *
   * The rule above has just turned the nav's `Researchers` item into a link to `/researchers/` — **the
   * application's directory, which no design screen serves.** Three of the design's screens had marked that
   * item `aria-current="page"`: `publication.html`, `researcher-profile.html` and `upload.html`. The marker
   * was already untrue on the first two, which are a publication record and the deposit form, and it is
   * untrue on the third for the same reason the owner reported the link: `/researcher-profile/` is one
   * person's page, not the directory.
   *
   * `aria-current="page"` means *this link is the page you are on*. A screen reader announces it as the
   * current page, so a marker left on a link that leaves the page is a lie told only to the readers who
   * cannot see that the page did not change. It is removed rather than re-pointed or weakened: the design's
   * menu has no item for a profile, a record or the deposit form, so on those three screens **no item is
   * current, and the honest nav says nothing.**
   */
  out = out.replace(/<a href="\/researchers\/" aria-current="page">/g, '<a href="/researchers/">');

  /*
   * AND THE ONE META REFRESH, WHICH IS AN ADDRESS LIKE ANY OTHER.
   *
   * `screens/oral-recordings.html` is a notice — *"Oral recordings are now in Ozikoro Listen"* — and it
   * carries the move as `<meta http-equiv="refresh" content="0;url=listen.html">`. **The file is not a
   * page a reader visits: it redirects, so the relative address is the whole of what it does.** With the
   * `<base>` above a browser resolves it to `/listen/` and it works — measured in Chrome — and it is
   * rewritten anyway, because the guarantee this function makes is that a served page carries the address
   * a reader will actually get. A bare `listen.html` inside a `<meta content>` is the same relative
   * address the rest of the page has just stopped carrying, and a guarantee with one exception in it is
   * the kind that is believed and then broken by the next screen added.
   */
  out = out.replace(/<meta\b[^>]*http-equiv="refresh"[^>]*>/gi, (tag: string) =>
    tag.replace(
      /(content="[^"]*?url=)([^"';]+)(")/i,
      (whole: string, before: string, target: string, after: string) => {
        const address = target.trim();
        if (/^(\/|https?:|#)/.test(address)) return whole;
        return `${before}${screenLinks[address] ?? `/${address.replace(/\.html$/, '')}/`}${after}`;
      }
    )
  );

  return out;
}
