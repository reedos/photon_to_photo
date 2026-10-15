import { upperKeepMicro } from '../app/units';

// Shared by levels 2-4. Small layout helpers the three deep dives need on a phone (design review R1-13).
import * as THREE from 'three/webgpu';

/** The scale badge's text, joined so a narrow view only ever breaks before a "·", never inside a phrase and never
 *  right after one, which would leave the dot dangling alone at the end of the old line (R3-06): each phrase keeps
 *  its own spaces as no-break spaces, the ordinary (breakable) space sits before each separator, and the dot is
 *  glued to the phrase that follows it by a no-break space of its own. */
export function badgeJoin(...phrases: string[]): string {
  const nbsp = String.fromCharCode(0xa0);
  return phrases.map((p) => p.replace(/ /g, nbsp)).join(` ·${nbsp}`);
}

export const isPhone = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches;

/** One rule for a deep level's compact layout, shared by the inset rectangles (lens/inset.ts, cone.ts) and the
 *  framing that pans the model clear of them (review loop 10/11/2026): a phone-width window, a view too short for
 *  the desktop's bottom-right inset (a phone on its side), or a view too narrow for it (a tablet in portrait, whose
 *  view is a ~460-510 px column beside the inspector: there the bottom-right inset sat on the Focus level's
 *  traced-point card, score loop r2). */
export const COMPACT_VIEW_MAX_W = 560;
export function compactView(viewH: number, viewW = Infinity): boolean {
  return isPhone() || viewH < 420 || viewW <= COMPACT_VIEW_MAX_W;
}

export type InsetBox = { left: number; bottom: number; width: number; height: number };

/** A compact inset in the view's top-right corner, capped by the view itself so the model keeps most of the view
 *  (Reed, decision 3): at most `maxW` px, 38% of the view's width and 45% of its height. `aspect` is height/width. */
export function compactInsetRect(viewW: number, viewH: number, maxW: number, aspect: number, top = 30, bottomReserve = 0): InsetBox {
  // `top`: the room the inset's own note line takes above it (30 px holds one line; a note of two lines or more asks for its
  // measured height, score loop r6). `bottomReserve`: the foot of the view a control card covers; the inset never grows into it
  // (the 96 px floor still wins on a very short view).
  const room = Math.max(0, viewH - top - bottomReserve);
  const width = Math.max(96, Math.round(Math.min(maxW, viewW * 0.38, (viewH * 0.45) / aspect, bottomReserve ? room / aspect : Infinity)));
  const height = Math.round(width * aspect);
  return { left: Math.max(8, viewW - 12 - width), bottom: Math.max(8, viewH - top - height), width, height };
}

export type Region = { l: number; t: number; r: number; b: number };

/** The largest part of the view a model can be framed into beside a top-right inset and above `bottomReserve` px
 *  of controls: either the column left of the inset or the band below it, whichever holds the larger circle. */
export function freeRegion(viewW: number, viewH: number, inset: InsetBox | null, bottomReserve = 0): Region {
  const b = Math.max(40, viewH - bottomReserve);
  if (!inset) return { l: 0, t: 0, r: viewW, b };
  const insetTop = viewH - inset.bottom - inset.height - 18;
  const left: Region = { l: 0, t: 0, r: Math.max(40, inset.left - 6), b };
  const below: Region = { l: 0, t: Math.min(b - 40, insetTop + inset.height + 24), r: viewW, b };
  const size = (q: Region) => Math.min(q.r - q.l, q.b - q.t);
  return size(left) >= size(below) ? left : below;
}

/** A camera frame looking along `dir` (target -> camera) that fits a sphere of `radius` around `center` into
 *  `region` of the view and centers it there: a pull-back for the fit, then a pure pan along the screen axes.
 *  The stage camera's fov is 40 degrees vertical. */
export function frameInRegion(center: THREE.Vector3, radius: number, dir: THREE.Vector3, viewW: number, viewH: number,
  region: Region, fovDeg = 40): { position: THREE.Vector3; target: THREE.Vector3 } {
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));
  const fit = Math.max(40, Math.min(region.r - region.l, region.b - region.t));
  const dist = radius / Math.sin(Math.atan(tanHalf * fit / viewH));
  const d = dir.clone().normalize();
  const right = new THREE.Vector3().crossVectors(d.clone().negate(), new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, d.clone().negate()).normalize();
  const worldPerPx = (dist * tanHalf) / (viewH / 2);
  const dx = (region.l + region.r) / 2 - viewW / 2, dy = (region.t + region.b) / 2 - viewH / 2;
  // Moving the camera left slides the picture right; moving it up slides the picture down.
  const target = center.clone().addScaledVector(right, -dx * worldPerPx).addScaledVector(up, dy * worldPerPx);
  return { position: target.clone().addScaledVector(d, dist), target };
}

/** A camera frame looking along `dir` (target -> camera) that fits the projected bounding box of `points` into
 *  `region` at `fill` of its limiting side and centers it there. Unlike frameInRegion's bounding sphere, this fits
 *  what is actually drawn, so a long, flat subject (a cone from its pupil to the sensor) fills the free width
 *  instead of leaving a sphere's worth of empty space above and below it (score loop r2). A few rounds of
 *  pull-back and pan converge on the perspective fit. The stage camera's fov is 40 degrees vertical. */
export function frameBoxInRegion(points: THREE.Vector3[], dir: THREE.Vector3, viewW: number, viewH: number,
  region: Region, fill = 0.9, fovDeg = 40): { position: THREE.Vector3; target: THREE.Vector3 } {
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));
  const d = dir.clone().normalize();
  const fwd = d.clone().negate();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const box = new THREE.Box3().setFromPoints(points);
  const target = box.getCenter(new THREE.Vector3());
  const radius = Math.max(1e-6, box.getSize(new THREE.Vector3()).length() / 2);
  let dist = radius / tanHalf;
  const rw = Math.max(40, region.r - region.l), rh = Math.max(40, region.b - region.t);
  const rcx = (region.l + region.r) / 2, rcy = (region.t + region.b) / 2;
  const v = new THREE.Vector3();
  for (let round = 0; round < 8; round++) {
    const position = target.clone().addScaledVector(d, dist);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of points) {
      v.copy(p).sub(position);
      const depth = Math.max(1e-6, v.dot(fwd));
      const k = (viewH / 2) / (depth * tanHalf);
      const px = viewW / 2 + v.dot(right) * k, py = viewH / 2 - v.dot(up) * k;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    const scale = Math.max((x1 - x0) / (fill * rw), (y1 - y0) / (fill * rh));
    const worldPerPx = (dist * tanHalf) / (viewH / 2);
    // moving the camera left slides the picture right; moving it up slides the picture down
    target.addScaledVector(right, -(rcx - (x0 + x1) / 2) * worldPerPx).addScaledVector(up, (rcy - (y0 + y1) / 2) * worldPerPx);
    dist *= Math.min(4, Math.max(0.25, scale));
  }
  return { position: target.clone().addScaledVector(d, dist), target };
}

/** Where `points` land on a view (CSS px, origin top-left) seen from `frame`, through the stage's 40 degree camera. */
export function projectPoints(points: THREE.Vector3[], frame: { position: THREE.Vector3; target: THREE.Vector3 }, viewW: number, viewH: number,
  fovDeg = 40): { x: number; y: number }[] {
  const cam = new THREE.PerspectiveCamera(fovDeg, viewW / viewH, 0.01, 100000);
  cam.position.copy(frame.position);
  cam.lookAt(frame.target);
  cam.updateMatrixWorld(true);
  return points.map((p) => {
    const v = p.clone().project(cam);
    return { x: ((v.x + 1) / 2) * viewW, y: ((1 - v.y) / 2) * viewH };
  });
}

/**
 * frameBoxInRegion, then as large as the subject can grow without any of its points reaching an inset (score loop r4:
 * on a portrait phone the Optics cutaway and the Focus cone fitted the free column beside the top-right inset and left
 * a band of black below it, 56% and 50% of the width). The subject is not a rectangle: its corner nearest the inset is
 * often empty, so it can keep growing down and left until a projected point would land on the inset or its caption.
 * Tries the subject centered, at the bottom and at the top of `area`, at growing scales of its first fit, and keeps the
 * largest that clears every `avoid` rectangle by `gap` px (all in view px, origin top-left). Falls back to the first fit.
 */
export function frameBoxAvoiding(points: THREE.Vector3[], dir: THREE.Vector3, viewW: number, viewH: number,
  first: Region, area: Region, avoid: Region[], fill = 0.95, gap = 6, fovDeg = 40): { position: THREE.Vector3; target: THREE.Vector3 } {
  const base = frameBoxInRegion(points, dir, viewW, viewH, first, fill, fovDeg);
  if (!avoid.length) return base;
  const p0 = projectPoints(points, base, viewW, viewH, fovDeg);
  const bw = Math.max(...p0.map((p) => p.x)) - Math.min(...p0.map((p) => p.x));
  const bh = Math.max(...p0.map((p) => p.y)) - Math.min(...p0.map((p) => p.y));
  const aw = area.r - area.l, ah = area.b - area.t;
  const clear = (f: { position: THREE.Vector3; target: THREE.Vector3 }) => {
    const q = projectPoints(points, f, viewW, viewH, fovDeg);
    return q.every((p) => p.x >= area.l - 1 && p.x <= area.r + 1 && p.y >= area.t - 1 && p.y <= area.b + 1
      && !avoid.some((a) => p.x > a.l - gap && p.x < a.r + gap && p.y > a.t - gap && p.y < a.b + gap));
  };
  let best = base, bestScale = 1.03;
  for (const anchor of ['mid', 'bottom', 'top'] as const) {
    for (let s = Math.min(2, aw / bw, ah / bh); s > bestScale; s -= 0.03) {
      const w = bw * s, h = bh * s;
      const t = anchor === 'mid' ? (area.t + area.b) / 2 - h / 2 : anchor === 'bottom' ? area.b - h : area.t;
      const f = frameBoxInRegion(points, dir, viewW, viewH, { l: area.l, t, r: area.l + w, b: t + h }, 1, fovDeg);
      if (clear(f)) { best = f; bestScale = s; break; }
    }
  }
  // Nothing larger than the first fit clears, and the first fit itself does not (a short landscape view: the inset, its note and the
  // card of sliders leave a band the cone does not fit at that size): the largest smaller fit that does is used instead of one that
  // lies under the note or the inset (score loop r6). Without one, the first fit stands.
  if (best === base && !clear(base)) {
    for (let s = Math.min(0.97, aw / bw, ah / bh); s >= 0.45; s -= 0.03) {
      const w = bw * s, h = bh * s;
      for (const anchor of ['mid', 'bottom', 'top'] as const) {
        const t = anchor === 'mid' ? (area.t + area.b) / 2 - h / 2 : anchor === 'bottom' ? area.b - h : area.t;
        const f = frameBoxInRegion(points, dir, viewW, viewH, { l: area.l, t, r: area.l + w, b: t + h }, 1, fovDeg);
        if (clear(f)) return f;
      }
    }
  }
  return best;
}

/**
 * An empty box in the piece's overlay over an inset's rectangle, plus an optional one-line note sitting on the
 * inset's top edge, outside the picture (the inset's own caption is inside it, and what the inset draws stays
 * clean for the accuracy gates that read its pixels). The stage's pin pass treats every child of a piece overlay
 * as chrome (stage.ts measure()), so a pin under the inset or its note hides and a label never lands on them
 * (R2-06). `update(null)` takes both away.
 */
export interface InsetGuard {
  /** `wrap`: the note may break onto more lines within the inset's width (a legend) instead of one line. */
  update(rect: { left: number; bottom: number; width: number; height: number } | null, note?: string, wrap?: boolean, opts?: { wide?: number }): void;
  /** The note's laid-out height in px (0 while it is hidden), so the inset can leave exactly that much room above it. */
  noteHeight(): number;
  /** Called when the note's box changes size on its own (a user's text-spacing stylesheet, a font arriving). */
  onResize(cb: () => void): void;
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
  let resizeCb: (() => void) | null = null;
  // WCAG 1.4.12: a reader's own spacing makes the note taller than it was measured; the next update() measures it again
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { last = ''; resizeCb?.(); }) : null;
  resizeObserver?.observe(note);
  return {
    noteHeight() { return note.hidden || box.hidden ? 0 : Math.ceil(note.offsetHeight); },
    onResize(cb) { resizeCb = cb; },
    update(rect, text = '', wrap = false, opts) {
      const key = rect ? `${rect.left},${rect.bottom},${rect.width},${rect.height},${text},${wrap},${opts?.wide ?? ''}` : '';
      if (key === last) return;
      last = key;
      box.hidden = !rect;
      if (!rect) return;
      box.style.left = `${rect.left}px`;
      box.style.bottom = `${rect.bottom}px`;
      box.style.width = `${rect.width}px`;
      note.hidden = !text;
      if (wrap) {
        // A legend is explanatory prose, so it is set in sentence case in the UI sans (score loop r3: five lines of
        // right-aligned uppercase mono read as shouting; design/LOOK.md keeps uppercase mono for short labels). Each
        // phrase is its own span with the dot trailing it, and the short ones never break inside, so no line starts
        // with a lone dot or splits "1 square = 1 pixel". textContent is unchanged.
        note.replaceChildren();
        const phrases = text.split(' · ');
        phrases.forEach((ph, i) => {
          // score loop r6: each phrase takes its own line and its separator dot stays in the text (textContent is unchanged)
          // but is not drawn, so no wrapped line ever ends on a dangling "·" or starts with one
          const span = document.createElement('span');
          span.append(document.createTextNode(ph));
          if (i < phrases.length - 1) { const sep = document.createElement('span'); sep.className = 'sep'; sep.textContent = ' ·'; span.append(sep); }
          span.className = ph.length <= 30 && rect.width >= 150 ? 'ph nw' : 'ph'; // r5: a narrow inset lets even a short phrase wrap, so the legend never runs past the view
          if (i) note.append(' ');
          note.append(span);
        });
      } else note.textContent = upperKeepMicro(text);
      // A note may wrap to a second line within the inset's width (the Optics inset's legend, score loop r1); the box
      // grows by the note's measured height so the pins keep off every line of it.
      note.classList.toggle('lv-inset-note-wrap', wrap);
      // a narrow inset lets its note run a little wider than itself (right-aligned over the view), so a short legend
      // stays on one line instead of wrapping word by word (score loop r2, landscape phone)
      // On a phone held upright the legend keeps to the inset's own width (score loop r3): run wider, it lay over the
      // sensor end of the cutaway beside the inset; in the sans its phrases fit three short lines.
      // `opts.wide` (the Focus level's note, score loop r6) lets the note run left of a phone's inset to that width, so its three short
      // lines become two and sit in the 36 px above the inset instead of under it, over the slider card.
      note.style.width = wrap ? `${isPhone() ? (opts?.wide ? Math.max(rect.width, Math.min(opts.wide, rect.left + rect.width - 8)) : rect.width) : Math.max(rect.width, Math.min(200, rect.left + rect.width - 8))}px` : '';
      // A phrase that is wider than the note may break (score loop r5: on a 360 px phone "bar = one color's spread ·"
      // was held whole in a 100 px note and ran 22 px past the view's edge, cutting the key to the dots and bars).
      // The note never runs past the view: it is clamped to the overlay's width less a margin. A broken phrase takes its own
      // lines and its last word keeps the trailing dot, so no line begins with a lone "·".
      if (wrap) {
        // the note's text box is its width less the 10 px of its backing's padding (levels.css). The last call's max-width is taken
        // off first: left on, it capped clientWidth and so the next call's own limit, and the note only ever shrank (score loop r6:
        // a 236 px note at 390 px came out 78 px wide and eight lines tall in a forced-colors run, where a second pass measured the first pass's cap)
        note.style.maxWidth = '';
        const limit = Math.min(note.clientWidth || rect.width, Math.max(rect.width, rect.left + rect.width - 4)) - 10;
        note.style.maxWidth = `${Math.max(60, limit + 10)}px`;
        for (const ph of note.querySelectorAll<HTMLElement>('.nw')) {
          if (ph.getBoundingClientRect().width <= limit + 0.5) continue;
          const t = ph.firstChild?.textContent ?? '';
          const cut = t.lastIndexOf(' ', t.length - 1);
          ph.className = 'ph brk';
          if (cut > 0) { const tail = document.createElement('span'); tail.className = 'nw'; tail.textContent = t.slice(cut + 1); ph.replaceChildren(t.slice(0, cut + 1), tail); }
        }
      } else note.style.maxWidth = '';
      const noteH = text ? Math.max(NOTE_H, note.offsetHeight + 6) : 0;
      box.style.height = `${rect.height + noteH}px`;
      // The note sits above the inset; when that would start above the view (a short view whose inset is near its
      // top), it moves under the inset instead, so it is never clipped (score loop r2: only the last line showed).
      const viewH = overlay.clientHeight || (overlay.parentElement?.clientHeight ?? 0);
      const above = !viewH || rect.bottom + rect.height + noteH <= viewH;
      note.style.top = above ? '' : `${rect.height + 4}px`;
      box.style.bottom = above ? `${rect.bottom}px` : `${Math.max(0, rect.bottom - noteH)}px`;
    },
    dispose() { resizeObserver?.disconnect(); box.remove(); },
  };
}
