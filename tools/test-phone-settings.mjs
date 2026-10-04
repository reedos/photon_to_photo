import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';
const server=process.env.P2P_URL?null:await startPreview();
const url=process.env.P2P_URL||server.url;
const output=process.env.P2P_AUDIT_OUTPUT||'shots/phone-settings'; mkdirSync(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const report={errors:[],samples:[]}; let page;
const rest=async()=>page.waitForFunction(()=>window.p2p&&!window.p2p.framing().moving&&document.querySelector('#veil').classList.contains('off')&&getComputedStyle(document.querySelector('#veil')).opacity==='0');
async function capture(name){
 const state=await page.evaluate(()=>({viewport:[innerWidth,innerHeight],document:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],view:document.querySelector('#gl').getBoundingClientRect().toJSON(),drawer:document.querySelector('#phone-settings').open,parts:document.querySelector('#studio-explain').checkVisibility()}));
 report.samples.push({name,...state}); await page.screenshot({path:`${output}/${name}.png`});
 assert.deepEqual(state.document,state.viewport,`${name}: no page overflow`);
 assert.equal(state.parts,true,`${name}: Parts dock keeps its layout`);
 if(!state.drawer) for(const selector of ['#part-next','#part-prev','#zoom-in','#zoom-out','#tab-controls','#tab-explain','#inspector-size']) assert.equal(await page.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return el===hit||el.contains(hit);}),true,`${name}: ${selector} reachable`);
}
try{
 for(const [width,height] of [[390,844],[320,568]]){
  page=await browser.newPage({viewport:{width,height},reducedMotion:'no-preference'});
  page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  const entry=new URL('?piece=camera&lens=m50',url);if(process.env.P2P_BACKEND)entry.searchParams.set('gl',process.env.P2P_BACKEND);
  await page.goto(entry.href);await page.waitForFunction(()=>window.p2p?.pieces.camera);await page.evaluate(()=>window.p2p.pieces.camera.ready());await rest();
  report.backend=await page.evaluate(()=>window.p2p.backend()); if(process.env.P2P_BACKEND)assert.equal(report.backend,process.env.P2P_BACKEND);
  assert.equal(await page.locator('#tab-controls').textContent(),'Settings');
  assert.equal(await page.locator('#sc-fno').isVisible(),false);
  assert.equal(await page.locator('#hud-switches').isVisible(),false);
  await capture(`${width}-camera`);
  const cameraHeight=await page.locator('#gl').evaluate(el=>el.clientHeight);
  assert.ok(cameraHeight>=(width===390?370:155),`${width}: model gains useful height (${cameraHeight})`);
  await page.locator('#tab-controls').click();await page.locator('#phone-settings').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>document.activeElement.id),'phone-settings-close');
  await capture(`${width}-drawer`);
  await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.querySelector('#phone-settings').contains(document.activeElement)),true,'native focus stays in drawer');
  const iso=await page.evaluate(()=>window.p2p.scenario().iso);
  await page.locator('#sc-iso').focus();await page.keyboard.press('ArrowRight');assert.ok(await page.evaluate(before=>window.p2p.scenario().iso>before,iso));
  await page.keyboard.press('Escape');await page.locator('#phone-settings').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>document.activeElement.id),'tab-controls');
  await page.locator('#equipment-toggle').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'kit-body');
  await page.locator('#kit-body').selectOption('dslr');await page.locator('#kit-lens').selectOption('n50');
  await page.locator('#phone-settings-close').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'equipment-toggle');
  assert.match(await page.locator('#equipment-toggle').getAttribute('aria-label'),/^Edit equipment:/,'closed equipment drawer advertises the next action');
  assert.match(await page.locator('#equipment-summary').textContent(),/DSLR/);await rest();
  await page.locator('#parts [data-part-id="iris"]').click();await rest();
  const selection=await page.evaluate(()=>window.p2p.framing().selected);
  assert.equal(selection,'iris','the selected part is active before opening Settings');
  await page.locator('#tab-controls').click();await page.keyboard.press('Escape');await page.locator('#phone-settings').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>window.p2p.framing().selected),selection,'Escape closes settings without clearing the part behind it');
  await page.locator('#part-overview').click();await rest();
  await page.locator('#inspector-size').click();assert.equal(await page.locator('#inspector-size').getAttribute('aria-expanded'),'true');await page.locator('#inspector-size').click();
  for(const piece of ['lens','cone','loupe']){await page.locator(`#steps [data-piece="${piece}"]`).click();await rest();await capture(`${width}-${piece}`);}
  await page.locator('#tab-controls').click();await page.locator('#open-pipeline').click();
  assert.equal(await page.locator('#phone-settings').isVisible(),false,'lesson handoff closes drawer');
  assert.equal(await page.locator('#sensor-lesson').isVisible(),true);await page.locator('#lesson-close').click();
  await page.locator('#tab-controls').click();await page.setViewportSize({width:1366,height:768});
  assert.equal(await page.locator('#phone-settings').isVisible(),false,'resize closes modal');
  assert.equal(await page.locator('#kit-body').isVisible(),true,'equipment restored to desktop');
  await page.locator('#tab-controls').click();assert.equal(await page.locator('#sc-iso').isVisible(),true,'desktop controls restored');
  await page.setViewportSize({width,height});assert.equal(await page.locator('#sc-iso').isVisible(),false);assert.equal(await page.locator('#studio-explain').isVisible(),true);
  await page.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=String(error.stack||error);await page?.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}
finally{writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));await browser.close();await server?.close();}
