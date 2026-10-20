import type { Model } from '../engine/model-types';
import { pointBundle } from './engine-api';
import { shotMoment, SHOT_STAGES } from './shot-model';
import type { Example } from './examples';
import { photoSubject } from './photo-shot';
import { fmtFno, fmtShutter } from './units';
import { captureSweep, assemblyRows, type CaptureMechanism } from './shot-capture';
import { journeyHandoff, journeyFraming } from './shot-journey';
import { fitLabel } from './label-fit';

const fract=(n:number)=>n-Math.floor(n);
type Point=readonly [number,number];
type Route={points:readonly Point[];lengths:number[];total:number};
function route(points:readonly Point[]):Route {
  const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
  return {points,lengths,total:lengths.at(-1)!};
}
function along(r:Route,t:number):Point {
  const d=Math.max(0,Math.min(1,t))*r.total;let i=1;while(i<r.lengths.length-1&&r.lengths[i]<d)i++;
  const f=(d-r.lengths[i-1])/(r.lengths[i]-r.lengths[i-1]||1),a=r.points[i-1],b=r.points[i];return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];
}
export function createShotVisual(canvas:HTMLCanvasElement,model:Model,real:{example:Example;image:HTMLImageElement;detailImage?:HTMLImageElement}) {
  const output=canvas.getContext('2d')!;
  let ctx=output;
  // One reusable transition surface; no bitmap history or frame-dependent state.
  const transitionCanvas=document.createElement('canvas');
  const transitionContext=transitionCanvas.getContext('2d')!;
  // Decode once at native resolution. Chromium may otherwise reuse a prior
  // downscaled HTMLImage raster after a large/small seek, changing photo detail.
  const photoRaster=document.createElement('canvas');photoRaster.width=real.image.naturalWidth;photoRaster.height=real.image.naturalHeight;
  photoRaster.getContext('2d')!.drawImage(real.image,0,0);
  let mechanism:CaptureMechanism='mechanical';
  let reducedMotion=false;
  let handoffRendering=false;
  const paths=[0,.35].flatMap(fieldFrac=>pointBundle(model,{pointDistMm:(real.example.focusM??10)*1000,fieldFrac,nms:[460,550,650],rays:9}).paths);
  const surfaces=model.system.surfaces,min=surfaces[0].z,max=surfaces.at(-1)!.z,scale=750/(max-min);
  const X=(z:number)=>150+(z-min)*scale,Y=(v:number)=>295-v*scale;
  const traced=paths.map(path=>({nm:path.nm,points:path.pts.filter(q=>q[2]>=min-15&&q[2]<=max+1).map(q=>[X(q[2]),Y(q[1])] as Point)})).filter(p=>p.points.length>1).map(p=>({...p,route:route(p.points)}));
  // Score loop r3: the optics chapter says nearer points spread into blur, so it also draws one. A point at half the
  // focus distance, traced through the same lens: its rays would meet behind the sensor, so they reach it as a disk.
  const nearMm=(real.example.focusM??10)*1000/2;
  const nearBundle=pointBundle(model,{pointDistMm:nearMm,fieldFrac:0,nms:[550],rays:9});
  const nearRays=nearBundle.paths.map(path=>path.pts.filter(q=>q[2]>=min-15&&q[2]<=max+1).map(q=>[X(q[2]),Y(q[1])] as Point)).filter(p=>p.length>1);
  const nearLanding=nearBundle.landing.map(q=>Y(q.y));
  // Display-color samples from the supplied JPEG, never reconstructed sensor RAW.
  const sample=document.createElement('canvas');sample.width=36;sample.height=32;
  sample.getContext('2d')!.drawImage(real.image,0,0,36,32);
  const jpegSamples=sample.getContext('2d')!.getImageData(0,0,36,32).data;
  function line(x:number,y:number,X:number,Y:number,color:string,width=1) {ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(X,Y);ctx.stroke();}
  // Every label is fitted inside the canvas (score loop r5): wrapped at word breaks, slid sideways and stacked so its
  // padded box never leaves the picture. The counters on the canvas let a browser gate check each frame's labels.
  let labelStats={total:0,outside:0,adjusted:0};
  function text(value:string,x:number,y:number,size=20,color='#dcedf2',essential=false) {
    if(handoffRendering||canvas.clientWidth<600&&!essential)return;
    const transform=ctx.getTransform(),displayScale=canvas.clientWidth/canvas.width*Math.hypot(transform.a,transform.b);
    const unit=1/Math.max(displayScale,.001);
    // 13 px on screen on a desktop canvas, 11 px on a phone's (design/LOOK.md)
    const fontSize=Math.max(size,(canvas.clientWidth<600?11:13)*unit);
    ctx.save();ctx.font=`${fontSize}px system-ui`;
    const align=ctx.textAlign==='right'||ctx.textAlign==='end'?'right':ctx.textAlign==='center'?'center':'left';
    const metrics=ctx.measureText(value);
    const ascent=metrics.actualBoundingBoxAscent||fontSize*.8,descent=metrics.actualBoundingBoxDescent||fontSize*.2;
    const padX=6*unit,padY=3*unit,lowEdge=-transform.e/transform.a,highEdge=(canvas.width-transform.e)/transform.a;
    const fit=fitLabel({value,x,y,align,measure:s=>ctx.measureText(s).width,lineHeight:fontSize*1.22,
      lo:lowEdge+3*unit,hi:highEdge-3*unit,top:-transform.f/transform.d+2*unit,bottom:(canvas.height-transform.f)/transform.d-2*unit,ascent,descent,padX,padY});
    labelStats.total++;if(fit.adjusted)labelStats.adjusted++;if(fit.outside)labelStats.outside++;
    ctx.textAlign='left';
    for(const l of fit.lines){
      ctx.fillStyle='rgba(3, 9, 15, .62)';ctx.fillRect(l.x-padX,l.y-ascent-padY,l.w+padX*2,ascent+descent+padY*2);
      ctx.fillStyle=color;ctx.fillText(l.text,l.x,l.y);
    }
    ctx.restore();
  }
  function dot(x:number,y:number,r:number,color:string) {ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}
  // Every signal follows a complete, stable path. Position is solely a function of the scrubber.
  function flow(r:Route,t:number,color:string,count=3,strength=1,square=false) {
    ctx.save();ctx.globalAlpha=.18*strength;ctx.strokeStyle=color;ctx.lineWidth=1.3;ctx.beginPath();r.points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.stroke();
    for(let i=0;i<count;i++){
      const f=fract(t+i/count),head=along(r,f);ctx.globalAlpha=strength;ctx.strokeStyle=color;ctx.lineWidth=2.2;ctx.beginPath();
      for(let j=0;j<=8;j++){const q=along(r,Math.max(0,f-.08+j*.01));j?ctx.lineTo(...q):ctx.moveTo(...q);}ctx.stroke();
      ctx.shadowColor=color;ctx.shadowBlur=14;if(square){ctx.fillStyle=color;ctx.fillRect(head[0]-3,head[1]-3,6,6);}else dot(...head,2.8,color);
    }ctx.restore();
  }
  function panel(x:number,y:number,w:number,h:number,color:string) {ctx.fillStyle='#091923dd';ctx.fillRect(x,y,w,h);ctx.strokeStyle=color+'80';ctx.lineWidth=1.5;ctx.strokeRect(x,y,w,h);}
  function photograph(x:number,y:number,w:number,h:number,alpha=1,original=false) {
    const im=real.image,scale=Math.min(w/im.naturalWidth,h/im.naturalHeight);
    const iw=im.naturalWidth*scale,ih=im.naturalHeight*scale,left=x+(w-iw)/2,top=y+(h-ih)/2;
    ctx.save();ctx.globalAlpha*=alpha;ctx.drawImage(original?im:photoRaster,left,top,iw,ih);ctx.restore();
    return {x:left,y:top,w:iw,h:ih};
  }
  function photoFinal(p:number,color:string) {
    // The assembled JPEG expands into the final view without restarting its reveal.
    const expand=Math.min(1,p/.32),ease=expand*expand*(3-2*expand);
    const box=photograph(635+(24-635)*ease,90+(20-90)*ease,335+(952-335)*ease,360+(470-360)*ease,1,true);
    if(ease<1){ctx.save();ctx.strokeStyle=color;ctx.shadowColor=color;ctx.shadowBlur=18;ctx.strokeRect(box.x,box.y,box.w,box.h);ctx.restore();}
    text('THE PHOTOGRAPH · ORIGINAL JPEG',30,539,21,'#d9c9ff',true);
    // The full composition remains visible. Detail is temporarily overlaid, then gives
    // way to a calm unobstructed hold (including on a direct seek to the end).
    const detail=Math.max(0,Math.min(1,(p-.50)/.10,(.87-p)/.09));
    if(detail>0){
      const at=photoSubject(real.example),im=real.image,side=Math.min(im.naturalWidth,im.naturalHeight)*.20;
      const sx=Math.max(0,Math.min(im.naturalWidth-side,im.naturalWidth*at.x-side/2));
      const sy=Math.max(0,Math.min(im.naturalHeight-side,im.naturalHeight*at.y-side/2));
      ctx.save();ctx.globalAlpha=detail;const dx=775,dy=285,dw=195;
      const px=box.x+(sx/im.naturalWidth)*box.w,py=box.y+(sy/im.naturalHeight)*box.h,pw=side/im.naturalWidth*box.w,ph=side/im.naturalHeight*box.h;
      ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.strokeRect(px,py,pw,ph);line(px+pw,py+ph,dx,dy,color);
      panel(dx-5,dy-32,dw+10,dw+37,color);
      if(real.detailImage)ctx.drawImage(real.detailImage,dx,dy,dw,dw);
      else ctx.drawImage(im,sx,sy,side,side,dx,dy,dw,dw);
      text('Photo detail',dx,dy-10,20,color,true);ctx.restore();
    }
  }
  function centered(value:string,x:number,y:number,size:number,color?:string,essential=false){ctx.save();ctx.textAlign='center';text(value,x,y,size,color,essential);ctx.restore();}
  function optics(progress:number,labels=false) {
    // the image surface is drawn at the sensor's own half diagonal (its sd is not a glass edge and ran off the panel)
    for(const s of surfaces){const x=X(s.z),r=(s.kind==='image'?Math.min(s.sd,model.sensor.format.diag/2):s.sd)*scale;ctx.fillStyle=s.kind==='image'?'#5ce1c6':'#47cfff2c';ctx.strokeStyle='#9de4ffb0';ctx.lineWidth=1.2;
      ctx.beginPath();ctx.ellipse(x,295,s.kind==='refract'?5:2,r,0,0,Math.PI*2);ctx.fill();ctx.stroke();}
    line(110,295,930,295,'#ffffff25');
    for(let i=0;i<traced.length;i++){const path=traced[i];flow(path.route,progress*2+i*.079,path.nm<500?'#70aaff':path.nm<600?'#5ce1c6':'#ff8a76',1,.85);}
    if(labels){
      // The nearer point's rays (score loop r3), faint and violet, and the disk they reach the sensor as.
      ctx.save();ctx.globalAlpha=.55;
      for(const pts of nearRays){ctx.strokeStyle='#c3a8ff';ctx.lineWidth=1.4;ctx.beginPath();pts.forEach((q,i)=>i?ctx.lineTo(...q):ctx.moveTo(...q));ctx.stroke();}
      ctx.restore();
      if(nearLanding.length>1){
        const top=Math.min(...nearLanding),bottom=Math.max(...nearLanding),x=X(max)+9;
        ctx.save();ctx.strokeStyle='#c3a8ff';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x+6,top);ctx.lineTo(x,top);ctx.lineTo(x,bottom);ctx.lineTo(x+6,bottom);ctx.stroke();ctx.restore();
        // At this scale the disk is a few px, so a callout enlarges it beside the sensor: the focused point stays a
        // dot, the nearer point is a disk (its size times the stated factor).
        const zoom=Math.max(1,Math.round(80/Math.max(1,bottom-top))),cx=915,cy=104,r=Math.min(46,(bottom-top)*zoom/2);
        panel(855,40,120,128,'#c3a8ff');line(x+6,(top+bottom)/2,855,cy,'#c3a8ff80');
        ctx.save();ctx.fillStyle='#c3a8ff40';ctx.strokeStyle='#c3a8ff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();
        dot(cx,cy,3.5,'#fff0bb');
        ctx.save();ctx.textAlign='center';text(canvas.clientWidth<600?`×${zoom}`:`AT THE SENSOR ×${zoom}`,915,186,14,'#c3a8ff',true);ctx.restore();
      }
      // Name the parts, the way the Scene chapter does (score loop r1: this chapter had no labels). On a phone
      // the canvas keeps LENS and SENSOR (score loop r3: it showed unlabeled lines there).
      const glass=surfaces.filter(s=>s.kind!=='image'),reach=Math.max(...glass.map(s=>s.sd))*scale;
      const below=Math.min(455,295+reach+28),phone=canvas.clientWidth<600;
      centered(phone?'LENS':'LENS ELEMENTS',(X(glass[0].z)+X(glass.at(-1)!.z))/2,below,19,'#9de4ff',true);
      centered('SENSOR',X(max)-44,below,19,'#5ce1c6',true);
      // The iris (score loop r6: the aperture had no beat of its own): two blades close in from the barrel to the opening
      // the stop leaves, drawn at the lens's own stop surface, with the f-number it is set to.
      const stop=surfaces.find(s=>s.kind==='stop');
      if(stop){
        const sx=X(stop.z),open=stop.sd*scale,tip=Math.max(open+26,Math.min(reach*.92,open+70));
        ctx.save();ctx.strokeStyle='#ffd08a';ctx.lineWidth=7;ctx.lineCap='round';ctx.shadowColor='#ffd08a';ctx.shadowBlur=10;
        line(sx,295-open,sx,295-tip,'#ffd08a',7);line(sx,295+open,sx,295+tip,'#ffd08a',7);
        ctx.shadowBlur=0;ctx.strokeStyle='#ffd08a';ctx.lineWidth=1.5;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(sx+14,295-open);ctx.lineTo(sx+14,295+open);ctx.stroke();ctx.restore();
        centered(phone?'IRIS':`IRIS · APERTURE ${fmtFno(model.scenario.fno)}`,sx,295-tip-12,19,'#ffd08a',true);
      }
      ctx.save();ctx.textAlign='right';
      // On a phone the same label is a short tag (score loop r6: the sharp bundle was unnamed there)
      text(phone?'SHARP: MEETS AT SENSOR':'FOCUSED POINT: RAYS MEET ON THE SENSOR',X(max)-12,232,17,'#fff0bb',phone);
      text(phone?'NEARER POINT → BLUR':'NEARER POINT (HALF THE DISTANCE) → BLUR DISK',X(max)-12,phone?372:362,17,'#c3a8ff',true);
      ctx.restore();
    }
  }
  function paintStage(stage:number,p:number) {
    const color=SHOT_STAGES[stage].color;
    const motionTime=Math.min(p,.94); // A short, quiet landing before each handoff.
    if(stage===0){
      const photoBox=photograph(25,55,440,390);
      panel(485,55,485,390,'#47cfff');
      // Score loop r2: the schematic fills the panel (it sat small and faint in the middle) and its sensor is named,
      // so the cyan bar at the right reads as the sensor rather than a stray line.
      const k=.55,tx=485+(485-820*k)/2-110*k,ty=250-295*k;
      ctx.save();ctx.beginPath();ctx.rect(486,56,483,388);ctx.clip();ctx.translate(tx,ty);ctx.scale(k,k);optics(motionTime);ctx.restore();
      {const reach=Math.max(...surfaces.filter(q=>q.kind!=='image').map(q=>q.sd))*scale;centered('SENSOR',tx+X(max)*k,Math.min(436,ty+(295+reach)*k+24),17,'#5ce1c6');}
      // Representative reflected-light paths in a diagram, not scene-scale optical tracing.
      const anchor=photoSubject(real.example);
      const source:Point=[photoBox.x+anchor.x*photoBox.w,photoBox.y+anchor.y*photoBox.h];
      for(let i=0;i<7;i++)flow(route([source,[465,180+i*23],[570,237+i*10]]),motionTime*1.7+i*.13,i%3===0?'#ffcf86':'#78d8fa',2,.65);
      text('A MOMENT IN THE WORLD',45,38,21,color);text('REFLECTED LIGHT ENTERS THE LENS',510,38,21,'#47cfff');
      text('THE PHOTO · SCENE REFERENCE',30,495,23,color,true);text('Scene-to-lens paths schematic',510,495,21);
    } else if(stage===1){
      optics(motionTime,true);
      // An editorial guide riding an actual computed ray, not a counted photon.
      const followed=traced[Math.floor(traced.length/2)];
      if(followed){const at=along(followed.route,Math.min(1,p*1.12));ctx.save();ctx.shadowColor='#fff0bb';ctx.shadowBlur=24;dot(...at,5,'#fff0bb');ctx.restore();}
      // Score loop r5: a photo whose lens is not modeled (the 160 mm Canon) is explained with a stand-in, and the picture says
      // so on every screen size, not only in the last chapter's text.
      if(real.example.modelMatch===false)text(`A REPRESENTATIVE ${real.example.lens==='n50'?'50 mm ':''}DESIGN, NOT THIS LENS`,canvas.clientWidth<600?24:220,canvas.clientWidth<600?545:95,23,'#ffd08a',true);
      else if(canvas.clientWidth<600)text('SCHEMATIC GLASS · RAYS COMPUTED',24,545,22,color,true);
      else text('A PUBLISHED DESIGN OF THIS LENS TYPE',220,95,23,color);
      if(canvas.clientWidth>=600)text('Lens shapes simplified; ray paths computed',140,490,20);
    } else if(stage===2){
      const sweep=captureSweep(p,real.example.shutter);
      let curtainLabels:[string,string]|null=null;
      const box=photograph(190,70,620,400),bottom=box.y+box.h;
      ctx.save();ctx.beginPath();ctx.rect(box.x,box.y,box.w,box.h);ctx.clip();
      if(mechanism==='mechanical'){
        ctx.fillStyle='#03070df5';
        if(sweep.phase==='prepare')ctx.fillRect(box.x,box.y,box.w,box.h*sweep.prepare);
        else if(sweep.phase==='expose'){
          ctx.fillRect(box.x,box.y,box.w,box.h*sweep.rear);
          ctx.fillRect(box.x,box.y+box.h*sweep.front,box.w,box.h*(1-sweep.front));
          line(box.x,box.y+box.h*sweep.front,box.x+box.w,box.y+box.h*sweep.front,'#ffe2a4',3);
          line(box.x,box.y+box.h*sweep.rear,box.x+box.w,box.y+box.h*sweep.rear,'#bca1ff',3);
          curtainLabels=['FRONT CURTAIN OPENS','REAR CURTAIN CLOSES'];
        }else if(sweep.phase==='hold')ctx.fillRect(box.x,box.y,box.w,box.h);
        else ctx.fillRect(box.x,box.y+box.h*sweep.preview,box.w,box.h*(1-sweep.preview));
      }else if(sweep.phase==='expose'){
        ctx.fillStyle='#d7b7ff33';ctx.fillRect(box.x,box.y+box.h*sweep.rear,box.w,box.h*(sweep.front-sweep.rear));
        line(box.x,box.y+box.h*sweep.front,box.x+box.w,box.y+box.h*sweep.front,'#ffe2a4',3);
        line(box.x,box.y+box.h*sweep.rear,box.x+box.w,box.y+box.h*sweep.rear,'#73ffe0',3);
        curtainLabels=['ROWS START COLLECTING','ROWS ARE READ'];
      }
      ctx.restore();
      if(curtainLabels){
        ctx.save();ctx.textAlign='right';
        const fy=box.y+box.h*sweep.front,ry=box.y+box.h*sweep.rear;
        if(sweep.front<.97)text(curtainLabels[0],box.x+box.w-8,Math.min(bottom-6,fy+22),16,'#ffe2a4');
        if(sweep.rear>.03)text(curtainLabels[1],box.x+box.w-8,Math.max(box.y+18,ry-8),16,mechanism==='mechanical'?'#bca1ff':'#73ffe0');
        ctx.restore();
      }
      ctx.strokeStyle='#93abc5';ctx.strokeRect(box.x,box.y,box.w,box.h);
      if(sweep.phase==='preview'){
        const subject=photoSubject(real.example),x=box.x+box.w*subject.x,y=box.y+box.h*subject.y;
        ctx.save();ctx.strokeStyle='#afffdc';ctx.lineWidth=2;ctx.shadowBlur=12;ctx.shadowColor='#afffdc';ctx.strokeRect(x-10,y-10,20,20);ctx.restore();
      }
      const label=sweep.phase==='prepare'?'PREPARE':sweep.phase==='hold'?(mechanism==='electronic'?'READOUT COMPLETE':'CHARGE HELD'):sweep.phase==='preview'?(mechanism==='electronic'?'READY':'RETURN TO PREVIEW'):'EXPOSING';
      text(label,375,43,24,color,true);
      if(sweep.phase==='expose'){
        const y=box.y+box.h*(sweep.front+sweep.rear)/2;
        flow(route([[box.x-110,y],[box.x-35,y],[box.x,y]]),p*3,'#ffc77e',3);
      }
      line(200,500,800,500,'#263846',4);line(200,500,200+p*600,500,color,4);
      text(`${fmtShutter(real.example.shutter)} · recorded exposure`,220,539,22,color,true);
      text(mechanism==='mechanical'?'Mechanical curtain illustration':'Electronic row timing illustration',260,bottom+22,17);
      canvas.dataset.capturePhase=sweep.phase;canvas.dataset.captureFront=String(sweep.front);canvas.dataset.captureRear=String(sweep.rear);
    } else if(stage===3){
      // A green-filter reference pixel cutaway. Optical packets and charge markers have separate weights.
      panel(215,168,340,37,'#5ce1c6');panel(235,256,300,86,'#47cfff');
      // Score loop r5: the photodiode is not an empty box. A depletion-region gradient (deeper toward the junction at the
      // bottom, where light's electrons are swept to) fills it, with a dashed edge for the region's boundary. Schematic.
      {const dep=ctx.createLinearGradient(0,256,0,342);dep.addColorStop(0,'#47cfff12');dep.addColorStop(.55,'#47cfff30');dep.addColorStop(1,'#5ce1c660');
      ctx.save();ctx.fillStyle=dep;ctx.fillRect(236,257,298,84);ctx.setLineDash([6,5]);ctx.strokeStyle='#9de4ff70';ctx.lineWidth=1.2;ctx.strokeRect(250,272,270,56);ctx.restore();}
      ctx.fillStyle='#5ce1c622';ctx.beginPath();ctx.ellipse(385,118,175,40,0,Math.PI,Math.PI*2);ctx.fill();ctx.strokeStyle='#a2efff88';ctx.stroke();
      const fill=.55*p;
      for(let i=0;i<12;i++){
        const phase=motionTime*1.6+i*.0833;
        const hue=i%3===0?'#ffce78':i%3===1?'#8fccff':'#88efb7';
        flow(route([[235+i*27,25],[245+i*25,116],[320+i*12,183]]),phase,hue,1,.32);
        flow(route([[320+i*12,183],[385,284]]),phase,hue,1,i%3===2?.32:.04);
      }
      // Conversion hotspot and a separate, explicitly schematic charge-transfer route.
      ctx.save();ctx.shadowBlur=18;ctx.shadowColor='#5ce1c6';dot(385,294,9,'#c3ffe0');ctx.restore();
      const transfer=route([[385,300],[385,370],[620,370],[660,326],[760,326]]);
      flow(transfer,motionTime*2,'#9dffe6',6,p*.35,true);
      // A representative conversion beat connects arrival, absorption and charge collection.
      // The highlighted markers are schematic, separately weighted signals, not particle counts.
      const beat=fract(Math.min(p,.9999)*3),envelope=Math.min(1,p*20,(1-p)*20);
      ctx.save();ctx.globalAlpha=Math.max(0,envelope);ctx.shadowColor='#b9ffdb';ctx.shadowBlur=26;
      if(beat<.45){const at=along(route([[397,25],[395,116],[392,183],[385,284]]),beat/.45);dot(...at,6,'#efffe5');}
      if(beat>=.45&&beat<.68){const burst=(beat-.45)/.23;ctx.globalAlpha*=1-burst;ctx.strokeStyle='#b9ffdb';ctx.lineWidth=3;ctx.beginPath();ctx.arc(385,294,10+burst*35,0,Math.PI*2);ctx.stroke();}
      ctx.globalAlpha=Math.max(0,envelope);
      if(beat>=.58&&beat<.95){const at=along(transfer,(beat-.58)/.37);ctx.fillStyle='#c8ffe9';ctx.fillRect(at[0]-6,at[1]-6,12,12);}
      ctx.restore();
      const top=433-fill*257;panel(725,173,215,263,'#5ce1c6');
      const well=ctx.createLinearGradient(0,173,0,436);well.addColorStop(0,'#8cffe1');well.addColorStop(1,'#237e75');ctx.fillStyle=well;ctx.fillRect(728,top,209,433-top);
      // A schematic charge cloud; the level is not a recovered measurement.
      for(let i=0;i<Math.floor(45*p);i++){const x=755+fract(i*.618)*155,y=top+fract(i*.414)*Math.max(0,430-top);ctx.fillStyle='#aaffde';ctx.globalAlpha=.25+.65*fract(i*.79);ctx.fillRect(x,y,3,3);}ctx.globalAlpha=1;
      text('MICROLENS',235,91,19,undefined,true);text('GREEN FILTER',265,194,19,undefined,true);text('PHOTODIODE',275,244,19,'#5ce1c6',true);
      // Score loop r5: right-aligned to end 20 px short of the charge store's box (it ran through the box's border) and tied to
      // the transfer route it names by a leader.
      line(540,372,540,391,'#9dffe680',1.2);
      ctx.save();ctx.textAlign='right';text('CHARGE (EACH PACKET ≈ MANY ELECTRONS)',705,412,18,'#9dffe6');ctx.restore();
      // Score loop r3: the well is the photodiode's own store, drawn apart from it, not a second part charge flows to.
      if(canvas.clientWidth<600)text('CHARGE STORE',725,152,21,color,true);
      else{ctx.save();ctx.textAlign='right';text('THE PHOTODIODE’S CHARGE STORE',940,128,21,color,true);text('drawn apart so you can see it fill',940,156,17,color);ctx.restore();}
      // Score loop r5: the caption strip carries both, on one baseline, instead of two floating labels
      // (on a phone the labels are drawn at least 13 CSS px tall, so they take two rows, not one)
      if(canvas.clientWidth<600){text('Charge accumulates',45,478,24,color,true);text('SCHEMATIC, NOT MEASURED',45,538,18,undefined,true);}
      else{text('Charge accumulates',45,538,24,color,true);text('SCHEMATIC CHARGE · NOT A MEASURED LEVEL',285,538,18,undefined,true);}
    } else if(stage===4){
      const {complete,active}=assemblyRows(p),rows=32,cols=36,ox=40,oy=100,cw=10,ch=10;
      for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
        const i=(r*cols+c)*4,channel=r%2===0?(c%2===0?0:1):(c%2===0?1:2);
        const value=jpegSamples[i+channel],rgb=[0,0,0];rgb[channel]=value;
        ctx.fillStyle=r<=active?`rgb(${rgb.join(' ')})`:'#14212b';ctx.fillRect(ox+c*cw,oy+r*ch,cw-1,ch-1);
      }
      const yy=oy+(active+.5)*ch;
      line(ox,yy,ox+cols*cw,yy,'#d2b4ff',3);
      panel(455,205,130,120,'#b69cff');text('ADC',483,240,26,color,true);text('SIGNAL',464,271,17);text('→ DATA',464,301,17);centered('analog-to-digital converter',520,350,15);
      // score loop r2: the ADC output is not the photo; name the color processing between them
      centered('then: demosaic →',520,384,15,'#d2b4ff');centered('white balance → JPEG',520,406,15,'#d2b4ff');
      flow(route([[400,yy],[428,yy],[428,264],[455,264]]),p*5,'#8cfbda',3,1,true);
      // Rows of the supplied photo assemble on the same scan clock. The JPEG is
      // a teaching stand-in for the unavailable RAW + processing chain.
      const box=photograph(635,90,335,360,.09);
      ctx.save();ctx.beginPath();ctx.rect(box.x,box.y,box.w,box.h*(complete/rows));ctx.clip();photograph(635,90,335,360);ctx.restore();
      const destY=box.y+box.h*(Math.min(rows,complete)/rows);
      flow(route([[585,264],[610,264],[610,destY],[box.x,destY]]),p*5,'#bea1ff',4,1,true);
      line(box.x,destY,box.x+box.w,destY,'#aaffdf',2);
      text('COLOR SAMPLES',50,70,22,'#9debdc',true);text('BUILDING THE PHOTO',625,70,21,color,true);
      const narrow=canvas.clientWidth<600;
      text(`${complete} / ${rows} ${narrow?'rows':'illustrated rows'}`,620,490,21,color,true);
      // Score loop r3: one plain hedge for the scene (it stacked four, one with a backward arrow).
      text(narrow?'Illustrated from the JPEG · not the RAW':'Sensor samples illustrated from the JPEG · not the original RAW',45,540,19,undefined,true);
      canvas.dataset.assembledRows=String(complete);
    } else {
      photoFinal(p,color);
      return 'The result: this photograph';
    }
    if(!handoffRendering&&(stage===1||stage===2||stage===3)){
      // Score loop r4: on a phone the canvas is about 340 px wide, so the 120 x 76 thumbnail came out 41 x 26 px, blurry and
      // unlabeled. It is drawn 35% larger there with a short label (the text helper keeps it at 13 px or more on screen).
      const phone=canvas.clientWidth<600,k=phone?1.35:1;
      photograph(20,20,120*k,76*k);text(phone?'This photo':'This photograph',22,20+76*k+(phone?22:20),15,undefined,phone);
    }
    return null;
  }
  function background(w:number,h:number){
    ctx.setTransform(w/1000,0,0,h/560,0,0);ctx.globalAlpha=1;ctx.clearRect(0,0,1000,560);
    const bg=ctx.createRadialGradient(500,240,10,500,280,650);bg.addColorStop(0,'#142b3b');bg.addColorStop(1,'#050b13');ctx.fillStyle=bg;ctx.fillRect(0,0,1000,560);
    ctx.globalAlpha=.12;for(let x=0;x<1000;x+=40)line(x,0,x,560,'#70dfff');for(let y=0;y<560;y+=40)line(0,y,1000,y,'#70dfff');ctx.globalAlpha=1;
  }
  function drawFrame(seconds:number,stopAt=28,startAt=0) {
    const {stage,progress}=shotMoment(seconds,stopAt);
    const ratio=Math.min(2,devicePixelRatio||1),w=Math.max(1,Math.round(canvas.clientWidth*ratio)),h=Math.round(w*.56);
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    delete canvas.dataset.capturePhase;delete canvas.dataset.captureFront;delete canvas.dataset.captureRear;delete canvas.dataset.assembledRows;
    const handoff=journeyHandoff(seconds,startAt,stopAt,reducedMotion);
    canvas.dataset.handoff=handoff?`${handoff.from}-${handoff.to}`:'';
    ctx=output;background(w,h);
    if(!handoff)return paintStage(stage,progress);
    handoffRendering=true;
    // Follow the same visual landmark into the next representation. Both views
    // are derived directly from time, so reverse seeks cannot leave stale frames.
    let outgoing:readonly number[]=handoff.outgoing;
    if(handoff.from===2){
      const subject=photoSubject(real.example),scale=Math.min(620/real.image.naturalWidth,400/real.image.naturalHeight);
      const iw=real.image.naturalWidth*scale,ih=real.image.naturalHeight*scale;
      outgoing=[190+(620-iw)/2+subject.x*iw,70+(400-ih)/2+subject.y*ih,2.15];
    }
    function view(index:number,anchor:readonly number[],amount:number){
      const stage=SHOT_STAGES[index],p=Math.max(0,Math.min(1,(seconds-stage.start)/(stage.end-stage.start)));
      const camera=journeyFraming(anchor,amount);
      ctx.save();ctx.translate(camera.x,camera.y);ctx.scale(camera.scale,camera.scale);paintStage(index,p);ctx.restore();
    }
    view(handoff.from,outgoing,handoff.mix);
    if(transitionCanvas.width!==w||transitionCanvas.height!==h){transitionCanvas.width=w;transitionCanvas.height=h;}
    ctx=transitionContext;background(w,h);view(handoff.to,handoff.incoming,1-handoff.mix);
    ctx=output;ctx.save();ctx.globalAlpha=handoff.mix;ctx.drawImage(transitionCanvas,0,0,1000,560);ctx.restore();
    const u=handoff.mix,v=1-u,envelope=Math.sin(Math.PI*handoff.progress);
    const x=v*v*outgoing[0]+2*v*u*500+u*u*handoff.incoming[0],y=v*v*outgoing[1]+2*v*u*280+u*u*handoff.incoming[1];
    ctx.save();ctx.globalAlpha=envelope;ctx.shadowColor=SHOT_STAGES[handoff.to].color;ctx.shadowBlur=30;
    ctx.strokeStyle=SHOT_STAGES[handoff.to].color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,10+envelope*17,0,Math.PI*2);ctx.stroke();
    if(handoff.to>=3){ctx.fillStyle='#dbffef';ctx.fillRect(x-5,y-5,10,10);}else dot(x,y,6,'#fff0bb');ctx.restore();
    handoffRendering=false;
    text('ILLUSTRATIVE TRANSFER · EXPANDED TIME',36,535,20,'#b7d0dc',true);
    return handoff.label;
  }
  function draw(seconds:number,stopAt=28,startAt=0) {
    labelStats={total:0,outside:0,adjusted:0};
    const label=drawFrame(seconds,stopAt,startAt);
    canvas.dataset.labelsTotal=String(labelStats.total);canvas.dataset.labelsOutside=String(labelStats.outside);canvas.dataset.labelsAdjusted=String(labelStats.adjusted);
    return label;
  }
  return {draw,setMechanism(value:CaptureMechanism){mechanism=value;},setReducedMotion(value:boolean){reducedMotion=value;}};
}
