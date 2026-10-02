(() => {
  const buttons = [...document.querySelectorAll('[data-event-date]')];
  const panel = document.querySelector('[data-event-panel]');
  const title = panel?.querySelector('[data-event-title]');
  const status = panel?.querySelector('[data-event-status]');
  const meta = panel?.querySelector('[data-event-meta]');
  const description = panel?.querySelector('[data-event-description]');
  const storyLink = panel?.querySelector('[data-event-story]');
  if (!panel || !title || !status || !meta || !description) return;

  const selectDay = (button) => {
    buttons.forEach((item) => {
      item.setAttribute('aria-pressed', String(item === button));
      item.closest('.sx-cultural-day')?.classList.toggle('is-selected', item === button);
    });
    title.textContent = button.dataset.title || 'Events for this day';
    status.textContent = button.dataset.status || 'Verification pending';
    meta.textContent = button.dataset.meta || 'Place and organiser will appear here.';
    description.textContent = button.dataset.description || 'Event details will appear here after verification.';
    if (storyLink) storyLink.href = `cultural-event.html?date=${encodeURIComponent(button.dataset.eventDate || '')}`;
    panel.hidden = false;
    panel.focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 60rem)').matches) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  buttons.forEach((button) => button.addEventListener('click', () => selectDay(button)));
  if (buttons[0]) selectDay(buttons[0]);
})();
