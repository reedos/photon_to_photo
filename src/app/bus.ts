// A tiny app event bus, so pieces hear about UI events without touching the DOM that produced them.
//   'loupe-tap': { x, y }  a rendered-pixel coordinate the reader tapped on the final image (render-client's current
//                          render; ask pixelAt(renderId, x, y) for the real sensor pixel behind it)
//   'scenario-set': a partial scenario from a control on the 3D model (the camera's focus ring and dials)
//   'goto-piece': open another level (the camera's detail modes link into the loupe and the focus cone)
//   'select-part': a piece selected (or cleared) one of its parts itself (a pin tap, Esc, Back): the list follows
//   'piece-loading': a piece is fetching its models (progress 0..1 when known); the stage veils the view and holds
//                    the pins back until it says loading: false
//   'piece-retry': the veil's Retry after a piece reported a load error: the piece loads its models again in place
//   'pick-part': { id }   a tap on the 3D model itself landed on a part (the camera level): the stage selects it as its pin would
//   'hover-part': { id }  the pointer is over a part of the model (or off every part): its pin's name shows
//   'reset-view': frame the current level (and its picked part) again, as the Reset view button does; the guided tour asks
//                 for it on entering a stop, so a stop's picture matches its words even after the reader orbited
//   'layer': the view's layer chips (Rays on/off) -- the camera hides its traced light when Rays is off
type Events = { 'loupe-tap': { x: number; y: number; renderId: number }; 'scenario-set': Partial<import('../engine/types').Scenario>;
  'pause-exposure': Record<string, never>;
  'pause-tour': Record<string, never>;
  /** a button set the camera to a photograph's recorded settings: say so (toast and screen-reader announcement) */
  'camera-set': { text: string };
  /** a piece's open part card shows a value that changed without a scenario change (the Optics inset's magnification) */
  'card-stale': { piece: 'camera' | 'lens' | 'cone' | 'loupe' };
  'play-photo': { example: import('./examples').Example; source: HTMLElement };
  'goto-piece': { piece: 'camera' | 'lens' | 'cone' | 'loupe' }; 'select-part': { id: string | null };
  'piece-loading': { id: string; loading: boolean; progress?: number; label?: string; error?: string; retry?: boolean; compiling?: boolean; quiet?: boolean;
    /** a failed swap: the lens the view still shows, which "Keep current lens" goes back to (score loop r4) */ keep?: string };
  'piece-retry': { id: string }; 'reset-view': Record<string, never>; 'pick-part': { id: string | null }; 'hover-part': { id: string | null }; 'layer': { id: 'rays'; on: boolean } };
type Name = keyof Events;
// one untyped store behind the typed on/emit (a mapped type over two event shapes defeats ??= inference)
const handlers: Partial<Record<Name, Set<(e: never) => void>>> = {};

export function on<K extends Name>(name: K, cb: (e: Events[K]) => void): () => void {
  const set = (handlers[name] ??= new Set()) as unknown as Set<(e: Events[K]) => void>;
  set.add(cb);
  return () => set.delete(cb);
}

// Listeners to every event: the stage draws on demand and draws the frames after any app event (score loop r2).
const anyHandlers = new Set<(name: Name) => void>();
export function onAny(cb: (name: Name) => void): () => void {
  anyHandlers.add(cb);
  return () => anyHandlers.delete(cb);
}

export function emit<K extends Name>(name: K, e: Events[K]): void {
  for (const cb of (handlers[name] ?? []) as unknown as Set<(e: Events[K]) => void>) cb(e);
  for (const cb of anyHandlers) cb(name);
}

// The last tap, for a piece that is built after the tap happened (the loupe is built lazily on first show).
let lastTap: Events['loupe-tap'] | null = null;
on('loupe-tap', (e) => { lastTap = e; });
export function lastLoupeTap(): Events['loupe-tap'] | null { return lastTap; }
