#!/usr/bin/env python3
"""Stroke a dark outline around rendered sprites.

Doing this in post rather than with an inverted-hull mesh keeps the render solid
and gives the same thick line the hand-painted art uses.

The pass rewrites files in place, so running it twice would stroke the stroke and
thicken the line. A ledger of the mtimes this tool itself wrote makes it safe to
re-run over a directory where only some frames were re-rendered.
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

LEDGER = '.outlined.json'


def outline(path, width=3, colour=(26, 30, 20)):
    im = Image.open(path).convert('RGBA')
    a = np.array(im)
    solid = a[:, :, 3] > 110
    grown = ndimage.binary_dilation(solid, np.ones((3, 3)), iterations=width)
    rim = grown & ~solid
    out = a.copy()
    out[rim] = (*colour, 255)
    Image.fromarray(out).save(path)


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
        outline(p)
        done[f] = os.path.getmtime(p)
        n += 1
    json.dump(done, open(lp, 'w'))
    print('outlined %d (%d already done) in %s' % (n, skipped, d))


if __name__ == '__main__':
    main(sys.argv[1])
