"""Reproduce the approved October 2026 color pass from untouched source JPEGs.

Usage: python tools/color-correct-photos.py SOURCE_FOLDER
Requires Pillow and NumPy. Writes only the eight recipe photos and their catalog
paths. Source files are read-only; correction always starts from those originals.
"""
from pathlib import Path
import argparse
import hashlib
import io
import json
import numpy as np
from PIL import Image, ImageCms, ImageOps

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'public/examples'
RECIPES = json.loads((ROOT / 'tools/photo-color-recipes.json').read_text())
SRGB = ImageCms.createProfile('sRGB')
ICC = ImageCms.ImageCmsProfile(SRGB).tobytes()


def correct(im, recipe):
    """Pointwise tone/color adjustments, tiled to bound temporary memory use."""
    w, h = im.size
    result = np.empty((h, w, 3), dtype=np.uint8)
    xx = np.arange(w, dtype=np.float32)[None, :] / w
    for top in range(0, h, 256):
        end = min(h, top + 256)
        a = np.asarray(im.crop((0, top, w, end)), dtype=np.float32) / 255
        yy = np.arange(top, end, dtype=np.float32)[:, None] / h
        lin = np.where(a <= .04045, a / 12.92, ((a + .055) / 1.055) ** 2.4)
        lum = lin @ np.array([.2126, .7152, .0722], dtype=np.float32)
        stops = np.full((end - top, w), recipe['baseStops'], dtype=np.float32)
        if recipe['id'] == 'sheep-flock':
            t = np.clip((yy - .34) / .28, 0, 1)
            stops *= t * t * (3 - 2 * t)
        for x, y, sx, sy, strength in recipe['softMasks']:
            stops += strength * np.exp(-.5 * (((xx-x)/sx)**2 + ((yy-y)/sy)**2))
        protect = np.clip(1 - lum / .85, 0, 1) ** 1.5
        lin *= np.exp2(stops * protect)[..., None]
        b = np.where(lin <= .0031308, lin * 12.92, 1.055 * np.maximum(lin, 0)**(1/2.4) - .055)
        b += (recipe['contrast'] - 1) * 4 * (b - .5) * b * (1 - b)
        if recipe['id'] == 'mallard':
            l = b @ np.array([.2126, .7152, .0722], dtype=np.float32)
            green = np.clip((b[:, :, 1] - np.maximum(b[:, :, 0], b[:, :, 2])) / .20, 0, 1)
            b = l[..., None] + (b - l[..., None]) * (1 - .14 * green[..., None])
        warm = recipe['warmth']
        if warm:
            b[:, :, 0] += warm * b[:, :, 0] * (1 - b[:, :, 0])
            b[:, :, 2] -= warm * b[:, :, 2] * (1 - b[:, :, 2])
        assert np.isfinite(b).all()
        result[top:end] = np.uint8(np.round(np.clip(b, 0, 1) * 255))
    return Image.fromarray(result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    args = parser.parse_args()
    catalog_path = ASSETS / 'examples.json'
    catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
    entries = {entry['id']: entry for entry in catalog['examples']}
    stale = set()
    for recipe in RECIPES:
        source = args.source / recipe['source']
        checksum = hashlib.sha256(source.read_bytes()).digest()
        with Image.open(source) as original:
            im = ImageOps.exif_transpose(original)
            if original.info.get('icc_profile'):
                im = ImageCms.profileToProfile(im, ImageCms.ImageCmsProfile(io.BytesIO(original.info['icc_profile'])), SRGB, outputMode='RGB')
            else:
                im = im.convert('RGB')
            adjusted = correct(im, recipe)
        entry = entries[recipe['id']]
        w, h = adjusted.size
        assert (w, h) == (entry['width'], entry['height'])
        preview = adjusted.copy()
        preview.thumbnail((3200, 3200), Image.Resampling.LANCZOS)
        thumb = adjusted.copy()
        thumb.thumbnail((320, 320), Image.Resampling.LANCZOS)
        side = min(w, h) * .2
        x = max(0, min(w - side, w * entry['subject']['x'] - side / 2))
        y = max(0, min(h - side, h * entry['subject']['y'] - side / 2))
        detail = adjusted.crop((round(x), round(y), round(x + side), round(y + side)))
        detail.thumbnail((1800, 1800), Image.Resampling.LANCZOS)
        for field, suffix, image, quality, subsampling in [
            ('image', 'preview', preview, 85, 2),
            ('fullImage', 'full', adjusted, 88, 0),
            ('thumb', 'thumb', thumb, 80, 2),
            ('detailImage', 'detail', detail, 90, 0),
        ]:
            name = f"{recipe['id']}-color1-{suffix}.jpg"
            image.save(ASSETS / name, quality=quality, subsampling=subsampling, optimize=True, progressive=True, icc_profile=ICC)
            if entry[field] != name:
                stale.add(entry[field])
            entry[field] = name
        assert hashlib.sha256(source.read_bytes()).digest() == checksum
        print(f"{recipe['id']}: {w} x {h}; four corrected sRGB assets", flush=True)
    catalog_path.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    referenced = {entry[field] for entry in entries.values() for field in ('image', 'fullImage', 'thumb', 'detailImage')}
    for name in stale - referenced:
        path = (ASSETS / name).resolve()
        assert path.parent == ASSETS.resolve() and path.suffix == '.jpg'
        path.unlink()


if __name__ == '__main__':
    main()
