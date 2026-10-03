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

  /** Where a message goes. The design has no place for one, so one is added beside the form rather than over it. */
  var notice = document.createElement('p');
  notice.id = 'auth-notice';
  notice.setAttribute('role', 'status');
  notice.style.cssText = 'margin:var(--s-3,12px) 0 0;font-size:.92rem;line-height:1.5';
  form.parentNode.insertBefore(notice, form.nextSibling);

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
      if (confirm) confirm.required = mode === 'join';
      if (nameInput) nameInput.required = mode === 'join';
      say('');
    };
  }
  wrap('signin', 'signin');
  wrap('signup', 'join');

  // The page opens in whichever mode the address asks for.
  if (joining() && typeof window.signup === 'function') window.signup();

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
          location.assign(mode === 'join' ? '/dashboard-reader?welcome=1' : '/dashboard-reader');
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
