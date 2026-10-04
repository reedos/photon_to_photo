// Pixel inspection now uses a controlled neutral target rather than a rendered photograph.
// Check sensor-derived geometry, honest packet counts, determinism and visible exposure response.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { startPreview } from '../preview.mjs';
import { decodePNG } from './pngdecode.mjs';
const server=process.env.P2P_URL?null:await startPreview(),base=process.env.P2P_URL||server.url;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
mkdirSync('shots/loupe-accuracy',{recursive:true});
try {
 for(const backend of ['webgpu','webgl2']) {
  const p=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'}),errors=[];
  p.on('pageerror',e=>errors.push(String(e)));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await p.goto(new URL(`?piece=loupe&lens=n50${backend==='webgl2'?'&gl=webgl2':''}`,base).href);
  const rest=()=>p.waitForFunction(()=>window.p2p?.pieces.loupe?.state().hasPixel&&!window.p2p.framing().moving&&document.querySelector('#veil').classList.contains('off')&&getComputedStyle(document.querySelector('#veil')).opacity==='0');
  await rest();assert.equal(await p.evaluate(()=>window.p2p.backend()),backend);
  const shots=[];
  for(const shutter of [.002,.1]) {
   await p.evaluate(shutter=>window.p2p.set({fno:4,iso:100,shutter,lux:10000}),shutter);await rest();await p.evaluate(()=>window.p2p.settle());
   const data=await p.evaluate(()=>({fill:window.p2p.pieces.loupe.drawnFill(),probe:window.p2p.pieces.loupe.probe(),badge:window.p2p.pieces.loupe.badge(),camera:window.p2p.pieces.loupe.debugCamera()}));
   assert.ok(data.probe.pixel.photonsMean>0);assert.ok(Math.abs(data.fill.fillHeightUnits/data.fill.wellHeightUnits-data.fill.fillFrac)<.01);
   assert.ok(Math.abs(data.badge.photonsMean-data.badge.n*data.badge.dotsDrawn)<=data.badge.n);
   assert.ok(data.camera.chargeVisible);assert.ok(data.camera.chargeNdc.every(Number.isFinite));
   const bytes=await p.locator('#gl').screenshot({path:`shots/loupe-accuracy/${backend}-${shutter}.png`}),png=decodePNG(bytes);
   const x=Math.round((data.camera.chargeNdc[0]+1)*png.width/2),y=Math.round((1-data.camera.chargeNdc[1])*png.height/2);
   assert.ok(x>0&&x<png.width&&y>0&&y<png.height,'charge well stays in frame');
   const offset=(y*png.width+x)*4,color=Array.from(png.data.slice(offset,offset+3));
   assert.ok(color.some(c=>c>35),'charge is visibly lit at its projected position');shots.push({data,bytes,color});
  }
  assert.ok(shots[1].data.fill.fillFrac>shots[0].data.fill.fillFrac+.1,'longer exposure visibly fills the well');assert.notDeepEqual(shots[0].bytes,shots[1].bytes,'exposure changes the rendered model');
  const twice=await p.evaluate(()=>window.p2p.pieces.loupe.sampleTwice());assert.deepEqual(twice.a,twice.b);
  assert.deepEqual(errors,[]);console.log(`PASS ${backend}: independent pixel, drawn charge, visible exposure response, packet counts and determinism`);await p.close();
 }
}finally{await browser.close();await server?.close();}
