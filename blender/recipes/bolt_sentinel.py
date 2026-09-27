"""Bolt Sentinel, marks I to III: rapid single-target rails that also hit air. Each mark is a node tree the
runtime drives: bolt_mkN (base) > bolt_mkN_yaw (turns) > bolt_mkN_pitch (elevates) > rails and
bolt_mkN_muzzle<i> empties at the rail tips. Upgrades change the silhouette, not just the size (v3 creative rule): mark
I is compact, a low plinth and yaw ring under a small head with twin rails; mark II rises on a neck under a silver
collar, stands on a taller plinth and sheathes its twin rails in a shroud with the crit coil at the mouth; mark III adds
a third rail, the sensor dome, swept fins and buttresses, and keeps a crit coil on its bare rails.

Towers are the most numerous player objects on screen, so they speak the commander's plate language (bulwark.py):
slate plates, ivory trim and armour, silver rails and collar, a warm rim painted on every chamfer and a warm cap painted
on upward faces, and cyan only in energy channels (the rail strips, the shroud slot, the base band, the crit coil's
rings and the dome). The head is sculpted rather than boxed: a side profile tapered to the nose, with a glacis where the
rails leave and an ivory brow plate over its edge.

Normals follow the parts: machined parts keep one light zone per plate while their chamfers turn smoothly (weighted
normals), except where two faces meet at or under the rim bevel's 30 degree angle limit and so have no chamfer between
them: the sides of the 12-sided yaw and the 16-sided collar shade round, and the head's rear underside bends 19.4
degrees into the underside (see _machined). Round parts (the rail coils, the base band, the dome) shade round; the
rails and the crit coil's octagonal rings stay flat because there the facets are the design."""
import dataclasses
import math

import bmesh
import bpy
from mathutils import Vector

from lib import export, geo, ink, paint, palette, scene
from lib.ctx import AssetRecord

# The three marks share one 1024 px atlas at about 63 texels per metre (measured after the paint UV pass; the rim
# strips and the crit coils' ring walls add many small islands), so brush_scale 0.3, one brush tile over 3.3 m, paints
# the tile's 12 to 26 px strokes 5 to 11 texels wide.
BRUSH_SCALE = 0.3
ROUND_SMOOTH_DEG = 60.0  # coil and band sides meet at 22.5 to 45 degrees and shade round; caps (90) stay flat
# The brow, armour and fin plates' faces meet one another at 0 to 1.4 degrees and the one-segment chamfers round them
# at 43 to 47 (measured), so 40 shades each plate as one surface and keeps its chamfer a crisp line. The one exception
# is the brow's fold over the glacis edge, 54 degrees: past 40, so it stays a hard crease, and 1 degree short of
# _slab's 55 degree chamfer limit, so no chamfer or warm rim line runs along it.
PLATE_DEG = 40.0

# Recipe-local colours: the commander's (bulwark.py) except the slate and its cap, which the commander's worst-ground
# rule sets again on the towers' own forms. Rendered without ink (front three-quarter and strategic views pooled over
# the three marks, full bakes of this recipe), the share at least 15 L* off the ground is 69% over the Verdant canopy
# median #3f7953 (L* 46), 68% over near-black #1c1b20 (10) and 99.7% over pale sand #e6dcc4 (88) with this slate
# (L* 36). A lighter slate (L* 38, #4a5a73) under a quarter step scores 71% and 69%: 0.8 points more over near-black,
# where an atlas repack alone moves the figure 0.2, so a real but small lead, bought with half the key light (see CAPS).
# The commander's own slate (L* 44) and cap leave 52% over the canopy: a turret shows more upward faces than a standing
# figure, and its lit slate lands on the canopy's value. Every other pair tried scored 67% or less on its worst ground.
COLOURS = {
    'plate': '#46566e', 'plate_dark': '#323c4f', 'plate_light': '#c2ccd8', 'enamel': '#ebe1ca',
    'rim': '#dacdb5', 'rim_enamel': '#fff4dc',
}
# The painted key light: each colour's warm light counterpart on upward faces, the commander's except the slate's,
# which rises half the commander's step (7.1 L* lighter and warmer, in CIE Lab, against its 14.2). Against a quarter
# step it widens the rendered slate's lightness spread (10th to 90th percentile) from 15.7 to 17.4 L*, so tops part
# from flanks as painted light; a full step lifts the lit tops back onto the canopy's value (61 to 65% over it).
CAPS = {'plate': '#5b6779', 'plate_dark': '#4c5566', 'plate_light': '#e0e5eb', 'enamel': '#fff7e4', 'rim': '#f0e6d0'}
# The commander's stroke settings with a higher threshold. The breakup spreads the cap's edge over threshold - 0.25 to
# threshold + 0.25, and mark I's plinth sides face 15 degrees up (normal z 0.27): at the commander's 0.3 every stroke
# lighter than 0.56 would cap them, a blotch; at 0.5 only strokes above 0.96 reach them.
CAP = {'threshold': 0.5, 'softness': 0.03, 'breakup': 0.5}
# The commander's warm edge tint on PLAYER_STYLE's hard-surface gain of 2 rather than the commander's 3: on these
# low-poly plates pointiness sits off 0.5 across whole faces (the palette's note on gain 8), so more gain lifts panels,
# not edges, and the painted rims already carry the edges.
BOLT_STYLE = dataclasses.replace(palette.PLAYER_STYLE, edge_tint=(1.0, 0.86, 0.66))

# The head's side profile, (y, z) around from the nose (-y): the rails leave the glacis at z 0, the roof rises a little
# to the back, then a sloped back and a chin. Its half width tapers from BACK_W to NOSE_W, so the head points where it
# shoots. Every corner but PROFILE[5] turns 43 to 68 degrees, past _rimmed's 30 degree limit, and takes a rim line.
# PROFILE[5] turns only 19.4, so no chamfer lies between the rear underside (PROFILE[4] to [5]) and the underside ([5]
# to [6]), and the rear underside bends 19.4 degrees into the underside (see _machined).
PROFILE = [(-0.44, -0.05), (-0.29, 0.19), (0.27, 0.22), (0.45, 0.07), (0.43, -0.15), (0.25, -0.21), (-0.33, -0.2)]
NOSE_W, BACK_W = 0.28, 0.35
MARKS = {
    1: {'base_h': 0.3, 'base_r': 0.74, 'head': 0.9, 'neck': 0.14, 'rails': (-0.16, 0.16), 'length': 0.95},
    2: {'base_h': 0.42, 'base_r': 0.82, 'head': 1.0, 'neck': 0.34, 'rails': (-0.17, 0.17), 'length': 1.2},
    3: {'base_h': 0.52, 'base_r': 0.88, 'head': 1.08, 'neck': 0.4, 'rails': (-0.23, 0.0, 0.23), 'length': 1.4},
}


def _regions():
    c = COLOURS
    r = {
        'plate': palette.region('bolt_plate', c['plate']),
        'plate_dark': palette.region('bolt_plate_dark', c['plate_dark']),
        'plate_light': palette.region('bolt_plate_light', c['plate_light']),
        'enamel': palette.region('bolt_enamel', c['enamel']),
        'glow': palette.region('bolt_glow', palette.PLAYER['gunmetal'], emit_hex=palette.PLAYER['energy']),
    }
    rim = paint.add_cap(palette.region('bolt_rim', c['rim']), CAPS['rim'], **CAP)
    rim_enamel = palette.region('bolt_rim_enamel', c['rim_enamel'])
    for key in ('plate', 'plate_dark', 'plate_light', 'enamel'):
        r[key]['bolt_rim'] = (rim_enamel if key == 'enamel' else rim).name
        paint.add_cap(r[key], CAPS[key], **CAP)
    return r


def _add_rim(ob):
    """Appends the part's rim region as material 1 and says whether it has one."""
    mat = ob.data.materials[0] if ob.data.materials else None
    rim = bpy.data.materials.get(mat['bolt_rim']) if mat is not None and 'bolt_rim' in mat else None
    if rim is not None:
        ob.data.materials.append(rim)
    return rim is not None


def _rimmed(ob, width, angle_deg=30.0):
    """A two-segment chamfer whose faces take the rim region: the painted warm edge line. Painted rather than derived,
    as on the commander, because the curvature gain that would light these edges lifts whole faces here."""
    has_rim = _add_rim(ob)
    return geo.modifier(ob, 'BEVEL', width=width, segments=2, limit_method='ANGLE', angle_limit=math.radians(angle_deg),
                        material=1 if has_rim else -1)


def _machined(part):
    """Every face smooth, then weighted normals by face area at full weight: each plate parted from its neighbours by
    chamfers keeps its own normal and each chamfer turns smoothly from one plate to the next. Smoothing by angle
    cannot do both on two-segment chamfers (plate to chamfer 22.5 degrees, chamfer to chamfer 45): at 30 to 40
    degrees the old pitch box's plates tilted 14.7 degrees at their corners and every bevel creased down its middle
    (measured)."""
    geo.shade_smooth(part, 180.0)
    # thresh is an absolute area tolerance in square metres: at full weight only faces within it of the largest face
    # at a vertex shape that vertex's normal. The default 0.01 counted the old bevel strips (0.002 to 0.005) with the
    # narrow plates they bordered (0.008 to 0.013) and tilted those plates, the armour's end plates 6.2 degrees and the
    # fins' 4.5 (measured). At 0.001 every plate with a bevel strip along each edge is flat and each chamfer still turns
    # from plate to plate. Plates that meet at or under _rimmed's 30 degree angle limit get no strip between them, so
    # each vertex they share takes one normal and no tolerance can flatten both. Measured on all three marks, the yaw's
    # 12 sides meet at the limit, 29.999995 to 30.000011 degrees, and the collar's 16 sloped sides at 17.7. Each part's
    # sides are all one size, so every edge between two takes the average of their normals and the sides shade round,
    # turning 15 degrees off their own normals at each edge on the yaw and 8.8 on the collar. The head's rear underside
    # meets the underside at 19.4 degrees (PROFILE[5]); the underside is the larger and keeps its normal, so the rear
    # underside bends the whole 19.4.
    return geo.modifier(part, 'WEIGHTED_NORMAL', mode='FACE_AREA', weight=100, keep_sharp=True, thresh=0.001)


def _rounded(part):
    return geo.shade_smooth(part, ROUND_SMOOTH_DEG)


def _leaf(ob):
    """A part no runtime code drives carries its placement in its mesh, as the commander's parts do."""
    scene.apply_transforms(ob)
    return ob


def _child(part, parent, width):
    geo.cap_factor(part)
    scene.parent_keep(part, parent)
    ink.set_ink(part, width)
    return part


def _mesh(name, verts, faces, material):
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts]
    for face in faces:
        bm.faces.new([vs[i] for i in face])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(material)
    return scene.link(bpy.data.objects.new(name, mesh))


def _extrude(name, outline, place, material):
    """A closed outline swept between two ends; place(u, v, end) maps an outline point to 3D at end 0 or 1."""
    n = len(outline)
    verts = [place(u, v, 0) for u, v in outline] + [place(u, v, 1) for u, v in outline]
    faces = [list(range(n)), list(range(2 * n - 1, n - 1, -1))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return _mesh(name, verts, faces, material)


def _washer(verts, faces, r_out, r_in, segments, place, phase=0.0):
    """Appends a flat ring with walls to verts and faces; place(u, v, end) maps a point (u, v) of the ring's plane to 3D
    on its face 0 or 1, and the first corner sits at angle phase."""
    n, o = segments, len(verts)
    for end in (0, 1):
        for r in (r_out, r_in):
            verts.extend(place(r * math.cos(2 * math.pi * i / n + phase), r * math.sin(2 * math.pi * i / n + phase), end)
                         for i in range(n))
    for i in range(n):
        k = (i + 1) % n
        faces += [(o + i, o + k, o + 2 * n + k, o + 2 * n + i), (o + n + k, o + n + i, o + 3 * n + i, o + 3 * n + k),
                  (o + 2 * n + i, o + 2 * n + k, o + 3 * n + k, o + 3 * n + i), (o + k, o + i, o + n + i, o + n + k)]


def _ring(name, r_out, r_in, height, segments, material, location):
    """A flat ring with walls, so the trim leaves the plinth top inside it showing: a full disc would floor the plinth
    top in ivory once the neck narrows."""
    verts, faces = [], []
    _washer(verts, faces, r_out, r_in, segments, lambda u, v, end: (u, v, (end - 0.5) * height))
    ob = _mesh(name, verts, faces, material)
    ob.location = location
    return ob


def _coil(name, apothem_out, apothem_in, y_front, z, material, rings=3, width=0.04, pitch=0.085):
    """The crit coil: thin octagonal rings around the rail axis in one part, the first with its front face at y_front
    and each next one pitch further back. It was one solid disc, which read as a flat cyan plate hung on the rails; the
    rings spend about the same glow (13.4% of mark II's ink-free pixels, the disc 12.6%) on thin channels, show the
    rails through the coil and give the side view a segmented edge. The octagon echoes the plinth, the trim and the
    shroud's outline, and a flat of it lies on each flank of what it winds round (apothem_in just inside the shroud's
    or the outer rails' side faces), so the rings bear on it instead of floating. Each ring's thin walls pack as small
    atlas islands: a fourth ring on mark III cost 1.6 of the atlas's 63 texels per metre (measured)."""
    to_corner = 1.0 / math.cos(math.pi / 8)
    verts, faces = [], []
    for k in range(rings):
        y = y_front + k * pitch
        # A half-segment phase puts a flat, not a corner, on each flank.
        _washer(verts, faces, apothem_out * to_corner, apothem_in * to_corner, 8,
                lambda u, v, end, y=y: (u, y + end * width, z + v), phase=math.pi / 8)
    return geo.shade_flat(_mesh(name, verts, faces, material))


def _slab(name, rows, thickness, material):
    """A plate through rows of points, thickened inward, whose rim and chamfer faces take the rim region (bulwark.py's
    _solid)."""
    bm = bmesh.new()
    vrows = [[bm.verts.new(p) for p in row] for row in rows]
    for lo, hi in zip(vrows[:-1], vrows[1:]):
        for i in range(len(lo) - 1):
            bm.faces.new((lo[i], lo[i + 1], hi[i + 1], hi[i]))
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(material)
    ob = scene.link(bpy.data.objects.new(name, mesh))
    has_rim = _add_rim(ob)
    geo.modifier(ob, 'SOLIDIFY', thickness=thickness, offset=-1.0, use_even_offset=True, use_rim=True,
                 material_offset_rim=1 if has_rim else 0)
    # Under half the thickness, so the two rim chamfers never meet.
    geo.modifier(ob, 'BEVEL', width=thickness * 0.3, segments=1, limit_method='ANGLE', angle_limit=math.radians(55),
                 material=1 if has_rim else -1)
    return geo.shade_smooth(ob, PLATE_DEG)


def head(p, r, head_z, level, s):
    """The pitch node and its plates at scale s. Returns the node, the plates and the scaled profile."""
    prof = [(y * s, z * s) for y, z in PROFILE]

    def width(y):
        return (NOSE_W + (BACK_W - NOSE_W) * (y / s + 0.44) / 0.89) * s

    # The node's origin stays at the pivot, where the runtime elevates it.
    core = _extrude(f'{p}_pitch', prof, lambda y, z, end: (width(y) if end else -width(y), y, z), r['plate'])
    core.location = (0, 0, head_z)
    core = _machined(_rimmed(core, 0.02))
    g0, g1, r1 = (Vector(v) for v in prof[:3])
    glacis = Vector((g0.y - g1.y, g1.x - g0.x)).normalized()
    glacis = glacis if glacis.x < 0 else -glacis  # outward: forward and up
    roof = Vector((g1.y - r1.y, r1.x - g1.x)).normalized()
    roof = roof if roof.y > 0 else -roof
    slope = (r1.y - g1.y) / (r1.x - g1.x)
    lift = 0.012  # plates stand this proud and are thicker, so no gap opens and no faces are coplanar
    # The brow runs from halfway up the glacis over its edge onto the roof and ends in a chevron, like the commander's
    # chest V.
    lines = [(g0.lerp(g1, 0.45) + glacis * lift, 0.0), (g1 + (glacis + roof).normalized() * lift, 0.0),
             (g1.lerp(r1, 0.3) + roof * lift, 0.1 * s)]
    rows = []
    for yz, chevron in lines:
        half = width(yz.x) - 0.04
        row = []
        for i in range(7):
            x = -half + 2 * half * i / 6
            y = yz.x + chevron * (1.0 - abs(x) / half)
            row.append((x, y, yz.y + (y - yz.x) * slope + head_z))
        rows.append(row)
    plates = [_slab(f'{p}_brow', rows, 0.022, r['enamel'])]
    if level >= 2:  # cheek armour on each tapered side; rows run so that each plate faces out
        for side, label in ((1, 'L'), (-1, 'R')):
            rows = []
            for z, y0, y1 in ((-0.13, -0.32, 0.34), (0.0, -0.3, 0.33), (0.14, -0.22, 0.3)):
                row = [(side * (width(y) + lift), y, z * s + head_z) for y in (s * (y0 + (y1 - y0) * k / 3) for k in range(4))]
                rows.append(row if side > 0 else row[::-1])
            plates.append(_slab(f'{p}_armor{label}', rows, 0.024, r['enamel']))
    if level >= 3:  # fins rise from the roof's back half and sweep back past it, canted out into a V
        for side, label in ((1, 'L'), (-1, 'R')):
            rows = []
            for ya, yb, dz in ((0.02, 0.26, -0.01), (0.26, 0.6, 0.16)):
                row = []
                for k in range(3):
                    y = s * (ya + (yb - ya) * k / 2)
                    on_roof = min(y, r1.x)
                    row.append((side * (width(on_roof) - 0.05 + 0.55 * max(0.0, dz) * s), y,
                                g1.y + (on_roof - g1.x) * slope + dz * s + head_z))
                rows.append(row if side > 0 else row[::-1])
            plates.append(_slab(f'{p}_fin{label}', rows, 0.03, r['enamel']))
    return core, plates, prof


def mark(level, r):
    m = MARKS[level]
    p = f'bolt_mk{level}'
    R, H, s = m['base_r'], m['base_h'], m['head']
    # The base node keeps its origin at mid-plinth, as before, since the runtime places the node. The octagon's sides
    # meet at 45 degrees, over the 30 degree limit, so each corner takes a warm rim line as well as the top and bottom.
    base = geo.cylinder(p, R, H, segments=8, radius_top=R - 0.09, location=(0, 0, H / 2), material=r['plate'])
    base = _machined(_rimmed(base, 0.018))
    geo.cap_factor(base)
    ink.set_ink(base, 1.2)
    parts = [base]
    for i in range(4):
        angle = 0.785 + i * 1.5708
        foot = _leaf(geo.box(f'{p}_foot{i}', (0.3, 0.5, 0.18), location=((R - 0.06) * math.cos(angle), (R - 0.06) * math.sin(angle), 0.09),
                             rotation=(0, 0, angle), material=r['plate']))
        parts.append(_child(_machined(_rimmed(foot, 0.018)), base, 1.0))
    trim = _leaf(_ring(f'{p}_trim', R - 0.07, R - 0.18, 0.05, 8, r['enamel'], (0, 0, H)))
    parts.append(_child(_machined(_rimmed(trim, 0.01)), base, 0.8))
    if level >= 2:
        band = _leaf(geo.cylinder(f'{p}_ring', R - 0.035, 0.04, segments=16, location=(0, 0, H * 0.55), material=r['glow']))
        parts.append(_child(_rounded(band), base, 0.5))
    if level >= 3:
        for i in range(4):
            angle = i * 1.5708
            buttress = _leaf(geo.box(f'{p}_buttress{i}', (0.16, 0.35, H * 0.9), location=((R + 0.02) * math.cos(angle), (R + 0.02) * math.sin(angle), H * 0.45),
                                     rotation=(0, 0, angle), material=r['plate']))
            parts.append(_child(_machined(_rimmed(buttress, 0.016)), base, 1.0))
    # Dark slate where the turret turns, as the commander keeps its dark undersuit to the joints: a low ring on mark I,
    # a neck on marks II and III.
    neck = m['neck']
    yaw = geo.cylinder(f'{p}_yaw', 0.46 if level == 1 else 0.3, neck, segments=12, location=(0, 0, H + neck / 2), material=r['plate_dark'])
    parts.append(_child(_machined(_rimmed(yaw, 0.015)), base, 1.0))
    top = H + neck
    if level >= 2:  # the collar: a silver gorget under the head, as on the commander
        collar = _leaf(geo.cylinder(f'{p}_collar', 0.4, 0.1, segments=16, radius_top=0.32, location=(0, 0, top - 0.04), material=r['plate_light']))
        parts.append(_child(_machined(_rimmed(collar, 0.012)), yaw, 1.0))
    head_z = top + 0.2 * s
    pitch, plates, prof = head(p, r, head_z, level, s)
    parts.append(_child(pitch, yaw, 1.15))
    parts.extend(_child(_leaf(plate), pitch, 0.9) for plate in plates)
    length = m['length']
    rail_y0 = -0.3 * s
    for i, x in enumerate(m['rails']):
        rail = _leaf(geo.box(f'{p}_rail{i}', (0.1, length, 0.1), location=(x, rail_y0 - length / 2, head_z), material=r['plate_light']))
        parts.append(_child(rail, pitch, 0.9))
        strip = _leaf(geo.box(f'{p}_railglow{i}', (0.035, length * 0.9, 0.105), location=(x, rail_y0 - length / 2, head_z + 0.004), material=r['glow']))
        parts.append(_child(strip, pitch, 0.0))
        if level != 2:  # mark II's shroud covers where its coils would sit
            for k in range(2 if level == 1 else 3):
                coil = _rounded(_leaf(geo.cylinder(f'{p}_coil{i}_{k}', 0.085, 0.06, segments=8, location=(x, prof[0][0] - 0.02 - k * 0.22, head_z),
                                                   rotation=(1.5708, 0, 0), material=r['plate_dark'])))
                parts.append(_child(coil, pitch, 0.6))
        muzzle = bpy.data.objects.new(f'{p}_muzzle{i}', None)
        scene.link(muzzle)
        muzzle.location = (x, rail_y0 - length, head_z)
        scene.parent_keep(muzzle, pitch)
    if level == 2:
        # The shroud runs two thirds of the rails from inside the nose; the rail tips, their strips and the two muzzles
        # stay out in front of it.
        y0, y1 = prof[0][0] + 0.06, rail_y0 - length * 0.66
        hw, hh, c = 0.3, 0.12, 0.05
        outline = [(hw - c, -hh), (hw, -hh + c), (hw, hh - c), (hw - c, hh), (-hw + c, hh), (-hw, hh - c), (-hw, -hh + c), (-hw + c, -hh)]
        shroud = _extrude(f'{p}_shroud', outline, lambda x, z, end: (x, y1 if end else y0, head_z + z), r['plate'])
        parts.append(_child(_machined(_rimmed(shroud, 0.016)), pitch, 1.0))
        slot = _leaf(geo.box(f'{p}_shroudglow', (0.05, (y0 - y1) * 0.86, 0.02), location=(0, (y0 + y1) / 2, head_z + hh + 0.002), material=r['glow']))
        parts.append(_child(slot, pitch, 0.0))
        # At the shroud's mouth, bearing on its flanks (x 0.3).
        parts.append(_child(_coil(f'{p}_critcoil', 0.355, 0.295, y1 + 0.02, head_z, r['glow']), pitch, 0.5))
    if level >= 3:
        # In front of the nose, bearing on the outer rails' sides (x 0.28). The outer rails' middle coils pierce its
        # middle ring, reaching 0.04 m into its wall, while the middle rail's middle coil sits 0.19 m inside it.
        parts.append(_child(_coil(f'{p}_critcoil', 0.335, 0.275, -0.66 * s - 0.105, head_z, r['glow']), pitch, 0.5))
        dome_y = 0.08 * s
        dome_z = prof[1][1] + (dome_y - prof[1][0]) * (prof[2][1] - prof[1][1]) / (prof[2][0] - prof[1][0])
        dome = _rounded(_leaf(geo.uv_sphere(f'{p}_sensor', 0.16 * s, segments=12, rings=6, hemisphere=True, location=(0, dome_y, head_z + dome_z), material=r['glow'])))
        parts.append(_child(dome, pitch, 0.6))
    return base, parts


def build(ctx):
    r = _regions()
    roots = []
    meshes = []
    for level in (1, 2, 3):
        base, parts = mark(level, r)
        base.location.x = (level - 1) * 4.0  # apart for the bake; children follow their parents
        roots.append(base)
        meshes.extend(parts)
    bpy.context.view_layer.update()
    paint.paint(meshes, name='bolt_sentinel', out_dir=ctx.bake_dir('towers'), textures_dir=ctx.textures, size=1024,
                style=BOLT_STYLE, ao_distance=0.35, brush_scale=BRUSH_SCALE, emissive_strength=4.0)
    if ctx.previews_enabled:
        previews = ctx.preview_dir('bolt_sentinel')
        export.render_views(meshes, previews, 'bolt_sentinel', views=4, size=640)
        # The line-up leaves each turret about 100 px of its 640 px tile, too small to judge strokes or light
        # zones, so each mark also gets a row of its own. Its neighbours stand 4 m away and would cut into some of
        # its frames, so they sit out of those renders.
        for level, root in enumerate(roots, 1):
            others = [ob for other in roots if other is not root for ob in scene.descendants(other)]
            previous = {ob: ob.hide_render for ob in others}
            for ob in others:
                ob.hide_render = True
            try:
                export.render_views(scene.meshes(scene.descendants(root)), previews, f'bolt_sentinel_zoom_mk{level}', views=4, size=640)
            finally:
                for ob, hidden in previous.items():
                    ob.hide_render = hidden
    for root in roots:
        root.location.x = 0.0
    everything = [ob for root in roots for ob in scene.descendants(root)]
    export.export_glb(everything, ctx.raw_path('towers', 'bolt_sentinel'))
    return [AssetRecord(name='bolt_sentinel', family='towers', file='towers/bolt_sentinel.glb',
                        nodes=[ob.name for ob in everything], tris=scene.tri_count(meshes))]
