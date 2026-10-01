(() => {
  const copyButton = document.querySelector('[data-copy-link]');
  const copyStatus = document.querySelector('[data-copy-status]');
  copyButton?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      if (copyStatus) copyStatus.textContent = 'Article link copied.';
    } catch {
      if (copyStatus) copyStatus.textContent = 'Copy the address from your browser to share this article.';
    }
  });

  document.querySelectorAll('[data-share]').forEach((button) => {
    button.addEventListener('click', () => {
      const url = encodeURIComponent(window.location.href);
      const title = encodeURIComponent(document.title);
      const target = button.getAttribute('data-share') === 'facebook'
        ? `https://www.facebook.com/sharer/sharer.php?u=${url}`
        : `https://twitter.com/intent/tweet?url=${url}&text=${title}`;
      window.open(target, '_blank', 'noopener,noreferrer,width=720,height=560');
    });
  });

  document.querySelector('[data-print-article]')?.addEventListener('click', () => window.print());
  const root = document.querySelector('[data-reader]');
  const play = document.querySelector('[data-listen-toggle]');
  const speed = document.querySelector('[data-listen-speed]');
  const status = document.querySelector('[data-listen-status]');
  const progress = document.querySelector('[data-listen-progress]');
  if (!root || !play || !status || !('speechSynthesis' in window)) {
    if (status) status.textContent = 'Browser narration is unavailable on this device.';
    if (play) play.setAttribute('disabled', '');
    return;
  }

  let utterance;
  let startedAt = 0;
  let timer;
  const text = Array.from(root.querySelectorAll('h1, h2, h3, p, blockquote'))
    .filter((node) => !node.closest('[data-listen-panel]'))
    .map((node) => node.textContent.trim())
    .filter(Boolean)
    .join('. ');

  const stopProgress = () => window.clearInterval(timer);
  const reset = () => {
    stopProgress();
    play.textContent = '▶ Listen';
    play.setAttribute('aria-pressed', 'false');
    status.textContent = 'Ready to listen';
    if (progress) progress.value = 0;
  };

  const startProgress = () => {
    stopProgress();
    const estimatedMs = Math.max(30000, text.split(/\s+/).length / (180 * Number(speed?.value || 1)) * 60000);
    timer = window.setInterval(() => {
      if (!progress || speechSynthesis.paused) return;
      progress.value = Math.min(98, ((Date.now() - startedAt) / estimatedMs) * 100);
    }, 500);
  };

  play.addEventListener('click', () => {
    if (speechSynthesis.speaking && !speechSynthesis.paused) {
      speechSynthesis.pause();
      play.textContent = '▶ Continue';
      play.setAttribute('aria-pressed', 'false');
      status.textContent = 'Paused';
      return;
    }
    if (speechSynthesis.paused) {
      speechSynthesis.resume();
      play.textContent = '❚❚ Pause';
      play.setAttribute('aria-pressed', 'true');
      status.textContent = 'Listening';
      return;
    }
    utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = Number(speed?.value || 1);
    utterance.onend = reset;
    utterance.onerror = () => {
      reset();
      status.textContent = 'Narration stopped. Try again or use your screen reader.';
    };
    startedAt = Date.now();
    speechSynthesis.speak(utterance);
    play.textContent = '❚❚ Pause';
    play.setAttribute('aria-pressed', 'true');
    status.textContent = 'Listening';
    startProgress();
  });

  speed?.addEventListener('change', () => {
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
      reset();
      status.textContent = `Speed set to ${speed.value}×. Press Listen to restart.`;
    }
  });

  window.addEventListener('pagehide', () => speechSynthesis.cancel());
})();
