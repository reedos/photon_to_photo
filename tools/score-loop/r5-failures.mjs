// Score loop r5: a browser with no 3D, and one drawing in software.
//   1. --disable-gpu --disable-3d-apis (navigator.gpu may exist, no adapter, no WebGL2): the opening warns before the tap; Explore ends on
//      a failure screen with an alert role, the 2D reference link, and none of the controls that need a view.
//   2. SwiftShader (--use-angle=swiftshader): the camera starts, and a note says it is drawn in software and links the reference.
//   P2P_URL=http://127.0.0.1:47807/ OUT=docs/score-loop/r5-perf node tools/score-loop/r5-failures.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const url = (process.env.P2P_URL || 'http://127.0.0.1:47807/').replace(/\/?$/, '/');
const OUT = process.env.OUT || 'shots/r5-failures';
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (ok, what) => { results.push([ok, what]); console.log(ok ? 'ok  ' : 'FAIL', what); };

{
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu', '--disable-3d-apis'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const probe = await page.goto(url).then(() => page.evaluate(async () => ({ gpu: 'gpu' in navigator, adapter: navigator.gpu ? !!(await navigator.gpu.requestAdapter().catch(() => null)) : null, webgl2: !!document.createElement('canvas').getContext('webgl2') })));
  console.log('environment', JSON.stringify(probe));
  await page.locator('#opening-explore').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.getElementById('opening-no3d')?.hidden, null, { timeout: 8000 }).catch(() => {});
  check(await page.evaluate(() => !document.getElementById('opening-no3d').hidden), 'the opening warns that this browser cannot draw the 3D view');
  await page.screenshot({ path: `${OUT}/no3d-opening-390.png` });
  await page.locator('#opening-explore').tap();
  await page.waitForSelector('#veil.err', { timeout: 30000 });
  await page.waitForTimeout(800);
  const state = await page.evaluate(() => {
    const shown = (sel) => { const el = document.querySelector(sel); return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    return {
      role: document.getElementById('veil').getAttribute('role'), message: document.getElementById('veil-msg').textContent,
      reference: shown('#veil-reference'), referenceHref: document.getElementById('veil-reference')?.getAttribute('href'),
      leftOver: ['#equipment-toggle', '#expand-model', '.inspector-tab-row', '#tab-controls', '#tab-explain', '#scenario', '#hud-btns-phone'].filter(shown),
    };
  });
  console.log(JSON.stringify(state));
  check(state.role === 'alert', 'the failure veil has role="alert"');
  check(state.reference && state.referenceHref === 'reference.html', 'the failure offers the 2D reference');
  check(state.leftOver.length === 0, `no control that needs a view stays on screen (left: ${state.leftOver.join(', ') || 'none'})`);
  await page.screenshot({ path: `${OUT}/no3d-failure-390.png` });
  await browser.close();
}

{
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(180000);
  await page.goto(url + '?piece=camera&lens=n50&gl=webgl2');
  await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded && document.getElementById('veil').classList.contains('off'));
  await page.waitForTimeout(1500);
  const note = await page.evaluate(() => ({ text: document.querySelector('.soft-note')?.textContent ?? null, href: document.querySelector('.soft-note a')?.getAttribute('href'), role: document.querySelector('.soft-note')?.getAttribute('role'), tier: window.p2p.backend() }));
  console.log(JSON.stringify(note));
  check(!!note.text && note.href === 'reference.html', 'a software renderer is named, and the 2D reference is offered');
  await page.screenshot({ path: `${OUT}/software-gl-390.png` });
  await page.locator('.soft-note button').tap();
  check(await page.evaluate(() => !document.querySelector('.soft-note')), 'the note can be dismissed');
  await browser.close();
}
// 3. the opening's photograph fails to load; and the camera's code fails to load
{
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.route(/\/examples\/[^/]+\.(jpe?g|webp|png)(\?|$)/, (route) => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto(url);
  await page.locator('#opening-explore').waitFor({ state: 'visible' });
  await page.waitForTimeout(1500);
  const photo = await page.evaluate(() => { const fig = document.querySelector('.opening-photo'); const r = fig.getBoundingClientRect(); const img = fig.querySelector('img'); return { failed: fig.classList.contains('photo-failed'), imgShown: img.getClientRects().length > 0, figureHeight: Math.round(r.height), before: getComputedStyle(fig, '::before').content }; });
  console.log(JSON.stringify(photo));
  check(photo.failed && !photo.imgShown && /could not be loaded/.test(photo.before) && photo.figureHeight > 150 && photo.figureHeight < 330, 'a photograph that does not load leaves a neutral frame with a line saying so, not a broken-image icon');
  await page.screenshot({ path: `${OUT}/photo-failed-390.png` });
  await context.close();
  const context2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page2 = await context2.newPage();
  await page2.route(/\/assets\/app-start-[^/]+\.js/, (route) => route.abort('failed'));
  await page2.goto(url + '?piece=camera&lens=n50');
  await page2.waitForSelector('#veil.err', { timeout: 20000 });
  const fail = await page2.evaluate(() => ({ role: document.getElementById('veil').getAttribute('role'), link: document.getElementById('veil-reference')?.getAttribute('href') }));
  console.log(JSON.stringify(fail));
  check(fail.role === 'alert' && fail.link === 'reference.html', 'a camera that could not load says so as an alert and offers the 2D reference');
  await page2.screenshot({ path: `${OUT}/camera-load-failed-390.png` });
  await browser.close();
}
const failed = results.filter(([ok]) => !ok);
console.log(failed.length ? `${failed.length} of ${results.length} failed` : `all ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
