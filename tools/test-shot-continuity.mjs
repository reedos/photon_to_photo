import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { decodePng } from './accuracy/png.mjs';
const output=process.env.P2P_AUDIT_OUTPUT||'shots/shot-continuity';mkdirSync(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1366,height:768},reducedMotion:'no-preference'});
page.setDefaultTimeout(30000);
const report={errors:[],frames:[]};
page.on('pageerror',error=>report.errors.push(String(error)));
page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
const seek=time=>page.locator('#shot-time').evaluate((el,time)=>{el.value=String(time);el.dispatchEvent(new Event('input',{bubbles:true}));},time);
const pixels=()=>page.locator('#shot-canvas').evaluate(canvas=>canvas.toDataURL());
function compare(a,b){
  const x=decodePng(Buffer.from(a.split(',')[1],'base64')),y=decodePng(Buffer.from(b.split(',')[1],'base64'));
  assert.equal(x.width,y.width);assert.equal(x.height,y.height);
  let changed=0,max=0;for(let i=0;i<x.data.length;i++){const difference=Math.abs(x.data[i]-y.data[i]);if(difference)changed++;max=Math.max(max,difference);}
  return {changed,max};
}
try {
  await page.goto(new URL('?piece=camera&lens=m50',process.env.P2P_URL||'http://127.0.0.1:47748/').href);
  await page.waitForFunction(()=>window.p2p?.pieces.camera);await page.evaluate(()=>window.p2p.pieces.camera.ready());
  await page.locator('.shot-launch').click();await page.locator('#shot-dialog[data-ready="true"]').waitFor();await seek(0);
  for(const width of [1366,390,320]){
    await page.setViewportSize({width,height:width===1366?768:width===390?844:568});
    for(const boundary of [4,8,12,16]){
      for(const offset of [-.3,0,.3]){
        const time=boundary+offset;await seek(time);
        assert.ok(await page.locator('#shot-canvas').getAttribute('data-handoff'), 'handoff must be rendered during its window');
        const before=await pixels();await seek(27);await seek(time);const after=await pixels();
        const difference=compare(before,after);
        if(difference.max>1){writeFileSync(`${output}/mismatch-before.png`,Buffer.from(before.split(',')[1],'base64'));writeFileSync(`${output}/mismatch-after.png`,Buffer.from(after.split(',')[1],'base64'));}
        assert.ok(difference.max<=1&&difference.changed<=30,`reverse seek must preserve pixels ${JSON.stringify({width,time,...difference})}`);
        assert.equal(await page.locator('#shot-dialog').getAttribute('data-playing'),'false','scrubbing pauses');
        const fit=await page.locator('#shot-dialog').evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth);
        assert.ok(fit,'shot dialog fits horizontally');
        report.frames.push({width,time,...difference});
        if(offset===0)await page.screenshot({path:`${output}/${width}-handoff-${boundary}.png`});
      }
    }
  }
  await page.locator('#shot-track').selectOption('charge');await seek(12);
  assert.equal(await page.locator('#shot-canvas').getAttribute('data-handoff'),'','isolated charge starts within pixel');
  await seek(16);assert.equal(await page.locator('#shot-canvas').getAttribute('data-handoff'),'','charge endpoint stays in charge');
  await page.locator('#shot-track').selectOption('all');await page.emulateMedia({reducedMotion:'reduce'});await seek(12);
  assert.equal(await page.locator('#shot-canvas').getAttribute('data-handoff'),'','reduced motion bypasses camera transfer');
  await page.emulateMedia({reducedMotion:'no-preference'});await seek(3.8);await page.locator('#shot-play').click();
  await page.waitForFunction(()=>Number(document.querySelector('#shot-time').value)>4.5);
  await page.locator('#shot-play').click();const stopped=await page.locator('#shot-time').inputValue();await page.waitForTimeout(250);
  assert.equal(await page.locator('#shot-time').inputValue(),stopped,'pause freezes continuous transfer');
  await seek(28);const final=await pixels();await page.emulateMedia({reducedMotion:'reduce'});await seek(28);
  assert.deepEqual(compare(final,await pixels()),{changed:0,max:0},'normal and reduced motion have the same finished JPEG');
  const sourceDifference=await page.locator('#shot-canvas').evaluate(async canvas=>{
    const image=new Image();image.src=new URL('examples/flycatcher.jpg',document.baseURI).href;await image.decode();
    const reference=document.createElement('canvas');reference.width=canvas.width;reference.height=canvas.height;
    const context=reference.getContext('2d');context.setTransform(canvas.width/1000,0,0,canvas.height/560,0,0);
    const scale=Math.min(952/image.naturalWidth,470/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale,x=24+(952-w)/2,y=20+(470-h)/2;
    context.drawImage(image,x,y,w,h);
    const actual=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,expected=context.getImageData(0,0,canvas.width,canvas.height).data;
    let max=0;for(let yy=Math.ceil((y+2)*canvas.height/560);yy<(y+h-2)*canvas.height/560;yy+=3)for(let xx=Math.ceil((x+2)*canvas.width/1000);xx<(x+w-2)*canvas.width/1000;xx+=3)for(let channel=0;channel<3;channel++){const i=(yy*canvas.width+xx)*4+channel;max=Math.max(max,Math.abs(actual[i]-expected[i]));}
    return max;
  });
  assert.ok(sourceDifference<=1,`native photo raster preserves supplied JPEG (${sourceDifference})`);
  assert.deepEqual(report.errors,[]);console.log(`PASS ${report.frames.length} normal-motion handoff frames; deterministic scrub, pause, process tracks, reduced motion, unchanged finish`);
}finally{writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));await browser.close();}
