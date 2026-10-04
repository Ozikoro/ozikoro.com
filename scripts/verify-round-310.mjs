/*
 * verify-round-310.mjs — the researchers directory, read as TEXT rather than as a status code.
 *
 * WHY THIS EXISTS
 *
 * The owner's report was that `/researchers/` showed one person, and the page answered **HTTP 200** the
 * whole time it was wrong. A status code cannot see that a page about the archive's eleven authors
 * contains one card, so this prints what the served page actually says: the standing counts, every
 * person named, and the address each entry links to.
 *
 * TWO THINGS IT DELIBERATELY DOES
 *
 *   1. It strips HTML comments before reading. React interleaves `<!-- -->` between adjacent text
 *      nodes, so a naive regex over the response finds nothing where the page plainly has text — and
 *      a check that reads nothing looks exactly like a check that passed.
 *   2. It follows the links it finds. An entry that names a person and points at a 404 is not a
 *      directory, and the count of links is not the count of working ones.
 *
 * NO DATABASE, NO BUILD, NO DEPENDENCY OUTSIDE NODE. It only sends HTTP to a server already up.
 *
 * USAGE
 *   node scripts/verify-round-310.mjs                 # assumes http://127.0.0.1:3110
 *   PORT=4000 node scripts/verify-round-310.mjs
 */
const PORT = process.env.PORT ?? '3110';
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}`;

let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.log(`  FAIL  ${m}`); failures += 1; };
const info = (m) => console.log(`        ${m}`);

/** The readable text of a page, with comments, scripts and tags removed. */
function text(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&rsquo;|&#x27;|&#39;/g, "'")
    .replace(/&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&hellip;/g, '…')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every `<a href>` with the text it carries. */
function links(html) {
  const out = [];
  const re = /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push({ href: m[1], label: text(m[2]) });
  return out;
}

/** The cards of one grid, by the heading each carries. */
function cards(html, heading) {
  const at = html.indexOf(heading);
  if (at === -1) return null;
  // The grid that follows the heading, up to the next section.
  const rest = html.slice(at);
  const next = rest.slice(1).search(/<section\b/);
  const body = next === -1 ? rest : rest.slice(0, next + 1);
  const names = [...body.matchAll(/<h3>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/gi)]
    .map((m) => ({ href: m[1], name: text(m[2]) }));
  return { body, names };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
  return { status: res.status, html: await res.text() };
}

console.log(`verify-round-310 — the researchers directory at ${BASE}`);
console.log('');

// ---------------------------------------------------------------------------
// 1. The directory itself
// ---------------------------------------------------------------------------
const page = await get('/researchers/');
info(`GET /researchers/  HTTP ${page.status}`);
if (page.status !== 200) fail(`/researchers/ answered ${page.status}`);

const body = text(page.html);
const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(page.html);
info(`h1            ${h1 ? text(h1[1]) : '(none)'}`);
if (!h1 || text(h1[1]) !== 'Researchers') fail('the h1 does not read "Researchers"');

const standing = /(\d[\d,]*)\s+(person|people)\s+wrote\s([^.]*)\./.exec(body);
info(`counts        ${standing ? standing[0] : '(not found)'}`);
if (!standing) fail('the standing count of people and records is not on the page');

const writerGrid = cards(page.html, 'The people who wrote the archive');
const profileGrid = cards(page.html, 'Profiles published on Ozikoro');
if (!writerGrid) fail('the "people who wrote the archive" grid is missing');

console.log('');
console.log(`  writers named (${writerGrid ? writerGrid.names.length : 0}):`);
for (const w of writerGrid?.names ?? []) info(`${w.name.padEnd(28)} -> ${w.href}`);

console.log('');
console.log(`  research profiles named (${profileGrid ? profileGrid.names.length : 0}):`);
for (const p of profileGrid?.names ?? []) info(`${p.name.padEnd(28)} -> ${p.href}`);

console.log('');

/*
 * THE TWO NUMBERS, CHECKED SEPARATELY. The fault this round fixes was conflating "has a profile" with
 * "wrote the archive", so the check reads them as two facts rather than one total.
 */
const writers = writerGrid?.names.length ?? 0;
const profiles = profileGrid?.names.length ?? 0;
if (writers >= 11) ok(`${writers} people with published records are listed`); else fail(`only ${writers} writers are listed; the archive has 11 with published records`);
if (profiles >= 1) ok(`${profiles} published research profile is listed`); else fail(`only ${profiles} research profiles are listed; one account has published one`);

// Every writer's link must be a real page.
let broken = 0;
for (const w of writerGrid?.names ?? []) {
  const target = await get(w.href);
  if (target.status !== 200) { broken += 1; info(`${w.href} answered ${target.status}`); }
}
if (broken === 0) ok(`every writer entry links to a page that answers 200 (${writers} checked)`);
else fail(`${broken} writer links do not answer 200`);

// The one profile must be reachable from the directory.
const profileHrefs = (profileGrid?.names ?? []).map((p) => p.href);
if (profileHrefs.length > 0 && profileHrefs.every((h) => h.startsWith('/researchers/'))) {
  ok(`the profile entry links to its own page: ${profileHrefs.join(', ')}`);
} else {
  fail(`the profile entry does not link to a research profile page: ${JSON.stringify(profileHrefs)}`);
}
if (profileGrid && /No byline is linked to this profile yet/.test(text(profileGrid.body))) {
  ok('the page states that the archive does not link a byline to that profile');
} else {
  fail('the page does not state that the profile is unlinked to a byline');
}

// ---------------------------------------------------------------------------
// 2. The author page points back at the directory
// ---------------------------------------------------------------------------
const nze = await get('/author/nze/');
const back = links(nze.html).filter((l) => l.href === '/researchers/');
info(`GET /author/nze/  HTTP ${nze.status}; links back to /researchers/: ${back.length > 0 ? 'yes' : 'no'}`);
if (nze.status === 200) ok('the byline page answers 200');
else fail(`/author/nze/ answered ${nze.status}`);
if (back.length > 0) ok('the byline page links to the directory');
else fail('the byline page does not link to the directory');

// ---------------------------------------------------------------------------
// 3. The search box does something true
// ---------------------------------------------------------------------------
console.log('');
const hit = await get('/researchers/?q=Idenze');
const hitBody = text(hit.html);
const hitWriters = cards(hit.html, 'The people who wrote the archive')?.names.length ?? 0;
const hitProfiles = cards(hit.html, 'Profiles published on Ozikoro')?.names.length ?? 0;
info(`?q=Idenze   HTTP ${hit.status}; writers ${hitWriters}, profiles ${hitProfiles}`);
if (hitWriters + hitProfiles > 0 && hitWriters + hitProfiles < writers + profiles) {
  ok('a name search narrows the directory');
} else {
  fail(`a name search did not narrow the directory (writers ${hitWriters}, profiles ${hitProfiles} of ${writers} + ${profiles})`);
}
if (/entries match/.test(hitBody)) ok('the filtered page says how many entries match');
else fail('the filtered page does not state how many entries match');

const miss = await get('/researchers/?q=zzzz-no-such-name');
const missBody = text(miss.html);
info(`?q=zzzz-no-such-name   HTTP ${miss.status}; says: ${/Nothing matches/.test(missBody) ? 'Nothing matches' : '(no state)'}`);
if (/Nothing matches/.test(missBody)) ok('a search with no match says so rather than showing an empty directory');
else fail('a search with no match does not say so');

// The standing counts must not change under a filter: they are facts about the archive, not the page.
const missStanding = /(\d[\d,]*)\s+people\s+wrote\s([^.]*)\./.exec(missBody);
info(`counts while filtered   ${missStanding ? missStanding[0] : '(not found)'}`);
if (missStanding && standing && missStanding[1] === standing[1]) {
  ok('the counts stay the archive\'s own while a filter is active');
} else {
  fail('the standing counts changed when the directory was filtered');
}

console.log('');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
