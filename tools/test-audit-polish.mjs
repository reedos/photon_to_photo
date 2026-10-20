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
  await page.locator(`#steps [data-piece="${piece}"]`).click();await page.waitForFunction(piece=>window.p2p.framing().piece===piece,piece);await rest();
  const state=await page.evaluate(()=>({view:document.querySelector('#gl').getBoundingClientRect().height,fonts:[...document.querySelectorAll('#steps .step .t')].map(e=>getComputedStyle(e).fontSize),why:document.querySelector('.level-why').textContent,document:[document.documentElement.scrollWidth,document.documentElement.scrollHeight]}));
  report.levels.push({piece,...state});assert.deepEqual(state.document,[1440,900]);assert.equal(new Set(state.fonts).size,1,'level label sizes match');assert.ok(state.why.split(/\s+/).length>=8);
  if(piece==='cone'){const bounds=await page.locator('#model-experiments').evaluate(e=>({width:e.clientWidth,child:[...e.children].find(c=>!c.hidden).getBoundingClientRect().width}));assert.ok(Math.abs(bounds.width-bounds.child)<2,'single experiment fills footer')}
  await page.screenshot({path:`${output}/${piece}.png`});
 }
 // The synthetic final-image panel whose height this used to hold steady was removed on purpose (c6209df).
 assert.equal(await page.locator('#finalimg,#finalimg-canvas,#pin-photo,#compare-photo,#compare-dialog').count(),0,'removed synthetic photo panel stays absent');
 await page.locator('#steps [data-piece="camera"]').click();await page.waitForFunction(()=>window.p2p.framing().piece==='camera');await rest();
 await page.evaluate(()=>window.p2p.set({fno:4}));await rest();
 await page.locator('#kit-lens').selectOption('n500');
 await page.waitForFunction(()=>!document.querySelector('#toast').hidden&&/f\/4 is wider than the 500 mm lens opens/.test(document.querySelector('#toast').textContent));
 report.clampNotice=await page.locator('#toast').textContent();assert.match(report.clampNotice,/widest, f\/5\.6 \(modeled at f\/5\.75\)/);
 await page.locator('#kit-lens').selectOption('n50');await page.evaluate(()=>window.p2p.pieces.camera.ready());await rest();
 // The pinned-photo comparison caption is gone with the synthetic photos; the reader-facing names it guarded now
 // live in the equipment summary and the view subtitle: catalog names and marked f-numbers, never internal ids.
 report.caption=[await page.locator('#equipment-summary').textContent(),await page.locator('#hud-sub').textContent()];
 assert.match(report.caption[0],/50 mm f\/1\.8$/);assert.match(report.caption[1],/^50\s*mm f\/5\.6\s·\s/i);
 for(const text of report.caption)assert.doesNotMatch(text,/n50|bench|5\.750/);
 await page.locator('#share-btn').click();
 await page.waitForFunction(()=>/^Link copied · Camera view$|piece=camera/.test(document.querySelector('#toast').textContent),null,{timeout:5000}); // the copy is asynchronous; the aperture toast from above may still be showing for a moment
 assert.equal(await page.locator('#toast').isVisible(),true);assert.match(await page.locator('#toast').textContent(),/^Link copied · Camera view$|piece=camera/); // ux r1: copied link names the view; the URL shows only without a clipboard
 assert.deepEqual(report.console,[],'no renderer warnings or browser errors');report.passed=true;
}catch(error){report.failure=String(error.stack||error);await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error}
finally{writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));await browser.close();await server?.close()}
