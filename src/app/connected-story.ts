import examplesFile from '../../public/examples/examples.json';

const photo = examplesFile.examples.find(example => example.id === 'flycatcher')!;
const modelQuery = new URLSearchParams({ lens:photo.lens, fno:String(photo.fno), shutter:String(photo.shutter), iso:String(photo.iso), focus:String(photo.focusM), subject:String(photo.focusM), format:'ff' });
const modelLink = (piece:string, part?:string, lesson?:string) => {
  const query = new URLSearchParams(modelQuery); query.set('piece',piece);
  if(part) query.set('part',part); if(lesson) query.set('lesson',lesson);
  return './index.html?' + query;
};
const svg = (label:string, body:string) => `<svg viewBox="0 0 420 170" role="img" aria-label="${label}"><g fill="none" stroke="currentColor" stroke-width="2">${body}</g></svg>`;
const text = (label:string,x:number,y:number) => `<text x="${x}" y="${y}" fill="currentColor" stroke="none" text-anchor="middle">${label}</text>`;
const diagrams = {
  photo: svg('A scene becomes a photograph', '<rect x="36" y="22" width="135" height="105" rx="4"/><path class="story-ray" d="M82 111L119 45L153 105M183 77H247M230 62L247 77L230 92"/><rect x="271" y="22" width="112" height="105" rx="4"/><circle cx="327" cy="76" r="27"/>'+text('A real scene',102,154)+text('One photograph',326,154)),
  light: svg('Light reflected by a subject spreads out; some enters the lens', '<circle class="story-source" cx="72" cy="84" r="9"/><path class="story-ray" d="M83 82L343 35M83 84H343M83 86L343 133M67 73L42 21M63 87L24 107M72 96L70 145"/><ellipse class="story-glass" cx="345" cy="84" rx="18" ry="52"/>'+text('Subject',73,165)+text('Lens opening',342,165)),
  lens: svg('A lens bends a bundle of light toward an image point', '<path class="story-ray" d="M28 36L120 46L192 52L352 85M28 85H352M28 134L120 124L192 118L352 85"/><ellipse class="story-glass" cx="120" cy="85" rx="13" ry="62"/><ellipse class="story-glass" cx="193" cy="85" rx="19" ry="57"/><path d="M355 25V145"/>'+text('Illustrative glass',157,165)+text('Image plane',352,165)),
  focus: svg('A focused bundle meets at the image plane; a different plane cuts a wider spot', '<path class="story-ray" d="M32 24L282 85L382 111M32 146L282 85L382 59M32 85H382"/><path d="M282 19V146M374 19V146"/><circle class="story-source" cx="282" cy="85" r="5"/><ellipse class="story-blur" cx="374" cy="85" rx="7" ry="24"/>'+text('Focused point',264,165)+text('Blur disk',371,165)),
  exposure: svg('A wider opening passes more light; the shutter controls time', '<circle cx="86" cy="73" r="48"/><circle class="story-glass" cx="86" cy="73" r="31"/><circle cx="235" cy="73" r="48"/><circle class="story-glass" cx="235" cy="73" r="15"/><path class="story-ray" d="M318 52H388M318 73H388M318 94H388"/><path d="M354 30V116"/>'+text('Wider',86,145)+text('Narrower',235,145)+text('Time gate',354,145)),
  pixel: svg('A pixel guides and filters light, then collects charge', '<path class="story-ray" d="M119 13L147 45L199 105M199 13V105M279 13L251 45L199 105"/><path class="story-glass" d="M104 51Q199 -7 294 51Z"/><rect class="story-filter" x="104" y="65" width="190" height="13"/><path d="M120 93V132H279V93"/><circle class="story-charge" cx="166" cy="116" r="4"/><circle class="story-charge" cx="197" cy="116" r="4"/><circle class="story-charge" cx="228" cy="116" r="4"/>'+text('Microlens → filter → charge',200,161)),
  readout: svg('Stored charge is measured and converted into digital values', '<rect class="story-filter" x="36" y="29" width="105" height="98"/><path d="M36 61H141M36 94H141M71 29V127M106 29V127"/><path class="story-ray" d="M157 78H203M192 66L204 78L192 90M302 78H353M342 66L354 78L342 90"/><rect x="218" y="48" width="67" height="60" rx="4"/><path d="M369 46V109M384 46V109M357 66H397M357 90H397"/>'+text('Pixel signals',88,154)+text('Measure',252,154)+text('Numbers',375,154)),
  final: svg('Color processing prepares an image for display', '<rect class="story-filter" x="23" y="46" width="78" height="66" rx="4"/><path class="story-ray" d="M111 79H151M259 79H298"/><rect class="story-glass" x="164" y="46" width="81" height="66" rx="4"/><rect x="312" y="46" width="81" height="66" rx="4"/>'+text('Samples',62,84)+text('Color',204,84)+text('Display',352,84)+text('A generic image pipeline',209,150)),
};

const chapters = [
  {id:'photo',label:'The photo',title:'A sharp bird. A softer world.',copy:'Look at the bird, then the branches behind it. The camera turned light from different distances into different-sized spots. That difference helps the subject stand out.',evidence:'Supplied photograph',note:'This is Reed Osaki’s JPEG. Its recorded settings anchor the story; the diagrams are illustrations.',action:'Play this photo’s journey',href:'./index.html?photo=flycatcher'},
  {id:'light',label:'Light',title:'The scene sends light in every direction.',copy:'Light reflects from the bird and the branches. A small part enters the lens. The opening determines how much of that light can join the image.',evidence:'Illustrated mechanism',note:'The paths show the idea, not recovered rays from this scene or a measured photon count.',action:'Explore the camera',href:modelLink('camera')},
  {id:'lens',label:'Lens',title:'Glass changes the direction of light.',copy:'Each curved surface bends a ray. Together, the elements bring light toward the sensor. In the simulator, you can inspect paths traced through a published lens design.',evidence:'Illustration → lens model',note:'The simulator uses a public patent example. It is not a verified prescription of the exact lens used for this photograph.',action:'Go inside the lens',href:modelLink('lens','glass')},
  {id:'focus',label:'Focus',title:'Sharpness belongs to a distance.',copy:'Light from the focused distance meets in a small spot at the sensor. Light from nearer or farther objects spreads into a blur disk. Change focus to move the sharp region through the scene.',evidence:'Recorded focus ≈ 8.9 m',note:'The camera recorded focus in coarse steps. This image is not a depth map; the diagram is schematic.',action:'Try changing focus',href:modelLink('cone','focusRing')},
  {id:'exposure',label:'Exposure',title:'An opening, and a window of time.',copy:'The aperture limits the light admitted. The shutter limits how long it is collected. This photograph records f/5.6 and 1/4000 second. A shorter exposure can freeze motion, but gathers less light.',evidence:'Recorded camera settings',note:'ISO 1400 is also recorded. Raising ISO changes the signal’s amplification; it creates no extra photons.',action:'Explore aperture and shutter',href:modelLink('camera','shutter')},
  {id:'pixel',label:'Pixel',title:'Light becomes an electrical signal.',copy:'Even equally lit pixels collect different numbers of photons: shot noise begins before electronics. A microlens and color filter guide light; some photons generate electrons that accumulate as signal.',evidence:'Computed gray experiment · illustrated mechanism',note:'Original sensor data is unavailable. The dots explain the mechanism; they do not count this photograph’s photons or electrons.',action:'Look inside a model pixel',href:modelLink('loupe','sensor')},
  {id:'readout',label:'Readout',title:'The camera measures the signal.',copy:'Readout turns accumulated charge into digital values. Timing determines when different rows are exposed and read. The electronic-scan lesson lets you explore why exposure time and scan time are different.',evidence:'Generic readout mechanism',note:'The original camera body, readout timing and raw samples are not supplied with this JPEG.',action:'Explore sensor readout',href:modelLink('camera','sensor','readout')},
  {id:'final',label:'The result',title:'Signals become a photograph.',copy:'Color reconstruction, white balance and display encoding help turn sensor samples into an image. Return to the bird: glass, focus and exposure all shaped the result you can see.',evidence:'Supplied JPEG · illustrated pipeline',note:'This JPEG is the supplied result, not a reconstruction of its original raw data. The simulator’s separate image pipeline exposes its own calculated buffers.',action:'Explore the image pipeline',href:modelLink('camera','sensor','pipeline')},
] as const;

export function connectedStory(): string {
  return `<header class="story-heading"><p class="eyebrow">The story · Photon to Photo</p><h1>One moment.<br><span>Follow the light.</span></h1><p class="lede">Start with a real photograph. Follow what a camera does, from reflected light to a finished image.</p><div class="ref-actions"><a class="btn story-primary" href="./index.html?photo=flycatcher">Play photo journey →</a><a class="btn" href="./index.html?piece=camera" data-return-view>Explore the camera</a></div></header>
    <section class="connected-story" aria-label="Eight chapters from scene to photograph">
      <nav class="story-chapters" aria-label="Story chapters">${chapters.map((chapter,i)=>`<button type="button" data-story-chapter="${chapter.id}" aria-controls="story-chapter" ${i===0?'aria-current="step"':''}><span>${String(i+1).padStart(2,'0')}</span>${chapter.label}</button>`).join('')}</nav>
      <div class="story-spread"><figure class="story-photograph"><img src="examples/${photo.image}" width="1600" height="1066" alt="A vermilion flycatcher beside its nest, sharp against softer branches" fetchpriority="high"><figcaption><strong>${photo.title}</strong><span>Photo: Reed Osaki · Supplied JPEG</span></figcaption><div class="story-record"><span>Recorded</span><b>500 mm</b><b>f/5.6</b><b>1/4000 s</b><b>ISO 1400</b></div></figure>
        <article id="story-chapter" class="story-chapter" aria-labelledby="story-title"><div class="story-illustration" id="story-illustration"></div><p class="story-evidence" id="story-evidence"></p><h2 id="story-title"></h2><p id="story-copy"></p><details class="story-provenance"><summary>What backs this chapter</summary><p id="story-note"></p><a href="./reference.html?page=method">Method & limitations →</a></details><a class="btn" id="story-action"></a></article></div>
      <div class="story-transport"><button type="button" class="btn" id="story-prev">← Previous</button><p id="story-position" role="status"></p><button type="button" class="btn" id="story-next">Next chapter →</button></div>
    </section><p class="story-endnote">The photograph stays the same. The diagrams explain the journey. Follow a link at any chapter to experiment with the camera model.</p>`;
}

export function mountConnectedStory(): void {
  const buttons=[...document.querySelectorAll<HTMLButtonElement>('[data-story-chapter]')];
  let index=0;
  const show=(next:number,updateHash=true)=>{
    index=Math.max(0,Math.min(chapters.length-1,next)); const chapter=chapters[index];
    document.querySelector<HTMLVideoElement>('#story-illustration video')?.pause();
    document.getElementById('story-illustration')!.innerHTML=chapter.id==='pixel'?'<p class="story-loop-note">Computed gray-target experiment. These are not this photograph’s photons. Press Play to watch.</p><video controls loop muted playsinline preload="none" poster="media/photon-rain-poster.webp" aria-label="Six-second controlled gray-target photon arrival and noise experiment"><source src="media/photon-rain-loop.webm" type="video/webm">Equal light produces uneven photon counts.</video>':diagrams[chapter.id];
    document.getElementById('story-title')!.textContent=chapter.title;
    document.getElementById('story-copy')!.textContent=chapter.copy;
    document.getElementById('story-evidence')!.textContent=chapter.evidence;
    document.getElementById('story-note')!.textContent=chapter.note;
    const action=document.getElementById('story-action') as HTMLAnchorElement;action.textContent=chapter.action+' →';action.href=chapter.href;
    document.getElementById('story-position')!.textContent=`${index+1} / ${chapters.length} · ${chapter.label}`;
    (document.getElementById('story-prev') as HTMLButtonElement).disabled=index===0;
    (document.getElementById('story-next') as HTMLButtonElement).disabled=index===chapters.length-1;
    buttons.forEach((button,i)=>i===index?button.setAttribute('aria-current','step'):button.removeAttribute('aria-current'));
    if(updateHash) history.replaceState(null,'',`#story-${chapter.id}`);
  };
  const fromHash=()=>{const found=chapters.findIndex(chapter=>location.hash===`#story-${chapter.id}`);show(found<0?0:found,false);};
  buttons.forEach((button,i)=>button.addEventListener('click',()=>show(i)));
  document.getElementById('story-prev')!.addEventListener('click',()=>show(index-1));
  document.getElementById('story-next')!.addEventListener('click',()=>show(index+1));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)document.querySelector<HTMLVideoElement>('#story-illustration video')?.pause();});
  window.addEventListener('hashchange',fromHash);fromHash();
}
