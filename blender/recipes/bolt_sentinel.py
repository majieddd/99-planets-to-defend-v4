"""Bolt Sentinel, marks I to III: rapid single-target rails that also hit air. Each mark is a node tree the
runtime drives: bolt_mkN (base) > bolt_mkN_yaw (turns) > bolt_mkN_pitch (elevates) > rails and
bolt_mkN_muzzle<i> empties at the rail tips. Upgrades change the machine, not just its size: mark II adds
armour and a crit coil, mark III a third rail, fins, a sensor dome and buttresses (v3 creative rule).

Normals follow the parts: the machined boxes and the octagonal base take one light zone per plate while their
bevels catch the light, round parts (coils, rings, the sensor dome) shade round, and the rails and the octagonal
trim stay flat because there the facets are the design. The 12-sided yaw shades round as well: its sides meet at
the bevel's 30 degree angle limit, so no bevel strips keep them apart (see _machined)."""
import math

import bpy

from lib import export, geo, ink, paint, palette, scene
from lib.ctx import AssetRecord

T = palette.PLAYER
# The three marks share one 1024 px atlas at about 72 texels per metre (measured), so brush_scale 0.3, one brush
# tile over 3.3 m, paints the tile's 12 to 26 px strokes 6 to 12 texels wide and five to seven of them cross a
# pitch box or base plate. At 1.1 they were 1.5 to 3.3 texels wide and read as grain, not paint.
BRUSH_SCALE = 0.3
ROUND_SMOOTH_DEG = 60.0  # coil and ring sides meet at 45 and 22.5 degrees and shade round; caps (90) stay flat


def _machined(part):
    """Every face smooth, then weighted normals by face area at full weight: each box plate keeps its own normal and
    each bevel turns smoothly from one plate to the next. Smoothing by angle cannot do both on these two-segment
    bevels (plate to bevel 22.5 degrees, bevel to bevel 45): at 30 to 40 degrees the pitch box's plates tilted
    14.7 degrees at their corners and every bevel creased down its middle (measured). The 12-sided yaw shades round
    instead: its sides meet at exactly 30 degrees, the bevel's angle limit, so they get no bevel, and each edge
    between two sides of equal area takes the average of their normals, 15 degrees off each side."""
    geo.shade_smooth(part, 180.0)
    # thresh is an absolute area tolerance in square metres: at full weight only faces within it of the largest face
    # at a vertex shape that vertex's normal. The default 0.01 counted bevel strips (0.002 to 0.005) with the narrow
    # plates they border (0.008 to 0.013) and tilted those plates, the armour's end plates 6.2 degrees and the fins'
    # 4.5 (measured). At 0.001 every box plate is flat and each bevel still turns from plate to plate. No tolerance
    # can flatten the yaw's sides: they are all one size and no bevel strip lies between them, so they shade round.
    return geo.modifier(part, 'WEIGHTED_NORMAL', mode='FACE_AREA', weight=100, keep_sharp=True, thresh=0.001)


def _rounded(part):
    return geo.shade_smooth(part, ROUND_SMOOTH_DEG)


def _regions():
    return {
        'metal': palette.region('tech_gunmetal', T['gunmetal']),
        'metal_light': palette.region('tech_gunmetal_light', T['gunmetal_light']),
        'trim': palette.region('tech_trim', T['trim']),
        'glow': palette.region('tech_glow', T['gunmetal'], emit_hex=T['energy']),
    }


def _child(part, parent, width):
    scene.parent_keep(part, parent)
    ink.set_ink(part, width)
    return part


def mark(level, r):
    p = f'bolt_mk{level}'
    base_h = 0.35 + 0.12 * (level - 1)
    base = _machined(geo.cylinder(p, 0.78 + 0.06 * (level - 1), base_h, segments=8, radius_top=0.7, location=(0, 0, base_h / 2), bevel=0.03, material=r['metal']))
    ink.set_ink(base, 1.2)
    parts = [base]
    for i in range(4):
        angle = 0.785 + i * 1.5708
        foot = _machined(geo.box(f'{p}_foot{i}', (0.3, 0.5, 0.18), location=(0.72 * math.cos(angle), 0.72 * math.sin(angle), 0.09), rotation=(0, 0, angle), bevel=0.03, material=r['metal_light']))
        parts.append(_child(foot, base, 1.0))
    parts.append(_child(geo.cylinder(f'{p}_trim', 0.72, 0.05, segments=8, location=(0, 0, base_h), material=r['trim']), base, 0.8))
    if level >= 2:
        parts.append(_child(_rounded(geo.cylinder(f'{p}_ring', 0.745, 0.04, segments=16, location=(0, 0, base_h * 0.55), material=r['glow'])), base, 0.5))
    if level >= 3:
        for i in range(4):
            angle = i * 1.5708
            buttress = _machined(geo.box(f'{p}_buttress{i}', (0.16, 0.35, base_h * 0.9), location=(0.82 * math.cos(angle), 0.82 * math.sin(angle), base_h * 0.45), rotation=(0, 0, angle), bevel=0.02, material=r['metal']))
            parts.append(_child(buttress, base, 1.0))
    yaw = _machined(geo.cylinder(f'{p}_yaw', 0.5, 0.2, segments=12, location=(0, 0, base_h + 0.1), bevel=0.02, material=r['metal_light']))
    parts.append(_child(yaw, base, 1.0))
    head_z = base_h + 0.45
    pitch = _machined(geo.box(f'{p}_pitch', (0.7, 0.9, 0.42), location=(0, 0, head_z), bevel=0.05, material=r['metal']))
    parts.append(_child(pitch, yaw, 1.15))
    rails = [-0.18, 0.18] if level < 3 else [-0.22, 0.0, 0.22]
    length = 1.0 + 0.2 * (level - 1)
    for i, x in enumerate(rails):
        rail = geo.box(f'{p}_rail{i}', (0.1, length, 0.1), location=(x, -length / 2 - 0.3, head_z), material=r['trim'])
        parts.append(_child(rail, pitch, 0.9))
        strip = geo.box(f'{p}_railglow{i}', (0.035, length * 0.9, 0.105), location=(x, -length / 2 - 0.3, head_z + 0.004), material=r['glow'])
        parts.append(_child(strip, pitch, 0.0))
        for k in range(2 + level // 2):
            coil = _rounded(geo.cylinder(f'{p}_coil{i}_{k}', 0.085, 0.06, segments=8, location=(x, -0.45 - k * 0.22, head_z), rotation=(1.5708, 0, 0), material=r['metal_light']))
            parts.append(_child(coil, pitch, 0.6))
        muzzle = bpy.data.objects.new(f'{p}_muzzle{i}', None)
        scene.link(muzzle)
        muzzle.location = (x, -length - 0.3, head_z)
        scene.parent_keep(muzzle, pitch)
    if level >= 2:
        for side, label in ((1, 'L'), (-1, 'R')):
            plate = _machined(geo.box(f'{p}_armor{label}', (0.08, 0.7, 0.36), location=(side * 0.4, 0, head_z), bevel=0.02, material=r['metal_light']))
            parts.append(_child(plate, pitch, 1.0))
        coil = _rounded(geo.cylinder(f'{p}_critcoil', 0.26 + 0.04 * (level - 2), 0.08, segments=16, location=(0, -0.62, head_z), rotation=(1.5708, 0, 0), material=r['glow']))
        parts.append(_child(coil, pitch, 0.5))
    if level >= 3:
        dome = _rounded(geo.uv_sphere(f'{p}_sensor', 0.16, segments=12, rings=6, hemisphere=True, location=(0, 0.1, head_z + 0.21), material=r['glow']))
        parts.append(_child(dome, pitch, 0.6))
        for side, label in ((1, 'L'), (-1, 'R')):
            fin = _machined(geo.box(f'{p}_fin{label}', (0.05, 0.35, 0.3), location=(side * 0.3, 0.5, head_z + 0.1), rotation=(0.4, 0, 0), bevel=0.01, material=r['metal']))
            parts.append(_child(fin, pitch, 0.9))
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
                style=palette.PLAYER_STYLE, ao_distance=0.35, brush_scale=BRUSH_SCALE, emissive_strength=4.0)
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
