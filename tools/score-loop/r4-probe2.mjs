import { chromium } from 'playwright';
const url = process.env.P2P_URL || 'http://127.0.0.1:47807/';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text().slice(0, 200)); });
await page.goto(url + '?piece=camera');
await page.waitForFunction(() => window.p2p?.pieces.camera);
await page.evaluate(() => { window.p2p.set({ lens: 'n50', fno: 4, focusM: 3 }); window.p2p.piece('lens'); });
await page.evaluate(() => window.p2p.settle());
await page.locator('.diffraction-launch:visible button').click();
const dialog = page.locator('#diffraction-lens');
await dialog.waitFor({ state: 'visible' });
await page.waitForTimeout(500);
const r = await page.evaluate(() => {
  const sheets = [...document.styleSheets].map((s) => (s.href || 'inline').split('/').slice(-1)[0] + ':' + (s.disabled ? 'disabled' : s.media.mediaText || 'all'));
  const header = document.querySelector('#diffraction-lens header');
  const layout = document.querySelector('#diffraction-lens .diffraction-layout');
  const rules = [];
  for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) if ((r.selectorText || '').includes('diffraction-layout') || (r.cssText || '').startsWith('@media') && r.cssText.includes('diffraction-layout')) rules.push((sh.href || '').split('/').pop() + ' ' + r.cssText.slice(0, 120)); } catch (e) { rules.push('ERR ' + e.message); } }
  const el = document.querySelector('#diffraction-lens .diffraction-layout');
  return { rules, classOfLayout: document.querySelector('#diffraction-lens')?.innerHTML.slice(0, 400), matches: el && el.matches('.diffraction-layout'), sheets, headerDisplay: header && getComputedStyle(header).display, layoutDisplay: layout && getComputedStyle(layout).display,
    links: [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.getAttribute('href') + ':' + l.media) };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
