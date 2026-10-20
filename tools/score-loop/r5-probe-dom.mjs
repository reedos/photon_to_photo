// Score loop r5: what covers the "Play photons" button on a phone: every element whose box overlaps it and sits later in paint order.
//   P2P_URL=http://127.0.0.1:47803/ node tools/score-loop/r5-probe-dom.mjs 390 844 "?tour=7"
import { chromium } from 'playwright';
const url = process.env.P2P_URL || 'http://127.0.0.1:47803/';
const [w = '390', h = '844', path = '?tour=7'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2, reducedMotion: 'reduce', isMobile: true, hasTouch: true });
  await page.goto(new URL(path, url).href);
  await page.waitForFunction(() => window.p2p?.pieces?.loupe, null, { timeout: 120000 });
  await page.evaluate(() => window.p2p.pieces.loupe.ready?.());
  await page.waitForTimeout(3500);
  const r = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /play photons/i.test(b.textContent || '') && b.getClientRects().length);
    const b = btn.getBoundingClientRect();
    const hit = document.elementsFromPoint(b.left + b.width / 2, b.bottom - 3).map((e) => `${e.tagName}#${e.id}.${(e.className?.toString() || '').slice(0, 40)}`);
    const chain = []; for (let e = btn; e && e !== document.body; e = e.parentElement) { const q = e.getBoundingClientRect(); chain.push(`${e.tagName}#${e.id}.${(e.className?.toString() || '').slice(0, 30)} top ${Math.round(q.top)} bottom ${Math.round(q.bottom)} pos ${getComputedStyle(e).position} ov ${getComputedStyle(e).overflowY}`); }
    const tabs = [...document.querySelectorAll('*')].filter((e) => /^(Settings|Parts)$/.test((e.textContent || '').trim()) && e.children.length === 0).map((e) => { const p = e.closest('nav,div,section'); const q = p.getBoundingClientRect(); return `${p.tagName}#${p.id}.${(p.className?.toString() || '').slice(0, 40)} top ${Math.round(q.top)} bottom ${Math.round(q.bottom)} pos ${getComputedStyle(p).position}`; });
    const v = document.getElementById('viewer'), vs = getComputedStyle(v);
    const kids = [...v.children].filter((c) => c.getClientRects().length).map((c) => { const q = c.getBoundingClientRect(), s = getComputedStyle(c); return `${c.tagName}#${c.id}.${(c.className?.toString() || '').slice(0, 30)} ${Math.round(q.top)}-${Math.round(q.bottom)} h${Math.round(q.height)} minH ${s.minHeight} flex ${s.flex} pos ${s.position}`; });
    return { btn: { top: Math.round(b.top), bottom: Math.round(b.bottom) }, hit, chain, tabs, viewer: { display: vs.display, dir: vs.flexDirection, rows: vs.gridTemplateRows }, kids };
  });
  console.log(JSON.stringify(r, null, 1));
} finally { await browser.close(); }
