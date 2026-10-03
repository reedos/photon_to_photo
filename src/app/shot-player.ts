import type { Store } from './store';
import { compute } from './engine-api';
import { emit } from './bus';
import { shotMoment, SHOT_STAGES, SHOT_TRACKS, type ShotTrack } from './shot-model';
import { createShotVisual } from './shot-visual';
import { loadExamples, type Example } from './examples';
import { photoShotScenario, photoShotStages, photoShotStats, photoShotFootnote } from './photo-shot';
import { fmtDistance, fmtFno, fmtShutter } from './units';
import { type CaptureMechanism } from './shot-capture';
import '../styles/shot.css';

export function createShotPlayer(store:Store) {
  const dialog=document.createElement('dialog');dialog.id='shot-dialog';dialog.setAttribute('aria-labelledby','shot-title');
  dialog.innerHTML=`<header><div><span class="shot-eyebrow">Your photographs · from light to image</span><h2 id="shot-title">Play the shot</h2></div><button class="btn" id="shot-close" autofocus>Close</button></header>
    <div class="shot-options"><label>Source<select id="shot-source"></select></label><label id="shot-capture" hidden>Shutter demo<select id="shot-mechanism"><option value="mechanical">Mechanical curtains</option><option value="electronic">Electronic scan</option></select></label><label class="shot-follow">Follow<select id="shot-track">${Object.entries(SHOT_TRACKS).map(([id,t])=>`<option value="${id}">${t.label}</option>`).join('')}</select></label><span id="shot-settings"></span></div>
    <div class="shot-main"><canvas id="shot-canvas" role="img" aria-label="A photograph’s journey through a camera"></canvas>
    <aside class="shot-explanation"><div class="shot-story" aria-live="polite" aria-atomic="true"><div><span id="shot-step"></span><h3 id="shot-heading"></h3></div><p id="shot-caption"></p></div>
    <div id="shot-measures"></div></aside></div>
    <nav class="shot-chapters" aria-label="Shot chapters">${['Scene','Optics','Exposure','Charge','Readout','Photo'].map((s,i)=>`<button class="btn" data-shot-chapter="${i}" aria-label="Chapter ${i+1}: ${s}">${i+1}<span> ${s}</span></button>`).join('')}</nav>
    <div class="shot-transport"><button class="btn" id="shot-play">Play</button><button class="btn" id="shot-replay">Replay</button><label class="shot-scrub"><span class="sr-only">Shot timeline</span><input id="shot-time" type="range" min="0" max="28" step="0.05" value="0" aria-label="Shot timeline"></label><span id="shot-clock" aria-live="off">0 / 28 s</span><label><span class="sr-only">Playback speed</span><select id="shot-speed" aria-label="Playback speed"><option value="0.5">½×</option><option value="1" selected>1×</option><option value="2">2×</option></select></label></div>
    <footer><span id="shot-status" role="status">Preparing shot…</span><button class="btn" id="shot-retry" hidden>Retry</button><span class="shot-footer-actions"><button class="btn" id="shot-view-photo" hidden disabled>View photo</button><button class="btn" id="shot-use">Explore these settings →</button></span></footer><details class="shot-notes"><summary>How this is modeled</summary><p id="shot-note"></p><p class="shot-footnote">Recorded photo settings · representative optics · illustrated sensor mechanisms</p></details>`;
  document.body.append(dialog);
  const photoDialog=document.createElement('dialog');photoDialog.id='shot-photo-dialog';photoDialog.setAttribute('aria-labelledby','shot-photo-title');
  photoDialog.innerHTML='<header><h2 id="shot-photo-title"></h2><button class="btn" type="button" autofocus>Close photo</button></header><img alt=""><p class="shot-photo-credit"></p>';
  document.body.append(photoDialog);
  const fullPhoto=photoDialog.querySelector('img')!;
  const el=<T extends HTMLElement=HTMLElement>(id:string)=>dialog.querySelector<T>(`#shot-${id}`)!;
  let model:ReturnType<typeof compute>|undefined,visual:ReturnType<typeof createShotVisual>|undefined;
  let time=0,playing=false,last=0,raf=0,timer=0,generation=0,ready=false;
  let opener:HTMLElement|null=null,prevStage=-1,autoIntent=false;
  let example:Example|undefined;
  let readyImage:HTMLImageElement|null=null,photoGeneration=-1;
  const examples=new Map<string,Example>();
  const stages=()=>example?photoShotStages(example,el<HTMLSelectElement>('mechanism').value as CaptureMechanism):SHOT_STAGES;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const trackId=()=>el<HTMLSelectElement>('track').value as ShotTrack;
  const track=()=>SHOT_TRACKS[trackId()];
  const photoCredit=()=>example?.credit.split(/(?<=\.)\s/)[0]??'';
  function cancelLoad(){generation++;clearTimeout(timer);}
  function addExample(ex:Example){
    if(examples.has(ex.id))return;
    examples.set(ex.id,ex);
    const option=document.createElement('option');option.value=`photo:${ex.id}`;option.textContent=`Photo · ${ex.title}`;
    el<HTMLSelectElement>('source').append(option);
  }
  async function loadChoices(){
    const list=await loadExamples();
    list.forEach(addExample);
    return list;
  }
  function draw(){
    if(!example||!model)return;
    const range=track(),m=shotMoment(time,range.end),s=stages()[m.stage];
    let buffer:string|null=null;
    if(example&&!ready){const canvas=el<HTMLCanvasElement>('canvas');canvas.getContext('2d')!.clearRect(0,0,canvas.width,canvas.height);}
    else if(visual)buffer=visual.draw(time,range.end);
    el('capture').hidden=m.stage!==2;
    dialog.dataset.mechanism=el<HTMLSelectElement>('mechanism').value;
    dialog.dataset.track=trackId();dialog.style.setProperty('--track-color',range.color);
    dialog.dataset.stage=String(m.stage);dialog.dataset.ready=String(ready);dialog.dataset.playing=String(playing);
    dialog.style.setProperty('--shot-color',s.color);
    if(el('heading').textContent!==(buffer||s.title)) el('heading').textContent=buffer||s.title;
    if(prevStage!==m.stage){el('caption').textContent=s.text;el('note').textContent=s.note;el('step').textContent=`${m.stage+1} / 6`;
      const stats=photoShotStats(example,model,m.stage);
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
    if(playing&&ready){time=Math.min(track().end,time+Math.max(0,Math.min(.1,(now-last)/1000))*Number(el<HTMLSelectElement>('speed').value));if(time===track().end){playing=false;el('status').textContent=trackId()==='all'?`Supplied JPEG · ${photoCredit()} Choose another photo to follow its settings.`:`${track().label} complete · follow another process or choose All processes.${example?' '+photoCredit():''}`;}}
    last=now;draw();if(playing)raf=requestAnimationFrame(tick);
  }
  function play(){if(!ready)return;if(time>=track().end)time=track().start;playing=true;el('status').textContent=`Real photograph · illustrated camera journey · ${photoCredit()}`;cancelAnimationFrame(raf);last=performance.now();raf=requestAnimationFrame(tick);draw();}
  function pause(){playing=false;cancelAnimationFrame(raf);if(ready)el('status').textContent=`Paused · ${stages()[shotMoment(time,track().end).stage].title}${example?' · '+photoCredit():''}`;draw();}
  function enablePlayback(){
    el<HTMLButtonElement>('play').disabled=false;el<HTMLButtonElement>('use').disabled=false;
    el<HTMLButtonElement>('view-photo').disabled=!readyImage;
    if(autoIntent&&!reduced.matches&&!document.hidden)play();else draw();
  }
  function prepare(auto:boolean){
    if(!example){void chooseDefault(auto);return;}
    if(photoDialog.open)photoDialog.close();readyImage=null;
    playing=false;cancelAnimationFrame(raf);cancelLoad();ready=false;time=track().start;prevStage=-1;autoIntent=auto&&!dialog.querySelector<HTMLDetailsElement>('.shot-notes')!.open;
    model=compute(photoShotScenario(example));
    dialog.dataset.source=`photo:${example.id}`;delete dialog.dataset.renderMs;
    el('capture').hidden=true;
    el('view-photo').hidden=!example;el<HTMLButtonElement>('view-photo').disabled=true;
    dialog.querySelector('.shot-eyebrow')!.textContent='Real photograph · illustrated camera journey';
    dialog.querySelector('.shot-footnote')!.textContent=`${photoShotFootnote} Workspace may adapt recorded values to model limits. ${example.credit}`;
    el('use').textContent='Use these settings →';
    el('use').title=example?'Workspace may adapt recorded values to model limits.':'';
    const firstChapter=dialog.querySelector<HTMLButtonElement>('[data-shot-chapter="0"]')!;
    firstChapter.querySelector('span')!.textContent=' Scene';firstChapter.setAttribute('aria-label',`Chapter 1: Scene`);
    el('settings').textContent=`${fmtFno(example.fno)} · ${fmtShutter(example.shutter)} · ISO ${example.iso} · focus ${example.focusM===null?'unknown':`≈ ${example.focusM} m`}`;
    el('status').textContent='Loading your photograph…';
    el('retry').hidden=true;el<HTMLButtonElement>('play').disabled=true;el<HTMLButtonElement>('use').disabled=true;draw();
    const id=generation;
    function fail(){if(id!==generation||!dialog.open)return;cancelLoad();el('status').textContent='The photo could not load. Retry to open the supplied JPEG.';el('retry').hidden=false;draw();}
    if(example){
      const selected=example,image=new Image();
      timer=window.setTimeout(fail,30000);
      image.src=new URL(`examples/${selected.image}`,document.baseURI).href;
      image.decode().then(()=>{
        if(id!==generation||!dialog.open)return;
        clearTimeout(timer);
        visual=createShotVisual(el<HTMLCanvasElement>('canvas'),model!,{example:selected,image});
        visual.setMechanism(el<HTMLSelectElement>('mechanism').value as CaptureMechanism);
        readyImage=image;ready=true;el('status').textContent=`Supplied JPEG · ${selected.credit} Optics and sensor stages are illustrative.`;
        enablePlayback();
      }).catch(fail);
      return;
    }
  }
  async function chooseDefault(auto:boolean){
    cancelLoad();const id=generation;ready=false;visual=undefined;model=undefined;readyImage=null;example=undefined;
    playing=false;cancelAnimationFrame(raf);time=0;prevStage=-1;
    dialog.dataset.ready='false';dialog.dataset.playing='false';dialog.dataset.source='';
    el('capture').hidden=true;el<HTMLButtonElement>('view-photo').disabled=true;el<HTMLInputElement>('time').value='0';
    el<HTMLButtonElement>('play').disabled=true;el<HTMLButtonElement>('use').disabled=true;
    el('retry').hidden=true;el('status').textContent='Loading your photographs…';
    const canvas=el<HTMLCanvasElement>('canvas');canvas.getContext('2d')!.clearRect(0,0,canvas.width,canvas.height);
    const list=await loadChoices();
    if(id!==generation||!dialog.open)return;
    example=list?.find(ex=>ex.id==='flycatcher')??list?.[0];
    if(!example){el('status').textContent='The photo catalog could not load. Try again.';el('retry').hidden=false;return;}
    el<HTMLSelectElement>('source').value=`photo:${example.id}`;prepare(auto);
  }
  dialog.querySelector<HTMLDetailsElement>('.shot-notes')!.addEventListener('toggle',event=>{if((event.target as HTMLDetailsElement).open){autoIntent=false;pause();}});
  el('close').onclick=()=>dialog.close();
  el('play').onclick=()=>playing?pause():play();
  el('replay').onclick=()=>{autoIntent=false;time=track().start;play();draw();};
  el('retry').onclick=()=>prepare(true);
  el<HTMLInputElement>('time').oninput=()=>{autoIntent=false;time=Number(el<HTMLInputElement>('time').value);pause();};
  el('mechanism').onchange=()=>{autoIntent=false;prevStage=-1;visual?.setMechanism(el<HTMLSelectElement>('mechanism').value as CaptureMechanism);pause();};
  el('source').onchange=()=>{const value=el<HTMLSelectElement>('source').value;example=examples.get(value.slice(6));prepare(false);};
  el('track').onchange=()=>{autoIntent=false;time=track().start;prevStage=-1;pause();};
  for(const b of dialog.querySelectorAll<HTMLButtonElement>('[data-shot-chapter]'))b.onclick=()=>{autoIntent=false;time=SHOT_STAGES[Number(b.dataset.shotChapter)].start;if(time<track().start||time>=track().end)el<HTMLSelectElement>('track').value='all';pause();};
  el('use').onclick=()=>{if(!ready||!example)return;store.set({lens:example.lens,fno:example.fno,shutter:example.shutter,iso:example.iso,...(example.focusM===null?{}:{focusM:example.focusM})});dialog.close();};
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
  dialog.addEventListener('close',()=>{if(dialog.open)return;if(photoDialog.open)photoDialog.close();pause();cancelLoad();const target=opener?.getClientRects().length&&!opener.closest('details:not([open])')?opener:document.querySelector<HTMLElement>('.view-menu summary');target?.focus({preventScroll:true});});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&dialog.open){autoIntent=false;pause();}});
  reduced.addEventListener('change',()=>{if(reduced.matches&&dialog.open)pause();});
  new ResizeObserver(()=>{if(dialog.open)draw();}).observe(el('canvas'));
  return (source:HTMLElement,photo?:Example)=>{opener=source;example=photo;if(photo)addExample(photo);el<HTMLSelectElement>('track').value='all';el<HTMLSelectElement>('source').value=photo?`photo:${photo.id}`:'';emit('pause-exposure',{});emit('pause-tour',{});if(!dialog.open)dialog.showModal();if(photo){prepare(true);void loadChoices();}else void chooseDefault(true);};
}
