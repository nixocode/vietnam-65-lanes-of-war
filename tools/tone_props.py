#!/usr/bin/env python3
"""Bring rendered props into the game's palette and line treatment.

Straight out of Blender the scenery is far more saturated than the troops —
vivid green palms and orange timber beside muted olive soldiers. Same camera,
wrong palette, and it still reads as two art sets. This desaturates, darkens and
warms them onto the game's dusty range, then strokes the same dark outline the
soldiers carry so the line weight matches too.

Idempotent via a ledger, exactly like tools/outline_sprites.py — running it twice
would double-tone and double-stroke.
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

LEDGER = '.toned.json'
OUTLINE = (26, 30, 20)

# Per-prop correction, applied after the global grade. The donor sandbags are a
# pale grey that reads as a heap of pebbles rather than filled hessian; they need
# to come down and go warm. (mul, warm-shift)
FIXUP = {
    'sandbags_pile': (0.74, (0.055, 0.030, -0.010)),
    'sandbag_wall':  (0.74, (0.055, 0.030, -0.010)),
    'sandbags_row':  (0.78, (0.050, 0.028, -0.008)),
    'sandbag_one':   (0.78, (0.050, 0.028, -0.008)),
    'rock':          (0.86, (0.020, 0.014, 0.004)),
    # the APC came out a pale grey slab next to olive infantry; armour should sit
    # DARKER than the men it carries, not lighter
    'm113':          (0.66, (-0.010, 0.004, -0.014)),
    'watchtower':    (0.88, (0.020, 0.012, 0.000)),
}


def tone(a, fix=None):
    rgb = a[:, :, :3].astype(np.float32) / 255.0
    mx = rgb.max(axis=2); mn = rgb.min(axis=2)
    lum = (0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2])
    # Pull saturation back, but not to grey. The first pass at 0.46 took the warmth
    # out of the timber and the earth out of the sandbags — huts read as concrete
    # and sandbag walls as pale boulders. Keep more of the colour and lean the
    # residue warm.
    sat_keep = 0.66
    for c in range(3):
        rgb[:, :, c] = lum + (rgb[:, :, c] - lum) * sat_keep
    rgb *= 0.80
    # dust and dry earth, so scenery shares the field's cast
    rgb[:, :, 0] += 0.045; rgb[:, :, 1] += 0.032; rgb[:, :, 2] += 0.008
    if fix:
        mul, warm = fix
        rgb *= mul
        for c in range(3):
            rgb[:, :, c] += warm[c]
    np.clip(rgb, 0, 1, out=rgb)
    a[:, :, :3] = (rgb * 255).astype(np.uint8)
    return a


def process(path, width=4):
    im = Image.open(path).convert('RGBA')
    a = np.array(im)
    a = tone(a, FIXUP.get(os.path.splitext(os.path.basename(path))[0]))
    solid = a[:, :, 3] > 110
    grown = ndimage.binary_dilation(solid, np.ones((3, 3)), iterations=width)
    rim = grown & ~solid
    a[rim] = (*OUTLINE, 255)
    Image.fromarray(a).save(path)


def main(d):
    lp = os.path.join(d, LEDGER)
    done = {}
    if os.path.isfile(lp):
        try:
            done = json.load(open(lp))
        except Exception:
            done = {}
    n = skipped = 0
    for f in sorted(os.listdir(d)):
        if not f.endswith('.png'):
            continue
        p = os.path.join(d, f)
        if done.get(f) == os.path.getmtime(p):
            skipped += 1
            continue
        process(p)
        done[f] = os.path.getmtime(p)
        n += 1
    json.dump(done, open(lp, 'w'))
    print('toned %d (%d already done) in %s' % (n, skipped, d))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'assets/props')
