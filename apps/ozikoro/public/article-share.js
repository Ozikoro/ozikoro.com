/*
 * A BLOCKED SHARE WINDOW IS NOT A DEAD BUTTON.
 *
 * The design's `reader.js` shares an article by calling
 *
 *     window.open(target, '_blank', 'noopener,noreferrer,width=720,height=560');
 *
 * and there are two things wrong with that one line, neither of which is visible from the page.
 *
 * 1. **`width` and `height` are not part of the standard feature string.** The HTML standard defines a short
 *    list of window features, and a name it does not recognise is not a feature — but browsers have differed
 *    on what to do with one, and some have treated the whole string as unusable and ignored it. That turns a
 *    request for a small popup into a plain `window.open` with no features at all, which is the shape a popup
 *    blocker is most willing to refuse. **`noopener,noreferrer` alone is the standard spelling of what this
 *    wants**: a new browsing context that cannot reach back into this page.
 *
 * 2. **`window.open` returns `null` when it is blocked, and that return value was discarded.** A blocked share
 *    therefore did nothing at all, said nothing, and looked exactly like a share button that works — which is
 *    the fault the owner reported, and the worst possible version of it, because there is nothing on screen to
 *    say whether the click was received.
 *
 * WHAT THIS DOES INSTEAD
 *
 * It claims the click in the CAPTURE phase, exactly as `audio-listen.js` claims the listen button, so the
 * design's own handler never runs twice. It opens the window with no feature string at all — a plain new tab,
 * which is what a share wants — and then severs the opener. **And if the window does not open, it copies the
 * article's address and says so**, using the design's own status line (`[data-copy-status]`, which the design
 * already marks `aria-live="polite"`) — so the reader is told what happened and is left holding the thing they
 * wanted to share.
 *
 * `reader.js` is the design and is not edited. This file sits beside `audio-listen.js` and `account-auth.js`,
 * is loaded after the design's script, and does nothing at all on a page with no `[data-share]`.
 */
(function () {
  var buttons = document.querySelectorAll('[data-share]');
  if (!buttons.length) return;

  var status = document.querySelector('[data-copy-status]');

  function say(text) {
    if (status) status.textContent = text;
  }

  /*
   * The address to share. An article page is served with the record's own canonical address already on its
   * share controls — that is what the serve-time anchor carries — so it is used when it is there, and the
   * address the reader is actually on is used when it is not. The design's own behaviour was always the
   * second; on the real origin the two are the same address.
   */
  function shareUrl(button) {
    var href = button.getAttribute('href');
    if (href) return href;
    var here = encodeURIComponent(window.location.href);
    return button.getAttribute('data-share') === 'facebook'
      ? 'https://www.facebook.com/sharer/sharer.php?u=' + here
      : 'https://twitter.com/intent/tweet?url=' + here + '&text=' + encodeURIComponent(document.title);
  }

  /*
   * The fallback is the one the design already uses for its copy button, so the two controls behave alike.
   * `navigator.clipboard` is absent on a non-secure origin, which is a refusal rather than a crash.
   */
  function copyAddress() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(window.location.href);
    }
    return Promise.reject(new Error('clipboard unavailable'));
  }

  Array.prototype.forEach.call(buttons, function (button) {
    button.addEventListener('click', function (event) {
      // `reader.js` listens on the same control. Its window and this one would be two windows for one click.
      event.stopImmediatePropagation();
      event.preventDefault();

      /*
       * `noopener` IS DELIBERATELY NOT IN THE FEATURE STRING, AND A BROWSER TEST IS WHY.
       *
       * The standard says that when `noopener` IS present, `window.open` returns null **by design**, so that a
       * page cannot reach the window it opened. That makes the return value useless as the answer to "was this
       * blocked" — and the first version of this file used it that way. **It announced "your browser blocked
       * the share window" on every share that SUCCEEDED**, which was found by clicking the button in a real
       * browser rather than by reading this code, and is exactly the class of fault this whole round is about.
       *
       * So the window is opened without it and the opener is severed immediately afterwards. That is the same
       * protection obtained a moment later, and it leaves a return value that means what it says: **null is a
       * blocked popup and nothing else.**
       */
      var opened = null;
      try {
        opened = window.open(shareUrl(button), '_blank');
        if (opened) {
          try { opened.opener = null; } catch (error) { /* the new window is cross-origin; nothing to sever */ }
        }
      } catch (error) {
        opened = null;
      }

      if (opened) {
        say('Opening the share window…');
        return;
      }

      // BLOCKED. Copy the link and say so, rather than leaving a click that appears to have done nothing.
      copyAddress().then(function () {
        say('Your browser blocked the share window. The article link is copied — paste it into your post.');
      }).catch(function () {
        say('Your browser blocked the share window. Copy the address from your browser to share this article.');
      });
    }, true);
  });
})();
