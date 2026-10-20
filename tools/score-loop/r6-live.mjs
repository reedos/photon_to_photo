// Score loop r6 (teaching): the live exposure line under the Camera sliders at the default and at the extremes.
//   P2P_URL=http://127.0.0.1:47803/ node tools/score-loop/r6-live.mjs shots/r6-teaching/after/live [width]
import { chromium } from 'playwright';

const url = new URL('?piece=camera', process.env.P2P_URL || 'http://127.0.0.1:47803/').href;
const out = process.argv[2] || 'shots/r6-teaching/live';
const width = Number(process.argv[3]) || 1440;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 900 }, reducedMotion: 'reduce' });
await page.goto(url); await page.waitForFunction(() => window.p2p?.pieces?.camera); await page.waitForTimeout(4000);
const set = (id, v) => page.evaluate(([id, v]) => { const i = document.getElementById(id); i.value = String(v); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
const live = async () => page.evaluate(() => { const e = document.getElementById('sc-live'); return { text: e?.textContent, visible: !!e?.checkVisibility(), fontPx: e && getComputedStyle(e).fontSize, iso: document.getElementById('sc-iso-v')?.textContent, isoBox: document.getElementById('sc-iso-v')?.getBoundingClientRect().width }; });
console.log('default', JSON.stringify(await live()));
await page.screenshot({ path: `${out}-default.png` });
const maxIso = await page.evaluate(() => document.getElementById('sc-iso').max);
await set('sc-iso', maxIso); await set('sc-shutter', 0); await page.waitForTimeout(800);
console.log('iso max, shutter fastest', JSON.stringify(await live()));
await page.screenshot({ path: `${out}-extreme.png` });
await browser.close();
