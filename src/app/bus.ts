// A tiny app event bus, so pieces hear about UI events without touching the DOM that produced them.
//   'loupe-tap': { x, y }  a rendered-pixel coordinate the reader tapped on the final image (render-client's current
//                          render; ask pixelAt(renderId, x, y) for the real sensor pixel behind it)
//   'scenario-set': a partial scenario from a control on the 3D model (the camera's focus ring and dials)
//   'goto-piece': open another level (the camera's detail modes link into the loupe and the focus cone)
//   'select-part': a piece selected (or cleared) one of its parts itself (a pin tap, Esc, Back): the list follows
//   'piece-loading': a piece is fetching its models (progress 0..1 when known); the stage veils the view and holds
//                    the pins back until it says loading: false
//   'layer': the view's layer chips (Rays on/off) -- the camera hides its traced light when Rays is off
type Events = { 'loupe-tap': { x: number; y: number; renderId: number }; 'scenario-set': Partial<import('../engine/types').Scenario>;
  'pause-exposure': Record<string, never>;
  'pause-tour': Record<string, never>;
  'goto-piece': { piece: 'camera' | 'lens' | 'cone' | 'loupe' }; 'select-part': { id: string | null };
  'piece-loading': { id: string; loading: boolean; progress?: number; label?: string; error?: string }; 'layer': { id: 'rays'; on: boolean } };
type Name = keyof Events;
// one untyped store behind the typed on/emit (a mapped type over two event shapes defeats ??= inference)
const handlers: Partial<Record<Name, Set<(e: never) => void>>> = {};

export function on<K extends Name>(name: K, cb: (e: Events[K]) => void): () => void {
  const set = (handlers[name] ??= new Set()) as unknown as Set<(e: Events[K]) => void>;
  set.add(cb);
  return () => set.delete(cb);
}

export function emit<K extends Name>(name: K, e: Events[K]): void {
  for (const cb of (handlers[name] ?? []) as unknown as Set<(e: Events[K]) => void>) cb(e);
}

// The last tap, for a piece that is built after the tap happened (the loupe is built lazily on first show).
let lastTap: Events['loupe-tap'] | null = null;
on('loupe-tap', (e) => { lastTap = e; });
export function lastLoupeTap(): Events['loupe-tap'] | null { return lastTap; }
