import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startPreview } from './preview.mjs';
const server=process.env.P2P_URL?null:await startPreview(),base=process.env.P2P_URL||server.url;
const out=process.env.P2P_AUDIT_OUTPUT||'shots/scene-removal';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const report={errors:[],workers:[],cases:[]};
try {
 for(const backend of ['webgpu','webgl2']) {
  const p=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  p.on('pageerror',e=>report.errors.push(String(e)));p.on('console',m=>{if(m.type()==='error')report.errors.push(m.text())});p.on('worker',w=>report.workers.push(w.url()));
  await p.goto(new URL(`?piece=camera&lens=m50${backend==='webgl2'?'&gl=webgl2':''}`,base).href);
  await p.waitForFunction(()=>window.p2p?.pieces.camera?.state().loaded);
  const rest=()=>p.waitForFunction(()=>window.p2p&&!window.p2p.framing().moving&&document.querySelector('#veil').classList.contains('off')&&getComputedStyle(document.querySelector('#veil')).opacity==='0');
  await rest();assert.equal(await p.evaluate(()=>window.p2p.backend()),backend);
  assert.equal(await p.locator('#finalimg,#fi-dock,#kit-scene,#sc-scene,#compare-photo,#pin-photo,#compare-dialog,#rp-canvas,.rp-prediction').count(),0);
  for(const lens of ['s35','n50','n500','n500fl','z35','m50','z800']) {
   await p.evaluate(lens=>window.p2p.set({lens}),lens);
   for(const piece of ['camera','lens','cone','loupe']) {
    await p.locator(`#steps [data-piece="${piece}"]`).click();await rest();
    const state=await p.evaluate(()=>({frame:window.p2p.framing(),render:window.p2p.render(),overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight}));
    assert.equal(state.frame.piece,piece);assert.ok([...state.frame.position,...state.frame.target].every(Number.isFinite));assert.equal(state.render,null);assert.equal(state.overflow,false);
    report.cases.push({backend,lens,piece});
   }
  }
  await p.screenshot({path:`${out}/${backend}-pixel.png`});
  await p.locator('#steps [data-piece="camera"]').click();await rest();await p.locator('#tab-controls').click();
  await p.locator('#open-pipeline').click();await p.waitForFunction(()=>!document.querySelector('#pipeline-lesson').hidden&&!document.querySelector('#lesson-play').disabled);
  for(const stage of ['raw','demosaic','wb','ccm','tone']){await p.locator('#pipeline-stage').selectOption(stage);assert.ok(await p.locator('#pipeline-canvas').evaluate(c=>c.width>0&&c.height>0));}
  await p.screenshot({path:`${out}/${backend}-pipeline.png`});await p.locator('#lesson-close').click();
  await p.locator('#workspace-photos').click();
  const picks=p.locator('#rp-picks button');await picks.first().waitFor();
  for(let i=0;i<await picks.count();i++){await picks.nth(i).click();await p.waitForFunction(()=>{const i=document.querySelector('#rp-img');return i.complete&&i.naturalWidth>0});}
  await p.locator('#rp-img').evaluate(i=>i.decode());await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await p.screenshot({path:`${out}/${backend}-photos.png`});await p.locator('#workspace-model').click();
  for(const [width,height]of [[390,844],[320,568]]){await p.setViewportSize({width,height});await rest();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight),false);const panel=await p.locator('.studio-sidebar').boundingBox();const parts=await p.locator('#studio-explain').boundingBox();assert.ok(parts.width>=panel.width-2,'parts use reclaimed photo column');await p.screenshot({path:`${out}/${backend}-${width}.png`});}
  await p.close();
 }
 assert.deepEqual(report.errors,[]);assert.equal(report.workers.some(u=>/render-worker|example-worker/.test(u)),false,'no synthetic scene workers');report.passed=true;console.log('PASS 56 lens/level paths, both backends, lessons, gallery and phone layouts without synthetic render workers');
}finally{writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();await server?.close();}
