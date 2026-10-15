import type { PieceId } from './store';
import type { CameraPart } from './inspection';
import type { Scenario } from '../engine/types';

export type TourId = 'scene' | 'lens' | 'aperture' | 'focus' | 'viewfinder' | 'shutter' | 'pixel' | 'readout' | 'pipeline' | 'photo';
export interface TourStop {
  id: TourId; title: string;
  /** The line the band shows. Kept to about 115 characters so it fits two lines of the phone band at 360 px
   *  (score loop r1, 10/11/2026: stops 5 and 8 were cut off mid-claim, "ISO create…"). */
  text: string;
  /** The More panel: one or two sentences that go further than the band, never a repeat of it. */
  more: string;
  piece: PieceId; part: CameraPart | null; lesson?: 'readout' | 'pipeline';
  /** A stop that asks the reader to use a slider names it with `control` (its input id); `{controls}` in its text is
   *  replaced with the name the settings carry on the current layout ("Controls" beside the model, "Settings" on a
   *  phone), and learning.ts brings that slider into view (review loop 10/11/2026). */
  control?: 'sc-fno' | 'sc-focus';
}

// The story arc, in the order the light meets each part: the subject's light enters the glass, bends, passes the
// iris, comes to focus, shows in the viewfinder until the shutter opens, lands on a pixel, is read out, becomes color.
export const TOUR: TourStop[] = [
  { id: 'scene', title: 'Light from the scene', piece: 'camera', part: null,
    text: 'The lines entering the front glass are rays of light from the subject. Each stop follows them toward a photo.',
    more: 'Every point of the subject sends out a spreading cone of light, and the lens catches part of each cone. The stops ahead follow that light through the glass, the iris and the shutter onto one pixel, then into numbers and color.' },
  { id: 'lens', title: 'The lens bends light', piece: 'lens', part: 'glass',
    text: 'Glass bends each color differently, so one white point splits into colors, a tiny rainbow. The inset shows the gap.',
    more: 'Glass bends blue light a little more than red (dispersion), so one white point lands as a tiny rainbow: chromatic aberration. Designers pair glasses that spread colors differently to pull them back together. In the inset each dot is one ray, lined up from red to violet; that line is the color smear left over. Each color’s own dots also spread a little (blur that is present even in one color), and the colored bar beside the dots shows that spread. The inset’s card says which is larger: the shift between colors or one color’s own blur.' },
  { id: 'aperture', title: 'The aperture sets the opening', piece: 'camera', part: 'iris',
    control: 'sc-fno',
    text: 'Try Aperture in {controls}. A bigger f-number is a smaller opening: less light, more depth of field, more diffraction.',
    more: 'The f-number is the focal length divided by the apparent width of the opening. Each full stop, f/2.8 to f/4 for example, halves the light. Aperture sets how bright the light on the sensor is; the shutter sets how long it falls.' },
  { id: 'focus', title: 'Focus brings a point together', piece: 'cone', part: 'focusRing',
    control: 'sc-focus',
    text: 'Try Focus distance in {controls}. A point is sharp where its rays meet on the sensor; others form blur disks.',
    more: 'The traced point sits at its own distance, set by its Distance slider under The traced point. When that is nearer than the focus distance its rays meet behind the sensor, and when farther they meet in front, so they land as the disk in the inset; set it to the focus distance to make it sharp. The inset draws the sensor’s real pixels, so you can count how many the disk covers. Depth of field is the range where it stays smaller than an agreed limit (the circle of confusion), a viewing convention, not a hard edge.' },
  { id: 'viewfinder', title: 'Framing in the viewfinder', piece: 'camera', part: 'viewfinder',
    text: 'Before the shot, a DSLR’s mirror sends the light up to the viewfinder; a mirrorless body shows the sensor’s live view.',
    more: 'In a DSLR the focusing screen sits at the same optical distance as the sensor, so what looks sharp in the finder is sharp in the photo, and a prism turns the image upright. When the shutter fires, the mirror swings up out of the light path.' },
  { id: 'shutter', title: 'The shutter sets the time', piece: 'camera', part: 'shutter',
    text: 'Press Fire shutter. Twice the time collects twice the photons; longer times also blur anything that moves.',
    more: 'Aperture and shutter time together set the exposure: one stop wider with half the time gives the same light. In a focal-plane shutter two curtains cross the sensor and the gap between them is the exposure. A subject keeps moving while light is collected, so a short time freezes it.' },
  { id: 'pixel', title: 'A pixel collects charge', piece: 'loupe', part: 'sensor',
    text: 'Photons free electrons in each pixel. More light means less relative noise; ISO adds no photons.',
    more: 'A color filter over each pixel passes mostly red, green or blue. Some photons that get through free an electron (the fraction is the quantum efficiency), and the photodiode stores that charge in its own well until readout. Arrivals are random, so a count of 10,000 varies by about 100, its square root. Raising ISO amplifies the signal after capture.' },
  { id: 'readout', title: 'Read the sensor', piece: 'camera', part: 'sensor', lesson: 'readout',
    text: 'Scrub the scan to see rows read one after another, then change the charge to watch it become a number.',
    more: 'An analog-to-digital converter (ADC) turns each pixel’s charge into a raw digital number (DN), on top of a small fixed offset called the black level. An electronic scan reads rows in turn, so a fast subject can lean even at a short exposure: rolling-shutter skew.' },
  { id: 'pipeline', title: 'Turn raw data into color', piece: 'camera', part: 'sensor', lesson: 'pipeline',
    text: 'An illustrative test sample goes from raw values to finished color. It is separate from the real photographs.',
    more: 'Each raw site has only one color. Demosaicing estimates the other two from neighbors, white balance evens out the light’s color, a color matrix maps the camera’s colors to the display’s, and the sRGB curve encodes it for the screen. The sample is a controlled color chart, not RAW data from a photograph.' },
  { id: 'photo', title: 'Explore a real photograph', piece: 'camera', part: null,
    text: 'Press Play the shot to follow one real photograph step by step.',
    more: 'Each real photo replays with the settings recorded in its own file. The original JPEG stays unchanged; the animations explain how a picture like it is captured, and they say which parts are illustrations.' },
];

export const PIPELINE = [
  ['raw', 'Bayer mosaic', 'Each site measures one filtered channel in this controlled color-chart sample. Values are black-level corrected and normalized.'],
  ['demosaic', 'Reconstruct color', 'A standard demosaicing filter (Malvar–He–Cutler) estimates the two missing channels at each site from neighboring samples.'],
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

/** A tour stop's text with its `{controls}` placeholder filled in. */
export function tourText(stop: { text: string }, controlsName: string): string {
  return stop.text.replaceAll('{controls}', controlsName);
}

/** The tour stop an address names, 0-based: tour=4 is the fourth stop (tour=1, the older form, the first). Null when
 *  the tour is not open; a number past the last stop is the last stop. */
export function tourStop(search: string): number | null {
  const raw = new URLSearchParams(search).get('tour');
  if (raw === null) return null;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, TOUR.length) - 1 : 0;
}
