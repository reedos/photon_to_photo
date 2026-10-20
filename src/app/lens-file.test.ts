import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import lenses from '../../public/models/lenses.json';
import { lensGlbPath, lensGlbPathFor } from './lens-file';

type Fact = { glb: string; glbLite?: string };
const FACTS = (lenses as unknown as { lenses: Record<string, Fact> }).lenses;

describe('the lens file a screen loads (score loop r6)', () => {
  it('is the lighter variant on a phone and the full file elsewhere, for every lens', () => {
    for (const [id, f] of Object.entries(FACTS)) {
      expect(lensGlbPath(f, false), id).toBe(`models/lenses/${id}.glb`);
      expect(lensGlbPath(f, true), id).toBe(`models/lenses/${id}.lite.glb`);
      expect(existsSync(`public/${lensGlbPath(f, true)}`), id).toBe(true);
    }
  });

  it('maps a path the same way (the opening prefetch names the file, not the fact)', () => {
    expect(lensGlbPathFor('models/lenses/n50.glb', true)).toBe('models/lenses/n50.lite.glb');
    expect(lensGlbPathFor('models/lenses/n50.glb', false)).toBe('models/lenses/n50.glb');
    expect(lensGlbPathFor('models/dslr.glb', true)).toBe('models/dslr.glb');
  });

  it('is what warm.ts, the camera rig and the lens piece load, so a phone never fetches the full file', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['src/scene/camera-rig.ts', 'src/pieces/lens/glb-barrel.ts']) {
      expect(readFileSync(file, 'utf8'), file).toContain('lensGlbPath(');
    }
    expect(readFileSync('src/app/warm.ts', 'utf8')).toContain('phoneLens(url)');
  });
});
