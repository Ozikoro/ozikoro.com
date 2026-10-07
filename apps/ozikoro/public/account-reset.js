/*
 * THE DESIGN'S SET-A-PASSWORD PAGE, WIRED TO THIS SITE.
 *
 * `account.html` is the owner's own design and is not edited. `/reset?token=…` serves it with the two
 * password fields, the design's own `toggle()` / `toggle2()` show buttons, and a hidden field carrying the
 * token; this file posts all three to `/api/auth/reset` and takes the reader to sign in when the password
 * has been changed.
 *
 * THE POLICY IS READ FROM THE FIELD, NOT REPEATED HERE.
 *
 * The input is served with `minlength` taken from the server's own `MIN_PASSWORD_LENGTH`, so the number in
 * the check below is the server's number rather than a copy of it that drifts the first time the policy
 * moves. **The server still enforces it** — this only saves a round trip, and `assertPasswordAcceptable` in
 * `@ozituma/db/accounts` is the rule that decides, exactly as it does for registration.
 *
 * THE CONFIRMATION IS CHECKED HERE AS WELL AS THERE, in the server's own words, so a typo costs nothing.
 * The token is not spent until a password has been accepted, so a refusal leaves the link usable.
 */
(function () {
  var form = document.getElementById('form');
  if (!form) return;

  var pw = document.getElementById('pw');
  var confirm = document.getElementById('confirm');
  var token = form.querySelector('input[name="token"]');
  var submit = document.getElementById('submit');
  var notice = document.getElementById('screen-notice');

  function say(text, bad) {
    if (!notice) return;
    notice.textContent = text;
    notice.style.color = bad ? '#8a2b1f' : 'var(--green2, #08402f)';
    notice.style.display = text ? '' : 'none';
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    if (!pw || !pw.value) return say('Please choose a new password.', true);

    var min = Number((pw.getAttribute('minlength') || '0'));
    if (min > 0 && pw.value.length < min) {
      return say('A password needs at least ' + min + ' characters.', true);
    }
    if (confirm && confirm.value !== pw.value) {
      return say('Those two passwords are not the same.', true);
    }

    var body = new URLSearchParams();
    body.set('token', token ? token.value : '');
    body.set('password', pw.value);
    body.set('password_again', confirm ? confirm.value : '');

    submit.disabled = true;
    say('Setting the new password\u2026');

    fetch('/api/auth/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body,
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { status: res.status, data: data };
        });
      })
      .then(function (answer) {
        var data = answer.data || {};
        if (data.ok) {
          say(data.message || 'Your password has been changed.');
          // The server decides where a changed password goes, and it sends them to sign in rather than
          // signing them in here: the reset revoked every session on the account, deliberately.
          if (data.next) location.assign(data.next);
          return;
        }
        return say(data.error || 'That did not work. Please try again.', true);
      })
      .catch(function () {
        say('Could not reach the server. Please try again.', true);
      })
      .then(function () {
        submit.disabled = false;
      });
  });
})();
