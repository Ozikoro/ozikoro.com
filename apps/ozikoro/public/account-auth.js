/*
 * THE DESIGN'S ACCOUNT PAGE, WIRED TO THIS SITE.
 *
 * `account.html` is the owner's own design and is not edited. It carries a form with no `action`, a Full name
 * field the design hides for signing in, and `signin()` / `signup()` functions that change the heading, the
 * lede and the button. **What it does not carry is a server.** This file is that, and nothing else: it reads
 * the same fields the design draws, posts them to the endpoints this platform already has, and puts the
 * answer where the reader is looking.
 *
 * THE TWO MODES ARE THE SAME FORM, WHICH IS THE DESIGN'S OWN DECISION
 *
 *   sign in    POST /api/auth/signin    email + password
 *   sign up    POST /api/auth/register  name + email + password
 *
 * **`location.hash` is what decides which**, because the design's own `signin()` and `signup()` set it. So a
 * link to `#signup` opens the page in join mode and the back button works, which a JavaScript-only toggle
 * would not give.
 */
(function () {
  var form = document.getElementById('form');
  if (!form) return;

  var email = form.querySelector('input[type="email"]');
  var pw = document.getElementById('pw');
  var confirm = document.getElementById('confirm');
  var nameGroup = document.getElementById('namegroup');
  var nameInput = nameGroup ? nameGroup.querySelector('input') : null;
  var submit = document.getElementById('submit');

  /*
   * THE TERMS BOX, WHICH BLOCKED SIGNING IN ENTIRELY.
   *
   * The design carries `<input type="checkbox" required>` beside "I agree to the Terms of Use and Privacy
   * Policy". **In signing-in mode it is still `required`, so the browser refuses to submit the form until a
   * returning member ticks a consent they gave when they joined.** They press Sign in, nothing happens, and
   * nothing says why — the commonest way a form "does not work".
   *
   * **The box belongs to joining and not to signing in**, so it is required only when joining, and its label is
   * hidden when it is not required rather than left asking for an agreement that is not wanted.
   */
  var terms = form.querySelector('input[type="checkbox"][required]') || null;
  var termsLabel = terms ? terms.closest('label') : null;

  /** Where a message goes. The design has no place for one, so one is added beside the form rather than over it. */
  var notice = document.createElement('p');
  notice.id = 'auth-notice';
  notice.setAttribute('role', 'status');
  notice.style.cssText = 'margin:var(--s-3,12px) 0 0;font-size:.92rem;line-height:1.5';
  form.parentNode.insertBefore(notice, form.nextSibling);

  /*
   * ── WHERE THE PERSON WAS GOING, WHICH THIS FILE USED TO THROW AWAY ────────────────────────────────────
   *
   * THE OWNER'S REPORT: *"why is this not working? https://ozikoro.com/dashboard-account?mode=account"*
   *
   * That address is gated (`MEMBER_DASHBOARDS` in `app/design-screen/[screen]/route.ts`), so a reader who is
   * not signed in — or whose session has ended — is sent to
   * `/signin?error=Sign+in+to+see+your+account.&next=%2Fdashboard-account%2F`, **which names exactly where
   * they were trying to go. This file then ignored `next` entirely**: the success branch below assigned
   * `location.assign('/dashboard-reader')` whatever the address said, and the join branch did the same with
   * `?welcome=1`. So the reader signed in successfully and **arrived somewhere else than the page they
   * asked for, every time**, which from outside is indistinguishable from the link being broken — the same
   * complaint one step earlier.
   *
   * The server has always honoured the field when it is given one: `/api/auth/signin` reads `next` through
   * `safeNext` and redirects there. Nothing was posting it. So the parameter is carried here, in the body
   * for the fetch and in a hidden field for the no-JavaScript post, and the browser's own answer is used
   * rather than a second redirect invented here.
   *
   * WHY THE VALUE IS VALIDATED AGAIN IN THE BROWSER, WHOSE ANSWER THE SERVER ALREADY CHECKS
   *
   * `location.assign()` sends the browser somewhere with no server in the way, so **the server's `safeNext`
   * cannot protect this path.** The test is deliberately the same one — a single leading `/`, no `//`, no
   * backslash — and it is written as `indexOf`/`slice` rather than as a regular expression so it is legible
   * beside `safeNext` at `app/api/auth/[action]/route.ts`. A value that fails is treated as absent rather
   * than refused, so a malformed `next` costs the reader their destination and never the sign-in itself.
   */
  var DEFAULT_NEXT = { join: '/dashboard-reader?welcome=1', signin: '/dashboard-reader' };

  function safeNextPath(raw) {
    var value = (raw || '').trim();
    if (value.charAt(0) !== '/') return null;
    if (value.indexOf('//') === 0) return null;      // protocol-relative, i.e. another origin
    if (value.indexOf('\\') !== -1) return null;     // browsers may read \ as /
    return value;
  }

  var requestedNext = null;
  try {
    requestedNext = safeNextPath(new URLSearchParams(location.search).get('next'));
  } catch (error) {
    requestedNext = null; // an unparseable address is treated as one that named nowhere
  }

  /*
   * AND A FORM WITH NO JAVASCRIPT AT ALL STILL CARRIES IT.
   *
   * Without this the fallback post sends only email and password, `/api/auth/signin` finds no `next` and
   * uses `safeNext`'s default — `/admin` for a sign-in and `/dashboard-reader` for a join — so a reader
   * whose browser runs no scripts lands on the wrong page exactly as the scripted one did. The hidden field
   * is added to the SERVED copy rather than to `account.html`, which is the design and is not edited.
   */
  if (requestedNext) {
    var nextField = document.createElement('input');
    nextField.type = 'hidden';
    nextField.name = 'next';
    nextField.value = requestedNext;
    form.appendChild(nextField);
  }

  function say(text, bad) {
    notice.textContent = text;
    notice.style.color = bad ? '#8a2b1f' : 'var(--emerald, #0d5c45)';
  }

  function joining() {
    return location.hash === '#signup' || location.hash === '#join';
  }

  /*
   * THE DESIGN'S OWN TWO FUNCTIONS ARE WRAPPED, NOT REPLACED.
   *
   * They move the heading, the lede, the crumb and the button — all of which the design is entitled to decide.
   * **What is added is the part they cannot know about: whether this site wants a name, and what it does with
   * the password.** Wrapping means the design's own behaviour still runs first.
   */
  function wrap(fnName, mode) {
    var original = window[fnName];
    window[fnName] = function () {
      if (typeof original === 'function') original.apply(this, arguments);
      if (submit) submit.textContent = mode === 'join' ? 'Create account\u00a0 \u2192' : 'Sign in\u00a0 \u2192';
      if (nameGroup) nameGroup.style.display = mode === 'join' ? '' : 'none';
      if (confirm) {
        confirm.required = mode === 'join';
        // A second password field has no meaning when signing in, so its group goes with the name field.
        var cg = confirm.closest('.group');
        if (cg) cg.style.display = mode === 'join' ? '' : 'none';
      }
      if (nameInput) nameInput.required = mode === 'join';
      // **The consent belongs to joining.** Left required while signing in, it stops the form dead and says
      // nothing, which is exactly what a reader would call "the sign in is not working".
      if (terms) terms.required = mode === 'join';
      if (termsLabel) termsLabel.style.display = mode === 'join' ? '' : 'none';
      if (mode !== 'join' && terms) terms.checked = false;
      say('');
    };
  }
  wrap('signin', 'signin');
  wrap('signup', 'join');

  /*
   * THE MODE IS APPLIED ON LOAD — IN BOTH DIRECTIONS, WHICH IS WHAT WAS MISSING.
   *
   * This called `signup()` when the address asked for joining and **did nothing at all when it asked for
   * signing in**, on the assumption that the design's own default was already sign-in. The design's default is
   * sign-in in its *words*, but its *form* still carries `<input type="checkbox" required>` — so on a page that
   * had never called `signin()`, the terms box stayed required and the browser refused to submit.
   *
   * **The owner pressed Sign in with both fields filled and was told to tick a consent box.** The wrapper that
   * clears it only ever ran when a link was clicked.
   */
  function applyMode() {
    var fn = joining() ? 'signup' : 'signin';
    if (typeof window[fn] === 'function') window[fn]();
    else {
      // The design's function is absent for any reason: do the part this file owns anyway.
      if (submit) submit.textContent = joining() ? 'Create account  →' : 'Sign in  →';
      if (terms) terms.required = joining();
      if (termsLabel) termsLabel.style.display = joining() ? '' : 'none';
    }
  }
  applyMode();
  // The design's own "Create one" and "Sign in" links change the hash without a reload, so the mode follows it.
  window.addEventListener('hashchange', applyMode);

  /*
   * A FORM THAT IS BLOCKED BY THE BROWSER SAYS SO.
   *
   * `submit` does not fire at all when a `required` field is empty and the browser refuses the form — **so a
   * reader sees a button that does nothing and no reason for it.** `invalid` fires on the offending field
   * instead, which is the one moment at which the page can say why it will not go.
   */
  form.addEventListener('invalid', function (event) {
    /*
     * THE MESSAGE NAMES THE FIELD, WHICH THE FIRST VERSION DID NOT.
     *
     * It said "please fill in the fields above, and tick the consent box when joining" whatever was actually
     * wrong — **so a reader who had filled everything in and was being blocked by a hidden `required` control
     * was told to tick a box that was on screen and already ticked.** A message that misnames the problem is
     * worse than none, because it sends the reader to fix the wrong thing.
     */
    var el = event && event.target;
    var label = el && el.closest && el.closest('.group, label');
    var what = label ? (label.textContent || '').trim().split('\n')[0].slice(0, 40) : 'a required field';
    say('Please complete: ' + (what || 'the required fields') + '.', true);
  }, true);

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var mode = joining() ? 'join' : 'signin';
    var body = new URLSearchParams();

    if (mode === 'join') {
      // **The design's rules are followed rather than re-invented**: it requires both passwords to match and
      // the terms box to be ticked, and its inputs already carry `required`.
      if (!nameInput || !nameInput.value.trim()) return say('Please enter your full name.', true);
      if (!pw || pw.value.length < 8) return say('A password needs at least eight characters.', true);
      if (confirm && confirm.value !== pw.value) return say('The two passwords do not match.', true);
      // **The endpoint's own field names, read from it rather than guessed**: it wants `display_name` and
      // `password_again`, and a form that posts `name` would be refused for a missing name it was given.
      body.set('display_name', nameInput.value.trim());
      body.set('email', email ? email.value.trim() : '');
      body.set('password', pw ? pw.value : '');
      body.set('password_again', confirm ? confirm.value : '');
    } else {
      body.set('email', email ? email.value.trim() : '');
      body.set('password', pw ? pw.value : '');
    }

    /* The field the server has always read and this file never sent. See `safeNextPath` above for why it is
     * validated here as well as there. */
    if (requestedNext) body.set('next', requestedNext);

    submit.disabled = true;
    say(mode === 'join' ? 'Creating your account\u2026' : 'Signing in\u2026');

    fetch(mode === 'join' ? '/api/auth/register' : '/api/auth/signin', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body,
      redirect: 'manual',
    })
      .then(function (res) {
        /* The endpoints answer with a redirect on success and JSON on refusal. **`redirect: 'manual'` makes the
         * success case an opaque response with status 0**, which is the only way a fetch can see that it would
         * have been sent somewhere without actually going. */
        if (res.type === 'opaqueredirect' || res.status === 303 || res.status === 302 || res.status === 0) {
          say(mode === 'join' ? 'Account created. Taking you in\u2026' : 'Signed in. Taking you in\u2026');
          /* THE PERSON'S OWN DESTINATION FIRST, THE MODE'S DEFAULT SECOND. This is the line that used to
           * send everybody to `/dashboard-reader` whatever they had asked for. */
          location.assign(requestedNext || DEFAULT_NEXT[mode]);
          return null;
        }
        return res.json().then(function (d) {
          say(d && d.error ? d.error : 'That did not work. Please try again.', true);
        });
      })
      .catch(function () {
        say('Could not reach the server. Please try again.', true);
      })
      .then(function () { submit.disabled = false; });
  });
})();
