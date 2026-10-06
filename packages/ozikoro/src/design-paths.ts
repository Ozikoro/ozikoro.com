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
 *
 * ── AND THE ONE THING THE `<base>` ITSELF BREAKS: EVERY IN-PAGE ANCHOR (round 338) ─────────────────
 *
 * A `<base href="/">` decides what a **fragment-only** address means as well as a filename, and the
 * answer is not the page you are on. `href="#series"` on `/watch/` is resolved against the base, so it
 * becomes `/#series` — **the front page** — and every skip link, every table of contents and every filter
 * row written as an in-page anchor stops at the site root instead of scrolling. Measured in Chrome, not
 * reasoned:
 *
 *     /watch/     #videos -> http://127.0.0.1:3110/#videos     (not /watch/#videos)
 *     /about/     #main   -> http://127.0.0.1:3110/#main
 *     /documents/ #library-> http://127.0.0.1:3110/#library
 *     /listen/    #episodes -> http://127.0.0.1:3110/#episodes
 *
 * **The base is not the fault and removing it is not the cure.** It is what makes the address a *script*
 * writes work: `mobile-nav.js` injects `<a href="igbo-calendar.html">` at run time, which nothing in the
 * served markup can rewrite, and the base is what resolves it to `/igbo-calendar.html` rather than to
 * `/watch/igbo-calendar.html`. So the fragment is made absolute instead — `#series` becomes
 * `/watch/#series` — which is the same fix as the filenames, applied to the one relative address form the
 * earlier rules did not reach.
 *
 * ── WHY IT NEEDS TO BE TOLD THE ADDRESS, AND WHY THE ADDRESS CARRIES THE QUERY ─────────────────────
 *
 * `#series` is only correct as `/watch/#series`. On the second page of an index it is `/watch/?page=2#series`,
 * and a rewrite that dropped the query would send a reader from page 2 back to page 1 — the fault in
 * miniature. So the caller passes **the address the page is served at**, query included, and the rule
 * is skipped when it is not given: a fill that writes `href="#series"` and then moves the section to
 * another page must still be able to find that anchor. The route passes it on its LAST call, after every
 * fill has run, which is the same reason the last call exists at all.
 */
export function designScreenLinks(html: string, at?: string): string {
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
     * `towns.html` IS THE MENU'S NAME FOR THE REGISTER, AND THE REGISTER HAS MOVED.
     *
     * **17 references across 14 of the deliverable's files** name `towns.html` — the masthead menu on
     * every screen, the front page, and the foot of the screens that list places. The design is inviolable,
     * so none of them can be edited; without this entry the generic fallback would resolve each one to
     * `/towns/`, which is now a 301 to the page. This entry makes it one hop, and it is the same treatment
     * `archive-index.html` and `dashboard-account.html` already get above.
     */
    'towns.html': '/clan-towns/',
    /*
     * `academy.html` IS THE MENU'S OWN NAME FOR THE ACADEMY, AND THE ACADEMY IS ANOTHER APPLICATION.
     *
     * **SIX OF THE DELIVERABLE'S SCREENS CARRY IT** — `404`, `academy`, `archive-index`, `publication`,
     * `researcher-profile` and `upload` — as the masthead item `<a href="academy.html">Academy</a>`. The
     * design is inviolable, so none of them can be edited.
     *
     * WITHOUT THIS ENTRY THE GENERIC FALLBACK BELOW RESOLVES EACH ONE TO `/academy/`, which is **the
     * address the owner retired** — and it would have kept working, in the way this project has learned
     * to distrust: the reader clicks `Academy`, gets a 301 they cannot see, and lands on the Academy
     * anyway. A link that works only because something else redirects it is a link whose destination is
     * not written down anywhere the next change would look, and `/academy/` is one commit away from
     * being a plain 404.
     *
     * So the menu's Academy item is the Academy's absolute address, one hop, which is the owner's own
     * instruction: *"move anyone that clicks on the academy on the top menu to academy.ozikoro.com."*
     * It is the same treatment `towns.html`, `archive-index.html` and `dashboard-account.html` get above.
     */
    'academy.html': 'https://academy.ozikoro.com/',
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
   * ── AND THE RETIRED ACADEMY HOST ────────────────────────────────────────────────────────────────
   *
   * `learn.ozituma.com` is being retired and `academy.ozikoro.com` replaces it, so the owner's
   * instruction is that the archive stops sending readers there: *"everything about learn.ozituma.com
   * should be removed entire. we have a new academy coming up which is academy.ozikoro.com, which will
   * replace learn.ozituma.com."*
   *
   * **SEVENTEEN OF THE FIFTY-TWO DESIGN SCREENS NAME IT, AND NOT ONE OF THEM CAN BE EDITED.** The files
   * under `public/design/` are inviolable — byte-identical to the deliverable — so the rewrite is here,
   * where the design's other addresses are already resolved at serve time. This is the same arrangement
   * the `../styles/…` rule above uses.
   *
   * ── WHY THE RULE ABOVE DID NOT ALREADY CATCH IT ─────────────────────────────────────────────────
   *
   * The screen-link pattern matches a `file.html` with a negative lookahead that skips anything beginning
   * `/` or `https:`, **and that lookahead is right**: an absolute address is already the address the
   * author meant. So every one of the design's `https://learn.ozituma.com/` anchors survived it.
   *
   * ── AN ANSWER FOR EACH OF THE THREE THINGS THE HOST IS DOING ────────────────────────────────────
   *
   *   1. A LINK, in the platform bar, the footer and the about screen's platform family. **It goes to
   *      `https://academy.ozikoro.com/` — the Academy itself, absolute, because it is a separate
   *      application on its own host and a same-site address cannot reach it.**
   *   2. A LABEL that named the host rather than the place — `learn.ozituma.com — Learn Igbo`. It becomes
   *      `Academy — Learn Igbo`, which is the word the archive's own masthead already uses for this.
   *   3. THE HOST NAMED IN PROSE — the footer's list of the platform's own domains, the academy screen's
   *      eyebrow, its course-lead line, its comparison table and its meta description. A bare name is not
   *      a link, so it cannot 404; it becomes `academy.ozikoro.com`, the announced replacement, rather
   *      than being deleted and leaving the sentence without a subject.
   *
   * ── THIS RULE USED TO POINT AT `/academy/`, AND THAT IS THE PART THAT CHANGED ────────────────────
   *
   * The addresses went to `/academy/` — **this archive's own interim page about the academy** — for a
   * reason that was recorded here in as many words: *"pointing a reader at `academy.ozikoro.com` today
   * would be a link to a host with no record in its zone."* **That was true when it was written and it
   * stopped being true**, which is the failure this repository keeps producing and the reason the
   * sentence is kept here rather than deleted: a reader of this file obeyed it for a day.
   *
   * Measured on 6 October 2026, from this checkout:
   *
   *     curl -sI https://academy.ozikoro.com/   →   HTTP/2 200, server: cloudflare
   *     its own <title>                         →   Ozikoro Academy — Igbo language, history and culture
   *
   * So the host answers, and the owner then asked for the interim page to go: *"delete this page
   * https://ozikoro.com/academy/ and move anyone that clicks on the academy on the top menu to
   * academy.ozikoro.com."* **THE TWO HALVES HAVE TO HAPPEN TOGETHER, and they do**: the addresses below
   * left `/academy/` in the same change that `apps/ozikoro/middleware.ts` stopped serving it, so no
   * served page on this site points at an address that is no longer a page. `/academy/` itself is retired
   * as a 301 to this host rather than as a 404, because it was a published address and the archive's own
   * rule is that an address once reachable keeps working.
   *
   * ── AND WHY THE PATH IS NOT CARRIED TO THE NEW HOST ─────────────────────────────────────────────
   *
   * The pattern captures a path, and it is discarded: every address is rewritten to the host's ROOT. That
   * is measured rather than assumed — **all twenty-seven occurrences of the retired host in the
   * deliverable are the bare `https://learn.ozituma.com/`**, so there is no path in the design to
   * preserve, and inventing one for a host whose routes this checkout cannot verify would be a link that
   * looks specific and lands on a 404. The Academy's home answers; a guessed sub-path might not.
   *
   * ORDERED, and the order is the rule. The label is rewritten first, or rule 3 would turn it into
   * `academy.ozikoro.com — Learn Igbo` and lose the place-name. The addresses go second, so that a
   * path-bearing address such as `https://learn.ozituma.com/practice` is caught whole. Rule 3 is last and
   * therefore only ever sees text.
   */
  out = out.replace(/>learn\.ozituma\.com — Learn Igbo</g, '>Academy — Learn Igbo<');
  out = out.replace(/href="https:\/\/learn\.ozituma\.com(\/[^"]*)?"/g, 'href="https://academy.ozikoro.com/"');
  out = out.replace(/learn\.ozituma\.com/g, 'academy.ozikoro.com');

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
   * AND THE ACADEMY ITEM, FOR THE SAME REASON AND ONE MORE.
   *
   * `academy.html` is the only screen whose masthead marks its own item current —
   * `<a href="academy.html" aria-current="page">Academy</a>` — which was true while the item pointed at a
   * page on this site. It now points at another application (see `screenLinks` above), so `aria-current`
   * would tell a screen reader *this is the page you are on* about a link that leaves the site. **The
   * marker is removed rather than re-pointed**, exactly as the `Researchers` rule above does it.
   */
  out = out.replace(
    /<a href="https:\/\/academy\.ozikoro\.com\/" aria-current="page">/g,
    '<a href="https://academy.ozikoro.com/">'
  );

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

  /*
   * AND EVERY IN-PAGE ANCHOR BECOMES AN ADDRESS ON THIS PAGE, BECAUSE THE `<base>` ABOVE WOULD SEND IT TO
   * THE SITE ROOT. The reasoning and the measurements are in this function's header; the shape is here.
   *
   * ONLY WHEN THE CALLER SAYS WHERE THE PAGE IS. `at` is `/watch/` or `/watch/?page=2`, and the fragment is
   * appended to it whole. Without `at` the addresses are left exactly as the design wrote them, which is what
   * lets `fillWatch` find `href="#series"` and move it to the page that actually draws that section.
   *
   * `#` ALONE IS NOT TOUCHED, and the reason is that it is not an anchor at all — it is the placeholder a
   * control with no destination is written as, and turning it into `/watch/#` would dress it up as a link to
   * a page rather than reporting it. Those are dealt with where they are: `fillDashboardLinks` makes them
   * inert, and the account screen's eighteen are handled one at a time in `lib/account-screen.ts`.
   */
  if (at) out = out.replace(/href="#([^"]+)"/g, (_m, fragment: string) => `href="${at}#${fragment}"`);

  /*
   * ── AND THE ONE FRAGMENT THAT NAMES A SECTION NO PAGE DRAWS ─────────────────────────────────────
   *
   * Fourteen of the design's screens link `about.html#access` — the footer's own *"Institutional access"*
   * under Research, a locked document's *"Request access"* on `/documents/`, and *"What the tier covers →"*
   * on the researcher profile — and **the deliverable's `about.html` has never carried `id="access"` or any
   * institutional-access section at all.** The page's only sentences about access are about a *record's*
   * terms ("Each record displays its own access and reuse terms", in Licensing) and a FAQ answer ("Some
   * research publications are access-controlled by their authors and can be requested"), which is a fact
   * about publications rather than a tier that opens culturally sensitive material.
   *
   * **SO THE ITEM IS WRONG AND THE PAGE IS NOT.** The archive holds no institutional-access tier; the honest
   * served page therefore offers no control that promises one. The alternative — rewriting the fragment to
   * `#faq` or `#terms`, which are the only ids near the subject — would be naming a section by a label it
   * does not carry: a reader who pressed *"Request access"* would land on a privacy notice. That is the same
   * fault as a dead fragment, one step later.
   *
   * IT IS HERE RATHER THAN IN A FILL because the addresses are written on fourteen different screens and in
   * the deliverable's own footer, and this is the one function every one of them passes through — the same
   * argument the `learn.ozituma.com` rewrite above makes for being here. **It is a link removal and not an
   * address rewrite, and that is the honest difference:** the other five of the design's six `about.html`
   * fragments name sections that exist, so `fillAbout` gives those sections the ids the design forgot; this
   * one names nothing, so the link goes.
   *
   * THE WHOLE ITEM GOES, NOT ONLY THE ANCHOR, where the link is a list item of its own footer column —
   * removing the `<a>` alone would leave an empty `<li>` and a gap in the column. It runs LAST so that the
   * bare `#access` a fill might write is caught too, after the rule above has made it absolute.
   */
  out = out.replace(
    /<li>\s*<a\b[^>]*\bhref="\/about\/#access"[^>]*>[\s\S]*?<\/a>\s*<\/li>|<a\b[^>]*\bhref="\/about\/#access"[^>]*>[\s\S]*?<\/a>/g,
    ''
  );

  return out;
}

/**
 * The design's own four-column foot, for the screens the deliverable drew without one.
 *
 * ── THE OWNER'S REPORT, AND WHAT WAS ACTUALLY THE MATTER WITH THE PAGE ─────────────────────────────
 *
 * *"also, add information on the footer shown here http://127.0.0.1:3110/cultural-calendar/"*
 *
 * Measured, the cultural calendar's footer is the deliverable's own:
 *
 *     <footer class="site-foot"><div class="wrap"><div class="legal">
 *       <span>© 2026 Ozi Ikoro Limited.</span>
 *       <span><a href="careers.html">Careers</a> · <a href="cite.html">Citation guide</a></span>
 *     </div></div></footer>
 *
 * — one line, two links, and the page ends. Every other screen in the same deliverable carries four
 * columns of the archive's own sections above that strip, so the calendar is not missing a *detail*; it is
 * missing the foot of the site. **That is the "information" he means**, and it is the reading the brief's
 * own rule supports: a page that looks unfinished at the bottom reads as a page nobody finished.
 *
 * ── WHICH FOOTER, AND WHY THAT ONE ────────────────────────────────────────────────────────────────
 *
 * The deliverable does not have one footer, it has three, and they are not identical:
 *
 *   * `home.html` — Archive · Research · Platform · Terms, twenty-two links
 *   * `about.html`, `donate.html`, `investors.html`, `ledger.html`, `projects.html`, `sponsors.html` —
 *     Discover · Participate · Support · Institution
 *   * six others — two links each
 *
 * **`home.html` IS THE ONE TAKEN, and it is taken from the file rather than retyped**: the constant below
 * is the front page's own `<div class="grid-4">`, byte for byte, and the test beside this file asserts that
 * it still is. Three reasons for that choice, in order of weight:
 *
 *   1. IT IS THE FRONT PAGE'S FOOTER. `/` is served from this same deliverable — the middleware rewrites
 *      it to `/design-screen/home` — so this is the footer a reader meets first and the one the site is
 *      already showing. Copying it produces a foot that exists at an address, not a new arrangement.
 *   2. IT IS THE ONLY ONE THAT NAMES THE SECTIONS THESE SCREENS BELONG TO. The columns that carry
 *      *Collections*, *Journeys & places*, *Topics A–Z* and *Clans and towns* are exactly the sections the
 *      screens with the thin footer sit in — the calendar, the library, the photograph and object
 *      collections, the clan and town register. The Discover/Participate family names none of them.
 *   3. IT IS THE LONGEST, so it is the one that leaves the least to add later. A footer that has to be
 *      widened twice is the fault this change exists to remove, one round on.
 *
 * ── WHY IT IS A COPY, AND WHY THE COPY IS ASSERTED RATHER THAN TRUSTED ────────────────────────────
 *
 * Reading `home.html` again on every request would be the tidier arrangement and it is the wrong one: this
 * function runs for all fifty-two screens, `home.html` is 18 KB, and a serve-time substitution is not a
 * build step. So the markup is a constant — **and a constant copied out of an inviolable file is a constant
 * that will one day disagree with it.** `design-paths.test.ts` therefore extracts the block from
 * `screens/home.html` and asserts it equals this one, which is the same arrangement `design-fill.test.ts`
 * uses for the design's own calendar script.
 *
 * ── WHAT IT DOES NOT DO, AND THAT MATTERS AS MUCH ─────────────────────────────────────────────────
 *
 *   * A SCREEN THAT ALREADY HAS THE COLUMNS IS LEFT ALONE. Thirteen of the deliverable's screens carry
 *     `grid-4` and would otherwise get a second copy of it.
 *   * A SCREEN WITH NO `<footer class="site-foot">` IS LEFT ALONE. `article.html`, the nineteen dashboards
 *     and the readers have no footer at all, and an article is not the page to grow the site's directory.
 *   * THE SCREEN'S OWN LEGAL STRIP STAYS, character for character. It is where the deliverable says what
 *     *this* screen's foot holds — *"Collections · Citation guide"* on the library, *"All projects · Public
 *     ledger"* on a project — and a reader who scrolls past four columns of the site's links is owed the
 *     two that belong to the page they are on. Only the columns are added.
 *
 * The links are the design's own relative addresses (`archive-index.html`, `towns.html`,
 * `learn.ozituma.com`) and this function does not resolve them: it runs before `designScreenLinks`, which
 * is the one place that job is done, so the injected foot is resolved by the same rules as every other
 * address on the page rather than by a second copy of them.
 */
const SITE_FOOTER_COLUMNS = `    <div class="grid-4">
      <div>
        <h4>Archive</h4>
        <ul>
          <li><a href="archive-index.html">All histories</a></li>
          <li><a href="folklore.html">Folklores &amp; myths</a></li>
          <li><a href="documents.html">Documents &amp; photographs</a></li>
          <li><a href="collections.html">Collections</a></li>
          <li><a href="journeys.html">Journeys &amp; places</a></li>
          <li><a href="topics.html">Topics A–Z</a></li>
          <li><a href="towns.html">Clans and towns</a></li>
          <li><a href="archive-index.html">Periods</a></li>
        </ul>
      </div>
      <div>
        <h4>Research</h4>
        <ul>
          <li><a href="researcher-profile.html">Researcher profiles</a></li>
          <li><a href="publications.html">Publications</a></li>
          <li><a href="upload.html">Publish your work</a></li>
          <li><a href="about.html#access">Institutional access</a></li>
        </ul>
      </div>
      <div>
        <h4>Platform</h4>
        <ul>
          <li><a href="https://ozituma.com/">Ozituma dictionary</a></li>
          <li><a href="https://learn.ozituma.com/">Learn Igbo</a></li>
          <li><a href="about.html">Ozi Ikoro Limited</a></li>
          <li><a href="careers.html">Careers</a></li>
          <li><a href="cultural-calendar.html">Cultural calendar</a></li>
          <li><a href="about.html#partners">Partners</a></li>
        </ul>
      </div>
      <div>
        <h4>Terms</h4>
        <ul>
          <li><a href="about.html#terms">Terms of use</a></li>
          <li><a href="about.html#privacy">Privacy</a></li>
          <li><a href="about.html#licensing">Licensing &amp; reuse</a></li>
          <li><a href="about.html#entrust">Entrusting material</a></li>
        </ul>
      </div>
    </div>
`;

/** The design's own footer element, as every screen that has one writes it. */
const SITE_FOOT = /<footer class="site-foot">[\s\S]*?<\/footer>/;

/**
 * The front page's own four columns, added to a screen whose footer is the legal strip and nothing else.
 *
 * THE SHAPE OF THE RULE IS THE POINT: it asks the document what its footer *is* rather than asking a list of
 * screen names which ones are thin, so a screen added to the deliverable is treated by what it contains. The
 * measured list — seventeen screens thin, thirteen with the columns, seventeen with no footer at all — is in
 * the round note in `docs/OZIKORO-REMAINING.md`, and it is a measurement of the deliverable rather than a
 * setting this function reads.
 */
export function withSiteFooter(html: string): string {
  const found = SITE_FOOT.exec(html);
  if (!found) return html;

  const footer = found[0];
  // Already the full foot. Adding to it would be a second set of columns.
  if (footer.includes('class="grid-4"')) return html;

  const legalAt = footer.search(/<div class="legal"/);
  // A `site-foot` with no legal strip is not one of the two shapes the deliverable draws; leave it be.
  if (legalAt === -1) return html;

  /*
   * `folklore.html` writes its strip as `style="margin-top:0"` — true while the strip is the whole footer,
   * and false the moment columns sit above it, because the rule that spaces the two apart is that margin.
   * It comes off with the change that makes it wrong, and only on the screens where the columns are added.
   */
  const tail = footer
    .slice(legalAt)
    .replace('<div class="legal" style="margin-top:0">', '<div class="legal">');

  return (
    html.slice(0, found.index) +
    footer.slice(0, legalAt) +
    SITE_FOOTER_COLUMNS +
    tail +
    html.slice(found.index + footer.length)
  );
}
