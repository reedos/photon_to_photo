import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {decodePng} from './accuracy/png.mjs';
const url=process.env.P2P_URL||'http://127.0.0.1:47701/';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
mkdirSync('shots/models-lifecycle',{recursive:true});
const report=[];
try {
 for(const backend of ['webgpu','webgl2']) {
  const page=await browser.newPage({viewport:{width:1366,height:900},reducedMotion:'no-preference'});
  page.setDefaultTimeout(60000);const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await page.goto(`${url}models.html?body=dslr&lens=n50${backend==='webgl2'?'&gl=webgl2':''}`);
  await page.waitForFunction(()=>window.p2pModels?.ready);
  assert.ok((await page.locator('#backend').innerText()).toLowerCase().includes(backend));
  const canvas=page.locator('#gl');
  async function painted(name){
   const frame=await page.evaluate(()=>window.p2pModels.renderer.info.frame);
   await page.waitForFunction(count=>window.p2pModels.renderer.info.frame>count+2,frame);
   const png=await canvas.screenshot({path:`shots/models-lifecycle/${backend}-${name}.png`});
   const decoded=decodePng(png);let visible=0;
   for(let i=0;i<decoded.data.length;i+=decoded.channels)if(Math.max(decoded.data[i],decoded.data[i+1],decoded.data[i+2])>25)visible++;
   assert.ok(visible>decoded.width*decoded.height*.005,`${backend}/${name}: actual camera pixels must remain visible`);
   return png;
  }
  await painted('initial');
  let disposed=0;
  for(const part of ['barrel','focusRing','glass','mirror','pixelArray','barrel','glass','pixelArray']) {
   await page.locator(`[data-part="${part}"]`).click();
   const selected=await page.evaluate(()=>{
    window.selectionDisposals=0;const seen=new Set();
    window.p2pModels.scene.traverse(mesh=>{
     if(!mesh.isMesh)return;
     for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
      if(material.emissiveIntensity===.14&&!seen.has(material)){
       seen.add(material);material.addEventListener('dispose',()=>window.selectionDisposals++);
      }
     }
    });
    return seen.size;
   });
   assert.ok(selected>0,`${part} has a highlight to release`);
   await page.locator('#clear').click();
   assert.equal(await page.evaluate(()=>window.selectionDisposals),selected,`${part}: every highlight material released`);
   disposed+=selected;
  }
  // Hold one body request while users switch away and back. It is still only one
  // network request; unit tests separately prove only one decode/preparation.
  let release;const held=new Promise(resolve=>{release=resolve});let requests=0;
  await page.route('**/models/mirrorless.glb',async route=>{requests++;await held;await route.continue()});
  await page.locator('[data-body="mirrorless"]').click();
  await page.locator('[data-body="dslr"]').dispatchEvent('click');
  await page.locator('[data-body="mirrorless"]').dispatchEvent('click');
  await page.locator('[data-lens="z35"]').dispatchEvent('click');
  release();
  await page.waitForFunction(()=>window.p2pModels.state.body==='mirrorless'&&window.p2pModels.state.lens==='z35'&&document.getElementById('veil').classList.contains('off'));
  assert.equal(requests,1,'rapid body return shares its pending request');
  await page.unroute('**/models/mirrorless.glb');
  await painted('last-choice');
  for(const [width,height] of [[390,844],[1366,900],[320,740],[1440,900]]) {
   await page.setViewportSize({width,height});await page.locator('#view').scrollIntoViewIfNeeded();
   if(width<900){
    assert.equal(await page.locator('#menu-btn').getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator('#topnav').evaluate(nav=>getComputedStyle(nav).visibility),'hidden','closed mobile menu hides immediately after a desktop resize');
    await page.locator('#menu-btn').click();
    assert.equal(await page.locator('#topnav').evaluate(nav=>getComputedStyle(nav).visibility),'visible','mobile menu opens');
    await page.locator('#menu-btn').click();
    assert.equal(await page.locator('#topnav').evaluate(nav=>getComputedStyle(nav).visibility),'hidden','mobile menu closes immediately');
   }
   await painted(`resize-${width}`);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  }
  // Real tab switching when the headless browser exposes it; additionally freeze
  // and resume the actual page lifecycle, then verify new pixels after orbiting.
  const other=await browser.newPage();await other.goto('about:blank');await other.bringToFront();
  const tabHidden=await page.evaluate(()=>document.hidden);
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Page.setWebLifecycleState',{state:'frozen'});
  await new Promise(resolve=>setTimeout(resolve,150));
  await cdp.send('Page.setWebLifecycleState',{state:'active'});
  await page.bringToFront();await other.close();
  const before=await painted('resume');
  const box=await canvas.boundingBox();
  await page.mouse.move(box.x+box.width*.55,box.y+box.height*.55);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.72,box.y+box.height*.63,{steps:8});await page.mouse.up();
  const after=await painted('resume-orbit');
  assert.notDeepEqual(after,before,'returning from background remains visually responsive to orbit');
  assert.deepEqual(errors,[]);
  report.push({backend,disposed,requests,tabHidden,errors});await page.close();
  console.log(`Models lifecycle ${backend}: passed (${disposed} temporary materials released)`);
 }
 writeFileSync('shots/models-lifecycle/report.json',JSON.stringify(report,null,2));
} finally {await browser.close()}
