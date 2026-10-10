import {chromium} from 'playwright';
import fs from 'node:fs';
const base=process.env.P2P_URL;
if(!base||new URL(base).hostname!=='127.0.0.1')throw new Error('Set P2P_URL to the isolated preview');
const phase=process.env.AUDIT_PHASE||'after';
const directory=`shots/astra-ex1/${phase}`;fs.mkdirSync(directory,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const results=[];
const routes=[['opening','index.html'],['camera','index.html?piece=camera&lens=n50'],['optics','index.html?piece=lens&lens=n50'],['focus','index.html?piece=cone&lens=n50'],['pixel','index.html?piece=loupe&lens=n50'],['models','models.html'],['lens-preview','lens-preview.html'],['scene-preview','scene-preview.html'],...['story','evidence','method','glossary','parts'].map(page=>[page,`reference.html?page=${page}`])];
try {
  for(const width of [360,390,430]) {
    const page=await browser.newPage({viewport:{width,height:900},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
    for(const [name,route] of routes) {
      const errors=[];const handler=e=>errors.push(String(e));page.on('pageerror',handler);
      await page.goto(new URL(route,base).href);
      if(['camera','optics','focus','pixel'].includes(name)) {
        const piece={camera:'camera',optics:'lens',focus:'cone',pixel:'loupe'}[name];
        await page.waitForFunction(id=>window.p2p?.pieces[id],piece,{timeout:90000});
        await page.evaluate(async id=>{const p=window.p2p.pieces[id];if(p?.ready)await p.ready();},piece);
        await page.waitForFunction(()=>document.querySelector('#veil')?.classList.contains('off')&&!window.p2p.framing().moving,null,{timeout:90000});
      }
      if(name==='models')await page.waitForFunction(()=>window.p2pModels?.ready&&document.querySelector('#veil')?.classList.contains('off'),null,{timeout:90000});
      if(name==='lens-preview')await page.waitForSelector('canvas[data-ready="1"]',{timeout:90000});
      if(name==='scene-preview')await page.waitForFunction(()=>/WebGPU|WebGL2/i.test(document.querySelector('#hud')?.textContent||''),null,{timeout:90000});
      await page.evaluate(()=>document.fonts.ready);
      if(await page.locator('#veil').isVisible())await page.waitForFunction(()=>getComputedStyle(document.querySelector('#veil')).opacity==='0',null,{timeout:90000});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const result=await page.evaluate(()=>{
        const controls=[...document.querySelectorAll('button,a,input,select,summary')].filter(el=>{
          const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width&&r.height&&s.visibility!=='hidden'&&s.display!=='none'&&!el.closest('[hidden]');
        });
        const targetSize=el=>{const r=el.getBoundingClientRect(),pseudo=getComputedStyle(el,'::before');
          const expansion=pseudo.content!=='none'&&pseudo.position==='absolute'?[pseudo.left,pseudo.right,pseudo.top,pseudo.bottom].map(v=>Math.max(0,-parseFloat(v)||0)):[0,0,0,0];
          return {width:r.width+expansion[0]+expansion[1],height:r.height+expansion[2]+expansion[3]};};
        return {accent:getComputedStyle(document.querySelector('#stage-section')||document.body).getPropertyValue('--accent').trim(),text:document.body.innerText,overflow:document.documentElement.scrollWidth>innerWidth+1,smallTargets:controls.filter(el=>{const r=targetSize(el);return r.height<24||r.width<24;}).map(el=>({label:(el.getAttribute('aria-label')||el.textContent||el.id).trim().slice(0,90),id:el.id,class:el.className,...targetSize(el)}))};
      });
      await page.screenshot({path:`${directory}/${name}-${width}.png`});
      page.off('pageerror',handler);results.push({name,width,...result,errors});
      console.log(name,width,result.overflow?'OVERFLOW':'fit',`${result.smallTargets.length} sub-24px targets`,`${errors.length} errors`);
    }
    await page.close();
  }
} finally {await browser.close();}
fs.writeFileSync(`${directory}/report.json`,JSON.stringify(results,null,2));
process.exitCode=results.some(r=>r.overflow||r.errors.length||(phase==='after'&&(r.smallTargets.length||(r.accent&&r.accent!=='#e6ba82'))))?1:0;
