// The camera level's part cards (src/scene/camera-rig.ts's pins and the parts list), kept apart from the 3D code so
// the evidence rule can be tested without a renderer: every number on a card carries its chip (R1-07). Engine
// figures bring their own (model.figs); the rest are labeled here:
//   spec     - a published number: the marked focal length, the filter thread, the blade count and element count of the prescription;
//   derived  - the engine's own geometry: the iris opening, the entrance pupil and its area, the glass shift, the
//              focus ring's turn;
//   reported - a third party's measurement: the D850's 76 ms release lag (Imaging Resource), its source in the title.
import type { Model } from '../engine/model-types';
import type { Ev, Fig } from '../engine/types';
import type { PartCard } from '../pieces/types';
import { fmtDistance, fmtDims, fmtFno, fmtShutter, fmtSnr } from './units';
import lensFacts from 'virtual:p2p-facts/lenses';
import bodyFacts from 'virtual:p2p-facts/bodies';
import dslrHw from '../../data/hardware/dslr.json';
import exteriors from '../../data/hardware/lens-exteriors.json';
import mounts from '../../data/hardware/mounts.json';

export interface LensFact { label: string; glb: string; flangeMm: number; lengthMm: number; diameterMm: number; filterMm: number;
  filterKind: string; elementCount: number; groupCount: number; representativeOf: string | null;
  clipped: { element: number; sd: number; shown: number }[] }
export const LENS_FACTS = (lensFacts as unknown as { lenses: Record<string, LensFact> }).lenses;

type BodyKey = 'dslr' | 'mirrorless';
interface Mount { type: string; flangeMm: number; throatMm: number; lugCount: number; contactCount: number }
export const mountOf = (body: BodyKey): Mount => (bodyFacts as unknown as Record<BodyKey, { mount: Mount }>)[body].mount;

/** What the cards read from the drawn rig, beside the model. */
export interface RigCardState { body: BodyKey; ringAngle: number; elementShift: number[] }

const LAG = (dslrHw as unknown as { timing: { shutterLag: { v: number; src: string } } }).timing.shutterLag;
const fig = (v: number, unit: string, ev: Ev, src?: string): Fig => ({ v, unit, ev, ...(src ? ev === 'derived' ? { calc: src } : { src } : {}) });
const mm = (v: number, d = 1) => `${v.toFixed(d)} mm`;
const mountFig = (body: BodyKey, field: 'flangeMm' | 'throatMm' | 'lugs' | 'contacts'): Fig => {
  const record = mounts.mounts[body === 'dslr' ? 'nikonF' : 'nikonZ'];
  // These are secondary reports, even where the historical ledger called them specs.
  return { v: record[field], unit: field.endsWith('Mm') ? 'mm' : field, ...record.figs[field],
    ev: 'reported' };
};

export const PART_IDS = ['lens', 'focusRing', 'iris', 'glass', 'mount', 'sensor', 'shutter', 'viewfinder'] as const;
export type PartId = typeof PART_IDS[number];

/** The part's name as the pin and the list show it: the DSLR has no in-body stabilizer, so its part is the shutter. */
export function partLabel(id: PartId, body: BodyKey): string {
  const L: Record<PartId, string> = { lens: 'The lens', focusRing: 'Focus ring', iris: 'Iris (aperture)', glass: 'The glass', mount: 'Mount',
    sensor: 'Sensor', shutter: body === 'dslr' ? 'Shutter' : 'Shutter / stabilizer', viewfinder: 'Viewfinder' };
  return L[id];
}

/** A prescription that names an internal focusing group but gives no gaps for it (the n500fl's patent example): the
 *  engine stands in by moving the whole optic, so the drawing grows at close focus where the real lens keeps its
 *  length. The cards say so rather than let the drawing pass for the product (R2-FID-5). */
export function focusesAsStandIn(m: Model): boolean {
  const f = m.realized.design.focus;
  return f.method !== 'unit' && !(f.gaps?.length);
}
/** The depth-of-field range is geometric. When the Airy disk (diffraction) is itself wider than the acceptable blur, even a
 *  perfectly focused point is softer than the criterion, so the card says the range does not include that (r5). */
export function diffractionDofNote(m: Model): string {
  const airyMm = 2 * m.diffraction.airyRadiusUm / 1000;
  if (airyMm <= m.focus.cocMm) return '';
  return ` At this stop diffraction alone is softer than that criterion (the Airy disk is ${(airyMm * 1000).toFixed(1)} µm across); this range is geometric and does not include it.`;
}
const STAND_IN_NOTE = ' This patent example gives no figures for its focusing group, so here the whole optic moves out to focus close. The real lens focuses internally and keeps its length.';

export function partCard(id: PartId, m: Model, st: RigCardState): PartCard {
  const F = m.figs;
  switch (id) {
    case 'lens': {
      const f = LENS_FACTS[m.scenario.lens];
      return { kicker: 'The camera · the lens', title: f ? f.label : m.lens.name,
        body: f ? `Built to the published size, ${f.lengthMm} mm long from the mount and ${f.diameterMm} mm across, with every element of the published lens design inside it, where the simulator traces its rays.`
          + (focusesAsStandIn(m) ? STAND_IN_NOTE : '') : m.lens.name,
        // score loop r5: the rounding and trimming notes are for a reader who asks, so they sit under More detail
        more: f ? (f.clipped.length ? `The simulator's clear aperture (usable glass diameter) for the front glass is wider than this barrel allows, so it is shown trimmed; that margin is under review. ` : '')
          + `Marked values are rounded; the patent example computes f/${m.lens.maxFno.toFixed(2)}, and a ${m.cardinal.efl.toFixed(1)} mm focal length at the current focus.` : undefined,
        specs: [
          { k: 'Focal length (marked)', v: `${m.lens.focalLength} mm`, fig: fig(m.lens.focalLength, 'mm', 'spec', `data/lenses/${m.scenario.lens}.json focalLength; representative product class, not computed EFL`) },
          { k: 'Maximum aperture (prescription)', v: `f/${m.lens.maxFno.toFixed(2)}`, fig: F.maxFno },
          { k: 'Focal length (traced, this focus)', v: mm(m.cardinal.efl, 1), fig: F.efl },
          { k: 'Elements / groups', v: `${m.lens.elements} / ${m.lens.groups}`, fig: { ...fig(m.lens.elements, 'elements', 'spec', m.lens.source.url), loc: m.lens.source.location } },
          ...(f ? [{ k: 'Filter', v: `${f.filterMm} mm ${f.filterKind}`, fig: { ...((exteriors.lenses as unknown as Record<string, {filterMm: Omit<Fig, 'v' | 'unit'>}>)[m.scenario.lens].filterMm), v: f.filterMm, unit: 'mm' } }] : []),
        ] };
    }
    case 'focusRing':
      return { kicker: 'The camera · focus', title: `Focused at ${fmtDistance(m.focus.distanceMm)}`,
        body: `The ring turns the focusing group, and the simulator works out how far the glass has to move for each distance. The sharp range from near to far follows the textbook depth-of-field convention.` + diffractionDofNote(m) + (focusesAsStandIn(m) ? STAND_IN_NOTE : ''),
        more: `Near and far use the textbook paraxial rule at 587.6 nm with a ${(m.focus.cocMm * 1000).toFixed(0)} µm acceptable blur circle; a real lens adds focus shift and color, which the cone’s traced disk shows.`,
        specs: [
          { k: 'Ring turned', v: `${(st.ringAngle * 180 / Math.PI).toFixed(1)}° from infinity`, fig: fig(st.ringAngle, 'rad', 'derived', 'the engine focus travel over the ring throw') },
          { k: 'Sharp from', v: fmtDistance(m.focus.nearMm), fig: F.nearM },
          { k: 'Sharp to', v: fmtDistance(m.focus.farMm), fig: F.farM },
          { k: 'Largest glass shift', v: mm(Math.max(0, ...st.elementShift.map(Math.abs)), 2), fig: fig(Math.max(0, ...st.elementShift.map(Math.abs)), 'mm', 'derived', 'each element from its infinity position') },
        ] };
    case 'iris': {
      const epD = 2 * m.cardinal.ep.r;
      const d = m.realized.design.iris;
      return { kicker: 'The camera · the aperture', title: fmtFno(m.scenario.fno),
        body: 'The blades set the opening at the stop. Seen through the front glass that opening looks a different size, and this apparent width, the entrance pupil, sets how much light the lens takes in. Stopping down one full stop halves the light.',
        more: 'At fixed focus the entrance pupil’s area goes as 1/N squared, where N is the f-number.',
        specs: [
          { k: 'Iris opening', v: mm(2 * m.iris.radius, 2), fig: fig(2 * m.iris.radius, 'mm', 'derived', 'the stop radius for this f-number') },
          { k: 'Entrance pupil', v: mm(epD, 1), fig: fig(epD, 'mm', 'derived', 'the stop imaged through the front glass') },
          { k: 'Pupil area', v: `${(Math.PI * m.cardinal.ep.r ** 2).toFixed(0)} mm²`, fig: fig(Math.PI * m.cardinal.ep.r ** 2, 'mm²', 'derived', 'pi * entrance-pupil radius squared (circular pupil approximation)') },
          { k: 'Blades', v: `${d.blades}${d.rounded ? ', rounded' : ''}`, fig: fig(d.blades, 'blades', d.ev, d.source) },
        ] };
    }
    case 'glass':
      return { kicker: 'The camera · the optics', title: `${m.lens.elements} elements in ${m.lens.groups} groups`,
        body: 'Each element is shaped from its two surfaces in the published patent design. Open the cutaway to see them in section, with the colored rays bending through them. The focal length below is computed from that design; the number marked on a lens is rounded.',
        specs: [{ k: 'Effective focal length (computed)', v: mm(m.cardinal.efl, 2), fig: F.efl }, { k: 'Working f-number (effective at this focus)', v: `f/${m.focus.workingFno.toFixed(2)}`, fig: F.workingFno }] };
    case 'mount': {
      const b = mountOf(st.body);
      return { kicker: 'The camera · the mount', title: b.type,
        body: 'The lens seats on the body at the flange distance, the fixed gap every lens for this mount is designed around.',
        specs: [
          { k: 'Flange distance', v: `${b.flangeMm} mm`, fig: mountFig(st.body, 'flangeMm') },
          { k: 'Throat', v: `${b.throatMm} mm`, fig: mountFig(st.body, 'throatMm') },
          { k: 'Lugs', v: `${b.lugCount}`, fig: mountFig(st.body, 'lugs') },
          { k: 'Contacts (modeled body)', v: `${b.contactCount}`, fig: mountFig(st.body, 'contacts') },
        ] };
    }
    case 'sensor':
      return { kicker: 'The camera · the sensor', title: `${fmtDims(m.sensor.widthPx, m.sensor.heightPx)} pixels`,
        // Score loop r5: the lead is the chain a reader should keep (photons, electrons, one signal-to-noise figure) and the
        // rest of the story and the rows for the specialist sit under More detail and More settings.
        body: `Each pixel turns some of the photons that reach it into electrons while the shutter is open. At these settings an 18% gray patch delivers about ${Math.round(m.exposure.photonsMidGray).toLocaleString('en-US')} photons to each pixel, leaving about ${Math.round(m.exposure.electronsMidGray).toLocaleString('en-US')} electrons in a green one.`,
        more: `A green pixel’s filter passes mostly green light and its photodiode converts only part of it. The signal-to-noise ratio is calculated for a uniform patch of such green pixels, so besides shot noise it includes read noise and pixel-to-pixel variation (PRNU).`,
        specs: [
          { k: 'Pixel pitch', v: `${m.sensor.pitchUm.toFixed(2)} µm`, fig: F.pitchUm },
          { k: 'Photons per pixel (18% gray, all colors)', v: Math.round(m.exposure.photonsMidGray).toLocaleString('en-US'), fig: F.photonsMidGray },
          { k: 'Lens transmission (assumed)', v: `${Math.round(F.lensTransmission.v * 100)}%`, fig: F.lensTransmission },
          { k: 'Electrons, green pixel (18% gray)', v: Math.round(m.exposure.electronsMidGray).toLocaleString('en-US'), fig: F.electronsMidGray },
          { k: 'Signal-to-noise ratio, green 18% gray patch (higher is cleaner)', v: fmtSnr(m.exposure, 1), fig: F.snrMidGray },
          ...(m.exposure.grayClipped ? [{ k: m.exposure.limitedBy === 'adc' ? 'Clipped at the ADC' : 'Clipped at the full well', v: `patch ${Math.round(m.exposure.electronsMidGray).toLocaleString('en-US')} e⁻ against ${Math.round(m.exposure.usableE).toLocaleString('en-US')} e⁻ recorded`, fig: fig(m.exposure.usableE, 'e-', 'derived', 'camera.ts: min(full well, ADC clip) at this ISO') }] : []),
        ],
        moreSpecs: [
          { k: 'Raw level, green 18% gray at the metered exposure (share of clip)', v: `${(100 * m.exposure.grayRawFractionMetered).toFixed(1)}%`, fig: F.grayRawFractionMetered },
          { k: m.sensor.measuredIsoFactor ? 'ISO 12232 expects for that gray, at this camera’s measured ISO (share of clip)' : 'ISO 12232 expects for that gray (share of clip)', v: `${(100 * m.exposure.isoExpectedRawFraction).toFixed(1)}%`, fig: F.isoExpectedRawFraction },
          ...(F.prnuPercent ? [{ k: 'Pixel-to-pixel variation, PRNU (assumed)', v: `${F.prnuPercent.v.toFixed(1)}%`, fig: F.prnuPercent }] : []),
        ] };
    case 'shutter':
      return { kicker: 'The camera · exposure time', title: fmtShutter(m.scenario.shutter),
        body: (st.body === 'dslr' ? 'Two curtains cross the sensor, and the gap between them is the exposure. Doubling the time doubles the photons every pixel collects.'
          : 'No mechanical shutter here. The sensor starts and stops counting row by row, and the sensor itself rides on the stabilization plate.')
          + ' When the scene is brighter, use a smaller opening or a faster shutter.',
        more: 'The EV100 of these settings is the scene brightness they suit; the scene’s own EV100 is listed beside it.',
        specs: [{ k: 'EV100 of these settings', v: m.exposure.ev100.toFixed(1), fig: F.ev100 }, { k: `EV100 of the scene (${Math.round(m.exposure.sceneLux).toLocaleString('en-US')} lux)`, v: m.exposure.sceneEv100.toFixed(1), fig: F.sceneEv100 }, { k: 'Light on the sensor', v: `${m.exposure.sensorLux.toFixed(0)} lux`, fig: F.sensorLux }, { k: 'Lens transmission (assumed)', v: `${Math.round(F.lensTransmission.v * 100)}%`, fig: F.lensTransmission }] };
    case 'viewfinder': {
      const flange = mountOf(st.body).flangeMm;
      const flangeFig = mountFig(st.body, 'flangeMm');
      return st.body === 'dslr'
        ? { kicker: 'The camera · the viewfinder', title: 'Mirror, screen and prism',
            body: 'Until the shutter fires, the mirror sends the light up to a focusing screen, and a prism turns that image upright for your eye. Fire the shutter and the mirror swings up out of the way.',
            more: 'The focusing screen sits at the same optical distance from the mirror as the sensor, so what is sharp there is sharp on the sensor. An optical finder shows the lens wide open, so it shows less depth of field than the photo will have. The traced rays bounce up at the mirror to show that path; past the screen, their run up through the prism and out to the eyepiece is drawn as a schematic, without the prism’s internal reflections.',
            specs: [{ k: 'Release lag (mirror up included)', v: `${LAG.v} ms`, fig: fig(LAG.v, 'ms', 'reported', `Imaging Resource's lab measurement of the D850 (${LAG.src})`) },
              { k: 'Sensor distance behind the mount', v: `${flange} mm`, fig: flangeFig }] }
        : { kicker: 'The camera · the viewfinder', title: 'Electronic viewfinder',
            body: 'No mirror. The sensor sees the scene all the time, and a small micro-OLED panel behind the eyepiece lenses shows its live image. That is why the mount can sit so close to the sensor.',
            specs: [{ k: 'Sensor distance behind the mount', v: `${flange} mm`, fig: flangeFig }] };
    }
  }
}

/** Test surface: the spec rows that show a number but carry no evidence. */
export function bareNumbers(card: PartCard): string[] {
  return card.specs.filter((r) => /\d/.test(r.v) && !r.fig).map((r) => r.k);
}
