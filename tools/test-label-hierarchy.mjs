// Exercise the quieter label hierarchy through real pointer and keyboard interactions.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
const output=process.env.P2P_AUDIT_OUTPUT||'shots/label-hierarchy';mkdirSync(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const errors=[];
try {
 const page=await browser.newPage({viewport:{width:1366,height:768},reducedMotion:'reduce'});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto(new URL('?piece=camera&lens=m50',process.env.P2P_URL||'http://127.0.0.1:47743/').href);
 await page.waitForFunction(()=>window.p2p?.pieces.camera?.state().loaded);await page.evaluate(()=>window.p2p.pieces.camera.ready());await page.evaluate(()=>window.p2p.settle());
 await page.mouse.move(3,3);await page.waitForTimeout(350);
 const visibleLabels=()=>page.locator('#pins .pin .lbl').evaluateAll(es=>es.filter(e=>e.checkVisibility()).length);
 assert.equal(await visibleLabels(),0,'overview keeps markers without competing full names');
 const pin=page.locator('#pins .pin:visible').first();assert.ok(await page.locator('#pins .pin:visible').count()>2,'part markers remain discoverable');
 await pin.focus();
 assert.equal(await pin.locator('.lbl').isVisible(),true,'keyboard focus reveals part name');
 await pin.press('Enter');await page.evaluate(()=>window.p2p.settle());assert.equal(await pin.getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('#pins .pin.on .lbl').isVisible(),true,'selected part name remains visible');
 assert.equal(await visibleLabels(),1,'selected part gets one primary name');
 await page.screenshot({path:output+'/selected-desktop.png'});
 await page.locator('#part-overview').click();await page.evaluate(()=>window.p2p.settle());
 const other=page.locator('#pins .pin:visible').first();await other.hover();await page.waitForTimeout(200);
 assert.equal(await other.locator('.lbl').isVisible(),true,'pointer exploration reveals a name');
 await page.mouse.move(3,3);await page.waitForTimeout(200);assert.equal(await visibleLabels(),0,'pointer leaving restores quiet overview');
 await page.screenshot({path:output+'/overview-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.locator('#part-next').click();await page.evaluate(()=>window.p2p.settle());
 assert.equal(await page.locator('#pins .pin.on .lbl').isVisible(),true,'phone selection keeps its label');
 await page.screenshot({path:output+'/selected-phone.png'});
 assert.deepEqual(errors,[]);writeFileSync(output+'/report.json',JSON.stringify({passed:true,errors},null,2));console.log('PASS quiet overview, keyboard/pointer names, selected desktop/phone labels, zero errors');
}finally{await browser.close()}
