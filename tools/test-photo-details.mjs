// Actual interactions, crop geometry and viewport checks for the real-photo inspector.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const output = process.env.P2P_AUDIT_OUTPUT || 'shots/photo-details';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(25000);
const report = { errors: [], samples: [] };
page.on('pageerror', error => report.errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
async function sample(name) {
  if (await page.locator('.rp-detail-controls button').first().getAttribute('aria-pressed') === 'false') await page.locator('.rp-detail-crop').waitFor({ state: 'visible' });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const state = await page.evaluate(() => {
    const crop = document.querySelector('.rp-detail-crop');
    const img = crop.querySelector('.rp-crop-window img');
    const box = crop.querySelector('.rp-crop-window').getBoundingClientRect();
    const frame = document.querySelector('.rp-image-frame').getBoundingClientRect();
    const buttons = [...document.querySelectorAll('.rp-detail-controls button, #rp-play, #rp-match, .rp-read-explanation')].filter(el => el.checkVisibility()).map(el => {
      const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { label: el.textContent, hit: hit === el || el.contains(hit), width: r.width, height: r.height };
    });
    return { full: crop.hidden, source: img.getAttribute('src'), original: document.querySelector('#rp-img').currentSrc,
      crop: { x: box.x, y: box.y, right: box.right, bottom: box.bottom },
      frame: { x: frame.x, y: frame.y, right: frame.right, bottom: frame.bottom }, buttons,
      document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight], viewport: [innerWidth, innerHeight] };
  });
  report.samples.push({ name, ...state });
  assert.ok(state.document[0] <= state.viewport[0] + 1 && state.document[1] <= state.viewport[1] + 1, `${name}: no page overflow`);
  assert.ok(state.frame.bottom - state.frame.y >= 90, `${name}: photograph retains a usable height`);
  for (const button of state.buttons) assert.ok(button.hit && button.width >= 30 && button.height >= 30, `${name}: visible control ${button.label}`);
  if (!state.full) {
    assert.equal(state.source, state.original, `${name}: crop uses the unchanged original JPEG`);
    assert.ok(state.crop.x >= state.frame.x - 1 && state.crop.y >= state.frame.y - 1 && state.crop.right <= state.frame.right + 1 && state.crop.bottom <= state.frame.bottom + 1, `${name}: crop remains inside image frame`);
  }
  await page.screenshot({ path: `${output}/${name}.png` });
}
async function explanationMatches(name, escape = false) {
  const expected = await page.locator('#rp-note').textContent();
  const title = await page.locator('#rp-h').textContent();
  const trigger = page.getByRole('button', {name:'Read explanation', exact:true});
  await trigger.click();
  const dialog = page.getByRole('dialog', {name:title, exact:true});
  await dialog.waitFor({state:'visible'});
  assert.equal(await dialog.locator('#rp-explanation-copy').textContent(), expected, 'dialog has complete current explanation');
  const fit = await dialog.evaluate(el => {const r=el.getBoundingClientRect(); return r.x>=0 && r.y>=0 && r.right<=innerWidth && r.bottom<=innerHeight && document.documentElement.scrollHeight<=innerHeight+1;});
  assert.ok(fit, 'full explanation fits viewport without page scrolling');
  await page.screenshot({path:`${output}/${name}-explanation.png`});
  if (escape) await page.keyboard.press('Escape'); else await dialog.getByRole('button', {name:'Close explanation', exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  assert.ok(await trigger.evaluate(el => document.activeElement===el), 'closing returns focus to Read explanation');
}
try {
  await page.goto(new URL('?piece=camera&lens=m50', process.env.P2P_URL || 'http://127.0.0.1:47747/').href);
  await page.waitForFunction(() => window.p2p && document.querySelector('#veil').classList.contains('off'));
  await page.locator('#workspace-photos').click();
  for (let i = 0; i < 6; i++) {
    await page.locator('#rp-picks button').nth(i).click();
    await page.locator('.rp-detail-controls button').nth(1).waitFor();
    await page.waitForFunction(() => !document.querySelector('.rp-detail-controls button').disabled);
    await page.locator('.rp-detail-controls button').nth(1).click(); await sample(`photo-${i}-subject`);
    await page.locator('.rp-detail-controls button').nth(2).click(); await sample(`photo-${i}-depth`);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.rp-detail-crop').isVisible(), false, 'Escape restores full image');
  }
  for (const [width,height] of [[1280,600],[390,844],[320,568]]) {
    await page.setViewportSize({ width,height });
    for (const i of [2,3,5]) {
      await page.locator('#rp-picks button').nth(i).click();
      await page.waitForFunction(() => !document.querySelector('.rp-detail-controls button').disabled);
      await sample(`${width}-${height}-${i}-full`);
      if(width<=390) await explanationMatches(`${width}-${height}-${i}-full`);
      await page.locator('.rp-detail-controls button').nth(1).click(); await sample(`${width}-${height}-${i}-crop`);
      if(width<=390) await explanationMatches(`${width}-${height}-${i}-crop`, true);
    }
  }
  // A decode completing after navigation must not install a stale crop over a new photo.
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function() {
      const result = decode.call(this);
      return this.closest('.rp-crop-window') ? result.then(() => new Promise(resolve => setTimeout(resolve, 1000))) : result;
    };
  });
  await page.locator('.rp-detail-controls button').first().click();
  await page.locator('.rp-detail-controls button').nth(2).click();
  assert.equal(await page.locator('#rp-img').evaluate(el => getComputedStyle(el).visibility), 'visible', 'full photo remains while crop decodes');
  await page.getByRole('button', {name:'Next photograph', exact:true}).click();
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('.rp-detail-crop').isVisible(), false, 'stale crop decode cannot cover the next photograph');
  await page.locator('#rp-match').click();
  assert.equal(await page.locator('#workspace-model').getAttribute('aria-selected'),'true');
  assert.deepEqual(report.errors, []);
  console.log(`PASS ${report.samples.length} real-photo detail captures, zero console errors`);
} finally {
  writeFileSync(`${output}/report.json`, JSON.stringify(report,null,2));
  await browser.close();
}
