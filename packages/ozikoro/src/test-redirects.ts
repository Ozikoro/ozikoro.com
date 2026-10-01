/**
 * Redirect-path safety.
 *
 * These are regression tests for a real open redirect, fixed in round 41 and left untested until
 * round 47. The cases that matter are the ones an obvious implementation gets wrong.
 *
 * Run with: npm -w @ozikoro/platform run test:redirects
 */
import { safeRedirectPath } from './redirects.ts';

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

console.log(`\n${failures === 0 ? '  All checks passed.' : `  ${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);
