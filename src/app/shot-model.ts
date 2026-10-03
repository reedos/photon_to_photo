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
  { start: 0, end: 4, title: 'A bird enters the frame', color: '#ffb14e', text: 'Light reflected by a bird moving at 6 m/s enters a still camera.', note: 'Light reflected by the moving bird enters the lens. The bird glides at 6 m/s while the camera stays still. Representative light paths and expanded space and time make the journey visible.' },
  { start: 4, end: 8, title: 'Glass bends the light', color: '#47cfff', text: 'The lens surfaces work together to focus light into an image.', note: 'The lens surfaces work together to focus light into an image. These paths are traced through this lens design; moving packets illustrate the route, not light’s actual travel time.' },
  { start: 8, end: 12, title: 'One exposure, one chance', color: '#b69cff', text: 'A longer exposure gathers more light—and more motion blur.', note: 'A longer exposure gathers more light, but the bird moves farther and blurs more. Travel = speed × shutter time. The slower capture uses 16× exposure and 1/16 ISO: similar brightness, more photons and motion blur. The gate shows one row’s electronic timing, not a physical curtain.' },
  { start: 12, end: 16, title: 'Light becomes charge', color: '#5ce1c6', text: 'Absorbed light can generate electrons, building charge in a pixel.', note: 'Absorbed photons can generate electrons, filling a pixel’s charge well. This computed fill represents an 18% gray, green-filter reference, not the bird. Light and charge markers have separate illustrative weights; the cloud is schematic.' },
  { start: 16, end: 20, title: 'Read the sensor', color: '#b69cff', text: 'Rows of charge become digital numbers: the camera’s RAW data.', note: 'The sensor converts charge into digital numbers. These are actual raw samples and codes; mosaic brightness is lifted 4× for visibility. Routes are schematic, and the final photo does not simulate rolling skew.' },
  { start: 20, end: 28, title: 'A photograph emerges', color: '#b69cff', text: 'Processing turns raw samples into a full-color photograph.', note: 'Processing reconstructs full color, adjusts white balance, and prepares the image for your screen. The wipe reveals actual processing buffers in order, not processor timing. The final photo is unchanged.' },
] as const;
export function shotMoment(seconds: number, stopAt = SHOT_DURATION) {
  const time = Math.max(0, Math.min(SHOT_DURATION, Number.isFinite(seconds) ? seconds : 0));
  const index = SHOT_STAGES.findIndex(s => time < s.end || (time === stopAt && time === s.end));
  const stage = index < 0 ? SHOT_STAGES.length-1 : index;
  const spec = SHOT_STAGES[stage];
  return { time, stage, progress: Math.min(1, (time-spec.start)/(spec.end-spec.start)) };
}
export function birdShot(slow: boolean): Partial<Scenario> {
  return { lens:'n500', scene:'flight', focusM:20, subjectM:20, fno:5.6, shutter:slow?1/125:1/2000,
    iso:slow?100:1600, lux:10000, cct:5500, format:'ff', sensor:'full-frame-d850', shutterType:'electronic', motion:{speedMps:6} };
}
