/** Camera context carried through the three inspection views and their share links. */
export const CAMERA_PARTS = ['lens', 'focusRing', 'iris', 'glass', 'mount', 'sensor', 'shutter', 'viewfinder'] as const;
export type CameraPart = typeof CAMERA_PARTS[number];
export type InspectionView = 'camera' | 'lens' | 'cone' | 'loupe';

export const PART_LABELS: Record<CameraPart, string> = {
  lens: 'Lens', focusRing: 'Focus ring', iris: 'Aperture', glass: 'Glass', mount: 'Mount',
  sensor: 'Sensor', shutter: 'Shutter', viewfinder: 'Viewfinder',
};

export function cameraPart(value: string | null | undefined): CameraPart | null {
  return CAMERA_PARTS.includes(value as CameraPart) ? value as CameraPart : null;
}

/** Keep a relevant selected part; entering a different inspection supplies its natural camera parent. */
export function inspectionParent(view: InspectionView, selected: CameraPart | null): CameraPart | null {
  if (view === 'camera') return selected;
  if (view === 'cone') return 'focusRing';
  if (view === 'loupe') return 'sensor';
  return selected === 'lens' || selected === 'iris' || selected === 'glass' ? selected : 'glass';
}
