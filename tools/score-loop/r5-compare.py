"""Score loop r5: compares two folders of same-named screenshots and prints how many pixels differ (by more than 8 levels in any channel).
   python tools/score-loop/r5-compare.py shots/r5-before shots/r5-after
"""
import sys, os
from PIL import Image, ImageChops
a, b = sys.argv[1], sys.argv[2]
for name in sorted(os.listdir(a)):
    if not name.endswith('.png') or not os.path.exists(os.path.join(b, name)):
        continue
    x, y = Image.open(os.path.join(a, name)).convert('RGB'), Image.open(os.path.join(b, name)).convert('RGB')
    if x.size != y.size:
        print(f'{name}: sizes differ {x.size} {y.size}'); continue
    diff = ImageChops.difference(x, y).convert('L').point(lambda v: 255 if v > 8 else 0)
    n = sum(1 for v in diff.getdata() if v)
    box = diff.getbbox()
    print(f'{name}: {n} of {x.size[0] * x.size[1]} pixels differ ({100 * n / (x.size[0] * x.size[1]):.3f}%), box {box}')
