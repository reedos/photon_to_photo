import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startPreview } from './preview.mjs';
import { decodePng, pngPixel } from './accuracy/png.mjs';
const server=process.env.P2P_URL?null:await startPreview();
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
mkdirSync('shots/light-ribbons',{recursive:true});
const results=[];
const distanceToSegment=(p,a,b)=>{
  const ab=b.map((v,i)=>v-a[i]),ap=p.map((v,i)=>v-a[i]);
  const denom=ab.reduce((sum,v)=>sum+v*v,0),t=denom?Math.max(0,Math.min(1,ap.reduce((s,v,i)=>s+v*ab[i],0)/denom)):0;
  return Math.hypot(...p.map((v,i)=>v-a[i]-t*ab[i]));
};
function assertOnTraces(probe) {
  const paths=probe.paths.map(p=>p.world),legs=paths.flatMap(p=>p.slice(1).map((b,i)=>[p[i],b]));
  let maxError=0;
  for(const array of [probe.positions,probe.heads])for(let i=0;i<array.length;i+=6){
    const a=array.slice(i,i+3),b=array.slice(i+3,i+6);
    // Both ends must belong to the SAME original straight leg; refraction corners cannot be bridged.
    const error=Math.min(...legs.map(([x,y])=>Math.max(distanceToSegment(a,x,y),distanceToSegment(b,x,y))));
    maxError=Math.max(maxError,error);
  }
  assert.ok(maxError<.0001,`ribbon leaves traced leg by ${maxError}mm`);
  return maxError;
}
try {
  for(const width of [1366,390]) {
    const page=await browser.newPage({viewport:{width,height:width>760?900:844},reducedMotion:'reduce'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(new URL('?piece=camera',process.env.P2P_URL||server.url).href);await page.waitForFunction(()=>window.p2p?.pieces.camera);
    await page.evaluate(()=>window.p2p.set({lens:'n50',fno:4,focusM:3}));
    for(const piece of ['lens','cone']){
      await page.evaluate(p=>window.p2p.piece(p),piece);await page.evaluate(()=>window.p2p.settle());
      const bar=page.locator('.light-playback:visible'),slider=bar.locator('input');
      await bar.scrollIntoViewIfNeeded();await page.evaluate(()=>window.p2p.settle());
      await slider.fill('0');
      const viewBox=await page.locator('#view').boundingBox();
      const before=decodePng(await page.screenshot({path:`shots/light-ribbons/${piece}-${width}-before.png`}));
      await slider.fill('650');
      const ribbon=await page.evaluate(p=>window.p2p.pieces[p].lightRibbon(),piece);
      const maxError=assertOnTraces(ribbon);
      if(piece==='lens'){
        const engine=await page.evaluate(()=>window.p2p.pieces.lens.probe());
        for(const path of ribbon.paths)assert.ok(engine.rays.some(r=>r.nm===path.nm&&JSON.stringify(r.engine)===JSON.stringify(path.world)),'source path must equal fresh engine trace');
      }
      const after=decodePng(await page.screenshot({path:`shots/light-ribbons/${piece}-${width}-after.png`}));
      let changed=0;
      for(let y=Math.max(0,Math.ceil(viewBox.y));y<Math.min(before.height,Math.floor(viewBox.y+viewBox.height));y++)for(let x=Math.max(0,Math.ceil(viewBox.x));x<Math.min(before.width,Math.floor(viewBox.x+viewBox.width));x++){
        const a=pngPixel(before,x,y),b=pngPixel(after,x,y);
        if(Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2])>25)changed++;
      }
      assert.ok(changed>100,`ribbons not visibly different: ${changed}px`);
      await slider.fill('1000');
      const terminal=await page.evaluate(p=>window.p2p.pieces[p].lightRibbon(),piece);assertOnTraces(terminal);
      for(const path of terminal.paths){
        const end=path.world.at(-1);
        let found=false;for(let i=3;i<terminal.heads.length;i+=6)if(Math.hypot(...end.map((v,j)=>v-terminal.heads[i+j]))<.0001)found=true;
        assert.ok(found,'every moving head ends on its original terminal point');
      }
      await slider.fill('100');await bar.locator('button').click();
      await page.waitForFunction(p=>window.p2p.pieces[p].light().progress>.16,piece);
      const performance=await page.evaluate(async p=>{
        const frames=[],paint=[];let previous=performance.now();
        for(let i=0;i<60;i++)await new Promise(resolve=>requestAnimationFrame(now=>{frames.push(now-previous);previous=now;paint.push(window.p2p.pieces[p].light().lastPaintMs);resolve();}));
        return {frames,paint};
      },piece);
      await bar.locator('button').click();
      const frozen=await page.evaluate(p=>window.p2p.pieces[p].light().progress,piece);await page.waitForTimeout(150);
      assert.equal(await page.evaluate(p=>window.p2p.pieces[p].light().progress,piece),frozen);
      const sorted=performance.paint.sort((a,b)=>a-b),cpuP95=sorted[Math.floor(sorted.length*.95)];
      assert.ok(cpuP95<8,`ribbon update p95 ${cpuP95}ms`);
      const stats=await page.evaluate(p=>window.p2p.pieces[p].light(),piece);assert.ok(stats.paths<=96);assert.equal(stats.draws,4);
      results.push({width,piece,maxGeometryErrorMm:maxError,changedPixels:changed,cpuP95Ms:cpuP95,frameMedianMs:performance.frames.sort((a,b)=>a-b)[30],paths:stats.paths});
      console.log(`PASS ribbons ${piece}/${width}: actual traced legs and terminal points, ${changed} changed pixels, update p95 ${cpuP95.toFixed(2)}ms`);
    }
    await page.evaluate(()=>window.p2p.piece('camera'));
    assert.equal(await page.locator('.light-playback:visible').count(),0);
    assert.deepEqual(errors,[]);await page.close();
  }
  writeFileSync('shots/light-ribbons/results.json',JSON.stringify(results,null,2));
}finally{await browser.close();await server?.close();}
