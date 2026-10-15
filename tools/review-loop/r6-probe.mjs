// Score loop r6: reads the Sensor readout lesson on both bodies, the sensor card levels, the lens card focal length rows and the
// Evidence page header from the live app; writes a JSON file and the Z8 lesson screenshot.
//   P2P_URL=http://127.0.0.1:47801/ OUT=docs/score-loop/r6-physics/after node tools/review-loop/r6-probe.mjs
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.env.OUT || 'docs/score-loop/r6-physics/after';
const base = process.env.P2P_URL || 'http://127.0.0.1:47801/';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
page.on('pageerror', (e) => console.log('ERR', String(e)));
const result = {};

async function open(url) {
  await page.goto(new URL(url, base).href);
  await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 });
  await page.waitForTimeout(800);
}

for (const [tag, lens] of [['z8', 'z35'], ['d850', 'n50']]) {
  await open(`?piece=camera&lens=${lens}`);
  await page.getByRole('button', { name: /sensor readout/i }).first().click();
  await page.waitForTimeout(1200);
  const probe = await page.evaluate(() => {
    const vis = (e) => !!e && !e.hidden && e.getClientRects().length > 0;
    const sw = document.getElementById('scan-mode-switch');
    return {
      modeText: document.getElementById('scan-mode-text')?.textContent,
      switchVisible: vis(sw), switchText: sw?.textContent,
      scanDetail: document.getElementById('scan-detail')?.textContent,
      adc: document.getElementById('adc-value')?.textContent,
    };
  });
  result[`readout-${tag}`] = probe;
  await page.screenshot({ path: `${out}/readout-${tag}.png` });
}

await open('?piece=camera&lens=n50');
result.model = await page.evaluate(() => {
  const m = window.p2p.model();
  return { grayMetered: m.exposure.grayRawFractionMetered, isoExpected: m.exposure.isoExpectedRawFraction, electrons: m.exposure.electronsMidGray, snr: m.exposure.snrMidGray, qePeak: m.sensor.figs.qePeak.v, measuredIsoFactor: m.sensor.measuredIsoFactor, readoutS: m.sensor.readoutS };
});
await page.goto(new URL('reference.html?page=evidence', base).href);
await page.waitForSelector('#evidence-summary:not([hidden])', { timeout: 30000 });
result.evidence = await page.evaluate(() => ({ summary: document.getElementById('evidence-summary')?.innerText }));
await page.screenshot({ path: `${out}/evidence-header.png`, clip: { x: 0, y: 0, width: 1440, height: 700 } });
writeFileSync(`${out}/r6-probe.json`, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
await browser.close();
