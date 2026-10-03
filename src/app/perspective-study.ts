import { perspectiveStudy } from './engine-api';
import { emit } from './bus';
import type { Store } from './store';
import '../styles/perspective.css';
/** A separate ideal-camera experiment: never changes the selected production lens. */
export function mountPerspectiveStudy(store:Store){
 const launch=document.createElement('button');launch.className='btn perspective-launch';launch.type='button';launch.textContent='Focal length & perspective';
 const launchRow=document.createElement('div');launchRow.className='perspective-launch-row';launchRow.append(launch);document.getElementById('studio-exposure')!.before(launchRow);
 const sync=()=>launchRow.hidden=store.get().piece!=='camera';store.subscribe(sync);sync();
 const dialog=document.createElement('dialog');dialog.id='perspective-dialog';dialog.setAttribute('aria-labelledby','perspective-title');
 dialog.innerHTML=`<header><div><span>IDEAL CAMERA EXPERIMENT</span><h2 id="perspective-title">Move the camera. Change the story.</h2></div><button class="btn" id="perspective-close">Close</button></header>
 <p class="perspective-intro">Zoom from 20 to 500 mm. Then keep the gold subject the same size by moving the camera: watch the background grow.</p>
 <canvas width="960" height="600" role="img" aria-label="Computed perspective of a gold subject and blue background columns"></canvas>
 <p class="perspective-legend"><span>Gold · 2 m subject</span><span>Blue · background 20 m farther</span></p>
 <div class="perspective-controls"><label>Focal length <output id="perspective-focal">50 mm</output><input id="perspective-range" type="range" min="20" max="500" step="1" value="50"></label><label>Camera movement<select id="perspective-mode"><option value="fixed">Fixed position</option><option value="dolly">Dolly · keep subject size</option></select></label><button class="btn" id="perspective-play">Play sweep</button></div>
 <p id="perspective-takeaway" role="status"></p><div class="perspective-stats"></div>
 <details><summary>What is computed?</summary><p>Derived · engine thin-lens equation and chief-ray projection onto a 36 × 24 mm sensor. Gold subject: 2 m tall. Blue columns: 6 m tall, 20 m behind it. The camera stays at 15 m in Fixed position; Dolly varies its distance to keep the subject 8 mm tall on the sensor. Distances are measured from the ideal lens plane.</p><p>Perspective comes from camera position. Changing focal length from the same position changes framing, but not the relative size of near and far objects. This isolated model omits defocus, distortion and real focusing groups; it does not morph the selected production lens.</p></details>`;
 document.body.append(dialog);
 const q=<T extends HTMLElement>(s:string)=>dialog.querySelector<T>(s)!;
 const canvas=q<HTMLCanvasElement>('canvas'),c=canvas.getContext('2d')!,range=q<HTMLInputElement>('#perspective-range'),mode=q<HTMLSelectElement>('#perspective-mode'),play=q<HTMLButtonElement>('#perspective-play');
 let playing=false,raf=0,last=0,progress=0;
 function draw(){
  const m=perspectiveStudy(Number(range.value),mode.value==='dolly');
  c.clearRect(0,0,960,600);const bg=c.createLinearGradient(0,0,0,600);bg.addColorStop(0,'#112d42');bg.addColorStop(.55,'#06111d');bg.addColorStop(1,'#152934');c.fillStyle=bg;c.fillRect(0,0,960,600);
  const frame={x:90,y:25,w:780,h:520};
  const xy=(x:number,y:number,z=0)=>{const p=m.project(x,y-1000,z);return {x:480+p.x/36*frame.w,y:285-p.y/24*frame.h}};
  c.save();c.beginPath();c.rect(frame.x,frame.y,frame.w,frame.h);c.clip();
  // Floor grid projects physical coordinates through the same ideal camera.
  c.strokeStyle='#4a8ba63c';c.lineWidth=1;
  for(let x=-40000;x<=40000;x+=2000){const a=xy(x,0,-Math.min(m.subjectMm*.8,12000)),b=xy(x,0,80000);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke()}
  for(const z of [-3000,0,5000,10000,20000,40000,80000]){if(m.subjectMm+z<=0)continue;const a=xy(-40000,0,z),b=xy(40000,0,z);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke()}
  function pillar(x:number,width:number,height:number,z:number,hue:string){const a=xy(x-width/2,height,z),b=xy(x+width/2,0,z);const grad=c.createLinearGradient(a.x,0,b.x,0);grad.addColorStop(0,'#122738');grad.addColorStop(.25,hue);grad.addColorStop(.8,hue);grad.addColorStop(1,'#193247');c.fillStyle=grad;c.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);c.strokeStyle=hue;c.lineWidth=1.5;c.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);}
  for(let i=-7;i<=7;i++)pillar(i*2300+1100,800,6000,20000,'#55b2d1');
  pillar(0,650,2000,0,'#ffbe58');
  const subject=xy(0,2000);c.strokeStyle='#ffe2a6';c.setLineDash([6,6]);c.beginPath();c.moveTo(frame.x,subject.y);c.lineTo(frame.x+frame.w,subject.y);c.stroke();c.setLineDash([]);
  c.restore();c.strokeStyle='#7396aa';c.lineWidth=2;c.strokeRect(frame.x,frame.y,frame.w,frame.h);
  c.fillStyle='#d9edf4';c.font=`${canvas.clientWidth<500?36:20}px system-ui`;c.fillText('36 \u00d7 24 mm frame \u00b7 upright display',105,582);
  q('output').textContent=`${m.focalMm.toFixed(0)} mm`;
  q('.perspective-stats').textContent=`${(m.subjectMm/1000).toFixed(2)} m to subject · ${m.horizontalFovDeg.toFixed(1)}° horizontal field · subject ${(m.subjectHeightMm/24*100).toFixed(1)}% of frame height`;
  q('#perspective-takeaway').textContent=mode.value==='dolly'?'The subject stays the same size. Moving farther away makes the background larger relative to it.':'The camera stays put. Focal length changes framing; the ratio of near and far sizes stays fixed.';
  canvas.setAttribute('aria-label',`${m.focalMm.toFixed(0)} mm, camera ${(m.subjectMm/1000).toFixed(2)} m from subject. Subject ${(m.subjectHeightMm/24*100).toFixed(1)} percent of frame height. ${q('#perspective-takeaway').textContent}`);
  canvas.dataset.subjectHeight=String(m.subjectHeightMm);canvas.dataset.distance=String(m.subjectMm);canvas.dataset.backgroundRatio=String(m.backgroundRatio);
 }
 function pause(){playing=false;cancelAnimationFrame(raf);play.textContent='Play sweep'}
 function tick(now:number){if(!playing||!dialog.open)return;progress=Math.min(1,progress+Math.max(0,Math.min(100,now-last))/10000);last=now;range.value=String(Math.round(20*Math.pow(25,progress)));draw();if(progress>=1)pause();else raf=requestAnimationFrame(tick)}
 play.onclick=()=>{if(playing){pause();return}progress=0;range.value='20';playing=true;play.textContent='Pause';last=performance.now();draw();raf=requestAnimationFrame(tick)};
 range.oninput=mode.onchange=()=>{pause();draw()};
 launch.onclick=()=>{emit('pause-exposure',{});emit('pause-tour',{});document.querySelector('details.view-menu')?.removeAttribute('open');dialog.showModal();draw()};
 q('#perspective-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{pause();launch.focus({preventScroll:true})});
 dialog.addEventListener('keydown',e=>e.stopPropagation());document.addEventListener('visibilitychange',()=>{if(document.hidden)pause()});matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>pause());
}
