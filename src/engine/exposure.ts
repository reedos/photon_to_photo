// Exposure: EV/EV100 and reciprocity, the camera equation (scene radiance -> image-plane irradiance/illuminance),
// photon counts per pixel per wavelength bin, T-stops, motion blur and rolling-shutter skew.
// Workstream E2 (engine/closed-form). See docs/engine/e2.md for the full derivations.

import type { Bins } from './types';
import { magnificationFromObject } from './thinlens';

// ---- physical constants ------------------------------------------------------------------------------------------
/** Planck constant, J*s. Exact by definition since the 2019 SI redefinition (CODATA / BIPM SI Brochure, 9th ed.). */
export const PLANCK_H = 6.62607015e-34;

/** Speed of light in vacuum, m/s. Exact by definition since 1983 (CODATA / BIPM SI Brochure, 9th ed.). */
export const SPEED_OF_LIGHT = 299792458;

/**
 * Luminous efficacy of monochromatic 555 nm (540 THz) radiation, lm/W. Exact by definition (the SI candela
 * definition; BIPM SI Brochure, 9th ed., ยง2.3.1). Converting a broadband radiometric quantity to photometric units
 * with this single constant is only exact AT 555 nm; away from the photopic peak it requires weighting by the full
 * CIE 1931 V(lambda) luminosity function, which this module does not carry (that data lives in a later
 * workstream's color module). `radiometricFromPhotometric`/`photometricFromRadiometric` below use it as a labeled
 * peak-sensitivity approximation, not a spectrally accurate conversion.
 */
export const LUMINOUS_EFFICACY_555NM = 683;

/** Photon energy (J) at wavelength `nm` (nanometers): E = hc / lambda. */
export function photonEnergy(nm: number): number {
  const lambdaM = nm * 1e-9;
  return (PLANCK_H * SPEED_OF_LIGHT) / lambdaM;
}

/** Photon flux (photons/s) carried by `watts` of monochromatic power at wavelength `nm`. */
export function photonFlux(watts: number, nm: number): number {
  return watts / photonEnergy(nm);
}

// ---- EV, EV100 and reciprocity ------------------------------------------------------------------------------------
/** Exposure value at the settings actually used: EV = log2(N^2 / t), t in seconds (APEX system, ISO 2720). */
export function ev(N: number, t: number): number {
  return Math.log2((N * N) / t);
}

/**
 * EV normalized to ISO 100, so the same scene gives the same number regardless of the ISO the camera was set to.
 *
 * Derivation: the reflected-light meter equation (ISO 2720) is N^2/t = L*S/K (L = scene luminance, S = ISO
 * arithmetic speed, K = meter calibration constant), so EV_S = log2(N^2/t) = log2(L/K) + log2(S) for a correctly
 * metered exposure at speed S. EV100 is defined as what that same scene's EV would be at S=100:
 *   EV100 = log2(L/K) + log2(100) = EV_S - log2(S) + log2(100) = EV_S - log2(S/100)
 * (Wikipedia's "Exposure value" article states this same relation; re-derived here from the ISO 2720 meter
 * equation so it is guaranteed consistent with `luminanceFromEv` below.) Higher ISO makes the correctly-metered
 * EV_S for a fixed scene LARGER (a shorter correct shutter time raises N^2/t), so EV100 is correspondingly smaller
 * than EV_S for S > 100 - check with `ev100(N, t, iso)` at a few ISOs against the "sunny 16" family in
 * exposure.test.ts.
 */
export function ev100(N: number, t: number, iso: number): number {
  return ev(N, t) - Math.log2(iso / 100);
}

/** The f-number that gives the same EV as (N1, t1) at a new shutter time t2 (equivalent exposure / reciprocity). */
export function equivalentAperture(N1: number, t1: number, t2: number): number {
  return Math.sqrt((N1 * N1 * t2) / t1);
}

/** The shutter time that gives the same EV as (N1, t1) at a new f-number N2 (equivalent exposure / reciprocity). */
export function equivalentShutter(N1: number, t1: number, N2: number): number {
  return (t1 * (N2 * N2)) / (N1 * N1);
}

/** The shutter time (s) at f-number N that gives a given EV: t = N^2 / 2^EV. */
export function shutterForEv(N: number, evValue: number): number {
  return (N * N) / Math.pow(2, evValue);
}

// ---- reflected-light meter constant (ISO 2720) ---------------------------------------------------------------------
/**
 * ISO 2720:1974 reflected-light exposure meter calibration constant K, in the equation N^2/t = L*S/K (L = scene
 * luminance, cd/m^2; S = ISO arithmetic speed). K = 12.5 is the value most current meter and camera makers use
 * (Canon, Nikon, Sekonic); K = 14 is a documented alternate some manufacturers (historically Minolta, some Pentax
 * bodies) calibrate to instead - the two differ by log2(14/12.5) = 0.163 stop, small enough that both are "ISO
 * 2720 compliant" (the standard permits a range of K). `METER_CONSTANT_K_ALT` is provided for callers who want to
 * show that spread rather than silently picking one.
 */
export const METER_CONSTANT_K = 12.5;
export const METER_CONSTANT_K_ALT = 14;

/** Scene luminance (cd/m^2) implied by a correctly-metered exposure: L = K * N^2 / (t * S), from N^2/t = LS/K. */
export function luminanceFromExposure(N: number, t: number, iso: number, K: number = METER_CONSTANT_K): number {
  return (K * N * N) / (t * iso);
}

// ---- the camera equation -----------------------------------------------------------------------------------------
/**
 * Working f-number: the effective f-number that governs exposure once the lens is extended for magnification |m|
 * away from infinity focus (the "bellows factor"), corrected for pupil magnification p = exit pupil radius /
 * entrance pupil radius (Cardinal.pupilMag in src/engine/types.ts; p = 1 for a symmetric/thin lens).
 *   N_w = N (1 + |m| / p)
 * Standard formula for macro/bellows exposure compensation (e.g. Ray, S. F., "Applied Photographic Optics", 3rd
 * ed., ch. 10; Kingslake, "Optics in Photography", ch. 6). At infinity focus m = 0 and N_w = N.
 */
export function workingFNumber(N: number, m: number, pupilMag: number = 1): number {
  return N * (1 + Math.abs(m) / pupilMag);
}

/** Convenience: working f-number from focal length and object distance (uses thinlens.ts's magnification). */
export function workingFNumberForFocus(N: number, f: number, objectDistance: number, pupilMag: number = 1): number {
  return workingFNumber(N, magnificationFromObject(objectDistance, f), pupilMag);
}

/** cos^4(theta): the natural-vignetting falloff factor for a point imaged at off-axis angle `thetaRad`. */
export function cos4Falloff(thetaRad: number): number {
  const c = Math.cos(thetaRad);
  return c * c * c * c;
}

/** Paraxial off-axis angle (radians) of an image point at height `imageHeightMm` for a lens of focal length f. */
export function offAxisAngle(imageHeightMm: number, f: number): number {
  return Math.atan(imageHeightMm / f);
}

/**
 * The "effective solid angle" factor pi / (4 N_w^2) (steradians) that the camera equation multiplies scene
 * radiance/luminance by. Derivation: the image-side ray cone from the working f-number N_w has half-angle u'
 * with sin(u') ~ 1/(2 N_w) in the paraxial approximation (N_w = image distance / entrance-pupil diameter, so
 * tan(u') ~ 1/(2N_w), and small angles let sin ~ tan). The solid angle of a cone of half-angle u' is
 * Omega = 2*pi*(1 - cos(u')) ~ pi * sin^2(u') for small u', giving Omega ~ pi / (4 N_w^2). This is the same
 * paraxial/small-angle approximation the camera equation itself assumes (see `imageIlluminance` below).
 */
export function effectiveSolidAngle(workingFNo: number): number {
  return Math.PI / (4 * workingFNo * workingFNo);
}

/**
 * The camera equation: image-plane illuminance (lux) produced by a Lambertian scene element of luminance L
 * (cd/m^2), through a lens of transmission T (0..1) and working f-number N_w, for an image point at off-axis
 * angle `thetaRad` (cos^4 falloff).
 *   E = L * T * cos^4(theta) * pi / (4 N_w^2)
 * Assumptions (all standard for this "camera equation" form - see e.g. Ray, "Applied Photographic Optics", ch. 10,
 * or the RP Photonics Encyclopedia entry "camera equation"):
 *   - the scene element is Lambertian (radiance/luminance independent of viewing angle), so a single L describes
 *     it fully;
 *   - the paraxial/small-angle approximation used in `effectiveSolidAngle` (breaks down for very fast, very wide
 *     lenses at the field edge - the same regime where cos^4 itself is an approximation of real vignetting);
 *   - T lumps every transmission loss (absorption, uncoated-surface reflection, etc.) into one scalar, uniform
 *     over the pupil and over field angle;
 *   - N_w already includes any pupil-magnification/bellows correction the caller wants (see `workingFNumber`);
 *   - cos^4(theta) is the natural-vignetting law for a simple, unvignetted lens (Ray, ch. 4); real lenses usually
 *     vignette faster than cos^4 well before the frame corner, which this equation does not model.
 */
export function imageIlluminance(L: number, T: number, workingFNo: number, cosTheta: number): number {
  return L * T * Math.pow(cosTheta, 4) * effectiveSolidAngle(workingFNo);
}

/** Radiometric counterpart of `imageIlluminance`: image-plane irradiance (W/m^2) from scene radiance Le (W/(m^2 sr)). */
export function imageIrradiance(Le: number, T: number, workingFNo: number, cosTheta: number): number {
  return Le * T * Math.pow(cosTheta, 4) * effectiveSolidAngle(workingFNo);
}

// ---- T-stop --------------------------------------------------------------------------------------------------
/** T-stop from f-number and transmission: T# = N / sqrt(T). Standard cinema-lens definition (ANSI/SMPTE); the
 *  f-number a lens of perfect (T=1) transmission would need to pass the same light this one does. */
export function tStop(N: number, T: number): number {
  return N / Math.sqrt(T);
}

/** Inverse of `tStop`: the transmission implied by a given f-number and measured T-stop. */
export function transmissionFromTStop(N: number, tStopValue: number): number {
  return (N * N) / (tStopValue * tStopValue);
}

// ---- photon counts per pixel per wavelength bin ------------------------------------------------------------------
export interface PhotonCountGeometry {
  T: number; // transmission, 0..1
  workingFNo: number; // working f-number (already pupil-mag/bellows corrected if relevant)
  cosTheta: number; // off-axis angle cosine, 1 on axis
  pixelPitchMm: number; // pixel pitch, mm (pixel area = pitch^2)
  exposureS: number; // exposure (shutter) time, s
}

/**
 * Photon count landing in one pixel's full area, per wavelength bin, during the exposure, for a given scene
 * spectral radiance. No data imports: the spectrum arrives as plain arrays via `bins`/`sceneRadiance`.
 *
 * `bins` is the shared wavelength binning (src/engine/types.ts): `bins.centers[i]` (nm) and `bins.weights[i]` (bin
 * width, nm). `sceneRadiance[i]` is the scene's spectral radiance in that bin, W/(m^2 sr nm).
 *
 * Per bin: apply the camera equation (`imageIrradiance`) to get image-plane spectral irradiance (W/(m^2 nm)),
 * multiply by pixel area, exposure time and bin width to get energy (J), then divide by the per-photon energy at
 * that bin's center wavelength (`photonEnergy`) to get a photon count. QE, fill factor and Poisson sampling are
 * the sensor stage's job (workstream E3), not this module's.
 */
export function photonsPerPixelPerBin(bins: Bins, sceneRadiance: number[], geom: PhotonCountGeometry): number[] {
  const pixelAreaM2 = (geom.pixelPitchMm * 1e-3) * (geom.pixelPitchMm * 1e-3);
  const out = new Array<number>(bins.centers.length);
  for (let i = 0; i < bins.centers.length; i++) {
    const spectralIrradiance = imageIrradiance(sceneRadiance[i], geom.T, geom.workingFNo, geom.cosTheta); // W/(m^2 nm)
    const energyJ = spectralIrradiance * pixelAreaM2 * geom.exposureS * bins.weights[i];
    out[i] = energyJ / photonEnergy(bins.centers[i]);
  }
  return out;
}

// ---- radiometric <-> photometric (peak-sensitivity approximation) -------------------------------------------------
/** Illuminance (lux) from irradiance (W/m^2), using the 555 nm peak efficacy - see `LUMINOUS_EFFICACY_555NM`. */
export function photometricFromRadiometric(wattsPerM2: number): number {
  return wattsPerM2 * LUMINOUS_EFFICACY_555NM;
}

/** Irradiance (W/m^2) from illuminance (lux), using the 555 nm peak efficacy - see `LUMINOUS_EFFICACY_555NM`. */
export function radiometricFromPhotometric(lux: number): number {
  return lux / LUMINOUS_EFFICACY_555NM;
}

// ---- motion blur and rolling shutter --------------------------------------------------------------------------
/**
 * Motion blur streak length, in pixels, left by a subject moving at `objectSpeedMmPerS` (transverse, mm/s) at
 * distance `objectDistanceMm` from the front principal plane, for a lens of focal length f focused on that
 * subject (so its own conjugate sets the magnification), exposed for `exposureS` seconds, on a sensor of pitch
 * `pitchMm`. Image-space speed = |magnification| * object speed (the standard thin-lens transverse-magnification
 * scaling - see thinlens.ts); blur length (mm) = image speed * exposure time; pixels = that / pitch.
 */
export function motionBlurPixels(
  objectSpeedMmPerS: number,
  objectDistanceMm: number,
  f: number,
  exposureS: number,
  pitchMm: number
): number {
  const m = Math.abs(magnificationFromObject(objectDistanceMm, f));
  const blurMm = m * objectSpeedMmPerS * exposureS;
  return blurMm / pitchMm;
}

/**
 * Rolling-shutter skew, in pixels, for a subject moving at `objectSpeedMmPerS` at `objectDistanceMm`, imaged
 * through a lens of focal length f, while the sensor's rolling shutter takes `readoutTimeS` seconds to scan every
 * row. The skew is the image-space distance the subject's image moves during the full readout (the same
 * image-speed scaling as `motionBlurPixels`, with the readout time standing in for the exposure time): a straight
 * vertical edge on a subject moving horizontally during readout comes out sheared by this many pixels from top row
 * to bottom row.
 */
export function rollingShutterSkewPixels(
  objectSpeedMmPerS: number,
  objectDistanceMm: number,
  f: number,
  readoutTimeS: number,
  pitchMm: number
): number {
  return motionBlurPixels(objectSpeedMmPerS, objectDistanceMm, f, readoutTimeS, pitchMm);
}
