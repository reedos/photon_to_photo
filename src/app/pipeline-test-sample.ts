import { sensorFor } from '../engine/data';
import { maxDn } from '../engine/sensor';
import { applyColorMatrix, applyToneCurve, applyWhiteBalance, clipHighlightsToNeutral, demosaicMalvarHeCutler, encodeRGB8, makePlane, srgbToneCurve } from '../engine/pipeline';

/** A small deterministic chart made from flat sensor-channel values, not a rendered scene or user photo. */
export function createPipelineTestSample(format: Parameters<typeof sensorFor>[0], iso: number, sensorId?: string) {
  const width = 96, height = 64;
  const { spec } = sensorFor(format, iso, sensorId);
  const blackLevelDn = spec.blackLevelDn, whiteLevelDn = maxDn(spec) - blackLevelDn;
  const colors: [number, number, number][] = [
    [.78,.78,.78], [.78,.16,.12], [.12,.68,.2], [.12,.28,.82], [.78,.65,.12], [.62,.16,.68],
    [.1,.68,.7], [.5,.32,.18], [.16,.16,.16], [.92,.92,.92], [.42,.42,.42], [.07,.07,.07],
  ];
  // Chosen for teaching only: the gains and matrix below are illustrative, not calibrated camera data.
  const gains: [number, number, number] = [1.32, 1, 1.18];
  const raw = new Uint16Array(width * height), plane = makePlane(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const patch = colors[Math.min(colors.length - 1, Math.floor(x / (width / 6)) + 6 * Math.floor(y / (height / 2)))];
    const cfa = y % 2 ? (x % 2 ? 2 : 1) : (x % 2 ? 1 : 0); // RGGB
    const dn = Math.round(blackLevelDn + (patch[cfa] / gains[cfa]) * whiteLevelDn);
    const i = y * width + x; raw[i] = dn; plane.data[i] = (dn - blackLevelDn) / whiteLevelDn;
  }
  const demosaic = demosaicMalvarHeCutler(plane, 'RGGB');
  const wb = clipHighlightsToNeutral(applyWhiteBalance(demosaic, gains), gains);
  // A representative camera-to-display matrix keeps the mapping stage concrete and deterministic.
  const ccm = applyColorMatrix(wb, [1.08,-.04,-.04,-.02,1.04,-.02,-.02,-.06,1.08]);
  const tone = applyToneCurve(ccm, srgbToneCurve), encoded = encodeRGB8(tone);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) { rgba[i*4]=encoded.data[i*3]; rgba[i*4+1]=encoded.data[i*3+1]; rgba[i*4+2]=encoded.data[i*3+2]; rgba[i*4+3]=255; }
  const interleave = (p: typeof demosaic) => {
    const out = new Float32Array(width * height * 3);
    for (let i = 0; i < width * height; i++) { out[i*3]=p.R.data[i]; out[i*3+1]=p.G.data[i]; out[i*3+2]=p.B.data[i]; }
    return out;
  };
  return { width, height, raw, blackLevelDn, whiteLevelDn, rgba, stages: { demosaic: interleave(demosaic), wb: interleave(wb), ccm: interleave(ccm) } };
}
