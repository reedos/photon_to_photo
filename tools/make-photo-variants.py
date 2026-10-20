"""Smaller WebP copies of each example photograph's main image (score loop r3, 10/11/2026).

For every entry of public/examples/examples.json, writes public/examples/<name>-<w>.webp for each w in 800, 1200, 1600 and
2400 that is narrower than the image itself, the way the flycatcher's copies were made in score loop r1: Pillow,
Lanczos, WebP quality 80, the JPEG's ICC profile kept. src/app/image-variants.ts lists the copies; its test checks the
two agree. Existing copies are kept unless --force is given.

    python tools/make-photo-variants.py [--force]
"""
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
EXAMPLES = ROOT / 'public' / 'examples'
WIDTHS = (800, 1200, 1600, 2400)


def main() -> None:
    force = '--force' in sys.argv
    catalog = json.loads((EXAMPLES / 'examples.json').read_text(encoding='utf-8'))
    for entry in catalog['examples']:
        src = EXAMPLES / entry['image']
        with Image.open(src) as im:
            icc = im.info.get('icc_profile')
            w, h = im.size
            print(f'{src.name}: {w} x {h}')
            for width in WIDTHS:
                if width >= w:
                    continue
                out = EXAMPLES / f'{src.stem}-{width}.webp'
                if out.exists() and not force:
                    print(f'  keep {out.name}')
                    continue
                height = round(h * width / w)
                small = im.convert('RGB').resize((width, height), Image.Resampling.LANCZOS)
                kwargs = {'quality': 80}
                if icc:
                    kwargs['icc_profile'] = icc
                small.save(out, 'WEBP', **kwargs)
                print(f'  wrote {out.name} {width} x {height}, {out.stat().st_size} bytes')


if __name__ == '__main__':
    main()
