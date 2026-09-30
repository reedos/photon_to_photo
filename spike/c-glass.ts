// Spike (c): a lens element built with LatheGeometry from a sag profile, MeshPhysicalNodeMaterial
// with transmission/ior/thickness/dispersion, and a ray fan drawn through it. The ray paths here
// are a placeholder fan (straight lines converging on a focal point, offset per wavelength to
// hint chromatic aberration) -- NOT a Snell's-law trace. That is workstream 2's job; this page
// only proves the material + geometry + line-through-glass combination renders, and measures
// its cost.
import * as THREE from 'three/webgpu';
import { LineSegments2 } from 'three/addons/lines/webgpu/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { createRenderer, measureFps, readPixelRGBA, report, reportError } from './common/harness.ts';

const WIDTH = 800;
const HEIGHT = 600;

function spectrumColorJS(t: number): [number, number, number] {
  const r = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 3)));
  const g = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 2)));
  const b = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 1)));
  return [r, g, b];
}

// Biconvex lens profile (Lathe convention: x = radius, y = position along the revolve axis,
// which is Y here -- LatheGeometry always revolves around Y). Spherical sag only, arbitrary
// scene units, not a real prescription: this is a rendering test, not the physics engine's data.
function buildLensGeometry(): THREE.LatheGeometry {
  const R_AP = 1.2; // aperture radius
  const RC = 3.0; // radius of curvature, both surfaces (symmetric biconvex)
  const halfT = 0.25; // center half-thickness
  const sag = (r: number) => RC - Math.sqrt(RC * RC - r * r);

  const N = 48;
  const points: THREE.Vector2[] = [];
  for (let i = 0; i <= N; i++) {
    const r = (i / N) * R_AP;
    points.push(new THREE.Vector2(r, halfT - sag(r)));
  }
  for (let i = N; i >= 0; i--) {
    const r = (i / N) * R_AP;
    points.push(new THREE.Vector2(r, -halfT + sag(r)));
  }
  return new THREE.LatheGeometry(points, 64);
}

function buildCheckerTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cells = 8;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#e8e8ef' : '#2a3a55';
      ctx.fillRect((x * size) / cells, (y * size) / cells, size / cells, size / cells);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A placeholder fan: rays enter parallel to the axis at several heights, "bend" at a fixed point
// near the lens and converge toward a focal point that is offset slightly per ray (standing in
// for a wavelength-dependent focal shift / longitudinal chromatic aberration, for visual purposes
// only -- the offset is not derived from any dispersion calculation).
function buildRayFan(): { positions: Float32Array; colors: Float32Array; count: number } {
  const RAYS = 15;
  const heights: number[] = [];
  for (let i = 0; i < RAYS; i++) heights.push(-1 + (2 * i) / (RAYS - 1));
  const zEnter = -3;
  const zBend = -0.1;
  const positions: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < RAYS; i++) {
    const h = heights[i] * 0.9; // stay within aperture
    const u = i / (RAYS - 1);
    const [r, g, b] = spectrumColorJS(u);
    const focalZ = 2.2 + (u - 0.5) * 0.5; // per-"wavelength" focal shift, illustrative only
    // segment 1: entrance -> bend point (parallel to axis)
    positions.push(h, 0, zEnter, h, 0, zBend);
    colors.push(r, g, b, r, g, b);
    // segment 2: bend point -> focal point
    positions.push(h, 0, zBend, 0, 0, focalZ);
    colors.push(r, g, b, r, g, b);
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors), count: RAYS * 2 };
}

async function main() {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  document.body.appendChild(canvas);

  const { renderer, backend, timestampSupported } = await createRenderer(canvas);

  try {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, WIDTH / HEIGHT, 0.1, 100);
    camera.position.set(0, 1.6, 6);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.2));
    const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
    dirLight.position.set(3, 4, 5);
    scene.add(dirLight);

    // backdrop so transmission/refraction has something to bend
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 4),
      new THREE.MeshBasicNodeMaterial({ map: buildCheckerTexture() })
    );
    backdrop.position.z = -3.5;
    scene.add(backdrop);

    const lensGeometry = buildLensGeometry();
    const lensMaterial = new THREE.MeshPhysicalNodeMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.03,
      transmission: 1,
      ior: 1.5168, // typical crown-glass nd, NOT sourced for this spike -- placeholder value
      thickness: 0.5,
      dispersion: 3,
    });
    const lens = new THREE.Mesh(lensGeometry, lensMaterial);
    lens.rotation.x = Math.PI / 2; // Lathe revolves around Y; put the optical axis on Z
    scene.add(lens);

    const { positions, colors, count } = buildRayFan();
    const rayGeometry = new LineSegmentsGeometry();
    rayGeometry.setPositions(positions);
    rayGeometry.setColors(colors);
    const rayMaterial = new THREE.Line2NodeMaterial({ vertexColors: true, linewidth: 2, toneMapped: false });
    const rays = new LineSegments2(rayGeometry, rayMaterial);
    scene.add(rays);

    const result: Record<string, unknown> = { backend, ok: true, lensSegments: 64 };

    // --- render once, screenshot-equivalent pixel readback: is the ray fan visible where it
    // crosses the lens silhouette, and is the checker backdrop visibly bent by the glass? -------
    const rt = new THREE.RenderTarget(WIDTH, HEIGHT);
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    // Project a point known to sit on a ray, inside the lens silhouette (bend point of the
    // central ray, world (0,0,-0.1)) to screen space, then sample it back.
    camera.updateMatrixWorld(true);
    const centerRayPoint = new THREE.Vector3(0, 0, -0.1).project(camera);
    const px = Math.round(((centerRayPoint.x + 1) / 2) * WIDTH);
    const py = Math.round(((1 - centerRayPoint.y) / 2) * HEIGHT);

    const rayPixel = await readPixelRGBA(renderer, rt, backend, px, py, HEIGHT);
    // A background-only sample away from any ray, still inside the lens silhouette, for contrast.
    const glassOnlyPixel = await readPixelRGBA(
      renderer, rt, backend, Math.round(WIDTH / 2 + 60), Math.round(HEIGHT / 2 - 40), HEIGHT
    );

    result.visibilityCheck = {
      note: 'RGBA at the central ray’s bend point vs. a nearby glass-only point, both inside the lens silhouette',
      rayPixel,
      glassOnlyPixel,
      distinguishable:
        Math.abs(rayPixel[0] - glassOnlyPixel[0]) +
          Math.abs(rayPixel[1] - glassOnlyPixel[1]) +
          Math.abs(rayPixel[2] - glassOnlyPixel[2]) >
        20,
    };

    // render() renders straight to the canvas going forward
    renderer.render(scene, camera);

    // --- GPU cost of one frame (lens transmission + ray fan) -------------------------------
    let gpuRenderMs: number | null = null;
    if (timestampSupported) {
      try {
        renderer.render(scene, camera);
        gpuRenderMs = (await renderer.resolveTimestampsAsync('render')) ?? null;
      } catch (e) {
        gpuRenderMs = null;
      }
    }
    result.gpuRenderMs = gpuRenderMs;

    // --- fps with a slow orbit, so transmission's background-copy pass runs every frame -----
    let angle = 0;
    const fps = await measureFps(
      () => {
        angle += 0.01;
        camera.position.set(Math.sin(angle) * 6, 1.6, Math.cos(angle) * 6);
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
      },
      { warmupFrames: 10, durationMs: 1200 }
    );
    result.fps = fps;

    report(result as any);
  } catch (e) {
    reportError(backend, e);
  }
}

main();
