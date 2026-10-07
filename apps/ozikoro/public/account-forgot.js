/*
 * THE DESIGN'S RESET-REQUEST PAGE, WIRED TO THIS SITE.
 *
 * `account.html` is the owner's own design and is not edited. `/forgot` serves it with the fields a
 * password request needs and injects this file, which does the one thing the design cannot: post the form
 * to the endpoint this site already has and put the answer where the reader is looking.
 *
 * WHY IT ASKS FOR JSON RATHER THAN FOLLOWING THE ENDPOINT'S REDIRECT
 *
 * The endpoint answers a plain form post with a 303 back to `?sent=1`, which is what makes the page work
 * without JavaScript. A fetch cannot read the body of a redirect and must not be trusted to guess at one,
 * so it asks for `accept: application/json` instead and the endpoint answers in that shape. **The two
 * shapes exist because recovery has to survive a script being blocked**, and the server, not this file,
 * decides what the sentence is — the wording of "if that address has an account here" belongs in one place.
 */
(function () {
  var form = document.getElementById('form');
  if (!form) return;

  var email = form.querySelector('input[type="email"]');
  var submit = document.getElementById('submit');

  /* The element the server always draws, so a message from here lands where a message from there does. */
  var notice = document.getElementById('screen-notice');

  function say(text, bad) {
    if (!notice) return;
    notice.textContent = text;
    notice.style.color = bad ? '#8a2b1f' : 'var(--green2, #08402f)';
    notice.style.display = text ? '' : 'none';
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    if (!email || !email.value.trim()) return say('Please enter your email address.', true);

    var body = new URLSearchParams();
    body.set('email', email.value.trim());

    submit.disabled = true;
    say('Sending the link\u2026');

    fetch('/api/auth/forgot', {
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
          /*
           * The sentence is the server's, because the server is the only side that knows whether an account
           * was found — and it deliberately does not say. **This file must not improve on it**: a client
           * that guessed would be the enumeration oracle the endpoint is built to avoid.
           */
          say(data.message || 'If that address has an account here, a link is on its way to it.');
          form.reset();
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
