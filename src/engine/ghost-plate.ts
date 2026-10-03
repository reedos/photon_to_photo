// Representative lossless plane-parallel plate, not a production-lens flare model.
// Single-film amplitudes: MIT 6.974, section 2.3 (scattering/transfer matrices):
// https://ocw.mit.edu/courses/6-974-fundamentals-of-photonics-quantum-electronics-spring-2006/98fcc94d2216c26db424e294c28d459a_mirror_inter_thn.pdf
// Coherence is retained inside each thin film; distinct millimetre plate passes
// are added as powers (mutually incoherent), not as a Fabry–Perot etalon.
import { reflect, refract } from './surface';
import type { Vec3 } from './types';

export type Polarization = 's' | 'p';
export interface PlateSettings { angleDeg:number; nm:number; thicknessMm:number; coated:boolean; filmNm:number }
export const PLATE_INDEX=1.5, FILM_INDEX=1.38;

/** q = n sin(theta), conserved tangential wavevector; all media are lossless.
 * Domain is propagating incidence in every medium (this plate uses air q < 1).
 * R is exact for one film, including all coherent internal film reflections. */
export function filmReflectance(n0:number, nf:number, ns:number, thicknessNm:number, nm:number, q:number, polarization:Polarization) {
  if (![n0,nf,ns,nm].every(v=>Number.isFinite(v)&&v>0) || !Number.isFinite(thicknessNm) || thicknessNm<0 || !Number.isFinite(q) || Math.abs(q)>=Math.min(n0,nf,ns)) throw new RangeError('Propagating, positive lossless film parameters required');
  const cos=(n:number)=>Math.sqrt(1-(q/n)**2);
  const adm=(n:number)=>polarization==='s'?n*cos(n):n/cos(n);
  const a=(adm(n0)-adm(nf))/(adm(n0)+adm(nf)), b=(adm(nf)-adm(ns))/(adm(nf)+adm(ns));
  const phase=4*Math.PI*nf*thicknessNm*cos(nf)/nm, cross=2*a*b*Math.cos(phase);
  const R=(a*a+b*b+cross)/(1+(a*b)**2+cross);
  return Math.max(0,Math.min(1,R));
}

export function platePowers(s:PlateSettings) {
  const q=Math.sin(s.angleDeg*Math.PI/180), thickness=s.coated?s.filmNm:0;
  const channels=(['s','p'] as const).map(pol=>{
    const R=filmReflectance(1,FILM_INDEX,PLATE_INDEX,thickness,s.nm,q,pol);
    const reverse=filmReflectance(PLATE_INDEX,FILM_INDEX,1,thickness,s.nm,q,pol);
    const primary=(1-R)*(1-reverse), ghost=primary*reverse*reverse;
    return {polarization:pol,R,reverse,primary,ghost};
  });
  return {reflectance:(channels[0].R+channels[1].R)/2,primary:(channels[0].primary+channels[1].primary)/2,ghost:(channels[0].ghost+channels[1].ghost)/2,channels};
}

export function ghostPlate(s:PlateSettings) {
  if (!Number.isFinite(s.angleDeg)||s.angleDeg<0||s.angleDeg>65||!Number.isFinite(s.thicknessMm)||s.thicknessMm<=0) throw new RangeError('Plate angle 0–65 degrees and positive thickness required');
  const a=s.angleDeg*Math.PI/180, incoming:Vec3=[Math.sin(a),0,Math.cos(a)], normal:Vec3=[0,0,1];
  const inside=refract(incoming,normal,1,PLATE_INDEX)!;
  const hit=(p:Vec3,d:Vec3,z:number):Vec3=>{const t=(z-p[2])/d[2];return [p[0]+t*d[0],0,z];};
  const entry:Vec3=[0,0,0], start=hit(entry,incoming,-5), back=hit(entry,inside,s.thicknessMm);
  const outgoing=refract(inside,normal,PLATE_INDEX,1)!;
  const primaryEnd=hit(back,outgoing,s.thicknessMm+5);
  const returning=reflect(inside,normal), front=hit(back,returning,0), forward=reflect(returning,normal);
  const ghostBack=hit(front,forward,s.thicknessMm), ghostEnd=hit(ghostBack,outgoing,s.thicknessMm+5);
  return {...platePowers(s),settings:{...s},primaryPath:[start,entry,back,primaryEnd],ghostPath:[start,entry,back,front,ghostBack,ghostEnd],separationMm:ghostEnd[0]-primaryEnd[0],glassAngleDeg:Math.atan2(inside[0],inside[2])*180/Math.PI};
}
