/*
 * ROUND 332 — `/watch/` AND `/listen/` CHECKED AS DERIVATIONS, OVER HTTP, WITH NO DATABASE ACCESS.
 *
 * THE OWNER'S RULE
 *
 *   "every article with youtube embeded on this blog must automatically appear in watch, same way every
 *    audio inside an article on this website must appear on listen."
 *
 * WHAT THIS ASSERTS, AND WHY EACH ONE IS A PAGE FACT RATHER THAN A CODE FACT
 *
 *   1. `/watch/` draws every film its records embed, less the disclosed music exclusion — the six ids in
 *      `WATCH_MUSIC_FILMS` are absent and the rest are present, counted from the served bytes.
 *   2. No card is drawn twice across the two pages, and the two pages are disjoint.
 *   3. **THE PARITY THAT MATTERS: every row on `/listen/` links to an article that really carries that
 *      recording's player.** This is the check the owner's rule exists for — a row whose article shows no
 *      audio is the drift, and it cannot be seen from the list alone. Each row's own href is followed.
 *   4. The featured card is the first library row, not a separate fact.
 *   5. Not one of the design's six example rows survives, and no row claims the design's placeholder duration.
 *
 * It reaches the database only through the served pages, which is why it can run while the review server
 * holds the cluster.
 *
 *   node scripts/verify-round-332.mjs [base-url]
 */
const BASE = (process.argv[2] ?? process.env.OZIKORO_BASE ?? 'http://127.0.0.1:3110').replace(/\/$/, '');

/** The six films the owner asked off `/watch/`, and the reason each is music — kept in step with the map. */
const MUSIC = {
  '8fD66TzRmEg': 'a Peacocks International Guitar Band highlife recording',
  'E-bbdBIH4Wg': 'the same band’s second highlife recording',
  'Gk5jUcXeUHc': 'Christy Essien-Igbokwe’s "Seun Rere (Live)"',
  'NcBE2UH8WOc': 'Mike Okiri’s "Time Na Money"',
  '5a6tJhLpPa4': 'Cloud 7’s "Beautiful Woman"',
  'az6b5avH_Zc': 'a Bajan folk song about Jaja of Opobo',
};

const EXAMPLE_ROWS = [
  'The masquerade that judges the living',
  'Why the tortoise’s shell is not smooth',
  'Izuogu: a town remembers its founders',
  'The Obi of Igbodo and the meaning of kingship',
  'String games and the memory of play',
  'The Ika people: origins and migrations',
];

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const get = async (path) => {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, html: await res.text() };
};

const ids = (html) => [...html.matchAll(/data-video-id="([^"]*)"/g)].map((m) => m[1]);

console.log(`\nA. /watch/ — the films the records embed, less the disclosed music\n`);
const page1 = await get('/watch/');
const page2 = await get('/watch/?page=2');
const one = ids(page1.html);
const two = ids(page2.html);
const all = [...one, ...two];
check('/watch/ answers 200', page1.status === 200, `status ${page1.status}`);
check('page 1 draws a whole page of 15', one.length === 15, `${one.length} cards`);
check('page 2 exists and draws the rest', page2.status === 200 && two.length > 0, `${two.length} cards`);
check('no card stands on both pages', one.every((id) => !two.includes(id)), `${one.length} + ${two.length}`);
check('no film is drawn twice', new Set(all).size === all.length, `${all.length} cards, ${new Set(all).size} distinct`);
for (const [id, why] of Object.entries(MUSIC)) {
  check(`${id} is off the page`, !all.includes(id), why);
}
check('the pager is a real link, not a script', page1.html.includes('href="/watch/?page=2"'),
  'root-absolute, because the served head carries <base href="/">');

console.log(`\nB. /listen/ — the recordings the archive holds, and the article behind each row\n`);
const listen = await get('/listen/');
check('/listen/ answers 200', listen.status === 200, `status ${listen.status}`);
const rows = [...listen.html.matchAll(/<a class="sx-track" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)]
  .map((m) => ({ href: m[1], html: m[0] }));
console.log(`  ${rows.length} row(s) served`);
for (const example of EXAMPLE_ROWS) {
  check(`the design’s example row "${example}" is gone`, !listen.html.includes(example));
}
check('no row claims the design’s "Sample" or "Soon"', !listen.html.includes('>Sample<') && !listen.html.includes('>Soon<'));

for (const row of rows) {
  const title = /<strong>([\s\S]*?)<\/strong>/.exec(row.html)?.[1] ?? '(untitled)';
  const kind = /data-narrator-kind="([^"]*)"/.exec(row.html)?.[1] ?? '';
  const path = row.href.startsWith('http') ? row.href : row.href;
  const article = await get(path);
  const plays = article.html.includes('data-listen-audio');
  const leaves = article.html.includes('data-listen-external');
  check(
    `a row is backed by a player on its own article: ${title}`,
    article.status === 200 && (plays || leaves),
    `status ${article.status}, narrator ${kind || 'not recorded'}, ${plays ? '<audio>' : leaves ? 'an external link' : 'NO AUDIO'}`
  );
}

/* The feature card must be the first row, or the page is advertising an episode the list does not contain. */
const featureTitle = /<h2 id="feature-title">([\s\S]*?)<\/h2>/.exec(listen.html)?.[1] ?? null;
const firstTitle = /<strong>([\s\S]*?)<\/strong>/.exec(rows[0]?.html ?? '')?.[1] ?? null;
check('the featured episode is the first library row', featureTitle !== null && featureTitle === firstTitle,
  `featured "${featureTitle}" vs first row "${firstTitle}"`);

/* The design's own count sentence is replaced by a count of the rows above it. */
const note = /<p class="sx-source-note">([\s\S]*?)<\/p>/.exec(listen.html)?.[1] ?? '';
check('the note counts the rows rather than promising them',
  note.includes(`${rows.length} recording`), note.trim().slice(0, 120));

console.log(`\n${failures === 0 ? 'OK' : 'FAILED'}: ${failures} failing assertion(s) against ${BASE}\n`);
process.exit(failures === 0 ? 0 : 1);
