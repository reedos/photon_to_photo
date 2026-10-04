// A pending lazy dialog must not open after Escape or leaving/re-entering Pixel.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';
const server = process.env.P2P_URL ? null : await startPreview();
const base = process.env.P2P_URL || server.url;
const output = process.env.P2P_AUDIT_OUTPUT || 'shots/photon-launch-navigation';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const report = { checks: [], errors: [] };
try {
  for (const cancellation of ['escape', 'leave-return']) {
    const context = await browser.newContext({ viewport: { width:1366, height:900 }, reducedMotion:'no-preference' });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate:4 });
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let requested;
    const started = new Promise(resolve => { requested = resolve; });
    await page.route(/\/(?:assets\/photon-rain-[^/]+\.js|src\/app\/photon-rain\.ts)(?:\?.*)?$/, async route => {
      requested(); await held; await route.continue();
    });
    try {
      await page.goto(new URL('?piece=loupe&lens=m50', base).href);
      await page.waitForFunction(() => window.p2p?.pieces.loupe.state().hasPixel);
      const launch = page.locator('.rain-launch');
      await launch.click();
      let timeout;
      try {
        await Promise.race([started, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Lazy module request not observed')), 15000); })]);
      } finally { clearTimeout(timeout); }
      assert.equal(await launch.isDisabled(), true, 'launch is pending while its real module request is held');
      if (cancellation === 'escape') await page.keyboard.press('Escape');
      else {
        await page.locator('#steps [data-piece="camera"]').click();
        await page.locator('#steps [data-piece="loupe"]').click();
      }
      release();
      await page.waitForFunction(() => !document.querySelector('.rain-launch').disabled);
      assert.equal(await page.locator('#photon-rain').isVisible(), false, `${cancellation}: canceled import cannot open late`);
      report.checks.push(`${cancellation}: pending import canceled`);
      await launch.click();
      await page.locator('#photon-rain').waitFor({ state:'visible' });
      // Native close events are queued. A same-turn reopen must keep playing
      // and retain modal focus when the older close event is delivered.
      await page.evaluate(() => {
        document.querySelector('#photon-rain').close();
        document.querySelector('.rain-launch').click();
      });
      await page.waitForFunction(() => Number(document.querySelector('#photon-rain').dataset.progress) > .02);
      assert.equal(await page.locator('#photon-rain').getAttribute('data-playing'), 'true');
      assert.equal(await page.locator('#photon-rain').evaluate(dialog => dialog.contains(document.activeElement)), true);
      report.checks.push(`${cancellation}: queued close does not pause or defocus a reopened dialog`);
      // Test visible-dialog dismissal independently of the pending-import case.
      await page.keyboard.press('Escape');
      await page.locator('#photon-rain').waitFor({ state:'hidden' });
      report.checks.push(`${cancellation}: fresh launch and visible Escape work`);
      for (let i = 0; i < 3; i++) {
        await launch.click();
        await page.keyboard.press('Escape');
        await page.locator('#photon-rain').waitFor({ state:'hidden' });
      }
      report.checks.push(`${cancellation}: three immediate warm reopen/Escape cycles`);
      await page.screenshot({ path:`${output}/${cancellation}-returned.png` });
    } finally { release(); await context.close(); }
  }
  assert.deepEqual(report.errors, []);
  console.log(`PASS ${report.checks.length} pending/warm Photon Rain launch groups`);
} catch (error) { report.failure = String(error.stack || error); throw error; }
finally {
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close(); await server?.close();
}
