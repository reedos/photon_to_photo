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
export function createShotVisual(canvas:HTMLCanvasElement,model:Model) {
  const ctx=canvas.getContext('2d')!, bird=birdSprite();
  const paths=[0,.35].flatMap(fieldFrac=>pointBundle(model,{pointDistMm:20000,fieldFrac,nms:[460,550,650],rays:9}).paths);
  let frames:HTMLCanvasElement[]=[], rawCells:Uint8ClampedArray|null=null;
  function setPhoto(view:RenderView) {
    frames=PIPELINE.map(([id])=>{ const c=document.createElement('canvas');c.width=view.width;c.height=view.height;
      const g=c.getContext('2d')!,im=g.createImageData(c.width,c.height);im.data.set(pipelinePixels(view,id));g.putImageData(im,0,0);return c; });
    rawCells=pipelinePixels(view,'raw');
  }
  function line(x:number,y:number,X:number,Y:number,color:string,width=1) {ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(X,Y);ctx.stroke();}
  function text(value:string,x:number,y:number,size=20,color='#dcedf2') {if(canvas.clientWidth<600)return;ctx.font=`${size}px system-ui`;ctx.fillStyle=color;ctx.fillText(value,x,y);}
  function dot(x:number,y:number,r:number,color:string) {ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}
  function landscape(x:number,y:number,w:number,h:number,offset=0) {
    ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();
    const sky=ctx.createLinearGradient(0,y,0,y+h);sky.addColorStop(0,'#374328');sky.addColorStop(.6,'#4a512e');sky.addColorStop(1,'#243026');ctx.fillStyle=sky;ctx.fillRect(x,y,w,h);
    // Background-only left strip from the same render, stretched for the illustrated hero.
    if(frames[4])ctx.drawImage(frames[4],0,0,90,400,x,y,w,h);
    ctx.shadowColor='#b9dcff';ctx.shadowBlur=10;
    const bw=w*.68;ctx.drawImage(bird,x+w*.5-bw/2+offset,y+h*.5-bw*650/900/2,bw,bw*650/900);ctx.restore();
  }
  function draw(seconds:number,ready:boolean) {
    const {stage,progress:p}=shotMoment(seconds),color=SHOT_STAGES[stage].color;
    const ratio=Math.min(2,devicePixelRatio||1),w=Math.max(1,Math.round(canvas.clientWidth*ratio)),h=Math.round(w*.56);
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    ctx.setTransform(w/1000,0,0,h/560,0,0);ctx.clearRect(0,0,1000,560);
    const bg=ctx.createRadialGradient(500,240,10,500,280,650);bg.addColorStop(0,'#142b3b');bg.addColorStop(1,'#050b13');ctx.fillStyle=bg;ctx.fillRect(0,0,1000,560);
    ctx.globalAlpha=.12;for(let x=0;x<1000;x+=40)line(x,0,x,560,'#70dfff');for(let y=0;y<560;y+=40)line(0,y,1000,y,'#70dfff');ctx.globalAlpha=1;
    if(stage===0||stage===2){
      const offset=stage===0?-410*(1-p):p*(model.motion!.speedMps*model.scenario.shutter*1000)/900*(800*.68);
      landscape(100,35,800,450,offset);
      ctx.strokeStyle='#dcf6e6';ctx.lineWidth=2;
      for(const [x,y,dx,dy] of [[370,170,1,1],[630,170,-1,1],[370,370,1,-1],[630,370,-1,-1]]){line(x,y,x+dx*25,y,'#8ffff0',3);line(x,y,x,y+dy*25,'#8ffff0',3);}
      text(stage===0?'ILLUSTRATED GLIDE · STEADY CAMERA':'EXPOSURE WINDOW · TIME EXPANDED',stage===0?125:200,70,19);
      if(stage===2){
        const closed=p>.94?Math.min(1,(p-.94)/.06):p<.06?1-p/.06:0;
        ctx.fillStyle='#050b13';ctx.fillRect(100,35,800,225*closed);ctx.fillRect(100,485-225*closed,800,225*closed);
        ctx.strokeStyle=color;ctx.lineWidth=2;ctx.strokeRect(100,35,800,450);
        if(closed>.8)text(p<.5?'Exposure about to open':'Exposure complete',340,265,25,color);
        line(125,459,125+750*p,459,color,5);
        text(`${(model.motion!.speedMps*model.scenario.shutter*1000*p).toFixed(1)} mm traveled`,130,435,24,color);
      }
      text(stage===0?'6 m/s   •   20 m away   •   500 mm lens':'Electronic exposure illustrated as a gate',120,530,22,color);
    } else if(stage===1){
      const surfaces=model.system.surfaces,min=surfaces[0].z,max=surfaces.at(-1)!.z,scale=750/(max-min);
      const X=(z:number)=>150+(z-min)*scale,Y=(v:number)=>295-v*scale;
      // Surface vertices and apertures are from the realized optical model; curvature silhouettes schematic.
      for(const s of surfaces){const x=X(s.z),r=s.sd*scale;ctx.fillStyle=s.kind==='image'?'#5ce1c6':'#47cfff18';ctx.strokeStyle='#9de4ff70';ctx.lineWidth=1.2;
        ctx.beginPath();ctx.ellipse(x,295, s.kind==='refract'?5:2,r,0,0,Math.PI*2);ctx.fill();ctx.stroke();}
      line(110,295,930,295,'#ffffff25');
      for(let i=0;i<paths.length;i++){
        const path=paths[i],pts=path.pts.filter(q=>q[2]>=min-15&&q[2]<=max+1);if(pts.length<2)continue;
        const c=path.nm<500?'#70aaff':path.nm<600?'#5ce1c6':'#ff8a76';ctx.strokeStyle=c+'42';ctx.lineWidth=1;ctx.beginPath();pts.forEach((q,j)=>j?ctx.lineTo(X(q[2]),Y(q[1])):ctx.moveTo(X(q[2]),Y(q[1])));ctx.stroke();
        const t=fract(p*2+i*.079)*(pts.length-1),j=Math.floor(t),a=pts[j],b=pts[Math.min(j+1,pts.length-1)],f=t-j;
        ctx.shadowColor=c;ctx.shadowBlur=12;dot(X(a[2]+(b[2]-a[2])*f),Y(a[1]+(b[1]-a[1])*f),2.7,c);ctx.shadowBlur=0;
      }
      text('THROUGH THE REAL LENS DESIGN',260,95,24,color);text('Surface shapes schematic · ray paths computed',140,490,20);
    } else if(stage===3){
      const fill=Math.min(1,model.exposure.electronsMidGray*p/model.sensor.fullWellE);
      const top=397-fill*229;ctx.fillStyle='#092124';ctx.fillRect(380,165,240,235);ctx.strokeStyle='#5ce1c6';ctx.lineWidth=3;ctx.strokeRect(380,165,240,235);
      const well=ctx.createLinearGradient(0,top,0,400);well.addColorStop(0,'#80ffbd');well.addColorStop(1,'#16645d');ctx.fillStyle=well;ctx.fillRect(383,top,234,397-top);
      for(let i=0;i<48;i++){const delay=fract(Math.sin(i*78.1)*4321);if(p<=delay*.18)continue;
        const t=fract(p*3+delay),x=390+fract(i*.618)*220;const y=30+t*360;
        if(y<top){ctx.shadowBlur=12;ctx.shadowColor='#ffdb72';dot(x,y,2.5,'#ffdb72');ctx.shadowBlur=0;}}
      text('18% GRAY · GREEN-FILTER PIXEL',250,80,26,color);
      text(`${Math.round(model.exposure.electronsMidGray*p).toLocaleString()} expected e−`,360,455,27,color);
      text(`Full well: ${Math.round(model.sensor.fullWellE).toLocaleString()} e−`,360,491,21);
      line(330,400,330,200,color,2);text('charge',245,305,19);text('Illustrative packets · mean accumulation',280,537,19);
    } else if(stage===4){
      const rows=32,cols=48,ox=245,oy=105,cw=11,ch=10;
      for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
        const passed=r/rows<p;
        const sx=Math.min(599,Math.floor(c/cols*600/2)*2+c%2),sy=Math.min(399,Math.floor(r/rows*400/2)*2+r%2),i=(sy*600+sx)*4;
        ctx.fillStyle=passed&&rawCells?`rgb(${rawCells[i]} ${rawCells[i+1]} ${rawCells[i+2]})`:'#142833';ctx.fillRect(ox+c*cw,oy+r*ch,cw-1,ch-1);
      }
      const yy=oy+p*rows*ch;ctx.shadowBlur=15;ctx.shadowColor=color;line(ox-12,yy,ox+cols*cw+12,yy,color,3);ctx.shadowBlur=0;
      for(let i=0;i<8;i++){const t=fract(p*4+i/8);dot(790+t*120,yy,3,color);}
      text('SENSOR → RAW SAMPLES',300,62,27,color);
      text(`${(model.sensor.readoutS*1000*p).toFixed(1)} / ${(model.sensor.readoutS*1000).toFixed(1)} ms scan`,320,470,26,color);
      text('Actual raw samples · sparse mosaic · schematic scan timing',195,530,19);
    } else {
      const index=Math.min(4,Math.floor(p*5)),im=frames[index];
      if(im){ctx.shadowColor='#47cfff35';ctx.shadowBlur=30;ctx.drawImage(im,135,12,730,487);ctx.shadowBlur=0;
        if(index===4){ctx.drawImage(im,200,85,110,110,785,280,195,195);ctx.strokeStyle=color;ctx.strokeRect(785,280,195,195);text('Feather detail',790,268,19,color);}}
      text(ready?PIPELINE[index][1]:'Preparing the photograph…',135,528,25,color);
    }
    if(stage>0&&stage<5){landscape(20,20,150,95);text('Same bird',28,137,17);}
    return stage===5?PIPELINE[Math.min(4,Math.floor(p*5))][1]:null;
  }
  return {draw,setPhoto};
}
