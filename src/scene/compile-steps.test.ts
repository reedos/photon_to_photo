import { fixDoublePassCompile } from './compile-steps';

// three's compileAsync keys the back and front passes of a transparent two-sided material as one two-sided pipeline (score loop r5);
// fixDoublePassCompile gives each queued render object the side its pass has when it is drawn, for its pipeline lookup only.
describe('compiling a transparent two-sided material ahead', () => {
  const FRONT = 0, BACK = 1, DOUBLE = 2;
  function fakeRenderer() {
    const seen: { side: number; promises: unknown }[] = [];
    const renderer = {
      _pipelines: { getForRender(renderObject: { material: { side: number } }, promises?: unknown) { seen.push({ side: renderObject.material.side, promises }); return renderObject; } },
      _objects: { get(...args: unknown[]) { return { material: args[1] as { side: number } }; } },
    };
    return { renderer, seen };
  }
  const glass = () => ({ transparent: true, side: DOUBLE, forceSinglePass: false });

  it('keys the back pass as BackSide and the front pass as FrontSide while a compile is running, and restores the side', () => {
    const { renderer, seen } = fakeRenderer();
    fixDoublePassCompile(renderer);
    const material = glass();
    const back = renderer._objects.get({}, material, {}, {}, {}, {}, {}, 'backSide') as { material: typeof material };
    const front = renderer._objects.get({}, material, {}, {}, {}, {}, {}, undefined) as { material: typeof material };
    const promises: unknown[] = [];
    renderer._pipelines.getForRender(back, promises);
    renderer._pipelines.getForRender(front, promises);
    expect(seen.map((s) => s.side)).toEqual([BACK, FRONT]);
    expect(material.side).toBe(DOUBLE);
  });

  it('leaves a real draw, an opaque material and a single-pass material alone', () => {
    const { renderer, seen } = fakeRenderer();
    fixDoublePassCompile(renderer);
    const make = (material: object, pass?: string) => renderer._objects.get({}, material, {}, {}, {}, {}, {}, pass) as { material: { side: number } };
    renderer._pipelines.getForRender(make(glass(), 'backSide'));                                          // a draw passes no promises
    renderer._pipelines.getForRender(make({ transparent: false, side: DOUBLE, forceSinglePass: false }), []);
    renderer._pipelines.getForRender(make({ transparent: true, side: DOUBLE, forceSinglePass: true }), []);
    renderer._pipelines.getForRender(make({ transparent: true, side: FRONT, forceSinglePass: false }), []);
    expect(seen.map((s) => s.side)).toEqual([DOUBLE, DOUBLE, DOUBLE, FRONT]);
  });

  it('wraps a renderer once, and ignores one whose internals are not where it expects them', () => {
    const { renderer } = fakeRenderer();
    fixDoublePassCompile(renderer);
    const wrapped = renderer._pipelines.getForRender;
    fixDoublePassCompile(renderer);
    expect(renderer._pipelines.getForRender).toBe(wrapped);
    expect(() => fixDoublePassCompile({})).not.toThrow();
    expect(() => fixDoublePassCompile({ _pipelines: {}, _objects: {} })).not.toThrow();
  });
});
