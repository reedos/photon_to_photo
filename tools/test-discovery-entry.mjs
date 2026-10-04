import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const output=process.env.P2P_AUDIT_OUTPUT||'shots/discovery-entry';mkdirSync(output,{recursive:true});
const base=process.env.P2P_URL||'http://127.0.0.1:47743/';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const errors=[];
try {
 const page=await browser.newPage({viewport:{width:1366,height:768},reducedMotion:'reduce'});page.setDefaultTimeout(30000);
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto(base);await page.locator('#photo-opening').waitFor({state:'visible'});
 assert.equal(await page.locator('.opening-actions button').count(),3);
 await page.screenshot({path:output+'/start-desktop.png'});
 await page.setViewportSize({width:320,height:568});
 const choices=await page.locator('.opening-actions').boundingBox();assert.ok(choices.y>=0&&choices.y+choices.height<=568,'all first visit choices are visible');
 await page.screenshot({path:output+'/start-phone.png'});
 await page.locator('#opening-photos').click();await page.locator('#photo-study-panel').waitFor({state:'visible'});
 await page.reload();await page.waitForFunction(()=>!!window.p2p);assert.equal(await page.locator('#start-here').isVisible(),false,'choice is remembered');
 await page.locator('#menu-btn').click();await page.locator('.start-entry').click();
 const dialog=await page.locator('#start-here').boundingBox();assert.ok(dialog.x>=0&&dialog.y>=0&&dialog.x+dialog.width<=320&&dialog.y+dialog.height<=568);
 await page.screenshot({path:output+'/paths-phone.png'});
 await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.id==='menu-btn');
 await page.locator('#menu-btn').click();await page.locator('.start-entry').click();await page.locator('[data-start="shot"]').click();
 await page.locator('#shot-dialog[data-ready="true"]').waitFor();await page.locator('#shot-close').click();
 await page.goto(new URL('?piece=camera&lens=m50',base).href);await page.waitForFunction(()=>window.p2p?.pieces.camera?.state().loaded);await page.evaluate(()=>window.p2p.pieces.camera.ready());await page.evaluate(()=>window.p2p.settle());await page.locator('#veil.off').waitFor({state:'attached'});
 assert.equal(await page.locator('#start-here').isVisible(),false,'direct links bypass introduction');
 await page.waitForTimeout(400);
 const markers=await page.locator('#pins .pin:visible').evaluateAll(es=>es.map(e=>({text:e.querySelector('.num').textContent,box:e.getBoundingClientRect().toJSON()})));
 assert.ok(markers.length>=5,'phone overview retains independently selectable parts');
 for (const [i,p] of markers.entries()) {
  assert.match(p.text,/^\d+$/,'each marker represents exactly one part');
  for (const q of markers.slice(i+1)) assert.ok(Math.abs(p.box.x-q.box.x)>=43.5||Math.abs(p.box.y-q.box.y)>=43.5,'phone targets do not overlap');
 }
 assert.ok(await page.locator('.pin:visible .pin-leader:not([hidden])').count()>0,'displaced pins visibly connect to their component');
 await page.screenshot({path:output+'/markers-phone.png'});
 await page.locator('#pins .pin:visible').last().click();await page.evaluate(()=>window.p2p.settle());
 assert.equal(await page.locator('#pins .pin.on .lbl').isVisible(),true,'selected marker keeps its name');
 assert.deepEqual(await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.scrollHeight]),[320,568]);
 assert.deepEqual(errors,[]);writeFileSync(output+'/report.json',JSON.stringify({passed:true,markers,errors},null,2));console.log('PASS first visit choices, remembered choice, deep links, shot entry, separate phone markers, selected label, no overflow/errors');
}finally{await browser.close()}
