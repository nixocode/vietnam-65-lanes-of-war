"""Render scenery props to 2D through the SAME camera the soldiers use.

The world was drawn in a different visual language from the troops: buildings in
3/4 view standing next to strictly-profile men, which reads as a collage no amount
of character work fixes. These props come off a locked orthographic side camera
with the same lighting rig, so a hooch and a rifleman finally agree on where the
viewer is standing.

Each prop records its real height in metres. The game already knows a soldier is
1.8 m drawn at 84 px, so every prop can be placed at the correct relative size
rather than eyeballed.

Run:
  Blender -b --python tools/render_props.py -- --out assets/props --res 512
"""
import json
import math
import os
import sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# CDN uuid -> the name the game knows it by. Without this a re-render drops a
# fresh set of uuid-named PNGs beside the renamed ones and silently doubles the
# manifest, which is exactly what happened the first time.
GLB_NAME = {
    '00e71997-0e9f-4083-9507-3935639996c7': 'sandbags_pile',
    '07d9ceb2-8b8d-4eba-8823-a7d39c8aeb20': 'hut_a',
    '1ac1bf37-184f-4e45-98a8-9da30bf37ffa': 'palm_a',
    '21d44b5b-efef-4abd-96ad-fc59e4ad373b': 'palm_b',
    '36d65045-d2ff-4689-a34d-a4acbe1873cb': 'frame_a',
    '4c17decd-3087-4afe-9611-cfd92cca47cd': 'palm_c',
    '4dd57aa3-e10b-43c8-9661-080167b1e060': 'stall',
    '5a6e6186-ab59-4c81-a5e1-9beb5e1bb8e9': 'sandbags_row',
    '5c18a372-e0fb-490f-aa90-8bdd04d7e92f': 'sandbag_one',
    '66cd7d94-abba-471e-8d8b-c8ad30aa5c70': 'palm_d',
    '76843ec7-2056-43ed-853e-d32d0b8253c4': 'frame_b',
    '8d6e4780-251c-49f6-9a49-b28ea28a03f8': 'hut_b',
    '96654c1e-dbc8-4bbc-a1c0-0dfacd8e9d93': 'sandbag_wall',
    '99bbd0c0-b60d-4923-bfbf-a7849e26766f': 'hut_c',
    'a0c33317-3662-478e-b826-78590c348d83': 'frame_c',
    'd4bcb445-6ef3-4aef-b39c-3bacd95f1b29': 'village_row',
    'd80aaa87-23d8-4e45-83a2-5ffd22c36356': 'rock',
    # 88fb0209 is a 26 m row of seedlings — a whole scene, not a prop
}
SRC = arg('--src', os.path.join(ROOT, 'art', 'props'))
OUT = arg('--out', os.path.join(ROOT, 'assets', 'props'))
RES = int(arg('--res', '512'))
ONLY = arg('--only')
os.makedirs(OUT, exist_ok=True)


# ---------------------------------------------------------------- built props
# Some scenery has no CC0 model worth downloading — a Vietnam firebase watchtower
# is legs, a platform and a thatch roof, which is box geometry. Building it here
# keeps it on the same camera and the same palette as everything else.

def _box(mat, x0, y0, z0, x1, y1, z1):
    import bmesh
    me = bpy.data.meshes.new('b')
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('b', me)
    bpy.context.collection.objects.link(ob)
    # create_cube(size=1) spans -0.5..0.5, so the scale IS the span. Halving it
    # here made every box half its intended size and nothing touched anything —
    # which is why the first built props came out as a pile of loose sticks.
    ob.scale = (x1 - x0, y1 - y0, z1 - z0)
    ob.location = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    ob.data.materials.append(mat)
    return ob


def _pmat(name, rgb, rough=0.9):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    if b:
        b.inputs['Base Color'].default_value = (*rgb, 1)
        b.inputs['Roughness'].default_value = rough
        if 'Metallic' in b.inputs:
            b.inputs['Metallic'].default_value = 0.0
    return m


def _beam(mat, x0, z0, x1, z1, t=0.11, y=0.0, yt=0.11):
    """A timber running between two points in the XZ plane, drawn as a rotated box.

    A side-on sprite lives or dies on its diagonals: axis-aligned boxes alone read
    as a pile of loose slats, which is exactly how the first tower came out.
    """
    import math as _m
    dx, dz = x1 - x0, z1 - z0
    L = _m.hypot(dx, dz)
    ob = _box(mat, -L / 2, -yt, -t, L / 2, yt, t)
    ob.rotation_euler = (0, -_m.atan2(dz, dx), 0)
    ob.location = ((x0 + x1) / 2, y, (z0 + z1) / 2)
    return ob


def build_watchtower():
    """Legs, X-bracing, a railed platform and a thatch roof.

    Heavier timber than looks right in plan: at 84px-per-1.8m a 10cm member is
    under two pixels and vanishes, so everything is sized to read at game scale
    rather than to be structurally plausible.
    """
    wood = _pmat('tw_wood', (0.115, 0.070, 0.032))
    dark = _pmat('tw_dark', (0.062, 0.041, 0.021))
    thatch = _pmat('tw_thatch', (0.190, 0.150, 0.070))
    H, P = 5.2, 3.5
    BW, TW = 1.15, 0.72                       # half-width at base and platform
    for sy in (-0.62, 0.62):                  # near and far leg pairs
        for sx in (-1, 1):
            _beam(wood, sx * BW, 0, sx * TW, P, t=0.15, y=sy, yt=0.13)
    for i, (z0, z1) in enumerate(((0.15, 1.75), (1.75, 3.35))):
        w0 = BW + (TW - BW) * (z0 / P)
        w1 = BW + (TW - BW) * (z1 / P)
        _beam(dark, -w0, z0, w1, z1, t=0.075, y=-0.66, yt=0.07)   # X bracing
        _beam(dark, w0, z0, -w1, z1, t=0.075, y=-0.66, yt=0.07)
        _box(wood, -w1 - 0.06, -0.7, z1 - 0.07, w1 + 0.06, 0.7, z1 + 0.07)
    _box(wood, -0.98, -0.76, P, 0.98, 0.76, P + 0.20)             # deck
    _box(dark, -0.98, -0.80, P + 0.20, 0.98, -0.62, P + 0.74)     # parapet
    _box(dark, -0.98, 0.62, P + 0.20, 0.98, 0.80, P + 0.74)
    for sx in (-1, 1):
        _box(wood, sx * 0.84 - 0.07, -0.72, P + 0.70, sx * 0.84 + 0.07, 0.72, H - 0.55)
    _box(thatch, -1.28, -0.95, H - 0.55, 1.28, 0.95, H - 0.24)    # eaves
    _box(thatch, -0.80, -0.62, H - 0.24, 0.80, 0.62, H)           # ridge
    for i in range(7):                                            # ladder
        z = 0.35 + i * 0.45
        _box(dark, -0.30, 0.60, z, 0.30, 0.70, z + 0.09)
    _beam(dark, -0.34, 0.1, -0.34, P, t=0.06, y=0.65, yt=0.05)
    _beam(dark, 0.30, 0.1, 0.30, P, t=0.06, y=0.65, yt=0.05)


def build_well():
    stone = _pmat('wl_stone', (0.105, 0.100, 0.092))
    wood = _pmat('wl_wood', (0.115, 0.070, 0.032))
    thatch = _pmat('wl_thatch', (0.190, 0.150, 0.070))
    _box(stone, -0.66, -0.66, 0, 0.66, 0.66, 0.70)            # kerb
    _box(stone, -0.74, -0.74, 0.70, 0.74, 0.74, 0.86)         # cap
    for sx in (-1, 1):
        _box(wood, sx * 0.52 - 0.09, -0.10, 0.86, sx * 0.52 + 0.09, 0.10, 1.92)
    _box(wood, -0.70, -0.12, 1.78, 0.70, 0.12, 1.98)          # headbeam
    _box(wood, -0.20, -0.16, 1.72, 0.20, 0.16, 1.86)          # winch drum
    _box(thatch, -0.92, -0.62, 1.96, 0.92, 0.62, 2.24)        # little roof
    _box(wood, -0.15, -0.15, 1.22, 0.15, 0.15, 1.56)          # bucket
    _beam(wood, -0.02, 1.56, -0.02, 1.72, t=0.03, yt=0.03)    # rope


def build_cart():
    wood = _pmat('ct_wood', (0.120, 0.074, 0.034))
    dark = _pmat('ct_dark', (0.058, 0.038, 0.019))
    _box(wood, -1.00, -0.52, 0.46, 1.00, 0.52, 0.66)          # bed
    _box(wood, -1.00, -0.56, 0.66, 1.00, -0.44, 1.00)         # sideboards
    _box(wood, -1.00, 0.44, 0.66, 1.00, 0.56, 1.00)
    _box(wood, -1.04, -0.52, 0.66, -0.92, 0.52, 1.00)         # tailgate
    for sx in (-1, 1):                                        # wheels, edge-on
        for sy in (-0.58, 0.48):
            _box(dark, sx * 0.44 - 0.09, sy, 0.02, sx * 0.44 + 0.09, sy + 0.10, 0.92)
            _beam(dark, sx * 0.44 - 0.34, 0.47, sx * 0.44 + 0.34, 0.47,
                  t=0.05, y=sy + 0.05, yt=0.05)
    _box(wood, 1.00, -0.13, 0.54, 1.86, -0.04, 0.64)          # shafts
    _box(wood, 1.00, 0.04, 0.54, 1.86, 0.13, 0.64)


# NOT SHIPPED. Two iterations of procedural box geometry (thicker timber, then
# diagonal X-bracing and a ladder) still read as a pile of loose sticks at game
# scale — worse than the painted watchtower they were meant to replace. The
# generators are kept because the approach is sound for simpler shapes and the
# camera/lighting plumbing is already here, but nothing below is in props.json.
# If this is picked up again, the missing ingredient is solid mass: a side-on
# sprite needs filled planes, not a wireframe of separate members.
def build_m113():
    """An M113 APC, side on.

    Box geometry failed badly on the watchtower, but that was an OPEN LATTICE —
    a frame of thin members with air between them. A hull is the opposite case:
    solid closed volumes, which is exactly what boxes are good at. Sloped glacis,
    slab sides, track run with road wheels, and the commander's .50 cupola.
    """
    hull = _pmat('v_hull', (0.088, 0.104, 0.056))
    dark = _pmat('v_dark', (0.038, 0.044, 0.026))
    steel = _pmat('v_steel', (0.030, 0.032, 0.034))
    L, W = 2.45, 1.30                       # half-length, half-width
    _box(hull, -L, -W, 0.62, L * 0.72, W, 1.70)          # main body
    # sloped glacis, stepped so it reads as a slope in profile
    for i in range(5):
        t0, t1 = i / 5, (i + 1) / 5
        _box(hull, L * 0.72 + (L * 0.28) * t0, -W, 0.62 + 0.90 * t0,
             L * 0.72 + (L * 0.28) * t1, W, 0.62 + 0.90 * t1 + 0.22)
    _box(dark, -L, -W - 0.06, 0.30, L * 0.92, -W + 0.10, 1.02)   # track guards
    _box(dark, -L, W - 0.10, 0.30, L * 0.92, W + 0.06, 1.02)
    for sy in (-W - 0.02, W - 0.10):                              # track runs
        _box(steel, -L * 0.96, sy, 0.10, L * 0.90, sy + 0.12, 0.66)
        for i in range(5):                                        # road wheels
            x = -L * 0.80 + i * (L * 1.62 / 4)
            _box(dark, x - 0.20, sy - 0.03, 0.06, x + 0.20, sy + 0.15, 0.56)
    _box(hull, -0.55, -0.48, 1.70, 0.35, 0.48, 2.06)              # cupola
    _box(steel, -0.10, -0.09, 2.06, 0.86, 0.09, 2.20)             # .50 cal
    _box(dark, -0.34, -0.30, 2.04, 0.02, 0.30, 2.24)              # shield
    _box(dark, L * 0.55, -0.50, 1.70, L * 0.72, 0.50, 1.84)       # driver hatch


# ---------------------------------------------------------------- foliage
# The maps had four palm silhouettes and nothing else, tiled across every lane,
# which reads as wallpaper the moment you look at the treeline. These are built
# rather than downloaded: an unidentified model off a search page has no name,
# no licence and no preview, and none of that belongs in a public repo.
#
# Box geometry suits these better than it suited the watchtower, which failed as
# a lattice of loose sticks. Bamboo IS a bundle of tapered culms; a burnt trunk
# IS a tapered pole with broken stubs; grass IS a fan of blades. The shapes are
# already boxy, so nothing has to pretend.
#
# Every one is asymmetric on purpose — an even, mirrored plant reads as a
# repeated stamp, and a repeated stamp is the problem being solved.

def build_bamboo():
    """A clump of culms. Vietnam's most characteristic screen of cover."""
    cane = _pmat('bm_cane', (0.150, 0.170, 0.062))
    dark = _pmat('bm_dark', (0.086, 0.104, 0.040))
    leaf = _pmat('bm_leaf', (0.110, 0.155, 0.055))
    culms = [(-0.62, 3.5, -0.10), (-0.30, 4.4, 0.05), (0.02, 3.9, -0.04),
             (0.30, 4.8, 0.12), (0.60, 3.2, 0.18), (0.14, 2.6, -0.16)]
    for i, (x, h, lean) in enumerate(culms):
        m = cane if i % 3 else dark
        _beam(m, x, 0.0, x + lean, h, t=0.055, y=(i % 3 - 1) * 0.07, yt=0.05)
        # nodes — the joints are what say bamboo rather than reed
        n = 3
        for k in range(1, n + 1):
            z = h * k / (n + 1.0)
            _box(dark, x - 0.075, -0.055, z, x + 0.075, 0.055, z + 0.045)
        # leaf sprays, upper third only
        for k in range(3):
            lz = h * (0.62 + 0.12 * k)
            sx = 1 if (i + k) % 2 else -1
            _beam(leaf, x + lean * 0.7, lz, x + lean * 0.7 + sx * (0.42 + 0.1 * k),
                  lz + 0.30 - 0.1 * k, t=0.035, y=(k - 1) * 0.06, yt=0.03)


def build_deadtree():
    """A shell-stripped trunk. Reads instantly as a fought-over place."""
    bark = _pmat('dt_bark', (0.088, 0.070, 0.048))
    char = _pmat('dt_char', (0.040, 0.034, 0.028))
    # tapered trunk, stacked so it narrows toward the break
    # One trunk, not a stack. Switching material halfway up put a hard grey/brown
    # seam across the middle and the whole thing read as blocks balanced on each
    # other. The bark darkens gradually toward the burnt top instead.
    seg = [(0.34, 0.0, 1.1), (0.27, 1.1, 2.3), (0.20, 2.3, 3.4), (0.14, 3.4, 4.2)]
    for i, (r, z0, z1) in enumerate(seg):
        lean = 0.05 * i
        t = i / (len(seg) - 1.0)
        m = _pmat('dt_seg%d' % i, (0.088 - 0.040 * t, 0.070 - 0.032 * t, 0.048 - 0.018 * t))
        _box(m, -r + lean, -r * 0.7, z0, r + lean, r * 0.7, z1)
    # broken stubs, none matching another
    _beam(char, 0.10, 2.05, 0.95, 2.62, t=0.075, y=0.05, yt=0.06)
    _beam(char, -0.05, 2.85, -0.78, 3.15, t=0.062, y=-0.04, yt=0.05)
    _beam(char, 0.16, 3.55, 0.58, 3.98, t=0.048, y=0.02, yt=0.04)
    _box(char, -0.16, -0.26, 4.20, 0.22, 0.26, 4.46)          # splintered top


def build_banana():
    """Broad drooping leaves — the shape nothing else on the map has.

    First attempt paired two straight beams per leaf and produced a flat zigzag
    lying on its side: 5.3 m wide and 1.9 m tall, when the plant is taller than
    it is wide. A leaf needs to be a CURVE, so each one is walked out in short
    segments that rise, flatten and then fall away at the tip.
    """
    stem = _pmat('bn_stem', (0.120, 0.140, 0.058))
    leaf = _pmat('bn_leaf', (0.135, 0.190, 0.062))
    dark = _pmat('bn_dark', (0.088, 0.125, 0.045))
    import math as _m
    _box(stem, -0.19, -0.17, 0.0, 0.19, 0.17, 1.25)           # pseudostem
    _box(stem, -0.15, -0.14, 1.25, 0.15, 0.14, 1.70)
    # (side, reach, base height, how far the tip falls)
    fronds = [(-1, 1.05, 1.62, 0.95), (1, 0.92, 1.70, 0.80),
              (-1, 0.74, 1.86, 0.55), (1, 0.66, 1.92, 0.45),
              (-1, 1.15, 1.38, 1.15), (1, 1.02, 1.30, 1.02)]
    for i, (sx, reach, z0, fall) in enumerate(fronds):
        m = leaf if i % 2 else dark
        y = (i - 2.5) * 0.055
        segs = 5
        px, pz = 0.0, z0
        for k in range(1, segs + 1):
            t = k / segs
            # rises early, falls late — a quarter-sine arc tipped over
            x = sx * reach * t
            z = z0 + _m.sin(t * _m.pi * 0.9) * 0.34 - fall * (t ** 2.2)
            _beam(m, px, pz, x, z, t=0.155 - 0.02 * k, y=y, yt=0.022)
            px, pz = x, z


def build_grass():
    """Elephant grass. Chest high and the reason nobody sees anybody."""
    pale = _pmat('gr_pale', (0.175, 0.180, 0.078))
    deep = _pmat('gr_deep', (0.108, 0.130, 0.050))
    import random as _r
    _r.seed(4)
    for i in range(44):
        x = -1.05 + 2.1 * (i / 43.0)
        h = 1.15 + _r.random() * 0.85
        lean = (_r.random() - 0.5) * 0.85
        _beam(deep if i % 3 else pale, x, 0.0, x + lean, h,
              t=0.034, y=(_r.random() - 0.5) * 0.34, yt=0.026)


BUILT = {
    'm113':       (build_m113, 2.6),
    'watchtower': (build_watchtower, 5.2),
    'well_a':     (build_well, 2.1),
    'cart_a':     (build_cart, 1.1),
    # foliage — real heights, so they scale against a 1.8 m soldier
    'bamboo_a':   (build_bamboo, 4.8),
    'deadtree_a': (build_deadtree, 4.5),
    'banana_a':   (build_banana, 2.7),
    'grass_a':    (build_grass, 1.8),
}


def scene_setup():
    sc = bpy.context.scene
    for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES'):
        try:
            sc.render.engine = eng
            break
        except Exception:
            continue
    try:
        sc.eevee.taa_render_samples = int(arg('--samples', '24'))
    except Exception:
        pass
    sc.render.film_transparent = True
    sc.render.resolution_x = RES
    sc.render.resolution_y = RES
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    return sc


def light_rig():
    """The soldiers' lighting, so props sit in the same sun."""
    key = bpy.data.lights.new('key', 'SUN'); key.energy = 3.6
    ko = bpy.data.objects.new('key', key); bpy.context.collection.objects.link(ko)
    ko.rotation_euler = (math.radians(52), 0, math.radians(38))
    fill = bpy.data.lights.new('fill', 'SUN'); fill.energy = 0.7
    fo = bpy.data.objects.new('fill', fill); bpy.context.collection.objects.link(fo)
    fo.rotation_euler = (math.radians(78), 0, math.radians(-126))
    rim = bpy.data.lights.new('rim', 'SUN'); rim.energy = 2.6
    rim.color = (1.0, 0.96, 0.84)
    ro = bpy.data.objects.new('rim', rim); bpy.context.collection.objects.link(ro)
    ro.rotation_euler = (math.radians(112), 0, math.radians(-24))
    w = bpy.data.worlds.new('w'); w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.30, 0.34, 0.30, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.30
    bpy.context.scene.world = w


def bounds():
    from mathutils import Vector
    lo = [1e9] * 3
    hi = [-1e9] * 3
    got = False
    for o in bpy.data.objects:
        if o.type != 'MESH' or o.name.lower().startswith(('icosphere', 'sphere')):
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                lo[i] = min(lo[i], w[i]); hi[i] = max(hi[i], w[i])
            got = True
    return (lo, hi) if got else None


def render_one(path, sc):
    stem = os.path.splitext(os.path.basename(path))[0]
    name = GLB_NAME.get(stem)
    if not name:
        return None            # not part of the shipped set
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = scene_setup()
    try:
        bpy.ops.import_scene.gltf(filepath=path)
    except Exception as e:
        print('SKIP', name, e)
        return None
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.name.lower().startswith(('icosphere', 'sphere')):
            bpy.data.objects.remove(o, do_unlink=True)
    b = bounds()
    if not b:
        print('SKIP', name, 'no geometry')
        return None
    lo, hi = b
    w = hi[0] - lo[0]
    h = hi[2] - lo[2]
    cx = (lo[0] + hi[0]) / 2
    cz = (lo[2] + hi[2]) / 2
    span = max(w, h) * 1.14

    light_rig()
    cam_d = bpy.data.cameras.new('cam')
    cam_d.type = 'ORTHO'
    cam_d.ortho_scale = span
    cam = bpy.data.objects.new('cam', cam_d)
    bpy.context.collection.objects.link(cam)
    cam.location = (cx, lo[1] - max(8.0, span * 3), cz)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam

    sc.render.filepath = os.path.join(OUT, name + '.png')
    bpy.ops.render.render(write_still=True)

    # ground row inside the frame, and the prop's true size in metres
    return {
        'name': name,
        'hM': round(h, 3),
        'wM': round(w, 3),
        'groundY': round(RES / 2 + ((cz - lo[2]) / span) * RES, 1),
        'ppm': round(RES / span, 2),
        'res': RES,
    }


def render_built(name, fn, sc):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = scene_setup()
    fn()
    # object matrices are lazy: without this the bounds come back as the unit
    # cube and every built prop measures 1x1 m
    bpy.context.view_layer.update()
    b = bounds()
    if not b:
        return None
    lo, hi = b
    w, h = hi[0] - lo[0], hi[2] - lo[2]
    cx, cz = (lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2
    span = max(w, h) * 1.14
    light_rig()
    cam_d = bpy.data.cameras.new('cam')
    cam_d.type = 'ORTHO'
    cam_d.ortho_scale = span
    cam = bpy.data.objects.new('cam', cam_d)
    bpy.context.collection.objects.link(cam)
    cam.location = (cx, lo[1] - max(8.0, span * 3), cz)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam
    sc.render.filepath = os.path.join(OUT, name + '.png')
    bpy.ops.render.render(write_still=True)
    return {'name': name, 'hM': round(h, 3), 'wM': round(w, 3),
            'groundY': round(RES / 2 + ((cz - lo[2]) / span) * RES, 1),
            'ppm': round(RES / span, 2), 'res': RES}


def main():
    sc = scene_setup()
    out = []
    for name, (fn, realh) in BUILT.items():
        if ONLY and ONLY not in name:
            continue
        m = render_built(name, fn, sc)
        if m:
            m['realH'] = realh
            m['aspect'] = round(m['wM'] / max(1e-4, m['hM']), 4)
            out.append(m)
            print('BUILT %-14s %.2f x %.2f m' % (name, m['wM'], m['hM']))
    files = sorted(f for f in os.listdir(SRC) if f.endswith('.glb'))
    if ONLY:
        files = [f for f in files if ONLY in f]
    for f in files:
        m = render_one(os.path.join(SRC, f), sc)
        if m:
            out.append(m)
            print('PROP %-40s %.2f x %.2f m' % (m['name'], m['wM'], m['hM']))
    # props.json already carries hand-authored real-world heights; a re-render
    # must not throw those away
    prev = {}
    pj = os.path.join(OUT, 'props.json')
    if os.path.isfile(pj):
        try:
            prev = {q['name']: q for q in json.load(open(pj)).get('props', [])}
        except Exception:
            prev = {}
    merged = dict(prev)
    for m in out:
        old = prev.get(m['name'], {})
        if 'realH' not in m and 'realH' in old:
            m['realH'] = old['realH']
        m['aspect'] = round(m['wM'] / max(1e-4, m['hM']), 4)
        merged[m['name']] = m
    # Drop entries whose PNG is gone.
    #
    # The merge above deliberately preserves hand-authored heights across a
    # re-render, but it also preserved props that no longer exist: deleting
    # `scrub_a` and its image left the entry in props.json, and the game then
    # asked for a file that was never committed. A fresh clone would 404 on it.
    # Only keep what is actually on disk.
    merged = {k: v for k, v in merged.items()
              if os.path.isfile(os.path.join(OUT, k + '.png'))}
    with open(pj, 'w') as fh:
        json.dump({'props': sorted(merged.values(), key=lambda q: q['name'])}, fh, indent=1)
    print('DONE', len(out), 'props')


main()
