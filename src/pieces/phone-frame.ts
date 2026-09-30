// Shared by levels 2-4. Two small layout helpers the three deep dives need on a phone (design review R1-13).
import * as THREE from 'three/webgpu';
import type { CameraFrame, PieceContext } from './types';

/** The scale badge's text, joined so a narrow view only ever breaks before a "·", never inside a phrase and never
 *  right after one, which would leave the dot dangling alone at the end of the old line (R3-06): each phrase keeps
 *  its own spaces as no-break spaces, the ordinary (breakable) space sits before each separator, and the dot is
 *  glued to the phrase that follows it by a no-break space of its own. */
export function badgeJoin(...phrases: string[]): string {
  const nbsp = String.fromCharCode(0xa0);
  return phrases.map((p) => p.replace(/ /g, nbsp)).join(` ·${nbsp}`);
}

export const isPhone = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches;

/**
 * On a phone the part card opens as a sheet over the lower half of the screen (src/styles/app.css, #card). This
 * slides the camera, without turning it, so the selected part sits in the middle of the strip of view left above
 * that sheet, the way level 1 frames a part (R1-04). It waits for the sheet to open and for the page's own scroll
 * back to the view to settle, then flies there. On a desktop it does nothing. Returns a cancel function.
 */
export function frameAboveSheet(
  ctx: PieceContext, anchor: () => THREE.Vector3 | null, zoom = 1,
  /** where in the free strip the anchor should land instead of its middle, in view px (the strip's top and bottom
   *  given), e.g. under an inset that stays up so the picked pin's label has room beside it (R2-06) */
  place?: (strip: { top: number; bottom: number; width: number }) => { x: number; y: number } | null,
  /** Other world points that must also stay inside the free rect (e.g. the sensor plane), so a pick keeps the
   *  context that explains it instead of panning until only the picked part is framed (R3-08). */
  extent?: () => THREE.Vector3[] | null,
): () => void {
  if (!isPhone()) return () => {};
  let cancelled = false;
  let last = '';
  let stable = 0;
  const t0 = performance.now();
  const step = () => {
    if (cancelled) return;
    const card = document.getElementById('card');
    const canvas = ctx.renderer.domElement;
    const vr = canvas.getBoundingClientRect();
    const cr = card && !card.hidden ? card.getBoundingClientRect() : null;
    const key = `${Math.round(vr.top)}:${cr ? Math.round(cr.top) : -1}`;
    stable = key === last ? stable + 1 : 0;
    last = key;
    if (stable < 4 && performance.now() - t0 < 1400) { requestAnimationFrame(step); return; }
    const a = anchor();
    if (!a || !vr.height) return;
    // the free strip: from just under the view's top chrome to the sheet's top edge (or the view's bottom)
    const top = 56;
    const bottom = Math.min(vr.height, cr ? cr.top - vr.top : vr.height) - 12;
    if (bottom - top < 80) return;
    const yc = (top + bottom) / 2;
    const cam = ctx.camera;
    cam.updateMatrixWorld(true);
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    let depth = a.clone().sub(cam.position).dot(fwd) * zoom;
    // Widen the depth (pulling the camera back) until every extra point also sits inside the half-angle the anchor
    // alone would get, not only the anchor: a pick that lands at one end of the rig otherwise pans until the other
    // reference points (the sensor plane, the neighboring pin) run off the free rect's edge (R3-08).
    const others = extent?.() ?? null;
    if (others && others.length) {
      const halfFov = THREE.MathUtils.degToRad(cam.fov) / 2;
      const margin = 1.25;
      for (const o of others) {
        const rel = o.clone().sub(a);
        const w = rel.dot(fwd); // how much farther than the anchor this point sits, along the view direction
        const u = Math.abs(rel.dot(right)), v = Math.abs(rel.dot(up));
        const dU = u * margin / (Math.tan(halfFov) * cam.aspect) - w;
        const dV = v * margin / Math.tan(halfFov) - w;
        depth = Math.max(depth, dU, dV);
      }
    }
    const halfH = depth * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const halfW = halfH * cam.aspect;
    // where the anchor should land, in normalized device coordinates: centered across, at yc down
    const at = place?.({ top, bottom, width: vr.width }) ?? null;
    const wantX = at ? (2 * at.x) / vr.width - 1 : 0;
    const wantY = 1 - (2 * (at ? at.y : yc)) / vr.height;
    // a camera at the anchor's own depth, then stepped back from it so the anchor lands at (wantX, wantY)
    const position = a.clone().addScaledVector(fwd, -depth).addScaledVector(right, -wantX * halfW).addScaledVector(up, -wantY * halfH);
    const target = position.clone().addScaledVector(fwd, depth);
    ctx.dive({ position, target } as CameraFrame);
  };
  requestAnimationFrame(step);
  return () => { cancelled = true; };
}

/**
 * An empty box in the piece's overlay over an inset's rectangle, plus an optional one-line note sitting on the
 * inset's top edge, outside the picture (the inset's own caption is inside it, and what the inset draws stays
 * clean for the accuracy gates that read its pixels). The stage's pin pass treats every child of a piece overlay
 * as chrome (stage.ts measure()), so a pin under the inset or its note hides and a label never lands on them
 * (R2-06). `update(null)` takes both away.
 */
export interface InsetGuard {
  update(rect: { left: number; bottom: number; width: number; height: number } | null, note?: string): void;
  dispose(): void;
}
const NOTE_H = 18; // the note's line above the inset, included in the box so the pins keep off it too
export function insetGuard(overlay: HTMLElement): InsetGuard {
  const box = document.createElement('div');
  box.className = 'lv-inset-guard';
  box.setAttribute('aria-hidden', 'true');
  box.hidden = true;
  const note = document.createElement('span');
  note.className = 'lv-inset-note';
  box.append(note);
  overlay.appendChild(box);
  let last = '';
  return {
    update(rect, text = '') {
      const key = rect ? `${rect.left},${rect.bottom},${rect.width},${rect.height},${text}` : '';
      if (key === last) return;
      last = key;
      box.hidden = !rect;
      if (!rect) return;
      box.style.left = `${rect.left}px`;
      box.style.bottom = `${rect.bottom}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height + (text ? NOTE_H : 0)}px`;
      note.hidden = !text;
      note.textContent = text;
    },
    dispose() { box.remove(); },
  };
}
