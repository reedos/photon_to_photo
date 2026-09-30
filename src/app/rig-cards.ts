// The camera level's part cards (src/scene/camera-rig.ts's pins and the parts list), kept apart from the 3D code so
// the evidence rule can be tested without a renderer: every number on a card carries its chip (R1-07). Engine
// figures bring their own (model.figs); the rest are labeled here:
//   spec     - a published number: the marked focal length, the filter thread, the mount's flange, throat and
//              bayonet, the blade count and element count of the prescription;
//   derived  - the engine's own geometry: the iris opening, the entrance pupil and its area, the glass shift, the
//              focus ring's turn;
//   reported - a third party's measurement: the D850's 76 ms release lag (Imaging Resource), its source in the title.
import type { Model } from '../engine/model-types';
import type { Ev, Fig } from '../engine/types';
import type { PartCard } from '../pieces/types';
import { fmtDistance, fmtDims, fmtFno } from './units';
import lensFacts from '../../public/models/lenses.json';
import bodyFacts from '../../public/models/bodies.json';
import dslrHw from '../../data/hardware/dslr.json';

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
const fig = (v: number, unit: string, ev: Ev, src?: string): Fig => ({ v, unit, ev, ...(src ? { src } : {}) });
const mm = (v: number, d = 1) => `${v.toFixed(d)} mm`;

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
const STAND_IN_NOTE = ' This patent example gives no figures for its focusing group, so here the whole optic moves out to focus close. The real lens focuses internally and keeps its length.';

export function partCard(id: PartId, m: Model, st: RigCardState): PartCard {
  const F = m.figs;
  switch (id) {
    case 'lens': {
      const f = LENS_FACTS[m.scenario.lens];
      return { kicker: 'The camera · the lens', title: f ? f.label : m.lens.name,
        body: f ? `Built to the published size, ${f.lengthMm} mm long from the mount and ${f.diameterMm} mm across, with every element of the prescription inside it where the engine traces it.`
          + (f.clipped.length ? ` The engine's clear aperture for the front glass is wider than this barrel allows, so it is shown trimmed; that margin is under review.` : '')
          + (focusesAsStandIn(m) ? STAND_IN_NOTE : '') : m.lens.name,
        specs: [
          { k: 'Focal length (marked)', v: `${m.lens.focalLength} mm`, fig: fig(m.lens.focalLength, 'mm', 'spec', 'the focal length marked on the lens') },
          { k: 'Maximum aperture', v: fmtFno(m.lens.markedFno), fig: F.maxFno },
          { k: 'Elements / groups', v: `${m.lens.elements} / ${m.lens.groups}`, fig: fig(m.lens.elements, 'elements', 'spec', 'the patent prescription') },
          ...(f ? [{ k: 'Filter', v: `${f.filterMm} mm ${f.filterKind}`, fig: fig(f.filterMm, 'mm', 'spec', "the maker's published filter size") }] : []),
        ] };
    }
    case 'focusRing':
      return { kicker: 'The camera · focus', title: `Focused at ${fmtDistance(m.focus.distanceMm)}`,
        body: 'The ring turns the focusing group. The engine solves how far the glass has to move for each distance, and the glass inside moves by exactly that. Everything between the near and far limits is acceptably sharp.' + (focusesAsStandIn(m) ? STAND_IN_NOTE : ''),
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
        body: 'The blades set the opening at the stop. Seen through the front glass that opening looks larger, and its apparent width, the entrance pupil, sets how much light the lens takes in. Its area goes as 1/N squared, so each full stop halves the light.',
        specs: [
          { k: 'Iris opening', v: mm(2 * m.iris.radius, 2), fig: fig(2 * m.iris.radius, 'mm', 'derived', 'the stop radius for this f-number') },
          { k: 'Entrance pupil', v: mm(epD, 1), fig: fig(epD, 'mm', 'derived', 'the stop imaged through the front glass') },
          { k: 'Pupil area', v: `${(Math.PI * m.cardinal.ep.r ** 2).toFixed(0)} mm²`, fig: fig(Math.PI * m.cardinal.ep.r ** 2, 'mm²', 'derived') },
          { k: 'Blades', v: `${d.blades}${d.rounded ? ', rounded' : ''}`, fig: fig(d.blades, 'blades', 'spec', "the maker's published blade count") },
        ] };
    }
    case 'glass':
      return { kicker: 'The camera · the optics', title: `${m.lens.elements} elements in ${m.lens.groups} groups`,
        body: 'Each element is lathed from its two surfaces in the patent prescription. Open the cutaway to see them in section, with the colored rays bending through them.',
        specs: [{ k: 'Effective focal length', v: mm(m.cardinal.efl, 2), fig: F.efl }, { k: 'Working f-number', v: `f/${m.focus.workingFno.toFixed(2)}`, fig: F.workingFno }] };
    case 'mount': {
      const b = mountOf(st.body);
      const src = `the published ${b.type.replace(/ geometry$/, '')} mount`;
      return { kicker: 'The camera · the mount', title: b.type,
        body: 'The lens seats on the body at the flange distance, the fixed gap every lens for this mount is designed around.',
        specs: [
          { k: 'Flange distance', v: `${b.flangeMm} mm`, fig: fig(b.flangeMm, 'mm', 'spec', src) },
          { k: 'Throat', v: `${b.throatMm} mm`, fig: fig(b.throatMm, 'mm', 'spec', src) },
          { k: 'Lugs / contacts', v: `${b.lugCount} / ${b.contactCount}`, fig: fig(b.lugCount, 'lugs', 'spec', src) },
        ] };
    }
    case 'sensor':
      return { kicker: 'The camera · the sensor', title: `${fmtDims(m.sensor.widthPx, m.sensor.heightPx)} pixels`,
        body: 'Every pixel counts the photons that land on it while the shutter is open. At these settings a mid-gray patch delivers the count below to each pixel.',
        specs: [
          { k: 'Pixel pitch', v: `${m.sensor.pitchUm.toFixed(2)} µm`, fig: F.pitchUm },
          { k: 'Photons per pixel (18% gray)', v: Math.round(m.exposure.photonsMidGray).toLocaleString('en-US'), fig: F.photonsMidGray },
          { k: 'Signal to noise', v: m.exposure.snrMidGray.toFixed(1), fig: F.snrMidGray },
        ] };
    case 'shutter':
      return { kicker: 'The camera · exposure time', title: m.scenario.shutter < 1 ? `1/${Math.round(1 / m.scenario.shutter)} s` : `${m.scenario.shutter} s`,
        body: st.body === 'dslr' ? 'Two curtains cross the sensor, and the gap between them is the exposure. Doubling the time doubles the photons every pixel collects.'
          : 'No mechanical shutter here. The sensor starts and stops counting row by row, and the sensor itself rides on the stabilization plate.',
        specs: [{ k: 'Exposure value (EV100)', v: m.exposure.ev100.toFixed(1), fig: F.ev100 }, { k: 'Light on the sensor', v: `${m.exposure.sensorLux.toFixed(0)} lux`, fig: F.sensorLux }] };
    case 'viewfinder': {
      const flange = mountOf(st.body).flangeMm;
      const flangeFig = fig(flange, 'mm', 'spec', `the published ${mountOf(st.body).type.replace(/ geometry$/, '')} mount`);
      return st.body === 'dslr'
        ? { kicker: 'The camera · the viewfinder', title: 'Mirror, screen and prism',
            body: 'Until the shutter fires, the mirror sends the light up to the focusing screen, which sits at the same optical distance from the mirror as the sensor, so what is sharp there is sharp on the sensor. The pentaprism turns that image upright for the eye. The traced rays bounce up at the mirror to show that path. Fire the shutter and the mirror swings up out of the way.',
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
