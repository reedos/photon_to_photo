import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {startPreview} from './preview.mjs';
const server=process.env.P2P_URL?null:await startPreview(),url=process.env.P2P_URL||server.url;
const output=process.env.P2P_AUDIT_OUTPUT||'shots/audit-polish';mkdirSync(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'no-preference'}),report={console:[],levels:[]};
page.on('pageerror',e=>report.console.push(String(e)));
page.on('console',m=>{if(['warning','error'].includes(m.type()))report.console.push(m.text())});
const rest=async()=>{await page.waitForFunction(()=>window.p2p&&!window.p2p.framing().moving&&document.querySelector('#veil').classList.contains('off'));await page.waitForTimeout(200)};
try{
 const entry=new URL('?piece=camera&lens=n50&fno=8&focus=3',url);if(process.env.P2P_BACKEND)entry.searchParams.set('gl',process.env.P2P_BACKEND);
 await page.goto(entry.href);await page.waitForFunction(()=>window.p2p?.pieces.camera.state().loaded);await rest();report.backend=await page.evaluate(()=>window.p2p.backend());
 if(process.env.P2P_BACKEND)assert.equal(report.backend,process.env.P2P_BACKEND);
 const before=await page.evaluate(()=>window.p2p.pins());
 for(const lens of ['n500','n50']){await page.locator('#kit-lens').selectOption(lens);await page.evaluate(()=>window.p2p.pieces.camera.ready());await rest()}
 const after=await page.evaluate(()=>window.p2p.pins());report.roundtrip={before,after};
 for(const a of before){const b=after.find(p=>p.id===a.id);assert.ok(b,`${a.id}: pin remains`);assert.ok(Math.hypot(a.anchorX-b.anchorX,a.anchorY-b.anchorY)<3,`${a.id}: anchor survives lens roundtrip`)}
 assert.equal(await page.locator('.view-menu').count(),0,'no redundant overflow menu');
 assert.equal(await page.locator('.shot-launch:visible').count(),1,'one model shot launcher');
 assert.ok(await page.locator('#share-btn').isVisible(),'share directly discoverable');
 for(const piece of ['camera','lens','cone','loupe']){
  await page.locator(`#steps [data-piece="${piece}"]`).click();await rest();
  const state=await page.evaluate(()=>({photo:document.querySelector('#finalimg-canvas').getBoundingClientRect().height,fonts:[...document.querySelectorAll('#steps .step .t')].map(e=>getComputedStyle(e).fontSize),why:document.querySelector('.level-why').textContent,document:[document.documentElement.scrollWidth,document.documentElement.scrollHeight]}));
  report.levels.push({piece,...state});assert.deepEqual(state.document,[1440,900]);assert.equal(new Set(state.fonts).size,1,'level label sizes match');assert.ok(state.why.split(/\s+/).length>=8);
  if(piece==='cone'){const bounds=await page.locator('#model-experiments').evaluate(e=>({width:e.clientWidth,child:[...e.children].find(c=>!c.hidden).getBoundingClientRect().width}));assert.ok(Math.abs(bounds.width-bounds.child)<2,'single experiment fills footer')}
  await page.screenshot({path:`${output}/${piece}.png`});
 }
 assert.ok(Math.max(...report.levels.map(x=>x.photo))-Math.min(...report.levels.map(x=>x.photo))<2,'photo height stable across levels');
 await page.locator('#steps [data-piece="camera"]').click();await rest();
 await page.evaluate(()=>window.p2p.set({fno:4}));await rest();
 await page.locator('#kit-lens').selectOption('n500');
 await page.waitForFunction(()=>!document.querySelector('#toast').hidden&&document.querySelector('#toast').textContent.includes('requested f/4'));
 report.clampNotice=await page.locator('#toast').textContent();assert.match(report.clampNotice,/model limit f\/5\.75.*marked f\/5\.6/);
 await page.locator('#kit-lens').selectOption('n50');await page.evaluate(()=>window.p2p.pieces.camera.ready());await rest();
 await page.locator('#pin-photo').click({timeout:60000});await page.locator('#compare-photo').click();
 report.caption=await page.locator('#compare-a-caption').textContent();assert.match(report.caption,/^50 mm f\/1\.8 · Tabletop · f\/5\.6 · /);assert.doesNotMatch(report.caption,/n50|bench|5\.750/);
 await page.locator('#compare-close').click();await page.locator('#share-btn').click();
 assert.equal(await page.locator('#toast').isVisible(),true);assert.match(await page.locator('#toast').textContent(),/piece=camera/);
 assert.deepEqual(report.console,[],'no renderer warnings or browser errors');report.passed=true;
}catch(error){report.failure=String(error.stack||error);await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error}
finally{writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));await browser.close();await server?.close()}
