import { readdirSync, readFileSync } from 'node:fs';

// Score loop r4: learning.css lost the closing brace of an @media block. The dev server serves each stylesheet on its own,
// so the damage stayed inside that file there; the production build joins them, and every rule after the open block
// (the diffraction, ghost, perspective and photon-rain dialogs, and more) applied only at 901 px and wider. Four browser
// gates failed on the build and passed on the dev server for three rounds. Each stylesheet must open and close the same
// number of blocks.
describe('stylesheets are balanced', () => {
  const dir = 'src/styles';
  const files = readdirSync(dir).filter((f) => f.endsWith('.css'));
  it('finds the stylesheets', () => { expect(files.length).toBeGreaterThan(10); });
  for (const file of files) {
    it(`${file} closes every block it opens`, () => {
      const css = readFileSync(`${dir}/${file}`, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
      let depth = 0;
      for (const ch of css) {
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; expect(depth, `${file} closes a block it never opened`).toBeGreaterThanOrEqual(0); }
      }
      expect(depth, `${file} leaves ${depth} block(s) open`).toBe(0);
    });
  }
});
