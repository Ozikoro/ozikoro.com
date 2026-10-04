/*
 * overflow-probe.mjs — the layout measurement itself, shared by the single-page probe and the sweep.
 *
 * The numbers have to come from a real layout engine, and they have to be the SAME numbers in both
 * scripts, or a sweep and a follow-up measurement can disagree about the same page. So the expression is
 * built here, once, and both callers use it.
 *
 * Four faults are distinguished, because they have four different causes:
 *
 *   document        `documentElement.scrollWidth > clientWidth` — the page itself scrolls sideways
 *   leak-right      an element's right edge is past the viewport by more than a pixel
 *   leak-left       an element's left edge is before the viewport (negative x)
 *   self-overflow   an element's own `scrollWidth` beats its `clientWidth` with `overflow: visible`,
 *                   so its content paints outside its box
 *
 * `--outside-wrap` is the fifth and it is the one the owner actually reported: an element that is a
 * **direct child of the design's content flow but not inside its `.wrap`**, so it sits on the window's
 * edge instead of on the content column. At 1440 px that is 112 px to the left of every other element
 * and at 390 px the text runs from edge to edge with no padding. **Neither produces a scrollbar**, so a
 * scrollWidth check alone calls the page healthy — which is exactly how this fault survived.
 */
import { spawn } from 'node:child_process';

export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ the measurement expression. */

export function measureExpression(findText = null) {
  return `(() => {
  const vw = document.documentElement.clientWidth;
  const de = document.documentElement;

  const label = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id && !/^[0-9]/.test(el.id)) return s + '#' + el.id;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 3) : [];
    if (cls.length) s += '.' + cls.join('.');
    const p = el.parentElement;
    if (p) {
      const same = [...p.children].filter((c) => c.tagName === el.tagName);
      if (same.length > 1) s += ':nth-of-type(' + ([...p.children].indexOf(el) + 1) + ')';
    }
    return s;
  };
  const path = (el) => {
    const parts = [];
    let n = el;
    while (n && n !== de && parts.length < 7) { parts.unshift(label(n)); n = n.parentElement; }
    return parts.join(' > ');
  };
  const rect = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), right: +b.right.toFixed(1) };
  };
  const style = (cs) => ({
    display: cs.display,
    width: cs.width,
    minWidth: cs.minWidth,
    maxWidth: cs.maxWidth,
    whiteSpace: cs.whiteSpace,
    overflowX: cs.overflowX,
    wordBreak: cs.wordBreak,
    marginLeft: cs.marginLeft,
    marginRight: cs.marginRight,
    position: cs.position,
    gridTemplateColumns: cs.display.includes('grid') ? cs.gridTemplateColumns : undefined,
    flexDirection: cs.display.includes('flex') ? cs.flexDirection : undefined,
  });

  const leaksRight = [];
  const leaksLeft = [];
  const selfOverflow = [];
  const outsideWrap = [];
  const all = [...document.body.querySelectorAll('*')];

  /* The content column: the leftmost place any .wrap actually puts text, i.e. its border box plus its own
   * left padding. Zero when the page has no .wrap, which switches the outside-the-column check off. */
  let contentLeft = 0;
  for (const w of document.querySelectorAll('.wrap')) {
    const cs = getComputedStyle(w);
    if (cs.display === 'none') continue;
    const x = w.getBoundingClientRect().x + (parseFloat(cs.paddingLeft) || 0);
    if (x > 8 && (contentLeft === 0 || x < contentLeft)) contentLeft = x;
  }

  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const b = el.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) continue;
    const overRight = b.right - vw;
    const overLeft = 0 - b.left;
    if (overRight > 1) {
      leaksRight.push({ sel: path(el), over: +overRight.toFixed(1), rect: rect(el),
        parent: el.parentElement ? { sel: label(el.parentElement), rect: rect(el.parentElement), scrollW: el.parentElement.scrollWidth, clientW: el.parentElement.clientWidth } : null,
        text: (el.textContent || '').trim().slice(0, 70), style: style(cs) });
    }
    if (overLeft > 1) {
      leaksLeft.push({ sel: path(el), over: +overLeft.toFixed(1), rect: rect(el),
        parent: el.parentElement ? { sel: label(el.parentElement), rect: rect(el.parentElement) } : null,
        text: (el.textContent || '').trim().slice(0, 70), style: style(cs) });
    }
    if (el.scrollWidth - el.clientWidth > 1 && cs.overflowX === 'visible') {
      selfOverflow.push({ sel: path(el), scrollW: el.scrollWidth, clientW: el.clientWidth,
        over: el.scrollWidth - el.clientWidth, rect: rect(el), text: (el.textContent || '').trim().slice(0, 70), style: style(cs) });
    }

    /*
     * OUTSIDE THE CONTENT COLUMN — THE FAULT THE OWNER REPORTED, AND IT MAKES NO SCROLLBAR.
     *
     * The design's content sits in a .wrap column: at 1440 px that column begins at 136 px (x 112 +
     * padding 24), at 390 px at 16 px. An element inserted as a direct child of <main> starts at 0, so it
     * hangs 112 px to the left of every other element and runs edge-to-edge on a phone.
     *
     * The test is geometric, because a structural one gives false positives: type-test.html and
     * dashboard-states.html legitimately put a bare p element directly under main. What marks the fault is
     * that the element's own containing block gives it NO inset (padding-left of 0) while the page's
     * content column does.
     *
     * A BAND IS NOT AN OFFENDER. The design uses full-bleed sections with their own colour and their own
     * inner .wrap (.sx-subhero, .sx-section, the masthead, the platform bar). They start at x=0 on purpose
     * and their text is on the column, so an element that CONTAINS a .wrap is a container rather than a
     * stray block. A page with no content column at all (no .wrap) is skipped too, because there is nothing
     * for the element to be out of step with.
     */
    if (b.width > 0 && b.height > 0 && (el.textContent || '').trim().length > 40) {
      if (!el.closest('.wrap') && !el.querySelector('.wrap') && contentLeft > 8) {
        const p = el.parentElement;
        const parentPad = p ? parseFloat(getComputedStyle(p).paddingLeft) || 0 : 0;
        if (parentPad <= 1 && b.x < contentLeft - 8) {
          outsideWrap.push({ sel: path(el), rect: rect(el), contentLeft: +contentLeft.toFixed(1),
            parent: p ? label(p) : null, parentPad,
            text: (el.textContent || '').trim().slice(0, 70), style: style(cs) });
        }
      }
    }
  }
  leaksRight.sort((a, b) => b.over - a.over);
  leaksLeft.sort((a, b) => b.over - a.over);
  selfOverflow.sort((a, b) => b.over - a.over);

  let found = null;
  const needle = ${JSON.stringify(findText)};
  if (needle) {
    const hits = all.filter((el) => (el.textContent || '').includes(needle));
    const hit = hits.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0];
    if (hit) {
      const cs = getComputedStyle(hit);
      const pe = hit.parentElement;
      found = { sel: path(hit), rect: rect(hit), style: style(cs), text: (hit.textContent || '').trim().slice(0, 200),
        parent: pe ? { sel: path(pe), tag: pe.tagName, rect: rect(pe), scrollW: pe.scrollWidth, clientW: pe.clientWidth,
          style: style(getComputedStyle(pe)) } : null,
        ancestors: (() => { const out = []; let n = hit.parentElement; while (n && n !== de) {
          out.push({ sel: label(n), rect: rect(n), scrollW: n.scrollWidth, clientW: n.clientWidth, minWidth: getComputedStyle(n).minWidth, display: getComputedStyle(n).display });
          n = n.parentElement; } return out; })() };
    }
  }

  const wrap = document.querySelector('main .wrap') || document.querySelector('.wrap');
  return JSON.stringify({
    url: location.href,
    viewportWidth: vw,
    documentScrollWidth: de.scrollWidth,
    documentScrollHeight: de.scrollHeight,
    pageOverflowsHorizontally: de.scrollWidth > vw + 1,
    overflowAmount: Math.max(0, de.scrollWidth - vw),
    wrapRect: wrap ? rect(wrap) : null,
    wrapComputed: wrap ? { maxWidth: getComputedStyle(wrap).maxWidth, marginLeft: getComputedStyle(wrap).marginLeft, paddingLeft: getComputedStyle(wrap).paddingLeft } : null,
    leaksRight: leaksRight.slice(0, 25),
    leaksLeft: leaksLeft.slice(0, 25),
    selfOverflow: selfOverflow.slice(0, 25),
    outsideWrap: outsideWrap.slice(0, 25),
    counts: { leaksRight: leaksRight.length, leaksLeft: leaksLeft.length, selfOverflow: selfOverflow.length, outsideWrap: outsideWrap.length },
    found,
  });
})()`;
}

/* ------------------------------------------------------------------ the browser. */

export async function openBrowser({ width, height = 900, mobile = width <= 640, tag = 'ovf' }) {
  const port = 9500 + Math.floor(Math.random() * 500);
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=/tmp/${tag}-${port}-${width}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(400);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {}
  }
  if (!target) {
    proc.kill();
    throw new Error('could not attach to Chrome');
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const send = (method, params) =>
    new Promise((res) => {
      const myId = ++id;
      pending.set(myId, res);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });

  return {
    send,
    async close() {
      ws.close();
      proc.kill();
    },
  };
}

/*
 * Navigate and CHECK WHERE WE ENDED UP. A Chrome started on `about:blank` occasionally refuses the first
 * navigation, and the page then measures as `chrome-error://chromewebdata/` — a document as wide as the
 * viewport with no `.wrap` and no offenders in it, which reads as a clean bill of health. That is the
 * failure this whole probe exists to avoid, so it retries and refuses to report on an error page.
 */
export async function navigate(send, url, settleSeconds = 3) {
  let landed = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const nav = await send('Page.navigate', { url });
    if (nav?.errorText) console.error(`  navigation error (attempt ${attempt}): ${nav.errorText}`);
    await sleep(900 + settleSeconds * 1000);
    const probe = await send('Runtime.evaluate', { expression: 'document.location.href', returnByValue: true });
    landed = probe?.result?.result?.value ?? '';
    if (landed && !landed.startsWith('chrome-error') && !landed.startsWith('about:')) return true;
    await sleep(600);
  }
  return false;
}

/* Scroll the page once so lazy images take up their real box, then return to the top. */
export async function settlePage(send) {
  await send('Runtime.evaluate', {
    expression: `(async () => {
      const step = Math.max(200, innerHeight);
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise(r => setTimeout(r, 50));
      }
      window.scrollTo(0, 0);
      try { await document.fonts.ready; } catch {}
      await new Promise(r => setTimeout(r, 250));
    })()`,
    awaitPromise: true,
  });
  await sleep(400);
}

export async function measure(send, findText = null) {
  const expr = measureExpression(findText);
  for (let i = 0; i < 4; i++) {
    const out = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    const value = out?.result?.result?.value;
    if (value) return JSON.parse(value);
    await sleep(800);
  }
  throw new Error('measurement returned nothing');
}

export { sleep };
