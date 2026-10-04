/*
 * verify-round-317.mjs — the contributor merge, read as TEXT from the served site.
 *
 * WHY THIS EXISTS
 *
 * `/author/ozikoro/` was merged into `/author/nze/` and the `ozikoro` contributor row deleted. Every one
 * of the pages involved answers **HTTP 200** while being wrong: `/author/ozikoro/` answered 200 with
 * three records before the merge and would have answered 200 with **zero** after it, because the route
 * calls `notFound()` only when the count is zero and a wrong byline renders perfectly. So this prints what
 * the pages actually say, and asserts the individual facts:
 *
 *   1. `/author/ozikoro/` is a **301** to `/author/nze/` — not a 200, not a 404.
 *   2. `/author/nze/` reports **188** records (185 + the three published ones) and names all three titles.
 *   3. `/researchers/` reports **ten** writers and no longer carries the `Ozi Ikoro` card.
 *   4. `/about/` reports `188 published histories` for Idenze Ezeme and no longer names Ozi Ikoro.
 *   5. An article page reads `By Idenze Ezeme`, not `By Ozi Ikoro`.
 *   6. `/admin/audit` is gated (307 to sign-in) and says so rather than being reported as broken — the
 *      audit rows themselves are read from the database, which cannot be opened while this server holds
 *      the cluster.
 *
 * NO DATABASE, NO BUILD, NO DEPENDENCY OUTSIDE NODE. It only sends HTTP to a server already up.
 *
 * USAGE
 *   node scripts/verify-round-317.mjs                 # assumes http://127.0.0.1:3110
 *   PORT=4000 node scripts/verify-round-317.mjs
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

const THREE = [
  ['king-idigo-and-the-encounter-with-christian-missionaries-in-19th-century-igboland',
    'King Idigo and the Encounter with Christian Missionaries in 19th-Century Igboland'],
  ['how-tortoise-got-his-bumpy-shell', 'How Tortoise Got His Bumpy Shell'],
  ['a-young-bride-and-the-marriage-tradition-of-awka-oka', 'A Young Bride and the Marriage Tradition of Awka (Ọka)'],
];

/*
 * "Ozi Ikoro" is THREE DIFFERENT THINGS and the check must not confuse them.
 *
 *   `Ozi Ikoro`                    the contributor's display name — **this is the one that is gone**
 *   `Ozi Ikoro Limited`            the company: masthead, footer, and half of `/about/`'s prose
 *   `Ozi Ikoro: the message…`      the `/about/` heading that explains the company's own name
 *
 * A naive `!text.includes('Ozi Ikoro')` fails on a CORRECT page — measured: 20 occurrences on `/about/`,
 * 19 of them `Ozi Ikoro Limited` and one the name-explainer heading. So the test strips the two legitimate
 * forms and asserts that no credited-person occurrence is left, and the byline-specific tests below (no
 * `/author/ozikoro/` link, no `N published histories` for it) carry the real weight.
 */
function onlyAsCompanyName(text) {
  const stripped = text
    .replace(/Ozi Ikoro Limited/g, '')
    .replace(/Ozi Ikoro: the message of the drum/g, '');
  return !stripped.includes('Ozi Ikoro');
}

async function body(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'follow' });
  return { status: res.status, html: await res.text() };
}

console.log(`\nverify-round-317 against ${BASE}\n`);

// 1. The retired byline address is a 301, not a 404 and not a 200.
console.log('--- /author/ozikoro/ is a 301 to /author/nze/ ---');
{
  const res = await fetch(`${BASE}/author/ozikoro/`, { redirect: 'manual' });
  const location = res.headers.get('location') ?? '';
  if (res.status === 301) ok(`301`);
  else fail(`expected 301, got ${res.status}`);
  if (location.endsWith('/author/nze/')) ok(`Location: ${location}`);
  else fail(`Location is "${location}", expected a path ending /author/nze/`);

  // The slash-less spelling WordPress never used must behave the same way.
  const bare = await fetch(`${BASE}/author/ozikoro`, { redirect: 'manual' });
  if (bare.status === 301) ok('301 for the slash-less spelling too');
  else fail(`slash-less spelling answered ${bare.status}, expected 301`);
}

// 2. The absorbing byline now lists 188, and every one of the three records renders the new byline.
console.log('\n--- /author/nze/ lists 188 records ---');
{
  const { status, html } = await body('/author/nze/');
  const t = text(html);
  if (status === 200) ok('200');
  else fail(`status ${status}`);
  const count = /"numberOfItems":(\d+)/.exec(html);
  if (count?.[1] === '188') ok('numberOfItems 188 (was 185)');
  else fail(`numberOfItems is ${count?.[1] ?? 'absent'}, expected 188`);
  if (/188 records in the archive/.test(t)) ok('the page says "188 records in the archive"');
  else fail('the page does not say "188 records in the archive"');
  /*
   * THE LIST IS PAGED AT 24 AND THE PAGE HAS NO PAGER, so only the newest of the three is on it. That is
   * the route's existing behaviour, not a fault of the merge — and asserting all three titles here would
   * fail on a correct server. The three titles are proved by fetching each record instead, below.
   */
  if (t.includes('King Idigo')) ok('lists the most recent of the three, "King Idigo…"');
  else fail('the most recent of the three is not listed');
  if (/Showing the first 24 of 188/.test(t)) ok('pagination reads "Showing the first 24 of 188"');
  else fail('pagination does not read "Showing the first 24 of 188"');

  for (const [slug, title] of THREE) {
    const record = await body(`/${slug}/`);
    const rt = text(record.html);
    if (record.status === 200 && rt.includes('By Idenze Ezeme') && !rt.includes('By Ozi Ikoro')) {
      ok(`"${title}" renders "By Idenze Ezeme"`);
    } else {
      fail(`"${title}" does not render the new byline (status ${record.status})`);
    }
  }
}

// 3. The directory lost exactly one writer, and it is the merged one.
console.log('\n--- /researchers/ lists ten writers, without the Ozi Ikoro byline ---');
{
  const { status, html } = await body('/researchers/');
  const t = text(html);
  if (status === 200) ok('200');
  else fail(`status ${status}`);
  const sentence = /\d+ (?:people|person) wrote[^.]*\./.exec(t);
  info(sentence?.[0] ?? 'no standing sentence found');
  if (/10 people wrote/.test(t)) ok('"10 people wrote" (was 11)');
  else fail('the page does not say "10 people wrote"');
  if (!t.includes('Ozi Ikoro 3 records')) ok('the "Ozi Ikoro — 3 records" entry is gone');
  else fail('the "Ozi Ikoro — 3 records" entry is still present');
  if (!/href="\/author\/ozikoro\//.test(html)) ok('no link to /author/ozikoro/ remains');
  else fail('the page still links to /author/ozikoro/');
  if (onlyAsCompanyName(t)) ok('"Ozi Ikoro" survives only as the company name "Ozi Ikoro Limited"');
  else fail('"Ozi Ikoro" appears somewhere other than as "Ozi Ikoro Limited"');
  if (/href="\/author\/nze\//.test(html)) ok('links to /author/nze/ are present');
  else fail('no link to /author/nze/ on the directory');
}

// 4. /about/ is design-filled from the same data and must agree.
console.log('\n--- /about/ shows Idenze Ezeme at 188, and no Ozi Ikoro byline ---');
{
  const { status, html } = await body('/about/');
  const t = text(html);
  if (status === 200) ok('200');
  else fail(`status ${status}`);
  if (/188 published histories/.test(t)) ok('"188 published histories" (was 185)');
  else fail('no "188 published histories" on the page');
  if (onlyAsCompanyName(t)) ok('"Ozi Ikoro" survives only as the company name "Ozi Ikoro Limited"');
  else fail('/about/ names Ozi Ikoro other than as "Ozi Ikoro Limited"');
  if (!/href="\/author\/ozikoro\//.test(html)) ok('no link to /author/ozikoro/ remains');
  else fail('/about/ still links to /author/ozikoro/');
}

// 5. A record's own page renders the new byline.
console.log('\n--- the record page reads "By Idenze Ezeme" ---');
{
  const { status, html } = await body('/king-idigo-and-the-encounter-with-christian-missionaries-in-19th-century-igboland/');
  const t = text(html);
  if (status === 200) ok('200');
  else fail(`status ${status}`);
  if (t.includes('By Idenze Ezeme')) ok('"By Idenze Ezeme"');
  else fail('the byline does not read "By Idenze Ezeme"');
  if (!t.includes('By Ozi Ikoro')) ok('no "By Ozi Ikoro"');
  else fail('the page still renders "By Ozi Ikoro"');
}

// 6. /admin/audit is gated, and a gate is not a fault.
console.log('\n--- /admin/audit refuses an anonymous reader (the gate working) ---');
{
  const res = await fetch(`${BASE}/admin/audit`, { redirect: 'manual' });
  const location = res.headers.get('location') ?? '';
  if (res.status === 307) ok('307');
  else fail(`expected 307 to sign-in, got ${res.status}`);
  if (location.includes('/signin')) ok(`Location: ${location}`);
  else fail(`Location is "${location}", expected a sign-in path`);
  info('the audit rows are read from the database, not from this page: it is gated on manage_users.');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
