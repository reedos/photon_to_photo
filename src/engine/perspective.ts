import { imageDistance } from './thinlens';
import { FORMATS } from './formats';

/** Ideal thin-lens perspective study. Units are mm; subject stays focused.
 * Chief-ray projection uses the SAME sensor plane for every object, not each
 * object's conjugate plane. Blur and distortion are intentionally excluded.
 */
export function perspectiveStudy(focalMm:number, dolly:boolean) {
  // One frame for the field and the height share (the engine's own full-frame format, 36 x 24 mm), so the two numbers on the panel
  // can never use different sensor sizes (score loop r5).
  const frameW=FORMATS.ff.w, frameH=FORMATS.ff.h;
  const f=Math.max(20,Math.min(500,focalMm));
  const subjectMm=dolly?f*(1+1/.004):15000;
  const imageMm=imageDistance(subjectMm,f);
  const project=(xMm:number,yMm:number,behindSubjectMm=0)=>({
    x:imageMm*xMm/(subjectMm+behindSubjectMm),
    y:imageMm*yMm/(subjectMm+behindSubjectMm),
  });
  return {focalMm:f,subjectMm,imageMm,project,
    subjectHeightMm:project(0,2000).y,
    backgroundRatio:subjectMm/(subjectMm+20000),
    frameWidthMm:frameW, frameHeightMm:frameH,
    horizontalFovDeg:2*Math.atan(frameW/(2*imageMm))*180/Math.PI};
}
