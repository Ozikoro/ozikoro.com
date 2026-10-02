(() => {
  const days = ["Eke", "Orie", "Afọ", "Nkwọ"];
  const anchor = Date.UTC(2026, 0, 1);
  const anchorIndex = 1;
  const marketDay = date => { const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()); const delta = Math.round((utc-anchor)/86400000); return days[((anchorIndex+delta)%4+4)%4]; };
  const fmt = new Intl.DateTimeFormat("en-NG", {weekday:"short",day:"numeric",month:"short",year:"numeric"});
  const today = new Date();
  document.querySelectorAll("[data-modern-date]").forEach(el => el.textContent = fmt.format(today));
  document.querySelectorAll("[data-market-day]").forEach(el => el.textContent = marketDay(today));
  const input=document.querySelector("[data-date-input]"), form=document.querySelector(".sx-date-lookup"), result=document.querySelector("[data-market-result]");
  if(input){ input.value=[today.getFullYear(),String(today.getMonth()+1).padStart(2,"0"),String(today.getDate()).padStart(2,"0")].join("-"); }
  if(form) form.addEventListener("submit", e => { e.preventDefault(); const parts=input.value.split("-").map(Number); if(parts.length!==3)return; const d=new Date(parts[0],parts[1]-1,parts[2]); result.innerHTML=`<b>${marketDay(d)}</b><span>${fmt.format(d)}</span>`; });
  let shown=new Date(today.getFullYear(),today.getMonth(),1); const grid=document.querySelector("[data-calendar-grid]"), title=document.querySelector("[data-month-title]");
  function render(){ if(!grid)return; title.textContent=new Intl.DateTimeFormat("en-NG",{month:"long",year:"numeric"}).format(shown); grid.innerHTML=""; const offset=(new Date(shown.getFullYear(),shown.getMonth(),1).getDay()+6)%7; for(let i=0;i<offset;i++){const blank=document.createElement("div");blank.className="is-empty";blank.setAttribute("aria-hidden","true");grid.appendChild(blank)} const count=new Date(shown.getFullYear(),shown.getMonth()+1,0).getDate(); for(let i=1;i<=count;i++){const d=new Date(shown.getFullYear(),shown.getMonth(),i), cell=document.createElement("div"),day=marketDay(d); cell.dataset.market=day; cell.innerHTML=`<span>${i}</span><b>${day}</b>`; grid.appendChild(cell);} }
  document.querySelector("[data-prev-month]")?.addEventListener("click",()=>{shown.setMonth(shown.getMonth()-1);render()});
  document.querySelector("[data-next-month]")?.addEventListener("click",()=>{shown.setMonth(shown.getMonth()+1);render()}); render();
  const upcomingForm=document.querySelector(".sx-upcoming-tool"), upcomingSelect=document.querySelector("[data-upcoming-select]"), upcomingResults=document.querySelector("[data-upcoming-results]");
  function renderUpcoming(){if(!upcomingSelect||!upcomingResults)return;const wanted=upcomingSelect.value,found=[];let d=new Date(today.getFullYear(),today.getMonth(),today.getDate());while(found.length<10){if(marketDay(d)===wanted)found.push(new Date(d));d.setDate(d.getDate()+1)}upcomingResults.innerHTML=found.map(date=>`<li><b>${wanted}</b><span>${fmt.format(date)}</span></li>`).join("")}
  upcomingForm?.addEventListener("submit",event=>{event.preventDefault();renderUpcoming()});renderUpcoming();
  const yearInput=document.querySelector("[data-year-input]"),yearGrid=document.querySelector("[data-year-grid]");
  function renderYear(){if(!yearInput||!yearGrid)return;const year=Math.min(2100,Math.max(1900,Number(yearInput.value)||today.getFullYear()));yearInput.value=year;yearGrid.innerHTML="";for(let month=0;month<12;month++){const card=document.createElement("article"),name=new Intl.DateTimeFormat("en-NG",{month:"long"}).format(new Date(year,month,1)),count=new Date(year,month+1,0).getDate();card.innerHTML=`<h3>${name}</h3><div>${Array.from({length:count},(_,i)=>{const d=new Date(year,month,i+1);return `<span data-market="${marketDay(d)}"><b>${i+1}</b><small>${marketDay(d)}</small></span>`}).join("")}</div>`;yearGrid.appendChild(card)}}
  yearInput?.addEventListener("change",renderYear);renderYear();
})();
// Shared compact navigation for phone layouts.
if (!document.querySelector('script[data-mobile-nav]')) {
  const mobileNav = document.createElement('script');
  mobileNav.src = new URL('mobile-nav.js', document.currentScript?.src || window.location.href).href;
  mobileNav.defer = true;
  mobileNav.dataset.mobileNav = '';
  document.head.appendChild(mobileNav);
}
