import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startPreview } from './preview.mjs';
import { decodePng } from './accuracy/png.mjs';

const server = process.env.P2P_URL ? null : await startPreview();
const url = process.env.P2P_URL || server.url;
const output = process.env.P2P_AUDIT_OUTPUT || 'shots/phone-navigation';
const backend = process.env.P2P_BACKEND || 'webgpu';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const report = { backend, checks: [], geometry: [], errors: [] };
async function requireGeometry(page, name) {
  const clip = await page.locator('#gl').boundingBox();
  const image = decodePng(await page.screenshot({ clip,
    style: '#view > :not(#gl) { opacity:0!important; transition:none!important; animation:none!important; }' }));
  const bins = new Map(); let total = 0, bright = 0;
  for (let y = Math.floor(image.height * .2); y < image.height * .8; y += 2) {
    for (let x = Math.floor(image.width * .2); x < image.width * .8; x += 2) {
      const i = (y * image.width + x) * image.channels;
      const [r,g,b] = image.data.subarray(i, i + 3);
      const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
      bins.set(key, (bins.get(key) || 0) + 1); total++;
      if (Math.max(r,g,b) > 65) bright++;
    }
  }
  const varied = total - Math.max(...bins.values());
  assert.ok(varied > 100 && bright > 20, `${name}: phone main-view geometry missing (${varied} varied, ${bright} bright)`);
  report.geometry.push({ name, varied, bright });
}
try {
  for (const viewport of [{ width:390, height:844 }, { width:320, height:568 }]) {
    const page = await browser.newPage({ viewport, reducedMotion:'no-preference' });
    page.on('pageerror', e => report.errors.push(String(e)));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    await page.goto(new URL(`?lens=m50&piece=camera${backend === 'webgl2' ? '&gl=webgl2' : ''}`, url).href);
    await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded);
    assert.equal(await page.evaluate(() => window.p2p.backend()), backend);
    for (const level of ['camera','lens','cone','loupe']) {
      if (await page.locator('#inspector-size').getAttribute('aria-expanded') === 'true') await page.locator('#inspector-size').click();
      await page.locator(`#steps [data-piece="${level}"]`).click();
      await page.waitForFunction(() => document.querySelector('#veil').classList.contains('off') && !window.p2p.framing().moving);
      await page.waitForTimeout(100);
      await requireGeometry(page, `${viewport.width}/${level}`);
      if (await page.locator('#inspector-size').getAttribute('aria-expanded') !== 'true') await page.locator('#inspector-size').click();
      for (const id of ['part-prev','part-overview','part-next','reset-view','zoom-in','zoom-out']) {
        const hit = await page.locator(`#${id}`).evaluate(el => {
          const r = el.getBoundingClientRect(), top = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return { hits: top === el || el.contains(top), top:top?.id, y:r.y, height:r.height };
        });
        assert.ok(hit.hits, `${viewport.width}/${level}/${id} is covered by ${hit.top}`);
        await page.locator(`#${id}`).click({ timeout:3000 });
      }
      report.checks.push(`${viewport.width}/${level}: expanded inspector leaves all six navigation/zoom controls clickable`);
      await page.screenshot({ path:`${output}/${viewport.width}-${level}-expanded.png` });
    }
    await page.locator('#workspace-photos').click();
    assert.equal(await page.locator('#inspector-size').getAttribute('aria-expanded'), 'false');
    await page.locator('#workspace-model').click();
    await page.locator('#part-overview').click({ timeout:3000 });
    await page.locator('#inspector-size').click();
    await page.setViewportSize({width:844,height:390});
    await page.waitForFunction(() => document.querySelector('#inspector-size').getAttribute('aria-expanded') === 'false');
    await page.setViewportSize(viewport);
    await page.locator('#part-next').click({ timeout:3000 });
    report.checks.push(`${viewport.width}: Photos return and rotation clear stale expansion`);
    await page.close();
  }
  assert.deepEqual(report.errors, []);
  console.log(`PASS ${report.checks.length} phone navigation groups`);
} catch (error) { report.failure = String(error.stack || error); throw error; }
finally {
  writeFileSync(`${output}/report.json`, JSON.stringify(report,null,2));
  await browser.close(); await server?.close();
}
