"""Collects blender/data/<id>-build.json (written by lens_v2.py --export) into public/models/lenses.json, the app's
index of the lens models: which body each mounts on, its published size, what the build had to clip, the parts.

  python blender/data/build-lens-manifest.py
"""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
IDS = ['s35', 'n50', 'n500', 'n500fl', 'z35', 'm50', 'z800']
BODY = {'nikonF': 'dslr', 'nikonZ': 'mirrorless'}
out = {
    'note': 'Built by blender/lens_v2.py from data/hardware/lens-exteriors.json and the engine prescriptions '
            '(blender/data/<id>-optics.json, infinity focus). Frame: mm, sensor plane z = 0, lens toward -z, the mount '
            'face at z = -flangeMm, as the bodies. Revolved parts come in pairs: extras.cutaway "full" for the outside '
            'view, "half" (x >= 0, section capped) for the cutaway. Draco-compressed: load with DRACOLoader '
            '(public/draco/).',
    'layoutEvidence': 'assumed: where rings, windows and switches sit along each barrel is read from product '
                      'photographs; no maker publishes it (lens-exteriors.json openProblems).',
    'lenses': {},
}
for i in IDS:
    b = json.load(open(os.path.join(ROOT, 'blender/data', f'{i}-build.json'), encoding='utf-8'))
    b['body'] = BODY[b['mount']]
    out['lenses'][i] = b
json.dump(out, open(os.path.join(ROOT, 'public/models/lenses.json'), 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
print('wrote public/models/lenses.json:', ', '.join(f"{i} {out['lenses'][i]['label']}" for i in IDS))
