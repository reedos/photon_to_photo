import assert from 'node:assert/strict';
import {mkdirSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {startPreview} from './preview.mjs';
const server=process.env.P2P_URL?null:await startPreview(),url=process.env.P2P_URL||server.url;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const out='shots/perspective';mkdirSync(out,{recursive:true});
const axe=readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'),'utf8');
try{
 for(const [width,height] of [[1366,900],[390,844],[320,740]]){
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce',recordVideo:width===1366?{dir:out,size:{width,height}}:undefined});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await page.goto(new URL('?piece=camera',url).href);await page.waitForFunction(()=>window.p2p);
  const before=await page.evaluate(()=>window.p2p.scenario());await page.locator('.perspective-launch').click();
  const seek=async f=>page.locator('#perspective-range').evaluate((e,f)=>{e.value=f;e.dispatchEvent(new Event('input'))},f);
  const state=()=>page.locator('#perspective-dialog canvas').evaluate(c=>({...c.dataset}));
  const image=()=>page.locator('#perspective-dialog canvas').evaluate(c=>c.toDataURL());
  await seek(20);const a=await state();await seek(500);const b=await state();
  assert.equal(a.backgroundRatio,b.backgroundRatio);assert.equal(a.distance,b.distance);assert.ok(+b.subjectHeight>+a.subjectHeight*25);
  await page.screenshot({path:`${out}/fixed-${width}.png`});
  await page.locator('#perspective-mode').selectOption('dolly');await seek(20);const c=await state(),small=await image();await seek(500);const d=await state();
  assert.ok(Math.abs(+c.subjectHeight-+d.subjectHeight)<1e-8);
  const pixelHeight=await page.locator('#perspective-dialog canvas').evaluate(c=>{const g=c.getContext('2d'),p=g.getImageData(480,25,1,520).data;const rows=[];for(let y=0;y<520;y++)if(p[y*4]>170&&p[y*4+1]>100&&p[y*4+2]<150)rows.push(y);return Math.max(...rows)-Math.min(...rows)+1});
  assert.ok(Math.abs(pixelHeight-520/3)<=3,`rendered fixed subject height ${pixelHeight}`);assert.ok(+d.backgroundRatio>+c.backgroundRatio);assert.notEqual(small,await image());
  await page.screenshot({path:`${out}/dolly-${width}.png`});
  await page.locator('#perspective-range').focus();await page.keyboard.press('Home');assert.equal(await page.locator('#perspective-range').inputValue(),'20');
  const layout=await page.locator('#perspective-dialog').evaluate(d=>({sw:d.scrollWidth,cw:d.clientWidth}));assert.ok(layout.sw<=layout.cw);
  const play=await page.locator('#perspective-play').boundingBox();assert.ok(play.y+play.height<=height,'play visible');
  await page.addScriptTag({content:axe});assert.deepEqual(await page.evaluate(async()=> (await axe.run(document.querySelector('#perspective-dialog'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}})).violations.map(v=>v.id)),[]);
  await page.locator('#perspective-play').click();await page.waitForFunction(()=>+document.querySelector('#perspective-range').value>25);await page.locator('#perspective-play').click();const value=await page.locator('#perspective-range').inputValue();await page.waitForTimeout(180);assert.equal(await page.locator('#perspective-range').inputValue(),value);
  if(width===1366){await page.locator('#perspective-play').click();await page.waitForFunction(()=>document.querySelector('#perspective-play').textContent==='Play sweep',{timeout:20000});assert.equal(await page.locator('#perspective-range').inputValue(),'500');}
  await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement===document.querySelector('.perspective-launch'));
  assert.deepEqual(await page.evaluate(()=>window.p2p.scenario()),before);assert.deepEqual(errors,[]);await context.close();console.log('PASS perspective',width);
 }
}finally{await browser.close();await server?.close()}
