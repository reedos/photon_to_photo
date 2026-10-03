import type { Model } from '../engine/model-types';
import { flightCoverage, flightPigment } from '../engine/flight-pattern';
import { pointBundle } from './engine-api';
import { pipelinePixels, PIPELINE } from './learning-model';
import type { RenderView } from './render-client';
import { shotMoment, SHOT_STAGES } from './shot-model';

// The hero and the physical scene share the same silhouette and pigment regions.
// Screen colors here are an illustration; only the final buffers are a rendered photograph.
function birdSprite() {
  const c=document.createElement('canvas'); c.width=540;c.height=390;
  const ctx=c.getContext('2d')!, im=ctx.createImageData(c.width,c.height);
  for(let y=0;y<c.height;y++) for(let x=0;x<c.width;x++) {
    const u=x/c.width-.5,v=.5-y/c.height;if(!flightCoverage(u,v))continue;
    const [a,b,d]=flightPigment(u,v),i=(y*c.width+x)*4;
    im.data[i]=Math.min(255,190*a+235*b+100*d);
    im.data[i+1]=Math.min(255,120*a+240*b+190*d);
    im.data[i+2]=Math.min(255,75*a+230*b+255*d);im.data[i+3]=255;
  }
  ctx.putImageData(im,0,0);return c;
}
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
export function createShotVisual(canvas:HTMLCanvasElement,model:Model) {
  const ctx=canvas.getContext('2d')!, bird=birdSprite();
  const paths=[0,.35].flatMap(fieldFrac=>pointBundle(model,{pointDistMm:20000,fieldFrac,nms:[460,550,650],rays:9}).paths);
  const surfaces=model.system.surfaces,min=surfaces[0].z,max=surfaces.at(-1)!.z,scale=750/(max-min);
  const X=(z:number)=>150+(z-min)*scale,Y=(v:number)=>295-v*scale;
  const traced=paths.map(path=>({nm:path.nm,points:path.pts.filter(q=>q[2]>=min-15&&q[2]<=max+1).map(q=>[X(q[2]),Y(q[1])] as Point)})).filter(p=>p.points.length>1).map(p=>({...p,route:route(p.points)}));
  let frames:HTMLCanvasElement[]=[], rawCells:Uint8ClampedArray|null=null,raw:Uint16Array|null=null;
  function setPhoto(view:RenderView) {
    frames=PIPELINE.map(([id])=>{ const c=document.createElement('canvas');c.width=view.width;c.height=view.height;
      const g=c.getContext('2d')!,im=g.createImageData(c.width,c.height);im.data.set(pipelinePixels(view,id));g.putImageData(im,0,0);return c; });
    rawCells=pipelinePixels(view,'raw');
    raw=view.raw;
  }
  function line(x:number,y:number,X:number,Y:number,color:string,width=1) {ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(X,Y);ctx.stroke();}
  function text(value:string,x:number,y:number,size=20,color='#dcedf2',essential=false) {if(canvas.clientWidth<600&&!essential)return;ctx.font=`${canvas.clientWidth<600?Math.max(30,size):size}px system-ui`;ctx.fillStyle=color;ctx.fillText(value,x,y);}
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
  function optics(progress:number) {
    for(const s of surfaces){const x=X(s.z),r=s.sd*scale;ctx.fillStyle=s.kind==='image'?'#5ce1c6':'#47cfff18';ctx.strokeStyle='#9de4ff70';ctx.lineWidth=1.2;
      ctx.beginPath();ctx.ellipse(x,295,s.kind==='refract'?5:2,r,0,0,Math.PI*2);ctx.fill();ctx.stroke();}
    line(110,295,930,295,'#ffffff25');
    for(let i=0;i<traced.length;i++){const path=traced[i];flow(path.route,progress*2+i*.079,path.nm<500?'#70aaff':path.nm<600?'#5ce1c6':'#ff8a76',1,.85);}
  }
  function landscape(x:number,y:number,w:number,h:number,offset=0) {
    ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();
    const sky=ctx.createLinearGradient(0,y,0,y+h);sky.addColorStop(0,'#374328');sky.addColorStop(.6,'#4a512e');sky.addColorStop(1,'#243026');ctx.fillStyle=sky;ctx.fillRect(x,y,w,h);
    // Background-only left strip from the same render, stretched for the illustrated hero.
    if(frames[4])ctx.drawImage(frames[4],0,0,90,400,x,y,w,h);
    ctx.shadowColor='#b9dcff';ctx.shadowBlur=10;
    const bw=w*.68;ctx.drawImage(bird,x+w*.5-bw/2+offset,y+h*.5-bw*650/900/2,bw,bw*650/900);ctx.restore();
  }
  function draw(seconds:number,ready:boolean,stopAt=28) {
    const {stage,progress:p}=shotMoment(seconds,stopAt),color=SHOT_STAGES[stage].color;
    const ratio=Math.min(2,devicePixelRatio||1),w=Math.max(1,Math.round(canvas.clientWidth*ratio)),h=Math.round(w*.56);
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    ctx.setTransform(w/1000,0,0,h/560,0,0);ctx.clearRect(0,0,1000,560);
    const bg=ctx.createRadialGradient(500,240,10,500,280,650);bg.addColorStop(0,'#142b3b');bg.addColorStop(1,'#050b13');ctx.fillStyle=bg;ctx.fillRect(0,0,1000,560);
    ctx.globalAlpha=.12;for(let x=0;x<1000;x+=40)line(x,0,x,560,'#70dfff');for(let y=0;y<560;y+=40)line(0,y,1000,y,'#70dfff');ctx.globalAlpha=1;
    const motionTime=Math.min(p,.94); // A short, quiet landing before each handoff.
    if(stage===0){
      landscape(30,55,430,390,-190*(1-p));
      panel(485,55,485,390,'#47cfff');
      ctx.save();ctx.translate(495,140);ctx.scale(.47,.47);optics(motionTime);ctx.restore();
      // Representative reflected-light paths in a diagram, not scene-scale optical tracing.
      const source:Point=[245-190*(1-p),250];
      for(let i=0;i<7;i++)flow(route([source,[465,180+i*23],[570,237+i*10]]),motionTime*1.7+i*.13,i%3===0?'#ffcf86':'#78d8fa',2,.65);
      for(const [x,y,dx,dy] of [[160,160,1,1],[330,160,-1,1],[160,355,1,-1],[330,355,-1,-1]]){line(x,y,x+dx*20,y,'#8ffff0',2);line(x,y,x,y+dy*20,'#8ffff0',2);}
      text('A MOMENT IN THE WORLD',45,38,21,color);text('REFLECTED LIGHT ENTERS THE LENS',510,38,21,'#47cfff');
      text('6 m/s  •  20 m away',45,495,25,color);text('Scene-to-lens paths schematic',510,495,21);
    } else if(stage===1){
      optics(motionTime);
      text('THROUGH THE REAL LENS DESIGN',260,95,24,color);text('Surface shapes schematic · ray paths computed',140,490,20);
    } else if(stage===2){
      const displacement=model.motion!.speedMps*model.scenario.shutter*1000;
      landscape(210,20,580,255,p*displacement/900*(580*.68));
      text('ONE ROW’S EXPOSURE · TIME EXPANDED',230,52,20,color);
      // An electronic timing gate is a diagram; there is no physical curtain here.
      const open=p>0&&p<1,gateX=530,gateY=375;
      for(let i=0;i<9;i++){
        const yy=325+i*13;
        flow(route([[130,yy],[350,yy],[gateX,gateY]]),motionTime*2+i*.07,'#74d9ff',2,.7);
        const out=route([[gateX,gateY],[730,yy],[865,yy]]);
        if(open)flow(out,p*2+i*.07,'#c2a5ff',2,.9);
        else{ctx.globalAlpha=.15;line(gateX,gateY,865,yy,'#b69cff');ctx.globalAlpha=1;}
        dot(870,yy,4,p>0?'#5ce1c6':'#284445');
      }
      ctx.save();ctx.shadowColor=color;ctx.shadowBlur=open?25:4;ctx.strokeStyle=open?'#b69cff':'#66758a';ctx.lineWidth=5;ctx.beginPath();ctx.ellipse(gateX,gateY,30,88,0,0,Math.PI*2);ctx.stroke();ctx.restore();
      panel(852,310,40,144,'#5ce1c6');
      text('LIGHT',130,485,22,'#47cfff',true);text(open?'EXPOSURE ENABLED':p<.5?'WAITING TO EXPOSE':'CHARGE HELD',410,490,22,color);text('SENSOR',815,488,22,'#5ce1c6',true);
      line(210,292,790,292,'#253646',5);line(210,292,210+580*p,292,color,5);
      text(`${(displacement*p).toFixed(1)} mm subject travel`,300,538,22,color);
    } else if(stage===3){
      // A green-filter reference pixel cutaway. Optical packets and charge markers have separate weights.
      panel(215,168,340,37,'#5ce1c6');panel(235,256,300,86,'#47cfff');
      ctx.fillStyle='#5ce1c622';ctx.beginPath();ctx.ellipse(385,118,175,40,0,Math.PI,Math.PI*2);ctx.fill();ctx.strokeStyle='#a2efff88';ctx.stroke();
      const generated=model.exposure.electronsMidGray*p,fill=Math.min(1,generated/model.sensor.fullWellE);
      for(let i=0;i<12;i++){
        const phase=motionTime*1.6+i*.0833;
        flow(route([[235+i*27,25],[245+i*25,116],[320+i*12,183],[385,284]]),phase,i%3===0?'#ffce78':i%3===1?'#8fccff':'#88efb7',1,.32);
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
      // A readable count and an expanded schematic charge cloud, distinct from the true-scale fill.
      for(let i=0;i<45*p;i++){const x=755+fract(i*.618)*155,y=215+fract(i*.414)*120;ctx.fillStyle='#aaffde';ctx.globalAlpha=.25+.65*fract(i*.79);ctx.fillRect(x,y,3,3);}ctx.globalAlpha=1;
      text('MICROLENS',235,91,19,undefined,true);text('GREEN FILTER',265,194,19,undefined,true);text('PHOTODIODE',275,244,19,'#5ce1c6',true);
      text('WEIGHTED CHARGE PACKETS',380,414,18,'#9dffe6');text('CHARGE WELL',725,152,21,color,true);
      text(`${Math.round(generated).toLocaleString()} expected e−`,650,476,24,color,true);
      text(`${(100*fill).toFixed(2)}% of full well · cloud schematic`,570,520,18);
    } else if(stage===4){
      const rows=32,cols=48,ox=70,oy=90,cw=11,ch=11,active=Math.min(rows-1,Math.floor(p*rows));
      // A labeled display lift reveals structure without altering native raw codes or the final photo.
      for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
        const sx=Math.min(599,Math.floor(c/cols*300)*2+c%2),sy=Math.min(399,Math.floor(r/rows*200)*2+r%2),i=(sy*600+sx)*4;
        const gain=4,passed=r<=active;
        ctx.fillStyle=passed&&rawCells?`rgb(${Math.min(255,rawCells[i]*gain)} ${Math.min(255,rawCells[i+1]*gain)} ${Math.min(255,rawCells[i+2]*gain)})`:'#122432';ctx.fillRect(ox+c*cw,oy+r*ch,cw-1,ch-1);
      }
      const yy=oy+active*ch+ch*.5;ctx.save();ctx.shadowBlur=12;ctx.shadowColor=color;line(ox-5,yy,ox+cols*cw+5,yy,color,3);ctx.restore();
      panel(700,170,200,175,'#5ce1c6');text('ADC → CODE',714,202,20,color,true);
      const sampleX=300,sampleY=Math.min(399,Math.floor(active/rows*200)*2+active%2),dn=raw?.[sampleY*600+sampleX]??0;
      ctx.strokeStyle='#e7fff8';ctx.lineWidth=2;ctx.strokeRect(ox+24*cw,oy+active*ch,cw-1,ch-1);
      flow(route([[600,yy],[642,yy],[642,252],[700,252]]),motionTime*4,'#9dffe6',3,1,true);
      text(String(dn)+' DN',735,245,26,undefined,true);
      for(let bit=0;bit<model.sensor.bits;bit++){ctx.fillStyle=dn&(1<<bit)?'#9dffe6':'#25403d';ctx.fillRect(714+(bit%7)*25,270+Math.floor(bit/7)*28,18,18);}
      flow(route([[900,255],[940,255],[940,435],[745,435]]),motionTime*3,'#b69cff',4,.9,true);
      for(let i=0;i<10;i++){const len=20+fract(i*.618)*100;ctx.fillStyle='#b69cff';ctx.globalAlpha=.2+.5*fract(motionTime*3+i*.1);ctx.fillRect(735,365+i*7,len,3);}ctx.globalAlpha=1;
      text('WHOLE SENSOR · ACTUAL RAW SAMPLES',180,45,24,color);
      text(`${(model.sensor.readoutS*1000*p).toFixed(1)} / ${(model.sensor.readoutS*1000).toFixed(1)} ms scan`,120,488,25,color);
      text('Mosaic display ×4 · native codes unchanged · routes schematic',120,534,19);
    } else {
      const phase=p*5,index=Math.min(4,Math.floor(phase)),wipe=p===1?1:Math.min(1,fract(phase)/.68),im=frames[index];
      if(im){
        const x=135,y=12,iw=730,ih=487;
        ctx.drawImage(frames[Math.max(0,index-1)],x,y,iw,ih);
        ctx.save();ctx.beginPath();ctx.rect(x,y,iw*wipe,ih);ctx.clip();ctx.drawImage(im,x,y,iw,ih);ctx.restore();
        if(wipe<1&&index>0){ctx.save();ctx.shadowColor=color;ctx.shadowBlur=18;line(x+iw*wipe,y,x+iw*wipe,y+ih,color,3);ctx.restore();}
        if(index===4){const detail=Math.max(0,Math.min(1,(p-.92)/.06));ctx.save();ctx.globalAlpha=detail;ctx.drawImage(im,200,85,110,110,785,280,195,195);ctx.strokeStyle=color;ctx.strokeRect(785,280,195,195);text('Feather detail',790,268,19,color);ctx.restore();}
      }
      const labels=['RAW','RGB','WB','COLOR','sRGB'];
      for(let i=0;i<5;i++){
        const x=180+i*155;if(i<4){const r=route([[x+36,534],[x+118,534]]);if(i===index-1&&wipe<1)flow(r,motionTime*5,'#b69cff',2);else line(x+36,534,x+118,534,i<index?'#b69cff':'#29404e',2);}
        dot(x,534,6,i<=index?'#cfbaff':'#29404e');text(labels[i],x-25,520,18,i===index?'#d9f8ff':'#93b4c5',true);
      }
    }
    if(stage>0&&stage<5){landscape(20,20,150,95);text('Same bird',28,137,17);}
    return stage===5?PIPELINE[Math.min(4,Math.floor(p*5))][1]:null;
  }
  return {draw,setPhoto};
}
