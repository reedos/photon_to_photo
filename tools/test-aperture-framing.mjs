// A virtual entrance pupil must not pull the inspection camera off the real lens.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startPreview } from './preview.mjs';
const server = process.env.P2P_URL ? null : await startPreview();
const url = process.env.P2P_URL || server.url;
const output = process.env.P2P_AUDIT_OUTPUT || 'shots/aperture-framing';
mkdirSync(output,{recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const report={checks:[],errors:[]};
try {
  const page=await browser.newPage({viewport:{width:1366,height:900},reducedMotion:'no-preference'});
  page.on('pageerror',e=>report.errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text())});
  await page.goto(new URL('?lens=n50&piece=camera',url).href);
  await page.waitForFunction(()=>window.p2p?.pieces.camera.state().loaded);
  await page.locator('#tab-explain').click();
  await page.locator('#parts [data-part-id="iris"]').click();
  for(const lens of ['s35','n50','n500','n500fl','z35','m50','z800']) {
    // Retain the selected part through both same-body and DSLR/mirrorless changes.
    await page.evaluate(lens=>window.p2p.set({lens}),lens);
    await page.evaluate(()=>window.p2p.pieces.camera.ready());
    for(const viewport of [{width:1366,height:900},{width:390,height:844},{width:320,height:568}]) {
      await page.setViewportSize(viewport);
      await page.locator('#reset-view').click();
      await page.waitForFunction(()=>!window.p2p.framing().moving && document.querySelector('#veil').classList.contains('off'));
      await page.waitForTimeout(80);
      const state=await page.evaluate(()=>({frame:window.p2p.framing(),pin:window.p2p.pins().find(p=>p.id==='iris'),model:window.p2p.pieces.camera.state(),ep:window.p2p.model().cardinal.ep}));
      const box=await page.locator('#gl').boundingBox();
      assert.equal(state.frame.selected,'iris');
      assert.equal(state.model.lens,lens);
      assert.ok(state.pin.anchorX>=0 && state.pin.anchorX<=box.width && state.pin.anchorY>=0 && state.pin.anchorY<=box.height,`${lens}/${viewport.width}: aperture anchor outside view`);
      assert.equal(await page.locator('#pins [data-pin-id="iris"]').isVisible(),true);
      await page.screenshot({path:`${output}/${lens}-${viewport.width}.png`});
      report.checks.push({lens,viewport,...state});
    }
    await page.setViewportSize({width:1366,height:900});
  }
  assert.deepEqual(report.errors,[]);
  console.log(`PASS ${report.checks.length} aperture framing and selected equipment/resize cases`);
} catch(error) {report.failure=String(error.stack||error);throw error;}
finally {writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));await browser.close();await server?.close();}
