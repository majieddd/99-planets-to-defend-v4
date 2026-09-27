"""Verdant Highlands kit: three rocks, a broad-crowned tree, a conifer, a bush, a grass tuft and a flower
clump. Volumes are simplified (broad faceted planes, big foliage clumps) so the painted bake carries the
detail, the way Sifu's environments do. Each piece exports at its own origin for instancing.

Normals carry the light, not the facets: foliage clumps, conifer tiers and flower heads get custom normals out of
a proxy ellipsoid (geo.ellipsoid_normals), rocks smooth across small facets but keep their big plane breaks, and
wood is smooth. The silhouettes stay faceted, but the runtime hull ink is pushed along the exported normals averaged
per position, so the proxy normals move it too (geo.ellipsoid_normals gives the measured shift).

Light caps (moss on rocks, the light crown of every foliage mass) are painted, not assigned per face: each capped
region blends to its cap colour by a smooth per-vertex factor (geo.cap_factor: the proxy normal's z on foliage, a
neighbour-averaged normal's z on rocks) with a brush-broken edge (paint.add_cap). A per-face split drew that edge
along polygon edges, which the smooth normals above had otherwise hidden."""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

from lib import export, geo, ink, paint, palette, scene
from lib.ctx import AssetRecord, Placeable

P = palette.VERDANT
ROCK_SMOOTH_DEG = 38.0   # breaks sharper than this stay as planes; smaller facets shade as one surface
WOOD_SMOOTH_DEG = 80.0   # trunk and stem sides smooth, end caps stay sharp
GRASS_SMOOTH_DEG = 60.0
BRUSH_SCALE = 0.25       # one 512 texel brush tile spans 4 m: a handful of strokes across a rock face or clump
# Rocks and clumps keep the old per-face cut points (0.6, 0.35). breakup 0.5 lets whole strokes cross the edge in
# both directions, which reads as paint (0.3 reads as a wobbly line); softness 0.03 keeps each stroke's edge crisp
# rather than airbrushed.
FOLIAGE_CAP = {'threshold': 0.35, 'softness': 0.03, 'breakup': 0.5}
ROCK_CAP = {'threshold': 0.6, 'softness': 0.03, 'breakup': 0.5}
# Each tier hides the upper part of the one below it, so at the clumps' 0.35 the visible skirts all went dark and the
# conifer lost the light balance chosen for V5b_dome; 0.15 keeps only a painted dark rim.
CONIFER_CAP = {'threshold': 0.15, 'softness': 0.03, 'breakup': 0.5}
ROCK_CAP_SMOOTHING = 3   # neighbour-averaging rounds, so the moss drapes over plane breaks instead of stopping at them
# Designed sinks: how far a piece reaches under its origin on purpose (lib.ctx.Placeable). assets:check holds each
# piece's lowest point to its sink within 5 mm either way, so a sink states the depth the geometry has.
# A rock beds its flat base this far into the ground, so the uneven ground of a planet never shows a gap under its edge
# (0.0500 to 0.0501 m, measured on the shipped kit).
ROCK_SINK = 0.05
# The bush's four clumps sit 0.05 to 0.10 m deeper than their radii (each centre lies lower than its radius), so the
# foliage meets the ground as a wide mound instead of resting on the point of a ball. The leaf displacement (0.1 m)
# moves the deepest point, under the clump at x -0.4, on to 0.1138 m under the origin (measured on the shipped kit),
# which the sink gives to the millimetre. It was 0.12, a bound rather than the depth, which the check now refuses.
BUSH_SINK = 0.114


def _regions():
    return {
        'stone': paint.add_cap(palette.region('verdant_stone', P['stone']), P['moss'], **ROCK_CAP),
        'bark': palette.region('verdant_bark', P['bark']),
        'leaf': paint.add_cap(palette.region('verdant_foliage', P['foliage']), P['foliage_light'], **FOLIAGE_CAP),
        'tier': paint.add_cap(palette.region('verdant_foliage_tier', P['foliage']), P['foliage_light'], **CONIFER_CAP),
        'grass': palette.region('verdant_grass', P['meadow']),
        'flower': palette.region('verdant_flower', P['flower']),
        'flower_warm': palette.region('verdant_flower_warm', P['flower_warm']),
    }


def _finish(parts, name, width):
    for part in parts:
        scene.apply_transforms(part)
        ink.ensure_ink(part, width)
    ob = scene.join(parts, name) if len(parts) > 1 else parts[0]
    ob.name = name
    return ob


def rock(name, seed, scale, r):
    ob = geo.ico(name, 1.0, subdivisions=3, scale=scale, material=r['stone'])
    scene.apply_transforms(ob)
    geo.displace(ob, 0.28, frequency=1.3, seed=seed)
    geo.facet(ob, 14.0)
    floor = -0.35 * scale[2]
    for vertex in ob.data.vertices:
        vertex.co.z = max(vertex.co.z, floor) - floor - ROCK_SINK  # flat base, bedded ROCK_SINK into the ground
    geo.shade_smooth(ob, ROCK_SMOOTH_DEG)
    geo.cap_factor(ob, ROCK_CAP_SMOOTHING)
    ink.set_ink(ob, 1.1)
    return ob


def tree_broad(name, r):
    parts = [geo.cylinder(name + '_trunk', 0.2, 2.4, segments=8, radius_top=0.1, location=(0, 0, 1.2), material=r['bark'])]
    for i, (yaw, height) in enumerate(((0.3, 1.8), (2.4, 2.0), (4.3, 1.9))):
        direction = Vector((math.cos(yaw), math.sin(yaw), 0.9)).normalized()
        start = Vector((0, 0, height))
        parts.append(geo.segment(f'{name}_branch{i}', start, start + direction * 0.9, 0.07, 0.03, segments=6, material=r['bark']))
    for part in parts:
        geo.shade_smooth(part, WOOD_SMOOTH_DEG)
    clumps = [(0, 0, 3.0, 1.1), (0.8, 0.2, 2.6, 0.8), (-0.7, -0.3, 2.7, 0.85), (0.2, -0.8, 2.5, 0.75),
              (-0.2, 0.8, 2.9, 0.8), (0.5, 0.5, 3.4, 0.7), (-0.5, 0.2, 3.5, 0.65)]
    for i, (x, y, z, radius) in enumerate(clumps):
        clump = geo.ico(f'{name}_clump{i}', radius, subdivisions=2, location=(x, y, z), material=r['leaf'])
        scene.apply_transforms(clump)
        geo.displace(clump, 0.18, frequency=1.6, seed=10 + i)
        geo.facet(clump, 10.0)
        geo.ellipsoid_normals(clump, (x, y, z))
        geo.cap_factor(clump)
        ink.set_ink(clump, 1.25)
        parts.append(clump)
    for part in parts[:4]:
        ink.set_ink(part, 1.0)
    return _finish(parts, name, 1.0)


def tree_conifer(name, r):
    parts = [geo.cylinder(name + '_trunk', 0.14, 1.2, segments=7, radius_top=0.1, location=(0, 0, 0.6), material=r['bark'])]
    geo.shade_smooth(parts[0], WOOD_SMOOTH_DEG)
    ink.set_ink(parts[0], 1.0)
    for i, (z, radius, depth) in enumerate(((1.1, 1.0, 1.4), (1.9, 0.8, 1.2), (2.6, 0.6, 1.0), (3.2, 0.4, 0.9))):
        cone = geo.cylinder(f'{name}_tier{i}', radius, depth, segments=9, radius_top=0.02, location=(0, 0, z), material=r['tier'])
        scene.apply_transforms(cone)
        geo.displace(cone, 0.08, frequency=3.0, seed=20 + i)
        # The proxy is a dome on the tier's base: the rim faces sideways and the tip up, so each tier takes one
        # broad light zone. A proxy spanning the whole tier, (0, 0, z) with radii (radius, radius, depth / 2),
        # turns the lower half of every tier down into shadow and reads dark and striped.
        geo.ellipsoid_normals(cone, (0, 0, z - depth / 2), (radius, radius, depth))
        # A tier's faces run rim to tip, so a per-face split painted whole faces; the per-vertex factor runs
        # from about 0 at the rim to 1 at the tip and puts a painted light crown on each tier instead.
        geo.cap_factor(cone)
        ink.set_ink(cone, 1.2)
        parts.append(cone)
    return _finish(parts, name, 1.0)


def bush(name, r):
    parts = []
    for i, (x, y, z, radius) in enumerate(((0, 0, 0.45, 0.55), (0.45, 0.1, 0.35, 0.4), (-0.4, 0.15, 0.35, 0.42), (0.05, -0.4, 0.3, 0.38))):
        clump = geo.ico(f'{name}_clump{i}', radius, subdivisions=2, location=(x, y, z), material=r['leaf'])
        scene.apply_transforms(clump)
        geo.displace(clump, 0.1, frequency=2.0, seed=30 + i)
        geo.facet(clump, 10.0)
        geo.ellipsoid_normals(clump, (x, y, z))
        geo.cap_factor(clump)
        ink.set_ink(clump, 1.1)
        parts.append(clump)
    return _finish(parts, name, 1.1)


def grass_tuft(name, r, seed=5):
    """Nine curved blades. Thin cards carry no ink (width 0): hull lines on blades read as noise."""
    rnd = random.Random(seed)
    bm = bmesh.new()
    for _ in range(9):
        base = Vector((rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12), 0))
        height = rnd.uniform(0.4, 0.7)
        width = rnd.uniform(0.04, 0.07)
        lean = rnd.uniform(0.08, 0.2)
        spin = Matrix.Rotation(rnd.uniform(0, math.tau), 3, 'Z')
        rows = []
        for step in range(3):
            t = step / 3
            half = width * 0.5 * (1 - t)
            rows.append([bm.verts.new(base + spin @ Vector((side * half, lean * t * t, height * t))) for side in (-1, 1)])
        tip = bm.verts.new(base + spin @ Vector((0, lean, height)))
        for a, b in zip(rows[:-1], rows[1:]):
            bm.faces.new((a[0], a[1], b[1], b[0]))
        bm.faces.new((rows[-1][0], rows[-1][1], tip))
    data = bpy.data.meshes.new(name)
    bm.to_mesh(data)
    bm.free()
    mesh = scene.link(bpy.data.objects.new(name, data))
    data.materials.append(r['grass'])
    # Smooth along each blade rather than ground-aligned normals: the runtime negates the normal on the back face
    # of a double-sided mesh, so ground normals would light each blade's front and black out its back.
    geo.shade_smooth(mesh, GRASS_SMOOTH_DEG)
    ink.set_ink(mesh, 0.0)
    mesh['double_sided'] = True  # exported as extras; the runtime renders both faces
    return mesh


def flowers(name, r, seed=9):
    rnd = random.Random(seed)
    parts = []
    for i in range(5):
        x, y = rnd.uniform(-0.25, 0.25), rnd.uniform(-0.25, 0.25)
        height = rnd.uniform(0.25, 0.45)
        stem = geo.cylinder(f'{name}_stem{i}', 0.012, height, segments=5, location=(x, y, height / 2), material=r['grass'])
        geo.shade_smooth(stem, WOOD_SMOOTH_DEG)
        parts.append(stem)
        head = geo.ico(f'{name}_head{i}', 0.07, subdivisions=1, scale=(1, 1, 0.45), location=(x, y, height + 0.02),
                       material=r['flower'] if i % 2 else r['flower_warm'])
        scene.apply_transforms(head)
        geo.ellipsoid_normals(head, (x, y, height + 0.02), (0.07, 0.07, 0.07 * 0.45))
        parts.append(head)
    for part in parts:
        ink.set_ink(part, 0.6)
    return _finish(parts, name, 0.6)


def _render_each(pieces, ctx):
    """One full-size render per piece: in the kit shot each piece is about 50 px wide at 768, too small to judge
    strokes and moss."""
    for i, piece in enumerate(pieces):
        for other in pieces:
            other.hide_render = other is not piece
        export.render_views([piece], ctx.preview_dir('verdant_kit'), f'verdant_kit_{i}_{piece.name}', views=1, size=768)
    for piece in pieces:
        piece.hide_render = False


def build(ctx):
    r = _regions()
    pieces = [
        rock('rock_a', 1, (1.0, 0.8, 0.7), r),
        rock('rock_b', 2, (1.3, 1.0, 0.6), r),
        rock('rock_c', 3, (0.7, 0.7, 0.9), r),
        tree_broad('tree_broad', r),
        tree_conifer('tree_conifer', r),
        bush('bush', r),
        grass_tuft('grass_tuft', r),
        flowers('flowers', r),
    ]
    for i, piece in enumerate(pieces):
        piece.location = (i * 5.0, 0, 0)  # apart, so ambient occlusion sees each piece alone
    paint.paint(pieces, name='verdant_kit', out_dir=ctx.bake_dir('env'), textures_dir=ctx.textures, size=1024,
                style=palette.NATURE_STYLE, ao_distance=0.6, brush_scale=BRUSH_SCALE)
    if ctx.previews_enabled:
        export.render_views(pieces, ctx.preview_dir('verdant_kit'), 'verdant_kit', views=2, size=768)
        _render_each(pieces, ctx)
    for piece in pieces:
        piece.location = (0, 0, 0)
    export.export_glb(pieces, ctx.raw_path('env', 'verdant_kit'))
    # The runtime scatters each piece by itself, so each is a placeable that stands on its origin unless it sinks by
    # design.
    sinks = {'rock_a': ROCK_SINK, 'rock_b': ROCK_SINK, 'rock_c': ROCK_SINK, 'bush': BUSH_SINK}
    placeables = [Placeable(p.name, sinks.get(p.name, 0.0)) for p in pieces]
    return [AssetRecord(name='verdant_kit', family='env', file='env/verdant_kit.glb', nodes=[p.name for p in pieces],
                        tris=scene.tri_count(pieces), placeables=placeables)]
