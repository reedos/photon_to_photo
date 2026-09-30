// The measured Jiang et al. 2013 camera spectral sensitivity set (CC BY-NC-SA 4.0), kept selectable per ENGINE.md but
// OUT of the app: production code never imports this module, so the table is not bundled into the site. The file is
// loaded as optional (a Vite glob), so a checkout without it (the public snapshot leaves it out) still builds and tests.
// `gaussianCameraSensitivities` (data.ts) is the default everywhere.
import type { ChannelSensitivities } from './color';
import { tableSpectrum } from './data';

interface JiangCameraSensJson {
  default_camera: string;
  lambda: number[];
  cameras: Record<string, { R: number[]; G: number[]; B: number[] }>;
}
const found = (import.meta as unknown as { glob: (p: string, o: object) => Record<string, unknown> })
  .glob('../../data/color/camera-sensitivity-jiang2013.json', { eager: true, import: 'default' });
const jiangSensData = Object.values(found)[0] as JiangCameraSensJson | undefined;

/** Whether the table is present in this checkout. */
export const jiangAvailable = !!jiangSensData;

/** `cameraName` defaults to the file's own recommended full-frame stand-in, "Nikon D700". */
export function jiangCameraSensitivities(cameraName?: string): ChannelSensitivities {
  if (!jiangSensData) throw new Error('jiang.ts: data/color/camera-sensitivity-jiang2013.json is not in this checkout');
  const name = cameraName ?? jiangSensData.default_camera;
  const cam = jiangSensData.cameras[name];
  if (!cam) {
    throw new Error(`jiang.ts: jiangCameraSensitivities: unknown camera "${name}" (known: ${Object.keys(jiangSensData.cameras).join(', ')})`);
  }
  return {
    R: tableSpectrum(jiangSensData.lambda, cam.R),
    G: tableSpectrum(jiangSensData.lambda, cam.G),
    B: tableSpectrum(jiangSensData.lambda, cam.B),
  };
}
