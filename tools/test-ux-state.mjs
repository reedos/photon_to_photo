// UX state gate (score loop r2, 10/11/2026): what the address keeps, what Back does, and the layout collisions the
// round 2 reviewers found.
//   - the desktop gesture hint and Share this view never overlap (1280, 1440, 1920)
//   - Real photos: the chosen photograph and detail are in the URL, survive a reload, and Back steps between photos
//   - Play the shot: Back closes the dialog and leaves the view behind it alone; Forward reopens it
//   - the guided tour's stop survives a reload (tour=4)
//   - the arrow keys step through the parts after a pin or Next was clicked
//   - a phone's picked part shows its explanation, not only its title (390x844, 844x390)
//   - one "Go inside" per selected part beside the model; Start here on the reference and models pages
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';

const server = process.env.P2P_URL ? null : await startPreview();
const url = process.env.P2P_URL || server.url;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const Q = '?piece=camera&lens=n50&focus=1.5&iso=400';
async function open(width, height, query = Q) {
  const phone = width < 760 || height < 500;
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${url}${query}`);
  await page.waitForFunction(() => window.p2p?.pieces.camera, null, { timeout: 90000 });
  await page.evaluate(() => window.p2p.pieces.camera.ready());
  return { page, context, errors };
}
const box = (page, sel) => page.locator(sel).first().evaluate(el => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width }; });
const meet = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const params = page => new URL(page.url()).searchParams;
const ready = page => page.waitForFunction(() => window.p2p?.pieces.camera, null, { timeout: 90000 });

try {
  // ---- the desktop hint and Share --------------------------------------------------------------------------
  for (const [w, h] of [[1280, 800], [1440, 900], [1920, 1080]]) {
    const { page, context, errors } = await open(w, h);
    const hint = await box(page, '.workspace-views > span'), share = await box(page, '#share-btn');
    if (hint.w > 0) {
      assert.ok(!meet(hint, share), `${w}: the gesture hint and Share this view overlap`);
      assert.equal(await page.locator('.workspace-views > span').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `${w}: the hint is cut short`);
    }
    assert.deepEqual(errors, []);
    console.log(`hint ${w}: ${hint.w ? `hint ${Math.round(hint.l)}-${Math.round(hint.r)}, Share ${Math.round(share.l)}-${Math.round(share.r)}` : 'hidden'}`);
    await context.close();
  }

  // ---- Real photos keeps the photograph in the address -----------------------------------------------------
  {
    const { page, context, errors } = await open(1440, 900);
    await page.locator('#workspace-photos').click();
    await page.locator('.rp-pick[data-id="fox-portrait"]').click();
    assert.equal(params(page).get('view'), 'photos'); assert.equal(params(page).get('photo'), 'fox-portrait');
    await page.locator('.rp-pick[data-id="mallard"]').click();
    assert.equal(params(page).get('photo'), 'mallard');
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('#rp-h')?.textContent === 'Fox portrait');
    assert.equal(params(page).get('photo'), 'fox-portrait', 'Back returns to the previous photograph');
    await page.locator('.rp-detail-controls button').nth(1).click();
    const crop = params(page).get('crop');
    assert.ok(crop, 'a detail is in the URL');
    await page.reload(); await ready(page);
    await page.waitForFunction(() => document.querySelector('#rp-h')?.textContent === 'Fox portrait', null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => document.body.dataset.workspaceView), 'photos', 'a reload stays in Real photos');
    await page.waitForFunction(() => document.querySelector('.rp-detail-controls button[aria-pressed="true"]')?.textContent !== 'Full photo', null, { timeout: 30000 });
    assert.ok(await page.locator('#rp-share').isVisible(), 'Real photos has its own Share');
    await page.locator('#workspace-model').click();
    assert.equal(params(page).get('photo'), null, 'the model view drops the photograph');
    assert.deepEqual(errors, []);
    console.log(`photos: photo=fox-portrait&crop=${crop} survives a reload; Back steps between photographs`);
    await context.close();
  }

  // ---- Play the shot: Back closes the dialog ---------------------------------------------------------------
  {
    const { page, context, errors } = await open(1440, 900);
    await page.locator('.step[data-piece="lens"]').click();
    await page.locator('.step[data-piece="camera"]').click();
    await page.locator('.shot-launch').click();
    await page.waitForSelector('#shot-dialog[open]');
    assert.ok(params(page).get('shot'), 'the open shot is in the URL');
    await page.goBack();
    await page.waitForFunction(() => !document.querySelector('#shot-dialog')?.open);
    assert.equal(params(page).get('piece'), 'camera', 'Back left the view behind the dialog alone');
    assert.equal(params(page).get('shot'), null);
    await page.goForward();
    await page.waitForFunction(() => document.querySelector('#shot-dialog')?.open);
    await page.locator('#shot-close').click();
    await page.waitForFunction(() => !new URLSearchParams(location.search).has('shot'));
    assert.equal(params(page).get('piece'), 'camera', 'Close returns to the same entry');
    // a link to the shot opens it
    await page.goto(`${url}${Q}&shot=fox-portrait`); await ready(page);
    await page.waitForFunction(() => document.querySelector('#shot-dialog')?.open && document.querySelector('#shot-dialog')?.dataset.source === 'photo:fox-portrait', null, { timeout: 30000 });
    assert.deepEqual(errors, []);
    console.log('shot: Back closes the dialog, Forward reopens it, shot=<id> links open it');
    await context.close();
  }

  // ---- the tour's stop is in the URL ------------------------------------------------------------------------
  {
    const { page, context, errors } = await open(1440, 900);
    await page.locator('#learn-launch').click();
    for (let i = 0; i < 3; i++) await page.locator('#journey-next').click();
    assert.equal(params(page).get('tour'), '4');
    await page.reload(); await ready(page);
    await page.waitForFunction(() => document.querySelector('#journey-stop')?.value === '3', null, { timeout: 30000 });
    assert.ok(await page.locator('#journey').isVisible());
    assert.deepEqual(errors, []);
    console.log('tour: stop 4 survives a reload');
    await context.close();
  }

  // ---- the arrows after a pin or Next -----------------------------------------------------------------------
  {
    const { page, context, errors } = await open(1440, 900);
    const detail = () => page.evaluate(() => window.p2p.pieces.camera.detail());
    const ids = await page.evaluate(() => window.p2p.pins().map(p => p.id));
    // the camera's teaching marks settle for a moment after load, and a pin under one waits for them
    await page.waitForTimeout(2500);
    await page.waitForFunction(id => document.querySelector(`.pin[data-pin-id="${id}"]`)?.checkVisibility(), ids[0], { timeout: 15000 });
    await page.locator(`.pin[data-pin-id="${ids[0]}"]`).click();
    await page.keyboard.press('ArrowRight');
    assert.equal(await detail(), ids[1], 'ArrowRight after a pin click steps to the next part');
    await page.waitForFunction(id => document.activeElement?.dataset?.pinId === id, ids[1]);
    await page.locator('#part-next').click();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await detail(), ids[1], 'ArrowLeft after Next steps back');
    // one way inside per part
    await page.locator('#parts button[data-part-id="sensor"]').click();
    await page.waitForTimeout(400);
    const doors = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => /go inside/i.test(b.textContent) && b.checkVisibility()).length);
    assert.equal(doors, 1, 'one Go inside button beside the model');
    // a slider keeps its own arrows
    await page.locator('#tab-controls').click();
    const before = await detail();
    await page.locator('#sc-iso').focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await detail(), before, 'a slider keeps its arrows');
    assert.deepEqual(errors, []);
    console.log('arrows: pins and Previous/Next step the parts; one Go inside');
    await context.close();
  }

  // ---- a phone's picked part ----------------------------------------------------------------------------------
  for (const [w, h] of [[390, 844], [844, 390]]) {
    const { page, context, errors } = await open(w, h);
    await page.waitForTimeout(2500);
    await page.locator('.pin').nth(2).click();
    await page.waitForTimeout(600);
    const shown = await page.evaluate(() => {
      const panel = document.querySelector('#studio-explain').getBoundingClientRect(), body = document.querySelector('#card-b').getBoundingClientRect();
      return Math.max(0, Math.min(body.bottom, panel.bottom, innerHeight) - Math.max(body.top, panel.top, 0));
    });
    assert.ok(shown >= 60, `${w}x${h}: only ${Math.round(shown)} px of the part's explanation shows`);
    await page.locator('#card-x').click();
    assert.equal(await page.evaluate(() => document.body.classList.contains('inspector-expanded')), false, `${w}x${h}: closing the card lowers the sheet`);
    assert.deepEqual(errors, []);
    console.log(`phone ${w}x${h}: ${Math.round(shown)} px of the explanation shows`);
    await context.close();
  }

  // ---- Start here on every page ---------------------------------------------------------------------------------
  {
    const { page, context } = await open(1440, 900);
    for (const p of ['reference.html?page=story', 'models.html']) {
      await page.goto(`${url}${p}`);
      await page.waitForSelector('#topnav a');
      assert.equal(await page.locator('#topnav a.start-entry').getAttribute('href'), './index.html?start=1', `${p}: Start here`);
    }
    await page.goto(`${url}index.html?start=1`);
    await page.waitForFunction(() => document.body.classList.contains('photo-opening-active'));
    console.log('Start here: on the reference and models pages, and index.html?start=1 opens the opening');
    await context.close();
  }
  console.log('PASS test-ux-state');
} finally {
  await browser.close();
  await server?.close();
}
