// Score loop r6: the Method page's one live figure. A thin-lens schematic in drawing units: drag the point toward or away from the
// lens and its rays meet in front of, on or behind a fixed sensor, so the point is a dot only at one distance and a disk at every
// other. The numbers are drawing units chosen to fit the picture (nothing here is a measured size, and none is shown); the
// relationship drawn is the thin-lens rule 1/f = 1/do + 1/di with similar triangles for the disk, which is textbook optics.
// The real app traces every ray through the real lens surfaces; the caption says so.

/** Drawing units. The lens stands at x = LENS_X, the sensor SENSOR_D behind it; the lens's focal length is FOCAL. */
export const FIG = { w: 520, h: 200, lensX: 350, axisY: 100, halfAperture: 38, focal: 60, sensorD: 88 } as const;

/** The object distance at which the fixed sensor is exactly in focus: 1/f = 1/do + 1/s. */
export const FOCUSED_DO = (FIG.focal * FIG.sensorD) / (FIG.sensorD - FIG.focal);

export interface FocusGeometry {
  /** The point's x in the picture. */
  objectX: number;
  /** Image distance behind the lens (thin-lens rule). */
  imageD: number;
  /** x where the rays meet. */
  imageX: number;
  /** x of the sensor. */
  sensorX: number;
  /** Diameter of the disk the rays make on the sensor (0 when in focus), in drawing units. */
  blur: number;
  state: 'sharp' | 'short' | 'long';
}

/** `objectD`: distance from the lens to the point, in drawing units, more than FIG.focal. */
export function focusGeometry(objectD: number): FocusGeometry {
  const d = Math.max(objectD, FIG.focal * 1.05);
  const imageD = (FIG.focal * d) / (d - FIG.focal);
  const blur = (2 * FIG.halfAperture * Math.abs(imageD - FIG.sensorD)) / imageD;
  const state = blur < 0.6 ? 'sharp' : imageD > FIG.sensorD ? 'long' : 'short';
  return { objectX: FIG.lensX - d, imageD, imageX: FIG.lensX + imageD, sensorX: FIG.lensX + FIG.sensorD, blur: state === 'sharp' ? 0 : blur, state };
}

export const SLIDER = { min: 105, max: 330 } as const;

const NOTE: Record<FocusGeometry['state'], string> = {
  sharp: 'The rays meet exactly on the sensor, so the point lands as a point.',
  long: 'The point is nearer than the sensor is set for: the rays would meet behind the sensor, so they land as a disk.',
  short: 'The point is farther than the sensor is set for: the rays meet in front of the sensor and spread again, landing as a disk.',
};

function svgInner(g: FocusGeometry): string {
  const { lensX, axisY, halfAperture, h } = FIG;
  const top = axisY - halfAperture, bot = axisY + halfAperture;
  const ray = (y: number) => `<path d="M${g.objectX.toFixed(1)} ${axisY} L${lensX} ${y} L${g.imageX.toFixed(1)} ${axisY}" />`;
  // continue each ray past the image point only when the sensor lies beyond it (the rays have crossed by then)
  const beyond = (y: number) => {
    const slope = (axisY - y) / (g.imageX - lensX);
    return g.sensorX > g.imageX ? `<path d="M${g.imageX.toFixed(1)} ${axisY} L${g.sensorX.toFixed(1)} ${(axisY + slope * (g.sensorX - g.imageX)).toFixed(1)}" />` : '';
  };
  const disk = g.state === 'sharp'
    ? `<circle cx="${g.sensorX}" cy="${axisY}" r="3.4" fill="#fff0bb"/>`
    : `<ellipse cx="${g.sensorX}" cy="${axisY}" rx="2.4" ry="${Math.min(g.blur / 2, 56).toFixed(1)}" fill="#ffc471" fill-opacity=".55" stroke="#ffc471"/>`;
  return `<g stroke="currentColor" fill="none" stroke-width="1.3"><path d="M${lensX} ${top - 10} C${lensX + 14} ${axisY - 18} ${lensX + 14} ${axisY + 18} ${lensX} ${bot + 10} C${lensX - 14} ${axisY + 18} ${lensX - 14} ${axisY - 18} ${lensX} ${top - 10}Z" fill="currentColor" fill-opacity=".1" opacity=".85"/>`
    + `<line x1="${g.sensorX}" y1="${axisY - 62}" x2="${g.sensorX}" y2="${axisY + 62}" stroke-width="3.5" opacity=".75"/><line x1="8" y1="${axisY}" x2="${FIG.w - 8}" y2="${axisY}" stroke-dasharray="2 5" opacity=".3"/></g>`
    + `<g fill="none" stroke="#ffd18b" stroke-width="1.4">${ray(top)}${ray(bot)}${beyond(top)}${beyond(bot)}</g>`
    + `<circle cx="${g.objectX.toFixed(1)}" cy="${axisY}" r="4" fill="#fff0bb"/>${disk}`
    + `<g fill="currentColor" font-size="18" font-family="inherit"><text x="${Math.max(24, g.objectX - 4).toFixed(1)}" y="${axisY + 28}" text-anchor="middle">point</text><text x="${lensX}" y="${h - 8}" text-anchor="middle">lens</text><text x="${g.sensorX}" y="${h - 8}" text-anchor="middle">sensor</text></g>`;
}

export const RAY_FIG_HTML = (() => {
  const g = focusGeometry(FOCUSED_DO);
  return `<figure class="ref-fig ref-fig-live"><svg viewBox="0 0 ${FIG.w} ${FIG.h}" role="img" aria-label="Schematic: a point's rays pass through a lens and meet at one place; the sensor is fixed, so the point is sharp on it only at one distance" data-ray-fig><title>One point through a lens onto a fixed sensor</title>${svgInner(g)}</svg>`
    + `<label class="ref-fig-ctl"><span>Move the point</span><input type="range" min="${SLIDER.min}" max="${SLIDER.max}" step="1" value="${Math.round(FOCUSED_DO)}" data-ray-slider aria-describedby="ray-fig-note"><small>nearer <i aria-hidden="true">·</i> farther</small></label>`
    + `<p class="ref-fig-note" id="ray-fig-note" role="status" data-ray-note>${NOTE[g.state]}</p>`
    + `<figcaption>Schematic from the thin-lens rule, in drawing units with no sizes: the app traces every ray through the real lens surfaces.</figcaption></figure>`;
})();

/** Wires the figure found under `root` (a no-op without it). */
export function mountRayFigure(root: ParentNode): void {
  const svg = root.querySelector<SVGSVGElement>('[data-ray-fig]');
  const slider = root.querySelector<HTMLInputElement>('[data-ray-slider]');
  const note = root.querySelector<HTMLElement>('[data-ray-note]');
  if (!svg || !slider || !note) return;
  const title = svg.querySelector('title')?.outerHTML ?? '';
  const update = () => {
    const g = focusGeometry(Number(slider.value));
    svg.innerHTML = title + svgInner(g);
    if (note.textContent !== NOTE[g.state]) note.textContent = NOTE[g.state];
  };
  slider.addEventListener('input', update);
  update();
}
