import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';
const server=process.env.P2P_URL?null:await startPreview();
const url=process.env.P2P_URL||server.url;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
try {
 for(const lens of ['n50','m50']) {
  const page=await browser.newPage({viewport:{width:1366,height:900},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await page.goto(url+`?piece=camera&lens=${lens}&fno=4&focus=3`);
  await page.waitForFunction(()=>window.p2p?.pieces.camera);
  await page.evaluate(()=>window.p2p.pieces.camera.ready());
  await page.waitForFunction(()=>window.p2p.render());
  const revision=await page.evaluate(()=>window.p2p.pieces.camera.state().opticsRevision);
  assert.ok(revision>0);
  const durations=await page.evaluate(()=>Array.from({length:12},(_,i)=>{
   const start=performance.now();window.p2p.set({iso:i%2?800:100,shutter:i%2?1/125:1/250,lux:i%2?8000:10000});return performance.now()-start;
  }));
  assert.equal(await page.evaluate(()=>window.p2p.pieces.camera.state().opticsRevision),revision,'exposure-only edits retain computed rays and iris geometry');
  await page.waitForFunction(()=>window.p2p.render()?.scenario.iso===800&&window.p2p.render()?.scenario.shutter===1/125);
  await page.waitForFunction(()=>document.querySelector('.rx-k').textContent.includes('1/125'));
  await page.evaluate(()=>window.p2p.set({fno:8}));
  const apertureRevision=await page.evaluate(()=>window.p2p.pieces.camera.state().opticsRevision);
  assert.ok(apertureRevision>revision,'aperture still rebuilds iris and clipped rays');
  await page.evaluate(()=>window.p2p.set({focusM:5}));
  assert.ok(await page.evaluate(()=>window.p2p.pieces.camera.state().opticsRevision)>apertureRevision,'focus still moves elements and retraces rays');
  await page.evaluate(()=>window.p2p.pieces.camera.fire());
  const exposure=await page.evaluate(()=>({state:window.p2p.pieces.camera.exposure(),readoutS:window.p2p.model().sensor.readoutS}));
  const expected=1000*(1/125+(lens==='n50'?.004:exposure.readoutS));
  assert.ok(Math.abs(exposure.state.segs.find(s=>s.name==='exposure').realMs-expected)<1e-6,'new shutter setting drives the actual exposure sequence');
  await page.evaluate(()=>window.p2p.set({shutter:1/60}));
  assert.equal(await page.evaluate(()=>window.p2p.pieces.camera.exposure().status),'idle','editing a playing shot cancels its stale exposure');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({lens,revision,apertureRevision,settingMaxMs:Math.max(...durations),settingMeanMs:durations.reduce((a,b)=>a+b)/durations.length}));
  await page.close();
 }
} finally {await browser.close();await server?.close()}

