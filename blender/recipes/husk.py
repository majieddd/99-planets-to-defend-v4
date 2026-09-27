"""The Husk: a hunched, heavy Xeno soak unit (v3: 85 health, 1.85 m/s, a 0.40 s wind-up on a 1.40 s
blow). Wet dark chitin, pale bone claws, magenta light at the eyes and between the carapace plates.
Animations: idle (2.0 s loop), walk (1.0 s loop, diagonal leg pairs), attack (1.40 s, strike at 0.40 s
keyed from src/shared/timings.json). Axis conventions: see lib/anim.py (creature).

Normals carry broad light zones instead of one tone per facet: the body and thorax take custom normals from their proxy
ellipsoids (the displaced body keeps its lumpy silhouette but lights as one volume); plates, limbs, mandibles and the
bevelled head smooth by angle, so plate rims and limb end caps stay crisp.

Each seam is a glowing tube laid in the valley where a carapace plate rises out of the plate behind it, sunk so that
only a thin line of light shows between the plates: light pressing through a gap, not a lamp. Straight bars across the
domes stood proud of the shell at the sides and read as neon tubes, and the rearmost one was buried inside the plates.

The carapace reads by value against dark ground, not only by hue: each plate carries a light violet-grey painted top on
its upward faces (paint.add_cap), the key light painted in, while its flanks, its rim and the body stay dark wet chitin
(see PLATE_CAP).

The strike swings both claws down as rigid hammers onto the ground beside the head, the legs brace so no foot sinks
into the ground, and the blow eases in so that it lands on the strike frame itself (see attack_keys and
ease_into_strike)."""
import math

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from lib import anim, export, geo, ink, paint, palette, rig, scene
from lib.anim import leg_swing
from lib.ctx import AnimRecord, AssetRecord

X = palette.XENO
# The atlas bakes at about 211 texels per metre (measured after the paint UV pass). At 0.5 one 512 px brush tile spans
# 2 m, so the narrowest strokes (12 px) bake about 10 texels wide and the widest (26 px) about 21, and a handful of
# strokes cross each carapace plate. At 1.2 the narrow strokes baked 4 texels wide and read as grain, not paint.
BRUSH_SCALE = 0.5
SEAM_RADIUS = 0.022  # at the middle of a seam; the ends taper to 40%, so the light thins out toward the plate rims
SEAM_SINK = 0.35     # the tube's centre sits this many radii below the valley floor, leaving a sliver of light showing
# Under the preview light the plate crowns (the faces the cap now covers) rendered at L* 13.0 without it: 6.3 below a
# charcoal ground (#302e33) and 2.9 above near-black (#1c1b20), so the carapace read only by its hue. The cap on faces
# whose world normal z passes 0.8 lifts the crowns to L* 39.6, 20.3 above charcoal and 29.5 above near-black, while the
# whole carapace, flanks and rims included, goes only from L* 13.4 to 16.2: the flanks stay dark. The seams run close
# to the crowns: 3 cm either side of each valley the cap factor (as the bake reads it) is 0.89 to 0.99 at the middle of
# each seam and falls as low as 0.42 toward the ends, except behind seam 2, where plate 2 already slopes toward its rim
# and the factor runs only 0.57 to 0.76 (measured). So no threshold caps the crowns and keeps the middles of the valleys
# dark; the magenta still reads as a thin line of light along each plate's edge. A breakup of 0.5 moved the edge
# by about 0.1 in factor units, as much as the visible plates' whole range (0.8 to 0.99), and scattered the cap into
# blocks; 0.2 keeps one lit shape per plate with a brush-broken edge. The head keeps plain chitin: a lit head top
# competed with the eyes.
PLATE_CAP = '#8f86b8'
PLATE_CAP_SHAPE = {'threshold': 0.8, 'softness': 0.03, 'breakup': 0.2}


def _top(tree, x, y):
    hit = tree.ray_cast(Vector((x, y, 5.0)), Vector((0.0, 0.0, -1.0)))[0]
    return None if hit is None else hit.z


def _surface(ob):
    """The part's surface as a BVH tree in world space, for the ray casts that find the valleys between plates. The
    tree takes the mesh's own coordinates, so this applies the part's transform first: the part leaves with its
    tilt and placement baked into its mesh."""
    scene.apply_transforms(ob)
    return BVHTree.FromPolygons([v.co.copy() for v in ob.data.vertices], [tuple(p.vertices) for p in ob.data.polygons])


def _crease(behind, front, x, y_start, y_end, step=0.01):
    """(y, z) on the line x where the front plate's top surface rises through the top surface of the plate behind it,
    scanning forward (toward -y) from y_start, or None where the two plates do not cross."""
    previous = None
    y = y_start
    while y >= y_end:
        a, b = _top(behind, x, y), _top(front, x, y)
        if a is not None and b is not None:
            if previous is not None and previous[1] < 0.0 <= b - a:
                lo, hi = y, previous[0]
                for _ in range(30):
                    mid = (lo + hi) / 2
                    a, b = _top(behind, x, mid), _top(front, x, mid)
                    if a is None or b is None:
                        break
                    lo, hi = (mid, hi) if b >= a else (lo, mid)
                return lo, _top(front, x, lo)
            previous = (y, b - a)
        y -= step
    return None


def _tube(name, points, radii, material, sides=6):
    bm = bmesh.new()
    rings = []
    for i, (point, radius) in enumerate(zip(points, radii)):
        tangent = (points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]).normalized()
        side = tangent.cross(Vector((0.0, 0.0, 1.0))).normalized()
        up = side.cross(tangent).normalized()
        centre = point - Vector((0.0, 0.0, SEAM_SINK * radius))
        rings.append([bm.verts.new(centre + radius * (math.cos(k * math.tau / sides) * side + math.sin(k * math.tau / sides) * up))
                      for k in range(sides)])
    for r0, r1 in zip(rings[:-1], rings[1:]):
        for k in range(sides):
            bm.faces.new((r0[k], r1[k], r1[(k + 1) % sides], r0[(k + 1) % sides]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(material)
    return scene.link(bpy.data.objects.new(name, mesh))


def seam(name, behind, front, y_start, y_end, material, samples=11):
    """A tube along the valley between two plates (their world-space BVH trees), across the width where they cross.
    The valley is found by ray casts rather than placed by hand, so the seams stay in it if the plate layout changes."""
    reach = 0.0
    x = 0.0
    while x < 1.0 and _crease(behind, front, x, y_start, y_end) is not None:
        reach = x
        x += 0.01
    points, radii = [], []
    for k in range(samples):
        x = reach * (2 * k / (samples - 1) - 1)
        found = _crease(behind, front, x, y_start, y_end)
        if found is not None:
            points.append(Vector((x, *found)))
            radii.append(SEAM_RADIUS * (1.0 - 0.6 * (abs(x) / max(reach, 1e-6)) ** 2))
    if len(points) < 2:
        raise ValueError(f'{name}: the plates do not cross, so there is no valley to lay the seam in')
    return geo.shade_smooth(_tube(name, points, radii, material), 180.0)


def parts(arm, r):
    out = []

    def add(ob, bone, width):
        ink.set_ink(ob, width)
        out.append((ob, bone))

    def limb(name, bone, r_head, r_tail, material, segments=8):
        ob = geo.segment(name, rig.bone_head(arm, bone), rig.bone_tail(arm, bone), r_head, r_tail, segments=segments, material=material)
        return geo.shade_smooth(ob, 70.0)  # round sides (45 or 60 degrees apart), flat end caps (90)

    body = geo.uv_sphere('husk_body', 0.45, 16, 10, scale=(1.0, 1.35, 0.85), location=(0, -0.05, 0.78), material=r['chitin'])
    scene.apply_transforms(body)
    geo.displace(body, 0.05, frequency=2.0, seed=2)
    geo.ellipsoid_normals(body, (0, -0.05, 0.78), (0.45, 0.45 * 1.35, 0.45 * 0.85))
    add(body, 'body', 1.2)
    thorax = geo.uv_sphere('husk_thorax', 0.32, 14, 8, scale=(1.0, 1.1, 0.9), location=(0, -0.55, 0.86), material=r['chitin'])
    scene.apply_transforms(thorax)
    geo.ellipsoid_normals(thorax, (0, -0.55, 0.86), (0.32, 0.32 * 1.1, 0.32 * 0.9))
    add(thorax, 'thorax', 1.1)
    head = geo.box('husk_head', (0.34, 0.36, 0.26), location=(0, -0.88, 0.8), bevel=0.06, material=r['chitin_light'])
    geo.shade_smooth(head, 45.0)  # the bevel turns each corner in 30 degree steps, so the head shades as one rounded block
    add(head, 'head', 1.0)
    for side in (-1, 1):
        add(geo.shade_smooth(geo.ico(f'husk_eye{side:+d}', 0.05, subdivisions=1, location=(side * 0.1, -1.05, 0.86), material=r['seam']), 180.0),
            'head', 0.3)
        add(geo.shade_smooth(geo.cylinder(f'husk_mandible{side:+d}', 0.04, 0.22, segments=5, radius_top=0.0, location=(side * 0.1, -1.08, 0.72),
                                          rotation=(1.9, 0, side * 0.3), material=r['bone']), 80.0), 'head', 0.6)
    spots = ((0.30, 1.02, 0.5), (0.02, 1.10, 0.46), (-0.26, 1.10, 0.40), (-0.48, 1.04, 0.33))
    surfaces = []
    for i, (y, z, radius) in enumerate(spots):
        plate = geo.uv_sphere(f'husk_plate{i}', radius, 14, 7, scale=(1.1, 0.7, 0.5), hemisphere=True, location=(0, y, z - 0.12),
                              rotation=(-0.25 + 0.12 * i, 0, 0), material=r['plate'])
        geo.shade_smooth(plate, 60.0)  # a smooth dome with a crisp rim where it meets its flat underside
        add(plate, 'carapace', 1.2)
        surfaces.append(_surface(plate))
        # After shade_smooth, because the cap reads the plate's final shading normals. Its place after _surface does
        # not matter: cap_factor maps the normals through matrix_world, so it reads world up with or without the tilt.
        geo.cap_factor(plate)
    for i in range(3):
        add(seam(f'husk_seam{i}', surfaces[i], surfaces[i + 1], spots[i][0] + 0.3, spots[i + 1][0] - 0.3, r['seam']), 'carapace', 0.0)
    for side in ('L', 'R'):
        add(limb(f'husk_claw_upper.{side}', f'claw_upper.{side}', 0.09, 0.07, r['chitin']), f'claw_upper.{side}', 1.0)
        add(limb(f'husk_claw_lower.{side}', f'claw_lower.{side}', 0.1, 0.0, r['bone'], segments=6), f'claw_lower.{side}', 1.1)
        for leg in ('front', 'back'):
            add(limb(f'husk_{leg}_upper.{side}', f'leg_{leg}_upper.{side}', 0.07, 0.05, r['chitin']), f'leg_{leg}_upper.{side}', 0.9)
            add(limb(f'husk_{leg}_lower.{side}', f'leg_{leg}_lower.{side}', 0.05, 0.012, r['bone'], segments=6), f'leg_{leg}_lower.{side}', 0.9)
    return out


NEUTRAL = {}


def walk_keys():
    a = {  # front.L and back.R forward, front.R and back.L back
        'leg_front_upper.L': (0, 0, leg_swing('L', 0.35)), 'leg_back_upper.R': (0, 0, leg_swing('R', 0.35)),
        'leg_front_upper.R': (0, 0, leg_swing('R', -0.35)), 'leg_back_upper.L': (0, 0, leg_swing('L', -0.35)),
        'body': (0.02, 0, 0.04), 'claw_upper.L': (0.1, 0, 0), 'claw_upper.R': (-0.05, 0, 0), 'body@loc': (0, 0, 0.0),
    }
    passing_a = {  # the pair that was back lifts as it swings through
        'leg_front_upper.R': (0.35, 0, 0), 'leg_front_lower.R': (-0.3, 0, 0),
        'leg_back_upper.L': (0.35, 0, 0), 'leg_back_lower.L': (-0.3, 0, 0),
        'body': (0.0, 0, 0.0), 'body@loc': (0, 0, 0.05),
    }
    b = anim.mirror_pose(a, kind='creature')
    b['body@loc'] = (0, 0, 0.0)
    passing_b = anim.mirror_pose(passing_a, kind='creature')
    passing_b['body@loc'] = (0, 0, 0.05)
    return [(1, a), (8, passing_a), (16, b), (23, passing_b), (31, a)]


# The wind-up key sits this many frames before the strike key (0.10 s at 30 fps). attack_keys places it there and
# ease_into_strike finds it again by that frame, so both take the offset from here.
WINDUP_LEAD = 3


def attack_keys(strike_frame, end_frame):
    windup = {
        'claw_upper.L': (0.9, 0, 0), 'claw_upper.R': (0.9, 0, 0), 'claw_lower.L': (0.6, 0, 0), 'claw_lower.R': (0.6, 0, 0),
        'body': (0.12, 0, 0), 'thorax': (0.1, 0, 0), 'head': (0.1, 0, 0), 'body@loc': (0, -0.08, 0.02),
        # rearing back pushes the back feet 2 cm into the ground; this lift keeps them on it
        'leg_back_upper.L': (0.05, 0, 0), 'leg_back_upper.R': (0.05, 0, 0),
    }
    # The claws keep the wind-up's elbow angle and swing down as rigid hammers, tips on the ground beside the head
    # (z 0.05 m, y -1.09 m, 0.36 m either side of the centre line). The lunge carries the head forward over them, so
    # they land a few centimetres behind its face, whose lower edge reaches y -1.11 to -1.14 m (measured on the strike
    # frame). Bending the lower claws down as well, (-0.5, -0.4), folded them back under the head with the tips 0.20 m
    # up and behind the face. The lunge alone pitches the front feet 13 cm into the ground and lifts the back feet
    # 4 cm; the leg values brace all four on the ground.
    strike = {
        'claw_upper.L': (-0.85, 0, 0), 'claw_upper.R': (-0.85, 0, 0), 'claw_lower.L': (0.6, 0, 0), 'claw_lower.R': (0.6, 0, 0),
        'body': (-0.15, 0, 0), 'thorax': (-0.12, 0, 0), 'body@loc': (0, 0.12, -0.03),
        'leg_front_upper.L': (0.35, 0, 0), 'leg_front_upper.R': (0.35, 0, 0),
        'leg_back_upper.L': (-0.08, 0, 0), 'leg_back_upper.R': (-0.08, 0, 0),
    }
    return [(1, NEUTRAL), (strike_frame - WINDUP_LEAD, windup), (strike_frame, strike), (strike_frame + 6, strike), (end_frame, NEUTRAL)]


def ease_into_strike(action, windup_frame):
    """The default Bezier keys ease into the strike, which left the claw tips three quarters of the way down one frame
    early, so the blow read a frame before the sidecar's strike time. A quadratic ease-in from the wind-up key holds
    the claws high a moment longer and puts most of the drop into the last frame: the hit lands on the strike frame."""
    eased = 0
    for layer in action.layers:
        for strip in layer.strips:
            for slot in action.slots:
                channels = strip.channelbag(slot)
                for curve in channels.fcurves if channels else ():
                    for key in curve.keyframe_points:
                        if abs(key.co.x - windup_frame) < 1e-6:
                            key.interpolation = 'QUAD'
                            key.easing = 'EASE_IN'
                            eased += 1
    # A wind-up frame that matched no key used to change nothing without a word, leaving the Bezier ease and the blow
    # a frame early again.
    if eased == 0:
        raise ValueError(f'{action.name}: no key on the wind-up frame {windup_frame}, '
                         'so the blow would land a frame early')


def build(ctx):
    timing = ctx.timings()['xeno']['husk']['attack']
    strike_frame = 1 + timing['strike'] * anim.FPS
    end_frame = 1 + timing['duration'] * anim.FPS
    r = {
        'chitin': palette.region('xeno_chitin', X['chitin']),
        'chitin_light': palette.region('xeno_chitin_light', X['chitin_light']),
        'plate': paint.add_cap(palette.region('husk_plate', X['chitin_light']), PLATE_CAP, **PLATE_CAP_SHAPE),
        'bone': palette.region('xeno_bone', X['bone']),
        'seam': palette.region('xeno_seam', X['chitin'], emit_hex=X['seam']),
    }
    arm = rig.creature('husk_rig')
    mesh = rig.bind_rigid(arm, parts(arm, r), 'husk')
    paint.paint([mesh], name='husk', out_dir=ctx.bake_dir('xeno'), textures_dir=ctx.textures, size=1024,
                style=palette.XENO_STYLE, ao_distance=0.3, brush_scale=BRUSH_SCALE, emissive_strength=4.0)
    idle = anim.make_action(arm, 'idle', [(1, NEUTRAL), (31, {'body': (0.03, 0, 0), 'carapace': (-0.04, 0, 0), 'claw_upper.L': (0.05, 0, 0), 'claw_upper.R': (0.05, 0, 0)}), (61, NEUTRAL)], loc_bones=('body',))
    walk = anim.make_action(arm, 'walk', walk_keys(), loc_bones=('body',))
    attack = anim.make_action(arm, 'attack', attack_keys(strike_frame, end_frame), loc_bones=('body',))
    ease_into_strike(attack, strike_frame - WINDUP_LEAD)
    if ctx.previews_enabled:
        out = ctx.preview_dir('husk')
        export.render_views([mesh], out, 'husk', views=4)
        for action in (walk, attack):
            export.render_action(arm, [mesh], action, out, 'husk', frames=6)
    export.export_glb([arm, mesh], ctx.raw_path('xeno', 'husk'), animations=True)
    return [AssetRecord(
        name='husk', family='xeno', file='xeno/husk.glb', nodes=['husk_rig', 'husk'], tris=scene.tri_count([mesh]),
        animations=[
            AnimRecord('idle', anim.duration(idle), True),
            AnimRecord('walk', anim.duration(walk), True),
            AnimRecord('attack', anim.duration(attack), False, strike=(strike_frame - 1) / anim.FPS),
        ],
    )]
