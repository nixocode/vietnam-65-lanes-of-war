#!/usr/bin/env python3
"""Bring rendered props into the game's palette and line treatment.

Straight out of Blender the scenery is far more saturated than the troops —
vivid green palms and orange timber beside muted olive soldiers. Same camera,
wrong palette, and it still reads as two art sets. This desaturates, darkens and
warms them onto the game's dusty range, then strokes the same dark outline the
soldiers carry so the line weight matches too.

Idempotent via a ledger, exactly like tools/outline_sprites.py — running it twice
would double-tone and double-stroke.

The ledger keys on a CONTENT HASH, not mtime. It used to key on mtime, which git
does not preserve: after a fresh clone every prop looked untoned, so the next run
would have re-graded and re-stroked all of them — 0.80 applied twice is 0.64, and
a second 4px rim on top of the first is an 8px black border. The guard existed
and did not hold.
"""
import hashlib
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
# (mul, warm-shift) or (mul, warm-shift, sat_keep) to override the global
# saturation pull for one prop.
FIXUP = {
    # Measured at Lmean 119-121, the BRIGHTEST things in the whole prop set —
    # brighter than sky-lit palm fronds — and in frame they read as heaps of
    # eggs rather than filled hessian. 0.74 was not nearly enough.
    'sandbags_pile': (0.56, (0.048, 0.028, -0.010)),
    'sandbag_wall':  (0.56, (0.048, 0.028, -0.010)),
    'sandbags_row':  (0.59, (0.044, 0.026, -0.008)),
    'sandbag_one':   (0.59, (0.044, 0.026, -0.008)),
    # The donor palms are near-fully-saturated tropical green. Measured after the
    # global grade at 0.66-0.68 saturation against 0.25-0.37 for every other prop,
    # with green running 14-17 points above red — the only vivid thing in a dusty
    # frame, and the first thing the eye went to. palm_a took the global grade
    # well; b/c/d start much greener and need their own pull.
    'palm_b':        (0.60, (0.034, 0.020, 0.004), 0.30),
    'palm_c':        (0.60, (0.034, 0.020, 0.004), 0.30),
    'palm_d':        (0.60, (0.034, 0.020, 0.004), 0.30),
    # At Lmean 83 this was the palest thing on the ground and scattered bright
    # straw across the field at random — noise where the frame needs structure.
    'grass_a':       (0.78, (0.014, 0.010, 0.002)),
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
    sat_keep = fix[2] if (fix and len(fix) > 2) else 0.66
    for c in range(3):
        rgb[:, :, c] = lum + (rgb[:, :, c] - lum) * sat_keep
    rgb *= 0.80
    # dust and dry earth, so scenery shares the field's cast
    rgb[:, :, 0] += 0.045; rgb[:, :, 1] += 0.032; rgb[:, :, 2] += 0.008
    if fix:
        mul, warm = fix[0], fix[1]
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


def digest(p):
    h = hashlib.sha1()
    with open(p, 'rb') as f:
        for blk in iter(lambda: f.read(1 << 16), b''):
            h.update(blk)
    return h.hexdigest()


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
        if done.get(f) == digest(p):
            skipped += 1
            continue
        process(p)
        done[f] = digest(p)
        n += 1
    json.dump(done, open(lp, 'w'))
    print('toned %d (%d already done) in %s' % (n, skipped, d))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'assets/props')
