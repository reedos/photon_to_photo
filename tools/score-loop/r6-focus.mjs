// Score loop r6: why focus did not return to the equipment toggle after the phone Settings sheet closed.
import { chromium } from 'playwright';
const url = process.env.P2P_URL || 'http://127.0.0.1:47804/';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });
await page.goto(`${url}?piece=camera&lens=m50`);
await page.waitForFunction(() => window.p2p?.pieces.camera);
await page.evaluate(() => window.p2p.pieces.camera.ready());
await page.waitForTimeout(2500);
await page.locator('#equipment-toggle').click();
console.log('active after open', await page.evaluate(() => document.activeElement.id));
await page.locator('#kit-body').selectOption('dslr'); await page.locator('#kit-lens').selectOption('n50');
await page.evaluate(() => { window.__log = []; document.addEventListener('focusin', (e) => window.__log.push('in:' + (e.target.id || e.target.tagName)), true); });
await page.locator('#phone-settings-close').click();
await page.waitForTimeout(300);
console.log(await page.evaluate(() => ({ active: document.activeElement.id, log: window.__log, toggleVisible: document.querySelector('#equipment-toggle').checkVisibility(), bodyCls: document.body.className, dlg: document.querySelector('#phone-settings').open })));
await browser.close();
