// Score loop r6 (teaching): the Readout lesson, the tour stops and the Pixel card at a desktop and a phone width.
//   P2P_URL=http://127.0.0.1:47803/ node tools/score-loop/r6-lesson.mjs shots/r6-teaching/after [width]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.P2P_URL || 'http://127.0.0.1:47803/';
const out = process.argv[2] || 'shots/r6-teaching/lesson';
const width = Number(process.argv[3]) || 1440;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const report = {};
try {
  const phone = width < 760;
  const page = await browser.newPage({ viewport: { width, height: phone ? 844 : 900 }, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone });
  await page.goto(new URL('?piece=camera&lesson=readout', base).href);
  await page.waitForFunction(() => window.p2p?.pieces?.camera, null, { timeout: 120000 });
  await page.waitForSelector('#sensor-lesson:not([hidden])', { timeout: 60000 });
  await page.waitForTimeout(2500);
  report.lesson = await page.evaluate(() => {
    const L = document.getElementById('sensor-lesson');
    const box = (e) => e && { top: Math.round(e.getBoundingClientRect().top), h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) };
    const px = (e) => e && getComputedStyle(e).fontSize;
    return { lead: L.querySelector('.lesson-lead')?.textContent, canvas: box(document.getElementById('readout-visual')), howto: box(document.getElementById('readout-howto')),
      howtoOpen: document.getElementById('readout-howto')?.open, modeText: box(document.getElementById('scan-mode-text')), adc: document.getElementById('adc-value')?.textContent,
      notes: [...L.querySelectorAll('.lesson-note')].map((n) => ({ text: n.textContent.slice(0, 80), px: px(n), top: Math.round(n.getBoundingClientRect().top), color: getComputedStyle(n).color })),
      order: [...document.getElementById('readout-lesson').children].map((c) => `${c.tagName.toLowerCase()}${c.id ? '#' + c.id : ''}:${Math.round(c.getBoundingClientRect().top)}`) };
  });
  await page.screenshot({ path: join(out, `lesson-readout-${width}.png`) });
  await page.locator('#sensor-lesson').screenshot({ path: join(out, `lesson-readout-panel-${width}.png`) }).catch(() => undefined);
  writeFileSync(join(out, `lesson-${width}.json`), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report.lesson, null, 1));
  await page.close();
} finally { await browser.close(); }
