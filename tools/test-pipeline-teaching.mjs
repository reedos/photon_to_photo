import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const url=process.env.P2P_URL||'http://127.0.0.1:47722/';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
mkdirSync('shots/pipeline-teaching',{recursive:true});
try{
 for(const [width,height] of [[1366,900],[390,844],[320,740]]){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'}),errors=[];page.setDefaultTimeout(90000);
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(url+'?piece=camera');await page.waitForFunction(()=>window.p2p?.pieces.camera);
  await page.evaluate(()=>window.p2p.pieces.camera.ready());await page.waitForFunction(()=>!document.getElementById('pin-photo').disabled);
  await page.locator('#learn-launch').click();await page.locator('#journey-stop').selectOption('6');
  await page.locator('#pipeline-stage').selectOption('raw');
  const canvas=page.locator('#pipeline-canvas'),region=page.locator('#pipeline-region');
  const original=await region.getAttribute('style');
  await canvas.click({position:{x:24,y:24}});assert.notEqual(await region.getAttribute('style'),original);
  const clicked=await region.getAttribute('style');await canvas.focus();await page.keyboard.press('ArrowRight');assert.notEqual(await region.getAttribute('style'),clicked);
  await page.keyboard.press('Enter');assert.equal(await region.getAttribute('style'),original);
  for(const stage of ['raw','demosaic','wb','ccm','tone']){
   await page.locator('#pipeline-stage').selectOption(stage);assert.ok((await page.locator('#pipeline-look-for').textContent()).length>40);
  }
  assert.ok(await page.evaluate(()=>{const c=document.getElementById('pipeline-canvas'),v=window.p2p.render();return c.getContext('2d').getImageData(0,0,c.width,c.height).data.every((n,i)=>n===v.rgba[i]);}),'final remains actual renderer pixels');
  await page.locator('#pipeline-stage').selectOption('raw');await canvas.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  await page.screenshot({path:`shots/pipeline-teaching/pipeline-${width}.png`});
  assert.deepEqual(errors,[]);await page.close();console.log(`pipeline teaching ${width}: passed`);
 }
}finally{await browser.close();}
