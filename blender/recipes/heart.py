"""The Worldheart: a warm crystal heart held in a stone reliquary, in eleven growth stages (one per heart level, 0 to
10). The runtime shows the plinth and the stage for the current level. Warm light is the heart's alone (blueprint,
material language).

The plinth, one node under every stage, is a ten-sided stepped drum with a gold band, ten stone rune diamonds and a
gold ring on top, from which four claws of stacked carved stone blocks, capped in gold, rise and hook in: the cradle.
The core floats in it, a double-terminated gem whose body swells to a middle ring, so the facets above that ring tilt
up and those below tilt down and each side takes the light in two tones, as a cut gem does (a straight prism read as
a pencil at level 10). The steps between levels are big: at level 0 the core is a seed wholly inside the claws; it
grows and rises until at level 10 the claws hold only its lower point. Satellites stand between the claws (2 + level,
up to 12), shards orbit the core from level 7, and one rune lights per level (glow is information: none at 0, five at
5, all ten at 10).

Colour. The preview shows albedo plus glow, clipped, under Workbench studio light, which renders a white texel at
155 to 164 (sRGB) on faces turned to the camera and 188 at best (measured), and the runtime adds the glow at strength 3.
So every crystal region takes one linear colour for its albedo and its glow, at two strengths, and both read one hue.
Gold glow over a peach or a deep amber albedo summed past 1 in red while green kept rising: a pale lemon that rendered
olive (160, 152, 83 on the lit face, measured). The core is amber instead, painted gold across its lit upper body
(paint.add_cap on a per-vertex factor); pale gold there rendered khaki, and so did peach satellites. Satellites are a
darker amber and the metalwork an antique gold, so the core is the lightest value on the asset; the metalwork and the
lit runes are more saturated. Crystals keep flat facets, because facets are their design, and so does the metalwork;
so do the claws' blocks, because a smooth round claw read as tusk, not stone. Only the plinth's bevels shade round."""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from lib import export, geo, ink, paint, palette, scene
from lib.ctx import AssetRecord

H = palette.HEART
SIDES = 10                  # the plinth's sides, one rune on each
PLINTH_TOP = 0.42
PLINTH_SMOOTH_DEG = 35.0    # the bevels' steps shade round and catch light; the base edge stays sharp
CLAWS = 4                   # at 0, 90, 180 and 270 degrees, so a three-quarter view frames the core between two
# A claw follows a quadratic curve through these (radius, height) points in its vertical plane: it rises from the gold
# ring, bows out and hooks in over the core. Its blocks span CLAW_JOINTS, fractions of the way along the curve; the top
# block is the gold cap, and its point runs on past the last.
CLAW_CURVE = ((0.62, PLINTH_TOP - 0.04), (1.1, 1.05), (0.5, 1.78))
CLAW_JOINTS = (0.0, 0.27, 0.52, 0.75, 0.95)
# No stage's core may come nearer a claw than this: about 4 px in the stage 10 preview, where nearer reads as the core
# resting on the claw instead of floating in the cradle.
CLAW_GAP = 0.05
CORE_FLOAT = 0.2            # the level 0 core's lower point sits this far above the plinth
CORE_RISE = 0.08            # and rises this much per level, which keeps the claws clear of the widening body
CORE_SPIN = math.radians(30.0)   # a ridge, not a face, toward the three-quarter view: one lit facet, one shaded
GEM_WAIST = 0.72            # the core's shoulders against its middle ring
GEM_FOOT, GEM_TOP = 1.6, 2.0     # its point lengths, in shoulder radii
# The core has vertices only at its rings, so its gold band, interpolated between them, peaks on the middle ring.
# GOLD_SHIFT sets the band's centre this far (a fraction of the core's length) above that ring, which skews it up: the
# band covers the lit upper body and fades out toward the lower ring, so the shaded foot stays amber, where gold went
# khaki.
GOLD_SHIFT = 0.08
GOLD_WIDTH = 0.5
GOLD_CAP = {'threshold': 0.45, 'softness': 0.06, 'breakup': 0.5}
RUNE_SIZE, RUNE_DEPTH = 0.13, 0.03
# One atlas holds eleven stages and the plinth at about 34 texels per metre (measured), so one brush tile spanning
# 5.9 m makes a stroke 5 to 10 texels wide and 0.7 to 2.5 m long. The plan's 1.2 made strokes 1 to 2 texels wide, grain.
BRUSH_SCALE = 0.17


def lin(hex_color):
    return palette.hex_to_linear(hex_color)


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


AMBER_CORE = mix(lin(H['core']), lin(H['deep']), 0.65)   # the core's points and shaded facets, and its glow
GOLD_HEART = mix(lin(H['core']), lin(H['deep']), 0.15)   # its lit upper body: the core gold, deepened so shade stays gold
AMBER = mix(lin(H['core']), lin(H['deep']), 0.5)         # satellites
GOLD = lin(H['inlay'])
METAL = 0.6                  # the gold band, ring and claw caps at 60% of the palette's inlay value: antique gold


def glow_region(name, colour, albedo, glow):
    """A region whose albedo and glow are one linear colour at two strengths."""
    mat = palette.region(name, '#000000')
    mat['p99_base'] = [c * albedo for c in colour]
    mat['p99_emit'] = [c * glow for c in colour]
    mat.diffuse_color = (*mat['p99_base'], 1.0)
    return mat


def srgb_hex(colour):
    """paint.add_cap takes the cap colour as sRGB hex."""
    srgb = [c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055 for c in (min(max(v, 0.0), 1.0) for v in colour)]
    return '#' + ''.join(f'{round(c * 255):02x}' for c in srgb)


def mesh_object(name, bm, materials):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    ob = scene.link(bpy.data.objects.new(name, mesh))
    for mat in materials:
        mesh.materials.append(mat)
    return ob


def set_gold_factor(ob, lower=0.0, upper=1.0, centre=None):
    """Stores per vertex how near the gold band's peak it is (1 at `centre`, a fraction along the crystal from `lower`
    to `upper` in z, falling to 0 GOLD_WIDTH away) as the attribute the core region's cap blends by; 0 everywhere
    without a centre. Every crystal writes it: the paint bake refuses a mesh with a capped region and no attribute."""
    span = max(upper - lower, 1e-6)
    factor = [0.0 if centre is None else max(0.0, 1.0 - abs((v.co.z - lower) / span - centre) / GOLD_WIDTH)
              for v in ob.data.vertices]
    attr = ob.data.attributes.new(paint.CAP_ATTRIBUTE, 'FLOAT', 'POINT')
    attr.data.foreach_set('value', np.asarray(factor, np.float32))


def weld(ob, rings=0, min_length=0.0):
    """Merges a crystal's parts into one closed mesh. As separate capped parts, smart project gave every face its own
    UV island and the pack margin around each left 12% of the atlas painted; welded, each side is one island with its
    point and foot. rings cuts that many extra rings into edges longer than min_length (the body's sides), so a gold
    band can peak between the body's end rings instead of only at them."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    # 1 mm also collapses the foot's point, a ring of radius 0.001 * radius.
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-3)
    if rings:
        sides = [e for e in bm.edges if e.calc_length() > min_length]
        bmesh.ops.subdivide_edges(bm, edges=sides, cuts=rings, use_grid_fill=False)
    bm.to_mesh(ob.data)
    bm.free()


def place(ob, location, tilt=(0.0, 0.0), spin=0.0):
    # The spin goes first: in one XYZ euler it would also swing the lean direction.
    ob.rotation_euler = (0.0, 0.0, spin)
    scene.apply_transforms(ob)
    ob.rotation_euler = (tilt[0], tilt[1], 0.0)
    ob.location = location
    scene.apply_transforms(ob)
    geo.shade_flat(ob)
    ink.set_ink(ob, 0.9)
    return ob


def crystal(name, height, radius, material, location, tilt=(0.0, 0.0), spin=0.0, foot=0.8, gold=False):
    """A six-sided prism with a pointed top and a pointed foot (foot in radii). gold paints the core's band on it."""
    parts = [
        geo.cylinder(name + '_body', radius, height, segments=6, location=(0, 0, height / 2), material=material, caps=False),
        geo.cylinder(name + '_top', radius, radius * 1.8, segments=6, radius_top=0.0, location=(0, 0, height + radius * 0.9), material=material, caps=False),
        geo.cylinder(name + '_foot', radius * 0.001, radius * foot, segments=6, radius_top=radius, location=(0, 0, -radius * foot / 2), material=material, caps=False),
    ]
    for part in parts:
        scene.apply_transforms(part)
    ob = scene.join(parts, name)
    if gold:
        weld(ob, rings=2, min_length=height * 0.9)
        set_gold_factor(ob, -radius * foot, height + radius * 1.8, 0.55)
    else:
        weld(ob)
        set_gold_factor(ob)
    return place(ob, location, tilt, spin)


def gem(name, height, radius, material, foot_z):
    """The core, built with its lower point at the origin and placed at foot_z. Returns it and its length."""
    end = radius * GEM_WAIST
    foot, top, half = end * GEM_FOOT, end * GEM_TOP, height / 2
    parts = [
        geo.cylinder(name + '_foot', end * 0.001, foot, segments=6, radius_top=end, location=(0, 0, foot / 2), material=material, caps=False),
        geo.cylinder(name + '_low', end, half, segments=6, radius_top=radius, location=(0, 0, foot + half / 2), material=material, caps=False),
        geo.cylinder(name + '_high', radius, half, segments=6, radius_top=end, location=(0, 0, foot + half * 1.5), material=material, caps=False),
        geo.cylinder(name + '_top', end, top, segments=6, radius_top=0.0, location=(0, 0, foot + height + top / 2), material=material, caps=False),
    ]
    for part in parts:
        scene.apply_transforms(part)
    ob = scene.join(parts, name)
    weld(ob)
    length = foot + height + top
    set_gold_factor(ob, 0.0, length, (foot + half) / length + GOLD_SHIFT)
    return place(ob, (0.0, 0.0, foot_z), spin=CORE_SPIN), length


def tube(name, points, radii, materials, side, sides=8, closed=False, tip=0.0, tip_faces=0, phase=0.0):
    """A tube through world-space points: one ring of `sides` vertices per point, in the plane of `side` (a fixed vector
    square to every tangent) and side x tangent, the first vertex `phase` radians round from side. closed joins the
    last ring to the first (a torus); otherwise the first ring is capped and, with tip, the last closes to a point that
    far past it. The last tip_faces segments and the point take the second material."""
    bm = bmesh.new()
    pts = [Vector(p) for p in points]
    side = Vector(side).normalized()
    n = len(pts)
    rings = []
    for i, p in enumerate(pts):
        ahead, behind = (pts[(i + 1) % n], pts[i - 1]) if closed else (pts[min(i + 1, n - 1)], pts[max(i - 1, 0)])
        normal = side.cross((ahead - behind).normalized()).normalized()
        rings.append([bm.verts.new(p + radii[i] * (math.cos(a) * side + math.sin(a) * normal))
                      for a in (phase + k * math.tau / sides for k in range(sides))])
    segments = n if closed else n - 1
    for i in range(segments):
        a, b = rings[i], rings[(i + 1) % n]
        for k in range(sides):
            face = bm.faces.new((a[k], a[(k + 1) % sides], b[(k + 1) % sides], b[k]))
            face.material_index = 1 if not closed and i >= segments - tip_faces else 0
    if not closed:
        bm.faces.new(list(reversed(rings[0])))
        if tip > 0:
            apex = bm.verts.new(pts[-1] + (pts[-1] - pts[-2]).normalized() * tip)
            for k in range(sides):
                face = bm.faces.new((rings[-1][k], rings[-1][(k + 1) % sides], apex))
                face.material_index = 1 if tip_faces else 0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_object(name, bm, materials)


def claw(name, angle, stone, metal):
    """Carved stone blocks stacked along CLAW_CURVE, the top one gold. Each block is straight and square in section,
    with its faces to the sides, in and out, so every face takes one flat tone and the claw bends only at its joints;
    a V groove, 8 cm wide and cut to 72% of the section, marks each joint as the seam between two blocks."""
    radial = Vector((math.cos(angle), math.sin(angle), 0.0))

    def at(t):
        r, z = ((1 - t) ** 2 * a + 2 * (1 - t) * t * b + t * t * c for a, b, c in zip(*CLAW_CURVE))
        return radial * r + Vector((0.0, 0.0, z))

    joints = [at(t) for t in CLAW_JOINTS]
    widths = [0.16 - 0.095 * t for t in CLAW_JOINTS]  # the section's corner radius, tapering up the claw
    points, radii = [joints[0]], [widths[0]]
    for j in range(1, len(joints) - 1):
        before = (joints[j] - joints[j - 1]).normalized()
        after = (joints[j + 1] - joints[j]).normalized()
        points += [joints[j] - before * 0.04, joints[j], joints[j] + after * 0.04]
        radii += [widths[j], widths[j] * 0.72, widths[j]]
    points.append(joints[-1])
    radii.append(widths[-1])
    return tube(name, points, radii, [stone, metal], (-math.sin(angle), math.cos(angle), 0.0), sides=4,
                tip=0.14, tip_faces=1, phase=math.pi / 4)


def surface(objs, spacing=0.02):
    """The objects' faces as a BVH tree, and points on them for gap() to measure from: every vertex and points along
    every edge at most `spacing` apart, because two meshes can come nearest where an edge passes an edge."""
    verts, polys, points = [], [], []
    for ob in objs:
        own = [ob.matrix_world @ v.co for v in ob.data.vertices]
        polys += [[len(verts) + i for i in poly.vertices] for poly in ob.data.polygons]
        verts += own
        points += own
        for edge in ob.data.edges:
            a, b = (own[i] for i in edge.vertices)
            steps = math.ceil((b - a).length / spacing)
            points += [a.lerp(b, s / steps) for s in range(1, steps)]
    return BVHTree.FromPolygons(verts, polys), points


def gap(a, b):
    """The nearest approach of two surfaces, each one's points measured to the other's faces; 0 where faces cross."""
    (tree_a, points_a), (tree_b, points_b) = a, b
    if tree_a.overlap(tree_b):
        return 0.0
    return min(min(tree_b.find_nearest(p)[3] for p in points_a), min(tree_a.find_nearest(p)[3] for p in points_b))


def rune_frames(drum):
    """(centre, outward normal) of a rune diamond on each of the drum's faces, halfway up, in lighting order: from the
    face just past 180 degrees, counter-clockwise, so the first five face a three-quarter view from the front. The
    normal is the face's own, tilted up 13 degrees as the drum narrows, so a diamond lies flat on its face: built
    upright, its top stood 16 mm off the stone, a slot that showed through from above."""
    frames = []
    for face in drum.data.polygons:
        if abs(face.normal.z) < 0.5 and face.area > 0.05:
            normal = face.normal.copy()
            outward = Vector((normal.x, normal.y, 0.0)).normalized()
            # Where the face's centre line crosses z = 0.3; the diamond's back face sits 5 mm into the stone.
            reach = (normal.dot(face.center) - 0.3 * normal.z) / normal.dot(outward)
            frames.append((outward * reach + Vector((0.0, 0.0, 0.3)) + normal * (RUNE_DEPTH / 2 - 0.005), normal))
    if len(frames) != SIDES:  # one rune lights per level, so every side needs exactly one
        raise ValueError(f'heart plinth: {len(frames)} drum faces take a rune, not {SIDES}')
    frames.sort(key=lambda f: (math.atan2(f[1].y, f[1].x) - math.pi + 0.2) % math.tau)
    return frames


def face_axes(normal):
    """Up along a drum face with this outward normal, and across it."""
    up = (Vector((0.0, 0.0, 1.0)) - normal * normal.z).normalized()
    return up, normal.cross(up)


def rune(name, centre, normal, material):
    """A raised stone diamond on the drum, without the back face that lies against it."""
    up, across = face_axes(normal)
    diamond = geo.box(name, (RUNE_SIZE, RUNE_DEPTH, RUNE_SIZE), location=centre, material=material)
    diamond.rotation_euler = Matrix((across, normal, up)).transposed().to_euler()  # its depth along the normal
    scene.apply_transforms(diamond)
    bm = bmesh.new()
    bm.from_mesh(diamond.data)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=centre, matrix=Matrix.Rotation(math.radians(45.0), 3, normal))
    bm.normal_update()
    bmesh.ops.delete(bm, geom=[min(bm.faces, key=lambda f: f.normal.dot(normal))], context='FACES_ONLY')
    bm.to_mesh(diamond.data)
    bm.free()
    ink.set_ink(diamond, 0.4)
    return diamond


def rune_light(name, centre, normal, material):
    """A lit rune: one quad 4 mm proud of the stone diamond's face and 4% larger, so it covers it. As whole boxes in
    every stage, the runes' 660 small faces each took their own atlas island."""
    up, across = face_axes(normal)
    front = centre + normal * (RUNE_DEPTH / 2 + 0.004)
    half = RUNE_SIZE / math.sqrt(2.0) * 1.04
    bm = bmesh.new()
    face = bm.faces.new([bm.verts.new(front + d * half) for d in (up, across, -up, -across)])
    bm.normal_update()
    if face.normal.dot(normal) < 0:
        face.normal_flip()
    ob = mesh_object(name, bm, [material])
    ink.set_ink(ob, 0.0)  # a single quad has no hull to ink
    return ob


def stage(level, regions, frames, claws):
    height = 0.5 + 0.18 * level
    radius = 0.22 + 0.028 * level
    foot_z = PLINTH_TOP + CORE_FLOAT + CORE_RISE * level
    core, length = gem(f'heart_{level}_core', height, radius, regions['core'], foot_z)
    clearance = gap(surface([core]), claws)
    if clearance < CLAW_GAP:
        raise ValueError(f'heart level {level}: the core comes within {clearance * 100:.1f} cm of a claw')
    parts = [core]
    gaps = (3, 7, 5, 1)  # between the claws, in eighths of a turn: both sides first, so a three-quarter view shows two
    for i in range(min(2 + level, 12)):
        outer = i >= CLAWS
        angle = math.tau * gaps[i % CLAWS] / 8 + ((0.38 if (i // CLAWS) % 2 else -0.38) if outer else 0.0)
        distance = 0.72 + 0.012 * level if outer else 0.3 + 0.03 * level
        size = ((0.3 + 0.05 * level) * 0.8 if outer else 0.3 + 0.055 * level) * (0.78 if i % 2 else 1.0)
        lean = 0.5 if outer else 0.3
        parts.append(crystal(f'heart_{level}_sat{i}', size, 0.1 + 0.007 * level, regions['facet'],
                             (distance * math.cos(angle), distance * math.sin(angle), PLINTH_TOP - 0.02),
                             tilt=(-lean * math.sin(angle), lean * math.cos(angle)), spin=angle))
    top_z = foot_z + length
    for i in range(min(3, max(0, level - 6))):
        angle = i * math.tau / 3 + 0.5
        orbit = radius + 0.5 + 0.03 * (level - 7)
        parts.append(crystal(f'heart_{level}_shard{i}', 0.26 + 0.06 * (level - 7), 0.07 + 0.012 * (level - 7), regions['core'],
                             (orbit * math.cos(angle), orbit * math.sin(angle), top_z - height * (0.18 + 0.14 * i)),
                             tilt=(-0.35 * math.sin(angle), 0.35 * math.cos(angle)), spin=angle, foot=1.4, gold=True))
    parts += [rune_light(f'heart_{level}_rune{k}', centre, normal, regions['rune']) for k, (centre, normal) in enumerate(frames[:level])]
    return scene.join(parts, f'heart_stage_{level:02d}')


def plinth(regions):
    stone, metal = regions['stone'], regions['metal']
    parts = [
        geo.cylinder('plinth_step', 1.32, 0.14, segments=SIDES, radius_top=1.26, location=(0, 0, 0.07), bevel=0.03, material=stone),
        geo.cylinder('plinth_drum', 1.1, PLINTH_TOP - 0.14, segments=SIDES, radius_top=1.03, location=(0, 0, (PLINTH_TOP + 0.14) / 2), bevel=0.03, material=stone),
        geo.cylinder('plinth_band', 1.115, 0.05, segments=SIDES, location=(0, 0, 0.17), material=metal),
    ]
    for part in parts:
        scene.apply_transforms(part)
    geo.shade_smooth(parts[0], PLINTH_SMOOTH_DEG)
    geo.shade_smooth(parts[1], PLINTH_SMOOTH_DEG)
    frames = rune_frames(parts[1])
    parts.append(tube('plinth_ring', [(0.6 * math.cos(a), 0.6 * math.sin(a), PLINTH_TOP) for a in (k * math.tau / 40 for k in range(40))],
                      [0.05] * 40, [metal], (0.0, 0.0, 1.0), closed=True))
    claws = [claw(f'plinth_claw{k}', math.tau * k / CLAWS, stone, metal) for k in range(CLAWS)]
    parts += claws
    for part in parts:
        ink.set_ink(part, 1.2)
    parts += [rune(f'plinth_rune{k}', centre, normal, stone) for k, (centre, normal) in enumerate(frames)]
    claw_surface = surface(claws)  # before the join, which removes the claw objects
    return scene.join(parts, 'heart_plinth'), frames, claw_surface


def build(ctx):
    core = glow_region('heart_core', AMBER_CORE, 0.55, 0.5)
    paint.add_cap(core, srgb_hex([c * 0.62 for c in GOLD_HEART]), **GOLD_CAP)
    regions = {
        'core': core,
        'facet': glow_region('heart_facet', AMBER, 0.38, 0.22),
        'stone': palette.region('heart_stone', H['stone']),
        'metal': glow_region('heart_inlay', GOLD, METAL, 0.0),
        # Lit runes glow at half the core's strength: in the runtime the glow is x3, and at the core's 0.5 their gold
        # would out-shine the core's amber.
        'rune': glow_region('heart_rune', GOLD, 0.55, 0.25),
    }
    base, frames, claws = plinth(regions)
    stages = [stage(level, regions, frames, claws) for level in range(11)]
    pieces = [base] + stages
    for i, piece in enumerate(pieces):
        piece.location = (i * 3.5, 0, 0)  # apart, so ambient occlusion sees each piece alone
    # HEART_STYLE: curvature gain 2, because pointiness sits off 0.5 across whole crystal facets and the default 8 baked
    # every facet to near-white cream; a warm dark bottom tint and a lighter dark-stroke tint (0.15), because the
    # default blue bottoms and 0.25 greyed the satellites and the plinth's base beside the core (A/B, same build).
    paint.paint(pieces, name='worldheart', out_dir=ctx.bake_dir('heart'), textures_dir=ctx.textures, size=1024,
                style=palette.HEART_STYLE, ao_distance=0.3, brush_scale=BRUSH_SCALE, emissive_strength=3.0)
    for piece in pieces:
        piece.location = (0, 0, 0)
    if ctx.previews_enabled:
        for level in (0, 5, 10):
            for index, other in enumerate(stages):
                other.hide_render = index != level
            export.render_views([base, stages[level]], ctx.preview_dir(f'worldheart_stage{level:02d}'), f'stage{level:02d}', views=2)
        for other in stages:
            other.hide_render = False
    export.export_glb(pieces, ctx.raw_path('heart', 'worldheart'))
    return [AssetRecord(name='worldheart', family='heart', file='heart/worldheart.glb', nodes=[p.name for p in pieces], tris=scene.tri_count(pieces))]
