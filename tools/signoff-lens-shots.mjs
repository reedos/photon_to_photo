import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';

const BASE = 'http://127.0.0.1:47531/';
const OUT = resolve('shots/signoff-lens');
mkdirSync(OUT, { recursive: true });
const GPU_ARGS = ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'];

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: GPU_ARGS });

async function shot(name, viewport, query, waitMs = 1500) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}?${query}`);
  await page.waitForFunction(() => !!(window.p2p && typeof window.p2p.backend === 'function' && window.p2p.backend()), { timeout: 30000 });
  const backend = await page.evaluate(() => window.p2p.backend());
  await page.waitForTimeout(waitMs);
  const canvas = await page.$('canvas');
  if (canvas) await canvas.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
  console.log(JSON.stringify({ name, backend, errors, viewport, query }));
  await ctx.close();
}

await shot('desktop-1600x900', { width: 1600, height: 900 }, 'piece=lens&lens=p50&fno=1.4');
await shot('desktop-1600x900-f16', { width: 1600, height: 900 }, 'piece=lens&lens=p50&fno=16');
await shot('phone-390x844', { width: 390, height: 844 }, 'piece=lens&lens=p50&fno=1.4');
await shot('desktop-webgl2-1600x900', { width: 1600, height: 900 }, 'piece=lens&lens=p50&fno=1.4&gl=webgl2');

await browser.close();
