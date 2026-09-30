// Spike (b): 20k spectral ray segments with per-vertex color, updated every frame from CPU data
// (stands in for the ray trace, which will run on the CPU or a worker at first). Tests thin
// lines (gl.LINES, THREE.LineSegments + LineBasicNodeMaterial) against fat lines
// (LineSegments2 + Line2NodeMaterial, screen-space width, from three/addons/lines/webgpu).
import * as THREE from 'three/webgpu';
import { LineSegments2 } from 'three/addons/lines/webgpu/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { createRenderer, measureFps, report, reportError } from './common/harness.ts';

const SEGMENTS = 20_000;
const VERTS = SEGMENTS * 2;

// Same coarse triangular-lobe spectrum approximation as spike (a), computed CPU-side here since
// this data is generated on the CPU (standing in for the ray trace) rather than in a GPU kernel.
function spectrumColorJS(t: number): [number, number, number] {
  const r = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 3)));
  const g = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 2)));
  const b = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - 1)));
  return [r, g, b];
}

// Fills flat (segments*6) position/color buffers with a rotating ray fan. Stands in for "the ray
// trace" re-running every frame and handing fresh segment endpoints + wavelengths to the renderer.
function buildRayData(t: number, positions: Float32Array, colors: Float32Array) {
  for (let i = 0; i < SEGMENTS; i++) {
    const u = i / SEGMENTS;
    const angle = u * Math.PI * 2 * 5 + t * 0.25;
    const elevation = Math.sin(u * Math.PI * 9 + t * 0.7) * 0.5;
    const len = 1.6 + 0.4 * Math.sin(u * 53 + t * 1.3);
    const ex = Math.cos(angle) * len;
    const ey = elevation;
    const ez = Math.sin(angle) * len;

    const p = i * 6;
    positions[p + 0] = 0;
    positions[p + 1] = 0;
    positions[p + 2] = 0;
    positions[p + 3] = ex;
    positions[p + 4] = ey;
    positions[p + 5] = ez;

    const [r, g, b] = spectrumColorJS(u);
    colors[p + 0] = r;
    colors[p + 1] = g;
    colors[p + 2] = b;
    colors[p + 3] = r;
    colors[p + 4] = g;
    colors[p + 5] = b;
  }
}

async function main() {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  document.body.appendChild(canvas);

  const { renderer, backend, timestampSupported } = await createRenderer(canvas);

  try {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 100);
    camera.position.set(0, 1.2, 4.5);
    camera.lookAt(0, 0, 0);

    const positions = new Float32Array(SEGMENTS * 6);
    const colors = new Float32Array(SEGMENTS * 6);
    buildRayData(0, positions, colors);

    // --- thin lines: plain BufferGeometry + LineBasicNodeMaterial (gl.LINES) -----------------
    const thinGeometry = new THREE.BufferGeometry();
    thinGeometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
    thinGeometry.setAttribute('color', new THREE.BufferAttribute(colors.slice(), 3));
    const thinMaterial = new THREE.LineBasicNodeMaterial({ vertexColors: true, toneMapped: false });
    const thinLines = new THREE.LineSegments(thinGeometry, thinMaterial);
    thinLines.frustumCulled = false;

    // --- fat lines: LineSegments2 + Line2NodeMaterial (screen-space or world-unit width) ------
    const fatGeometry = new LineSegmentsGeometry();
    fatGeometry.setPositions(positions);
    fatGeometry.setColors(colors);
    const fatMaterial = new THREE.Line2NodeMaterial({
      vertexColors: true,
      linewidth: 2, // screen-space pixels (worldUnits defaults to false)
      toneMapped: false,
    });
    const fatLines = new LineSegments2(fatGeometry, fatMaterial);
    fatLines.frustumCulled = false;

    const result: Record<string, unknown> = { backend, ok: true, segments: SEGMENTS };

    async function gpuRenderMs(): Promise<number | null> {
      if (!timestampSupported) return null;
      try {
        renderer.render(scene, camera);
        return (await renderer.resolveTimestampsAsync('render')) ?? null;
      } catch (e) {
        return null;
      }
    }

    // --- thin: measure per-frame CPU rebuild + upload + render -------------------------------
    scene.add(thinLines);
    let t = 0;
    const thinCpuMs: number[] = [];
    const thinFps = await measureFps(
      () => {
        const t0 = performance.now();
        buildRayData(t, positions, colors);
        (thinGeometry.attributes.position as THREE.BufferAttribute).array.set(positions);
        (thinGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        (thinGeometry.attributes.color as THREE.BufferAttribute).array.set(colors);
        (thinGeometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
        thinCpuMs.push(performance.now() - t0);
        t += 1 / 60;
        renderer.render(scene, camera);
      },
      { warmupFrames: 10, durationMs: 1200 }
    );
    const thinGpuMs = await gpuRenderMs();
    scene.remove(thinLines);
    result.thin = {
      fps: thinFps,
      cpuUpdateAvgMs: thinCpuMs.reduce((a, b) => a + b, 0) / thinCpuMs.length,
      gpuRenderMs: thinGpuMs,
    };

    // --- fat: measure per-frame CPU rebuild + setPositions/setColors (reallocates) + render --
    scene.add(fatLines);
    const fatCpuMs: number[] = [];
    const fatFps = await measureFps(
      () => {
        const t0 = performance.now();
        buildRayData(t, positions, colors);
        fatGeometry.setPositions(positions);
        fatGeometry.setColors(colors);
        fatCpuMs.push(performance.now() - t0);
        t += 1 / 60;
        renderer.render(scene, camera);
      },
      { warmupFrames: 10, durationMs: 1200 }
    );
    const fatGpuMs = await gpuRenderMs();
    result.fat = {
      fps: fatFps,
      cpuUpdateAvgMs: fatCpuMs.reduce((a, b) => a + b, 0) / fatCpuMs.length,
      gpuRenderMs: fatGpuMs,
      note: 'setPositions/setColors allocate new InstancedInterleavedBuffers every call; a real build would mutate the existing buffer in place instead.',
    };

    report(result as any);
  } catch (e) {
    reportError(backend, e);
  }
}

main();
