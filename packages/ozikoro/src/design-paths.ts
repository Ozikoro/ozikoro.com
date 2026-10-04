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
