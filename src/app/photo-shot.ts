import type { Example } from './examples';
import type { Model } from '../engine/model-types';
import type { Scenario } from '../engine/types';
import { SHOT_STAGES } from './shot-model';
import { fmtFno, fmtShutter } from './units';
import { CURTAIN_TRANSIT_S, type CaptureMechanism } from './shot-capture';

export const photoShotFootnote = 'The original JPEG stays unchanged. Recorded settings guide a representative lens model; shutter mechanisms, sensor structure, light packets, charge and readout are explanatory illustrations. The moving highlight guides the handoff between representations; it is not one measured photon or electron. Camera moves, pixel locations and expanded timing are editorial, not physical magnification or transit times. Camera and lens names come from the photo’s own metadata. No original RAW data, shutter type, scene brightness or motion speed is inferred.';

/** An isolated optical illustration, never a reconstruction of the photographed scene. */
export function photoShotScenario(ex: Example): Partial<Scenario> {
  return { lens: ex.lens, fno: ex.fno, shutter: ex.shutter, iso: ex.iso,
    focusM: ex.focusM ?? 10, subjectM: ex.focusM ?? 10, scene: 'bench',
    format: 'ff', lux: 10000, cct: 5500, motion: { speedMps: 0 } };
}

export function photoTakeaway(ex: Example): string {
  return ex.note;
}

/** An exposure time in words a reader can picture: "0.25 ms" for 1/4000 s, "8 ms" for 1/125 s. */
function msText(seconds: number): string {
  const ms = seconds * 1000;
  return ms >= 1000 ? `${Number((ms / 1000).toPrecision(2))} s` : `${Number(ms.toPrecision(2))} ms`;
}

/** Why this photo's ISO matters, from its recorded values only (score loop r3: ISO appeared everywhere but its
 *  trade-off was never told). Above ISO 400 the short exposure and the gain are tied together. */
export function isoSentence(ex: Example): string {
  // a base-ISO photo is not "amplified afterward" in any way worth telling (score loop r5); ISO never adds light
  if (ex.iso <= 200) return `ISO ${ex.iso} is a low gain: it amplifies the signal only a little, and ISO adds no light.`;
  if (ex.iso <= 400) return `ISO ${ex.iso} amplifies that signal afterward; ISO adds no light.`;
  // a stated reference instead of "a slow shutter" (score loop r6): the photons collected grow in step with the time open
  const ratio = REFERENCE_SHUTTER_S / ex.shutter;
  if (ratio < 1.5) return `${msText(ex.shutter)} of light at ${fmtFno(ex.fno)} is a long window, so it collects more photons and its noise stays lower; ISO ${ex.iso} brightens the image afterward and amplifies that noise with it. ISO adds no light.`;
  return `Only ${msText(ex.shutter)} of light at ${fmtFno(ex.fno)} collects about ${ratio >= 10 ? Math.round(ratio) : Number(ratio.toFixed(1))} times fewer photons than 1/125 s would; ISO ${ex.iso} brightens the image afterward and amplifies their noise with it. ISO adds no light.`;
}

/** The shutter the ISO sentence compares against: 1/125 s, a common handheld speed. */
const REFERENCE_SHUTTER_S = 1 / 125;

/** How wide the aperture's opening is, from the recorded focal length and f-number (the photo's own metadata; the same
 *  focal length ÷ f-number the story page uses). Empty when the focal length was not recorded. */
export function openingWidthMm(ex: Example): number | null {
  return ex.focalLengthMm && ex.fno ? ex.focalLengthMm / ex.fno : null;
}

/** The aperture's own sentence for the exposure chapter (score loop r6: the aperture was never explained there). */
export function apertureSentence(ex: Example): string {
  const width = openingWidthMm(ex);
  if (width === null) return `The aperture is the opening that lets light in; ${fmtFno(ex.fno)} sets how wide it is.`;
  return `The aperture is the opening that lets light in: ${fmtFno(ex.fno)} on a ${ex.focalLengthMm} mm lens makes it about ${Math.round(width)} mm wide.`;
}

/** A unit stays on the line with its number in a caption ("1/4000 s" never breaks after "1/4000"). */
export function keepUnits(text: string): string {
  return text.replace(/(\d) (s|ms|m|mm)(?![\w/])/g, '$1\u00a0$2');
}

/** The closing line of the last chapter: the chain the whole player walked (score loop r5). */
export const SHOT_RECAP = 'Photons, glass, charge, numbers, color: that chain made this photo.';

export function photoShotStages(ex: Example, mechanism: CaptureMechanism = 'mechanical') {
  const focus = ex.focusM == null ? 'The focus distance is not recorded; the optical illustration assumes 10 m.' : `The camera recorded focus at about ${ex.focusM} m, in coarse steps.`;
  const items = [
    { title: 'A real moment, a real photograph', text: `Photons, tiny packets of light, reflected by this scene entered the camera. Its file records ${fmtFno(ex.fno)}, ${fmtShutter(ex.shutter)} and ISO ${ex.iso}; the chapters follow how each setting shaped the photo.`, note: `${ex.title}. The supplied photograph stays fixed; animated light paths illustrate reflected light. Subject markers are editorial details, not recorded autofocus points. ${focus}` },
    { title: 'Bring the subject into focus', text: `The lens focuses light from ${ex.focusM == null ? 'an assumed focus distance' : 'one distance'} onto the sensor, through the amber iris’s opening. Faint violet rays start at half that distance, would meet behind the sensor, and so land as a blur disk, enlarged beside it.${ex.modelMatch === false ? ' The lens in this photo is not modeled, so this shows a generic design.' : ''}`, note: `This photo was taken at ${fmtFno(ex.fno)}; a smaller f-number means a wider opening and a shallower sharp zone. ${ex.modelMatch === false ? 'The recorded 160 mm Canon lens is not modeled. This diagram uses a 50 mm reference lens to explain refraction, not the optics of this photograph. ' : ''}${focus} Rays are computed through the associated representative lens design, not a recovered optical path from the JPEG. The model may clamp the recorded aperture to its supported limit.` },
    { title: 'How much light, for how long', text: `${apertureSentence(ex)} The shutter sets how long it stays open. `+(mechanism==='mechanical'?`In this mechanical illustration two curtains give each row ${fmtShutter(ex.shutter)}`:`In this electronic illustration reset and readout bands give each row ${fmtShutter(ex.shutter)}`)+` (${msText(ex.shutter)}), so each row saw light for only that long.`, note: `Shutter type was not recorded. The mechanical example uses the body model’s representative ${CURTAIN_TRANSIT_S*1000} ms curtain transit; the electronic example uses the same illustrative row transit for comparison, not a measured scan time. The recorded exposure interval determines the gap between the two fronts. Short exposures form a traveling slit; the return to preview is an illustrative reset, not another capture. The supplied JPEG stands in for the upright sensor image. Subject motion is not reconstructed.` },
    { title: 'Light becomes an electrical signal', text: `Absorbed light can release electrons, building charge in the pixel’s photodiode. ${isoSentence(ex)}`, note: 'This is a generic color-filter pixel. Relative color attenuation is illustrative, not a measured filter spectrum. The charge level and packets are schematic, not measured electrons from this photograph. The JPEG does not provide the original scene light level, per-pixel sensor data or pixel charge.' },
    { title: 'Data builds the photograph', text: 'An analog-to-digital converter (ADC) turns each pixel’s charge into a number. The camera then estimates the two missing colors at each pixel (demosaicing), balances the light’s color (white balance) and encodes the result as this JPEG.', note: 'Illustrated reconstruction: the displayed color samples come from the supplied JPEG, not this photograph’s RAW samples. ADC conversion and the following color processing are schematic. The scanning row and building image share one clock to explain the connection, not actual sensor or processor timing. Original RAW, sensor layout and bit depth are unavailable.' },
    { title: 'The result: this photograph', text: `${photoTakeaway(ex)} ${SHOT_RECAP}`, note: 'This is the existing finished JPEG, expanded from the readout illustration without changing its pixels. The detail inset is a crop of that same file. Its original RAW, editing decisions and processing buffers are unavailable; the illustration does not reconstruct them.' },
  ];
  return SHOT_STAGES.map((stage, i) => ({ ...stage, ...items[i], text: keepUnits(items[i].text) }));
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
