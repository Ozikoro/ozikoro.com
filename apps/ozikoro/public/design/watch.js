/* Ozikoro Watch — inline YouTube player.
   Clicking a video card loads the film into the on-page player
   (privacy-enhanced youtube-nocookie embed) instead of leaving the site. */
(function () {
  var stage = document.getElementById("inline-player");
  if (!stage) return;

  var frame = document.getElementById("inline-player-frame");
  var titleEl = document.getElementById("inline-player-title");
  var metaEl = document.getElementById("inline-player-meta");
  var externalEl = document.getElementById("inline-player-external");
  var closeBtn = document.getElementById("inline-player-close");
  var lastTrigger = null;

  function open(card) {
    var id = card.getAttribute("data-video-id");
    var title = card.getAttribute("data-video-title") || "Video";
    var meta = card.getAttribute("data-video-meta") || "";
    if (!id) return;

    frame.src =
      "https://www.youtube-nocookie.com/embed/" +
      encodeURIComponent(id) +
      "?autoplay=1&rel=0";
    frame.title = title;
    titleEl.textContent = title;
    metaEl.textContent = meta;
    externalEl.href = "https://www.youtube.com/watch?v=" + encodeURIComponent(id);

    stage.hidden = false;
    lastTrigger = card;
    stage.scrollIntoView({ behavior: "smooth", block: "start" });
    closeBtn.focus({ preventScroll: true });

    document.querySelectorAll(".sx-video-card[aria-pressed]").forEach(function (c) {
      c.setAttribute("aria-pressed", c === card ? "true" : "false");
    });
  }

  function close() {
    frame.src = "";
    stage.hidden = true;
    if (lastTrigger) lastTrigger.focus();
  }

  document.querySelectorAll(".sx-video-card[data-video-id]").forEach(function (card) {
    card.addEventListener("click", function (event) {
      event.preventDefault();
      open(card);
    });
  });

  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !stage.hidden) close();
  });
})();
