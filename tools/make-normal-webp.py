"""Lossless WebP copies of the bodies' normal maps (score loop r3, 10/11/2026).

public/models/textures/<name>.png -> <name>.webp, lossless (the decoded pixels are identical to the PNG's), about 23%
smaller. The GLB extras and blender/common.py MAP_FILES still name the PNG, which the Blender scripts write and the
GLB tests read; src/app/look.ts loads the WebP in its place and checks nothing else. Run after the Blender scripts
rewrite a PNG:

    python tools/make-normal-webp.py
"""
from pathlib import Path

from PIL import Image

TEXTURES = Path(__file__).resolve().parent.parent / 'public' / 'models' / 'textures'

for png in sorted(TEXTURES.glob('*-normal.png')):
    out = png.with_suffix('.webp')
    with Image.open(png) as im:
        im.save(out, 'WEBP', lossless=True, quality=100, method=6)
    with Image.open(png) as a, Image.open(out) as b:
        assert a.convert('RGB').tobytes() == b.convert('RGB').tobytes(), f'{out.name} is not lossless'
    print(f'{png.name} {png.stat().st_size} -> {out.name} {out.stat().st_size} bytes (pixels identical)')
