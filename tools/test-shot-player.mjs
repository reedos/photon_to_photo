import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {startPreview} from './preview.mjs';
import {decodePng} from './accuracy/png.mjs';
const server=process.env.P2P_URL?null:await startPreview(),url=process.env.P2P_URL||server.url;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const axe=readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'),'utf8');
mkdirSync('shots/shot/verified',{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1366,height:768},reducedMotion:'no-preference'}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
 await page.goto(`${url}?lens=n50&part=sensor&lux=7300&cct=4200`);await page.waitForFunction(()=>window.p2p?.pieces.camera);
 await page.evaluate(()=>window.p2p.pieces.camera.ready());
 const before=await page.evaluate(()=>({scenario:window.p2p.scenario(),selected:window.p2p.framing().selected,query:location.search}));
 await page.locator('.shot-launch').click();await page.locator('#shot-close').click();
 assert.equal(await page.locator('#shot-dialog').evaluate(d=>d.open),false,'close cancels loading');
 await page.locator('.shot-launch').click();
 const seek=async t=>page.locator('#shot-time').evaluate((el,t)=>{el.value=String(t);el.dispatchEvent(new Event('input',{bubbles:true}));},t);
 await seek(8);await page.waitForSelector('#shot-dialog[data-ready="true"]',{timeout:120000});
 assert.equal(await page.locator('#shot-dialog').getAttribute('data-playing'),'false','loading must not override a user seek');
 console.log('fast render ms',await page.locator('#shot-dialog').getAttribute('data-render-ms'));
 assert.equal(Number(await page.locator('#shot-time').inputValue()),8);
 const image=()=>page.locator('#shot-canvas').evaluate(c=>c.toDataURL());
 for(let i=0;i<6;i++){
  await page.locator(`[data-shot-chapter="${i}"]`).click();
  assert.equal(await page.locator('[data-shot-chapter][aria-current="true"]').getAttribute('data-shot-chapter'),String(i));
  await seek(i===5?28:[2,6,10,14,19][i]);
  const a=await image();await seek(0);await seek(i===5?28:[2,6,10,14,19][i]);const b=await image();if(a!==b){
   const expected=decodePng(Buffer.from(a.split(',')[1],'base64')),actual=decodePng(Buffer.from(b.split(',')[1],'base64'));
   assert.equal(actual.width,expected.width);assert.equal(actual.height,expected.height);
   let changed=0,max=0;for(let n=0;n<expected.data.length;n++){const d=Math.abs(expected.data[n]-actual.data[n]);if(d)changed++;max=Math.max(max,d);}
   // Accelerated Canvas can round a ray edge by one channel level on a repeated draw.
   // Preserve deterministic geometry/color while allowing at most20 such channel samples.
   const equivalent=max<=1&&changed<=20;
   if(!equivalent){writeFileSync(`shots/shot/verified/scrub-expected-${i}.png`,Buffer.from(a.split(',')[1],'base64'));writeFileSync(`shots/shot/verified/scrub-actual-${i}.png`,Buffer.from(b.split(',')[1],'base64'));}
   assert.ok(equivalent,`chapter ${i}: scrub changed ${changed} channels by up to ${max}`);
  }
  await page.screenshot({path:`shots/shot/verified/desktop-${i}.png`});
 }
 const fast=await image();await page.locator('#shot-preset').selectOption('slow');await page.waitForSelector('#shot-dialog[data-ready="true"]',{timeout:120000});
 console.log('slow render ms',await page.locator('#shot-dialog').getAttribute('data-render-ms'));
 await seek(28);assert.notEqual(await image(),fast,'shutter choice visibly changes the photograph');
 await page.screenshot({path:'shots/shot/verified/desktop-slow.png'});
 assert.match(await page.locator('#shot-measures').innerText(),/48 mm/);
 await page.locator('#shot-speed').selectOption('2');await seek(26);await page.locator('#shot-play').click();
 await page.waitForSelector('#shot-dialog[data-playing="false"]');assert.equal(Number(await page.locator('#shot-time').inputValue()),28,'completion holds');
 await page.locator('#shot-replay').click();await page.waitForFunction(()=>+document.getElementById('shot-time').value>.2);await page.locator('#shot-play').click();
 const paused=await page.locator('#shot-time').inputValue();await page.waitForTimeout(150);assert.equal(await page.locator('#shot-time').inputValue(),paused);
 await page.locator('#shot-play').click();await page.locator('.shot-notes summary').click();await page.waitForSelector('#shot-dialog[data-playing="false"]',{timeout:1000});await page.locator('.shot-notes summary').click();
 await seek(0);
 await page.evaluate(()=>{window.shotFrames={count:0,stages:new Set(),start:performance.now()};const sample=()=>{const d=document.getElementById('shot-dialog');window.shotFrames.count++;window.shotFrames.stages.add(d.dataset.stage);if(d.dataset.playing==='true')requestAnimationFrame(sample);};document.getElementById('shot-play').click();requestAnimationFrame(sample);});
 await page.waitForSelector('#shot-dialog[data-playing="false"]',{timeout:45000});
 const playback=await page.evaluate(()=>({frames:window.shotFrames.count,stages:[...window.shotFrames.stages],seconds:(performance.now()-window.shotFrames.start)/1000}));
 assert.deepEqual(playback.stages,['0','1','2','3','4','5']);assert.ok(playback.frames>140,'whole sequence renders at least ten frames per illustrative second');console.log('full playback',playback);
 await page.locator('#shot-time').focus();await page.keyboard.press('End');assert.equal(Number(await page.locator('#shot-time').inputValue()),28);await page.keyboard.press('Home');assert.equal(Number(await page.locator('#shot-time').inputValue()),0);
 for(const [track,start,end,stage] of [['light',0,12,2],['charge',12,16,3],['data',16,28,5]]){
  await page.locator('#shot-track').selectOption(track);assert.equal(Number(await page.locator('#shot-time').inputValue()),start);
  await page.locator('#shot-time').focus();await page.keyboard.press('End');assert.equal(Number(await page.locator('#shot-time').inputValue()),end);
  assert.equal(await page.locator('#shot-dialog').getAttribute('data-stage'),String(stage),'process endpoint holds its own visual');
 }
 await page.locator('#shot-track').selectOption('all');
 await page.addScriptTag({content:axe});
 for(const [width,height] of [[1366,768],[390,844],[320,740]]){
  await page.setViewportSize({width,height});await seek(14);
  const layout=await page.locator('#shot-dialog').evaluate(d=>({sw:d.scrollWidth,cw:d.clientWidth,sh:d.scrollHeight,ch:d.clientHeight,b:d.getBoundingClientRect().toJSON()}));
  assert.ok(layout.sw<=layout.cw+1,'no horizontal scroll');assert.ok(layout.b.top>=0&&layout.b.bottom<=height+1,'dialog stays within viewport');
  assert.ok(layout.sh-layout.ch <= (width<400?24:1),JSON.stringify({width,...layout})); // Primary controls are checked separately below.
  const play=await page.locator('#shot-play').boundingBox();assert.ok(play.y+play.height<=height,'transport visible without scrolling');
  const violations=await page.evaluate(async()=>{const r=await axe.run(document.querySelector('#shot-dialog'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}});return r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));});
  assert.deepEqual(violations,[]);await page.screenshot({path:`shots/shot/verified/${width}.png`});
 }
 await page.keyboard.press('Escape');assert.equal(await page.locator('#shot-dialog').evaluate(d=>d.open),false);
 assert.deepEqual(await page.evaluate(()=>({scenario:window.p2p.scenario(),selected:window.p2p.framing().selected,query:location.search})),before,'closing preserves selected part and every setting');
 await page.setViewportSize({width:1366,height:768});await page.locator('.view-menu summary').click();await page.getByRole('button',{name:'Play the shot',exact:true}).click();await page.locator('#shot-close').click();
 await page.waitForFunction(()=>document.querySelector('.view-menu summary')===document.activeElement);
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.shot-launch').click();await page.waitForSelector('#shot-dialog[data-ready="true"]');assert.equal(await page.locator('#shot-dialog').getAttribute('data-playing'),'false');
 await page.locator('#shot-use').click();
 const applied=await page.evaluate(()=>window.p2p.scenario());assert.equal(applied.scene,'flight');assert.equal(applied.lux,10000);assert.equal(applied.cct,5500);assert.equal(applied.shutter,1/125);
 assert.deepEqual(errors,[]);console.log('shot player: desktop/mobile, exact scrubbing, buffer distinction, timing, state isolation, focus, reduced motion, axe passed');
}finally{await browser.close();await server?.close();}
