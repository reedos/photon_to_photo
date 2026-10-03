// Capture the actual engine-driven controlled-gray photon experiment, not a photo reconstruction.
// Stable timeline samples produce a six-second silent loop for the story chapter.
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const url=process.env.P2P_URL||'http://127.0.0.1:47701/';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=d3d11','--enable-unsafe-webgpu','--ignore-gpu-blocklist']});
try{
 const p=await browser.newPage({viewport:{width:1366,height:900},reducedMotion:'reduce'});
 await p.goto(new URL('?piece=loupe&lens=n50&fno=4&shutter=1/250',url).href);await p.waitForFunction(()=>window.p2p?.pieces.loupe.state().hasPixel);
 await p.getByRole('button',{name:'Photon rain & noise',exact:true}).click();await p.locator('[data-rain=compare]').click();
 const media=await p.evaluate(async()=>{
  const rain=document.querySelector('[data-rain=rain]'),noise=document.querySelector('[data-rain=noise]'),time=document.querySelector('[data-rain=time]');
  const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=480;const c=canvas.getContext('2d');
  function draw(progress){time.value=String(Math.round(progress*1000));time.dispatchEvent(new Event('input'));c.fillStyle='#07131f';c.fillRect(0,0,1080,480);c.drawImage(rain,10,45,590,350);c.drawImage(noise,620,45,450,350);c.font='22px system-ui';c.fillStyle='#b8efdf';c.fillText('PHOTONS ARRIVE',15,30);c.fillText('EQUAL LIGHT. DIFFERENT COUNTS.',620,30);c.font='19px system-ui';c.fillStyle='#cad9e4';c.fillText('Controlled gray experiment · 1 dot = 1 incident photon',15,427);c.fillText('Expected 96 photons / pixel · 1/250 s exposure shown over 6 s',15,458)}
  draw(.65);const poster=canvas.toDataURL('image/webp',.9).split(',')[1];
  const stream=canvas.captureStream(30),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:1600000}),chunks=[];
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  const finished=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
  const start=performance.now();await new Promise(resolve=>{function tick(now){const progress=Math.min(1,(now-start)/6000);draw(progress);if(progress<1)requestAnimationFrame(tick);else resolve()}requestAnimationFrame(tick)});
  recorder.stop();await finished;stream.getTracks().forEach(t=>t.stop());
  const blob=new Blob(chunks,{type:'video/webm'});const data=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(blob)});return {data,poster,mean:document.querySelector('#photon-rain').dataset.mean};
 });
 if(Math.abs(+media.mean-96)>.0001)throw new Error('Unexpected source mean');
 mkdirSync('public/media',{recursive:true});writeFileSync('public/media/photon-rain-loop.webm',Buffer.from(media.data,'base64'));writeFileSync('public/media/photon-rain-poster.webp',Buffer.from(media.poster,'base64'));console.log('Captured controlled photon-rain loop',Buffer.from(media.data,'base64').length,'bytes');
}finally{await browser.close()}
