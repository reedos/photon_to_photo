import type { Example } from './examples';
import type { Model } from '../engine/model-types';
import type { Scenario } from '../engine/types';
import { SHOT_STAGES } from './shot-model';
import { fmtFno, fmtShutter } from './units';
import { CURTAIN_TRANSIT_S, type CaptureMechanism } from './shot-capture';

export const photoShotFootnote = 'Your supplied JPEG stays unchanged. Recorded settings guide a representative lens model; shutter mechanisms, sensor structure, light packets, charge and readout are explanatory illustrations. The moving highlight guides the handoff between representations; it is not one measured photon or electron. Camera moves, pixel locations and expanded timing are editorial, not physical magnification or transit times. Camera and lens names come from supplied metadata. No original RAW data, shutter type, scene brightness or motion speed is inferred.';

/** An isolated optical illustration, never a reconstruction of the photographed scene. */
export function photoShotScenario(ex: Example): Partial<Scenario> {
  return { lens: ex.lens, fno: ex.fno, shutter: ex.shutter, iso: ex.iso,
    focusM: ex.focusM ?? 10, subjectM: ex.focusM ?? 10, scene: 'bench',
    format: 'ff', lux: 10000, cct: 5500, motion: { speedMps: 0 } };
}

export function photoTakeaway(ex: Example): string {
  return ex.note;
}

export function photoShotStages(ex: Example, mechanism: CaptureMechanism = 'mechanical') {
  const focus = ex.focusM == null ? 'The focus distance is not recorded; the optical illustration assumes 10 m.' : `The camera recorded focus at about ${ex.focusM} m, in coarse steps.`;
  const items = [
    { title: 'A real moment, your photograph', text: 'Light reflected by this scene entered the camera.', note: `${ex.title}. The supplied photograph stays fixed; animated light paths illustrate reflected light. Subject markers are editorial details, not recorded autofocus points. ${focus}` },
    { title: 'Bring the subject into focus', text: 'The lens brings focused light together. Other distances spread into blur.', note: `${ex.modelMatch === false ? 'The recorded 160 mm Canon lens is not modeled. This diagram uses a 50 mm reference lens to explain refraction, not the optics of this photograph. ' : ''}${focus} Rays are computed through the associated representative lens design, not a recovered optical path from the JPEG. The model may clamp the recorded aperture to its supported limit.` },
    { title: 'A brief window for light', text: mechanism==='mechanical'?`Mechanical illustration: two curtains give each row ${fmtShutter(ex.shutter)} of exposure.`:`Electronic illustration: reset and readout bands give each row ${fmtShutter(ex.shutter)} of exposure.`, note: `Shutter type was not recorded. The mechanical example uses the body model’s representative ${CURTAIN_TRANSIT_S*1000} ms curtain transit; the electronic example uses the same illustrative row transit for comparison, not a measured scan time. The recorded exposure interval determines the gap between the two fronts. Short exposures form a traveling slit; the return to preview is an illustrative reset, not another capture. The supplied JPEG stands in for the upright sensor image. Subject motion is not reconstructed.` },
    { title: 'Light becomes an electrical signal', text: 'Absorbed light can release electrons, building charge in a sensor pixel.', note: 'This is a generic color-filter pixel. Relative color attenuation is illustrative, not a measured filter spectrum. The charge level and packets are schematic, not measured electrons from this photograph. The JPEG does not provide the original scene light level, per-pixel sensor data or pixel charge.' },
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
  return ex.subject ?? { x: .5, y: .5 };
}
