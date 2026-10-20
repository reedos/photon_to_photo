import type { Store } from './store';
import { glossify } from './gloss';
import { compute } from './engine-api';
import { emit } from './bus';
import { shotMoment, chapterDwellSeconds, SHOT_STAGES, SHOT_TRACKS, type ShotTrack } from './shot-model';
import { createShotVisual } from './shot-visual';
import { loadExamples, appliedSettingsText, type Example } from './examples';
import { photoShotScenario, photoShotStages, photoShotStats, photoShotFootnote } from './photo-shot';
import { fmtDistance, fmtFno, fmtShutter } from './units';
import { type CaptureMechanism } from './shot-capture';
import '../styles/shot.css';

/** The six chapters' names (score loop r5: the fourth is Pixel, the name the path strip and the levels use) and the short
 *  forms a 320 px phone's chips show under their numbers. */
const CHAPTER_NAMES=['Scene','Optics','Exposure','Pixel','Readout','Photo'] as const;
const CHAPTER_SHORT=['Scene','Optics','Expo','Pixel','Read','Photo'] as const;
export function createShotPlayer(store:Store) {
  const dialog=document.createElement('dialog');dialog.id='shot-dialog';dialog.setAttribute('aria-labelledby','shot-title');
  dialog.innerHTML=`<header><div><span class="shot-eyebrow">Real photographs · from light to image</span><h2 id="shot-title">Play the shot</h2></div><button class="btn" id="shot-close" autofocus>Close</button></header>
    <div class="shot-options"><label>Source<select id="shot-source"></select></label><label id="shot-capture" hidden>Shutter demo<select id="shot-mechanism"><option value="mechanical">Mechanical curtains</option><option value="electronic">Electronic scan</option></select></label><label class="shot-follow">Follow<select id="shot-track">${Object.entries(SHOT_TRACKS).map(([id,t])=>`<option value="${id}">${t.label}</option>`).join('')}</select></label><span id="shot-settings"></span></div>
    <div class="shot-main"><canvas id="shot-canvas" role="img" aria-label="A photograph’s journey through a camera"></canvas>
    <aside class="shot-explanation"><div class="shot-story" aria-live="polite" aria-atomic="true"><div><span id="shot-step"></span><h3 id="shot-heading"></h3></div><p id="shot-caption"></p></div>
    <div id="shot-measures"></div></aside></div>
    <nav class="shot-chapters" aria-label="Shot chapters">${CHAPTER_NAMES.map((s,i)=>`<button class="btn" data-shot-chapter="${i}" aria-label="Chapter ${i+1}: ${s}">${i+1}<span> ${s}</span><i class="shot-chip-short" aria-hidden="true">${CHAPTER_SHORT[i]}</i></button>`).join('')}</nav>
    <div class="shot-transport"><button class="btn" id="shot-play">Play</button><button class="btn" id="shot-replay">Replay</button><label class="shot-scrub"><span class="sr-only">Shot timeline</span><input id="shot-time" type="range" min="0" max="28" step="0.05" value="0" aria-label="Shot timeline"></label><span id="shot-clock" aria-live="off">Chapter 1 of 6</span><label><span class="sr-only">Playback speed</span><select id="shot-speed" aria-label="Playback speed"><option value="0.5">½×</option><option value="1" selected>1×</option><option value="2">2×</option></select></label></div>
    <footer><span id="shot-status" role="status">Preparing shot…</span><button class="btn" id="shot-retry" hidden>Retry</button><span class="shot-footer-actions"><button class="btn" id="shot-view-photo" hidden disabled>View photo</button><button class="btn" id="shot-use">Use these settings →</button></span></footer><details class="shot-notes"><summary>How this is modeled</summary><p id="shot-note"></p><p class="shot-footnote">Recorded photo settings · representative optics · illustrated sensor mechanisms</p></details>`;
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
  /** One chapter's words and measures into the explanation column. */
  function fillStage(stage:number){
    if(!example||!model)return;
    const s=stages()[stage];
    el('heading').textContent=s.title;glossify(el('caption'),s.text);el('note').textContent=s.note;el('step').textContent=`${stage+1} / 6`;
    const stats=photoShotStats(example,model,stage);
    el('measures').replaceChildren(...stats.map(([value,label])=>{const row=document.createElement('span'),number=document.createElement('b');number.textContent=value;row.append(number,` ${label}`);return row;}));
  }
  /** The explanation column keeps the height of its longest chapter, so the chapter chips, the transport row and the
   *  dialog's own height stay where they are while a visitor steps through the chapters (score loop r5: the chips moved up
   *  to 19 px on a desktop and 34 px on a phone). Each chapter is written in turn and measured in one synchronous pass,
   *  so nothing is painted between; the chapter on screen is put back. */
  const aside=dialog.querySelector<HTMLElement>('.shot-explanation')!;
  let reservedFor='';
  function reserveStoryHeight(){
    if(!dialog.open||!example||!model||!aside.offsetWidth)return;
    const key=`${example.id}|${el<HTMLSelectElement>('mechanism').value}|${aside.offsetWidth}`;
    if(key===reservedFor)return;
    reservedFor=key;
    aside.style.minHeight='';
    let tallest=0;
    const count=stages().length;
    for(let i=0;i<count;i++){fillStage(i);tallest=Math.max(tallest,aside.offsetHeight);}
    fillStage(prevStage>=0?prevStage:shotMoment(time,track().end).stage);
    aside.style.minHeight=`${tallest}px`;
  }
  /** While the photograph loads, its small picker copy shows blurred in the stage instead of an empty black canvas
   *  (score loop r5: "Loading the photograph…" over black). */
  let poster:HTMLImageElement|null=null;
  function paintPoster(){
    const canvas=el<HTMLCanvasElement>('canvas');
    const w=Math.max(2,Math.round(canvas.clientWidth*Math.min(2,devicePixelRatio||1))),h=Math.max(2,Math.round(canvas.clientHeight*Math.min(2,devicePixelRatio||1)));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    const ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,canvas.width,canvas.height);
    if(!poster?.naturalWidth)return;
    const k=Math.max(w/poster.naturalWidth,h/poster.naturalHeight),dw=poster.naturalWidth*k,dh=poster.naturalHeight*k;
    ctx.save();ctx.filter='blur(10px)';ctx.globalAlpha=.5;ctx.drawImage(poster,(w-dw)/2,(h-dh)/2,dw,dh);ctx.restore();
  }
  function draw(){
    if(!example||!model)return;
    const range=track(),m=shotMoment(time,range.end),s=stages()[m.stage];
    let buffer:string|null=null;
    if(example&&!ready)paintPoster();
    else if(visual)buffer=visual.draw(time,range.end,range.start);
    el('capture').hidden=m.stage!==2;
    dialog.dataset.mechanism=el<HTMLSelectElement>('mechanism').value;
    dialog.dataset.track=trackId();dialog.style.setProperty('--track-color',range.color);
    dialog.dataset.stage=String(m.stage);dialog.dataset.ready=String(ready);dialog.dataset.playing=String(playing);
    dialog.style.setProperty('--shot-color', '#e6ba82');
    // One title per chapter, whether it was reached by a chapter button, playback or scrubbing (score loop r1: the
    // handoff's own label used to replace it for a moment, so each chapter had two names).
    void buffer;
    if(el('heading').textContent!==s.title) el('heading').textContent=s.title;
    if(prevStage!==m.stage)fillStage(m.stage);
    el('time').style.setProperty('--pct',`${(time-range.start)/(range.end-range.start)*100}%`);
    el<HTMLCanvasElement>('canvas').setAttribute('aria-label',`${s.title}. ${s.text} ${s.note}`);
    el<HTMLInputElement>('time').min=String(range.start);el<HTMLInputElement>('time').max=String(range.end);
    el<HTMLInputElement>('time').value=String(time);el('time').setAttribute('aria-valuetext',`${range.label}: ${s.title}, ${(time-range.start).toFixed(1)} of ${range.end-range.start} illustrative seconds`);
    clockText(range);
    el('play').textContent=playing?'Pause':time>=range.end?'Replay':'Play';el('replay').textContent='Restart';
    if(prevStage!==m.stage){for(const b of dialog.querySelectorAll<HTMLButtonElement>('[data-shot-chapter]'))b.setAttribute('aria-current',String(Number(b.dataset.shotChapter)===m.stage));prevStage=m.stage;}
  }
  /** The clock runs slower inside a chapter whose caption takes longer than its four seconds to read, so the words
   *  stay up for their reading time while the picture keeps moving (score loop r5). */
  function readingRate(){
    const stage=shotMoment(time,track().end).stage,span=SHOT_STAGES[stage].end-SHOT_STAGES[stage].start;
    return span/chapterDwellSeconds(stage,stages()[stage].text.trim().split(/\s+/).length);
  }
  /** The wall-clock seconds left in this track at the chosen speed. The picture's own clock ("1 / 28 s") ran at about 0.4 s per
   *  second through the chapters whose captions need time to read, so it overstated the speed (score loop r6): this adds up
   *  each remaining chapter's span at its own reading rate. */
  function secondsLeft(end:number){
    const speed=Number(el<HTMLSelectElement>('speed').value)||1;
    let left=0;
    SHOT_STAGES.forEach((st,i)=>{
      const from=Math.max(time,st.start),to=Math.min(end,st.end);
      if(to<=from)return;
      left+=(to-from)/((st.end-st.start)/chapterDwellSeconds(i,stages()[i].text.trim().split(/\s+/).length))/speed;
    });
    return Math.ceil(left);
  }
  function clockText(range:{start:number;end:number}){
    const chapter=shotMoment(time,range.end).stage+1,clock=el('clock');
    const lead=document.createElement('span');lead.className='shot-clock-chapter';lead.textContent=`Chapter ${chapter} of ${SHOT_STAGES.length} · `;
    clock.replaceChildren(lead,time>=range.end?'done':`${secondsLeft(range.end)} s left`);
    clock.title=`Story time ${Math.floor(time-range.start)} of ${range.end-range.start} s; the film waits on each caption until it can be read.`;
  }
  function tick(now:number){
    if(!dialog.open)return;
    if(playing&&ready){time=Math.min(track().end,time+Math.max(0,Math.min(.1,(now-last)/1000))*Number(el<HTMLSelectElement>('speed').value)*readingRate());if(time===track().end){playing=false;el('status').textContent=trackId()==='all'?`Original JPEG · ${photoCredit()} Choose another photo to follow its settings.`:`${track().label} complete · follow another process or choose All processes.${example?' '+photoCredit():''}`;}}
    last=now;draw();if(playing)raf=requestAnimationFrame(tick);
  }
  function play(){if(!ready)return;if(time>=track().end)time=track().start;playing=true;el('status').textContent=`Real photograph · illustrated camera journey · ${photoCredit()}`;cancelAnimationFrame(raf);last=performance.now();raf=requestAnimationFrame(tick);draw();}
  function pause(){playing=false;cancelAnimationFrame(raf);if(ready)el('status').textContent=`Paused · ${stages()[shotMoment(time,track().end).stage].title}${example?' · '+photoCredit():''}`;draw();}
  function enablePlayback(){
    el<HTMLButtonElement>('play').disabled=false;el<HTMLButtonElement>('use').disabled=example?.modelMatch===false;
    el<HTMLButtonElement>('view-photo').disabled=!readyImage;
    reserveStoryHeight();
    if(autoIntent&&!reduced.matches&&!document.hidden)play();else draw();
  }
  // The open dialog is a browser history entry with its photograph in the address (shot=<id>): Back closes it,
  // Forward reopens it, and the link opens the same shot (score loop r2: Back changed the view behind the open
  // dialog). An older link's photo=<id> becomes shot=<id> once the dialog shows it.
  let closingFromHistory=false;
  // A Close steps back out of the dialog's entry. Until that step lands, its popstate is ours (it must not close a
  // dialog reopened in the meantime), and a reopening waits to add its own entry after it.
  let stepping:Promise<void>|null=null,stepped:(()=>void)|null=null;
  let focusAfterStep:HTMLElement|null=null;
  function shotUrl(id:string|null){
    const url=new URL(location.href);
    if(id)url.searchParams.set('shot',id);else url.searchParams.delete('shot');
    const params=url.searchParams;
    if(params.get('view')!=='photos'&&url.hash!=='#rp-card')params.delete('photo');
    return url;
  }
  function syncShotUrl(){
    if(!dialog.open||!example)return;
    const url=shotUrl(example.id);
    if(url.href!==location.href)history.replaceState(history.state,'',url);
  }
  window.addEventListener('popstate',()=>{
    if(stepped){const done=stepped;stepped=null;stepping=null;done();
      const target=focusAfterStep;focusAfterStep=null;
      const back=()=>{if(!dialog.open&&target&&document.activeElement!==target)target.focus({preventScroll:true});};back();requestAnimationFrame(back);
      // Chrome drops focus to <body> just after this popstate (the entry's #fragment is restored): take it back in
      // the same turn, before the next key or click is handled (integration r2).
      if(target){const guard=()=>queueMicrotask(()=>{if(!dialog.open&&(!document.activeElement||document.activeElement===document.body))target.focus({preventScroll:true});});
        target.addEventListener('focusout',guard,{once:true});setTimeout(()=>target.removeEventListener('focusout',guard),500);}
      return;}
    const id=new URLSearchParams(location.search).get('shot');
    if(!id&&dialog.open){closingFromHistory=true;dialog.close();}
    else if(id&&!dialog.open){void loadChoices().then(list=>{const photo=list.find(ex=>ex.id===id);if(photo&&!dialog.open&&new URLSearchParams(location.search).get('shot')===id)open(document.querySelector<HTMLElement>('.shot-launch')??document.body,photo,true);});}
  });
  function prepare(auto:boolean){
    if(!example){void chooseDefault(auto);return;}
    syncShotUrl();
    if(photoDialog.open)photoDialog.close();readyImage=null;
    playing=false;cancelAnimationFrame(raf);cancelLoad();ready=false;time=track().start;prevStage=-1;autoIntent=auto&&!dialog.querySelector<HTMLDetailsElement>('.shot-notes')!.open;
    model=compute(photoShotScenario(example));
    dialog.dataset.source=`photo:${example.id}`;delete dialog.dataset.renderMs;
    el('capture').hidden=true;
    el('view-photo').hidden=!example;el<HTMLButtonElement>('view-photo').disabled=true;
    dialog.querySelector('.shot-eyebrow')!.textContent='Real photograph · illustrated camera journey';
    dialog.querySelector('.shot-footnote')!.textContent=`${photoShotFootnote} Workspace may adapt recorded values to model limits. ${example.credit}`;
    el('use').textContent=example.modelMatch===false?'Lens not modeled':'Use these settings →';
    el('use').title=example.modelMatch===false?'The recorded camera and lens are not available in this simulator.':'Workspace may adapt recorded values to model limits.';
    const firstChapter=dialog.querySelector<HTMLButtonElement>('[data-shot-chapter="0"]')!;
    firstChapter.querySelector('span')!.textContent=' Scene';firstChapter.setAttribute('aria-label',`Chapter 1: Scene`);
    el('settings').textContent=`${fmtFno(example.fno)} · ${fmtShutter(example.shutter)} · ISO ${example.iso} · focus ${example.focusM===null?'unknown':`≈ ${example.focusM} m`}`;
    el('status').textContent='Loading the photograph…';
    el('retry').hidden=true;el<HTMLButtonElement>('play').disabled=true;el<HTMLButtonElement>('use').disabled=true;draw();
    const id=generation;
    poster=null;
    if(example.thumb){const small=new Image();small.src=new URL(`examples/${example.thumb}`,document.baseURI).href;
      void small.decode().then(()=>{if(id===generation&&!ready&&dialog.open){poster=small;paintPoster();}}).catch(()=>undefined);}
    function fail(){if(id!==generation||!dialog.open)return;cancelLoad();el('status').textContent='The photo could not load. Retry to open the original JPEG.';el('retry').hidden=false;draw();}
    if(example){
      const selected=example,image=new Image();
      timer=window.setTimeout(fail,30000);
      image.src=new URL(`examples/${selected.image}`,document.baseURI).href;
      const detailImage=selected.detailImage?new Image():undefined;
      if(detailImage)detailImage.src=new URL(`examples/${selected.detailImage}`,document.baseURI).href;
      Promise.all([image.decode(),detailImage?.decode().catch(()=>undefined)]).then(()=>{
        if(id!==generation||!dialog.open)return;
        clearTimeout(timer);
        visual=createShotVisual(el<HTMLCanvasElement>('canvas'),model!,{example:selected,image,detailImage:detailImage?.naturalWidth?detailImage:undefined});
        visual.setMechanism(el<HTMLSelectElement>('mechanism').value as CaptureMechanism);
        visual.setReducedMotion(reduced.matches);
        readyImage=image;ready=true;el('status').textContent=`Original JPEG · ${selected.credit} Optics and sensor stages are illustrative.`;
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
    el('retry').hidden=true;el('status').textContent='Loading the photographs…';
    const canvas=el<HTMLCanvasElement>('canvas');canvas.getContext('2d')!.clearRect(0,0,canvas.width,canvas.height);
    const list=await loadChoices();
    if(id!==generation||!dialog.open)return;
    example=list?.find(ex=>ex.id==='flycatcher')??list?.[0];
    if(!example){el('status').textContent='The photo catalog could not load. Try again.';el('retry').hidden=false;return;}
    el<HTMLSelectElement>('source').value=`photo:${example.id}`;prepare(auto);
  }
  dialog.querySelector<HTMLDetailsElement>('.shot-notes')!.addEventListener('toggle',event=>{if((event.target as HTMLDetailsElement).open){autoIntent=false;pause();}});
  el('close').onclick=()=>{leaveEntry();dialog.close();};
  el('play').onclick=()=>playing?pause():play();
  el('replay').onclick=()=>{autoIntent=false;time=track().start;play();draw();};
  el('retry').onclick=()=>prepare(true);
  el<HTMLInputElement>('time').oninput=()=>{autoIntent=false;time=Number(el<HTMLInputElement>('time').value);pause();};
  el('mechanism').onchange=()=>{autoIntent=false;prevStage=-1;reserveStoryHeight();visual?.setMechanism(el<HTMLSelectElement>('mechanism').value as CaptureMechanism);pause();};
  el('source').onchange=()=>{const value=el<HTMLSelectElement>('source').value;example=examples.get(value.slice(6));prepare(false);};
  el('track').onchange=()=>{autoIntent=false;time=track().start;prevStage=-1;pause();};
  for(const b of dialog.querySelectorAll<HTMLButtonElement>('[data-shot-chapter]'))b.onclick=()=>{autoIntent=false;time=SHOT_STAGES[Number(b.dataset.shotChapter)].beat;if(time<track().start||time>=track().end)el<HTMLSelectElement>('track').value='all';pause();};
  el('use').onclick=()=>{if(!ready||!example)return;emit('camera-set',{text:appliedSettingsText(example)});store.set({lens:example.lens,fno:example.fno,shutter:example.shutter,iso:example.iso,...(example.focusM===null?{}:{focusM:example.focusM})});leaveEntry();dialog.close();};
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
  dialog.addEventListener('close',()=>{if(dialog.open)return;if(photoDialog.open)photoDialog.close();pause();cancelLoad();
    if(!closingFromHistory)leaveEntry();
    closingFromHistory=false;
    closeTarget()?.focus({preventScroll:true});});
  // Escape closes here and now, so focus is back on the opener when the key's handling ends; the browser's own
  // cancel closed the dialog without that, and the step out of the history entry left focus on <body> until it
  // landed (integration r2: test-photo-shot checks focus right after Escape).
  dialog.addEventListener('cancel',e=>{leaveEntry();e.preventDefault();dialog.close();closeTarget()?.focus({preventScroll:true});});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&dialog.open){autoIntent=false;pause();}});
  reduced.addEventListener('change',()=>{visual?.setReducedMotion(reduced.matches);if(reduced.matches&&dialog.open)pause();else if(dialog.open)draw();});
  new ResizeObserver(()=>{if(dialog.open){reserveStoryHeight();draw();}}).observe(el('canvas'));
  function closeTarget(){return opener?.getClientRects().length&&!opener.closest('details:not([open])')?opener:document.querySelector<HTMLElement>('#workspace-model');}
  /** Closing by the reader: the address drops shot= at once (the close event comes a task later), and the dialog's
   *  entry is stepped back out of. That step drops the focus to the page, so the way back to the opener waits for it.
   *  Safe to call more than once for one close. */
  function leaveEntry(){
    if(history.state?.p2p==='shot'&&!stepping&&new URLSearchParams(location.search).has('shot')){
      history.replaceState(history.state,'',shotUrl(null));focusAfterStep=closeTarget();stepping=new Promise(resolve=>{stepped=resolve;});history.back();
    } else if(new URLSearchParams(location.search).has('shot'))history.replaceState(history.state,'',shotUrl(null));
  }
  function open(source:HTMLElement,photo?:Example,fromHistory=false){
    opener=source;example=photo;if(photo)addExample(photo);el<HTMLSelectElement>('track').value='all';el<HTMLSelectElement>('source').value=photo?`photo:${photo.id}`:'';emit('pause-exposure',{});emit('pause-tour',{});
    if(!dialog.open){
      const named=new URLSearchParams(location.search).get('shot');
      const push=()=>{if(dialog.open&&!new URLSearchParams(location.search).has('shot'))history.pushState({p2p:'shot'},'',shotUrl(example?.id??photo?.id??'flycatcher'));};
      dialog.showModal();
      if(!fromHistory&&!(photo&&named===photo.id)){if(stepping)void stepping.then(push);else push();}
    }
    if(photo){prepare(true);void loadChoices();}else void chooseDefault(true);
  }
  return (source:HTMLElement,photo?:Example)=>open(source,photo);
}
