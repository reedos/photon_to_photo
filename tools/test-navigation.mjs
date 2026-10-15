// Navigation parity gate: persistent parts, bounded menus, drill/return and reference-page round trips.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';
const server = process.env.P2P_URL ? null : await startPreview();
const url = process.env.P2P_URL || server.url;
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
mkdirSync('shots/navigation/verified', { recursive: true });
try {
  for (const [width, height] of [[1440, 900], [1366, 768], [390, 844], [320, 740]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce', isMobile: width < 760, hasTouch: width < 760 });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${url}?piece=camera&lens=n50&focus=1.5&iso=400`);
    await page.waitForFunction(() => window.p2p?.pieces.camera);
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    // Overview is a separate navigation action, not a camera component.
    const ids = await page.locator('#parts button').evaluateAll(buttons => buttons.map(b => b.dataset.partId).filter(id => id !== 'overview'));
    const detail = () => page.evaluate(() => window.p2p.pieces.camera.detail());
    assert.equal(await detail(), null);
    await page.locator('#part-prev').click(); assert.equal(await detail(), ids.at(-1));
    await page.locator('#part-next').click(); assert.equal(await detail(), null);
    for (const id of ids) {
      await page.locator('#part-next').click(); assert.equal(await detail(), id);
      assert.equal(await page.locator('#parts button:visible').count(), ids.length + 1, 'every part and Overview remain visible after selecting a part');
      // A wide inspector keeps the part list at the top. A phone's ~110 px dock scrolls itself to the new part's card
      // instead (ux r1, ui.ts revealCard), so there the card's heading must be on screen in the dock.
      if (width >= 760) assert.equal(await page.locator('#studio-explain').evaluate(el => el.scrollTop), 0, 'the part list is not scrolled away');
      else assert.ok(await page.waitForFunction(() => { const p = document.querySelector('#studio-explain').getBoundingClientRect(), h = document.querySelector('#card h3')?.getBoundingClientRect(); return !h || (h.top >= p.top - 1 && h.top < p.bottom); }, null, { timeout: 3000 }).then(() => true, () => false), 'the picked part card heading shows in the phone dock');
      const transport = await page.locator('.part-nav').boundingBox();
      assert.ok(transport.y >= 0 && transport.y + transport.height <= height, 'previous/next stay in view');
      if (width > 760) {
        const list = await page.locator('#parts').boundingBox();
        assert.ok(list.y + list.height <= height, 'all parts fit on desktop');
      }
    }
    await page.locator('#part-next').click(); assert.equal(await detail(), null);
    assert.equal(await page.locator('#studio-explain').isVisible(), true, 'overview keeps Parts open');
    await page.locator('#gl').focus(); await page.locator('#gl').press('ArrowRight'); assert.equal(await detail(), ids[0]);
    await page.locator('#tab-controls').click();
    await page.locator('#sc-iso').focus(); await page.locator('#sc-iso').press('ArrowRight'); assert.equal(await detail(), ids[0], 'slider arrows do not navigate');
    const shot = await page.evaluate(() => window.p2p.scenario());
    if (width < 760) await page.locator('#phone-settings-close').click();
    await page.locator('#tab-explain').click();
    for (const [part, piece] of [['iris', 'lens'], ['focusRing', 'cone'], ['sensor', 'loupe']]) {
      await page.locator(`#parts [data-part-id="${part}"]`).click();
      const door = await page.locator('#card-go').boundingBox();
      assert.ok(door && door.y + door.height <= height, 'Go inside is visible without scrolling');
      await page.locator('#card-go').click();
      await page.waitForFunction((want) => new URLSearchParams(location.search).get('piece') === want, piece);
      assert.equal(new URL(page.url()).searchParams.get('piece'), piece);
      await page.locator('.inspection-back').click(); await page.waitForFunction(() => window.p2p.framing().piece === 'camera'); assert.equal(await detail(), part);
      assert.deepEqual(await page.evaluate(() => window.p2p.scenario()), shot, 'drill/return preserves the shot');
    }
    await page.reload(); await page.waitForFunction(() => window.p2p?.pieces.camera);
    await page.evaluate(() => window.p2p.pieces.camera.ready()); assert.equal(await detail(), 'sensor');
    await page.evaluate(() => window.p2p.settle());
    const beforeReset = await page.evaluate(() => window.p2p.pieces.camera.camDebug().pos);
    await page.locator('#reset-view').click();
    await page.evaluate(() => window.p2p.settle());
    assert.deepEqual(await page.evaluate(() => window.p2p.pieces.camera.camDebug().pos), beforeReset, 'reset retains the current part framing');
    assert.equal(await page.locator('#parts button:visible').count(), ids.length + 1);
    await page.locator('#card').evaluate(el => el.scrollTop = el.scrollHeight);
    assert.equal(await page.locator('#parts button:visible').count(), ids.length + 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    await page.evaluate(() => window.p2p.settle());
    await page.screenshot({ path: `shots/navigation/verified/parts-${width}.png` });
    if (width < 900) { await page.locator('#menu-btn').click(); await page.keyboard.press('Escape'); assert.equal(await page.locator('#menu-btn').getAttribute('aria-expanded'), 'false'); await page.locator('#menu-btn').click(); }
    await page.locator('#topnav a[href*="page=glossary"]').click();
    await page.locator('#ref-search').fill('aperture'); assert.ok(await page.locator('[data-search]:visible').count() > 0);
    await page.locator('#ref-search').fill('zzz-no-such-term'); assert.equal(await page.locator('[data-search]:visible').count(), 0);
    if (width < 900) await page.locator('#menu-btn').click();
    await page.locator('#topnav [data-return-view]').click(); await page.waitForFunction(() => window.p2p?.pieces.camera);
    assert.deepEqual(await page.evaluate(() => window.p2p.scenario()), shot, 'reference page returns to the same shot');
    assert.equal(new URL(page.url()).searchParams.get('part'), 'sensor');
    for (const name of ['story', 'evidence', 'method', 'glossary', 'parts']) {
      await page.goto(new URL(`reference.html?page=${name}`, url).href);
      await page.waitForSelector('h1'); assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'index, follow');
      assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), `https://reedos.dev/photon_to_photo/reference.html?page=${name}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      if (name === 'evidence') assert.ok(await page.locator('.evidence-row').count() > 10, 'source index is populated from actual records');
      if (name === 'parts') assert.equal(await page.locator('[data-part]').count(), 8);
      if (width === 390 || width === 1440) await page.screenshot({ path: `shots/navigation/verified/reference-${name}-${width}.png` });
    }
    assert.deepEqual(errors, []);
    console.log(`PASS navigation ${width}: cycle/overview, persistent parts, Go inside/return, keyboard, menu, references, preserved shot, no overflow/errors`);
    await page.close();
  }
} finally { await browser.close(); await server?.close(); }
