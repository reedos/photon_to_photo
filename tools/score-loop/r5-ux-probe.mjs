// Score loop r5 (UX): one probe per reviewer finding, printed as JSON, with screenshots for the note.
//   P2P_URL=http://127.0.0.1:47804/ node tools/score-loop/r5-ux-probe.mjs before [probe ...]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const url = process.env.P2P_URL || 'http://127.0.0.1:47804/';
const [label = 'probe', ...only] = process.argv.slice(2);
const out = 'docs/score-loop/r5-ux';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const results = {};
const want = (name) => !only.length || only.includes(name);

async function open(width, height, query = '?piece=camera&lens=n50&focus=1.5&iso=400', extra = {}) {
  const phone = width < 760 || height < 500;
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1, ...extra });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${url}${query}`);
  await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 });
  await page.evaluate(() => window.p2p.settle?.());
  await page.waitForTimeout(1500);
  return { page, context, errors };
}
async function run(name, fn) {
  if (!want(name)) return;
  try { results[name] = await fn(); } catch (e) { results[name] = { error: String(e?.stack ?? e).split('\n').slice(0, 3).join(' | ') }; }
}

// 1+9: inset caption and legend inside the frame and the viewport
await run('inset', async () => {
  const r = {};
  for (const [w, h] of [[320, 568], [360, 780], [390, 844], [430, 932], [740, 360], [844, 390], [667, 375], [1440, 900]]) {
    for (const level of ['lens', 'cone', 'loupe']) {
      const { page, context } = await open(w, h, `?piece=${level}&lens=n50`);
      const m = await page.evaluate(() => {
        const vw = innerWidth;
        const textBox = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); const q = [...rg.getClientRects()].filter(x => x.width > 0); return q.length ? { l: Math.min(...q.map(x => x.left)), r: Math.max(...q.map(x => x.right)), t: Math.min(...q.map(x => x.top)), b: Math.max(...q.map(x => x.bottom)) } : null; };
        return [...document.querySelectorAll('.piece-overlay:not([hidden]) .lv-inset-note, .inset-frame')].filter(e => e.checkVisibility() && e.getBoundingClientRect().width > 2).map((f) => {
          const note = f.classList.contains('lv-inset-note');
          const lab = f.querySelector('.inset-label');
          const frame = (note ? f.parentElement : f).getBoundingClientRect();
          const b = lab ? textBox(lab) : note ? textBox(f) : null;
          return { cls: note ? 'note' : 'frame', text: (f.dataset.label || f.textContent || '').slice(0, 60), frameW: Math.round(frame.width), textL: b && Math.round(b.l), textR: b && Math.round(b.r), frameL: Math.round(frame.left), frameR: Math.round(frame.right), vw, overRight: b && Math.round(b.r - frame.right), overView: b && Math.round(b.r - vw), overLeft: b && Math.round(frame.left - b.l), lines: b ? Math.round((b.b - b.t) / 12) : null };
        });
      });
      r[`${w}x${h} ${level}`] = m;
      if (level === 'lens' && [390, 320, 844].includes(w)) await page.screenshot({ path: `${out}/${label}-inset-${w}x${h}.png` });
      await context.close();
    }
  }
  return r;
});

// 2: pins hidden by collisions on the deep levels
await run('pins', async () => {
  const r = {};
  for (const [w, h] of [[667, 375], [568, 320], [360, 780], [320, 568], [430, 932], [390, 844], [844, 390], [1440, 900]]) {
    for (const level of ['lens', 'cone', 'loupe', 'cone-def', 'loupe-def']) {
      const { page, context } = await open(w, h, level.endsWith('-def') ? `?piece=${level.slice(0, -4)}` : `?piece=${level}&lens=n50`);
      await page.waitForTimeout(level.startsWith('loupe') ? 2000 : 300);
      const m = await page.evaluate(() => {
        const pins = [...document.querySelectorAll('.pin')];
        const shown = pins.filter(e => e.style.display !== 'none' && e.checkVisibility());
        return { total: pins.length, shown: shown.length, hidden: pins.filter(e => !shown.includes(e)).map(e => e.querySelector('.num')?.textContent), hint: document.querySelector('.pin-hidden-hint:not([hidden])')?.textContent ?? null };
      });
      r[`${w}x${h} ${level}`] = m;
      if (w === 667 || (w === 568)) await page.screenshot({ path: `${out}/${label}-pins-${w}x${h}-${level}.png` });
      await context.close();
    }
  }
  return r;
});

// 3+10: the first-run coach ring is centered on a control, or maps to the nearest one
await run('coach', async () => {
  const r = {};
  for (const [w, h] of [[1440, 900], [1024, 768], [390, 844]]) {
    const { page, context } = await open(w, h, '?piece=camera&lens=n50');
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    await page.waitForTimeout(1500);
    const rings = await page.evaluate(() => [...document.querySelectorAll('.rig-teach')].filter(e => e.style.display !== 'none').map(e => { const b = e.querySelector('i').getBoundingClientRect(); return { cls: e.className, text: e.querySelector('span')?.textContent, cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: b.width / 2 }; }));
    const out2 = { rings, tries: [] };
    const pair = rings.find(x => /pair/.test(x.cls)) ?? rings.find(x => /Fire|Adjust/.test(x.text));
    if (pair) {
      const f0 = (await page.evaluate(() => window.p2p.scenario().fno));
      // hover at the ring center
      await page.mouse.move(pair.cx, pair.cy); await page.waitForTimeout(300);
      out2.hover = await page.evaluate(() => document.querySelector('.rig-tip:not([hidden])')?.textContent ?? null);
      out2.cursor = await page.evaluate(() => document.querySelector('#gl').style.cursor);
      // drag at the ring center
      await page.mouse.down(); await page.mouse.move(pair.cx + 40, pair.cy, { steps: 6 }); await page.mouse.up();
      await page.waitForTimeout(300);
      out2.fnoBefore = f0; out2.fnoAfterDrag = await page.evaluate(() => window.p2p.scenario().fno);
      out2.orbited = await page.evaluate(() => window.p2p.framing().position.map(v => Math.round(v)));
      // offsets inside the ring
      for (const [dx, dy] of [[0, -10], [0, 10], [-10, 0], [10, 0]]) {
        await page.mouse.move(pair.cx + dx, pair.cy + dy); await page.waitForTimeout(200);
        out2.tries.push({ dx, dy, tip: await page.evaluate(() => document.querySelector('.rig-tip:not([hidden])')?.textContent ?? null) });
      }
    }
    await page.screenshot({ path: `${out}/${label}-coach-${w}.png` });
    r[`${w}x${h}`] = out2;
    await context.close();
  }
  return r;
});

// 4+8: Play the shot keeps its controls where they are across chapters; phone chips carry names
await run('shot', async () => {
  const r = {};
  for (const [w, h] of [[1440, 900], [1024, 768], [390, 844], [360, 740], [320, 740]]) {
    const { page, context } = await open(w, h, '?piece=camera&lens=n50');
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    await page.locator('.shot-launch').first().click();
    await page.waitForSelector('#shot-dialog[data-ready="true"]', { timeout: 120000 });
    await page.waitForTimeout(800);
    const rows = [];
    for (let i = 0; i < 6; i++) {
      await page.locator(`[data-shot-chapter="${i}"]`).click(); await page.waitForTimeout(400);
      rows.push(await page.evaluate(() => { const d = document.querySelector('#shot-dialog').getBoundingClientRect(); const c = document.querySelector('[data-shot-chapter="0"]').getBoundingClientRect(); const t = document.querySelector('.shot-transport').getBoundingClientRect();
        const chips = [...document.querySelectorAll('[data-shot-chapter]')].map(b => { const sh = b.querySelector('.shot-chip-short'); const sp = b.querySelector('span'); const vis = (e) => e && getComputedStyle(e).display !== 'none'; const t = vis(sh) ? sh : vis(sp) ? sp : null; const bb = b.getBoundingClientRect(); const tr = t ? t.getBoundingClientRect() : null; return { text: b.innerText.replace(/\s+/g, ' '), w: Math.round(bb.width), textW: tr ? Math.round(tr.width) : 0 }; });
        return { dialogH: Math.round(d.height), dialogTop: Math.round(d.top), chipTop: Math.round(c.top), transportTop: Math.round(t.top), chips: chips.map(c => `${c.text}:${c.textW}/${c.w}`).join(' | '), scrollH: document.querySelector('#shot-dialog').scrollHeight, clientH: document.querySelector('#shot-dialog').clientHeight }; }));
      if (i === 3 && (w === 390 || w === 1440)) await page.screenshot({ path: `${out}/${label}-shot-${w}-ch4.png` });
    }
    r[`${w}x${h}`] = { chipTops: [...new Set(rows.map(x => x.chipTop))], dialogHs: [...new Set(rows.map(x => x.dialogH))], transportTops: [...new Set(rows.map(x => x.transportTop))], chips: rows[0].chips, overflow: rows.some(x => x.scrollH > x.clientH + 1) };
    await context.close();
  }
  return r;
});

// 7+11+12: Models page selection feedback
await run('models', async () => {
  const r = {};
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const phone = w < 760;
    const context = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
    const page = await context.newPage();
    await page.goto(`${url}models.html?body=dslr&lens=n50`);
    await page.waitForFunction(() => window.p2pModels?.ready && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    const vis = () => page.evaluate(() => {
      const inView = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return b.bottom > 0 && b.top < innerHeight && b.height > 0; };
      const view = document.querySelector('#view').getBoundingClientRect();
      const sel = document.querySelector('#sel').getBoundingClientRect();
      const row = document.querySelector('.parts button[aria-pressed="true"]');
      const rb = row?.getBoundingClientRect();
      const scroller = document.querySelector('.panel-scroll');
      return { scrollY: Math.round(scrollY), viewVisibleH: Math.round(Math.max(0, Math.min(view.bottom, innerHeight) - Math.max(view.top, 0))), cardVisible: inView(document.querySelector('#sel')), /* r6: in the viewport is not enough, it must not be under the pinned model */ cardUncovered: (() => { const t = document.querySelector('#sel-t').getBoundingClientRect(); const e = document.elementFromPoint(t.left + Math.min(20, t.width / 2), t.top + Math.min(t.height / 2, 8)); return !!e && !!e.closest('#sel'); })(), cardTop: Math.round(sel.top), row: row?.dataset.part ?? null, rowVisible: row ? (rb.top >= 0 && rb.bottom <= innerHeight && (!scroller || (rb.top >= scroller.getBoundingClientRect().top && rb.bottom <= scroller.getBoundingClientRect().bottom + 1))) : null, rowTop: rb ? Math.round(rb.top) : null, panelScrollTop: scroller ? Math.round(scroller.scrollTop) : null };
    });
    const out2 = {};
    // pick a part from the list (the 40th row), as a visitor scrolling a long list would
    const buttons = page.locator('.parts button');
    const n = await buttons.count();
    out2.rows = n;
    for (const part of ['contacts', 'prism', 'shutterButton']) {
      const b = page.locator(`.parts button[data-part="${part}"]`);
      if (!(await b.count())) { out2[part] = 'no row'; continue; }
      await b.scrollIntoViewIfNeeded(); await b.click(); await page.waitForTimeout(900);
      out2[part] = await vis();
      await page.screenshot({ path: `${out}/${label}-models-${w}-${part}.png` });
    }
    // pick on the model itself
    await page.locator('#clear').click(); await page.waitForTimeout(400);
    await page.evaluate(() => window.scrollTo(0, 0)); await page.locator('.panel-scroll').evaluate(e => e.scrollTop = 0).catch(() => {});
    const vb = await page.locator('#gl').boundingBox();
    await page.mouse.click(vb.x + vb.width * 0.5, vb.y + vb.height * 0.45); await page.waitForTimeout(900);
    out2.modelClick = await vis();
    await page.screenshot({ path: `${out}/${label}-models-${w}-modelclick.png` });
    r[`${w}x${h}`] = out2;
    await context.close();
  }
  return r;
});

// 5, 6, 13, 14, 16: the smaller findings, one measurement each
await run('misc', async () => {
  const r = {};
  {
    // 5: the first-look hint against the Focus card at 1024x768
    const { page, context } = await open(1024, 768, '?piece=cone&lens=n50');
    await page.waitForTimeout(800);
    r.hint1024 = await page.evaluate(() => { const h = document.querySelector('.orbit-hint'); const vis = !!h && !h.hidden && getComputedStyle(h).display !== 'none'; const hb = vis ? h.getBoundingClientRect() : null;
      const cards = [...document.querySelectorAll('.lv-ctl, .lv-read')].filter(e => e.checkVisibility()).map(e => e.getBoundingClientRect());
      return { hintVisible: vis, overlapsCard: hb ? cards.some(c => hb.left < c.right && hb.right > c.left && hb.top < c.bottom && hb.bottom > c.top) : false }; });
    await page.screenshot({ path: `${out}/${label}-hint-1024-focus.png` });
    await context.close();
  }
  {
    // 6: Reset settings and the lens-switch toast
    const { page, context } = await open(1440, 900, '?piece=camera&lens=n50');
    r.resetButton = await page.evaluate(() => { const b = document.getElementById('sc-reset'); return b ? { text: b.textContent, disabled: b.disabled, visible: b.checkVisibility() } : null; });
    await page.evaluate(() => window.p2p.set({ fno: 8, iso: 800, shutter: 1 / 1000, focusM: 1.5 }));
    await page.waitForTimeout(400);
    r.afterChange = await page.evaluate(() => ({ s: window.p2p.scenario(), reset: document.getElementById('sc-reset')?.disabled }));
    if (await page.locator('#sc-reset').count()) { await page.locator('#sc-reset').click({ timeout: 3000 }).catch(() => { r.resetClickFailed = true; }); await page.waitForTimeout(400); }
    r.afterReset = await page.evaluate(() => ({ s: window.p2p.scenario(), toast: document.getElementById('toast')?.hidden ? null : document.getElementById('toast')?.textContent }));
    // lens switch
    await page.evaluate(() => document.querySelector('#sc-lens [data-lens="n500"]').click());
    await page.waitForTimeout(500);
    r.lensSwitch = await page.evaluate(() => ({ focus: window.p2p.scenario().focusM, toast: document.getElementById('toast')?.hidden ? null : document.getElementById('toast')?.textContent }));
    await context.close();
  }
  {
    // 13: the URL on a deeper level after a camera-level pick
    const { page, context } = await open(1440, 900, '?piece=camera&lens=n50&part=iris');
    await page.waitForTimeout(500);
    await page.locator('#steps [data-piece="lens"]').click(); await page.waitForTimeout(800);
    r.optics = await page.evaluate(() => { const u = new URL(location.href); return { piece: u.searchParams.get('piece'), part: u.searchParams.get('part'), from: u.searchParams.get('from'), sel: u.searchParams.get('sel') }; });
    await context.close();
  }
  {
    // 14: the desktop panel returns to Controls when the lens changes while Parts is open
    const { page, context } = await open(1440, 900, '?piece=camera&lens=n50');
    await page.locator('#tab-explain').click(); await page.waitForTimeout(300);
    r.tabBefore = await page.evaluate(() => document.querySelector('#tab-explain').getAttribute('aria-selected'));
    await page.evaluate(() => window.p2p.set({ lens: 's35' })); await page.waitForTimeout(600);
    r.tabAfterLens = await page.evaluate(() => ({ controls: document.querySelector('#tab-controls').getAttribute('aria-selected'), explain: document.querySelector('#tab-explain').getAttribute('aria-selected') }));
    await context.close();
  }
  {
    // 16: the start dialog's links
    const { page, context } = await open(1440, 900, '?piece=camera&lens=n50');
    await page.locator('.start-entry').click(); await page.waitForTimeout(300);
    r.startLinks = await page.evaluate(() => [...document.querySelectorAll('#start-here [data-start]')].map(b => `${b.querySelector('strong').textContent} -> ${b.querySelector('b').textContent}`));
    await context.close();
  }
  return r;
});

// 15: Play the shot's stage while the photograph loads (the full image is held back for a few seconds)
await run('poster', async () => {
  const { page, context } = await open(1440, 900, '?piece=camera&lens=n50');
  await context.route(/examples[/][^/]*[.](jpg|webp)$/, async (route) => { if (/thumb/.test(route.request().url())) return route.continue(); await new Promise(r => setTimeout(r, 3500)); return route.continue(); });
  await page.locator('.shot-launch').first().click();
  await page.waitForTimeout(1800);
  const r = await page.evaluate(() => { const c = document.querySelector('#shot-canvas'); const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i + 3] > 0 && d[i] + d[i + 1] + d[i + 2] > 30) lit++; return { status: document.querySelector('#shot-status').textContent, litSamples: lit, ready: document.querySelector('#shot-dialog').dataset.ready }; });
  await page.screenshot({ path: `${out}/${label}-shot-loading.png` });
  await context.close();
  return r;
});

writeFileSync(`${out}/${label}.json`, JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, null, 1));
await browser.close();
