"""Primitive builders and modifiers. Builders return a linked mesh object whose mesh is centred on its own
origin, with location and rotation left on the object, so a recipe can place parts, parent them and apply
transforms only when it joins them."""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

from . import scene


def _from_bmesh(name, bm, material):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    ob = scene.link(bpy.data.objects.new(name, mesh))
    if material is not None:
        mesh.materials.append(material)
    return ob


def _place(ob, location, rotation):
    ob.location = location
    ob.rotation_euler = rotation
    return ob


def modifier(ob, kind, **settings):
    mod = ob.modifiers.new(kind.lower(), kind)
    for key, value in settings.items():
        setattr(mod, key, value)
    scene.apply_modifiers(ob)
    return ob


def add_bevel(ob, width, segments=2):
    return modifier(ob, 'BEVEL', width=width, segments=segments, limit_method='ANGLE')


def box(name, size, location=(0, 0, 0), rotation=(0, 0, 0), bevel=0.0, segments=2, material=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    ob = _place(_from_bmesh(name, bm, material), location, rotation)
    if bevel > 0:
        add_bevel(ob, bevel, segments)
    return ob


def cylinder(name, radius, depth, segments=16, radius_top=None, location=(0, 0, 0), rotation=(0, 0, 0), bevel=0.0, material=None, caps=True):
    bm = bmesh.new()
    top = radius if radius_top is None else radius_top
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segments, radius1=radius, radius2=top, depth=depth)
    ob = _place(_from_bmesh(name, bm, material), location, rotation)
    if bevel > 0:
        add_bevel(ob, bevel)
    return ob


def ico(name, radius, subdivisions=2, scale=(1, 1, 1), location=(0, 0, 0), rotation=(0, 0, 0), material=None):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    return _place(_from_bmesh(name, bm, material), location, rotation)


def uv_sphere(name, radius, segments=16, rings=8, scale=(1, 1, 1), location=(0, 0, 0), rotation=(0, 0, 0), material=None, hemisphere=False):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    if hemisphere:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        # dist > 0 because an even ring count puts the equator exactly on the plane, and the default dist=0
        # duplicates that ring into a band of zero-area faces (measured in Blender 5.2).
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=(0, 0, 0), plane_no=(0, 0, 1), clear_inner=True)
        bmesh.ops.holes_fill(bm, edges=bm.edges[:], sides=0)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    return _place(_from_bmesh(name, bm, material), location, rotation)


def segment(name, head, tail, radius_head, radius_tail, segments=8, material=None):
    """A tapered cylinder from head to tail, for limbs laid along bones."""
    head, tail = Vector(head), Vector(tail)
    direction = tail - head
    ob = cylinder(name, radius_head, direction.length, segments=segments, radius_top=radius_tail, material=material)
    ob.rotation_euler = Vector((0, 0, 1)).rotation_difference(direction).to_euler()
    ob.location = (head + tail) / 2
    return ob


def displace(ob, strength, frequency=1.5, seed=0, octaves=3):
    """Pushes vertices along their normals by fractal noise; the seed shifts the noise field."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    offset = Vector((seed * 13.1, seed * 7.7, seed * 3.3))
    for vertex in bm.verts:
        vertex.co += vertex.normal * strength * noise.fractal(vertex.co * frequency + offset, 0.5, 2.0, octaves)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


def facet(ob, angle_deg=12.0):
    """Merges near-coplanar faces into broad planes: the simplified volume Sifu paints over."""
    return modifier(ob, 'DECIMATE', decimate_type='DISSOLVE', angle_limit=math.radians(angle_deg))


def smooth(ob, levels=1):
    return modifier(ob, 'SUBSURF', levels=levels, render_levels=levels)


def bend(ob, angle_deg, axis='Z'):
    return modifier(ob, 'SIMPLE_DEFORM', deform_method='BEND', angle=math.radians(angle_deg), deform_axis=axis)


def taper(ob, factor, axis='Z'):
    return modifier(ob, 'SIMPLE_DEFORM', deform_method='TAPER', factor=factor, deform_axis=axis)


def shade_flat(ob):
    for poly in ob.data.polygons:
        poly.use_smooth = False
    return ob


def shade_smooth(ob, angle_deg=40.0):
    scene.select_only([ob])
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))
    return ob


def assign_by_normal(ob, up, side, threshold=0.55):
    """Faces whose object-space normal points up take `up` (moss on rocks, sunlit crowns on trees)."""
    mesh = ob.data
    mesh.materials.clear()
    mesh.materials.append(side)
    mesh.materials.append(up)
    for poly in mesh.polygons:
        poly.material_index = 1 if poly.normal.z > threshold else 0
    return ob


def rotation_z(angle):
    return Matrix.Rotation(angle, 3, 'Z')
