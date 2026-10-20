// Compiling a scene's pipelines ahead of its first frame, a branch at a time (score loop r4, Performance and reliability).
//
// three's node materials are built in JavaScript inside every compileAsync call, so one call for a whole camera rig (17
// distinct MeshPhysicalNodeMaterial builds) was one task of 1 to 2.5 s on a 4x-throttled phone, however asynchronous the
// GPU half of the call is. The level entries already split their scene into branches with a frame between them
// (stage.ts startEntryCompile); this is the same split for the camera rig's load and swaps and for the Models page.
import type * as THREE from 'three/webgpu';

export interface AsyncCompiler {
  compileAsync?: (scene: THREE.Object3D, camera: THREE.Camera, target?: THREE.Scene) => Promise<void>;
  backend?: { isWebGLBackend?: boolean };
}

/** The next animation frame: the browser paints and answers input between two compile steps. */
export const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function distinctMaterials(root: THREE.Object3D): number {
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(m)) for (const x of m) seen.add(x); else if (m) seen.add(m);
  });
  return seen.size;
}

/** Splits `root` into branches that each hold at most `maxMaterials` distinct materials where the tree allows it. A
 *  branch is a whole subtree (compileAsync compiles an object with everything under it), so a mesh with children is
 *  never split from them; the compile of the whole scene that follows catches anything a branch left out. */
export function splitBranches(root: THREE.Object3D, maxMaterials = 5): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const visit = (o: THREE.Object3D) => {
    if (!o.visible) return;
    const meshLike = (o as THREE.Mesh).isMesh || (o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite;
    if (o.children.length && (meshLike || distinctMaterials(o) > maxMaterials)) {
      if (meshLike) { out.push(o); return; } // the mesh and what hangs off it stay together
      for (const c of o.children) visit(c);
    } else out.push(o);
  };
  for (const c of root.children) visit(c);
  return out;
}

/** Compiles `root`'s pipelines in steps. Each branch is compiled with frustum culling off for the synchronous part of the
 *  call (the camera may not face every part yet), then a frame passes. `alive` stops the run when the work it serves is
 *  no longer wanted (another rig or level took over). Then the whole of `scene` is compiled once, which is quick since
 *  every pipeline is cached by now, and picks up the lights and anything outside the branches. */
export async function compileInSteps(
  renderer: AsyncCompiler, root: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene,
  opts: { alive?: () => boolean; maxMaterials?: number; hold?: () => boolean; maxHoldMs?: number } = {},
): Promise<void> {
  const compile = renderer.compileAsync?.bind(renderer);
  if (!compile) return;
  const alive = opts.alive ?? (() => true);
  const withoutCulling = async (what: THREE.Object3D, run: () => Promise<void>) => {
    const culled: THREE.Object3D[] = [];
    what.traverse((o) => { if (o.frustumCulled) { o.frustumCulled = false; culled.push(o); } });
    let pending: Promise<void>;
    try { pending = run(); } finally { for (const o of culled) o.frustumCulled = true; }
    await pending;
  };
  // `hold`: while it answers true the next branch waits (a modal dialog with its own animation is open, and a compile step
  // is a 100 ms task in its frames), for at most `maxHoldMs` in all, so a dialog left open cannot hold the scene for ever.
  let held = 0;
  const maxHold = opts.maxHoldMs ?? 20000;
  for (const branch of splitBranches(root, opts.maxMaterials)) {
    while (opts.hold?.() && held < maxHold && alive()) { await new Promise<void>((resolve) => setTimeout(resolve, 250)); held += 250; }
    if (!alive()) return;
    await withoutCulling(branch, () => compile(branch, camera, scene));
    await nextFrame();
  }
  if (!alive()) return;
  await withoutCulling(scene, () => compile(scene, camera));
}

// three's compileAsync builds the two passes of a transparent two-sided material as one two-sided pipeline (score loop r5).
// A transparent material with side DoubleSide is drawn in two passes (back faces, then front faces): renderObject() flips
// material.side to BackSide and FrontSide around each pass's work. In compileAsync that work only queues the render
// objects; their pipelines are made later, in its own loop, after the side has been put back to DoubleSide, so both
// passes are keyed (and compiled) as DoubleSide. The first real frame then creates the back and front pipelines itself,
// synchronously: 6 to 9 of them on the Focus and Optics levels (which is most of those levels' first frame), and the
// compile that preceded it had been for nothing. The wrapper below gives each queued render object the side its pass
// will have when it is drawn, for the length of its pipeline lookup, and only while a compile is running (compileAsync
// passes an array of promises; a real draw passes none).
const FRONT = 0, BACK = 1, DOUBLE = 2; // three's FrontSide, BackSide and DoubleSide
interface RenderObjectLike { __p2pPass?: string; material?: { transparent?: boolean; side: number; forceSinglePass?: boolean } }
interface PipelinesLike { getForRender?: (renderObject: RenderObjectLike, promises?: unknown) => unknown; __p2pDoublePass?: boolean }
interface ObjectsLike { get?: (...args: unknown[]) => RenderObjectLike }
export function fixDoublePassCompile(renderer: object): void {
  const { _pipelines: pipelines, _objects: objects } = renderer as { _pipelines?: PipelinesLike; _objects?: ObjectsLike };
  if (!pipelines || typeof pipelines.getForRender !== 'function' || pipelines.__p2pDoublePass || !objects || typeof objects.get !== 'function') return;
  // a render object does not keep the pass it was made for: the objects store hands it the pass id (the eighth argument)
  const getObject = objects.get.bind(objects);
  objects.get = (...args) => { const renderObject = getObject(...args); renderObject.__p2pPass = args[7] as string | undefined; return renderObject; };
  const original = pipelines.getForRender.bind(pipelines);
  pipelines.getForRender = (renderObject, promises) => {
    const m = renderObject?.material;
    if (!Array.isArray(promises) || !m || m.transparent !== true || m.side !== DOUBLE || m.forceSinglePass !== false) return original(renderObject, promises);
    m.side = renderObject.__p2pPass === 'backSide' ? BACK : FRONT;
    try { return original(renderObject, promises); } finally { m.side = DOUBLE; }
  };
  pipelines.__p2pDoublePass = true;
}
