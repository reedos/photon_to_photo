/** A single, independently sampled sensor pixel viewing a controlled neutral target. */
import type { Model } from '../engine/model-types';
import type { CfaColor, PixelState } from '../engine/types';
import { BINS, V_LAMBDA, sensorFor } from '../engine/data';
import { samplePixel } from '../engine/sensor';
import { cfaColorAt } from '../engine/pipeline';
import { makeRng } from '../engine/rng';
import { photonsPerPixelPerBin } from '../engine/exposure';
import { daylightAt, sceneDefaultCctK, sceneDefaultLux } from '../engine/scenes';
import { illuminantSpectralIrradiance } from '../engine/scene';

const ASSUMED_LENS_TRANSMISSION = 0.9; // camera.ts's labeled default transmission assumption

export type PixelSample = PixelState & { objectPoint: [number, number, number]; depthMm: number };

export type ControlledPixelInfo = PixelSample & {
  sample: { reflectance: 0.18; lux: number; cctK: number; distanceMm: number | null };
};

/** Sample one central pixel of a matte 18% neutral target under the live model's daylight illuminant.
 *  Uses the engine's exposure spectrum and photon integration; no image or scene renderer is involved. */
export function sampleNeutralPixel(model: Model, seed = 1): ControlledPixelInfo {
  const x = Math.floor(model.sensor.widthPx / 2);
  const y = Math.floor(model.sensor.heightPx / 2);
  const cfa: CfaColor = cfaColorAt('RGGB', x, y);
  const lux = model.scenario.lux ?? sceneDefaultLux(model.scenario.scene);
  const cct = model.scenario.cct ?? sceneDefaultCctK(model.scenario.scene);
  const irradiance = illuminantSpectralIrradiance(daylightAt(cct), lux, BINS, V_LAMBDA);
  const radiance = BINS.centers.map(nm => 0.18 * irradiance(nm) / Math.PI);
  const photonsByBin = photonsPerPixelPerBin(BINS, radiance, {
    T: ASSUMED_LENS_TRANSMISSION,
    workingFNo: model.focus.workingFno,
    cosTheta: 1,
    pixelPitchMm: model.sensor.pitchUm / 1000,
    exposureS: model.scenario.shutter,
  });
  const { spec } = sensorFor(model.scenario.format, model.scenario.iso, model.scenario.sensor);
  const state: PixelState = samplePixel(spec, makeRng(seed), {
    x, y, cfa, photonsByBin, binCentersNm: BINS.centers,
    exposureS: model.scenario.shutter, iso: model.scenario.iso,
  });
  const distanceMm = model.focus.distanceMm;
  const traceDistanceMm = distanceMm ?? 3_000_000_000;
  return {
    ...state,
    objectPoint: [0, 0, traceDistanceMm],
    depthMm: traceDistanceMm,
    sample: { reflectance: 0.18, lux, cctK: cct, distanceMm },
  };
}
