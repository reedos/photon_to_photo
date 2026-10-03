import type { Example } from './examples';
import type { Model } from '../engine/model-types';
import type { Scenario } from '../engine/types';
import { SHOT_STAGES } from './shot-model';
import { fmtFno, fmtShutter } from './units';

export const photoShotFootnote = 'Your supplied JPEG stays unchanged. Recorded settings guide a representative lens model; sensor structure, light packets, charge and readout are explanatory illustrations. No original RAW data, scene brightness, motion speed or camera body is inferred.';

/** An isolated optical illustration, never a reconstruction of the photographed scene. */
export function photoShotScenario(ex: Example): Partial<Scenario> {
  return { lens: ex.lens, fno: ex.fno, shutter: ex.shutter, iso: ex.iso,
    focusM: ex.focusM, subjectM: ex.focusM ?? undefined, scene: 'bench',
    format: 'ff', lux: 10000, cct: 5500, motion: { speedMps: 0 } };
}

export function photoTakeaway(ex: Example): string {
  return ({
    flycatcher: 'Focus helps separate the bird from its background: points at different distances form different-sized spots on the sensor.',
    mallard: 'Focus is a distance, not an object: ducks and water at similar distances can be sharp together.',
    chipmunk: 'A detailed subject can sit against a smooth background when that background is far beyond the focus distance.',
    squirrel: 'Close focus makes the sharp region especially thin. Small differences in distance can change which details stay crisp.',
    'sheep-village': 'A softer background can still tell the story of a place. Blur is a gradual change, not an on/off switch.',
    'sheep-larches': 'Nearer does not always mean sharper. Foreground sheep can fall outside the distance range in focus.',
  } as Record<string, string>)[ex.id] ?? 'The recorded settings connect a choice at the camera to the photograph you see.';
}

export function photoShotStages(ex: Example) {
  const focus = ex.focusM == null ? 'The focus distance is not recorded.' : `The camera recorded focus at about ${ex.focusM} m, in coarse steps.`;
  const items = [
    { title: 'A real moment, your photograph', text: 'Light reflected by this scene entered the camera.', note: `${ex.title}. The supplied photograph stays fixed; animated light paths illustrate reflected light. Subject markers are editorial details, not recorded autofocus points. ${focus}` },
    { title: 'Bring the subject into focus', text: 'The lens brings focused light together. Other distances spread into blur.', note: `${focus} Rays are computed through the associated representative lens design, not a recovered optical path from the JPEG. The model may clamp the recorded aperture to its supported limit.` },
    { title: 'A brief window for light', text: `${fmtShutter(ex.shutter)} at ${fmtFno(ex.fno)}: the recorded exposure interval lets light build a signal.`, note: 'The timing gate illustrates a pixel’s exposure interval, not an identified shutter mechanism. Subject speed and scene brightness are unknown; the photo is not moved or blurred to invent them. ISO controls signal amplification/processing, not the number of arriving photons.' },
    { title: 'Light becomes an electrical signal', text: 'Absorbed light can release electrons, building charge in a sensor pixel.', note: 'This is a generic color-filter pixel. The charge level and packets are schematic, not measured electrons from this photograph. The JPEG does not provide the original scene light level, sensor identity or pixel charge.' },
    { title: 'The sensor passes on numbers', text: 'The camera converts sensor signals into digital measurements for image processing.', note: 'The mosaic, scanning row and data packets illustrate the mechanism. They are not this photograph’s RAW samples, sensor layout, bit depth or measured readout timing.' },
    { title: 'Your photograph, the result', text: photoTakeaway(ex), note: 'This is the existing finished JPEG, revealed without changing its pixels. The detail inset is a crop of that same file. Its original RAW, editing decisions and processing buffers are unavailable; the reveal does not reconstruct them.' },
  ];
  return SHOT_STAGES.map((stage, i) => ({ ...stage, ...items[i] }));
}

export function photoShotStats(ex: Example, model: Model, stage: number): [string, string][] {
  // Only recorded metadata appears as a capture measurement. No model sensor/light
  // defaults are presented as observations of this photograph.
  void model; void stage;
  return [[fmtFno(ex.fno), 'recorded aperture'], [fmtShutter(ex.shutter), 'recorded shutter'],
    [`ISO ${ex.iso}`, 'recorded sensitivity'], [ex.focusM == null ? 'Unknown' : `≈ ${ex.focusM} m`, 'recorded focus']];
}

export function photoSubject(ex: Example): { x: number; y: number } {
  return ({
    flycatcher: { x: .474, y: .467 }, mallard: { x: .50, y: .585 }, chipmunk: { x: .579, y: .416 },
    squirrel: { x: .294, y: .480 }, 'sheep-village': { x: .380, y: .575 }, 'sheep-larches': { x: .465, y: .462 },
  } as Record<string, { x: number; y: number }>)[ex.id] ?? { x: .5, y: .5 };
}
