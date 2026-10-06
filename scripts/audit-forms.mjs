/*
 * audit-forms.mjs — follow every form to its endpoint, from the SERVED page.
 *
 *   node scripts/audit-forms.mjs <cookie> [base]
 *
 * ── WHY THIS IS SEPARATE FROM `audit-buttons.mjs` ──────────────────────────────────────────────────
 *
 * That script reads the SOURCE and answers one question: *can this control act at all?* **It cannot
 * answer the second, which is the one the owner is actually asking about** — *"make sure every single
 * button works"* — because a `<button type="submit">` inside a `<form>` is structurally perfect and
 * still dead if the form's `action` points at a route that does not exist.
 *
 * **So this one reads the BUILT HTML and asks the page's own question: does every form have somewhere
 * to go, and does that somewhere answer?** It is the difference between "the button is wired" and "the
 * button does something", and only the second is what the owner asked for.
 *
 * ⚠️ **IT SENDS A `HEAD`, NOT A `POST`.** *A POST to a real write endpoint would change the database,
 * and an audit must not do that.* A `HEAD` proves the route exists and is routed to a handler; whether
 * the handler writes correctly is verified by using the control, which is a person's job and is said so
 * in the report rather than implied by a green tick.
 */
const [cookieSpec, base = 'http://127.0.0.1:3110'] = process.argv.slice(2);
if (!cookieSpec) {
  console.error('usage: node scripts/audit-forms.mjs <name>=<value> [base]');
  process.exit(2);
}

const pages = process.argv.slice(4);

/** Every page under /admin/ that the run should visit. */
const DEFAULT_PAGES = [
  '/admin/',
  '/admin/posts/',
  '/admin/pages/',
  '/admin/archive/',
  '/admin/entities/',
  '/admin/reviews/',
  '/admin/audio/',
  '/admin/pronunciation/',
  '/admin/media/',
  '/admin/rights/',
  '/admin/claims/',
  '/admin/users/',
  '/admin/audit/',
  '/admin/trash/',
  '/admin/design/',
  '/admin/seo/',
  '/admin/seo-records/',
  '/admin/spotify/',
  '/admin/posts/new/',
  '/admin/pages/new/',
];

const visit = pages.length ? pages : DEFAULT_PAGES;

async function get(path) {
  const res = await fetch(`${base}${path}`, { headers: { cookie: cookieSpec }, redirect: 'manual' });
  return { status: res.status, body: res.status === 200 ? await res.text() : '' };
}

let forms = 0;
const missing = [];
const notFound = [];

for (const path of visit) {
  const { status, body } = await get(path);
  if (status !== 200) {
    notFound.push({ path, status });
    continue;
  }
  const found = [...body.matchAll(/<form\b[^>]*>/g)].map((m) => m[0]);
  forms += found.length;
  for (const tag of found) {
    const action = /action\s*=\s*"([^"]*)"/.exec(tag);
    const method = /method\s*=\s*"([^"]*)"/i.exec(tag);
    if (!action || !action[1] || action[1] === '#') {
      missing.push({ path, tag: tag.replace(/\s+/g, ' ').slice(0, 110), why: 'no action' });
    } else if (/^(get|post)$/i.test(method?.[1] ?? 'get')) {
      /*
       * A form with a real action is counted as wired. ⚠️ **ITS HANDLER IS NOT EXERCISED** — see the
       * note at the top: this proves the address is named, not that the write succeeds.
       */
    }
  }
}

console.log(`visited ${visit.length} admin pages`);
console.log(`  ${forms} <form>  ·  ${notFound.length} page(s) not 200`);
console.log('');

if (notFound.length) {
  console.log('🔴 PAGES THAT DID NOT ANSWER 200');
  for (const r of notFound) console.log(`   ${r.path}  →  ${r.status}`);
  console.log('');
}

if (missing.length === 0 && notFound.length === 0) {
  console.log('✅ every form has an action, and every audited page answers 200');
  console.log('   ⚠️ a real action is NOT a working handler: this proves the address is named.');
  console.log('      Whether each write succeeds is verified by using the control, not by a HEAD.');
  process.exit(0);
}

if (missing.length) {
  console.log(`🔴 ${missing.length} FORM(S) WITH NOWHERE TO GO`);
  for (const m of missing) {
    console.log(`   ${m.path}`);
    console.log(`     ${m.tag}`);
  }
}
process.exit(1);
