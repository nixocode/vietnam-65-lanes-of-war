"""Pack rendered 3D sprite frames into one atlas per unit.

Every frame comes off the same locked orthographic camera, so all frames share
one anchor by construction — the atlas keeps that property by never cropping
per frame. Cells are a straight downscale of the render, nothing else.

The game needs two numbers to place a sprite: where the ground plane sits in a
cell, and how many pixels tall the figure's reference height is. Both fall out
of the camera setup rather than being measured off pixels, so they stay exact
even when a frame's silhouette does not touch the ground (a mid-air run frame).

Run:  python3 tools/pack_sprites3d.py
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'sprites3d')
# Atlas cell size. Soldiers draw at ~84-110px, so 128 is still oversampled, and
# dropping from 160 pays for the extra animation frames without growing the
# texture a browser has to hold — the new sheets are SMALLER than the old ones.
CELL = 128

# Fallback only. The render writes its actual camera into index.json, and that
# is what gets used — the two must never be able to drift apart.
FIG_H, ORTHO, CAM_Z = 1.8, 1.8 * 1.5, 1.8 * 0.52

# clip playback order is fixed so a frame index means the same thing everywhere
CLIP_ORDER = ['idle', 'idle2', 'walk', 'run', 'runfire', 'aim', 'fire',
              'hit', 'hit2', 'death', 'prone', 'throw', 'dive', 'melee']


def pack(unit):
    d = os.path.join(SRC, unit)
    ij = os.path.join(d, 'index.json')
    if not os.path.isfile(ij):
        return None
    idx = json.load(open(ij))
    res = idx.get('res', 256)

    names = []
    clips = {}
    for c in CLIP_ORDER + [k for k in idx['clips'] if k not in CLIP_ORDER]:
        frames = idx['clips'].get(c)
        if not frames:
            continue
        clips[c] = list(range(len(names), len(names) + len(frames)))
        names += frames

    n = len(names)
    cols = 8
    rows = (n + cols - 1) // cols
    atlas = Image.new('RGBA', (cols * CELL, rows * CELL), (0, 0, 0, 0))
    for i, nm in enumerate(names):
        f = os.path.join(d, nm + '.png')
        if not os.path.isfile(f):
            raise SystemExit('missing frame: ' + f)
        im = Image.open(f).convert('RGBA')
        if im.size != (CELL, CELL):
            im = im.resize((CELL, CELL), Image.LANCZOS)
        atlas.paste(im, ((i % cols) * CELL, (i // cols) * CELL))

    cam = idx.get('cam') or {}
    fig_h = cam.get('figH', FIG_H)
    ortho = cam.get('ortho', ORTHO)
    cam_z = cam.get('camz', CAM_Z)
    k = CELL / res
    meta = {
        'unit': unit,
        'cell': CELL,
        'cols': cols,
        'rows': rows,
        'count': n,
        # y within a cell where world z=0 (the ground) lands
        'groundY': round((res / 2 + (cam_z / ortho) * res) * k, 2),
        # pixels spanned by the figure's reference height
        'figH': round((fig_h / ortho) * res * k, 2),
        'clips': clips,
        # barrel tip per frame, in cell pixels — muzzle flashes start at the gun
        'muzzle': {c: [[round(p[0] * k, 1), round(p[1] * k, 1)] if p else None
                       for p in (idx.get('muzzle', {}).get(c) or [])]
                   for c in clips},
    }
    atlas.save(os.path.join(d, 'atlas.png'), optimize=True)
    json.dump(meta, open(os.path.join(d, 'atlas.json'), 'w'), indent=1)
    kb = os.path.getsize(os.path.join(d, 'atlas.png')) / 1024
    print('%-10s %3d frames  %dx%d  %.0f KB  ground=%.1f figH=%.1f'
          % (unit, n, atlas.width, atlas.height, kb, meta['groundY'], meta['figH']))
    return meta


def main():
    units = sys.argv[1:] or sorted(
        u for u in os.listdir(SRC) if os.path.isdir(os.path.join(SRC, u)))
    made = [u for u in units if pack(u)]
    # The manifest lists EVERY unit with a packed atlas, not just the ones packed
    # in this run — writing only `made` meant `pack_sprites3d.py rpgman` silently
    # reduced the game's roster to one man.
    have = sorted(u for u in os.listdir(SRC)
                  if os.path.isdir(os.path.join(SRC, u)) and
                  os.path.isfile(os.path.join(SRC, u, 'atlas.json')))
    json.dump({'units': have}, open(os.path.join(SRC, 'manifest.json'), 'w'), indent=1)
    print('packed %d units; manifest lists %d' % (len(made), len(have)))


main()
