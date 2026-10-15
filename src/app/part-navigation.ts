import type { CameraPart, InspectionView } from './inspection';

/** The reference site's order: overview is stop zero, with wraparound in both directions. */
export function adjacentPart(ids: readonly string[], selected: string | null, direction: -1 | 1): string | null {
  const index = ids.indexOf(selected ?? '') + 1;
  const next = (index + direction + ids.length + 1) % (ids.length + 1);
  return next === 0 ? null : ids[next - 1];
}

export function insideView(part: CameraPart | null): Exclude<InspectionView, 'camera'> | null {
  if (part === 'lens' || part === 'glass' || part === 'iris') return 'lens';
  if (part === 'focusRing') return 'cone';
  if (part === 'sensor') return 'loupe';
  return null;
}

/** The deeper level's own part for a camera part, so Go inside lands on it instead of that level's overview (score
 *  loop r3): the iris on Optics is the same iris, the glass is entered at its front element, the focus ring's level
 *  opens on the cone it focuses, and the sensor's on its controlled pixel sample. The whole lens has no single part
 *  inside; Optics opens on its overview. */
export function insidePin(part: CameraPart | null): string | null {
  if (part === 'iris') return 'iris';
  if (part === 'glass') return 'front-element';
  if (part === 'focusRing') return 'cone';
  if (part === 'sensor') return 'pixel';
  return null;
}

export const VIEW_LABELS = { camera: 'Camera', lens: 'Optics', cone: 'Focus & bokeh', loupe: 'One pixel' } as const;
