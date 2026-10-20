import { bodyForLens, normalizeScenario } from './engine-api';
import { mayGuess, prefetchOnIntent, shouldWarm, WARM_ASSETS, whenReaderIsHere } from './warm';
import bodies from '../../public/models/bodies.json';
import lenses from '../../public/models/lenses.json';
import { existsSync, readFileSync } from 'node:fs';
import { normalMapFile } from './look';

describe('warming the camera from the opening (score loop r3)', () => {
  it('fetches the kit a first visit opens with', () => {
    const scenario = normalizeScenario({});
    const body = bodyForLens(scenario.lens)!;
    const bodyGlb = (bodies as unknown as Record<string, { glb: string }>)[body].glb.replace(/^public\//, '');
    const lensGlb = (lenses as unknown as { lenses: Record<string, { glb: string }> }).lenses[scenario.lens].glb.replace(/^public\//, '');
    expect(WARM_ASSETS.buffers).toContain(bodyGlb);
    expect(WARM_ASSETS.buffers).toContain(lensGlb);
  });

  it('names files that exist', () => {
    for (const file of [...WARM_ASSETS.buffers, ...WARM_ASSETS.images]) expect(existsSync(`public/${file}`), file).toBe(true);
  });

  it('respects Save-Data and 2G', () => {
    expect(shouldWarm(undefined)).toBe(true);
    expect(shouldWarm({ effectiveType: '4g' })).toBe(true);
    expect(shouldWarm({ saveData: true, effectiveType: '4g' })).toBe(false);
    expect(shouldWarm({ effectiveType: '2g' })).toBe(false);
    expect(shouldWarm({ effectiveType: 'slow-2g' })).toBe(false);
    expect(shouldWarm({ effectiveType: '3g' })).toBe(false);
  });

  it('waits for a sign that someone is reading, then starts once', () => {
    const fired: string[] = [];
    const target = new EventTarget();
    const stop = whenReaderIsHere(() => fired.push('go'), target);
    expect(fired).toEqual([]);
    target.dispatchEvent(new Event('pointermove'));
    target.dispatchEvent(new Event('scroll'));
    expect(fired).toEqual(['go']);
    stop();
  });

  it('every normal map the GLBs name ships as the file look.ts loads, and the opening warms those', () => {
    const named = new Set<string>();
    for (const glb of ['public/models/dslr.glb', 'public/models/mirrorless.glb']) {
      const b = readFileSync(glb);
      const json = JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12))) as { materials?: { extras?: { normalMap?: string } }[] };
      for (const m of json.materials ?? []) if (m.extras?.normalMap) named.add(m.extras.normalMap);
    }
    expect(named.size).toBeGreaterThan(0);
    for (const path of named) {
      expect(existsSync(`public/models/${normalMapFile(path)}`), path).toBe(true);
      expect(WARM_ASSETS.images).toContain(`models/${normalMapFile(path)}`);
    }
  });
});

describe('guessing what the reader asks for next (score loop r5)', () => {
  it('fetches nothing on a metered, Save-Data, slower or unreported connection', () => {
    expect(mayGuess({ effectiveType: '4g' })).toBe(true);
    expect(mayGuess({ effectiveType: '4g', type: 'wifi' })).toBe(true);
    expect(mayGuess({ effectiveType: '4g', type: 'cellular' })).toBe(false);
    expect(mayGuess({ effectiveType: '4g', saveData: true })).toBe(false);
    expect(mayGuess({ effectiveType: '3g' })).toBe(false);
    expect(mayGuess(undefined)).toBe(false);
  });

  it('listens for a lens button only where a guess is allowed, and fetches that lens once', async () => {
    const urls: string[] = [];
    vi.stubGlobal('location', { href: 'http://example.test/' });
    vi.stubGlobal('fetch', vi.fn((url: string) => { urls.push(String(url)); return Promise.resolve(new Response(new ArrayBuffer(1))); }));
    try {
      const metered = new EventTarget();
      const add = vi.spyOn(metered, 'addEventListener');
      prefetchOnIntent(() => ['./a.glb'], metered, { effectiveType: '4g', type: 'cellular' });
      expect(add).not.toHaveBeenCalled();

      const target = new EventTarget();
      const stop = prefetchOnIntent((id) => [`./models/lenses/${id}.glb`, './models/mirrorless.glb'], target, { effectiveType: '4g' });
      const button = { closest: () => ({ dataset: { lens: 'z35' } }) };
      const point = () => { const e = new Event('pointerover'); Object.defineProperty(e, 'target', { value: button }); target.dispatchEvent(e); };
      point(); point();
      expect(urls.map((u) => u.replace('http://example.test/', ''))).toEqual(['models/lenses/z35.glb', 'models/mirrorless.glb']);
      stop();
    } finally { vi.unstubAllGlobals(); }
  });
});
