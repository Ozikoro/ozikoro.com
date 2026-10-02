(() => {
  const days = ["Eke", "Orie", "Afọ", "Nkwọ"];
  const today = new Date();
  const delta = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(2026, 0, 1)) / 86400000);
  const marketDay = days[((1 + delta) % 4 + 4) % 4];
  const modernDate = new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric" }).format(today);
  const header = document.querySelector(".masthead, .sx-reader-header");
  if (!header) return;

  if (!document.querySelector(".platform-bar")) {
    const dateBar = document.createElement("div");
    dateBar.className = "mobile-datebar";
    dateBar.innerHTML = `<a href="igbo-calendar.html" aria-label="Open Igbo calendar"><b>${marketDay}</b><span>${modernDate}</span></a>`;
    header.before(dateBar);
  }

  const inner = header.querySelector(":scope > .wrap");
  const nav = header.querySelector(".nav, nav");
  if (!inner || !nav || inner.querySelector(".mobile-menu-button")) return;
  const button = document.createElement("button");
  button.className = "mobile-menu-button";
  button.type = "button";
  button.setAttribute("aria-label", "Open menu");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = "<span></span><span></span><span></span>";
  inner.insertBefore(button, nav);
  const close = () => {
    header.classList.remove("menu-open");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "Open menu");
  };
  button.addEventListener("click", () => {
    const open = header.classList.toggle("menu-open");
    button.setAttribute("aria-expanded", String(open));
    button.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
  nav.querySelectorAll("a").forEach(link => link.addEventListener("click", close));
})();