// Score loop r4: the neighbour prefetch: which model files the camera fetched while it sat idle, and whether a swap then
// fetches anything.   P2P_URL=http://127.0.0.1:47807/ node tools/score-loop/r4-prefetch.mjs
import { chromium } from 'playwright';
const url = process.env.P2P_URL || 'http://127.0.0.1:47807/';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
await page.goto(url + '?piece=camera&lens=n50');
await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded && document.getElementById('veil').classList.contains('off'));
const conn = await page.evaluate(() => navigator.connection?.effectiveType);
await page.waitForTimeout(14000);
const glbs = () => page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /\.glb$/.test(e.name)).map((e) => e.name.split('/').slice(-1)[0] + ':' + Math.round(e.startTime)));
console.log('effectiveType', conn, 'after 14 s idle', JSON.stringify(await glbs()));
const n0 = (await glbs()).length;
await page.evaluate(() => window.p2p.set({ lens: 's35' }));
await page.waitForFunction(() => window.p2p.pieces.camera.state().lens === 's35' && document.getElementById('veil').classList.contains('off'));
console.log('files fetched by the swap to s35:', (await glbs()).length - n0);
await browser.close();
