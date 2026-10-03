import {ghostPlate,platePowers,FILM_INDEX,PLATE_INDEX,type PlateSettings} from '../app/engine-api';
import type {PieceContext} from './types';
import '../styles/ghosts.css';

/** Standalone representative experiment. No selected-camera data is inferred. */
export function ghostView(ctx:PieceContext) {
  const launch=document.createElement('div');launch.className='ghost-launch';launch.hidden=true;
  launch.innerHTML='<button class="btn" type="button">Ghosts & coatings</button><span>Follow the light that reflects twice</span>';
  document.getElementById('model-experiments')!.append(launch);
  const dialog=document.createElement('dialog');dialog.className='ghost-dialog';dialog.id='ghost-plate';dialog.setAttribute('aria-labelledby','ghost-title');
  dialog.innerHTML=`<header><div><span class="ghost-kicker">ONE REPRESENTATIVE GLASS PLATE</span><h2 id="ghost-title">Two reflections. A second path.</h2></div><button class="btn ghost-close">Close</button></header>
    <p class="ghost-lead">Most light passes through. A tiny part reflects off the back, then the front, and emerges again. A thin coating can reduce those reflections.</p>
    <div class="ghost-layout"><figure><svg class="ghost-rays" viewBox="0 0 600 380" role="img" aria-label="Computed primary and double-reflection paths through a glass plate"></svg><figcaption>Computed ray geometry · paths brightened for clarity, not radiometric brightness</figcaption><p class="ghost-result"></p><div class="ghost-animation"><button class="btn ghost-play">Follow the ghost</button><span>Travel timing is illustrative</span></div><svg class="ghost-graph" viewBox="0 0 600 240" role="img" aria-label="Computed unpolarized surface reflectance versus wavelength"></svg><figcaption>Single-surface reflectance · unpolarized light · actual selected angle</figcaption></figure>
    <aside><label>Incidence angle <output data-out="angleDeg"></output><input data-key="angleDeg" aria-label="Plate incidence angle" type="range" min="0" max="65" step="1" value="30"></label>
    <label>Wavelength <output data-out="nm"></output><input data-key="nm" aria-label="Plate wavelength" type="range" min="400" max="700" step="5" value="550"></label>
    <label>Glass thickness <output data-out="thicknessMm"></output><input data-key="thicknessMm" aria-label="Glass plate thickness" type="range" min="1" max="6" step="0.1" value="3"></label>
    <label class="ghost-check"><input class="ghost-coated" type="checkbox"> Coat both faces</label>
    <label>Film thickness <output data-out="filmNm"></output><input data-key="filmNm" aria-label="Coating film thickness" type="range" min="0" max="200" step="0.1" value="99.6"></label>
    <p class="ghost-film-note">99.6 nm is approximately quarter-wave at 550 nm at normal incidence. Change angle or wavelength to move away from that condition. Film outlines are enlarged for visibility.</p>
    <dl class="ghost-stats"></dl><p class="ghost-assumptions">Assumed lossless indices: air 1.00 · glass ${PLATE_INDEX.toFixed(2)} · film ${FILM_INDEX.toFixed(2)}. This plate does not represent the selected lens or its coating.</p>
    <details><summary>Model & sources</summary><p>Ray intersections use Snell refraction and mirror reflection. Fresnel amplitudes with a single-film interference phase determine each surface's reflection and transmission. The s and p components propagate separately; their powers are averaged for unpolarized light.</p><p>Interference is coherent within each nanometre film. Separate millimetre plate passes are treated as mutually incoherent; only the primary and first two-reflection transmitted path are drawn. Further reflections, absorption, dispersion, surface curvature, scatter and full-lens flare are excluded. The spectral plot uses the same film on each face; its cyan line is the candidate film even when the checkbox is off.</p><p><a href="https://ocw.mit.edu/courses/6-974-fundamentals-of-photonics-quantum-electronics-spring-2006/98fcc94d2216c26db424e294c28d459a_mirror_inter_thn.pdf" target="_blank" rel="noopener">MIT 6.974: thin-film structures, §2.3</a></p></details></aside></div>`;
  document.body.append(dialog);
  const find=<T extends Element>(s:string)=>dialog.querySelector<T>(s)!;
  const rays=find<SVGSVGElement>('.ghost-rays'),graph=find<SVGSVGElement>('.ghost-graph'),play=find<HTMLButtonElement>('.ghost-play');
  const settings:PlateSettings={angleDeg:30,nm:550,thicknessMm:3,coated:false,filmNm:99.6};
  let result=ghostPlate(settings),active=false,playing=false,raf=0,previous=0,progress=0;
  let screenPath:[number,number][]=[];
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const percent=(v:number)=>`${(100*v).toFixed(v<.01?4:2)}%`;
  function path(points:number[][]) {return points.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(' ');}
  function dot() {
    const head=find<SVGCircleElement>('.ghost-head');if(!head)return;
    const lengths=screenPath.slice(1).map((p,i)=>Math.hypot(p[0]-screenPath[i][0],p[1]-screenPath[i][1]));let left=progress*lengths.reduce((a,b)=>a+b,0),point=screenPath[0];
    for(let i=0;i<lengths.length;i++){const t=Math.min(1,left/(lengths[i]||1)),a=screenPath[i],b=screenPath[i+1];point=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])];if(left<=lengths[i])break;left-=lengths[i];}
    head.setAttribute('cx',String(point[0]));head.setAttribute('cy',String(point[1]));head.setAttribute('opacity',progress>0?'1':'0');
  }
  function paint() {
    result=ghostPlate(settings);const r=result,all=[...r.primaryPath,...r.ghostPath],minY=Math.min(...all.map(p=>p[0])),maxY=Math.max(...all.map(p=>p[0]));
    const scale=Math.min(480/(settings.thicknessMm+10),260/Math.max(4,maxY-minY));
    const map=(p:number[]):[number,number]=>[300+(p[2]-settings.thicknessMm/2)*scale,190+(p[0]-(minY+maxY)/2)*scale];
    const main=r.primaryPath.map(map);screenPath=r.ghostPath.map(map);const front=map([0,0,0])[0],back=map([0,0,settings.thicknessMm])[0];
    rays.innerHTML=`<defs><linearGradient id="plate-fill"><stop stop-color="#34627c" stop-opacity=".45"/><stop offset="1" stop-color="#184854" stop-opacity=".16"/></linearGradient></defs><rect width="600" height="380" fill="#050d16"/><rect x="${front}" y="38" width="${back-front}" height="305" fill="url(#plate-fill)" stroke="#85b9cb"/><path d="M${front} 38V343 M${back} 38V343" stroke="${settings.coated?'#77ffe1':'#7499ad'}" stroke-width="${settings.coated?5:1}"/><text x="${front+8}" y="30" fill="#bedae6">${settings.thicknessMm.toFixed(1)} mm glass</text><path class="ghost-primary-path" d="${path(main)}" fill="none" stroke="#8dd7ff" stroke-width="3"/><path class="ghost-double-path" d="${path(screenPath)}" fill="none" stroke="#ffbe73" stroke-width="2.5" stroke-dasharray="8 5"/><circle class="ghost-head" r="5" fill="#fff6d5" stroke="#ffad56" stroke-width="2"/><circle cx="${main.at(-1)![0]}" cy="${main.at(-1)![1]}" r="5" fill="#8dd7ff"/><circle cx="${screenPath.at(-1)![0]}" cy="${screenPath.at(-1)![1]}" r="4" fill="#ffbe73"/><text x="18" y="365" fill="#8dd7ff">— PRIMARY</text><text x="186" y="365" fill="#ffbe73">- - TWO-REFLECTION GHOST</text>`;
    if(settings.angleDeg===0)rays.innerHTML+='<text x="18" y="55" fill="#ffe2b0">At 0° the output paths overlap.</text>';
    dot();
    find('.ghost-result').textContent=`${settings.coated?'Coated':'Bare'} · primary ${percent(r.primary)} · ghost ${percent(r.ghost)} of incident power`;
    const samples=Array.from({length:61},(_,i)=>{const nm=400+i*5;return {nm,bare:platePowers({...settings,nm,coated:false}).reflectance,film:platePowers({...settings,nm,coated:true}).reflectance};});
    const upper=Math.max(.06,Math.ceil(Math.max(...samples.flatMap(s=>[s.bare,s.film]))*100)/100),gx=(nm:number)=>50+(nm-400)*510/300,gy=(R:number)=>195-R/upper*145;
    graph.innerHTML=`<rect width="600" height="240" fill="#07111a"/><text x="50" y="22" fill="#cce1ed">SURFACE REFLECTANCE</text><text x="275" y="22" fill="#ffbd74">— Bare</text><text x="395" y="22" fill="#77efdb">— Candidate film</text>${[0,.5,1].map(t=>`<path d="M50 ${gy(t*upper)}H560" stroke="#29404f"/><text x="7" y="${gy(t*upper)+5}" fill="#adc6d6">${(t*upper*100).toFixed(0)}%</text>`).join('')}<path d="${path(samples.map(s=>[gx(s.nm),gy(s.bare)]))}" fill="none" stroke="#ffbd74" stroke-width="2.5"/><path d="${path(samples.map(s=>[gx(s.nm),gy(s.film)]))}" fill="none" stroke="#77efdb" stroke-width="2.5"/><path d="M${gx(settings.nm)} 42V195" stroke="#e6f5ff" stroke-dasharray="3 5"/>${[400,550,700].map(nm=>`<text x="${gx(nm)-18}" y="220" fill="#adc6d6">${nm}</text>`).join('')}<text x="565" y="220" fill="#adc6d6">nm</text>`;
    find('[data-out="angleDeg"]').textContent=`${settings.angleDeg}°`;find('[data-out="nm"]').textContent=`${settings.nm} nm`;find('[data-out="thicknessMm"]').textContent=`${settings.thicknessMm.toFixed(1)} mm`;find('[data-out="filmNm"]').textContent=`${settings.filmNm.toFixed(1)} nm`;
    find('.ghost-stats').innerHTML=`<div><dt>Primary transmission</dt><dd>${percent(r.primary)}<small>of incident power</small></dd></div><div><dt>First transmitted ghost</dt><dd>${percent(r.ghost)}<small>of incident power</small></dd></div><div><dt>Ghost / primary</dt><dd>${percent(r.ghost/r.primary)}</dd></div><div><dt>Output separation</dt><dd>${r.separationMm.toFixed(2)} mm<small>on a plane parallel to glass</small></dd></div>`;
    rays.setAttribute('aria-label',`Computed paths at ${settings.angleDeg} degrees. Primary ${percent(r.primary)}, first two-reflection ghost ${percent(r.ghost)} of incident power. Separation ${r.separationMm.toFixed(2)} millimeters.`);
    graph.setAttribute('aria-label',`Surface reflectance versus wavelength from 400 to 700 nanometers; bare orange, candidate film cyan. Selected surface reflectance ${percent(r.reflectance)}. Vertical scale 0 to ${percent(upper)}.`);
  }
  function pause(){playing=false;cancelAnimationFrame(raf);play.textContent='Follow the ghost';}
  function tick(now:number){if(!playing||!dialog.open||document.hidden){pause();return;}progress=Math.min(1,progress+Math.max(0,Math.min(100,now-previous))/5000);previous=now;dot();if(progress===1)pause();else raf=requestAnimationFrame(tick);}
  play.onclick=()=>{if(playing)pause();else{if(progress===1)progress=0;playing=true;previous=performance.now();play.textContent='Pause light';raf=requestAnimationFrame(tick);}};
  for(const input of dialog.querySelectorAll<HTMLInputElement>('[data-key]'))input.oninput=()=>{pause();progress=0;const key=input.dataset.key as Exclude<keyof PlateSettings,'coated'>;settings[key]=Number(input.value);paint();};
  find<HTMLInputElement>('.ghost-coated').onchange=e=>{pause();progress=0;settings.coated=(e.target as HTMLInputElement).checked;paint();};
  const opener=launch.querySelector<HTMLButtonElement>('button')!;opener.onclick=()=>{ctx.bus.emit('pause-exposure',{});ctx.bus.emit('pause-tour',{});dialog.showModal();paint();};
  find<HTMLButtonElement>('.ghost-close').onclick=()=>dialog.close();dialog.addEventListener('keydown',e=>e.stopPropagation());dialog.addEventListener('cancel',pause);dialog.addEventListener('close',()=>{pause();if(active)opener.focus({preventScroll:true});});
  const hidden=()=>{if(document.hidden)pause();},motion=()=>{if(reduced.matches)pause();};document.addEventListener('visibilitychange',hidden);reduced.addEventListener('change',motion);
  return {activate(){active=true;launch.hidden=false;},deactivate(){active=false;launch.hidden=true;if(dialog.open)dialog.close();},state:()=>({open:dialog.open,playing,progress,...result,screenPath}),dispose(){pause();launch.remove();dialog.remove();document.removeEventListener('visibilitychange',hidden);reduced.removeEventListener('change',motion);}};
}
