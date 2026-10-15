# Crops for the score-loop evidence: python tools/score-loop/crop.py out.png x0,y0,x1,y1 [scale] in1.png [in2.png ...]
# Several inputs are placed side by side (before | after), each cropped to the same box and scaled.
import sys
from PIL import Image

out, box = sys.argv[1], [int(v) for v in sys.argv[2].split(',')]
rest = sys.argv[3:]
scale = 1.0
if rest and not rest[0].lower().endswith(('.png', '.webp', '.jpg')):
    scale = float(rest[0]); rest = rest[1:]
tiles = [Image.open(p).convert('RGB').crop(tuple(box)) for p in rest]
tiles = [t.resize((round(t.width * scale), round(t.height * scale)), Image.LANCZOS) for t in tiles]
gap = 8
sheet = Image.new('RGB', (sum(t.width for t in tiles) + gap * (len(tiles) - 1), max(t.height for t in tiles)), (40, 40, 40))
x = 0
for t in tiles:
    sheet.paste(t, (x, 0)); x += t.width + gap
sheet.save(out, quality=88) if out.endswith('.webp') else sheet.save(out)
print(out, sheet.size)
