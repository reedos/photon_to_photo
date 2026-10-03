import type { RenderView } from './render-client';
import type { Scenario } from '../engine/types';
import type { PieceId } from './store';
import type { CameraPart } from './inspection';
import { sensorFor } from '../engine/data';
import { cfaColorAt } from '../engine/pipeline';

export const TOUR: { title: string; text: string; piece: PieceId; part: CameraPart | null; lesson?: 'readout' | 'pipeline' }[] = [
  { title: 'Light from the scene', text: 'Light reflected by the scene enters the lens. Your photo follows the same settings throughout this journey.', piece: 'camera', part: null },
  { title: 'The lens bends light', text: 'Each surface changes the path of a ray. Drag to look around the glass; different colors bend by different amounts.', piece: 'lens', part: 'glass' },
  { title: 'The aperture sets the opening', text: 'Try the Aperture slider in Controls. A larger f-number narrows the opening: less light, more depth of field, and more diffraction.', piece: 'camera', part: 'iris' },
  { title: 'Focus brings a point together', text: 'Try Focus distance in Controls. A point is sharp when its rays meet at the sensor; other distances form blur disks.', piece: 'cone', part: 'focusRing' },
  { title: 'A pixel collects charge', text: 'A color filter passes part of the spectrum. Some arriving photons generate electrons. More light improves relative shot noise; ISO creates no photons.', piece: 'loupe', part: 'sensor' },
  { title: 'Read the sensor', text: 'Explore row timing and the conversion from charge to a digital number. Scrub the scan, then change the charge or ISO.', piece: 'camera', part: 'sensor', lesson: 'readout' },
  { title: 'Turn raw data into color', text: 'Step through the actual buffers used to make your photo. The raw mosaic has one color sample at each site; the pipeline reconstructs the image.', piece: 'camera', part: 'sensor', lesson: 'pipeline' },
  { title: 'Make the photo yours', text: 'Pin a photo, change a setting, and compare. Try the three experiments to explore background blur, motion, and low-light noise.', piece: 'camera', part: null },
];

export const PIPELINE = [
  ['raw', 'Bayer mosaic', 'Each site measures one filtered channel. These are block-averaged RGGB samples, tinted by filter color and normalized after black-level subtraction.'],
  ['demosaic', 'Reconstruct color', 'Malvar–He–Cutler demosaicing estimates the two missing channels at each site from neighboring samples.'],
  ['wb', 'White balance', 'Channel gains neutralize the modeled illuminant. The renderer also clips saturated highlights to a common neutral ceiling.'],
  ['ccm', 'Map the colors', 'The fitted color matrix transforms camera channels to linear sRGB. Out-of-gamut values are clipped for this display.'],
  ['tone', 'Encode for your screen', 'The sRGB transfer curve encodes linear light for display. This renderer uses no creative film look or local tone mapping.'],
] as const;
export type PipelineStage = typeof PIPELINE[number][0];

/** Visual cues complement the technical buffer descriptions without changing the image. */
export const PIPELINE_GUIDE: Record<PipelineStage,string> = {
  raw: 'In the enlarged sample, each site carries only its filter’s red, green or blue channel. Missing channels are not black objects in the scene.',
  demosaic: 'The same sample now has three color channels per site. The two missing channels are estimated from neighboring samples.',
  wb: 'Watch neutral areas: different channel gains compensate for the modeled light color.',
  ccm: 'Compare the color patches. A matrix maps the camera’s color responses into the display color space.',
  tone: 'The image brightens as linear-light values receive sRGB display encoding. No extra light has been captured.',
};

/** Intermediate values are displayed directly, without secretly applying the final encoding twice. */
export function pipelinePixels(view: RenderView, stage: PipelineStage): Uint8ClampedArray {
  if (stage === 'tone') return view.rgba.slice();
  const out = new Uint8ClampedArray(view.width * view.height * 4);
  const spec = sensorFor(view.scenario.format, view.scenario.iso, view.scenario.sensor).spec;
  const ceiling = 2 ** spec.bitDepth - 1 - spec.blackLevelDn;
  for (let i = 0; i < view.raw.length; i++) {
    if (stage === 'raw') {
      const channel = cfaColorAt('RGGB', i % view.width, Math.floor(i / view.width));
      out[i * 4 + { R: 0, G: 1, B: 2 }[channel]] = 255 * Math.max(0, view.raw[i] - spec.blackLevelDn) / ceiling;
    } else {
      const values = view.stages[stage];
      for (let c = 0; c < 3; c++) out[i * 4 + c] = 255 * values[i * 3 + c];
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Row exposure windows have equal duration and staggered starts; scan time is not exposure time. */
export function rowWindow(row: number, rows: number, scanS: number, exposureS: number) {
  const start = rows <= 1 ? 0 : Math.max(0, Math.min(rows - 1, row)) / (rows - 1) * scanS;
  return { start, end: start + exposureS };
}

/** Integral of an illustrative step edge moving right at four sensor widths/s, initially at x=.22.
 * A sample is lit until the edge crosses it. Normalize by the complete exposure, including when scrubbing. */
export function movingEdgeFraction(position: number, start: number, exposure: number, time: number): number {
  const collected = Math.max(0, Math.min(exposure, time - start));
  return exposure > 0 ? Math.max(0, Math.min(collected, (position - .22) / 4 - start)) / exposure : 0;
}

export const EXPERIMENTS: Record<string, { title: string; text: string; before: Partial<Scenario>; after: Partial<Scenario> }> = {
  depth: { title: 'Blur the background', text: 'A: f/8. B: f/2. The shutter is shortened four stops to keep nominal exposure constant. Compare the background and the sharp foreground.', before: { lens: 'n50', scene: 'bench', focusM: 1.5, fno: 8, shutter: 1 / 60, iso: 100, motion: { speedMps: 0 }, subjectM: undefined }, after: { fno: 2, shutter: 1 / 960 } },
  motion: { title: 'Freeze motion', text: 'The star card moves at 1 m/s. A: 1/60 s. B: 1/1000 s with ISO raised to hold brightness approximately steady. Less blur costs collected light.', before: { lens: 'n50', scene: 'bench', focusM: 3, fno: 4, shutter: 1 / 60, iso: 100, motion: { speedMps: 1 }, subjectM: undefined }, after: { shutter: 1 / 1000, iso: 1600 } },
  noise: { title: 'Collect more light', text: 'A: a short exposure at high ISO in dusk. B: a still scene exposed 16× longer at 1/16 the ISO. Similar brightness, more signal. Motion would be the tradeoff.', before: { lens: 'n50', scene: 'dusk', focusM: 3, fno: 2, shutter: 1 / 60, iso: 6400, motion: { speedMps: 0 }, subjectM: undefined }, after: { shutter: 16 / 60, iso: 400 } },
};

/** Renders are labeled/pinned only if they correspond to the current normalized shot. */
export function sameShot(a: Scenario, b: Scenario): boolean {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort() as (keyof Scenario)[];
  return keys.every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}
