// Actual JPEG journeys: provenance, unchanged final pixels, navigation and loading races.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';
const examples=JSON.parse(readFileSync('public/examples/examples.json','utf8')).examples;
const axe=readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'),'utf8');
const server=process.env.P2P_URL?null:await startPreview(),url=process.env.P2P_URL||server.url;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
mkdirSync('shots/photo-shot',{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:1366,height:900},reducedMotion:'reduce'}),errors=[];
 page.setDefaultTimeout(120000);
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('ERR_FAILED'))errors.push(m.text());});
 await page.goto(url);await page.waitForFunction(()=>window.p2p&&document.querySelectorAll('.rp-pick').length===6);
 const before=await page.evaluate(()=>window.p2p.scenario());
 const seek=t=>page.locator('#shot-time').evaluate((el,t)=>{el.value=String(t);el.dispatchEvent(new Event('input',{bubbles:true}));},t);
 for(const width of [1366,390,320]){
  await page.setViewportSize({width,height:width===1366?900:width===320?740:844});
  for(const ex of examples){
   await page.locator(`.rp-pick[data-id="${ex.id}"]`).click();
   await page.locator('#rp-play').click();
   await page.waitForSelector(`#shot-dialog[data-source="photo:${ex.id}"][data-ready="true"]`);
   assert.equal(await page.locator('#shot-source').inputValue(),`photo:${ex.id}`);
   assert.equal(await page.locator('#shot-capture').isVisible(),false);
   assert.match(await page.locator('#shot-settings').innerText(),new RegExp(`ISO ${ex.iso}`));
   assert.equal(await page.locator('#shot-dialog').getAttribute('data-playing'),'false');
   for(const t of [2,6,10,14,18,25,28]){
    await seek(t);
    assert.equal(await page.locator('#shot-dialog').evaluate(d=>d.scrollWidth<=d.clientWidth),true,`${ex.id} ${width}: no dialog overflow`);
   }
   // At completion, the entire aspect-preserved source JPEG must match a direct
   // reference canvas draw, with no fake processing or overlay remaining on it.
   const diff=await page.locator('#shot-canvas').evaluate(async(c,image)=>{
    const im=new Image();im.src=new URL(`examples/${image}`,document.baseURI).href;await im.decode();
    const ref=document.createElement('canvas');ref.width=c.width;ref.height=c.height;
    const g=ref.getContext('2d');g.setTransform(c.width/1000,0,0,c.height/560,0,0);
    const s=Math.min(952/im.naturalWidth,470/im.naturalHeight),w=im.naturalWidth*s,h=im.naturalHeight*s,x=24+(952-w)/2,y=20+(470-h)/2;
    g.drawImage(im,x,y,w,h);
    const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data,b=g.getImageData(0,0,c.width,c.height).data;
    let max=0,count=0;
    for(let yy=Math.ceil((y+2)*c.height/560);yy<(y+h-2)*c.height/560;yy+=3)
     for(let xx=Math.ceil((x+2)*c.width/1000);xx<(x+w-2)*c.width/1000;xx+=3)
      for(let k=0;k<3;k++){const d=Math.abs(a[(yy*c.width+xx)*4+k]-b[(yy*c.width+xx)*4+k]);max=Math.max(max,d);count++;}
    return {max,count};
   },ex.image);
   assert.ok(diff.count>500&&diff.max<=1,`${ex.id} ${width}: unchanged JPEG ${JSON.stringify(diff)}`);
   if(width===1366||ex.id==='squirrel')await page.screenshot({path:`shots/photo-shot/${ex.id}-${width}.png`});
   await page.locator('#shot-view-photo').click();
   assert.equal(await page.locator('#shot-photo-dialog').evaluate(d=>d.open),true);
   assert.equal(await page.locator('#shot-photo-title').textContent(),ex.title);
   assert.equal(await page.locator('#shot-photo-dialog').evaluate(d=>d.scrollWidth<=d.clientWidth),true);
   if(ex.id==='squirrel')await page.screenshot({path:`shots/photo-shot/squirrel-large-${width}.png`});
   await page.keyboard.press('Escape');
   assert.equal(await page.evaluate(()=>document.activeElement.id),'shot-view-photo');
   assert.equal(await page.locator('#shot-time').inputValue(),'28','enlargement preserves playback position');
   await page.keyboard.press('Escape');
   assert.equal(await page.evaluate(()=>document.activeElement.id),'rp-play');
   assert.deepEqual(await page.evaluate(()=>window.p2p.scenario()),before,'watching preserves workspace');
  }
  console.log(`PASS real photographs ${width}: all six launches, stages, unchanged pixels, metadata, close/focus, no overflow`);
 }
 await page.setViewportSize({width:1366,height:900});await page.locator('#rp-play').click();await page.waitForSelector('#shot-dialog[data-ready="true"]');
 await page.addScriptTag({content:axe});
 const violations=await page.evaluate(async()=> (await axe.run(document.getElementById('shot-dialog'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations);
 assert.deepEqual(violations.map(v=>v.id),[]);
 await page.locator('#shot-track').selectOption('charge');assert.equal(await page.locator('#shot-time').inputValue(),'12');
 await page.locator('#shot-source').selectOption('photo:sheep-village');await page.waitForSelector('#shot-dialog[data-ready="true"]');
 assert.match(await page.locator('#shot-measures').innerText(),/ISO 64/);
 // A delayed old image may neither replace the new photo nor revive a closed dialog.
 await page.route('**/examples/flycatcher.jpg',async route=>{await new Promise(r=>setTimeout(r,1200));await route.continue();});
 await page.locator('#shot-source').selectOption('photo:flycatcher');
 await page.locator('#shot-source').selectOption('photo:squirrel');
 await page.waitForSelector('#shot-dialog[data-source="photo:squirrel"][data-ready="true"]');
 await page.waitForTimeout(1500);assert.equal(await page.locator('#shot-source').inputValue(),'photo:squirrel');
 await page.locator('#shot-source').selectOption('photo:flycatcher');await page.keyboard.press('Escape');await page.waitForTimeout(1500);
 assert.equal(await page.locator('#shot-dialog').evaluate(d=>d.open),false);
 await page.unroute('**/examples/flycatcher.jpg');
 // Explicit load failure and recovery.
 await page.route('**/examples/sheep-larches.jpg',route=>route.abort());
 await page.locator('.rp-pick[data-id="sheep-larches"]').click();await page.locator('#rp-play').click();
 await page.locator('#shot-retry').waitFor({state:'visible'});
 assert.equal(await page.locator('#shot-use').isDisabled(),true);
 await page.unroute('**/examples/sheep-larches.jpg');await page.locator('#shot-retry').click();await page.waitForSelector('#shot-dialog[data-ready="true"]');
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.locator('#shot-track').selectOption('all');await page.locator('#shot-speed').selectOption('2');await seek(0);
 await page.evaluate(()=>{window.photoPlayback={frames:0,stages:new Set()};const sample=()=>{const d=document.getElementById('shot-dialog');window.photoPlayback.frames++;window.photoPlayback.stages.add(d.dataset.stage);if(d.dataset.playing==='true')requestAnimationFrame(sample);};document.getElementById('shot-play').click();requestAnimationFrame(sample);});
 await page.waitForSelector('#shot-dialog[data-playing="false"]');
 const playback=await page.evaluate(()=>({frames:window.photoPlayback.frames,stages:[...window.photoPlayback.stages]}));
 assert.deepEqual(playback.stages,['0','1','2','3','4','5']);assert.ok(playback.frames>140);console.log('PASS real-photo full playback',playback);
 await page.locator('#shot-close').click();
 assert.deepEqual(errors,[]);
 console.log('PASS actual-photo accessibility, process selection, delayed source/close, error/retry, no GPU/runtime errors');
} finally {await browser.close();await server?.close();}
