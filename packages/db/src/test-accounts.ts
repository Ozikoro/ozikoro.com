/**
 * Session cookie tests, and the one account across ozituma.com and learn.ozituma.com.
 *
 *   node packages/db/src/test-accounts.ts
 *
 * WHY THIS IS WORTH A FILE OF ITS OWN
 *
 * A browser silently discards a cookie whose Domain does not match the request, and logs nothing.
 * So every failure this covers looks identical from the outside — "sign-in does not work" — whether
 * the cause is a domain with a scheme in it, a leading dot on a single label, or a cookie shared
 * across two registrable domains where sharing is impossible.
 *
 * The last of those is the one that cannot be fixed by configuration, and it is asserted here so
 * the limit is recorded rather than rediscovered.
 */
import { normaliseCookieDomain, sessionCookieOptions, SESSION_COOKIE } from './accounts.ts';

let failures = 0;

function assert(label: string, condition: boolean, detail = ''): void {
  console.log(`  ${condition ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

console.log('\n--- Cookie domain: the values that work ---');

assert('a leading-dot domain is accepted', normaliseCookieDomain('.ozituma.com') === '.ozituma.com');
assert('a bare domain is normalised to leading-dot', normaliseCookieDomain('ozituma.com') === '.ozituma.com');
assert('surrounding whitespace is tolerated', normaliseCookieDomain('  ozituma.com  ') === '.ozituma.com');
assert('a hyphenated label is fine', normaliseCookieDomain('learn.ozituma.com') === '.learn.ozituma.com');
assert('a multi-label domain is fine', normaliseCookieDomain('ozituma.co.uk') === '.ozituma.co.uk');

console.log('\n--- Cookie domain: the values that would silently break sign-in ---');

assert('an empty value means "no domain", not a broken one', normaliseCookieDomain('') === null);
assert('undefined means "no domain"', normaliseCookieDomain(undefined) === null);
assert('a scheme is rejected', normaliseCookieDomain('https://ozituma.com') === null);
assert('a trailing slash is rejected', normaliseCookieDomain('ozituma.com/') === null);
assert('a port is rejected', normaliseCookieDomain('ozituma.com:3000') === null);
assert('a bare localhost is rejected — one label is not a shareable domain', normaliseCookieDomain('localhost') === null);
assert('a single label is rejected', normaliseCookieDomain('ozituma') === null);
assert('an internal space is rejected', normaliseCookieDomain('ozituma com') === null);
assert('a leading hyphen is rejected', normaliseCookieDomain('-ozituma.com') === null);

console.log('\n--- sessionCookieOptions wiring ---');

// Host-only by default: this is what every existing deployment already does, so the change is
// opt-in and cannot break a sign-in that works today.
delete process.env.OZITUMA_AUTH_COOKIE_DOMAIN;
process.env.OZITUMA_SITE_URL = 'https://ozituma.com';

const hostOnly = sessionCookieOptions(3600) as Record<string, unknown>;
assert('no domain by default, so the cookie stays host-only', hostOnly.domain === undefined);
assert('the cookie is httpOnly', hostOnly.httpOnly === true);
assert('the cookie is secure over https', hostOnly.secure === true);
assert('the cookie is sameSite lax', hostOnly.sameSite === 'lax');
assert('the cookie path is the whole site', hostOnly.path === '/');
assert('maxAge is passed through when given', hostOnly.maxAge === 3600);

process.env.OZITUMA_AUTH_COOKIE_DOMAIN = '.ozituma.com';
const shared = sessionCookieOptions() as Record<string, unknown>;
assert('the domain is applied when configured', shared.domain === '.ozituma.com');
assert('and no maxAge is set for a session cookie', shared.maxAge === undefined);

// A malformed value must fall back rather than producing a cookie no browser will store.
process.env.OZITUMA_AUTH_COOKIE_DOMAIN = 'https://ozituma.com';
const malformed = sessionCookieOptions() as Record<string, unknown>;
assert('a malformed value degrades to host-only rather than breaking sign-in', malformed.domain === undefined);

delete process.env.OZITUMA_AUTH_COOKIE_DOMAIN;

console.log('\n--- The account is one row, shared by both hosts ---');

// One account table, one session table, one cookie name. Both hostnames read the same rows, which
// is what makes "an account created on either works on both" true rather than aspirational.
assert('the session cookie has one name, so both hosts read the same one', SESSION_COOKIE === 'ozituma_session');

console.log('\n--- The limit that no configuration can cross ---');

// A cookie can only be shared within ONE registrable domain. ozikoro.com and ozituma.com are
// different registrable domains, so no Domain value spans them and a browser will not send one
// cookie to both. Asserted so the constraint is recorded next to the code that looks like it
// should be able to do this.
const registrable = (host: string) => host.split('.').slice(-2).join('.');
assert(
  'learn.ozituma.com and ozituma.com share a registrable domain, so a cookie can span them',
  registrable('learn.ozituma.com') === registrable('ozituma.com')
);
assert(
  'ozikoro.com and ozituma.com do NOT, so no cookie can span them',
  registrable('ozikoro.com') !== registrable('ozituma.com')
);
assert(
  'a cookie set for .ozituma.com would therefore never reach ozikoro.com',
  !'ozikoro.com'.endsWith('ozituma.com')
);

console.log(`\n${failures === 0 ? 'ALL ACCOUNT COOKIE CHECKS PASSED' : `${failures} ACCOUNT COOKIE CHECKS FAILED`}\n`);
process.exitCode = failures === 0 ? 0 : 1;
