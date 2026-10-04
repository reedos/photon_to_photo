import type { Example } from './examples';
import type { Model } from '../engine/model-types';
import type { Scenario } from '../engine/types';
import { SHOT_STAGES } from './shot-model';
import { fmtFno, fmtShutter } from './units';
import { CURTAIN_TRANSIT_S, type CaptureMechanism } from './shot-capture';

export const photoShotFootnote = 'Your supplied JPEG stays unchanged. Recorded settings guide a representative lens model; shutter mechanisms, sensor structure, light packets, charge and readout are explanatory illustrations. The moving highlight guides the handoff between representations; it is not one measured photon or electron. Camera moves, pixel locations and expanded timing are editorial, not physical magnification or transit times. No original RAW data, shutter type, scene brightness, motion speed or camera body is inferred.';

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

export function photoShotStages(ex: Example, mechanism: CaptureMechanism = 'mechanical') {
  const focus = ex.focusM == null ? 'The focus distance is not recorded.' : `The camera recorded focus at about ${ex.focusM} m, in coarse steps.`;
  const items = [
    { title: 'A real moment, your photograph', text: 'Light reflected by this scene entered the camera.', note: `${ex.title}. The supplied photograph stays fixed; animated light paths illustrate reflected light. Subject markers are editorial details, not recorded autofocus points. ${focus}` },
    { title: 'Bring the subject into focus', text: 'The lens brings focused light together. Other distances spread into blur.', note: `${focus} Rays are computed through the associated representative lens design, not a recovered optical path from the JPEG. The model may clamp the recorded aperture to its supported limit.` },
    { title: 'A brief window for light', text: mechanism==='mechanical'?`Mechanical illustration: two curtains give each row ${fmtShutter(ex.shutter)} of exposure.`:`Electronic illustration: reset and readout bands give each row ${fmtShutter(ex.shutter)} of exposure.`, note: `Shutter type was not recorded. The mechanical example uses the body model’s representative ${CURTAIN_TRANSIT_S*1000} ms curtain transit; the electronic example uses the same illustrative row transit for comparison, not a measured scan time. The recorded exposure interval determines the gap between the two fronts. Short exposures form a traveling slit; the return to preview is an illustrative reset, not another capture. The supplied JPEG stands in for the upright sensor image. Subject motion is not reconstructed.` },
    { title: 'Light becomes an electrical signal', text: 'Absorbed light can release electrons, building charge in a sensor pixel.', note: 'This is a generic color-filter pixel. Relative color attenuation is illustrative, not a measured filter spectrum. The charge level and packets are schematic, not measured electrons from this photograph. The JPEG does not provide the original scene light level, sensor identity or pixel charge.' },
    { title: 'Data builds the photograph', text: 'Readout feeds image processing. Rows of your photograph appear as data arrives.', note: 'Illustrated reconstruction: the displayed color samples come from the supplied JPEG, not this photograph’s RAW samples. ADC conversion and the following color processing are schematic. The scanning row and building image share one clock to explain the connection, not actual sensor or processor timing. Original RAW, sensor layout and bit depth are unavailable.' },
    { title: 'Your photograph, the result', text: photoTakeaway(ex), note: 'This is the existing finished JPEG, expanded from the readout illustration without changing its pixels. The detail inset is a crop of that same file. Its original RAW, editing decisions and processing buffers are unavailable; the illustration does not reconstruct them.' },
  ];
  return SHOT_STAGES.map((stage, i) => ({ ...stage, ...items[i] }));
}

export function photoShotStats(ex: Example, model: Model, stage: number): [string, string][] {
  // Only recorded metadata appears as a capture measurement. No model sensor/light
  // defaults are presented as observations of this photograph.
  void model; void stage;
  return [[fmtFno(ex.fno), 'recorded aperture'], [fmtShutter(ex.shutter), 'recorded shutter'],
    [`ISO ${ex.iso}`, 'recorded ISO'], [ex.focusM == null ? 'Unknown' : `≈ ${ex.focusM} m`, 'recorded focus']];
}

export function photoSubject(ex: Example): { x: number; y: number } {
  return ({
    flycatcher: { x: .474, y: .467 }, mallard: { x: .50, y: .585 }, chipmunk: { x: .579, y: .416 },
    squirrel: { x: .294, y: .480 }, 'sheep-village': { x: .380, y: .575 }, 'sheep-larches': { x: .465, y: .462 },
  } as Record<string, { x: number; y: number }>)[ex.id] ?? { x: .5, y: .5 };
}
