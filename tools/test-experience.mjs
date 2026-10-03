import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const url=process.env.P2P_URL||'http://127.0.0.1:47722/';
const out='shots/experience';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const results=[];
try {
 for(const [width,height] of [[1366,900],[390,844],[320,740]]){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'}),requests=[],errors=[];
  page.setDefaultTimeout(120000);page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(url);await page.locator('#opening-photo').evaluate(img=>img.decode());
  assert.equal(await page.locator('#photo-opening').isVisible(),true);
  assert.equal(await page.locator('#top').isVisible(),false);
  assert.equal(await page.evaluate(()=>!!window.p2p),false,'no camera initialization on arrival');
  assert.equal(requests.some(request=>/app-start-|render-worker-|\.glb(?:\?|$)/.test(request)),false,'no engine, workers, or model downloads on arrival');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  for(const id of ['opening-follow','opening-explore']){
   const box=await page.locator('#'+id).boundingBox();assert.ok(box.y+box.height<=height,`${id} visible without scroll at${width}`);
  }
  await page.screenshot({path:`${out}/opening-${width}.png`,fullPage:true});
  await page.goto(url+'reference.html?page=story');
  assert.equal(await page.locator('.story-chapters button').count(),8);
  for(const id of ['photo','light','lens','focus','exposure','pixel','readout','final']){
   await page.locator(`[data-story-chapter="${id}"]`).click();
   assert.equal(await page.locator(`[data-story-chapter="${id}"]`).getAttribute('aria-current'),'step');
   assert.ok(await page.locator('#story-title').textContent());
   const link=await page.locator('#story-action').getAttribute('href');assert.ok(link.includes('index.html?'));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  }
  await page.locator('[data-story-chapter="photo"]').click();await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:`${out}/story-${width}.png`,fullPage:true});
  await page.locator('[data-story-chapter="focus"]').click();await page.screenshot({path:`${out}/story-focus-${width}.png`,fullPage:true});
  assert.deepEqual(errors,[]);await page.close();results.push({width,opening:'no engine requests or autoplay',story:'8 chapters, no overflow, deep links'});
 }
 const page=await browser.newPage({viewport:{width:1366,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(120000);
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(url);await page.locator('#opening-explore').click();await page.waitForFunction(()=>window.p2p?.pieces.camera);await page.evaluate(()=>window.p2p.pieces.camera.ready());
 assert.equal(await page.locator('#photo-opening').isVisible(),false);assert.equal(await page.locator('#kit-lens').isVisible(),true);
 await page.goto(url);await page.waitForFunction(()=>!!window.p2p);assert.equal(await page.locator('#photo-opening').isVisible(),false,'returning visitor keeps workspace');
 await page.goto(url+'?piece=cone&lens=n50&focus=2');await page.waitForFunction(()=>window.p2p?.pieces.cone);
 assert.equal(await page.locator('#photo-opening').isVisible(),false);assert.equal(await page.evaluate(()=>window.p2p.scenario().focusM),2);
 await page.close();
 const follow=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});follow.setDefaultTimeout(120000);follow.on('pageerror',e=>errors.push(String(e)));
 await follow.goto(url);await follow.locator('#opening-follow').click();await follow.waitForSelector('#shot-dialog[data-source="photo:flycatcher"][data-ready="true"]');
 assert.equal(await follow.locator('#shot-dialog').getAttribute('data-playing'),'false');
 await follow.keyboard.press('Escape');await follow.waitForFunction(()=>document.activeElement.classList.contains('shot-launch'));
 await follow.goto(url+'reference.html?page=story#story-readout');assert.match(await follow.locator('#story-title').textContent(),/measures/);
 await follow.locator('#story-action').click();await follow.waitForFunction(()=>!!window.p2p);await follow.locator('#sensor-lesson').waitFor({state:'visible'});
 assert.equal(await follow.locator('#photo-opening').isVisible(),false);assert.match(await follow.locator('#lesson-title').textContent(),/Read the sensor/i);
 await follow.close();assert.deepEqual(errors,[]);
 results.push({flows:'Explore, returning bare index, scenario deep link, actual-photo launch/close, story readout deep link'});
 console.log(JSON.stringify(results,null,2));writeFileSync(`${out}/validation.json`,JSON.stringify(results,null,2)+'\n');
}finally{await browser.close();}
