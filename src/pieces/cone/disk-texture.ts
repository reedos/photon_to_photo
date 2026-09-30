// The bokeh disk: accumulates a Bundle's real landing points into a small canvas texture, density = intensity,
// colored by wavelength via the engine's own wavelengthColor() (through look.ts's wavelengthToThreeColor so the
// exact-sRGB spectral rule holds -- see design/LOOK.md, "The spectral color rule"). Unlit, toneMapped:false: this
// paints the actual traced landing points, not a decorative disk.
import * as THREE from 'three/webgpu';
import type * as look from '../../app/look';

export interface DiskTexture {
  texture: THREE.CanvasTexture;
  /** Half-width of the square the texture covers, in mm (real, un-exaggerated -- the plane this textures is
   *  sized to exactly this, per LOOK.md's "size exaggeration must be badged, never silent"). */
  halfExtentMm: number;
  dispose(): void;
}

const CANVAS_PX = 320;

/**
 * `landing`: the bundle's real landing points (mm, sensor-plane x/y) with each ray's wavelength. `cx`/`cy`: the
 * disk's centroid (mm). `halfExtentMm`: the square half-width to render (caller picks this so it comfortably
 * contains the disk plus the CoC/predicted-blur rings -- see cone.ts).
 */
export function buildDiskTexture(
  landing: { x: number; y: number; nm: number }[],
  cx: number,
  cy: number,
  halfExtentMm: number,
  lookMod: typeof look,
): DiskTexture {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_PX;
  canvas.height = CANVAS_PX;
  const g = canvas.getContext('2d')!;
  // Left fully transparent (no fillRect) rather than opaque black: the plane this textures sits exactly in the
  // sensor plane alongside the pixel-grid lines and the CoC/predicted rings (cone.ts), so an opaque background
  // would hide them under the disk everywhere the disk itself has no ray density -- only the splats below carry
  // any coverage.
  g.globalCompositeOperation = 'lighter'; // additive: density = intensity, per BRIEF.md/PROTOTYPE.md

  // Per-splat alpha tuned against this piece's actual ray budget (cone.ts's RAYS_PER_NM * 16 bins, ~1700-2900
  // landing points -- see cone.ts's own comment on that count): trace.ts's fibonacci pupil grid is uniform in
  // AREA density by construction (its own doc comment), so a flat alpha (not divided by ray count) gives a
  // fairly evenly bright disk that still saturates toward white where wavelengths overlap most, via the
  // additive 'lighter' composite -- no per-scenario rescaling needed at this fixed budget.
  const perRayAlpha = 0.62;
  // A soft, radially-symmetric falloff (a radial gradient per splat, opaque at the core fading to fully
  // transparent at the edge) rather than a hard-edged flat-alpha disc: at this ray budget, hard-edged splats at
  // the previous ~2.2px radius left visible black gaps between non-overlapping points -- the fibonacci pupil
  // grid's own phyllotaxis/spiral sampling pattern (trace.ts) then reads as a sparse dot-scatter instead of a
  // continuous disk of light (art director finding bokeh-disk-reads-as-scatter; critic F1's "comet"/two-tone
  // look is consistent with two adjacent, nearly-coincident hard-edged circles of different hues abutting at a
  // sharp boundary -- a soft radial gradient removes that hard edge so overlapping splats blend continuously
  // instead). Each splat is still stamped with exactly one wavelengthToThreeColor(nm), radially symmetric about
  // its own center, so a splat's color is never a function of direction (LOOK.md's spectral-color rule).
  const rPx = CANVAS_PX / 55; // ~5.8px at 320px -- wide enough for neighboring landing points to overlap and merge

  for (const p of landing) {
    const c = lookMod.wavelengthToThreeColor(p.nm);
    const px = ((p.x - cx) / halfExtentMm) * (CANVAS_PX / 2) + CANVAS_PX / 2;
    // Canvas rows grow downward; CanvasTexture's default flipY then puts canvas row 0 (top, larger model y) at
    // v=1 on a default-UV PlaneGeometry (local +Y, up) -- so "model y up" must map to "small canvas py" here.
    const py = CANVAS_PX / 2 - ((p.y - cy) / halfExtentMm) * (CANVAS_PX / 2);
    const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
    const grad = g.createRadialGradient(px, py, 0, px, py, rPx);
    grad.addColorStop(0, `rgba(${rgb},${perRayAlpha})`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.beginPath();
    g.arc(px, py, rPx, 0, Math.PI * 2);
    g.fillStyle = grad;
    g.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; // the canvas pixels are already sRGB-encoded (see look.ts's own note)
  texture.needsUpdate = true;
  return {
    texture,
    halfExtentMm,
    dispose() {
      texture.dispose();
    },
  };
}
