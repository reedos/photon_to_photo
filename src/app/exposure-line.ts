// The one plain-language line under the Camera sliders (score loop r6): what the aperture, shutter and ISO settings do to
// the light and the noise, computed from the same exposure numbers the readouts use. The exposure triangle used to be
// delivered only by a collapsed disclosure or by switching to the Pixel level; changing a slider changed a number and
// nothing a reader could read as a consequence.
import type { Scenario } from '../engine/types';
import { fmtFno, fmtShutter } from './units';

type Settings = Pick<Scenario, 'fno' | 'shutter' | 'iso'>;

/** "32×", "1.5×" or "3×": two significant digits at most, so a third-stop step does not read as false precision. */
export function timesText(ratio: number): string {
  const r = ratio >= 1 ? ratio : 1 / ratio;
  const text = r >= 10 ? String(Math.round(r)) : String(Number(r.toFixed(1)));
  return `${text}×`;
}

/** Light collected per pixel grows with the time open and falls with the square of the f-number. */
export function lightRatio(now: Settings, base: Settings): number {
  return (now.shutter / base.shutter) * (base.fno / now.fno) ** 2;
}

/** One or two sentences about what these settings do compared with the lens's default exposure `base`.
 *  Pure, so a unit test can check each case without a browser. */
export function exposureLine(now: Settings, base: Settings): string {
  const light = lightRatio(now, base);
  const sameLight = Math.abs(Math.log2(light)) < 0.15;
  const shutterMoved = Math.abs(Math.log2(now.shutter / base.shutter)) >= 0.15;
  const apertureMoved = Math.abs(Math.log2(now.fno / base.fno)) >= 0.1;
  const more = light > 1;
  let first: string;
  if (sameLight && !shutterMoved && !apertureMoved) first = `Light per pixel is the same as the lens’s default (${fmtFno(base.fno)}, ${fmtShutter(base.shutter)}).`;
  else if (sameLight) first = `${fmtFno(now.fno)} at ${fmtShutter(now.shutter)} collects the same light as ${fmtFno(base.fno)} at ${fmtShutter(base.shutter)}: the two changes cancel.`;
  else if (shutterMoved && !apertureMoved) first = `${fmtShutter(now.shutter)} collects ${timesText(light)} ${more ? 'more' : 'fewer'} photons than ${fmtShutter(base.shutter)}.`;
  else if (apertureMoved && !shutterMoved) first = `${fmtFno(now.fno)} lets in ${timesText(light)} ${more ? 'more' : 'less'} light than ${fmtFno(base.fno)}.`;
  else first = `${fmtFno(now.fno)} at ${fmtShutter(now.shutter)} collects ${timesText(light)} ${more ? 'more' : 'fewer'} photons than ${fmtFno(base.fno)} at ${fmtShutter(base.shutter)}.`;
  const gain = now.iso / base.iso;
  let second = '';
  if (gain >= 1.9) second = ` ISO ${Math.round(now.iso).toLocaleString('en-US')} brightens the result afterward; it adds no light, so the noise shows more.`;
  else if (gain <= 1 / 1.9) second = ` ISO ${Math.round(now.iso).toLocaleString('en-US')} brightens less, which keeps the noise quieter; it adds no light.`;
  return first + second;
}
