"""Primitive builders and modifiers. Builders return a linked mesh object whose mesh is centred on its own
origin, with location and rotation left on the object, so a recipe can place parts, parent them and apply
transforms only when it joins them."""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise

from . import scene
from .paint import CAP_ATTRIBUTE


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


def ellipsoid_normals(ob, center, radii=(1.0, 1.0, 1.0)):
    """Aims every vertex normal out of a proxy ellipsoid, n = normalize((p - center) / radii^2), as custom split
    normals: a faceted clump then takes light as one broad rounded zone instead of one flat tone per facet, while
    its silhouette keeps the facets. Call it on a part in its final space (transforms applied) and before the
    join. The join, the paint bake's edit-mode UV pass and the glTF export all keep these normals: what is left is
    the precision of Blender's custom normal storage, within 0.005 degrees in the tests and 0.13 at most on the
    Verdant clumps. Faces go smooth and sharp edges are cleared, because either one overrides a custom normal.
    That is also why shade_smooth must not run after this, on the part or on the joined mesh: it marks sharp edges
    again and bends these normals (over 100 degrees on a Verdant conifer tier), and nothing reports it, since
    has_custom_normals stays True. Smooth an asset's other parts before the join and never the joined mesh. The
    runtime hull ink (M0d's computeInkNormals) pushes along the exported normals averaged over the vertices that
    share a position, so these normals move the ink too. Measured with that averaging on both the shipped Verdant
    kit and the same geometry exported flat, which writes one normal per polygon, they move it by 9.8 degrees on
    average (24.9 at most) on the crown's clumps, 8.5 (18.5) on the bush's and 22.5 (53.8) on the conifer tiers,
    nine tenths of it at the tiers' tips (40.8 on average there, 4.2 at the rims). Averaging per triangle instead,
    as a measurement that reads only the GLB does, overweights any polygon that is not planar, such as a tier's end
    cap or its side quads, and reads 40.6 on the tiers."""
    mesh = ob.data
    c = Vector(center)
    normals = []
    for vertex in mesh.vertices:
        d = vertex.co - c
        n = Vector((d.x / radii[0] ** 2, d.y / radii[1] ** 2, d.z / radii[2] ** 2))
        normals.append(n.normalized() if n.length > 1e-9 else Vector((0.0, 0.0, 1.0)))
    for poly in mesh.polygons:
        poly.use_smooth = True
    sharp = mesh.attributes.get('sharp_edge')
    if sharp is not None:
        mesh.attributes.remove(sharp)
    mesh.normals_split_custom_set_from_vertices(normals)
    return ob


def cap_factor(ob, iterations=0):
    """Stores per vertex how far the shading normal faces world up (the z of its world-space direction) as the float
    attribute the paint bake blends a capped region by (paint.add_cap). It reads the shading normals, so the cap
    follows the light the part will get: the proxy normal after ellipsoid_normals, the smooth-by-angle normal on a
    rock. Caps follow world up, not the part's own z, because recipes apply transforms only when they join: a part
    capped while its rotation is still on the object caps its new top. Each of `iterations` rounds averages every
    vertex with its neighbours: a rock keeps its big plane breaks sharp for shading, and without this the cap
    boundary would still bend toward those breaks. Call it on a part before the join, once its normals and its
    orientation are final: a part joined without it reads 0, so every part that uses a capped region needs it."""
    mesh = ob.data
    loops = len(mesh.loops)
    corner = np.empty(loops * 3, np.float64)
    mesh.corner_normals.foreach_get('vector', corner)
    loop_vertex = np.empty(loops, np.int64)
    mesh.loops.foreach_get('vertex_index', loop_vertex)
    normal = np.zeros((len(mesh.vertices), 3))
    np.add.at(normal, loop_vertex, corner.reshape(-1, 3))
    # matrix_world refreshes only when Blender re-evaluates the scene, so a part rotated since then would hand over
    # its old matrix and cap its old top.
    bpy.context.view_layer.update()
    # Normals take the inverse transpose, which keeps them perpendicular to their faces under non-uniform scale.
    to_world = np.array(ob.matrix_world.to_3x3().inverted().transposed())
    normal = normal @ to_world.T
    edges = np.empty(len(mesh.edges) * 2, np.int64)
    mesh.edges.foreach_get('vertices', edges)
    a, b = edges[0::2], edges[1::2]
    for _ in range(iterations):
        normal /= np.maximum(np.linalg.norm(normal, axis=1, keepdims=True), 1e-9)
        spread = normal.copy()
        np.add.at(spread, a, normal[b])
        np.add.at(spread, b, normal[a])
        normal = spread
    normal /= np.maximum(np.linalg.norm(normal, axis=1, keepdims=True), 1e-9)
    attr = mesh.attributes.get(CAP_ATTRIBUTE) or mesh.attributes.new(CAP_ATTRIBUTE, 'FLOAT', 'POINT')
    attr.data.foreach_set('value', normal[:, 2].astype(np.float32))
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
