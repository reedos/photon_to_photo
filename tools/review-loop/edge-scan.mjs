// Correctness review loop, 10/10/2026: scan every lens's realized system (as the live page builds it) for
// consecutive surfaces that cross inside their clear apertures (negative edge thickness). Pure geometry from the
// surface data, independent of the tracer: gap(h) = (z2 + sag2(h)) - (z1 + sag1(h)) for h up to min(sd1, sd2).
//
//   P2P_URL=http://127.0.0.1:47630/ node tools/review-loop/edge-scan.mjs
import { chromium } from 'playwright';
import { sagOf } from './optics.mjs';

const base = process.env.P2P_URL || 'http://127.0.0.1:47630/';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto(new URL('?piece=lens', base).href);
await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 });
const ids = ['s35', 'n50', 'n500', 'n500fl', 'z35', 'm50', 'z800', 'p20', 'p24', 'p28', 'p35', 'p50', 'p85', 'p105', 'p135', 'p200', 'p300', 'p400', 'p500'];
let total = 0, skipped = 0;
for (const lens of ids) {
  for (const focusM of [null, 0.01]) { // 0.01 m clamps to the lens's closest focus
    const sys = await page.evaluate(([lens, focusM]) => {
      window.p2p.set({ lens, focusM, fno: 22 });
      const m = window.p2p.model();
      return { lens: m.scenario.lens, focus: m.focus.distanceMm, surfaces: m.system.surfaces.map((s) => ({ z: s.z, c: s.c, k: s.k, a: s.a, sd: s.sd, kind: s.kind, medium: s.mediumAfter, label: s.label })) };
    }, [lens, focusM]);
    if (sys.lens !== lens) continue;
    const S = sys.surfaces;
    for (let i = 0; i + 1 < S.length; i++) {
      const a = S[i], b = S[i + 1];
      if (b.kind === 'image' || a.kind === 'stop' || b.kind === 'stop') continue;
      // A patent's virtual reference plane (air on both sides, no glass edge; z800/m500 surface 13) is not an edge
      // a real element can cross (score loop r2: it was the scan's only remaining report).
      if (/^(virtual|dummy)/i.test(a.label ?? '') || /^(virtual|dummy)/i.test(b.label ?? '')) { skipped++; continue; }
      const hMax = Math.min(a.sd, b.sd);
      let worst = Infinity, at = 0, first = null;
      for (let k = 0; k <= 400; k++) {
        const h = (hMax * k) / 400;
        const g = b.z + sagOf(b, h) - (a.z + sagOf(a, h));
        if (g < worst) { worst = g; at = h; }
        if (g < 0 && first === null) first = h;
      }
      if (worst < -1e-3) {
        total++;
        console.log(`${lens} focus ${sys.focus === null ? 'inf' : (sys.focus / 1000).toFixed(2) + ' m'}: surfaces ${i}->${i + 1} (${a.medium} between, ${a.label ?? ''} / ${b.label ?? ''}) cross at h ${first.toFixed(2)} mm; sd ${a.sd.toFixed(2)} / ${b.sd.toFixed(2)}; overlap ${(-worst).toFixed(3)} mm at h ${at.toFixed(2)}`);
      }
    }
  }
}
console.log(`total crossings: ${total} (${skipped} virtual/dummy reference-plane pairs skipped)`);
await browser.close();
