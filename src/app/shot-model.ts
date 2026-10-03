import type { Scenario } from '../engine/types';
export const SHOT_DURATION = 28;
export const SHOT_TRACKS = {
  all:{label:'All processes',start:0,end:28,color:'#ffb14e'},
  light:{label:'Light',start:0,end:12,color:'#47cfff'},
  charge:{label:'Charge',start:12,end:16,color:'#5ce1c6'},
  data:{label:'Image data',start:16,end:28,color:'#b69cff'},
} as const;
export type ShotTrack=keyof typeof SHOT_TRACKS;
export const SHOT_STAGES = [
  { start:0,end:4,title:'A real moment',color:'#ffb14e',text:'Follow light from your photograph.',note:'The supplied photograph is a scene reference.' },
  { start:4,end:8,title:'Bring light into focus',color:'#47cfff',text:'Lens surfaces focus light.',note:'Representative lens model; computed rays.' },
  { start:8,end:12,title:'A brief exposure',color:'#b69cff',text:'Each sensor row receives a timed exposure.',note:'Shutter mechanisms are illustrative; recorded exposure interval retained.' },
  { start:12,end:16,title:'Light becomes charge',color:'#5ce1c6',text:'Absorbed light can generate electrons.',note:'Schematic sensor illustration, not measured charge.' },
  { start:16,end:20,title:'Data builds the photograph',color:'#b69cff',text:'Readout feeds processing as rows of the photo appear.',note:'Illustrated reconstruction, not recovered RAW.' },
  { start:20,end:28,title:'Your photograph',color:'#b69cff',text:'See the finished supplied photograph.',note:'The supplied JPEG remains unchanged.' },
] as const;
export function shotMoment(seconds: number, stopAt = SHOT_DURATION) {
  const time = Math.max(0, Math.min(SHOT_DURATION, Number.isFinite(seconds) ? seconds : 0));
  const index = SHOT_STAGES.findIndex(s => time < s.end || (time === stopAt && time === s.end));
  const stage = index < 0 ? SHOT_STAGES.length-1 : index;
  const spec = SHOT_STAGES[stage];
  return { time, stage, progress: Math.min(1, (time-spec.start)/(spec.end-spec.start)) };
}
/** Synthetic engine regression fixture; not a Play the shot source. */
export function birdShot(slow: boolean): Partial<Scenario> {
  return { lens:'n500', scene:'flight', focusM:20, subjectM:20, fno:5.6, shutter:slow?1/125:1/2000,
    iso:slow?100:1600, lux:10000, cct:5500, format:'ff', sensor:'full-frame-d850', shutterType:'electronic', motion:{speedMps:6} };
}
