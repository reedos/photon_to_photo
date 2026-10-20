// Score loop r6 (UX): does each numbered pin of the camera level sit on or beside the part it names?
// For each lens and view, project every pin's anchor and find the nearest visible point of the part's own meshes
// (a pick grid around the anchor). Pass: within PASS px (on the part, or beside it).
//   P2P_URL=http://127.0.0.1:47804/ node tools/score-loop/r6-pins-probe.mjs before [lens ...]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const url = process.env.P2P_URL || 'http://127.0.0.1:47804/';
const [label = 'probe', ...only] = process.argv.slice(2);
const out = 'docs/score-loop/r6-ux';
mkdirSync(out, { recursive: true });
const PASS = 20; // the pin's disc is 24 px across: within 20 px of the part's own pixels is on it or beside it
const PARTS = {
  lens: ['barrel', 'barrelCut'], focusRing: ['focusRing', 'distanceScale', 'controlRing', 'focusRingCut', 'distanceScaleCut'], iris: ['irisHousing', 'irisHousingCut', 'irisBlades'], glass: ['glass'], mount: ['mount', 'lensMount', 'lensMountCut'],
  sensor: ['pixelArray', 'sensorPackage'], shutter: ['shutter', 'shutterCurtainFront', 'shutterCurtainRear', 'ibisPlate'], viewfinder: ['mirror', 'subMirror', 'focusingScreen', 'prism', 'evfPanel', 'evfHousing', 'prismHousing', 'eyecup', 'evfEyecup', 'evfPanelCarrier', 'eyepieceOptics'],
};
// parts that sit inside something from the default outside view: their pin belongs on the surface that hides them
const BODY = ['shellClosed', 'frontRubber', 'grip', 'rearScreen', 'portDoor', 'strapLug', 'hotShoe', 'topLcd'];
const HOST_OUTSIDE = { iris: ['barrel'], glass: ['filterGlass', 'barrel', 'hoodBayonet'], sensor: BODY, shutter: BODY, viewfinder: [...BODY, 'prismHousing', 'eyecup', 'evfHousing', 'evfEyecup'] };
const LENSES = only.length ? only : ['s35', 'n50', 'n500', 'n500fl', 'z35', 'm50', 'z800'];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const results = {};
for (const lens of LENSES) {
  for (const view of ['outside', 'cutaway']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${url}?piece=camera&lens=${lens}&focus=15${view === 'cutaway' ? '&view=cutaway' : ''}`);
    await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 });
    await page.evaluate(() => window.p2p.settle?.());
    await page.waitForTimeout(2500);
    if (view === 'cutaway') { const on = await page.evaluate(() => document.body.dataset.modelView); if (on !== 'cutaway') await page.locator('#hud-switches [data-view="cutaway"]').click(); await page.waitForTimeout(2500); }
    const r = await page.evaluate(({ PARTS, PASS, HOST, outside }) => {
      const cam = window.p2p.pieces.camera;
      const comp = new Map(); for (const m of cam.visibleMeshes()) comp.set(m.name, m.component || m.name);
      const nearest = (ax, ay, parts) => {
        let best = Infinity;
        for (let dy = -90; dy <= 90; dy += 6) for (let dx = -90; dx <= 90; dx += 6) {
          const d = Math.hypot(dx, dy); if (d >= best) continue;
          const hit = cam.pick(ax + dx, ay + dy)[0];
          if (!hit) continue;
          const c = comp.get(hit.name) ?? hit.name;
          if (parts.includes(c) || parts.includes(hit.name) || parts.some((p) => hit.name.startsWith(p) || (p === 'glass' && /^element\d+/.test(c)))) best = d;
        }
        return best;
      };
      return window.p2p.pins().map((p) => ({ id: p.id, pin: [Math.round(p.x), Math.round(p.y)], anchor: [Math.round(p.anchorX), Math.round(p.anchorY)], leader: Math.round(Math.hypot(p.x - p.anchorX, p.y - p.anchorY)), gap: nearest(p.anchorX, p.anchorY, [...(PARTS[p.id] ?? [p.id]), ...(outside ? HOST[p.id] ?? [] : [])]) }));
    }, { PARTS, PASS, HOST: HOST_OUTSIDE, outside: view === 'outside' });
    results[`${lens} ${view}`] = r.map((p) => ({ ...p, gap: p.gap === Infinity ? '>90' : p.gap, ok: p.gap <= PASS }));
    await page.screenshot({ path: `${out}/${label}-pins-${lens}-${view}.png` });
    await context.close();
  }
}
await browser.close();
writeFileSync(`${out}/${label}-pins.json`, JSON.stringify(results, null, 1));
let bad = 0;
for (const [k, v] of Object.entries(results)) { const f = v.filter((p) => !p.ok); bad += f.length; console.log(k, f.length ? 'FAIL ' + f.map((p) => `${p.id}(${p.gap})`).join(' ') : 'ok'); }
console.log('failing pins:', bad);
