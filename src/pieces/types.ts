// The piece contract, per docs/PROTOTYPE.md's "Code layout": a piece module exports `build(ctx) ->
// { group, update(model, scenario), frame(), probes, dispose() }`. Pieces never compute physics themselves --
// they read the Model engine-api.ts's compute() returns (and, for ray/bundle detail, lensFans/pointBundle) and
// draw it. If a piece needs a number the engine lacks, the fix is a new engine module or field, not math here.
import type * as THREE from 'three/webgpu';
import type { Model } from '../engine/model-types';
import type { Scenario } from '../engine/types';
import type * as look from '../app/look';

/** Anchors a HUD/pin label to a 3D point that moves with the camera; the stage owns the DOM/canvas overlay that
 *  actually draws it (src/app/stage.ts), so a piece never touches the DOM directly. */
export interface LabelLayer {
  set(id: string, opts: { world: THREE.Vector3; text: string; kind?: 'pin' | 'hud' }): void;
  remove(id: string): void;
  clear(prefix?: string): void;
}

/** design/LOOK.md's "scale badge": shown whenever a piece's picture is deliberately not to true scale or time,
 *  hidden when it is (e.g. the assembled lens cutaway at roughly true relative proportions). */
export interface ScaleBadge {
  show(text: string): void;
  hide(): void;
}

export interface PieceContext {
  renderer: THREE.Renderer;
  look: typeof look;
  labels: LabelLayer;
  badge: ScaleBadge;
  /** The stage's main camera and scene (read them; move the camera only through dive()). */
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  /** An absolutely positioned layer over the 3D view for a piece's own small controls (e.g. the cone's point
   *  distance slider). Style it with the site's classes; the stage clears it when the piece is hidden. */
  overlay: HTMLElement;
  /** Fly the camera to a frame with the LOOK.md dive timing (log dolly, 900 ms + 220 ms per decade, capped). */
  dive(to: CameraFrame): void;
  /** Rendered-pixel taps on the final image (the loupe) and other app events: see src/app/bus.ts. */
  bus: typeof import('../app/bus');
  /** The stage draws on demand (score loop r2): a piece that changes its meshes outside update(), tick() or an input
   *  event (an asset that arrives later, a debounced rebuild) asks for the next frames with this. */
  invalidate?(): void;
}

/** A second viewport the stage renders after the main view (scissored), e.g. a magnified detail of the image
 *  plane. rect is in CSS pixels inside the view, measured from its bottom-left corner. */
export interface Inset {
  id: string;
  camera: THREE.Camera;
  scene?: THREE.Scene;      // defaults to the main scene
  rect: { left: number; bottom: number; width: number; height: number };
  label?: string;           // drawn by the stage as a mono caption on the inset's frame
}

/** A numbered pin the right panel's part list can select (docs/PROTOTYPE.md: "clicking a part selects its
 *  pin"). `anchor` is in the piece group's local space; the stage projects group.localToWorld(anchor) to screen. */
export interface PieceProbe {
  id: string;
  label: string;
  anchor: THREE.Vector3;
  /** The part card the right panel shows when this pin or its list entry is selected. Every spec row with a number
   *  carries its evidence (a Fig from model.figs, or a Fig the piece builds from engine values with ev 'derived'). */
  card?(model: Model): PartCard;
}

export interface PartCard {
  kicker: string;              // e.g. "Level 1 · the iris"
  title: string;
  /** An explicit mono subtitle; when absent the title's final parenthetical becomes one (ui.ts splitTitle). */
  sub?: string;
  body: string;                // plain prose, one or two short paragraphs (no HTML)
  /** Score loop r4: the expert detail behind a long card, shown under a "More detail" disclosure. `body` leads with one
   *  plain sentence or two; whatever needs terms like paraxial or longitudinal color goes here. */
  more?: string;
  specs: { k: string; v: string; fig?: import('../engine/types').Fig }[];
  /** Rows kept under a "More settings" disclosure, for a card whose full list is longer than a first read needs (score loop r5). */
  moreSpecs?: { k: string; v: string; fig?: import('../engine/types').Fig }[];
}

export interface CameraFrame {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

export interface PieceHandle {
  group: THREE.Group;
  /** Applies a new Model/Scenario to the piece's existing meshes -- never rebuilds from scratch on every call. */
  update(model: Model, scenario: Scenario): void;
  /** The camera rig position/target this piece wants framed right now, for the stage's dive and Reset view. */
  frame(): CameraFrame;
  /** Stable framing for a selected probe, also used after resize, model updates and late asset loads. */
  selectionFrame?(id: string): CameraFrame;
  probes: PieceProbe[];
  dispose(): void;
  /** Called every animation frame while the piece is shown (physically timed mechanisms, arriving photons, dives).
   *  Returns whether it changed what the scene draws this frame: the stage skips drawing a frame in which nothing
   *  moved (score loop r2). A tick that returns nothing counts as animated, so the frame is drawn. */
  tick?(dtMs: number, nowMs: number): boolean | void;
  /** update() in two parts, for the idle precompile of a hidden level (score loop r6): the slow part (tracing the rays) runs here in short
   *  tasks, and the function it resolves to applies the result at once, as update() would. null: cancelled (a newer model arrived). */
  prepareUpdate?(model: Model, scenario: Scenario): Promise<(() => void) | null>;
  /** Draws, at full quality and now, any model change the piece has deferred (a coarse drag preview with the full trace
   *  owed, score loop r6). The stage calls it before a forced (settle) frame. */
  flush?(): void;
  /** The reader has taken control of the view by orbiting, panning or zooming. */
  onViewInteraction?(): void;
  /** Extra viewports to draw this frame (see Inset). */
  insets?(): Inset[];
  /** Test and accuracy-gate hooks, exposed as window.p2p.pieces[id] (e.g. probe(): rendered vs engine values). */
  hooks?: Record<string, (...args: any[]) => any>;
  activate?(): void;
  deactivate?(): void;
  /** What activate() does to the scene's own materials (the studio reflections), with none of the page's chrome, so the
   *  stage can compile this level's pipelines while another level is shown (score loop r5). */
  prepare?(): void;
  /** The part list or a pin picked one of this piece's probes (null clears it): the piece highlights the part. */
  select?(id: string | null): void;
}

export type BuildPiece = (ctx: PieceContext) => PieceHandle;
