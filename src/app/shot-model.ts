import type { Scenario } from '../engine/types';
export const SHOT_DURATION = 28;
export const SHOT_TRACKS = {
  all:{label:'All processes',start:0,end:28,color:'#ffb14e'},
  light:{label:'Light',start:0,end:12,color:'#47cfff'},
  charge:{label:'Pixel (charge)',start:12,end:16,color:'#5ce1c6'},
  data:{label:'Image data',start:16,end:28,color:'#b69cff'},
} as const;
export type ShotTrack=keyof typeof SHOT_TRACKS;
/** `beat`: where a chapter button lands, the moment that chapter's picture explains itself (the slit crossing the
 *  frame, the well filling), clear of the handoff around its start (score loop r1: a chapter landed on a cross-fade
 *  whose picture did not match its caption). */
export const SHOT_STAGES = [
  { start:0,end:4,title:'A real moment',color:'#ffb14e',text:'Follow light from a real photograph.',note:'The original photograph is a scene reference.',beat:0 },
  { start:4,end:8,title:'Bring light into focus',color:'#47cfff',text:'Lens surfaces focus light.',note:'Representative lens model; computed rays.',beat:5 },
  { start:8,end:12,title:'A brief exposure',color:'#b69cff',text:'Each sensor row receives a timed exposure.',note:'Shutter mechanisms are illustrative; recorded exposure interval retained.',beat:9.8 },
  { start:12,end:16,title:'Light becomes charge',color:'#5ce1c6',text:'Absorbed light can generate electrons.',note:'Schematic sensor illustration, not measured charge.',beat:15 },
  { start:16,end:20,title:'Data builds the photograph',color:'#b69cff',text:'Readout feeds processing as rows of the photo appear.',note:'Illustrated reconstruction, not recovered RAW.',beat:18 },
  { start:20,end:28,title:'The photograph',color:'#b69cff',text:'See the finished original photograph.',note:'The original JPEG remains unchanged.',beat:23 },
] as const;
/** A caption is on screen for at least its length in words divided by this, in seconds, at 1x (score loop r5: the
 *  70-word caption of the focus chapter was up for 3.9 s). 3 words a second is a slow, comfortable read. */
export const READ_WORDS_PER_SECOND = 3;
/** How long chapter `stage` stays on screen at 1x: its own timeline span, or the time to read its caption if longer. */
export function chapterDwellSeconds(stage: number, words: number): number {
  const span = SHOT_STAGES[stage].end - SHOT_STAGES[stage].start;
  return Math.max(span, words / READ_WORDS_PER_SECOND);
}
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
