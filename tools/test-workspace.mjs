// Verify the default working surface fits, and compact controls retain real engine actions.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';

const server = process.env.P2P_URL ? null : await startPreview();
const url = process.env.P2P_URL || server.url;
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  for (const [width, height] of [[1440, 900], [1366, 768], [1024, 768], [768, 1024], [390, 844], [320, 740]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce',
      isMobile: width < 760, hasTouch: width < 760 });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${url}?piece=camera&lens=n50`);
    await page.waitForFunction(() => window.p2p?.pieces.camera);
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    // The synthetic final photo and the scene picker were removed on purpose (c6209df); the model view replaces the photo.
    assert.equal(await page.locator('#finalimg-canvas,#kit-scene').count(), 0, 'removed photo and scene controls stay absent');
    for (const selector of ['#gl', '#compact-fire', ...(width<600?['#tab-controls','#tab-explain']:['#sc-fno', '#sc-focus', '#sc-shutter', '#sc-iso'])]) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= height, `${selector} fits ${width}×${height}: ${JSON.stringify(box)}`);
    }
    if(width<600) {
      assert.equal(await page.locator('#kit-body').isVisible(),false,'compact equipment starts collapsed');
      await page.locator('#equipment-toggle').click();
    }
    for(const selector of ['#kit-body','#kit-lens']) {
      const box=await page.locator(selector).boundingBox();
      assert.ok(box && box.y>=0 && box.y+box.height<=height,`${selector} equipment editor fits viewport`);
    }
    await page.locator('#kit-body').selectOption('mirrorless');
    assert.equal(await page.evaluate(() => window.p2p.scenario().lens), 'm50');
    assert.equal(await page.evaluate(() => window.p2p.model().scenario.sensor), 'full-frame-z8');
    await page.locator('#kit-lens').selectOption('z800');
    assert.equal(await page.evaluate(() => window.p2p.scenario().lens), 'z800');
    const before = await page.evaluate(() => window.p2p.scenario().iso);
    await page.locator('#sc-iso').focus();
    await page.locator('#sc-iso').press('ArrowRight');
    assert.ok(await page.evaluate(value => window.p2p.scenario().iso > value, before));
    if(width<600) await page.locator('#phone-settings-close').click();
    await page.locator('#tab-controls').focus();
    await page.locator('#tab-controls').press('ArrowRight');
    if(width>=600) assert.equal(await page.locator('#tab-explain').getAttribute('aria-selected'), 'true');
    // the drawer's close event, which brings the Parts dock back, fires a task later; wait for it rather than race it
    await page.locator('#studio-explain').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#parts button[data-part-id="iris"]').click();
    assert.equal(await page.locator('#card').isVisible(), true);
    const view = await page.locator('#gl').boundingBox();
    assert.ok(view.y >= 0 && view.y + view.height <= height, 'model view stays in view while reading a part');
    assert.equal(await page.locator('#gl').evaluate(canvas => {
      const box = canvas.getBoundingClientRect();
      return document.getElementById('view').contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    }), true, 'part explanation does not cover the model view');
    await page.locator('#steps [data-piece="camera"]').click();
    assert.equal(await page.locator('#studio-explain').isVisible(), true, 'overview does not hide the parts pane');
    await page.locator('#tab-controls').click();
    if(width<600) await page.locator('#phone-settings-close').click();
    await page.locator('#compact-fire').click();
    assert.equal(await page.evaluate(() => window.p2p.pieces.camera.exposure().status), 'paused');
    if(width<600) await page.locator('#tab-controls').click();
    assert.equal(await page.locator('.rx-scrub').isVisible(), true);
    if(width<600) await page.locator('#phone-settings-close').click();
    // Pixel inspection used to open from the photo; it is now the Pixel level, reached by keyboard from the level strip.
    await page.locator('#steps [data-piece="loupe"]').focus();
    await page.locator('#steps [data-piece="loupe"]').press('Enter');
    await page.waitForFunction(() => window.p2p.framing().piece === 'loupe' && window.p2p.pieces.loupe.state().hasPixel);
    assert.equal(new URL(page.url()).searchParams.get('piece'), 'loupe');
    assert.equal(await page.locator('#gl').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log(`PASS workspace ${width}×${height}: visible controls/model view, selectors, keyboard tabs, part return, playback, pixel inspection`);
    await page.close();
  }
} finally { await browser.close(); await server?.close(); }
