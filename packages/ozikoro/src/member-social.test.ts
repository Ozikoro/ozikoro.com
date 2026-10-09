/**
 * What a social handle may be, and what an address is built from.
 *
 * ── WHY THIS IS A TEST AND NOT A COMMENT ─────────────────────────────────────────────────────────────
 *
 * The owner asked for *"social media networks username"*, and the naive way to build that is to store what
 * was typed and put it in an `href`. **That is a stored-XSS and open-redirect surface in one field**, and it
 * is the kind of fault that reads as correct in review: the code is one line, the value looks like a username
 * in the database, and nothing fails until somebody types `javascript:`.
 *
 * The design that avoids it is stated in the module header — *the reader supplies a HANDLE, the address is
 * built from a constant host, and a value that cannot be addressed renders as text rather than as a link* —
 * and **a security rule that has never been executed is a claim rather than a rule.** So the hostile values
 * below are driven through the actual functions, and the address is asserted to be null or to begin with the
 * constant host. Nothing here asserts that a value was "escaped"; escaping is a different mechanism and the
 * renderer does that too. This asserts the stronger property: **the value never becomes the destination.**
 *
 * ⚠️ `example.invalid` IS USED FOR EVERY HOST-SHAPED HOSTILE VALUE, per this project's rule that a reserved
 * TLD is used rather than a name that might belong to somebody. No real person's handle appears anywhere in
 * this file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SOCIAL_NETWORKS,
  SOCIAL_USERNAME_PATTERN,
  isValidSocialUsername,
  normaliseSocialUsername,
  socialHref,
  socialNetwork,
  socialUsernameProblem,
} from './member-social.ts';
import { sameOriginPortrait } from './publications.ts';

test('every network builds an address on a constant host', () => {
  for (const network of SOCIAL_NETWORKS) {
    const href = socialHref(network.key, 'ozikoro');
    assert.ok(href, `${network.key} should address a plain handle`);
    assert.ok(
      href!.startsWith('https://'),
      `${network.key} must be an absolute https address, got ${href}`
    );

    /*
     * THE ASSERTION THAT MATTERS: THE HANDLE IS APPENDED TO A FIXED PREFIX, NOT PREPENDED TO A SUFFIX.
     * If a template were ever written the other way round — `handle + '.' + host` — a handle containing a
     * dot could move the address to another host while still "containing" ours. Asserting the href ENDS
     * with the handle and nothing follows it is what rules that out.
     */
    assert.ok(
      href!.endsWith('/ozikoro') || href!.endsWith('/@ozikoro'),
      `${network.key} must place the handle at the END of the address, got ${href}`
    );
  }
});

test('a hostile value is refused, and every refusal is null rather than a rewritten value', () => {
  const hostile = [
    // Script in the archive's own origin — the classic.
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    // A pasted address, i.e. a reader supplying the destination.
    'https://evil.example.invalid/phish',
    '//evil.example.invalid',
    // An attribute break, for the renderer's sake as well as ours.
    '" onmouseover="alert(1)',
    "' onfocus='alert(1)",
    // A second host smuggled into a path, which is how a Mastodon-shaped value escapes a constant host.
    'user@evil.example.invalid',
    // Characters that end or alter a URL.
    'a/b', 'a?b', 'a#b', 'a\\b', 'a b',
    // Traversal-shaped, and refused by the first/last-character rule.
    '..', '.hidden', '-x', 'x-',
    // Empty and whitespace-only: "nothing to store" rather than a value.
    '', '   ', '@',
  ];

  for (const value of hostile) {
    for (const network of SOCIAL_NETWORKS) {
      const href = socialHref(network.key, value);
      /*
       * `null` for an empty value is correct and is not a refusal to be relaxed: the caller reads it as
       * "remove the row". What must never happen is a non-null href built from one of these.
       */
      if (normaliseSocialUsername(value) === null) {
        assert.equal(href, null, `${network.key} + ${JSON.stringify(value)} must not address anything`);
        continue;
      }
      assert.equal(
        href,
        null,
        `${network.key} + ${JSON.stringify(value)} produced ${href} — a reader-supplied value became a destination`
      );
    }
  }
});

test('a value that DID reach the table unaddressed renders as text, not as a link', () => {
  /*
   * THIS IS THE FAILING-SAFE CASE THE CONSTRAINT CANNOT COVER, and the reason `socialHref` re-validates
   * rather than trusting its caller. A row written before migration 0067 existed, or written by a script
   * that never read the module, is still a row a page has to draw. `null` means the renderer emits the
   * handle with no `<a>` around it — the profile still draws and the handle is still visible.
   */
  assert.equal(socialHref('x', 'javascript:alert(1)'), null);
  assert.equal(socialHref('x', 'https://evil.example.invalid'), null);
  assert.equal(socialHref('x', 'user@evil.example.invalid'), null);
});

test('an unknown network is not addressable, whatever the handle', () => {
  // `mastodon` is deliberately absent from the list — see the module header for why its address cannot be
  // built from a constant. A row naming it must not render as a link.
  assert.equal(socialNetwork('mastodon'), undefined);
  assert.equal(socialHref('mastodon', 'ozikoro'), null);
  assert.equal(socialHref('', 'ozikoro'), null);
  assert.equal(socialHref('X', 'ozikoro'), null, 'the lookup is by the stored key, not by a label');
});

test('a leading @ is stripped, because that is what a person types', () => {
  assert.equal(normaliseSocialUsername('@ozikoro'), 'ozikoro');
  assert.equal(normaliseSocialUsername('  @@ozikoro  '), 'ozikoro');
  assert.equal(socialHref('x', '@ozikoro'), 'https://x.com/ozikoro');
  // And it is NOT stored, so a network whose template adds its own @ does not become @@.
  assert.equal(socialHref('youtube', '@ozikoro'), 'https://www.youtube.com/@ozikoro');
});

test('nothing is silently "fixed": an invalid handle is reported, never rewritten into a valid one', () => {
  /*
   * The fault this pins is the opposite of the security one and just as bad: a field that quietly changes
   * what you typed and saves something else. `normaliseSocialUsername` removes a leading `@` and NOTHING
   * else — no stripping of a colon, no truncation of a pasted URL into its last segment.
   */
  assert.equal(normaliseSocialUsername('https://evil.example.invalid/x'), 'https://evil.example.invalid/x');
  assert.equal(normaliseSocialUsername('a b'), 'a b');
  assert.equal(isValidSocialUsername('https://evil.example.invalid/x'), false);
  assert.ok(socialUsernameProblem('javascript:alert(1)'), 'a refusal must come with an explanation');
  assert.ok(socialUsernameProblem('a b'));
  assert.equal(socialUsernameProblem('ozikoro'), null);
  assert.equal(socialUsernameProblem('ozi.koro_1'), null);
  assert.equal(socialUsernameProblem(''), null, 'clearing a handle is not a mistake');
});

test('the pattern agrees with a hand-written accept list', () => {
  for (const ok of ['a', 'ab', 'ozikoro', 'ozi.koro_1', 'a-b-c', 'A1', 'x'.repeat(64)]) {
    assert.ok(SOCIAL_USERNAME_PATTERN.test(ok), `${ok} should be accepted`);
  }
  for (const no of ['x'.repeat(65), '.a', 'a.', '_a', 'a_', '-a', 'a-', '..', '.', '-']) {
    assert.equal(SOCIAL_USERNAME_PATTERN.test(no), false, `${no} should be refused`);
  }
  // And the near-misses that ARE legitimate: dots, underscores and hyphens inside a handle are ordinary,
  // and it is only the FIRST and LAST character that must be a letter or a digit.
  for (const ok of ['ozi.koro_1', 'a..b', 'a_b-c.d']) {
    assert.ok(SOCIAL_USERNAME_PATTERN.test(ok), `${ok} should be accepted`);
  }
});

test('every network key is distinct, and every form field is distinct', () => {
  /*
   * Because two networks sharing a form field would make one of them uneditable — the form would post one
   * value under one name and the other row would be deleted as "not submitted". A collision here is silent
   * and looks like "the handle I typed did not save".
   */
  const keys = SOCIAL_NETWORKS.map((n) => n.key);
  const fields = SOCIAL_NETWORKS.map((n) => n.field);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(fields).size, fields.length);
  assert.equal(SOCIAL_NETWORKS.length, 6);
});

test('a portrait this site cannot serve is refused, so the page draws a monogram instead of a broken box', () => {
  /*
   * ⚠️ THIS PINS A FAULT FOUND BY MEASURING RATHER THAN BY READING. `/author/<slug>/` rendered
   * `byline.avatarUrl` with no guard while its own header promised "never a Gravatar default" — and one of
   * the 16 byline rows in this checkout still carries `https://secure.gravatar.com/avatar/…?d=mm&r=g`, behind
   * 314 published records. This site's CSP is `img-src 'self' data: https://i.ytimg.com` plus the ad origins,
   * so that address is a request the browser REFUSES: the page drew a broken-image box, which is the same
   * fault an agent measured on `/researchers/` when 22 Gravatar avatars were refused.
   */
  assert.equal(sameOriginPortrait('/media/ozikoro/15198-probe-portrait.png'), '/media/ozikoro/15198-probe-portrait.png');
  assert.equal(sameOriginPortrait('  /media/ozikoro/a b.png  '), '/media/ozikoro/a b.png');
  for (const no of [
    'https://secure.gravatar.com/avatar/abc?s=96&d=mm&r=g',
    'http://127.0.0.1:3110/media/ozikoro/x.png',
    // Protocol-relative: this is why the guard tests `/media/` WITH its trailing slash and not just a leading one.
    '//evil.example.invalid/media/x.png',
    '/media',
    '/mediaevil/x.png',
    'media/x.png',
    'javascript:alert(1)',
    '',
    '   ',
    null,
    undefined,
  ]) {
    assert.equal(sameOriginPortrait(no as string | null | undefined), null, `${JSON.stringify(no)} must not be drawn`);
  }
});
