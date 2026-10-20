// Score loop r4: the distinct materials the Models page builds for one kit, and which physical features each uses.
//   node tools/score-loop/r4-materials.mjs "models.html?body=dslr&lens=n50"
import { chromium } from 'playwright';
const { createServer } = await import('vite');
const dev = await createServer({ root: process.cwd(), logLevel: 'error', server: { host: '127.0.0.1', port: 47821, strictPort: true, open: false } });
await dev.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('http://127.0.0.1:47821/' + (process.argv[2] || 'models.html'));
  await page.waitForFunction(() => window.p2pModels?.ready && document.getElementById('veil').classList.contains('off'), null, { timeout: 120000 });
  const rows = await page.evaluate(() => {
    const seen = new Map();
    window.p2pModels.scene.traverse((o) => {
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) { const e = seen.get(m) ?? { n: 0, meshes: 0 }; e.n++; e.meshes++; e.m = m; seen.set(m, e); }
    });
    return [...seen.values()].map(({ m, meshes }) => {
      const f = {};
      for (const k of ['clearcoat', 'sheen', 'transmission', 'iridescence', 'anisotropy', 'dispersion', 'specularIntensity', 'ior', 'thickness', 'opacity', 'metalness', 'roughness']) if (m[k] !== undefined) f[k] = typeof m[k] === 'number' ? +m[k].toFixed(3) : m[k];
      return { type: m.type, name: m.name, meshes, transparent: m.transparent, side: m.side, maps: ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'envMap', 'aoMap', 'emissiveMap'].filter((k) => m[k]), f };
    });
  });
  console.log(rows.length, 'distinct materials');
  for (const r of rows) console.log(JSON.stringify(r));
} finally { await browser.close(); await dev.close(); }
