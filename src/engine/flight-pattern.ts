// Authored rigid gliding bird: assumed geometry/pigments, not a measured species or flight model.
import { colorCheckerReflectance } from './data';
export type BirdPolygon = readonly (readonly [number, number])[];
export const FLIGHT_WINGS: BirdPolygon[] = [
  [[.13,.04],[.08,.13],[-.02,.23],[-.14,.36],[-.24,.44],[-.275,.452],[-.29,.44],[-.24,.375],[-.32,.427],[-.35,.42],[-.35,.40],[-.29,.34],[-.38,.381],[-.40,.37],[-.395,.35],[-.33,.29],[-.40,.313],[-.42,.295],[-.40,.275],[-.32,.21],[-.27,.14],[-.20,.09],[-.12,.035]],
  [[.10,-.035],[.085,-.13],[.025,-.23],[-.06,-.34],[-.15,-.44],[-.18,-.455],[-.20,-.446],[-.195,-.423],[-.15,-.36],[-.245,-.426],[-.268,-.419],[-.27,-.398],[-.22,-.33],[-.31,-.383],[-.337,-.371],[-.333,-.35],[-.27,-.285],[-.365,-.322],[-.389,-.307],[-.38,-.282],[-.30,-.23],[-.255,-.16],[-.17,-.10],[-.12,-.025]],
  [[-.13,.035],[-.40,.085],[-.42,.067],[-.39,.035],[-.405,-.01],[-.42,-.061],[-.40,-.077],[-.13,-.04]],
  [[.285,.028],[.365,.008],[.292,-.008]],
];
export function inBirdPolygon(x: number, y: number, p: BirdPolygon): boolean {
  let inside = false;
  for (let i=0,j=p.length-1;i<p.length;j=i++) {
    const [ax,ay]=p[i], [bx,by]=p[j];
    if ((ay>y)!==(by>y) && x<(bx-ax)*(y-ay)/(by-ay)+ax) inside=!inside;
  }
  return inside;
}
export function flightBody(x:number,y:number): boolean { return ((x-.035)/.225)**2+(y/.072)**2<1 || ((x-.245)/.068)**2+((y-.015)/.060)**2<1; }
export function flightCoverage(x:number,y:number): boolean { return flightBody(x,y) || FLIGHT_WINGS.some(p=>inBirdPolygon(x,y,p)); }
const brown=colorCheckerReflectance('dark skin'), pale=colorCheckerReflectance('neutral 8 (.23 D)'), blue=colorCheckerReflectance('blue sky');
export function flightPigment(x:number,y:number): [number,number,number] {
  const eye=Math.hypot(x-.264,y-.029);
  if(eye<.009) return [.02,0,0];
  if(eye<.014) return [.1,.75,0];
  if(x>.29) return [.24,.04,0];
  if(flightBody(x,y)) {
    const belly=Math.max(0,1-Math.abs(y+.025)/.06), feather=.025*Math.sin(x*210+y*90);
    return [.27+feather,.12+belly*.55,.16+(1-belly)*.25];
  }
  const near=y<0,span=Math.abs(y),angle=Math.atan2(y,x+.02);
  // Rounded coverts near the shoulder give way to dark, radiating flight feathers.
  const seam=(.5+.5*Math.cos(angle*30+span*8))**12;
  const coverts=span<.21 ? .045*Math.cos(x*100)*Math.cos(y*130):0;
  const light=(near?1:.74)*(1-.5*seam)*(1-.45*span);
  return [(.47+coverts)*light,(.20+coverts)*light,.20*light];
}
export function flightReflectance(x:number,y:number): (nm:number)=>number {
  const [a,b,c]=flightPigment(x,y); return nm=>a*brown(nm)+b*pale(nm)+c*blue(nm);
}
