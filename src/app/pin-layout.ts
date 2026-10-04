export interface PinRect { l: number; t: number; r: number; b: number }
export interface PinAnchor { id: string; x: number; y: number }

/** Keep each part independently selectable. Displaced numbers retain a leader to their real anchor. */
export function spreadPins(anchors: PinAnchor[], width: number, height: number, blocked: PinRect[], selected: string | null, _touch = false): Map<string, PinAnchor> {
  // Buttons have 44px hit regions on every device, including mouse-driven tablets.
  const gap = 44;
  const radius = gap / 2;
  const placed: PinAnchor[] = [];
  const result = new Map<string, PinAnchor>();
  const order = [...anchors].sort((a, b) => Number(b.id === selected) - Number(a.id === selected));
  for (const anchor of order) {
    const candidates = [{ x: anchor.x, y: anchor.y }];
    // Fixed candidates avoid iterative oscillation while orbiting. Prefer moving away from the model's center.
    const outward = Math.atan2(anchor.y - height / 2, anchor.x - width / 2);
    for (let ring = 1; ring <= 4; ring++) for (let step = 0; step < 12; step++) {
      const angle = outward + step * Math.PI / 6;
      candidates.push({ x: anchor.x + Math.cos(angle) * gap * ring * .75, y: anchor.y + Math.sin(angle) * gap * ring * .75 });
    }
    const found = candidates.find(p => p.x >= radius && p.x <= width - radius && p.y >= radius && p.y <= height - radius
      && !blocked.some(r => p.x + radius > r.l && p.x - radius < r.r && p.y + radius > r.t && p.y - radius < r.b)
      && !placed.some(q => Math.abs(p.x - q.x) < gap && Math.abs(p.y - q.y) < gap));
    if (found) { const p = { id: anchor.id, ...found }; placed.push(p); result.set(p.id, p); }
    // If there is no honest room, leave the part in the persistent Parts list instead of merging unrelated actions.
  }
  return result;
}
