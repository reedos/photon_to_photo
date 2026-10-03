// A separate worker for the optional real-photo panel. It never publishes a live shot or retains loupe pixels.
import { compute, renderImage } from './engine-api';
import { exitPupilBlurDiameterMm } from '../engine/camera';
import type { Scenario } from '../engine/types';

export interface ExampleRenderRequest { scenario: Partial<Scenario>; width: number; height: number }
export interface ExampleRenderResult {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  nearMm: number;
  farMm: number;
  backgroundBlurMm: number;
  photons: number;
  snr: number;
}

self.onmessage = (event: MessageEvent<ExampleRenderRequest>) => {
  try {
    const { scenario, width, height } = event.data;
    const model = compute(scenario);
    const result = renderImage(model, { width, height, seed: 1 });
    const message: ExampleRenderResult = {
      rgba: result.rgba, width, height,
      nearMm: model.focus.nearMm, farMm: model.focus.farMm,
      backgroundBlurMm: exitPupilBlurDiameterMm(model, 1e9),
      photons: model.exposure.photonsMidGray, snr: model.exposure.snrMidGray,
    };
    (self as unknown as Worker).postMessage(message, [result.rgba.buffer]);
  } catch {
    (self as unknown as Worker).postMessage({ error: 'The example could not be rendered.' });
  }
};
