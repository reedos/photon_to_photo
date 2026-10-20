# Score loop round 6: builds the before | after WebP evidence in docs/score-loop/r6-visual/ from shots/r6/{before,after}.
#   python tools/score-loop/r6-evidence.py
from PIL import Image
import os

B, A, D = 'shots/r6/before', 'shots/r6/after', 'docs/score-loop/r6-visual'
os.makedirs(D, exist_ok=True)

def pair(out, box, scale, before, after):
    tiles = []
    for p in (before, after):
        im = Image.open(p).convert('RGB').crop(box)
        tiles.append(im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS))
    gap = 8
    sheet = Image.new('RGB', (sum(t.width for t in tiles) + gap, max(t.height for t in tiles)), (40, 40, 40))
    x = 0
    for t in tiles:
        sheet.paste(t, (x, 0)); x += t.width + gap
    sheet.save(f'{D}/{out}.webp', quality=86)
    print(out, sheet.size)

pair('pixel', (0, 400, 2200, 1730), 0.5, f'{B}/loupe.png', f'{A}/loupe.png')
pair('optics', (100, 500, 1300, 1700), 0.7, f'{B}/lens.png', f'{A}/lens.png')
pair('focus', (0, 600, 1800, 1400), 0.5, f'{B}/cone.png', f'{A}/cone.png')
pair('focus-z800', (0, 500, 1800, 1500), 0.5, f'{B}/cone800.png', f'{A}/cone800.png')
pair('cutaway-mirrorless', (400, 480, 1900, 1730), 0.5, f'{B}/cut-m50.png', f'{A}/cut-m50.png')
pair('cutaway-dslr', (400, 480, 1900, 1730), 0.5, f'{B}/cut-n50.png', f'{A}/cut-n50.png')
pair('rays-key', (0, 700, 1600, 1750), 0.5, f'{B}/cam-n50-2x.png', f'{A}/cam-n50.png')
pair('phone-pixel', (0, 500, 780, 1500), 0.6, f'{B}/loupe-phone.png', f'{A}/loupe-phone.png')
pair('phone-optics', (0, 540, 780, 1150), 0.7, f'{B}/lens-phone.png', f'{A}/lens-phone.png')
pair('phone-focus', (0, 540, 780, 1150), 0.7, f'{B}/cone-phone-2.png', f'{A}/cone-phone.png')
pair('land-pixel', (0, 140, 1100, 760), 0.6, f'{B}/loupe-land.png', f'{A}/loupe-land.png')
pair('land-focus', (0, 140, 1100, 760), 0.6, f'{B}/cone-land.png', f'{A}/cone-land.png')
