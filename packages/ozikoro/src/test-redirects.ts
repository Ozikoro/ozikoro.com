/**
 * Redirect-path safety.
 *
 * These are regression tests for a real open redirect, fixed in round 41 and left untested until
 * round 47. The cases that matter are the ones an obvious implementation gets wrong.
 *
 * Run with: npm -w @ozikoro/platform run test:redirects
 */
import { safeRedirectPath, sameOrigin } from './redirects.ts';

let failures = 0;
const assert = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

console.log('\n--- absolute URLs are refused ---');
assert('https:// is refused', safeRedirectPath('https://evil.example/phish') === '/');
assert('http:// is refused', safeRedirectPath('http://evil.example/phish') === '/');
assert('a bare host is refused', safeRedirectPath('evil.example/phish') === '/');
assert('javascript: is refused', safeRedirectPath('javascript:alert(1)') === '/');
assert('data: is refused', safeRedirectPath('data:text/html,<script>') === '/');

console.log('\n--- protocol-relative, the case a naive check misses ---');
assert('//evil.example is refused', safeRedirectPath('//evil.example/phish') === '/');
assert('// alone is refused', safeRedirectPath('//') === '/');

console.log('\n--- backslashes, which some browsers normalise to slashes ---');
assert('/\\evil.example is refused', safeRedirectPath('/\\evil.example') === '/');
assert('a backslash anywhere is refused', safeRedirectPath('/admin/\\..\\evil') === '/');

console.log('\n--- legitimate paths are untouched ---');
for (const path of ['/', '/admin/', '/admin/archive/1/', '/submit/', '/search/?q=igbo', '/a-b_c.d']) {
  assert(`kept: ${path}`, safeRedirectPath(path) === path, safeRedirectPath(path));
}

console.log('\n--- awkward input does not become a hole ---');
assert('empty becomes root', safeRedirectPath('') === '/');
assert('whitespace becomes root', safeRedirectPath('   ') === '/');
assert('a padded absolute URL is still refused', safeRedirectPath('  https://evil.example  ') === '/');
assert('a padded relative path is trimmed and kept', safeRedirectPath('  /admin/  ') === '/admin/');

console.log('\n--- same-origin checks ---');

const req = (headers: Record<string, string>) => new Request('https://ozikoro.com/admin/', { method: 'POST', headers });

assert('a matching origin and host is allowed', sameOrigin(req({ origin: 'https://ozikoro.com', host: 'ozikoro.com' })) === true);
assert('a different host is refused', sameOrigin(req({ origin: 'https://evil.example', host: 'ozikoro.com' })) === false);
assert('a subdomain pretending to be the site is refused',
  sameOrigin(req({ origin: 'https://ozikoro.com.evil.example', host: 'ozikoro.com' })) === false);
assert('a port mismatch is refused', sameOrigin(req({ origin: 'https://ozikoro.com:8443', host: 'ozikoro.com' })) === false);
assert('a malformed origin is refused', sameOrigin(req({ origin: 'not a url', host: 'ozikoro.com' })) === false);
assert('an origin with no host header is refused', sameOrigin(req({ origin: 'https://ozikoro.com' })) === false);

/*
 * A MISSING ORIGIN IS ALLOWED — deliberate, and pinned here so it stays a decision rather than
 * becoming an accident. Browsers send Origin on the cross-site requests this guards; they do not send
 * it on same-origin navigations, and non-browser clients send nothing at all. Refusing those would
 * break legitimate use to defend against a request a browser would not make.
 */
assert('a missing origin is allowed, deliberately', sameOrigin(req({ host: 'ozikoro.com' })) === true);

/*
 * The scheme is NOT compared: only the authority is. Documented because it is a real property of this
 * implementation — `http://ozikoro.com` and `https://ozikoro.com` are treated as the same origin.
 * Acceptable here because the site is https-only behind HSTS and an attacker cannot set the header on
 * a victim's request; recorded so nobody assumes otherwise later.
 */
assert('the scheme alone does not decide it (documented behaviour)',
  sameOrigin(req({ origin: 'http://ozikoro.com', host: 'ozikoro.com' })) === true);

console.log(`\n${failures === 0 ? '  All checks passed.' : `  ${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);
