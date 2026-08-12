"""Render a RIGGED 3D soldier into game-ready 2D sprite sheets.

This is the production path. Point it at a rigged character (FBX or glTF) plus
one or more animation files, and it renders each animation from a locked
orthographic side camera into transparent PNG frames, then writes a manifest the
game can load.

Every frame is the same model under the same camera and lights, so the character
cannot morph between frames — the failure mode that killed the AI-sheet approach.

Where to get a model, free:
  * mixamo.com — pick a character, then download animations as FBX
    ("Without Skin" for extra animations once you have the rigged base).
    Useful clips: Idle, Walking, Rifle Run, Rifle Aiming Idle, Firing Rifle,
    Crouch Walk, Prone Idle, Hit Reaction, Death From Front / Back.
  * sketchfab.com — search "soldier rigged", filter Downloadable + CC.

Run:
  /Applications/Blender.app/Contents/MacOS/Blender -b \
    --python tools/render_model_sprites.py -- \
    --model art/soldier.fbx --unit rifleman \
    --clip idle=art/anim_idle.fbx --clip run=art/anim_run.fbx --frames 12
"""
import bpy, math, os, sys, json

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


def args_all(name):
    return [argv[i + 1] for i, a in enumerate(argv) if a == name]


MODEL = arg('--model')
USE_BUILTIN = '--builtin' in argv     # animations already inside the model file
UNIT = arg('--unit', 'rifleman')
RES = int(arg('--res', '256'))
FRAMES = int(arg('--frames', '12'))
HEIGHT = float(arg('--height', '1.8'))
# Camera framing, as multiples of HEIGHT. The view must be wide enough for a
# rifle thrust forward mid-stride, or the barrel clips the edge of the cell.
ORTHO_K = 1.5
CAM_ZK = 0.52
ONLY = [c for c in (arg('--only', '') or '').split(',') if c]
NORENDER = '--norender' in argv   # re-derive muzzle points without redrawing frames
TURN = arg('--turn', '90')            # degrees about Z to face screen-right
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR = os.path.join(ROOT, 'assets', 'sprites3d', UNIT)
os.makedirs(OUTDIR, exist_ok=True)

# MODEL may be 'auto'; it is resolved from MODEL_FOR once that table is defined.


# frames per clip, and which clips wrap (a looping clip must not repeat its
# first pose as its last, so it samples i/N rather than i/(N-1))
# Frame counts are raised on everything that reads as MOTION. A 12-frame run
# stepping off distance travelled plays at roughly 10 animation-fps, which is
# visibly choppy next to a 60fps game — that choppiness is a large part of what
# reads as "arcade". The still-ish poses stay cheap.
CLIP_FRAMES = {'idle': 6, 'aim': 6, 'fire': 7, 'run': 18,
               'runfire': 18, 'walk': 14, 'death': 12, 'hit': 4, 'prone': 4,
               'idle2': 6, 'throw': 9, 'dive': 9, 'melee': 8, 'hit2': 4}
LOOPING = {'idle', 'idle2', 'run', 'runfire', 'walk', 'prone'}

# Clips where the donor is NOT holding a gun — Idle_Gun drops the arm to the
# soldier's side and Walk is empty-handed, so the rifle ends up hidden behind a
# leg or aimed at nothing. For these, an IK constraint pulls the firing hand to a
# carry position and the weapon, which rides that hand, comes with it.
CLIP_CARRY = {'idle': 1.0, 'walk': 1.0, 'idle2': 1.0}

# game state -> animation name inside the model (substring match, case-insensitive)
STATE_ACTIONS = {
    'idle':  'Idle_Gun',
    'aim':   'Idle_Gun_Pointing',
    'fire':  'Idle_Gun_Shoot',
    'run':   'Run_Shoot',      # the plain Run is empty-handed; this keeps the grip
    'runfire': 'Run_Shoot',
    'walk':  'Walk',
    'death': 'Death',
    'hit':   'HitRecieve',
    # more of the donor's 24 clips, so the field is not the same six poses:
    'idle2':  'Idle_Neutral',    # a second at-rest pose, picked per soldier
    'throw':  'Sword_Slash',     # overhand arc — reads as a grenade throw
    'dive':   'Roll',            # going to ground / diving into cover
    'melee':  'Punch_Right',     # butt-stroke, when the range closes to nothing
    'hit2':   'HitRecieve_2',    # a second flinch, so hits are not one animation
}

# the donor model is black SWAT kit; these push it to period-correct colours
# Which donor body each unit is built from. All five share one 62-bone skeleton
# and the same 24 mocap clips, so they are interchangeable — but they are
# different *people*: the SWAT is fully masked, while Farmer/Worker/Casual/
# Adventurer have separate head meshes with Skin, Eye, Eyebrow and Hair
# materials. Using peasant and workman bodies for the VC and NVA is both more
# period-appropriate and the thing that stops every soldier being one man
# repeated in different colours.
# Bodies are also spread ACROSS roles inside an army, not just between armies.
# A US fire team then mixes three silhouettes instead of being one man cloned:
# the gunner is bulkier, the engineer is masked and kitted, the rifleman plain.
MODEL_FOR = {
    'rifleman':  'soldier',     'arvn':     'casual',
    'm60':       'adventurer',  'engineer': 'swat',
    'recon':     'adventurer',  'sniper':   'soldier',
    'guerrilla': 'farmer',      'marksman': 'farmer',
    'sapper':    'hoodie',
    'nva':       'worker',      'rpd':      'worker',
    'rpgman':    'worker',
}

# Faction cloth colour. Applied as a tint that PRESERVES each material's original
# luminance, so a model's own light/dark structure (shirt vs trousers vs boots)
# survives instead of flattening into one slab of colour.
TINT = {
    'rifleman':  (0.215, 0.255, 0.120),  # US olive drab
    'arvn':      (0.300, 0.282, 0.170),  # ARVN khaki, a shade off US olive
    'nva':       (0.300, 0.228, 0.112),  # NVA warm tan
    'guerrilla': (0.075, 0.076, 0.082),  # VC black pyjamas, barely cool
}

# never tinted — this is what keeps them people rather than mannequins
SKIN_MATS = {'Skin', 'Skin_Darker', 'Eye', 'Eyebrows', 'Hair', 'Hair_Brown',
             'Moustache'}

# the donors' default skin is a pale civilian tone that blows out under the key
# light and reads as anaemic at game scale
SKIN_TONE = {'Skin': (0.300, 0.186, 0.108), 'Skin_Darker': (0.232, 0.142, 0.082)}

# units that share another unit's faction colours
PAL_ALIAS = {'m60': 'rifleman', 'engineer': 'rifleman', 'recon': 'rifleman',
             'sniper': 'rifleman', 'rpd': 'nva', 'sapper': 'guerrilla',
             'marksman': 'guerrilla', 'rpgman': 'nva'}

# helmet/hat tint per faction, so headgear does not all read as one olive lump
HAT_TINT = {
    'rifleman':  (0.095, 0.112, 0.062),
    'arvn':      (0.170, 0.160, 0.100),
    'nva':       (0.150, 0.120, 0.062),
    'guerrilla': (0.040, 0.042, 0.045),
}

def recolour(unit):
    """Repaint the donor into period colours, keeping its shading structure.

    Two things matter here. A base colour is ignored while an image texture is
    plugged into it, so the texture is unlinked first. And rather than flattening
    every cloth material to one value, each keeps its original relative
    luminance — that is what preserves boots reading darker than a shirt.
    """
    tint = TINT.get(PAL_ALIAS.get(unit, unit))
    if not tint:
        return
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        if m.name in SKIN_TONE:
            b = m.node_tree.nodes.get('Principled BSDF')
            if b:
                b.inputs['Base Color'].default_value = (*SKIN_TONE[m.name], 1)
                b.inputs['Roughness'].default_value = 0.92
            continue
        if m.name in SKIN_MATS:
            continue
        nt = m.node_tree
        for n in nt.nodes:
            if n.type != 'BSDF_PRINCIPLED':
                continue
            bc = n.inputs.get('Base Color')
            if not bc:
                continue
            rgb = tuple(bc.default_value[:3])
            if bc.is_linked:
                for lk in list(bc.links):
                    nt.links.remove(lk)
                rgb = (0.25, 0.25, 0.25)      # textured slots have no useful value
            luma = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
            k = max(0.32, min(1.5, 0.42 + 2.1 * luma))
            bc.default_value = (tint[0] * k, tint[1] * k, tint[2] * k, 1)
            n.inputs['Roughness'].default_value = 0.95
            for spec in ('Specular IOR Level', 'Specular'):
                if spec in n.inputs:
                    n.inputs[spec].default_value = 0.0
            if 'Metallic' in n.inputs:
                n.inputs['Metallic'].default_value = 0.0


# unit -> (weapon, headgear). The donors ship no weapon and no period kit, so
# both are built procedurally below and constrained to the hand and head bones.
GEAR = {
    'rifleman':  ('m16', 'm1'),
    'arvn':      ('m16', 'm1'),
    'guerrilla': ('ak', 'conical'),
    'nva':       ('ak', 'pith'),
    'm60':       ('m60', 'm1'),
    'engineer':  ('m16', 'm1'),
    'recon':     ('m16', 'boonie'),
    'sniper':    ('m40', 'boonie'),
    'rpd':       ('m60', 'pith'),
    'sapper':    ('ak', 'band'),
    'marksman':  ('svd', 'conical'),
    'rpgman':    ('rpg', 'pith'),
}

GEAR_MATS = {
    'gunmetal': (0.022, 0.024, 0.026),
    'wood':     (0.085, 0.048, 0.022),
    'helmet':   (0.105, 0.120, 0.070),
    'straw':    (0.36, 0.29, 0.14),
    'cloth':    (0.100, 0.108, 0.062),
    'webbing':  (0.048, 0.052, 0.034),
    'canvas':   (0.085, 0.090, 0.052),
}


def _mat(name, rgb=None):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    if b:
        b.inputs['Base Color'].default_value = (*(rgb or GEAR_MATS[name]), 1)
        b.inputs['Roughness'].default_value = 0.85
        if 'Metallic' in b.inputs:
            b.inputs['Metallic'].default_value = 0.0
    return m


def _box(verts_min, verts_max):
    """Corner-to-corner box as (verts, faces) in the part's local frame."""
    (x0, y0, z0), (x1, y1, z1) = verts_min, verts_max
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
         (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return v, f


def _mesh_from_boxes(name, boxes, mat):
    """Boxes are ((min),(max)) in weapon space: +X muzzle, +Z up, +Y across."""
    verts, faces = [], []
    for lo, hi in boxes:
        v, f = _box(lo, hi)
        n = len(verts)
        verts += v
        faces += [tuple(i + n for i in q) for q in f]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.polygons.foreach_set('use_smooth', [False] * len(me.polygons))
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(mat)
    bpy.context.collection.objects.link(ob)
    return ob


# Real weapon meshes, lifted from a Quaternius weapon pack (CC0). They beat the
# box rifles they replace by a mile. The pack's own rig is incompatible, but the
# guns are plain meshes — only the geometry is imported.
WEAPON_MESH = {
    'm16': 'SMG',        # black furniture, closest in the pack to an M16
    'ak':  'AK',
    'm60': 'ShortCannon',
    'svd': 'Sniper_2',   # wood stock and scope, for the marksman
    'm40': 'Sniper',
    'rpg': 'RocketLauncher',
}
# barrel length in metres, used to scale each mesh to a believable size
WEAPON_LEN = {'m16': 0.99, 'ak': 0.87, 'm60': 1.10, 'svd': 1.20, 'm40': 1.16,
              'rpg': 1.30}
# where the support hand grips, as a fraction of the weapon's length from the grip
FOREGRIP_F = {'m16': 0.42, 'ak': 0.38, 'm60': 0.34, 'svd': 0.44, 'm40': 0.44,
              'rpg': 0.30}


_WPN_CACHE = {}


def _load_weapons():
    """Import the weapon pack once and bake each gun into a standalone mesh.

    The pack's guns are skinned props on its own (incompatible) armature. Copying
    the objects and deleting that armature left them evaluating to nothing — the
    rifles simply disappeared. Baking the evaluated geometry into a fresh mesh,
    with the source transform applied, severs every dependency on that rig.
    """
    if _WPN_CACHE:
        return
    path = os.path.join(ROOT, 'art', 'models', 'weapons.glb')
    if not os.path.isfile(path):
        return
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    added = set(bpy.data.objects) - before
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    wanted = set(WEAPON_MESH.values())
    for o in added:
        if o.type != 'MESH' or o.name not in wanted:
            continue
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        me.transform(o.matrix_world)
        me.name = 'wpnmesh_' + o.name
        _WPN_CACHE[o.name] = me
    # The guns arrive AFTER recolour() has run, so they keep the pack's bright
    # showroom grey and read as chrome next to an olive soldier. Repaint them
    # here: anything named wood becomes stock timber, everything else gunmetal.
    for me in _WPN_CACHE.values():
        for mat in me.materials:
            if not mat or not mat.use_nodes:
                continue
            b = mat.node_tree.nodes.get('Principled BSDF')
            if not b:
                continue
            wood = 'wood' in mat.name.lower()
            bc = b.inputs.get('Base Color')
            if bc:
                if bc.is_linked:
                    for lk in list(bc.links):
                        mat.node_tree.links.remove(lk)
                bc.default_value = ((0.085, 0.046, 0.020, 1) if wood
                                    else (0.030, 0.032, 0.035, 1))
            b.inputs['Roughness'].default_value = 0.62 if wood else 0.44
            if 'Metallic' in b.inputs:
                b.inputs['Metallic'].default_value = 0.0

    for o in added:
        try:
            bpy.data.objects.remove(o, do_unlink=True)
        except Exception:
            pass


def _orient_weapon(me):
    """Rotate a weapon mesh so its bore runs down +X, thin axis across +Y.

    A bounding box is not enough: these props are authored already angled, so the
    box axes are not the gun's axes and every rifle came out tilted at its own
    angle. Principal component analysis finds the true long axis of the geometry
    whatever pose it was modelled in. The muzzle end is then identified by girth —
    a barrel is thinner than a stock and magazine.
    """
    import numpy as np
    from mathutils import Matrix

    P = np.array([[v.co.x, v.co.y, v.co.z] for v in me.vertices], dtype=float)
    if len(P) < 8:
        return
    P -= P.mean(axis=0)
    _, _, vt = np.linalg.svd(P, full_matrices=False)
    bore, thin = vt[0], vt[2]
    up = np.cross(bore, thin)
    R = np.array([bore, thin, up])
    if np.linalg.det(R) < 0:
        R[2] = -R[2]
    m = Matrix(((*R[0], 0), (*R[1], 0), (*R[2], 0), (0, 0, 0, 1)))
    me.transform(m)

    xs = [v.co.x for v in me.vertices]
    lo, hi = min(xs), max(xs)
    span = max(1e-5, hi - lo)

    def girth(a, b):
        sel = [v.co for v in me.vertices if a <= v.co.x <= b]
        if not sel:
            return 0.0
        return ((max(p.z for p in sel) - min(p.z for p in sel)) +
                (max(p.y for p in sel) - min(p.y for p in sel)))

    if girth(lo, lo + span * 0.20) < girth(hi - span * 0.20, hi):
        me.transform(Matrix.Rotation(math.pi, 4, 'Z'))   # muzzle was at -X

    # PCA fixes the bore but not which way is up, so magazines came out on top.
    # A gun carries its mass BELOW the bore — grip, magazine, box — so if the
    # bulk sits high, roll it over.
    zs = [v.co.z for v in me.vertices]
    if sum(zs) / len(zs) > 0:
        me.transform(Matrix.Rotation(math.pi, 4, 'X'))


def _rifle(kind, scale):
    """A real weapon mesh, laid grip-at-origin with the muzzle down +X."""
    from mathutils import Matrix
    _load_weapons()
    src = _WPN_CACHE.get(WEAPON_MESH.get(kind, 'SMG'))
    if not src:
        return None
    me = src.copy()
    if not me.vertices:
        return None
    _orient_weapon(me)

    want = WEAPON_LEN.get(kind, 0.99) * scale
    xs = [v.co.x for v in me.vertices]
    me.transform(Matrix.Scale(want / max(1e-4, max(xs) - min(xs)), 4))

    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    me.transform(Matrix.Translation((
        -(min(xs) + want * 0.44),
        -(min(ys) + max(ys)) / 2,
        -(min(zs) + max(zs)) / 2)))

    ob = bpy.data.objects.new('wpn_' + kind, me)
    bpy.context.collection.objects.link(ob)
    return ob


def _headgear(kind, r):
    """Boxes for headgear in head space: +X faces forward, +Z up."""
    if kind == 'conical':
        return [([((-r * 1.9, -r * 1.9, r * 0.10), (r * 1.9, r * 1.9, r * 0.16)),
                  ((-r * 1.3, -r * 1.3, r * 0.16), (r * 1.3, r * 1.3, r * 0.52)),
                  ((-r * 0.7, -r * 0.7, r * 0.52), (r * 0.7, r * 0.7, r * 0.80))],
                 'straw')]
    if kind == 'band':
        return [([((-r * 1.08, -r * 1.06, r * 0.10), (r * 1.06, r * 1.06, r * 0.30))],
                 'webbing')]
    if kind == 'boonie':
        return [([((-r * 1.85, -r * 1.8, r * 0.02), (r * 1.85, r * 1.8, r * 0.12)),
                  ((-r * 1.02, -r * 1.02, r * 0.12), (r * 1.02, r * 1.02, r * 0.44))],
                 'cloth')]
    if kind == 'pith':
        return [([((-r * 1.35, -r * 1.3, r * 0.02), (r * 1.35, r * 1.3, r * 0.14)),
                  ((-r * 1.12, -r * 1.12, r * 0.14), (r * 1.12, r * 1.12, r * 0.44)),
                  ((-r * 0.8, -r * 0.8, r * 0.44), (r * 0.8, r * 0.8, r * 0.60))],
                 'straw')]
    # M1 steel pot: shallow brim, domed shell
    return [([((-r * 1.30, -r * 1.18, r * 0.00), (r * 1.22, r * 1.18, r * 0.13)),
              ((-r * 1.16, -r * 1.10, r * 0.13), (r * 1.12, r * 1.10, r * 0.40)),
              ((-r * 0.92, -r * 0.88, r * 0.40), (r * 0.90, r * 0.88, r * 0.60))],
             'helmet')]


def _head_box():
    """World bounds of the head mesh.

    Hat placement used to key off the Head *bone*, which sits at a different
    height inside each donor's skull — on the new bodies that buried the helmet
    in the head and left only its brim showing across the face. Measuring the
    mesh works for any donor.
    """
    dg = bpy.context.evaluated_depsgraph_get()
    for o in bpy.data.objects:
        if o.type != 'MESH' or 'head' not in o.name.lower():
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        if not me.vertices:
            ev.to_mesh_clear()
            continue
        pts = [ev.matrix_world @ v.co for v in me.vertices]
        ev.to_mesh_clear()
        xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
        return {
            'cx': (min(xs) + max(xs)) / 2, 'cy': (min(ys) + max(ys)) / 2,
            'top': max(zs),
            'r': max((max(xs) - min(xs)), (max(ys) - min(ys))) / 2,
        }
    return None


def strip_hair():
    """Delete faces using the Hair material.

    These donors are civilians and several come with a ponytail, which reads
    badly under a steel pot. The hair is a material slot on the head mesh rather
    than its own object, so the faces have to go individually.
    """
    import bmesh
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        idx = [i for i, sl in enumerate(o.material_slots)
               if sl.material and sl.material.name in
               ('Hair', 'Hair_Brown', 'Moustache')]
        if not idx:
            continue
        bm = bmesh.new()
        bm.from_mesh(o.data)
        gone = [f for f in bm.faces if f.material_index in idx]
        if gone:
            bmesh.ops.delete(bm, geom=gone, context='FACES')
            bm.to_mesh(o.data)
            o.data.update()
        bm.free()


def _prop(name, centre, size, matname, arm, bone):
    """World-axis-aligned box pinned to a bone. The figure faces +X, so -X is behind."""
    from mathutils import Matrix
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    ob = _mesh_from_boxes(name, [((-hx, -hy, -hz), (hx, hy, hz))], _mat(matname))
    ob.matrix_world = Matrix.Translation(centre)
    _pin(ob, arm, bone)


def _webbing(unit, arm, k, M):
    """Pack, bedroll and belt kit. This is most of the 'soldier' read at 84px."""
    from mathutils import Vector
    chest = M @ arm.pose.bones['Chest'].matrix.translation
    hips = M @ arm.pose.bones['Hips'].matrix.translation
    V = Vector
    if unit in ('rifleman', 'arvn', 'm60', 'engineer', 'recon', 'sniper'):
        _prop('pack', chest + V((-0.135 * k, 0, -0.05 * k)),
              (0.145 * k, 0.25 * k, 0.28 * k), 'canvas', arm, 'Chest')
        _prop('bedroll', chest + V((-0.140 * k, 0, 0.11 * k)),
              (0.125 * k, 0.29 * k, 0.085 * k), 'cloth', arm, 'Chest')
        _prop('pouchL', hips + V((0.02 * k, -0.17 * k, -0.02 * k)),
              (0.11 * k, 0.09 * k, 0.13 * k), 'canvas', arm, 'Hips')
        _prop('canteen', hips + V((-0.09 * k, 0.16 * k, -0.03 * k)),
              (0.09 * k, 0.08 * k, 0.13 * k), 'canvas', arm, 'Hips')
    else:
        _prop('pack', chest + V((-0.13 * k, 0, -0.04 * k)),
              (0.15 * k, 0.26 * k, 0.26 * k), 'webbing', arm, 'Chest')
        _prop('chestrig', chest + V((0.10 * k, 0, -0.07 * k)),
              (0.08 * k, 0.24 * k, 0.15 * k), 'webbing', arm, 'Chest')
    _prop('belt', hips + V((0, 0, 0.01 * k)),
          (0.29 * k, 0.30 * k, 0.055 * k), 'webbing', arm, 'Hips')
    _prop('strap', chest + V((0.005 * k, 0, 0.02 * k)),
          (0.26 * k, 0.31 * k, 0.06 * k), 'webbing', arm, 'Chest')


def _pin(ob, arm, bone):
    """Child-Of constraint with the inverse baked at the current pose."""
    pb = arm.pose.bones[bone]
    c = ob.constraints.new('CHILD_OF')
    c.target = arm
    c.subtarget = bone
    c.inverse_matrix = (arm.matrix_world @ pb.matrix).inverted()


def attach_gear(unit, sc, pose_action):
    """Build a rifle and headgear and constrain them to the rig."""
    from mathutils import Matrix, Vector
    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    if not arms:
        return
    arm = arms[0]
    if pose_action:
        if not arm.animation_data:
            arm.animation_data_create()
        arm.animation_data.action = pose_action
        sc.frame_set(int(pose_action.frame_range[0]))
    bpy.context.view_layer.update()

    weapon, headgear = GEAR.get(unit, ('m16', 'm1'))
    M = arm.matrix_world
    wr = M @ arm.pose.bones['Wrist.R'].matrix.translation
    hd = arm.pose.bones['Head']
    head_w = M @ hd.matrix.translation

    # figure scale, so gear sizes stated in metres survive the height normalise
    foot = M @ arm.pose.bones['Foot.R'].matrix.translation
    fig_h = max(0.1, (head_w.z - foot.z) / 0.82)
    k = fig_h / 1.8

    # The donors point their gun ONE-HANDED: the left wrist stays parked at the
    # hip in every firing action, so a wrist-to-wrist axis builds the rifle
    # backwards (muzzle at the left hand, stock out front). The right forearm
    # points dead ahead whenever the character aims — so that is the axis.
    elbow = M @ arm.pose.bones['LowerArm.R'].matrix.translation
    ax = (wr - elbow)
    if ax.length < 1e-5:
        ax = Vector((1, 0, 0))
    ax.normalize()
    up = Vector((0, 0, 1))
    side = ax.cross(up)
    if side.length < 1e-5:
        side = Vector((0, 1, 0))
    side.normalize()
    up = side.cross(ax).normalized()
    rot = Matrix((ax, side, up)).transposed().to_4x4()
    grip = wr - ax * (0.05 * k)

    def wpn_point(local):
        return Matrix.Translation(grip) @ rot @ Matrix.Translation(
            (local[0] * k, local[1] * k, local[2] * k))

    gun = _rifle(weapon, k)
    tipx = WEAPON_LEN.get(weapon, 0.99) * 0.56 * k   # muzzle, measured from the grip
    if gun:
        gun.matrix_world = Matrix.Translation(grip) @ rot
        _pin(gun, arm, 'Wrist.R')

    # an empty riding the barrel tip: tracked per frame so muzzle flashes and
    # tracers leave the actual gun instead of a guessed offset from the body
    mz = bpy.data.objects.new('muzzle', None)
    bpy.context.collection.objects.link(mz)
    mz.matrix_world = Matrix.Translation(grip) @ rot @ Matrix.Translation((tipx, 0, 0.01 * k))
    _pin(mz, arm, 'Wrist.R')

    # ...and one on the handguard, which the left arm reaches for via IK. That
    # turns the donor's one-handed point into a proper two-handed hold in every
    # clip, without hand-posing the arm frame by frame.
    fg = bpy.data.objects.new('foregrip', None)
    bpy.context.collection.objects.link(fg)
    fg.matrix_world = Matrix.Translation(grip) @ rot @ Matrix.Translation(
        (WEAPON_LEN.get(weapon, 0.99) * FOREGRIP_F.get(weapon, 0.40) * k, 0, -0.03 * k))
    _pin(fg, arm, 'Wrist.R')
    lo = arm.pose.bones.get('LowerArm.L')
    if lo:
        ik = lo.constraints.new('IK')
        ik.target = fg
        ik.chain_count = 2

    # A carry point in front of the chest. Switched on per clip (see CLIP_CARRY)
    # so aiming and firing keep their mocap, while the gunless clips still hold
    # the rifle at a low ready instead of dropping it behind the leg.
    chest_w = M @ arm.pose.bones['Chest'].matrix.translation
    cy = bpy.data.objects.new('carry', None)
    bpy.context.collection.objects.link(cy)
    cy.matrix_world = Matrix.Translation(
        chest_w + Vector((0.30 * k, -0.15 * k, -0.16 * k)))
    _pin(cy, arm, 'Chest')
    ro = arm.pose.bones.get('LowerArm.R')
    if ro:
        ik = ro.constraints.new('IK')
        ik.target = cy
        ik.chain_count = 2
        ik.influence = 0.0

    _webbing(unit, arm, k, M)

    strip_hair()

    _mat('helmet', HAT_TINT.get(PAL_ALIAS.get(unit, unit)))
    hb = _head_box()
    r = (hb['r'] * 1.06) if hb else (0.105 * k)
    # Seat it INTO the skull. Sitting it on the measured top left the brim
    # hovering like a plate; a hat has to bite down over the head to read as worn.
    seat = Vector((hb['cx'], hb['cy'], hb['top'] - r * 0.78)) if hb else (
        head_w + Vector((0, 0, hd.length * 0.55)))
    for boxes, matname in _headgear(headgear, r):
        ob = _mesh_from_boxes('hat_' + matname, boxes, _mat(matname))
        ob.matrix_world = Matrix.Translation(seat)
        _pin(ob, arm, 'Head')

    # a face patch is no longer needed — these donors have real heads


def strip_junk():
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.name.lower().startswith(('icosphere', 'sphere', 'cube')):
            bpy.data.objects.remove(o, do_unlink=True)


def load(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == '.fbx':
        bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=True)
    elif ext in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=path)
    else:
        raise SystemExit('unsupported model format: ' + ext)


def scene_setup():
    sc = bpy.context.scene
    for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES'):
        try:
            sc.render.engine = eng
            break
        except Exception:
            continue
    try:
        # 64 samples is farm settings for a 256px flat-shaded sprite that then
        # gets a hard outline stroked over it. 16 is visually identical here and
        # roughly a quarter of the render time — this runs on a laptop.
        sc.eevee.taa_render_samples = int(arg('--samples', '16'))
    except Exception:
        pass
    sc.render.film_transparent = True
    sc.render.resolution_x = RES
    sc.render.resolution_y = RES
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    return sc


def fit_and_stage():
    """Normalise the model to a known height and aim a locked side camera."""
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if not meshes:
        raise SystemExit('no mesh found in model')
    zs, xs = [], []
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ __import__('mathutils').Vector(c)
            zs.append(w.z); xs.append(w.x)
    h = max(zs) - min(zs)
    k = HEIGHT / h if h > 0 else 1.0
    root = [o for o in bpy.data.objects if o.parent is None]
    for o in root:
        o.scale = (o.scale[0] * k, o.scale[1] * k, o.scale[2] * k)
        o.location = (o.location[0] * k, o.location[1] * k, o.location[2] * k)
        # turn the figure to a right-facing profile for the side camera
        o.rotation_mode = 'XYZ'
        o.rotation_euler = (o.rotation_euler[0], o.rotation_euler[1],
                            o.rotation_euler[2] + math.radians(float(TURN)))
    bpy.context.view_layer.update()

    cam_d = bpy.data.cameras.new('cam')
    cam_d.type = 'ORTHO'
    cam_d.ortho_scale = HEIGHT * ORTHO_K
    cam = bpy.data.objects.new('cam', cam_d)
    bpy.context.collection.objects.link(cam)
    cam.location = (0.0, -8.0, HEIGHT * CAM_ZK)
    cam.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.scene.camera = cam

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


MUZZLE = {}


def _pitch_bone(arm, name, deg):
    """Rotate one pose bone in place about the model's pitch axis."""
    from mathutils import Matrix
    pb = arm.pose.bones.get(name)
    if not pb:
        return
    piv = pb.matrix.translation.copy()
    pb.matrix = (Matrix.Translation(piv) @ Matrix.Rotation(math.radians(deg), 4, 'X')
                 @ Matrix.Translation(-piv)) @ pb.matrix
    bpy.context.view_layer.update()


def arm_of():
    return [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]


def render_clip(name, action, sc, pose_fn=None):
    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    if not arms:
        raise SystemExit('no armature — the model must be rigged')
    arm = arms[0]
    if action:
        if not arm.animation_data:
            arm.animation_data_create()
        arm.animation_data.action = action
        s, e = action.frame_range
    else:
        s, e = 1, 1
    ortho = HEIGHT * ORTHO_K
    cam_z = HEIGHT * CAM_ZK
    mz = bpy.data.objects.get('muzzle')

    def muzzle_px():
        """Barrel tip in render pixels. Constraints only resolve in the
        evaluated depsgraph, so read the evaluated copy, not the original."""
        if not mz:
            return None
        dg = bpy.context.evaluated_depsgraph_get()
        w = mz.evaluated_get(dg).matrix_world.translation
        return [round(RES / 2 + (w.x / ortho) * RES, 1),
                round(RES / 2 - ((w.z - cam_z) / ortho) * RES, 1)]

    carry = arm_of().pose.bones.get('LowerArm.R')
    if carry:
        for c in carry.constraints:
            if c.type == 'IK':
                c.influence = CLIP_CARRY.get(name, 0.0)
    made, pts = [], []
    n = CLIP_FRAMES.get(name, FRAMES)
    div = n if name in LOOPING else max(1, n - 1)
    for i in range(n):
        f = s + (e - s) * (i / div)
        sc.frame_set(int(round(f)))
        bpy.context.view_layer.update()
        if pose_fn:
            pose_fn(i / max(1, n))
        fn = '%s_%02d' % (name, i)
        pts.append(muzzle_px())
        if not NORENDER:
            sc.render.filepath = os.path.join(OUTDIR, fn + '.png')
            bpy.ops.render.render(write_still=True)
        made.append(fn)
    MUZZLE[name] = pts
    return made


def _pitch(arm, name, deg, pivot=None):
    """Rotate a bone about the model's pitch axis, in place by default."""
    from mathutils import Matrix
    pb = arm.pose.bones.get(name)
    if not pb:
        return
    piv = pivot if pivot is not None else pb.matrix.translation.copy()
    R = (Matrix.Translation(piv) @ Matrix.Rotation(math.radians(deg), 4, 'X')
         @ Matrix.Translation(-piv))
    pb.matrix = R @ pb.matrix
    bpy.context.view_layer.update()


def _prone_pose(arm, frozen, breath):
    """Lay the man out prone, `breath` degrees off the resting chest angle.

    Standing, the torso points +Z and the legs -Z; prone, the torso points along
    the facing and the legs trail behind it. That is one rigid ~85 degree pitch of
    the hips, so the body lays out correctly in a single rotation; only the head
    and chest need lifting back up to prop the man on his elbows.

    Bases are restored from `frozen` first, so this is safe to call per frame.
    """
    for name, mb in frozen.items():
        pb = arm.pose.bones.get(name)
        if pb:
            pb.matrix_basis = mb.copy()
    bpy.context.view_layer.update()

    # the legs hang off Body and the feet off Root, so laying the man out means
    # turning all of them about one pelvis pivot rather than just the spine
    pelvis = arm.pose.bones['Body'].matrix.translation.copy()
    for b in ('Body', 'Foot.L', 'Foot.R', 'PT.L', 'PT.R'):
        _pitch(arm, b, 84, pelvis)

    _pitch(arm, 'Chest', -30 + breath)   # prop the upper body on the elbows
    _pitch(arm, 'Head', -44 - breath * 0.5)
    _pitch(arm, 'UpperLeg.L', 10)        # legs trail apart for a stable base
    _pitch(arm, 'UpperLeg.R', -4)


def prone_bind(arm, sc, base_action):
    """Freeze a base pose for prone and settle the figure onto the ground.

    The action has to be detached: while one is assigned, the render's depsgraph
    evaluation re-applies it and silently discards any hand posing. Bases are
    captured as matrix_basis, which is parent-relative and so can be restored in
    any order.

    The ground settle is done once, here — recomputing it per frame would make
    the body bob vertically as it breathes.
    """
    if base_action:
        if not arm.animation_data:
            arm.animation_data_create()
        arm.animation_data.action = base_action
        sc.frame_set(int(base_action.frame_range[0]))
    bpy.context.view_layer.update()

    frozen = {b.name: b.matrix_basis.copy() for b in arm.pose.bones}
    if arm.animation_data:
        arm.animation_data.action = None
    _prone_pose(arm, frozen, 0.0)

    dg = bpy.context.evaluated_depsgraph_get()
    lo = None
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        for v in me.vertices:
            z = (ev.matrix_world @ v.co).z
            lo = z if lo is None or z < lo else lo
        ev.to_mesh_clear()
    if lo is not None:
        for o in bpy.data.objects:
            if o.parent is None and o.type in ('ARMATURE', 'EMPTY', 'MESH'):
                o.location.z -= lo
        bpy.context.view_layer.update()
    return frozen


def main():
    global MODEL
    if MODEL in (None, 'auto'):
        MODEL = os.path.join(ROOT, 'art', 'models',
                             MODEL_FOR.get(UNIT, 'casual') + '.glb')
    print('DONOR', UNIT, '->', os.path.basename(MODEL))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = scene_setup()
    load(MODEL)
    strip_junk()
    recolour(UNIT)
    fit_and_stage()

    clips = {}
    if USE_BUILTIN:
        for state, want in STATE_ACTIONS.items():
            hit = None
            for a in bpy.data.actions:
                tail = a.name.split('|')[-1].lower()
                if tail == want.lower():
                    hit = a
                    break
            if hit:
                clips[state] = hit
        print('MAPPED', {k: v.name for k, v in clips.items()})
    for spec in args_all('--clip'):
        if '=' not in spec:
            continue
        name, path = spec.split('=', 1)
        before = set(bpy.data.actions)
        load(path)                      # brings its action in with it
        new = [a for a in bpy.data.actions if a not in before]
        clips[name] = new[0] if new else None

    if not clips:
        clips = {'idle': (list(bpy.data.actions) or [None])[0]}

    attach_gear(UNIT, sc, clips.get('aim') or clips.get('idle'))

    index = {'unit': UNIT, 'res': RES, 'clips': {},
             'cam': {'ortho': HEIGHT * ORTHO_K, 'camz': HEIGHT * CAM_ZK, 'figH': HEIGHT}}
    prev = {}
    if ONLY:
        ip = os.path.join(OUTDIR, 'index.json')
        if os.path.isfile(ip):
            prev = json.load(open(ip)).get('clips', {})
    for name, action in clips.items():
        if ONLY and name not in ONLY:
            index['clips'][name] = prev.get(name, [])
            continue
        index['clips'][name] = render_clip(name, action, sc)

    if not ONLY or 'prone' in ONLY:
        arm = arm_of()
        frozen = prone_bind(arm, sc, clips.get('aim') or clips.get('idle'))
        index['clips']['prone'] = render_clip(
            'prone', None, sc,
            pose_fn=lambda p: _prone_pose(arm, frozen,
                                          2.4 * math.sin(p * 2 * math.pi)))
    elif prev.get('prone'):
        index['clips']['prone'] = prev['prone']

    index['muzzle'] = MUZZLE
    with open(os.path.join(OUTDIR, 'index.json'), 'w') as f:
        json.dump(index, f, indent=1)
    print('DONE', UNIT, sum(len(v) for v in index['clips'].values()), 'frames')


main()
