import type { Scenario } from '../engine/types';
export const SHOT_DURATION = 28;
export const SHOT_STAGES = [
  { start: 0, end: 4, title: 'A bird enters the frame', color: '#ffb14e', text: 'A steady camera. A rigid glide at 6 m/s. The bird reaches the center as the exposure opens.' },
  { start: 4, end: 8, title: 'Glass bends the light', color: '#47cfff', text: 'These paths are traced through this lens design. The moving packets make the paths visible; their travel time is illustrative.' },
  { start: 8, end: 12, title: 'One exposure, one chance', color: '#b69cff', text: 'The opening gates one exposure. Subject displacement comes from speed × shutter time; the final render integrates 16 instants of the rigid glide.' },
  { start: 12, end: 16, title: 'Light becomes charge', color: '#5ce1c6', text: 'An 18% gray, green-filter reference pixel illustrates the photon budget and expected electrons. This is a reference, not a measurement of the bird.' },
  { start: 16, end: 20, title: 'Read the sensor', color: '#5ce1c6', text: 'A schematic row scan carries samples into a raw mosaic. Scan duration and shutter duration are different; rolling skew is not simulated in the photo.' },
  { start: 20, end: 28, title: 'A photograph emerges', color: '#47cfff', text: 'The actual render buffers: Bayer samples → reconstructed color → white balance → color matrix → sRGB for your screen.' },
] as const;
export function shotMoment(seconds: number) {
  const time = Math.max(0, Math.min(SHOT_DURATION, Number.isFinite(seconds) ? seconds : 0));
  const index = SHOT_STAGES.findIndex(s => time < s.end);
  const stage = index < 0 ? SHOT_STAGES.length-1 : index;
  const spec = SHOT_STAGES[stage];
  return { time, stage, progress: Math.min(1, (time-spec.start)/(spec.end-spec.start)) };
}
export function birdShot(slow: boolean): Partial<Scenario> {
  return { lens:'n500', scene:'flight', focusM:20, subjectM:20, fno:5.6, shutter:slow?1/125:1/2000,
    iso:slow?100:1600, lux:10000, cct:5500, format:'ff', sensor:'full-frame-d850', shutterType:'electronic', motion:{speedMps:6} };
}
