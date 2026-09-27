"""A Xeno nest: a low chitin mound ringed by inward-leaning spikes, a glowing maw and glowing vents.
Magenta light leaks through seams as pressure, not as a lamp (blueprint, material language). So the maw's light
sits below the rim of a crater in the mound and the vents stand only just out of the chitin: the glow reads as
light pushing out from inside the shell. A glowing puck on top of the mound and pegs standing out of it read as
lamps.

The mound takes its normals from a proxy ellipsoid (geo.ellipsoid_normals), so it lights as one broad dome while its
faceted silhouette stays; the spikes shade smooth along their sides."""
import math

import bmesh
import bpy
from mathutils import Vector

from lib import export, geo, ink, paint, palette, scene
from lib.ctx import AssetRecord

X = palette.XENO
MOUND_RADII = (1.6, 1.6, 1.6 * 0.62)
BASE_SINK = 0.03        # the flattened base sits this far into the ground, as the Verdant rocks' bases do
CRATER_DEPTH = 0.3      # the crater's floor under its lowest rim vertex: steep walls keep the light inside
MAW_INSET = 0.03        # the maw's light sits this far under the lowest rim vertex and reaches this far past the widest
VENT_PROUD = 0.02       # flush enough to read as an opening, clear enough of the chitin not to z-fight with it
SPIKE_SMOOTH_DEG = 70.0  # the six sides (60 degrees apart) shade as one horn; the base cap stays sharp
# The nest's atlas holds about 73 texels per metre, so one brush tile spanning 4 m makes a stroke 7 to 15 texels
# wide and 0.5 to 1.7 m long: a handful across the mound. The plan's 0.9 made strokes 2 to 4 texels wide, grain.
BRUSH_SCALE = 0.25


def crater(mound, pole):
    """Sinks the dome's pole below its first ring, turning the top of the mound into a funnel. Returns the ring's lowest
    height and widest radius, which size the maw. A hole cut in the shell instead let a low camera see the far rim's
    inside, which the runtime culls (front faces only), and look straight through the nest."""
    bm = bmesh.new()
    bm.from_mesh(mound.data)
    bm.verts.ensure_lookup_table()
    apex = bm.verts[pole]
    ring = [edge.other_vert(apex) for edge in apex.link_edges]
    lowest = min(v.co.z for v in ring)
    widest = max(math.hypot(v.co.x, v.co.y) for v in ring)
    apex.co = Vector((0.0, 0.0, lowest - CRATER_DEPTH))
    bm.to_mesh(mound.data)
    bm.free()
    return lowest, widest


def build(ctx):
    chitin = palette.region('xeno_chitin', X['chitin'])
    # Pale spikes, as the review expects: chitin_light (#3a2c52) left them a violet barely lighter than the mound.
    bone = palette.region('xeno_bone', X['bone'])
    seam = palette.region('xeno_seam', X['chitin'], emit_hex=X['seam'])
    mound = geo.uv_sphere('nest_mound', 1.6, segments=20, rings=10, scale=(1, 1, 0.62), hemisphere=True, material=chitin)
    scene.apply_transforms(mound)
    base = [v.index for v in mound.data.vertices if abs(v.co.z) < 1e-4]
    pole = max(mound.data.vertices, key=lambda v: v.co.z).index
    geo.displace(mound, 0.16, frequency=1.4, seed=4)
    # The displacement moves the base ring between -0.048 and +0.077 (measured), so the nest would float on part of
    # its rim.
    for index in base:
        mound.data.vertices[index].co.z = -BASE_SINK
    rim_low, rim_wide = crater(mound, pole)
    geo.facet(mound, 10.0)
    geo.ellipsoid_normals(mound, (0, 0, 0), MOUND_RADII)
    ink.set_ink(mound, 1.0)
    parts = [mound]
    # Wider than the crater's rim, so its edge stays inside the shell and only the light shows through the opening.
    top = rim_low - MAW_INSET
    maw = geo.cylinder('nest_maw', rim_wide + MAW_INSET, 0.3, segments=12, location=(0, 0, top - 0.15), material=seam)
    ink.set_ink(maw, 0.5)
    parts.append(maw)
    spikes = []
    for i in range(7):
        angle = i * math.tau / 7
        spike = geo.cylinder(f'nest_spike{i}', 0.18, 1.3, segments=6, radius_top=0.0,
                             location=(1.25 * math.cos(angle), 1.25 * math.sin(angle), 0.55),
                             rotation=(0.35 * math.sin(angle), -0.35 * math.cos(angle), 0), material=bone)
        ink.set_ink(spike, 1.2)
        spikes.append(spike)
    parts += spikes
    # Each vent stands on the displaced surface along its normal: placed on the ideal ellipsoid and tilted inward, as
    # planned, they stood up to 8 cm proud or sank, as pegs.
    bpy.context.view_layer.update()
    for i in range(5):
        angle = i * math.tau / 5 + 0.3
        hit, point, normal, _ = mound.ray_cast(Vector((0.9 * math.cos(angle), 0.9 * math.sin(angle), 3.0)), Vector((0, 0, -1)))
        if not hit:  # a miss returns the origin, which would bury the vent inside the mound
            raise ValueError(f'nest vent {i}: no mound surface under it')
        vent = geo.cylinder(f'nest_vent{i}', 0.08, 0.25, segments=8, location=point + normal * (VENT_PROUD - 0.125),
                            rotation=Vector((0, 0, 1)).rotation_difference(normal).to_euler(), material=seam)
        ink.set_ink(vent, 0.4)
        parts.append(vent)
    for part in parts:
        scene.apply_transforms(part)
    # Before the join: smoothing by angle after it would bend the mound's custom normals, not clear them (up to 77
    # degrees on the open mound at SPIKE_SMOOTH_DEG, measured), and nothing reports it (see geo.ellipsoid_normals).
    for spike in spikes:
        geo.shade_smooth(spike, SPIKE_SMOOTH_DEG)
    nest = scene.join(parts, 'nest')
    paint.paint([nest], name='nest', out_dir=ctx.bake_dir('nests'), textures_dir=ctx.textures, size=512,
                style=palette.XENO_STYLE, ao_distance=0.5, brush_scale=BRUSH_SCALE, emissive_strength=4.0)
    if ctx.previews_enabled:
        export.render_views([nest], ctx.preview_dir('nest'), 'nest', views=4)
    export.export_glb([nest], ctx.raw_path('nests', 'nest'))
    return [AssetRecord(name='nest', family='nests', file='nests/nest.glb', nodes=['nest'], tris=scene.tri_count([nest]))]
