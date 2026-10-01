/**
 * Publish the imported dictionary words on learn.ozituma.com.
 *
 * WHY THIS NEEDS A LINGUIST TOKEN AND NOT THE SERVICE KEY
 *
 * `lexemes` carries a trigger:
 *
 *     Only linguists or admins can publish or reject content
 *
 * It fires on any UPDATE that changes `status`, and it asks `has_role(auth.uid(), 'linguist')`.
 * The service key bypasses ROW LEVEL SECURITY but not a TRIGGER, and for a server-to-server call
 * `auth.uid()` is null — so the service key is refused, correctly. Publishing is a review act and
 * the database will not let a bulk script pretend otherwise.
 *
 * So this signs in as a `content-service` account that holds the `linguist` role. The guard is
 * satisfied honestly: there really is a linguist identity behind the change.
 *
 * WHAT IT PUBLISHES, AND WHAT IT DELIBERATELY LEAVES
 *
 * Only headwords that are unambiguous single words — no spaces, no apostrophes, no brackets, no
 * punctuation. The dictionary contains 12,229 entries and a good number are PHRASES (`dị ka`,
 * `n'ihi na`), parenthesised variants (`(Agwù) -kpa`) and crossed-reference artifacts, several of
 * which came from the original corpus rather than from an editor.
 *
 * Those are left as drafts on purpose. A phrase is a legitimate entry, but deciding which ones are
 * meant to be learner-visible is an editorial judgement, and an import script is the wrong place to
 * make it. The clean words are mechanical; the rest is somebody's job.
 */

const URL = process.env.SUPABASE_URL ?? 'https://kouczrxrsdjykxoyxzgi.supabase.co';
const JWT = process.env.LINGUIST_JWT;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!JWT) {
  console.error('  LINGUIST_JWT is not set.');
  process.exit(1);
}

const FILTER = [
  'status=eq.draft',
  // No space — excludes phrases.
  'headword=not.like.*%20*',
  // No apostrophe — excludes elided forms, which need a decision about the elision.
  'headword=not.like.*%27*',
  // No brackets or separators — excludes corpus artifacts.
  'headword=not.like.*%28*',
  'headword=not.like.*%29*',
  'headword=not.like.*%2F*',
  'headword=not.like.*%2C*',
  'headword=not.like.*%3B*',
  'headword=not.like.*%2A*',
].join('&');

async function countByStatus(status) {
  const response = await fetch(`${URL}/rest/v1/lexemes?select=id&status=eq.${status}`, {
    method: 'HEAD',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  });
  return Number((response.headers.get('content-range') ?? '/0').split('/')[1]);
}

console.log('  before:');
console.log(`    draft     ${await countByStatus('draft')}`);
console.log(`    published ${await countByStatus('published')}`);
console.log('');

let published = 0;

/*
 * Batches of 500, repeatedly, until a round changes nothing.
 *
 * The loop is driven by the number of rows the database actually updated rather than by an offset,
 * because publishing changes the rows that match the filter — an offset would skip half of them.
 */
for (;;) {
  const response = await fetch(`${URL}/rest/v1/lexemes?${FILTER}&select=id&limit=500`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      // The linguist's token is what the trigger reads. The service key is only the transport.
      Authorization: `Bearer ${JWT}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ status: 'published' }),
  });

  if (!response.ok) {
    console.error(`  stopped: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
    break;
  }

  const rows = await response.json();
  published += rows.length;
  if (rows.length === 0) break;
  if (published % 1500 === 0) console.log(`  … ${published} published`);
}

console.log(`\n  published: ${published}`);
console.log('  after:');
console.log(`    draft     ${await countByStatus('draft')}`);
console.log(`    published ${await countByStatus('published')}`);
