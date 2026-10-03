import type { Store } from './store';
import { formatShutter } from './store';
import { compute } from './engine-api';
import { emit } from './bus';
import type { RenderView } from './render-client';
import { birdShot, shotMoment, SHOT_DURATION, SHOT_STAGES } from './shot-model';
import { createShotVisual } from './shot-visual';
import '../styles/shot.css';

export function createShotPlayer(store:Store) {
  const dialog=document.createElement('dialog');dialog.id='shot-dialog';dialog.setAttribute('aria-labelledby','shot-title');
  dialog.innerHTML=`<header><div><span class="shot-eyebrow">From a fleeting moment to a photograph</span><h2 id="shot-title">Play the shot</h2></div><button class="btn" id="shot-close" autofocus>Close</button></header>
    <div class="shot-options"><label>Capture<select id="shot-preset"><option value="fast">Freeze the bird · 1/2000 s</option><option value="slow">Let it blur · 1/125 s</option></select></label><span id="shot-settings"></span></div>
    <canvas id="shot-canvas" role="img" aria-label="A bird's journey through a camera"></canvas>
    <div class="shot-story" aria-live="polite" aria-atomic="true"><div><span id="shot-step"></span><h3 id="shot-heading"></h3></div><p id="shot-caption"></p></div>
    <div id="shot-measures"></div>
    <nav class="shot-chapters" aria-label="Shot chapters">${['Bird','Optics','Exposure','Charge','Readout','Photo'].map((s,i)=>`<button class="btn" data-shot-chapter="${i}" aria-label="Chapter ${i+1}: ${s}">${i+1}<span> ${s}</span></button>`).join('')}</nav>
    <div class="shot-transport"><button class="btn" id="shot-play">Play</button><button class="btn" id="shot-replay">Replay</button><label class="shot-scrub"><span class="sr-only">Shot timeline</span><input id="shot-time" type="range" min="0" max="28" step="0.05" value="0" aria-label="Shot timeline"></label><span id="shot-clock" aria-live="off">0 / 28 s</span><label><span class="sr-only">Playback speed</span><select id="shot-speed" aria-label="Playback speed"><option value="0.5">½×</option><option value="1" selected>1×</option><option value="2">2×</option></select></label></div>
    <footer><span id="shot-status" role="status">Preparing shot…</span><button class="btn" id="shot-retry" hidden>Retry</button><button class="btn" id="shot-use">Explore these settings →</button></footer><p class="shot-footnote">Illustrative time and scale · rigid glide · modeled lens and sensor · same scene and random seed in both captures</p>`;
  document.body.append(dialog);
  const el=<T extends HTMLElement=HTMLElement>(id:string)=>dialog.querySelector<T>(`#shot-${id}`)!;
  let model=compute(birdShot(false)),visual=createShotVisual(el<HTMLCanvasElement>('canvas'),model);
  let time=0,playing=false,last=0,raf=0,worker:Worker|null=null,timer=0,generation=0,ready=false;
  let opener:HTMLElement|null=null,slow=false,prevStage=-1,autoIntent=false;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const cache=new Map<boolean,RenderView>();
  function stopWorker(){generation++;worker?.terminate();worker=null;clearTimeout(timer);}
  function draw(){
    const m=shotMoment(time),s=SHOT_STAGES[m.stage];
    const buffer=visual.draw(time,ready);
    dialog.dataset.stage=String(m.stage);dialog.dataset.ready=String(ready);dialog.dataset.playing=String(playing);
    dialog.style.setProperty('--shot-color',s.color);
    if(el('heading').textContent!==(buffer||s.title)) el('heading').textContent=buffer||s.title;
    if(prevStage!==m.stage){el('caption').textContent=s.text;el('step').textContent=`${m.stage+1} / 6`;
      const n=(v:number)=>Math.round(v).toLocaleString();
      const stats=m.stage===3?[[n(model.exposure.photonsMidGray),'photons / gray pixel'],[n(model.exposure.electronsMidGray),'expected electrons'],[n(model.sensor.fullWellE),'electrons / full well'],[model.exposure.snrMidGray.toFixed(1),'reference SNR']]:
        m.stage===4?[[formatShutter(model.scenario.shutter)+' s','shutter'],[(model.sensor.readoutS*1000).toFixed(1)+' ms','full-frame scan'],[String(model.sensor.bits)+' bit','raw conversion'],['RGGB','filter mosaic']]:
        [[formatShutter(model.scenario.shutter)+' s','shutter'],[(model.motion!.speedMps*model.scenario.shutter*1000).toFixed(0)+' mm','travel'],[model.motion!.blurPx.toFixed(1)+' px','native sensor blur'],[n(model.exposure.photonsMidGray),'photons / gray pixel']];
      el('measures').innerHTML=stats.map(([value,label])=>`<span><b>${value}</b> ${label}</span>`).join('');
    }
    el('time').style.setProperty('--pct',`${time/SHOT_DURATION*100}%`);
    el<HTMLCanvasElement>('canvas').setAttribute('aria-label',`${s.title}. ${s.text}`);
    el<HTMLInputElement>('time').value=String(time);el('time').setAttribute('aria-valuetext',`${s.title}, ${time.toFixed(1)} of 28 illustrative seconds`);
    el('clock').textContent=`${Math.floor(time)} / 28 s`;
    el('play').textContent=playing?'Pause':time>=SHOT_DURATION?'Replay':'Play';el('replay').textContent='Restart';
    if(prevStage!==m.stage){for(const b of dialog.querySelectorAll<HTMLButtonElement>('[data-shot-chapter]'))b.setAttribute('aria-current',String(Number(b.dataset.shotChapter)===m.stage));prevStage=m.stage;}
  }
  function tick(now:number){
    if(!dialog.open)return;
    if(playing&&ready){time=Math.min(SHOT_DURATION,time+Math.max(0,Math.min(.1,(now-last)/1000))*Number(el<HTMLSelectElement>('speed').value));if(time===SHOT_DURATION){playing=false;el('status').textContent='Your photo is ready. Try the other capture to compare motion blur.';}}
    last=now;draw();if(playing)raf=requestAnimationFrame(tick);
  }
  function play(){if(!ready)return;if(time>=SHOT_DURATION)time=0;playing=true;cancelAnimationFrame(raf);last=performance.now();raf=requestAnimationFrame(tick);draw();}
  function pause(){playing=false;cancelAnimationFrame(raf);if(ready)el('status').textContent=`Paused · ${SHOT_STAGES[shotMoment(time).stage].title}`;draw();}
  function loaded(v:RenderView){cache.set(slow,v);visual.setPhoto(v);ready=true;dialog.dataset.renderMs=String(v.meta.ms);
    el('status').textContent='Ready · the photo and its processing buffers are computed from this shot.';
    el<HTMLButtonElement>('play').disabled=false;el<HTMLButtonElement>('use').disabled=false;
    if(autoIntent&&!reduced.matches&&!document.hidden)play();else draw();
  }
  function prepare(auto:boolean){
    pause();stopWorker();ready=false;time=0;prevStage=-1;autoIntent=auto;
    model=compute(birdShot(slow));visual=createShotVisual(el<HTMLCanvasElement>('canvas'),model);
    el('settings').textContent=`500 mm · f/${Number(model.scenario.fno.toFixed(2))} · ISO ${model.scenario.iso} · 20 m`;
    el('status').textContent='Preparing shot… the image is being computed, not downloaded.';
    el('retry').hidden=true;el<HTMLButtonElement>('play').disabled=true;el<HTMLButtonElement>('use').disabled=true;draw();
    const hit=cache.get(slow);if(hit){loaded(hit);return;}
    const id=generation;
    function fail(){if(id!==generation)return;stopWorker();el('status').textContent='The shot could not finish. Retry to render it again.';el('retry').hidden=false;draw();}
    try {
      worker=new Worker(new URL('./render-worker.ts',import.meta.url),{type:'module'});
      worker.onmessage=({data:m})=>{if(id!==generation||!dialog.open)return;if(m.type==='error'){fail();return;}if(m.type!=='render')return;
        stopWorker();loaded({...m,renderId:m.id,scenario:structuredClone(model.scenario)});};
      worker.onerror=e=>{e.preventDefault();fail();};worker.onmessageerror=fail;
      timer=window.setTimeout(fail,120000);
      worker.postMessage({type:'render',id,scenario:model.scenario,width:600,height:400,seed:1});
    }catch{fail();}
  }
  el('close').onclick=()=>dialog.close();
  el('play').onclick=()=>playing?pause():play();
  el('replay').onclick=()=>{autoIntent=false;time=0;play();draw();};
  el('retry').onclick=()=>prepare(true);
  el<HTMLInputElement>('time').oninput=()=>{autoIntent=false;time=Number(el<HTMLInputElement>('time').value);pause();};
  el('preset').onchange=()=>{slow=el<HTMLSelectElement>('preset').value==='slow';prepare(false);};
  for(const b of dialog.querySelectorAll<HTMLButtonElement>('[data-shot-chapter]'))b.onclick=()=>{autoIntent=false;time=SHOT_STAGES[Number(b.dataset.shotChapter)].start;pause();};
  el('use').onclick=()=>{if(!ready)return;store.set(structuredClone(model.scenario));dialog.close();};
  dialog.addEventListener('keydown',e=>e.stopPropagation());
  dialog.addEventListener('close',()=>{pause();stopWorker();const target=opener?.getClientRects().length&&!opener.closest('details:not([open])')?opener:document.querySelector<HTMLElement>('.view-menu summary');target?.focus({preventScroll:true});});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&dialog.open){autoIntent=false;pause();}});
  reduced.addEventListener('change',()=>{if(reduced.matches&&dialog.open)pause();});
  new ResizeObserver(()=>{if(dialog.open)draw();}).observe(el('canvas'));
  return (source:HTMLElement)=>{opener=source;emit('pause-exposure',{});emit('pause-tour',{});dialog.showModal();prepare(true);};
}
