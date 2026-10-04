import type { PieceId } from './store';
import type { CameraPart } from './inspection';
import type { Scenario } from '../engine/types';

export const TOUR: { title: string; text: string; piece: PieceId; part: CameraPart | null; lesson?: 'readout' | 'pipeline' }[] = [
  { title: 'Light from the scene', text: 'Light reflected by a real subject enters the lens. The camera model explains how the selected settings affect that light.', piece: 'camera', part: null },
  { title: 'The lens bends light', text: 'Each surface changes the path of a ray. Drag to look around the glass; different colors bend by different amounts.', piece: 'lens', part: 'glass' },
  { title: 'The aperture sets the opening', text: 'Try the Aperture slider in Controls. A larger f-number narrows the opening: less light, more depth of field, and more diffraction.', piece: 'camera', part: 'iris' },
  { title: 'Focus brings a point together', text: 'Try Focus distance in Controls. A point is sharp when its rays meet at the sensor; other distances form blur disks.', piece: 'cone', part: 'focusRing' },
  { title: 'A pixel collects charge', text: 'A color filter passes part of the spectrum. Some arriving photons generate electrons. More light improves relative shot noise; ISO creates no photons.', piece: 'loupe', part: 'sensor' },
  { title: 'Read the sensor', text: 'Explore row timing and the conversion from charge to a digital number. Scrub the scan, then change the charge or ISO.', piece: 'camera', part: 'sensor', lesson: 'readout' },
  { title: 'Turn raw data into color', text: 'Follow a controlled sensor sample through the color pipeline. This illustrative test sample is separate from your photograph.', piece: 'camera', part: 'sensor', lesson: 'pipeline' },
  { title: 'Explore your photograph', text: 'Open Real photos and choose Play this photo to follow a real photograph through the camera. Your original image stays unchanged; the animations explain how it is captured.', piece: 'camera', part: null },
];

export const PIPELINE = [
  ['raw', 'Bayer mosaic', 'Each site measures one filtered channel in this controlled color-chart sample. Values are black-level corrected and normalized.'],
  ['demosaic', 'Reconstruct color', 'Malvar–He–Cutler demosaicing estimates the two missing channels at each site from neighboring samples.'],
  ['wb', 'White balance', 'Channel gains neutralize the illustrative sample illuminant.'],
  ['ccm', 'Map the colors', 'A color matrix transforms camera channels to linear sRGB. Out-of-gamut values are clipped for this display.'],
  ['tone', 'Encode for your screen', 'The sRGB transfer curve encodes linear light for display.'],
] as const;
export type PipelineStage = typeof PIPELINE[number][0];

export const PIPELINE_GUIDE: Record<PipelineStage,string> = {
  raw: 'In the enlarged sample, each site carries only its filter’s red, green or blue channel. Missing channels are not black objects in a scene.',
  demosaic: 'The same sample now has three color channels per site. The two missing channels are estimated from neighboring samples.',
  wb: 'Watch neutral areas: different channel gains compensate for the illustrative light color.',
  ccm: 'Compare the color patches. A matrix maps the camera’s color responses into the display color space.',
  tone: 'The image brightens as linear-light values receive sRGB display encoding. No extra light has been captured.',
};

/** Turn stored sample buffers into pixels for teaching; intermediate values remain linear and unencoded. */
export function pipelinePixels(sample: { width: number; height: number; raw: Uint16Array; stages: Record<string, Float32Array>; rgba: Uint8ClampedArray; blackLevelDn: number; whiteLevelDn: number }, stage: PipelineStage): Uint8ClampedArray {
  if (stage === 'tone') return sample.rgba.slice();
  const out = new Uint8ClampedArray(sample.width * sample.height * 4);
  for (let i = 0; i < sample.raw.length; i++) {
    if (stage === 'raw') {
      const x = i % sample.width, y = Math.floor(i / sample.width);
      const color = (y % 2 ? (x % 2 ? 'B' : 'G') : (x % 2 ? 'G' : 'R'));
      const channel = color === 'R' ? 0 : color === 'G' ? 1 : 2;
      out[i * 4 + channel] = 255 * Math.max(0, sample.raw[i] - sample.blackLevelDn) / sample.whiteLevelDn;
    } else {
      const values = sample.stages[stage];
      for (let c = 0; c < 3; c++) out[i * 4 + c] = 255 * values[i * 3 + c];
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}

export function rowWindow(row: number, rows: number, scanS: number, exposureS: number) {
  const start = rows <= 1 ? 0 : Math.max(0, Math.min(rows - 1, row)) / (rows - 1) * scanS;
  return { start, end: start + exposureS };
}

export function movingEdgeFraction(position: number, start: number, exposure: number, time: number): number {
  const collected = Math.max(0, Math.min(exposure, time - start));
  return exposure > 0 ? Math.max(0, Math.min(collected, (position - .22) / 4 - start)) / exposure : 0;
}

/** Compare normalized camera settings without tying the real-photo journey to its render lifecycle. */
export function sameShot(a: Scenario, b: Scenario): boolean {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort() as (keyof Scenario)[];
  return keys.every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}
