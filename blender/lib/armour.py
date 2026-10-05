"""The commanders' armour vocabulary: the sculpted primitives (closed superquadrics, curved plates, lofts, limbs, a
blade) and the plate family's colours, painted key light caps and paint style. The Bulwark recipe made them, and the
CharForge rework (lib/charforge.py) armours its commanders with the same pieces so they read as one family. They live
here because no recipe imports another recipe; they moved from recipes/bulwark.py unchanged apart from their public
names, and the Bulwark built from them has the same geometry, skin, clips and materials as before the move."""
import dataclasses
import math

import bmesh
import bpy
from mathutils import Vector

from . import geo, palette, scene

# The packed atlas holds about 130 texels per metre (measured after the paint UV pass; many small plate islands each
# carry the pack margin). The brush tile's strokes are 12 to 26 of its 512 texels wide and one tile spans
# 1 / BRUSH_SCALE metres, so 0.5 keeps the narrowest stroke about 6 bake texels wide.
BRUSH_SCALE = 0.5
# Neighbouring faces of the curved plates meet at 10 to 25 degrees and a one-segment chamfer meets both the face and the
# rim at 45, so 40 rolls the light across each plate and keeps its chamfer as one crisp line.
PLATE_DEG = 40.0

# The plate colours, picked for the Bulwark by the worst ground rather than the Verdant one. Rendered without ink (front
# three-quarter and third-person views pooled), the share of the figure at least 15 L* off the ground is 66% over
# Verdant foliage (rendered L* 46), 65% over near-black #1c1b20 (10) and 99% over pale sand #e6dcc4 (88) with this
# slate (albedo L* 44, rendered 27), and no mid plate tried raises the lowest of the three: round two's slate (L* 40)
# left 56% over near-black, #6b7a90 (51) 56% over the greens. Light and mid grounds also have the runtime ink to carry
# the silhouette; a dark ground has only value. The dark plate, silver trims and ivory keep their values, and the
# groups stay apart (rendered medians 16, 27, 52 and 60).
COLOURS = {
    'plate': '#5a6a83', 'plate_dark': '#323c4f', 'plate_light': '#c2ccd8', 'enamel': '#ebe1ca', 'undersuit': '#22263a',
    'rim': '#dacdb5', 'rim_enamel': '#fff4dc', 'blade': '#dce6f0',
}
# The painted key light: each plate colour's warm light counterpart on its upward faces. The slate's cap keeps round
# two's step from its plate (14 L* lighter and warmer, in CIE Lab), so the lighter slate keeps the same key light.
CAPS = {'plate': '#858e99', 'plate_dark': '#4c5566', 'plate_light': '#e0e5eb', 'enamel': '#fff7e4', 'rim': '#f0e6d0'}
# The Verdant kit's stroke settings (breakup 0.5 lets whole strokes cross the edge, softness 0.03 keeps them crisp); a
# threshold of 0.3 puts the edge a little above each form's horizon, so tops and upper flanks catch the key.
CAP = {'threshold': 0.3, 'softness': 0.03, 'breakup': 0.5}
# At PLAYER_STYLE's gain of 2 the curvature term adds almost nothing here (see recipes/bulwark.py); 3 lends every surface
# a faint warm lift without flattening the plate groups, which the painted rims keep apart.
PLATE_STYLE = dataclasses.replace(palette.PLAYER_STYLE, curv_gain=3.0, edge_light=0.6, edge_tint=(1.0, 0.86, 0.66))
# The material property under which a plate region names its rim region, which solid reads. It keeps the Bulwark's name
# from before the move, because a material's custom properties ship in the GLB as the material's extras.
RIM_KEY = 'bulwark_rim'


def spow(value, exponent):
    return math.copysign(abs(value) ** exponent, value)


def rows_mesh(name, rows, closed, material):
    """Quads between successive rows of points. A one-point row is a pole, closed by a fan of triangles, never by a
    ring of zero-area quads. Rows run bottom to top and points counterclockwise seen from outside, so faces point out."""
    bm = bmesh.new()
    vrows = [[bm.verts.new(p) for p in row] for row in rows]
    n = max(len(row) for row in rows)
    for lo, hi in zip(vrows[:-1], vrows[1:]):
        for i in range(n if closed else n - 1):
            k = (i + 1) % n
            if len(lo) == 1:
                bm.faces.new((lo[0], hi[k], hi[i]))
            elif len(hi) == 1:
                bm.faces.new((lo[i], lo[k], hi[0]))
            else:
                bm.faces.new((lo[i], lo[k], hi[k], hi[i]))
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    if material is not None:
        mesh.materials.append(material)
    return scene.link(bpy.data.objects.new(name, mesh))


def sq_point(radii, e_v, e_h, lon, lat):
    ring = max(math.cos(lat), 0.0) ** e_v
    return Vector((radii[0] * ring * spow(math.cos(lon), e_h), radii[1] * ring * spow(math.sin(lon), e_h),
                   radii[2] * spow(math.sin(lat), e_v)))


def place(ob, location, rotation):
    ob.location = location
    ob.rotation_euler = rotation
    return ob


def chain(*deforms):
    def deform(p):
        for fn in deforms:
            if fn is not None:
                p = fn(p)
        return p
    return deform


def taper(half, bottom, top):
    """Scales x and y linearly with z, from `bottom` at -half to `top` at +half."""
    def deform(p):
        s = bottom + (top - bottom) * (p.z / half + 1.0) / 2.0
        return Vector((p.x * s, p.y * s, p.z))
    return deform


def bend_over(radius, lift=0.0):
    """Wraps a shape laid along y over a circle of `radius` in the yz plane (centre at z = -radius)."""
    def deform(p):
        a = p.y / radius
        r = radius + p.z + lift
        return Vector((p.x, r * math.sin(a), r * math.cos(a) - radius))
    return deform


def volume(name, radii, e_v=1.0, e_h=1.0, nu=16, nv=10, deform=None, material=None, location=(0, 0, 0), rotation=(0, 0, 0)):
    """A closed superquadric: an exponent below 1 squares that section toward a rounded box, 1 keeps it elliptic."""
    rows = []
    for j in range(nv + 1):
        lat = -math.pi / 2 + math.pi * j / nv
        row = [sq_point(radii, e_v, e_h, -math.pi + 2 * math.pi * i / nu, lat) for i in range(1 if j in (0, nv) else nu)]
        rows.append([deform(p) for p in row] if deform else row)
    return place(rows_mesh(name, rows, True, material), location, rotation)


def solid(ob, thickness, bevel=True):
    """Thickens a plate inward. A plate region names its rim region under RIM_KEY: the rim and chamfer faces take it,
    which paints the warm edge line."""
    mat = ob.data.materials[0] if ob.data.materials else None
    rim = bpy.data.materials.get(mat[RIM_KEY]) if mat is not None and RIM_KEY in mat else None
    if rim is not None:
        ob.data.materials.append(rim)
    geo.modifier(ob, 'SOLIDIFY', thickness=thickness, offset=-1.0, use_even_offset=True, use_rim=True,
                 material_offset_rim=1 if rim is not None else 0)
    if bevel:
        # Under half the thickness, so the two rim chamfers never meet (they would leave zero-area faces).
        geo.modifier(ob, 'BEVEL', width=thickness * 0.3, segments=1, limit_method='ANGLE', angle_limit=math.radians(55),
                     material=1 if rim is not None else -1)
    return ob


def plate(name, radii, lon, lat, thickness, e_v=1.0, e_h=1.0, nu=12, nv=3, deform=None, material=None,
          location=(0, 0, 0), rotation=(0, 0, 0), bevel=True):
    """A curved plate cut from a superquadric between longitudes and latitudes in degrees (lon 0 is +x, -90 the front).
    A latitude of 90 closes it to a pole: a dome."""
    lon0, lon1 = (math.radians(a) for a in lon)
    lat0, lat1 = (math.radians(a) for a in lat)
    closed = abs(lon1 - lon0 - 2 * math.pi) < 1e-6
    rows = []
    for j in range(nv + 1):
        la = lat0 + (lat1 - lat0) * j / nv
        if abs(la - math.pi / 2) < 1e-6:
            row = [Vector((0.0, 0.0, radii[2]))]
        else:
            row = [sq_point(radii, e_v, e_h, lon0 + (lon1 - lon0) * i / nu, la) for i in range(nu if closed else nu + 1)]
        rows.append([deform(p) for p in row] if deform else row)
    return solid(place(rows_mesh(name, rows, closed, material), location, rotation), thickness, bevel)


def loft(name, sections, lon, thickness, e_h=1.0, nu=12, material=None, location=(0, 0, 0), rotation=(0, 0, 0), bevel=True):
    """A plate lofted through superelliptic arcs (z, rx, ry) listed bottom to top; a 360 degree span closes it."""
    lon0, lon1 = (math.radians(a) for a in lon)
    closed = abs(lon1 - lon0 - 2 * math.pi) < 1e-6
    angles = [lon0 + (lon1 - lon0) * i / nu for i in range(nu if closed else nu + 1)]
    rows = [[Vector((rx * spow(math.cos(a), e_h), ry * spow(math.sin(a), e_h), z)) for a in angles] for z, rx, ry in sections]
    return solid(place(rows_mesh(name, rows, closed, material), location, rotation), thickness, bevel)


def upright(ob, a, b):
    """Lays a part built along +z between points a and b with +z toward the higher one, so its local y stays near world
    y (the back): turning +z onto a downward bone is a half turn about an arbitrary axis."""
    a, b = Vector(a), Vector(b)
    lo, hi = (a, b) if a.z <= b.z else (b, a)
    ob.rotation_euler = Vector((0, 0, 1)).rotation_difference(hi - lo).to_euler()
    ob.location = (lo + hi) / 2
    return ob


def limb(name, a, b, ra, rb, e_v=0.4, e_h=1.0, nu=12, nv=8, deform=None, material=None):
    """A tube with rounded ends from a (radius ra) to b (radius rb)."""
    a, b = Vector(a), Vector(b)
    half = (b - a).length / 2
    lo_r, hi_r = (ra, rb) if a.z <= b.z else (rb, ra)
    ob = volume(name, (1.0, 1.0, half), e_v, e_h, nu, nv, deform=chain(taper(half, lo_r, hi_r), deform), material=material)
    return upright(ob, a, b)


def lerp(a, b, t):
    return Vector(a).lerp(Vector(b), t)


def blade(name, base, length, half_width, half_thick, material, sections=8):
    """A hexagonal-section blade along -y from `base`: flat faces on both sides carry the fuller, edges up and down,
    and the last stretch narrows to the point."""
    base = Vector(base)
    rows = [[base.copy()]]
    for k in range(sections):
        s = k / (sections - 1) * 0.86
        w = half_width * (1.0 - 0.1 * s) * (1.0 if s < 0.7 else (1.0 - s) / 0.3)
        hexagon = [(0, w), (-half_thick, 0.35 * w), (-half_thick, -0.35 * w), (0, -w), (half_thick, -0.35 * w), (half_thick, 0.35 * w)]
        rows.append([Vector((base.x + x, base.y - length * s, base.z + z)) for x, z in hexagon])
    rows.append([Vector((base.x, base.y - length, base.z))])
    return rows_mesh(name, rows, True, material)


def mirror_lon(lon, s):
    """A longitude range for side s (+1 left, -1 right), mirrored across x."""
    return lon if s > 0 else (180.0 - lon[1], 180.0 - lon[0])
