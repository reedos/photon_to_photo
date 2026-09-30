"""Turns the Blender studio renders (renders/raw/*.png, from blender/*_v2.py --render) into phone-sized WebP files in
renders/web/, which tools/review-build.mjs publishes as the dashboard's gallery. renders/ is gitignored.

    python tools/renders-web.py
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW, WEB = os.path.join(ROOT, 'renders', 'raw'), os.path.join(ROOT, 'renders', 'web')
os.makedirs(WEB, exist_ok=True)
n = 0
for f in sorted(os.listdir(RAW)):
    if not f.endswith('.png'):
        continue
    src, dst = os.path.join(RAW, f), os.path.join(WEB, f[:-4] + '.webp')
    if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
        continue
    im = Image.open(src).convert('RGB')
    if im.width > 1400:
        im = im.resize((1400, round(im.height * 1400 / im.width)), Image.LANCZOS)
    im.save(dst, 'WEBP', quality=82, method=6)
    n += 1
print(f'{n} converted, {len(os.listdir(WEB))} in renders/web')
