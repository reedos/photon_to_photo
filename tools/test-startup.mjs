import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const label=process.env.STARTUP_LABEL||'measurement';
const out=`shots/startup/${label}`;mkdirSync(out,{recursive:true});
await build({build:{outDir:'dist-startup'},logLevel:'warn'});
const server=await preview({build:{outDir:'dist-startup'},preview:{host:'127.0.0.1',port:47721,strictPort:true},logLevel:'warn'});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
const results=[];
try {
  for(const [name,width,height] of [['desktop',1366,900],['phone',390,844]]) {
    const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
    const page=await context.newPage();page.setDefaultTimeout(90000);
    const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.addInitScript(()=>{
      window.startup={longTasks:[],workers:[],marks:{}};
      new PerformanceObserver(list=>window.startup.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
      const NativeWorker=window.Worker;
      window.Worker=class extends NativeWorker {
        constructor(...args){super(...args);this.url=String(args[0]);this.addEventListener('message',({data})=>window.startup.workers.push({phase:'received',type:data.type,id:data.id,time:performance.now()}));}
        postMessage(data,...args){window.startup.workers.push({phase:'sent',type:data.type,id:data.id,time:performance.now(),url:this.url});super.postMessage(data,...args);}
      };
      function frame(){
        const m=window.startup.marks,p=window.p2p;
        if(p&&!m.hooks)m.hooks=performance.now();
        if(p?.pieces.camera.state().loaded&&!m.models)m.models=performance.now();
        if(p&&document.querySelector('#veil')?.classList.contains('off')&&!document.querySelector('.rx-fire')?.disabled&&!m.usable){m.usable=performance.now();p.gpuIdle().then(()=>m.gpuReady=performance.now());}
        if(p?.render()&&!m.photo)m.photo=performance.now();
        if(!m.photo||!m.gpuReady)requestAnimationFrame(frame);
      }requestAnimationFrame(frame);
    });
    for(const cache of ['cold','warm']) {
      if(cache==='cold')await page.goto('http://127.0.0.1:47721/?piece=camera&lens=n50');else await page.reload();
      await page.waitForFunction(()=>window.startup?.marks.photo&&window.startup?.marks.gpuReady);
      await page.evaluate(()=>window.p2p.settle());
      await page.screenshot({path:`${out}/${name}-${cache}.png`});
      const result=await page.evaluate(()=>({...window.startup,resources:performance.getEntriesByType('resource').map(e=>({name:e.name.split('/').slice(-2).join('/'),start:e.startTime,end:e.responseEnd,duration:e.duration,transfer:e.transferSize,size:e.decodedBodySize})),navigation:performance.getEntriesByType('navigation')[0].toJSON()}));
      results.push({viewport:name,cache,...result});
      console.log(name,cache,JSON.stringify(result.marks));
      assert.deepEqual(errors,[]);
    }
    await context.close();
  }
}finally{writeFileSync(`${out}/timings.json`,JSON.stringify(results,null,2));await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
