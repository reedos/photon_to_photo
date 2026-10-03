import type { Store } from './store';
import { formatShutter } from './store';
import { compute } from './engine-api';
import { emit } from './bus';
import type { RenderView } from './render-client';
import { birdShot, shotMoment, SHOT_STAGES, SHOT_TRACKS, type ShotTrack } from './shot-model';
import { createShotVisual } from './shot-visual';
import { loadExamples, type Example } from './examples';
import { photoShotScenario, photoShotStages, photoShotStats, photoShotFootnote } from './photo-shot';
import { fmtDistance, fmtFno, fmtShutter } from './units';
import '../styles/shot.css';

export function createShotPlayer(store:Store) {
  const dialog=document.createElement('dialog');dialog.id='shot-dialog';dialog.setAttribute('aria-labelledby','shot-title');
  dialog.innerHTML=`<header><div><span class="shot-eyebrow">A guided bird example · from light to photograph</span><h2 id="shot-title">Play the shot</h2></div><button class="btn" id="shot-close" autofocus>Close</button></header>
    <div class="shot-options"><label>Source<select id="shot-source"><option value="bird">Bird simulation</option></select></label><label id="shot-capture">Capture<select id="shot-preset"><option value="fast">Freeze the bird · 1/2000 s</option><option value="slow">Let it blur · 1/125 s</option></select></label><label class="shot-follow">Follow<select id="shot-track">${Object.entries(SHOT_TRACKS).map(([id,t])=>`<option value="${id}">${t.label}</option>`).join('')}</select></label><span id="shot-settings"></span></div>
    <div class="shot-main"><canvas id="shot-canvas" role="img" aria-label="A bird's journey through a camera"></canvas>
    <aside class="shot-explanation"><div class="shot-story" aria-live="polite" aria-atomic="true"><div><span id="shot-step"></span><h3 id="shot-heading"></h3></div><p id="shot-caption"></p></div>
    <div id="shot-measures"></div></aside></div>
    <nav class="shot-chapters" aria-label="Shot chapters">${['Bird','Optics','Exposure','Charge','Readout','Photo'].map((s,i)=>`<button class="btn" data-shot-chapter="${i}" aria-label="Chapter ${i+1}: ${s}">${i+1}<span> ${s}</span></button>`).join('')}</nav>
    <div class="shot-transport"><button class="btn" id="shot-play">Play</button><button class="btn" id="shot-replay">Replay</button><label class="shot-scrub"><span class="sr-only">Shot timeline</span><input id="shot-time" type="range" min="0" max="28" step="0.05" value="0" aria-label="Shot timeline"></label><span id="shot-clock" aria-live="off">0 / 28 s</span><label><span class="sr-only">Playback speed</span><select id="shot-speed" aria-label="Playback speed"><option value="0.5">½×</option><option value="1" selected>1×</option><option value="2">2×</option></select></label></div>
    <footer><span id="shot-status" role="status">Preparing shot…</span><button class="btn" id="shot-retry" hidden>Retry</button><span class="shot-footer-actions"><button class="btn" id="shot-view-photo" hidden disabled>View photo</button><button class="btn" id="shot-use">Explore these settings →</button></span></footer><details class="shot-notes"><summary>How this is modeled</summary><p id="shot-note"></p><p class="shot-footnote">Illustrative time and scale · rigid glide · modeled lens and sensor · same scene and random seed in both captures</p></details>`;
  document.body.append(dialog);
  const photoDialog=document.createElement('dialog');photoDialog.id='shot-photo-dialog';photoDialog.setAttribute('aria-labelledby','shot-photo-title');
  photoDialog.innerHTML='<header><h2 id="shot-photo-title"></h2><button class="btn" type="button" autofocus>Close photo</button></header><img alt=""><p class="shot-photo-credit"></p>';
  document.body.append(photoDialog);
  const fullPhoto=photoDialog.querySelector('img')!;
  const el=<T extends HTMLElement=HTMLElement>(id:string)=>dialog.querySelector<T>(`#shot-${id}`)!;
  let model=compute(birdShot(false)),visual=createShotVisual(el<HTMLCanvasElement>('canvas'),model);
  let time=0,playing=false,last=0,raf=0,worker:Worker|null=null,timer=0,generation=0,ready=false;
  let opener:HTMLElement|null=null,slow=false,prevStage=-1,autoIntent=false;
  let example:Example|undefined;
  let readyImage:HTMLImageElement|null=null,photoGeneration=-1;
  const examples=new Map<string,Example>();
  const stages=()=>example?photoShotStages(example):SHOT_STAGES;
  const simulationFootnote=dialog.querySelector('.shot-footnote')!.textContent;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const cache=new Map<boolean,RenderView>();
  const trackId=()=>el<HTMLSelectElement>('track').value as ShotTrack;
  const track=()=>SHOT_TRACKS[trackId()];
  const photoCredit=()=>example?.credit.split(/(?<=\.)\s/)[0]??'';
  function stopWorker(){generation++;worker?.terminate();worker=null;clearTimeout(timer);}
  function addExample(ex:Example){
    if(examples.has(ex.id))return;
    examples.set(ex.id,ex);
    const option=document.createElement('option');option.value=`photo:${ex.id}`;option.textContent=`Photo · ${ex.title}`;
    el<HTMLSelectElement>('source').append(option);
  }
  async function loadChoices(){
    const list=await loadExamples();
    if(!dialog.open)return;
    list.forEach(addExample);
  }
  function draw(){
    const range=track(),m=shotMoment(time,range.end),s=stages()[m.stage];
    let buffer:string|null=null;
    if(example&&!ready){const canvas=el<HTMLCanvasElement>('canvas');canvas.getContext('2d')!.clearRect(0,0,canvas.width,canvas.height);}
    else buffer=visual.draw(time,ready,range.end);
    dialog.dataset.track=trackId();dialog.style.setProperty('--track-color',range.color);
    dialog.dataset.stage=String(m.stage);dialog.dataset.ready=String(ready);dialog.dataset.playing=String(playing);
    dialog.style.setProperty('--shot-color',s.color);
    if(el('heading').textContent!==(buffer||s.title)) el('heading').textContent=buffer||s.title;
    if(prevStage!==m.stage){el('caption').textContent=s.text;el('note').textContent=s.note;el('step').textContent=`${m.stage+1} / 6`;
      const n=(v:number)=>Math.round(v).toLocaleString();
      const stats=example?photoShotStats(example,model,m.stage):m.stage===3?[[n(model.exposure.photonsMidGray),'photons / gray pixel'],[n(model.exposure.electronsMidGray),'electrons / full exposure'],[n(model.sensor.fullWellE),'electrons / full well'],[model.exposure.snrMidGray.toFixed(1),'reference SNR']]:
        m.stage===4?[[formatShutter(model.scenario.shutter)+' s','shutter'],[(model.sensor.readoutS*1000).toFixed(1)+' ms','full-frame scan'],[String(model.sensor.bits)+' bit','raw conversion'],['RGGB','filter mosaic']]:
        [[formatShutter(model.scenario.shutter)+' s','shutter'],[(model.motion!.speedMps*model.scenario.shutter*1000).toFixed(0)+' mm','travel'],[model.motion!.blurPx.toFixed(1)+' px','native sensor blur'],[n(model.exposure.photonsMidGray),'photons / gray pixel']];
      el('measures').replaceChildren(...stats.map(([value,label])=>{const row=document.createElement('span'),number=document.createElement('b');number.textContent=value;row.append(number,` ${label}`);return row;}));
    }
    el('time').style.setProperty('--pct',`${(time-range.start)/(range.end-range.start)*100}%`);
    el<HTMLCanvasElement>('canvas').setAttribute('aria-label',`${s.title}. ${s.text} ${s.note}`);
    el<HTMLInputElement>('time').min=String(range.start);el<HTMLInputElement>('time').max=String(range.end);
    el<HTMLInputElement>('time').value=String(time);el('time').setAttribute('aria-valuetext',`${range.label}: ${s.title}, ${(time-range.start).toFixed(1)} of ${range.end-range.start} illustrative seconds`);
    el('clock').textContent=`${Math.floor(time-range.start)} / ${range.end-range.start} s`;
    el('play').textContent=playing?'Pause':time>=range.end?'Replay':'Play';el('replay').textContent='Restart';
    if(prevStage!==m.stage){for(const b of dialog.querySelectorAll<HTMLButtonElement>('[data-shot-chapter]'))b.setAttribute('aria-current',String(Number(b.dataset.shotChapter)===m.stage));prevStage=m.stage;}
  }
  function tick(now:number){
    if(!dialog.open)return;
    if(playing&&ready){time=Math.min(track().end,time+Math.max(0,Math.min(.1,(now-last)/1000))*Number(el<HTMLSelectElement>('speed').value));if(time===track().end){playing=false;el('status').textContent=trackId()==='all'?(example?`Supplied JPEG · ${photoCredit()} Choose another photo to follow its settings.`:'Your photo is ready. Try the other capture to compare motion blur.'):`${track().label} complete · follow another process or choose All processes.${example?' '+photoCredit():''}`;}}
    last=now;draw();if(playing)raf=requestAnimationFrame(tick);
  }
  function play(){if(!ready)return;if(time>=track().end)time=track().start;playing=true;el('status').textContent=example?`Real photograph · illustrated camera journey · ${photoCredit()}`:`Playing · ${track().label}`;cancelAnimationFrame(raf);last=performance.now();raf=requestAnimationFrame(tick);draw();}
  function pause(){playing=false;cancelAnimationFrame(raf);if(ready)el('status').textContent=`Paused · ${stages()[shotMoment(time,track().end).stage].title}${example?' · '+photoCredit():''}`;draw();}
  function enablePlayback(){
    el<HTMLButtonElement>('play').disabled=false;el<HTMLButtonElement>('use').disabled=false;
    el<HTMLButtonElement>('view-photo').disabled=!readyImage;
    if(autoIntent&&!reduced.matches&&!document.hidden)play();else draw();
  }
  function loaded(v:RenderView){cache.set(slow,v);visual.setPhoto(v);ready=true;dialog.dataset.renderMs=String(v.meta.ms);
    el('status').textContent='Ready · the photo and its processing buffers are computed from this shot.';
    enablePlayback();
  }
  function prepare(auto:boolean){
    if(photoDialog.open)photoDialog.close();readyImage=null;
    playing=false;cancelAnimationFrame(raf);stopWorker();ready=false;time=track().start;prevStage=-1;autoIntent=auto&&!dialog.querySelector<HTMLDetailsElement>('.shot-notes')!.open;
    model=compute(example?photoShotScenario(example):birdShot(slow));
    if(!example)visual=createShotVisual(el<HTMLCanvasElement>('canvas'),model);
    dialog.dataset.source=example?`photo:${example.id}`:'bird';delete dialog.dataset.renderMs;
    el('capture').hidden=!!example;
    el('view-photo').hidden=!example;el<HTMLButtonElement>('view-photo').disabled=true;
    dialog.querySelector('.shot-eyebrow')!.textContent=example?'Real photograph · illustrated camera journey':'A guided bird example · from light to photograph';
    dialog.querySelector('.shot-footnote')!.textContent=example?`${photoShotFootnote} Workspace may adapt recorded values to model limits. ${example.credit}`:simulationFootnote;
    el('use').textContent=example?'Explore lens model →':'Explore these settings →';
    el('use').title=example?'Workspace may adapt recorded values to model limits.':'';
    const firstChapter=dialog.querySelector<HTMLButtonElement>('[data-shot-chapter="0"]')!;
    firstChapter.querySelector('span')!.textContent=example?' Scene':' Bird';firstChapter.setAttribute('aria-label',`Chapter 1: ${example?'Scene':'Bird'}`);
    el('settings').textContent=example?`${fmtFno(example.fno)} · ${fmtShutter(example.shutter)} · ISO ${example.iso} · focus ${example.focusM===null?'unknown':fmtDistance(example.focusM*1000)}`:`500 mm · f/${Number(model.scenario.fno.toFixed(2))} · ISO ${model.scenario.iso} · 20 m`;
    el('status').textContent=example?'Loading the supplied JPEG… optical and sensor stages are illustrations.':'Preparing shot… the image is being computed, not downloaded.';
    el('retry').hidden=true;el<HTMLButtonElement>('play').disabled=true;el<HTMLButtonElement>('use').disabled=true;draw();
    const id=generation;
    function fail(){if(id!==generation||!dialog.open)return;stopWorker();el('status').textContent=example?'The photo could not load. Retry to open the supplied JPEG.':'The shot could not finish. Retry to render it again.';el('retry').hidden=false;draw();}
    if(example){
      const selected=example,image=new Image();
      timer=window.setTimeout(fail,30000);
      image.src=new URL(`examples/${selected.image}`,document.baseURI).href;
      image.decode().then(()=>{
        if(id!==generation||!dialog.open)return;
        clearTimeout(timer);
        visual=createShotVisual(el<HTMLCanvasElement>('canvas'),model,{example:selected,image});
        readyImage=image;ready=true;el('status').textContent=`Supplied JPEG · ${selected.credit} Optics and sensor stages are illustrative.`;
        enablePlayback();
      }).catch(fail);
      return;
    }
    const hit=cache.get(slow);if(hit){loaded(hit);return;}
    try {
      worker=new Worker(new URL('./render-worker.ts',import.meta.url),{type:'module'});
      worker.onmessage=({data:m})=>{if(id!==generation||!dialog.open)return;if(m.type==='error'){fail();return;}if(m.type!=='render')return;
        stopWorker();loaded({...m,renderId:m.id,scenario:structuredClone(model.scenario)});};
      worker.onerror=e=>{e.preventDefault();fail();};worker.onmessageerror=fail;
      timer=window.setTimeout(fail,120000);
      worker.postMessage({type:'render',id,scenario:model.scenario,width:600,height:400,seed:1});
    }catch{fail();}
  }
  dialog.querySelector<HTMLDetailsElement>('.shot-notes')!.addEventListener('toggle',event=>{if((event.target as HTMLDetailsElement).open){autoIntent=false;pause();}});
  el('close').onclick=()=>dialog.close();
  el('play').onclick=()=>playing?pause():play();
  el('replay').onclick=()=>{autoIntent=false;time=track().start;play();draw();};
  el('retry').onclick=()=>prepare(true);
  el<HTMLInputElement>('time').oninput=()=>{autoIntent=false;time=Number(el<HTMLInputElement>('time').value);pause();};
  el('preset').onchange=()=>{slow=el<HTMLSelectElement>('preset').value==='slow';prepare(false);};
  el('source').onchange=()=>{const value=el<HTMLSelectElement>('source').value;example=value==='bird'?undefined:examples.get(value.slice(6));prepare(false);};
  el('track').onchange=()=>{autoIntent=false;time=track().start;prevStage=-1;pause();};
  for(const b of dialog.querySelectorAll<HTMLButtonElement>('[data-shot-chapter]'))b.onclick=()=>{autoIntent=false;time=SHOT_STAGES[Number(b.dataset.shotChapter)].start;if(time<track().start||time>=track().end)el<HTMLSelectElement>('track').value='all';pause();};
  el('use').onclick=()=>{if(!ready)return;store.set(example?{lens:example.lens,fno:example.fno,shutter:example.shutter,iso:example.iso,...(example.focusM===null?{}:{focusM:example.focusM})}:structuredClone(model.scenario));dialog.close();};
  el('view-photo').onclick=()=>{
    if(!example||!readyImage||!ready)return;
    autoIntent=false;pause();photoGeneration=generation;
    photoDialog.querySelector('h2')!.textContent=example.title;
    photoDialog.querySelector('.shot-photo-credit')!.textContent=example.credit;
    fullPhoto.alt=example.title;fullPhoto.src=readyImage.currentSrc||readyImage.src;
    photoDialog.dataset.source=example.id;
    if(!photoDialog.open)photoDialog.showModal();
  };
  photoDialog.querySelector('button')!.onclick=()=>photoDialog.close();
  photoDialog.addEventListener('keydown',e=>e.stopPropagation());
  photoDialog.addEventListener('close',()=>{
    if(photoDialog.open)return;
    fullPhoto.removeAttribute('src');
    if(dialog.open&&photoGeneration===generation&&readyImage)el('view-photo').focus({preventScroll:true});
  });
  dialog.addEventListener('keydown',e=>e.stopPropagation());
  dialog.addEventListener('close',()=>{if(dialog.open)return;if(photoDialog.open)photoDialog.close();pause();stopWorker();const target=opener?.getClientRects().length&&!opener.closest('details:not([open])')?opener:document.querySelector<HTMLElement>('.view-menu summary');target?.focus({preventScroll:true});});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&dialog.open){autoIntent=false;pause();}});
  reduced.addEventListener('change',()=>{if(reduced.matches&&dialog.open)pause();});
  new ResizeObserver(()=>{if(dialog.open)draw();}).observe(el('canvas'));
  return (source:HTMLElement,photo?:Example)=>{opener=source;example=photo;if(photo){addExample(photo);el<HTMLSelectElement>('track').value='all';}el<HTMLSelectElement>('source').value=photo?`photo:${photo.id}`:'bird';emit('pause-exposure',{});emit('pause-tour',{});if(!dialog.open)dialog.showModal();prepare(true);void loadChoices();};
}
