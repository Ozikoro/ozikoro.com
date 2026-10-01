(() => {
  const output = document.querySelector('[data-modern-date]');
  const input = document.querySelector('[data-date-input]');
  if (!output) return;
  const today = new Date();
  output.textContent = new Intl.DateTimeFormat('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(today);
  if (input) input.value = [today.getFullYear(), String(today.getMonth()+1).padStart(2,'0'), String(today.getDate()).padStart(2,'0')].join('-');
})();
