"""Aperture review, 10/11/2026: draws each lens's element sections before (the surveyed clear apertures) and after
(capped to physical edges, src/engine/edges.ts), one above the other, from the JSON tools/review-loop/apertures.ts
writes. Glass is drawn semi-transparent, so glass inside glass shows darker; capped elements are outlined in amber.

  npx tsx tools/review-loop/apertures.ts docs/review-loop-2026-10-10/apertures/after.json FULL.json
  python tools/review-loop/apertures-sections.py FULL.json OUTDIR [ids...]
"""
import json, sys, os
from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
want = sys.argv[3:]
data = json.load(open(src, encoding='utf-8'))
os.makedirs(out, exist_ok=True)
W, PANEL, PAD = 1200, 330, 30
try:
    font = ImageFont.truetype('arial.ttf', 18)
except OSError:
    font = ImageFont.load_default()

for lid, rep in data.items():
    if want and lid not in want:
        continue
    d = rep['drawing']
    allz = [p[0] for side in ('before', 'after') for e in d[side] for p in e['front'] + e['back']] + [d['stop'][0]]
    allr = [p[1] for side in ('before', 'after') for e in d[side] for p in e['front'] + e['back']]
    z0, z1, rmax = min(allz), max(allz), max(allr)
    s = min((W - 2 * PAD) / (z1 - z0), (PANEL - 2 * PAD) / (2 * rmax))
    img = Image.new('RGB', (W, 2 * PANEL), (246, 246, 244))
    for k, side in enumerate(('before', 'after')):
        layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
        dr = ImageDraw.Draw(layer)
        cy = k * PANEL + PANEL / 2
        X = lambda z: PAD + (z - z0) * s + ((W - 2 * PAD) - (z1 - z0) * s) / 2
        for e in d[side]:
            for sign in (1, -1):
                poly = [(X(z), cy - sign * r * s) for z, r in e['front']] + [(X(z), cy - sign * r * s) for z, r in reversed(e['back'])]
                dr.polygon(poly, fill=(60, 110, 170, 95))
        img = Image.alpha_composite(img.convert('RGBA'), layer).convert('RGB')
        dr = ImageDraw.Draw(img)
        for e in d[side]:
            col = (205, 120, 0) if e['capped'] else (40, 70, 110)
            for sign in (1, -1):
                poly = [(X(z), cy - sign * r * s) for z, r in e['front']] + [(X(z), cy - sign * r * s) for z, r in reversed(e['back'])]
                dr.line(poly + [poly[0]], fill=col, width=2 if e['capped'] else 1)
        zs, rs = d['stop']
        dr.line([(X(zs), cy - rs * s - 14), (X(zs), cy - rs * s)], fill=(0, 0, 0), width=3)
        dr.line([(X(zs), cy + rs * s), (X(zs), cy + rs * s + 14)], fill=(0, 0, 0), width=3)
        dr.line([(PAD / 2, cy), (W - PAD / 2, cy)], fill=(170, 170, 170), width=1)
        label = f"{lid} {side}: " + ('surveyed clear apertures (realize.ts survey only)' if side == 'before'
                                    else f"capped to physical edges, {len(rep['capped'])} surfaces (amber = capped element)")
        dr.text((PAD / 2, k * PANEL + 6), label, fill=(20, 20, 20), font=font)
    img.save(os.path.join(out, f'{lid}-sections.webp'), quality=88)
    print('wrote', lid)
