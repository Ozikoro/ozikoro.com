/*
 * A REAL RECORDING TAKES OVER THE LISTEN PANEL.
 *
 * The design's `reader.js` reads an article aloud with `window.speechSynthesis` — the browser's own voice. That
 * is the right behaviour for a walkthrough and for a record that has no narration, and **it is the wrong
 * behaviour for a record that has one**: the owner pressed ▶ Listen on an article carrying fourteen minutes of
 * his own voice and heard the browser read the text instead.
 *
 * `reader.js` is the design and is not edited. This file is loaded after it, and **replaces its behaviour only
 * on the pages where a recording exists** — which it knows by the presence of `[data-listen-audio]`, an element
 * this archive adds and the design has never seen.
 *
 * WHERE THERE IS NO RECORDING, NOTHING HERE RUNS, and the browser voice remains the only one available. **That
 * is the honest order of preference: a person's recording beats a synthetic one, and a synthetic one beats
 * silence.**
 */
(function () {
  var audio = document.querySelector('[data-listen-audio]');
  if (!audio) return;

  var button = document.querySelector('[data-listen-toggle]');
  var status = document.querySelector('[data-listen-status]');
  var progress = document.querySelector('[data-listen-progress]');
  var speed = document.querySelector('[data-listen-speed]');
  var panel = document.querySelector('[data-listen-panel]');

  function say(text) { if (status) status.textContent = text; }

  // `speechSynthesis` may be mid-sentence from `reader.js`; this page is not its to read.
  try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}

  // The panel becomes a player rather than a read-aloud control, so the speed control tunes the file.
  if (panel) panel.setAttribute('data-listen-mode', 'recording');

  function duration() {
    var d = audio.duration;
    if (!isFinite(d) || d <= 0) return '';
    var m = Math.floor(d / 60), s = Math.floor(d % 60);
    return m + 'm ' + String(s).padStart(2, '0') + 's';
  }

  function refresh() {
    if (button) {
      button.textContent = audio.paused ? '▶ Listen' : '❚❚ Pause';
      button.setAttribute('aria-pressed', audio.paused ? 'false' : 'true');
    }
  }

  if (button) {
    button.addEventListener('click', function (event) {
      // `reader.js` listens on the same button. Stopping here keeps it from starting the browser voice too.
      event.stopImmediatePropagation();
      event.preventDefault();
      if (audio.paused) {
        audio.play().then(function () {
          say('Playing · ' + duration());
        }).catch(function (error) {
          // A blocked autoplay or a missing file is said out loud rather than left as a dead button.
          say('Could not play: ' + (error && error.name ? error.name : 'unknown'));
        });
      } else {
        audio.pause();
        say('Paused');
      }
      refresh();
    }, true);
  }

  audio.addEventListener('timeupdate', function () {
    if (!progress || !isFinite(audio.duration) || audio.duration <= 0) return;
    var percent = (audio.currentTime / audio.duration) * 100;
    progress.value = percent;
    progress.textContent = Math.round(percent) + '%';
  });

  audio.addEventListener('loadedmetadata', function () {
    if (!audio.paused) say('Playing · ' + duration());
  });

  audio.addEventListener('ended', function () {
    say('Finished · ' + duration());
    refresh();
  });

  if (speed) {
    speed.addEventListener('change', function () {
      audio.playbackRate = parseFloat(speed.value) || 1;
    });
  }

  refresh();
})();
