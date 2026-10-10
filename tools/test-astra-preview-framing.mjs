import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdirSync} from 'node:fs';
const base=process.env.P2P_URL;
assert.equal(new URL(base).hostname,'127.0.0.1');
mkdirSync('shots/astra-ex1/after',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
try {
 for(const entry of ['scene-preview.html','lens-preview.html']) {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.goto(new URL(entry,base).href);
  await page.waitForFunction(()=>window.p2pPreview||window.p2pLensPreview);
  for(const width of [1440,360,390,430]) {
   await page.setViewportSize({width,height:900});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const projection=await page.evaluate(()=>{
    const h=window.p2pPreview||window.p2pLensPreview, camera=h.camera, root=h.handle?.group||h.scene;
    camera.updateMatrixWorld(true);root.updateMatrixWorld(true);
    let corners=0,maxX=0,maxY=0;
    root.traverseVisible(obj=>{
     if(!obj.isMesh||!obj.geometry)return;
     obj.geometry.computeBoundingBox();const box=obj.geometry.boundingBox;
     if(!box||box.isEmpty())return;
     for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
      const point=obj.position.clone().set(x,y,z).applyMatrix4(obj.matrixWorld).project(camera);
      maxX=Math.max(maxX,Math.abs(point.x));maxY=Math.max(maxY,Math.abs(point.y));corners++;
     }
    });
    return {corners,maxX,maxY};
   });
   assert.ok(projection.corners>0);
   assert.ok(projection.maxX<=1&&projection.maxY<=1,`${entry}/${width} clips geometry: ${JSON.stringify(projection)}`);
   await page.screenshot({path:`shots/astra-ex1/after/${entry.replace('.html','')}-${width}.png`});
   console.log('PASS',entry,width,projection);
  }
  // Orbit, then resize by 1 px: the view direction must survive (regression: reset to the initial angle).
  {
   await page.setViewportSize({width:1440,height:900});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const dir=()=>page.evaluate(()=>{const h=window.p2pPreview||window.p2pLensPreview;const c=h.camera;const t=h.controls?h.controls.target:{x:0,y:0,z:0};return [c.position.x-t.x,c.position.y-t.y,c.position.z-t.z];});
   const rotated=await page.evaluate(()=>{
    const h=window.p2pPreview||window.p2pLensPreview, c=h.camera;
    // Orbit about the origin-relative target by yawing and pitching the camera position (controls.update keeps it on the sphere).
    const ctl=h.controls; const t=ctl?ctl.target.clone():c.position.clone().multiplyScalar(0);
    const off=c.position.clone().sub(t); const sph=new c.position.constructor().copy(off);
    const r=off.length(); let theta=Math.atan2(off.x,off.z)+0.9, phi=Math.acos(off.y/r)-0.5;
    c.position.set(t.x+r*Math.sin(phi)*Math.sin(theta),t.y+r*Math.cos(phi),t.z+r*Math.sin(phi)*Math.cos(theta));
    c.lookAt(t); c.updateMatrixWorld(true); return !!ctl;
   });
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const before=await dir();
   await page.setViewportSize({width:1440,height:899});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const after=await dir();
   const dot=before.reduce((s,v,i)=>s+v*after[i],0)/(Math.hypot(...before)*Math.hypot(...after));
   const degrees=Math.acos(Math.min(1,dot))*180/Math.PI;
   assert.ok(degrees<1,`${entry}: 1 px resize after orbit moved the view by ${degrees.toFixed(2)} degrees`);
   console.log('PASS orbit kept on resize',entry,degrees.toFixed(4),'deg');
  }
  await page.close();
 }
} finally {await browser.close();}
