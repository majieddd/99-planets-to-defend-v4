"""CharForge to commander: the reusable rework of a CharForge character (a skinned mesh on a Mixamo skeleton, one
albedo atlas, the face morphs blink_L, blink_R, smile, brows_up and pucker, a jaw bone and CharForge's clips) into a
99 Planets commander with the painted material, ink, armour and a dedicated face texture.

The steps run in this order, each a function below that takes the settings dict (DEFAULTS merged with the recipe's
overrides through settings()):

1. import_source: the GLB, minus the importer's stray unparented meshes, at rest with every key at zero.
2. reshape: head scale and total height on the mesh, every shape key and the skeleton alike, so the rig still fits.
3. strip_fingers: the optional fist bake, then the finger bones go (their weights merge into the hand).
4. feature_zones: eye, mouth and nostril zones from the morphs, so the paint keeps the features.
5. paint_source: garment labels, palette recolour and clean painted skin on the source UVs (the "v3" texture).
6. build_armour: the bold domes, plastron, mitten gauntlets, greaves and block boots fitted to the sculpt, plus the
   sword and shield, bound rigidly to the bones.
7. decimate_protecting_face and normals_from_source: two locked decimation passes that keep the face dense, then
   smooth normals carried over from the undecimated source.
8. repack_body_uvs and transfer_morphs: the body's own atlas UVs and the face morphs on the decimated mesh.
9. face_landmarks, ink_and_skin and relax_face_normals: the `_ink` and `_skin` attributes and the face normal fixes.
10. paint_commander: one 1,024 atlas for body and armour, and a 1,024 head texture sampled from the source at about
    3,200 texels per metre with the defects removed.
11. retarget_clips and export_commander: the source clips on the reshaped rig, and the GLB with morphs.

Image arrays are top-down (row 0 is the top of the texture, as baked), RGB floats. Where a comment calls a value sRGB
it is stored gamma encoded, the way Blender reads an 8-bit texture as Non-Color."""
import copy
import math
from types import SimpleNamespace

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

from . import armour as armour_lib
from . import geo, ink, paint, palette, scene
from .png import linear_to_srgb, srgb_to_linear, write_png

P = 'mixamorig:'
HEAD_BONES = (P + 'Head', 'jaw', P + 'HeadTop_End')
HEADNECK = HEAD_BONES + (P + 'Neck',)

DEFAULTS = {
    # Pip measured 5.3 heads at 1.53 m; 1.06 about the Head bone's head (mid-head, so the chin drops a little and the
    # crown rises) and 1.78 m overall give 5.0 heads, the commander family's height. The chin is where the source's
    # face ends; None measures it (the lowest front head vertex), a number pins a value measured once on the source.
    'reshape': {'head_factor': 1.06, 'target_height_m': 1.78, 'chin_source_z': None},
    # None strips the finger bones without a fist (the hands stay culled inside the mitten gauntlets). A dict curls
    # each finger about its rest Y axis at segments 1, 2 and 3 and bakes the fist into the basis and every key first.
    'fist': None,
    'zones': {'blink_threshold_m': 0.002, 'pucker_threshold_m': 0.0015, 'eye_margin_m': 0.006, 'mouth_margin_m': 0.004,
              'nostril_offset_m': (0.0, 0.012, -0.012), 'nostril_radius_m': 0.022},
    'garments': {'target_hex': {'hoodie': '#3c4964', 'vest': '#e8dec6', 'shorts': '#333d51', 'shoes': '#5a3f2e', 'socks': '#2b3142',
                                'hair': '#3f2b21'},
                 'contrast': {'hoodie': 0.75, 'vest': 0.85, 'shorts': 0.75, 'shoes': 0.6, 'socks': 0.5, 'hair': 0.8}},
    'skin_clean': {'guided_radius_px': 6, 'guided_eps': 0.004, 'spot_blur_px': 12, 'dark_spot': (-0.012, -0.03), 'red_blotch': (0.04, 0.09),
                   'red_cast_chroma': 0.88, 'red_cast_balance': (0.96, 1.0, 1.05)},
    'protect_features': {'eyes': (0.12, 0.3), 'mouth': (0.04, 0.12), 'nostrils': (0.15, 0.35),
                         'dark_lines': {'darker_than': 0.72, 'box_px': 3, 'density': (0.28, 0.42)}},
    'freckle_relabel': {'box_px': 4, 'dense_above': 0.55},
    'skin_composite': {'ao_strength': 0.2, 'curv_gain': 1.0, 'edge_light': 0.2, 'cavity_dark': 0.12, 'brush_strength': 0.12, 'stroke_tint_mix': 0.05},
    'hair_fix': {'dilate_px': 3, 'orange_hue_deg': (5, 40), 'min_saturation': 0.35},
    'source_bake': {'ao_samples': 32, 'ao_distance': 0.12, 'brush_scale': 0.7},
    # The pose the sword and shield are placed in (bone head-to-tail directions in world space), then carried back to
    # the rest pose through their bone's deform: the right arm down with the blade forward, the shield arm across.
    'commander_pose': {P + 'RightArm': (-0.2, 0.06, -1.0), P + 'RightForeArm': (-0.05, -0.12, -0.99),
                       P + 'LeftArm': (0.3, 0.05, -1.0), P + 'LeftForeArm': (-0.52, -0.84, -0.05)},
    'weapons': {'blade': (0.74, 0.068, 0.015), 'shield': (1.0, 0.29, 0.6)},
    'ear_piece_side': 1,
    # The face region keeps its source density where the budget allows; the rest of the body is decimated to rest_tris
    # first (v3's density), then the face only if the total still passes total_tris.
    'decimate': {'total_tris': 24000, 'rest_tris': 10000},
    'uv': {'face_island_scale': 2.0, 'atlas_size': 1024, 'head_size': 1024},
    'clips': ('idle', 'run'),
}


def _unknown_keys(value, default, path=''):
    """The dotted paths of the keys in `value` that `default` lacks, at every depth where both are dicts. An entry whose
    default is not a dict (such as 'fist', None by default) is taken whole, so only its own key is checked."""
    if not (isinstance(value, dict) and isinstance(default, dict)):
        return []
    out = []
    for key, sub in value.items():
        where = f'{path}.{key}' if path else str(key)
        if key in default:
            out.extend(_unknown_keys(sub, default[key], where))
        else:
            out.append(where)
    return out


def settings(overrides=None):
    """DEFAULTS with the recipe's overrides merged in, one level of nesting deep (a nested dict replaces keys, not the
    whole entry), so a recipe states only what differs for its character. A key DEFAULTS does not have, at the top or
    nested in a dict entry (commander_pose's bone names included), raises a ValueError naming it: an unknown key used to
    be merged in silently and never read, so a misspelt override left the build on the default it meant to change."""
    unknown = _unknown_keys(overrides or {}, DEFAULTS)
    if unknown:
        raise ValueError(f'charforge settings: unknown key(s) {", ".join(unknown)}; a recipe may override only keys DEFAULTS has')
    out = copy.deepcopy(DEFAULTS)
    for key, value in (overrides or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key].update(copy.deepcopy(value))
        else:
            out[key] = copy.deepcopy(value)
    return out


def log(*args):
    print('[charforge]', *args, flush=True)


# ---------------------------------------------------------------- image helpers

def box(a, r):
    """A (2r+1) square box blur over the first two axes by cumulative sums, edge clamped: fast enough to run dozens of
    times on 2,048 maps inside one build."""
    def along(x, axis):
        pad = [(0, 0)] * x.ndim
        pad[axis] = (r + 1, r)
        c = np.cumsum(np.pad(x, pad, mode='edge'), axis=axis)
        hi = np.take(c, np.arange(2 * r + 1, c.shape[axis]), axis=axis)
        lo = np.take(c, np.arange(0, c.shape[axis] - 2 * r - 1), axis=axis)
        return (hi - lo) / (2 * r + 1)
    return along(along(a, 0), 1)


def ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def lum(c):
    return c @ np.array([0.2126, 0.7152, 0.0722])


def hsv(rgb):
    """Hue in degrees, saturation and value of an RGB array (whatever encoding it is in: the rules below were measured
    on sRGB values)."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = mx - mn
    safe = np.where(d > 1e-6, d, 1.0)
    h = np.where(mx == r, ((g - b) / safe) % 6, np.where(mx == g, (b - r) / safe + 2, (r - g) / safe + 4)) * 60.0
    return np.where(d > 1e-6, h, 0.0), np.where(mx > 0, d / np.where(mx > 0, mx, 1), 0.0), mx


def masked_blur(a, mask, r):
    m = mask.astype(np.float64)
    return box(a * m[..., None], r) / np.maximum(box(m, r)[..., None], 1e-6)


def mblur(a, mask, radii):
    """Masked blur that falls back to wider windows where the mask is sparse. A single radius found no skin inside
    the eye, brow and nose zones of the head texture, returned 0, and showed as black nostrils, dark patches and a
    bright box round the eyes (the light gain clipped there)."""
    m = mask.astype(np.float64)
    out, got = np.zeros(a.shape), np.zeros(a.shape[:2], bool)
    for rr in radii:
        wgt = box(m, rr)
        val = box(a * m[..., None], rr) / np.maximum(wgt[..., None], 1e-6)
        ok = (wgt > 0.08) & ~got
        out[ok] = val[ok]
        got |= ok
    if (m > 0).any():
        out[~got] = np.median(a[m > 0], axis=0)
    return out


def mblur_islands(a, mask, isl, radii):
    """mblur within each UV island separately. Texels side by side in texture space can lie far apart on the surface:
    a fill drawn across an island's border borrowed darker skin from a neighbouring island and left a dark notch
    beside the nose. Texels outside every island (isl < 0) take the plain mblur."""
    out = mblur(a, mask, radii)
    for i in np.unique(isl[isl >= 0]):
        own = isl == i
        if (mask & own).any():
            out[own] = mblur(a, mask & own, radii)[own]
    return out


def front_blur(img, mask, x, z, cell=0.0005, r=10):
    """A blur in the front view instead of in texture space: the masked texels are splatted onto a grid over world x
    and z (cell metres), the grid is box blurred by r cells, and each texel reads it back. On a front-facing patch this
    blurs across UV islands and triangles alike, which a texture-space blur cannot when the patch is cut into pieces
    scattered over the texture (the nose tip)."""
    if not mask.any():
        return img.copy()
    x0, z0 = x[mask].min() - r * cell, z[mask].min() - r * cell
    gx = ((x - x0) / cell).astype(np.int64)
    gz = ((z - z0) / cell).astype(np.int64)
    shape = (int(gz[mask].max()) + r + 2, int(gx[mask].max()) + r + 2)
    acc, cnt = np.zeros(shape + (3,)), np.zeros(shape)
    np.add.at(acc, (gz[mask], gx[mask]), img[mask])
    np.add.at(cnt, (gz[mask], gx[mask]), 1.0)
    avg = box(acc, r) / np.maximum(box(cnt, r)[..., None], 1e-9)
    out = img.copy()
    out[mask] = avg[gz[mask], gx[mask]]
    return out


def front_grid(values, mask, x, z, cell, r=1):
    """The masked texels' values splatted onto a front-view grid over world x and z (cell metres), averaged and filled
    by an r-cell box: a picture of a front-facing patch that ignores how it is cut up in texture space."""
    x0, z0 = x[mask].min() - (r + 2) * cell, z[mask].min() - (r + 2) * cell
    gx = ((x[mask] - x0) / cell).astype(np.int64)
    gz = ((z[mask] - z0) / cell).astype(np.int64)
    shape = (int(gz.max()) + r + 3, int(gx.max()) + r + 3)
    acc, cnt = np.zeros(shape + values.shape[2:]), np.zeros(shape)
    np.add.at(acc, (gz, gx), values[mask])
    np.add.at(cnt, (gz, gx), 1.0)
    n = box(cnt, r)
    return box(acc, r) / np.maximum(n, 1e-9)[..., None], n > 0, x0, z0, cell


def front_sample(grid, x, z):
    """Reads a front_grid at world x and z (nearest cell); returns the values and whether the grid had data there."""
    values, valid, x0, z0, cell = grid
    gx = np.clip(((x - x0) / cell).astype(np.int64), 0, values.shape[1] - 1)
    gz = np.clip(((z - z0) / cell).astype(np.int64), 0, values.shape[0] - 1)
    inside = (x >= x0) & (z >= z0) & (x < x0 + values.shape[1] * cell) & (z < z0 + values.shape[0] * cell)
    return values[gz, gx], valid[gz, gx] & inside


def guided(p, mask, r, eps):
    """A guided filter restricted to the mask and self-guided on luminance: low-contrast marks (freckles, speckle)
    fall under eps and smooth away, while strong edges and the soft form gradients wider than the window survive."""
    i = lum(p)[..., None]
    mi = masked_blur(i, mask, r)
    var = masked_blur(i * i, mask, r) - mi * mi
    mp = masked_blur(p, mask, r)
    cov = masked_blur(p * i, mask, r) - mi * mp
    a = cov / (var + eps)
    b = mp - a * mi
    return masked_blur(a, mask, r) * i + masked_blur(b, mask, r)


def image_pixels(img):
    """An image's RGB as a top-down float array (Blender stores rows bottom-up)."""
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(h, w, 4)[::-1, :, :3].astype(np.float64)


def image_file(path, rgb):
    """Writes a top-down RGB array as an 8-bit PNG and loads it as a Non-Color image for a bake to sample. Cycles
    baked a generated float image filled through its pixels as black (it regenerates generated images), and the
    approved build sampled 8-bit files, so the intermediates go through the work folder the same way."""
    write_png(path, np.clip(rgb, 0, 1))
    img = bpy.data.images.load(str(path))
    img.colorspace_settings.name = 'Non-Color'
    return img


def sample_at_loops(me, uv_name, rgb_topdown):
    """Per-vertex mean of a top-down image sampled (nearest) at every loop's UV: the colour tests on vertices."""
    h, w = rgb_topdown.shape[:2]
    uv = np.empty(len(me.loops) * 2)
    me.uv_layers[uv_name].data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    lv = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get('vertex_index', lv)
    rows = np.clip(((1 - uv[:, 1]) * h).astype(int), 0, h - 1)
    cols = np.clip((uv[:, 0] * w).astype(int), 0, w - 1)
    acc = np.zeros((len(me.vertices), 3))
    n = np.zeros(len(me.vertices))
    np.add.at(acc, lv, rgb_topdown[rows, cols])
    np.add.at(n, lv, 1)
    return acc / np.maximum(n, 1)[:, None]


# ---------------------------------------------------------------- mesh helpers

def co_of(me):
    c = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', c)
    return c.reshape(-1, 3)


def key_co(kb, n):
    c = np.empty(n * 3)
    kb.data.foreach_get('co', c)
    return c.reshape(-1, 3)


def weight_of(ob, bones):
    """Summed weight of each vertex in the named bones' groups, clamped to 1."""
    idx = {ob.vertex_groups[n].index for n in bones if n in ob.vertex_groups}
    w = np.zeros(len(ob.data.vertices))
    for v in ob.data.vertices:
        w[v.index] = min(1.0, sum(g.weight for g in v.groups if g.group in idx))
    return w


def dominant(ob):
    """The name of each vertex's strongest bone ('' for none)."""
    names = {g.index: g.name for g in ob.vertex_groups}
    out = []
    for v in ob.data.vertices:
        best = max(v.groups, key=lambda g: g.weight, default=None)
        out.append(names[best.group] if best else '')
    return np.array(out)


def edges_of(me):
    e = np.empty(len(me.edges) * 2, np.int64)
    me.edges.foreach_get('vertices', e)
    return e[0::2], e[1::2]


def smooth_values(v, a, b, n):
    """n rounds of averaging each vertex value with its edge neighbours."""
    for _ in range(n):
        acc, cnt = v.copy(), np.ones(len(v))
        np.add.at(acc, a, v[b])
        np.add.at(acc, b, v[a])
        np.add.at(cnt, a, 1)
        np.add.at(cnt, b, 1)
        v = acc / cnt
    return v


def face_centres(me):
    st = np.empty(len(me.polygons), np.int64)
    me.polygons.foreach_get('loop_start', st)
    tot = np.empty(len(me.polygons), np.int64)
    me.polygons.foreach_get('loop_total', tot)
    lv = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get('vertex_index', lv)
    return np.add.reduceat(co_of(me)[lv], st, axis=0) / tot[:, None], st, tot, lv


def bone_head(arm, name, posed=False):
    if posed:
        return arm.matrix_world @ arm.pose.bones[name].head
    return arm.matrix_world @ arm.data.bones[name].head_local


def deform(arm, name):
    """The bone's current deform matrix in world space: what posing does to a vertex bound rigidly to it."""
    return arm.matrix_world @ arm.pose.bones[name].matrix @ arm.data.bones[name].matrix_local.inverted() @ arm.matrix_world.inverted()


def bind(ob, arm):
    ob.parent = arm
    ob.modifiers.new('armature', 'ARMATURE').object = arm


def split_copy(ob, keep):
    """A linked copy of a mesh with only the faces in `keep`, for baking one region alone."""
    c = ob.copy()
    c.data = ob.data.copy()
    scene.link(c)
    bm = bmesh.new()
    bm.from_mesh(c.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not keep[f.index]], context='FACES')
    bm.to_mesh(c.data)
    bm.free()
    return c


# ---------------------------------------------------------------- bakes

def bake_emit(objs, size, tree):
    """Bakes an emission tree into a fresh float image over the objects' active render UVs. `tree(mat, nt, colour)`
    wires a shader for each material into the emission colour socket. Every material's node tree is replaced, so a
    caller assigns the final materials afterwards. Returns the padded RGB (top-down) and the coverage mask."""
    target = bpy.data.images.new('p99_charforge_bake', size, size, alpha=True, float_buffer=True)
    target.colorspace_settings.name = 'Non-Color'
    target.pixels.foreach_set(np.zeros(size * size * 4, np.float32))
    for mat in paint._materials(objs):
        nt = mat.node_tree
        nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
        tree(mat, nt, em.inputs['Color'])
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = target
        nt.nodes.active = t
    scene.select_only(objs)
    bpy.ops.object.bake(type='EMIT', margin=0, use_clear=False)
    buf = np.empty(size * size * 4, np.float32)
    target.pixels.foreach_get(buf)
    bpy.data.images.remove(target)
    raw = buf.reshape(size, size, 4)[::-1].astype(np.float64)
    return paint._pad(raw)[..., :3], raw[..., 3] > 0.5


def image_tree(img, uv_name):
    def tree(mat, nt, colour):
        img.colorspace_settings.name = 'Non-Color'
        u = nt.nodes.new('ShaderNodeUVMap')
        u.uv_map = uv_name
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = img
        nt.links.new(u.outputs['UV'], t.inputs['Vector'])
        nt.links.new(t.outputs['Color'], colour)
    return tree


def attr_tree(name, output='Fac'):
    def tree(mat, nt, colour):
        a = nt.nodes.new('ShaderNodeAttribute')
        a.attribute_type = 'GEOMETRY'
        a.attribute_name = name
        nt.links.new(a.outputs[output], colour)
    return tree


def geo_tree(which):
    """World position (x and y mapped from [-1, 1], z minus 1) or normal ([-1, 1] to [0, 1]) as a colour."""
    def tree(mat, nt, colour):
        g = nt.nodes.new('ShaderNodeNewGeometry')
        v = nt.nodes.new('ShaderNodeVectorMath')
        v.operation = 'MULTIPLY_ADD'
        if which == 'pos':
            v.inputs[1].default_value, v.inputs[2].default_value = (0.5, 0.5, 1.0), (0.5, 0.5, -1.0)
            nt.links.new(g.outputs['Position'], v.inputs[0])
        else:
            v.inputs[1].default_value, v.inputs[2].default_value = (0.5, 0.5, 0.5), (0.5, 0.5, 0.5)
            nt.links.new(g.outputs['Normal'], v.inputs[0])
        nt.links.new(v.outputs['Vector'], colour)
    return tree


def ao_tree(samples=16, distance=0.04):
    def tree(mat, nt, colour):
        a = nt.nodes.new('ShaderNodeAmbientOcclusion')
        a.samples = samples
        a.inputs['Distance'].default_value = distance
        nt.links.new(a.outputs['AO'], colour)
    return tree


# ---------------------------------------------------------------- 1 to 4: source, shape, bones, zones

def import_source(path):
    """Imports the CharForge GLB at rest: no action playing, every pose bone and shape key zeroed. The importer also
    brings a stray unit icosphere with no parent; it is deleted. Returns the armature, the body, the source albedo
    image and the source's actions by name (kept with a fake user so they survive until export).

    A source without an armature, a skinned mesh, shape keys or an albedo image raises a ValueError naming the file and
    what it lacks; each used to surface as a bare StopIteration or AttributeError from the line that first reached for
    it, which named neither."""
    before, before_actions = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=str(path))
    new = [o for o in bpy.data.objects if o not in before]
    for o in [o for o in new if o.type == 'MESH' and o.parent is None]:
        new.remove(o)
        bpy.data.objects.remove(o)
    arm = next((o for o in new if o.type == 'ARMATURE'), None)
    body = next((o for o in new if o.type == 'MESH'), None)
    if arm is None or body is None:
        lacking = ' and '.join(what for what, ob in (('an armature', arm), ('a mesh parented to it', body)) if ob is None)
        raise ValueError(f'CharForge source {path}: has no {lacking}')
    if body.data.shape_keys is None:
        raise ValueError(f'CharForge source {path}: mesh {body.name!r} has no shape keys (the face morphs blink_L, blink_R, '
                         'smile, brows_up and pucker are required)')
    material = body.data.materials[0] if len(body.data.materials) else None
    nodes = material.node_tree.nodes if material is not None and material.node_tree is not None else []
    image = next((node.image for node in nodes if node.type == 'TEX_IMAGE' and node.image is not None), None)
    if image is None:
        raise ValueError(f'CharForge source {path}: mesh {body.name!r} has no albedo image (no image texture node on its '
                         f'first material, {material.name if material else None!r})')
    arm.animation_data_clear()
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    arm.data.pose_position = 'REST'
    for kb in body.data.shape_keys.key_blocks:
        kb.value = 0.0
    actions = {a.name: a for a in bpy.data.actions if a not in before_actions}
    for a in actions.values():
        a.use_fake_user = True
    stats = dict(tris=scene.tri_count([body]), bones=len(arm.data.bones), morphs=[kb.name for kb in body.data.shape_keys.key_blocks[1:]],
                 clips=sorted(actions), image=list(image.size) if image else None, materials=[m.name for m in body.data.materials])
    log('source', stats)
    return SimpleNamespace(arm=arm, body=body, image=image, actions=actions, stats=stats)


def measure_chin(body):
    """The source chin: the lowest vertex on the face's centre line that the jaw bone moves (weight over 0.2), or that
    the head bones move when there is no jaw bone."""
    co = co_of(body.data)
    w = weight_of(body, ('jaw',)) if 'jaw' in body.vertex_groups else weight_of(body, HEAD_BONES)
    front = (w > 0.2) & (np.abs(co[:, 0]) < 0.02) & (co[:, 1] < -0.03)
    return float(co[front][:, 2].min())


def reshape(arm, body, s):
    """Scales the vertices weighted to the head bones by head_factor about the Head bone's head, then everything to
    the target height, on the mesh, every shape key and every bone. Returns the uniform scale (the clips' root motion
    needs it) and the reshaped chin height (every face rule below is measured from it)."""
    cfg = s['reshape']
    me = body.data
    pivot = np.array(arm.data.bones[P + 'Head'].head_local)
    co = co_of(me)
    measured = measure_chin(body)
    chin0 = cfg['chin_source_z'] if cfg['chin_source_z'] is not None else measured
    f = cfg['head_factor']
    top0 = co[:, 2].max()
    scale = cfg['target_height_m'] / (pivot[2] + (top0 - pivot[2]) * f)
    k = 1 + (f - 1) * weight_of(body, HEAD_BONES)

    def tf(c):
        return scale * (pivot + (c - pivot) * k[:, None])

    for kb in me.shape_keys.key_blocks:
        kb.data.foreach_set('co', tf(key_co(kb, len(me.vertices))).ravel())
    me.vertices.foreach_set('co', tf(co).ravel())
    me.update()
    scene.select_only([arm])
    bpy.ops.object.mode_set(mode='EDIT')
    # Every bone's ends are read before any is written: moving a connected child's head also moves its parent's tail,
    # which would then be transformed twice.
    ends = {eb.name: (np.array(eb.head), np.array(eb.tail)) for eb in arm.data.edit_bones}
    for eb in arm.data.edit_bones:
        kk = f if eb.name in HEAD_BONES else 1.0
        h, t = ends[eb.name]
        eb.head = scale * (pivot + (h - pivot) * kk)
        eb.tail = scale * (pivot + (t - pivot) * kk)
    bpy.ops.object.mode_set(mode='OBJECT')
    chin = float(scale * (pivot[2] + (chin0 - pivot[2]) * f))
    log('reshape: scale', round(float(scale), 4), 'chin', round(chin, 4), 'source chin used', round(chin0, 4), 'measured', round(measured, 4))
    return SimpleNamespace(scale=float(scale), chin=chin, source_chin=float(chin0), measured_chin=measured)


FINGERS = ('Index', 'Middle', 'Ring', 'Pinky', 'Thumb')


def strip_fingers(arm, body, s):
    """Deletes the 40 finger bones for the 32-bone commander budget, their weights added into the hand's group (the
    wrist keeps its blend). With s['fist'] set, the fingers are first curled about each segment's rest Y axis and the
    evaluated fist is baked into the basis and every shape key, so a hand left visible holds a closed grip."""
    me = body.data
    fist = s.get('fist')
    if fist:
        arm.data.pose_position = 'POSE'
        for pb in arm.pose.bones:
            pb.matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()
        for side, sgn in (('Left', 1), ('Right', -1)):
            for finger in FINGERS:
                angles = fist['thumb_curl_deg'] if finger == 'Thumb' else fist['finger_curl_deg']
                for seg in ('1', '2', '3'):
                    pb = arm.pose.bones.get(f'{P}{side}Hand{finger}{seg}')
                    if pb is None:
                        continue
                    h = pb.head.copy()
                    pb.matrix = Matrix.Translation(h) @ Matrix.Rotation(math.radians(sgn * angles[seg]), 4, 'Y') @ Matrix.Translation(-h) @ pb.matrix
                    bpy.context.view_layer.update()
        old = co_of(me)
        ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
        tm = ev.to_mesh()
        new = co_of(tm)
        ev.to_mesh_clear()
        delta = new - old
        for kb in me.shape_keys.key_blocks:
            kb.data.foreach_set('co', (key_co(kb, len(me.vertices)) + delta).ravel())
        me.vertices.foreach_set('co', (old + delta).ravel())
        me.update()
        for pb in arm.pose.bones:
            pb.matrix_basis = Matrix.Identity(4)
        arm.data.pose_position = 'REST'
    names = {g.index: g.name for g in body.vertex_groups}
    add = {'Left': {}, 'Right': {}}
    for v in me.vertices:
        for g in v.groups:
            n = names[g.group]
            for side in add:
                if n.startswith(f'{P}{side}Hand') and any(f in n for f in FINGERS):
                    add[side][v.index] = add[side].get(v.index, 0.0) + g.weight
    for side, weights in add.items():
        hand = body.vertex_groups[f'{P}{side}Hand']
        for i, w in weights.items():
            hand.add([i], w, 'ADD')
    for g in list(body.vertex_groups):
        if any(f'Hand{f}' in g.name for f in FINGERS):
            body.vertex_groups.remove(g)
    scene.select_only([arm])
    bpy.ops.object.mode_set(mode='EDIT')
    gone = [eb for eb in arm.data.edit_bones if any(f'Hand{f}' in eb.name for f in FINGERS)]
    for eb in gone:
        arm.data.edit_bones.remove(eb)
    bpy.ops.object.mode_set(mode='OBJECT')
    log('fingers: bones removed', len(gone), 'left', len(arm.data.bones))
    return len(gone)


def feature_zones(body, s):
    """Eye, mouth and nostril zones from the face morphs, stored as the vertex colour p99_zones (R eyes, G mouth,
    B nostrils) for the zone bakes. The eyes are what blink_* moves, the mouth what pucker moves, and the nose tip the
    most forward vertex between them, so this works on any character with the same five morphs."""
    z = s['zones']
    me = body.data
    n = len(me.vertices)
    kbs = me.shape_keys.key_blocks
    base = key_co(kbs[0], n)
    blink = np.maximum(np.linalg.norm(key_co(kbs['blink_L'], n) - base, axis=1), np.linalg.norm(key_co(kbs['blink_R'], n) - base, axis=1))

    def ellip(c, r):
        return ss(1.0, 0.5, np.linalg.norm(base - c, axis=1) / r)

    ze = np.zeros(n)
    for side in (1, -1):
        m = (blink > z['blink_threshold_m']) & (base[:, 0] * side > 0)
        c = base[m].mean(0)
        ze = np.maximum(ze, ellip(c, np.linalg.norm(base[m] - c, axis=1).max() + z['eye_margin_m']))
    pk = np.linalg.norm(key_co(kbs['pucker'], n) - base, axis=1) > z['pucker_threshold_m']
    mc = base[pk].mean(0)
    zm = ellip(mc, np.percentile(np.linalg.norm(base[pk] - mc, axis=1), 90) + z['mouth_margin_m'])
    ez = base[blink > z['blink_threshold_m']][:, 2].mean()
    sel = (np.abs(base[:, 0]) < 0.02) & (base[:, 2] > mc[2]) & (base[:, 2] < ez) & (base[:, 1] < 0)
    tip = base[sel][np.argmin(base[sel][:, 1])]
    zn = ellip(tip + np.array(z['nostril_offset_m']), z['nostril_radius_m'])
    attr = me.color_attributes.get('p99_zones') or me.color_attributes.new('p99_zones', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', np.stack([ze, zm, zn, np.ones(n)], 1).astype(np.float32).ravel())


# ---------------------------------------------------------------- 5: the source paint ("v3")

REGION_RGB = np.array([[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [0.5, 0.5, 0.5], [1, 0.5, 0], [0.2, 0.2, 0.2],
                       [0.5, 0, 1]], float)
FACE_REGION = 9
SKIN, HAIR, HOODIE, VEST, SHORTS, SHOES, SOCKS, KEEP = range(8)
GARMENT = {'hair': HAIR, 'hoodie': HOODIE, 'vest': VEST, 'shorts': SHORTS, 'shoes': SHOES, 'socks': SOCKS}


def region_of(bone):
    """The body region a bone paints: 0 head, 1 neck, 2 torso, 3 arms, 4 hands, 5 hips and thighs, 6 shins, 7 feet."""
    b = bone.replace(P, '')
    if b in ('Head', 'jaw', 'HeadTop_End'):
        return 0
    if b == 'Neck':
        return 1
    if 'Hand' in b:
        return 4
    if b in ('LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'):
        return 7
    if b in ('LeftLeg', 'RightLeg'):
        return 6
    if 'UpLeg' in b or b == 'Hips':
        return 5
    if 'Arm' in b:
        return 3
    if 'Spine' in b or 'Shoulder' in b:
        return 2
    return 8


def classify(alb_srgb, reg):
    """Labels every texel from its body region and sRGB hue, saturation and value. The rules were measured on Pip
    (courier: orange hair, blue hoodie, yellow vest, olive shorts, red sneakers, striped socks)."""
    h, s, v = hsv(alb_srgb)
    blue = (h >= 180) & (h <= 300) & (s > 0.15)
    hairc = (s > 0.58) & (h >= 12) & (h <= 40)
    skinc = (h >= 3) & (h <= 32) & (s > 0.15) & (s <= 0.58) & (v > 0.45)
    yellow = (h > 35) & (h <= 70) & (s > 0.35)
    orange = (h >= 12) & (h <= 35) & (s > 0.55)
    low = s < 0.2
    lab = np.full(h.shape, KEEP, np.int8)
    # Off the face, the reddest strands (hue under 12 degrees) are hair too: left alone they stayed orange in the brown.
    red_hair = (s > 0.62) & ((h < 12) | (h > 345)) & (v < 0.9)
    lab = np.where(reg == 0, np.where(hairc | red_hair, HAIR, SKIN), lab)
    # On the face itself only dark, saturated texels (brows, lashes) are hair: the saturated orange cheek shadows
    # were read as hair at first and painted dark brown.
    lab = np.where(reg == FACE_REGION, np.where((s > 0.6) & (v < 0.5) & (h >= 5) & (h <= 40), HAIR, SKIN), lab)
    lab = np.where(reg == 1, np.where(blue, HOODIE, np.where(hairc, HAIR, SKIN)), lab)
    upper = np.where(blue | low, HOODIE, np.where(skinc, SKIN, np.where(yellow | orange, VEST, HOODIE)))
    lab = np.where((reg == 2) | (reg == 3), upper, lab)
    lab = np.where(reg == 4, np.where(blue, HOODIE, SKIN), lab)
    thigh = np.where(blue, HOODIE, np.where(yellow & (s > 0.55) & (v > 0.6), VEST, np.where(skinc & (v > 0.65), SKIN, SHORTS)))
    lab = np.where(reg == 5, thigh, lab)
    sockish = low | ((h >= 180) & (h <= 330))
    lab = np.where(reg == 6, np.where(sockish, SOCKS, np.where((h > 30) & (h <= 75), SHORTS, np.where(skinc, SKIN, SOCKS))), lab)
    lab = np.where(reg == 7, np.where(sockish, SOCKS, SHOES), lab)
    # a 3x3 majority vote cleans single-texel speckle along garment borders
    votes = np.stack([box((lab == i).astype(np.float32), 1) for i in range(8)], -1)
    return votes.argmax(-1).astype(np.int8)


def paint_source(body, src_img, chin, s, brush_path):
    """The source paint on the source's own UVs, at the source size: bone-region and zone maps plus our paint passes
    are baked on a copy at rest, every texel is labelled, garments take the palette with their fold shading, and the
    skin gets the light clean-up (guided filter, spot and blotch removal, a cooler cast) with the features protected
    exactly. Returns the labels, the result as sRGB (top-down) and its coverage."""
    ob = body.copy()
    ob.data = body.data.copy()
    scene.link(ob)
    ob.shape_key_clear()
    for m in list(ob.modifiers):
        ob.modifiers.remove(m)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    # The mouth interior has its own flat material and UVs that may overlap the atlas, so it stays out of the bake.
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == 1], context='FACES')
    bm.to_mesh(ob.data)
    bm.free()
    dom = dominant(ob)
    regs = []
    for i, rgb in enumerate(REGION_RGB):
        m = bpy.data.materials.new(f'p99_cf_region_{i}')
        m['p99_base'] = list(map(float, rgb))
        m['p99_emit'] = [0.0, 0.0, 0.0]
        regs.append(m)
    ob.data.materials.clear()
    for m in regs:
        ob.data.materials.append(m)
    cen, st, _tot, lv = face_centres(ob.data)
    face_reg = np.array([region_of(b) for b in dom[lv[st]]], np.int64)
    front = (face_reg == 0) & (np.abs(cen[:, 0]) < 0.1) & (cen[:, 1] < -0.02) & (cen[:, 2] > chin - 0.02) & (cen[:, 2] < chin + 0.2)
    face_reg[front] = FACE_REGION
    ob.data.polygons.foreach_set('material_index', face_reg)
    paint.write_height_attribute([ob])
    brush = bpy.data.images.load(str(brush_path), check_existing=True)
    brush.colorspace_settings.name = 'Non-Color'
    sb = s['source_bake']
    params = {'ao_samples': sb['ao_samples'], 'ao_distance': sb['ao_distance'], 'brush_scale': sb['brush_scale'], 'brush_image': brush}
    size = src_img.size[0]
    baked = {p: paint._bake([ob], p, size, params) for p in ('region', 'ao', 'curv', 'height', 'brush')}
    zones, cover = bake_emit([ob], size, attr_tree('p99_zones', 'Color'))
    bpy.data.objects.remove(ob)
    for m in regs:
        bpy.data.materials.remove(m)
    alb = image_pixels(src_img)
    rb = baked['region'][..., :3].astype(np.float32)
    best = np.full(rb.shape[:2], np.inf, np.float32)
    reg = np.zeros(rb.shape[:2], np.int64)
    for i, rgb in enumerate(REGION_RGB.astype(np.float32)):
        dist = ((rb - rgb) ** 2).sum(-1)
        closer = dist < best
        best[closer] = dist[closer]
        reg[closer] = i
    lab = classify(alb, reg)
    # Two relabels that change no feature: orange texels next to hair on the head are hair (the orange edges), and
    # face "hair" that is not a dense region (freckles that would paint dark brown) is skin. Dense face hair (brows)
    # keeps its reading.
    hf, fr = s['hair_fix'], s['freckle_relabel']
    hh, sv, _ = hsv(alb)
    near_hair = box((lab == HAIR).astype(np.float64), hf['dilate_px']) > 0.0
    orangeish = (hh >= hf['orange_hue_deg'][0]) & (hh <= hf['orange_hue_deg'][1]) & (sv > hf['min_saturation'])
    lab = np.where((reg == 0) & (lab == SKIN) & near_hair & orangeish, HAIR, lab).astype(np.int8)
    # Saturated orange strands on the face that touch hair are hair too (one was left above the left brow), never
    # inside the eye, mouth or nostril zones.
    outside = (zones[..., 0] < 0.3) & (zones[..., 1] < 0.3) & (zones[..., 2] < 0.3)
    strong = (hh >= 12) & (hh <= 40) & (sv > 0.55)
    lab = np.where((reg == FACE_REGION) & (lab == SKIN) & near_hair & strong & outside, HAIR, lab).astype(np.int8)
    # The thin orange band along the hairline was wider than one dilation, so hair grows through saturated orange a
    # few steps (up to about 12 texels at 2,048), never into the zones and never through the paler forehead skin
    # (saturation 0.5 is above it).
    growable = (hh >= 5) & (hh <= 38) & (sv > 0.5) & ((reg == 0) | ((reg == FACE_REGION) & outside))
    for _ in range(4):
        near = box((lab == HAIR).astype(np.float64), 3) > 0.0
        lab = np.where(growable & near & (lab == SKIN), HAIR, lab).astype(np.int8)
    face_hair = (reg == FACE_REGION) & (lab == HAIR)
    dense = box(face_hair.astype(np.float64), fr['box_px']) > fr['dense_above']
    lab = np.where(face_hair & ~dense, SKIN, lab).astype(np.int8)
    alin = srgb_to_linear(alb)
    lumb = lum(box(alin, 2))
    out = alin.copy()
    g = s['garments']
    for gname, gid in GARMENT.items():
        m = lab == gid
        if not m.any():
            continue
        ratio = lumb / max(float(np.median(lumb[m])), 1e-4)
        shade = np.clip(1 + g['contrast'][gname] * (ratio - 1), 0.35, 1.6)
        out[m] = np.array(palette.hex_to_linear(g['target_hex'][gname]))[None] * shade[m][:, None]
    # Skin keeps the painted features: strong local contrast (eyes, brows, lip lines) passes, fine noise does not.
    sm = lab == SKIN
    bl = box(alin, 5)
    d = alin - bl
    keep = ss(0.02, 0.07, np.abs(lum(d)))
    out[sm] = (bl + d * keep[..., None])[sm]
    ao, curv, height, br = (baked[p][..., 0] for p in ('ao', 'curv', 'height', 'brush'))
    zero = np.zeros_like(out)
    garment = palette.PaintStyle(shadow_tint=(0.40, 0.58, 0.72), ao_strength=0.45, curv_gain=3.0, edge_light=0.5, edge_tint=(1.0, 0.86, 0.66),
                                 cavity_dark=0.45, brush_strength=0.7, stroke_tint_mix=0.25)
    skin = palette.PaintStyle(shadow_tint=(0.78, 0.52, 0.52), ao_strength=0.3, curv_gain=2.0, edge_light=0.3, edge_tint=(1.0, 0.9, 0.8),
                              cavity_dark=0.25, brush_strength=0.25, stroke_tint_mix=0.08)
    a_g, _ = paint.composite(out, ao, curv, height, br, zero, garment)
    a_s, _ = paint.composite(out, ao, curv, height, br, zero, skin)
    final = np.where(sm[..., None], a_s, a_g)
    final = np.where((lab == KEEP)[..., None], alin, final)
    # The light-touch skin clean-up over that skin, the features untouched.
    sc, pf = s['skin_clean'], s['protect_features']
    q = guided(out, sm, sc['guided_radius_px'], sc['guided_eps'])
    bg = masked_blur(q, sm, sc['spot_blur_px'])
    spot = ss(sc['dark_spot'][0], sc['dark_spot'][1], lum(q) - lum(bg))
    red = q[..., 0] / (q[..., 1] + 1e-3)
    red_bg = masked_blur(red[..., None], sm, sc['spot_blur_px'])[..., 0]
    blotch = ss(sc['red_blotch'][0], sc['red_blotch'][1], red - red_bg)
    q = q + (bg - q) * np.maximum(spot, blotch)[..., None]
    lq = lum(q)[..., None]
    q = lq + (q - lq) * sc['red_cast_chroma']
    q = q * np.array(sc['red_cast_balance'])
    q = q * (lq / np.maximum(lum(q)[..., None], 1e-6))
    kc = s['skin_composite']
    light = palette.PaintStyle(shadow_tint=(0.78, 0.52, 0.52), ao_strength=kc['ao_strength'], curv_gain=kc['curv_gain'], edge_light=kc['edge_light'],
                               edge_tint=(1.0, 0.9, 0.8), cavity_dark=kc['cavity_dark'], brush_strength=kc['brush_strength'],
                               stroke_tint_mix=kc['stroke_tint_mix'])
    a_c, _ = paint.composite(q, ao, curv, height, br, zero, light)
    est = masked_blur(alin, sm, 10)
    dd = np.linalg.norm(alin - est, axis=-1) / (lum(est) + 0.05)
    feat = np.maximum.reduce([zones[..., 0] * ss(*pf['eyes'], dd), zones[..., 1] * ss(*pf['mouth'], dd), zones[..., 2] * ss(*pf['nostrils'], dd)])
    dl = pf['dark_lines']
    dark = ((lum(alin) < dl['darker_than'] * lum(est)) & (reg == FACE_REGION)).astype(np.float64)
    feat = np.maximum(feat, dark * ss(dl['density'][0], dl['density'][1], box(dark, dl['box_px'])))
    res = np.where(sm[..., None], a_c + (final - a_c) * feat[..., None], final)
    res = paint._pad(np.concatenate([res, cover[..., None].astype(np.float64)], -1))[..., :3]
    counts = {n: int((lab == i).sum()) for i, n in enumerate(('skin', 'hair', 'hoodie', 'vest', 'shorts', 'shoes', 'socks', 'keep'))}
    log('source paint: labels', counts, 'protected feature texels', int((feat > 0.5).sum()))
    return SimpleNamespace(labels=lab, image=linear_to_srgb(np.clip(res, 0, 1)), cover=cover, counts=counts)


# ---------------------------------------------------------------- 6: armour, fitted in the rest pose

def armour_regions():
    """The armour's paint regions: the Bulwark's plate colours, rims and painted caps, plus leather, blade and the
    player's glow."""
    c = armour_lib.COLOURS
    r = {
        'plate': palette.region('cf_plate', c['plate']),
        'plate_dark': palette.region('cf_plate_dark', c['plate_dark']),
        'plate_light': palette.region('cf_plate_light', c['plate_light']),
        'enamel': palette.region('cf_enamel', c['enamel']),
        'leather': palette.region('cf_leather', palette.PLAYER['leather']),
        'blade': palette.region('cf_blade', c['blade']),
        'glow': palette.region('cf_glow', palette.PLAYER['gunmetal'], emit_hex=palette.PLAYER['energy']),
    }
    rim = paint.add_cap(palette.region('cf_rim', c['rim']), armour_lib.CAPS['rim'], **armour_lib.CAP)
    rim_enamel = palette.region('cf_rim_enamel', c['rim_enamel'])
    for key in ('plate', 'plate_dark', 'plate_light', 'enamel'):
        r[key][armour_lib.RIM_KEY] = (rim_enamel if key == 'enamel' else rim).name
        paint.add_cap(r[key], armour_lib.CAPS[key], **armour_lib.CAP)
    return r


class Kit:
    """Armour parts collected before assembly, each shaded, inked and given its paint cap factor on the way in."""

    def __init__(self, tag):
        self.tag = tag
        self.parts = []
        self.bones = []
        self.n = 0

    def name(self, base):
        self.n += 1
        return f'{self.tag}_{base}_{self.n}'

    def add(self, ob, bone, width=1.0, kind='round', group='body'):
        if kind == 'round':
            geo.shade_smooth(ob, 180.0)
        elif kind == 'flat':
            geo.shade_flat(ob)
        else:
            geo.shade_smooth(ob, armour_lib.PLATE_DEG)
        ink.set_ink(ob, width)
        scene.apply_transforms(ob)
        geo.cap_factor(ob)
        self.parts.append((ob, group))
        self.bones.append(bone)
        return ob


def align(ob, a, b):
    """Turns local +z onto the direction a to b and centres the part between them."""
    a, b = Vector(a), Vector(b)
    ob.rotation_euler = Vector((0, 0, 1)).rotation_difference(b - a).to_euler()
    ob.location = (a + b) / 2
    return ob


def frame(d, hint):
    """A rotation taking local -y onto d, with local +x as close to `hint` as it can be."""
    d = Vector(d).normalized()
    y = -d
    hint = Vector(hint)
    x = (hint - hint.dot(y) * y).normalized()
    z = x.cross(y)
    return Matrix((x, y, z)).transposed().to_4x4()


def xform(obs, m):
    bpy.context.view_layer.update()
    for ob in obs:
        ob.matrix_world = m @ ob.matrix_world
    bpy.context.view_layer.update()


def bvh_of(ob):
    me = ob.data
    return BVHTree.FromPolygons([v.co.copy() for v in me.vertices], [tuple(p.vertices) for p in me.polygons])


def stroke(points, widths):
    """Three rows (right edge, centre, left edge) along a 2D polyline: a flat ribbon of the given half widths."""
    n = len(points)
    left, mid, right = [], [], []
    for i, (p, w) in enumerate(zip(points, widths)):
        a, b = points[max(i - 1, 0)], points[min(i + 1, n - 1)]
        tx, tz = b[0] - a[0], b[1] - a[1]
        length = math.hypot(tx, tz) or 1.0
        nx, nz = -tz / length, tx / length
        left.append((p[0] + nx * w, p[1] + nz * w))
        mid.append(p)
        right.append((p[0] - nx * w, p[1] - nz * w))
    return [right, mid, left]


def decal(kit, base, rows2d, mat, bvh, off, centre, bone):
    """A ribbon projected onto a surface along +y (front to back) and lifted `off` along its normal: the glowing
    channels on the plastron."""
    rows = []
    for row in rows2d:
        out = []
        for x, z in row:
            loc, nor, _, _ = bvh.ray_cast(Vector((x, -3.0, z)), Vector((0, 1, 0)))
            if loc is None:
                raise ValueError(f'{base}: ray missed at x {x:.3f} z {z:.3f}')
            out.append(loc + nor * off)
        rows.append(out)
    ob = armour_lib.rows_mesh(kit.name(base), rows, False, mat)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    for f in bm.faces:
        if f.normal.dot(f.calc_center_median() - Vector(centre)) < 0:
            f.normal_flip()
    bm.to_mesh(ob.data)
    bm.free()
    return kit.add(ob, bone, 0.0, 'round')


class Fit:
    """The rest-pose body as points by dominant bone and texel label, for fitting armour to the sculpt."""

    def __init__(self, body, labels):
        me = body.data
        self.co = co_of(me)
        self.dom = dominant(body)
        uv = np.empty(len(me.loops) * 2)
        me.uv_layers.active.data.foreach_get('uv', uv)
        uv = uv.reshape(-1, 2)
        lv = np.empty(len(me.loops), np.int64)
        me.loops.foreach_get('vertex_index', lv)
        vuv = np.zeros((len(me.vertices), 2))
        vuv[lv] = uv
        n = labels.shape[0]
        self.lab = labels[np.clip(((1 - vuv[:, 1]) * n).astype(int), 0, n - 1), np.clip((vuv[:, 0] * n).astype(int), 0, n - 1)]

    def pts(self, *bones, label=None):
        m = np.isin(self.dom, bones)
        if label is not None:
            m &= np.isin(self.lab, label)
        return self.co[m]


def build_armour(arm, body, labels, chin, regions, s):
    """The armour the owner preferred (the "v1" look): bold enamel shoulder domes over a slate lame, a lofted slate
    plastron in the vest's opening with two glowing channels, mitten gauntlets with flared cuffs, greaves with enamel
    shin plates and knee cops, and block boots with soles, toe caps and cuffs; one ear-piece with a cyan light and a
    mic on the bare head. Each part is fitted to the sculpt's points in the rest (T) pose and bound to one bone. The
    sword and shield follow (weapons). Returns the assembled, rigidly bound armour object."""
    r = regions
    fit = Fit(body, labels)
    k = Kit('cf')
    # one ear-piece with a cyan light: the most a bare head carries
    side = s['ear_piece_side']
    skin = fit.pts(*HEAD_BONES, label=[SKIN])
    sx = skin[:, 0] * side
    ear = Vector(np.median(skin[sx > np.percentile(sx, 98.5)], axis=0))
    k.add(armour_lib.volume(k.name('earcup'), (0.03, 0.05, 0.056), 0.5, 0.6, 12, 8, material=r['enamel'], location=ear + Vector((side * 0.022, 0.005, 0))),
          P + 'Head', 0.9)
    k.add(armour_lib.volume(k.name('earglow'), (0.005, 0.03, 0.034), 0.5, 0.6, 10, 6, material=r['glow'], location=ear + Vector((side * 0.052, 0.005, 0))),
          P + 'Head', 0.0)
    k.add(armour_lib.volume(k.name('mic'), (0.009, 0.06, 0.009), 0.5, 0.5, 8, 6, material=r['plate_dark'], location=ear + Vector((side * 0.035, -0.06, -0.035)),
                   rotation=(0.5, 0, -side * 0.35)), P + 'Head', 0.6)
    # shoulder domes over the shoulder tops
    for sgn, sname in ((1, 'Left'), (-1, 'Right')):
        j = bone_head(arm, f'{P}{sname}Arm')
        # Only shoulder, chest and arm vertices: a probe that also took the hair and hood lifted the domes to the
        # height of a helmet.
        sh = fit.pts(f'{P}{sname}Shoulder', P + 'Spine2', f'{P}{sname}Arm')
        near = sh[(np.abs(sh[:, 0] - j.x) < 0.035) & (np.abs(sh[:, 1] - j.y) < 0.06) & (sh[:, 2] < j.z + 0.15)]
        ztop = float(near[:, 2].max())
        loc = (sgn * (abs(j.x) + 0.012), j.y, ztop - 0.035)
        k.add(armour_lib.plate(k.name('dome'), (0.13, 0.125, 0.105), (-180, 180), (-6, 90), 0.02, 0.75, 0.85, 14, 5, material=r['enamel'],
                      location=loc, rotation=(0, sgn * 0.38, 0)), f'{P}{sname}Shoulder', 1.2, 'plate')
        k.add(armour_lib.plate(k.name('lame'), (0.14, 0.134, 0.113), armour_lib.mirror_lon((-115, 115), sgn), (-30, 2), 0.018, 0.75, 0.85, 10, 2, material=r['plate'],
                      location=(loc[0] + sgn * 0.01, loc[1], loc[2] - 0.015), rotation=(0, sgn * 0.5, 0)), f'{P}{sname}Shoulder', 1.0, 'plate')
    # the slate plastron in the vest's opening, lofted through the sampled chest surface
    torso = fit.pts(P + 'Spine1', P + 'Spine2', P + 'Spine')
    zs = np.linspace(1.08, 1.4, 6)
    rows = []
    for z in zs:
        t = (z - zs[0]) / (zs[-1] - zs[0])
        half = 0.07 + 0.045 * t
        row = []
        for x in np.linspace(-half, half, 7):
            near = torso[(np.abs(torso[:, 2] - z) < 0.02) & (np.abs(torso[:, 0] - x) < 0.02)]
            y = float(near[:, 1].min()) - 0.01 if len(near) else -0.12
            row.append(Vector((float(x), y, float(z))))
        rows.append(row)
    for j in range(len(rows[0])):  # soften the sampled bumps down each column
        ys = [rows[i][j].y for i in range(len(rows))]
        for i in range(1, len(rows) - 1):
            rows[i][j].y = (ys[i - 1] + 2 * ys[i] + ys[i + 1]) / 4
    plast = armour_lib.solid(armour_lib.rows_mesh(k.name('plastron'), rows, False, r['plate']), 0.018)
    k.add(plast, P + 'Spine2', 1.0, 'plate')
    pb = bvh_of(plast)
    for sgn in (-1, 1):
        pts = [(sgn * (0.02 + 0.012 * i), 1.14 + 0.04 * i) for i in range(6)]
        decal(k, 'channel', stroke(pts, [0.008] * 6), r['glow'], pb, 0.003, Vector((0, 0.1, 1.25)), P + 'Spine2')
    # gauntlets: a mitten shell over the whole hand and a flared cuff at the wrist
    mitten_c = {}
    for sgn, sname in ((1, 'Left'), (-1, 'Right')):
        hand = fit.pts(*[bn for bn in set(fit.dom) if bn.startswith(f'{P}{sname}Hand')])
        lo, hi = hand.min(0), hand.max(0)
        c = Vector(((lo + hi) / 2).tolist())
        half = (hi - lo) / 2
        mitten_c[sname] = c
        k.add(armour_lib.volume(k.name('mitten'), (half[0] * 1.02 + 0.012, half[1] * 1.05 + 0.014, half[2] * 1.35 + 0.02), 0.55, 0.6, 12, 8,
                       material=r['plate_dark'], location=c), f'{P}{sname}Hand', 1.0)
        wrist = bone_head(arm, f'{P}{sname}Hand')
        fore = fit.pts(f'{P}{sname}ForeArm')
        near = fore[np.abs(fore[:, 0] - wrist.x) < 0.05]
        rad = float(np.sqrt((near[:, 1] - wrist.y) ** 2 + (near[:, 2] - wrist.z) ** 2).max()) if len(near) else 0.06
        cuff = armour_lib.loft(k.name('cuff'), [(-0.05, rad * 1.02 + 0.006, rad * 1.02 + 0.006), (0.0, rad * 1.1 + 0.008, rad * 1.1 + 0.008),
                                       (0.05, rad * 1.25 + 0.01, rad * 1.25 + 0.01)], (-180, 180), 0.016, 1.0, 12, r['plate_light'])
        align(cuff, wrist + Vector((sgn * 0.01, 0, 0)), wrist - Vector((sgn * 0.1, 0, 0)))
        k.add(cuff, f'{P}{sname}ForeArm', 1.0, 'plate')
    # greaves over the shins, knee cops, boot shells over the sneakers
    for sgn, sname in ((1, 'Left'), (-1, 'Right')):
        knee, ankle = bone_head(arm, f'{P}{sname}Leg'), bone_head(arm, f'{P}{sname}Foot')
        shin = fit.pts(f'{P}{sname}Leg')
        axis = (ankle - knee).normalized()
        rel = shin - np.array(knee)
        t = rel @ np.array(axis)
        radial = np.linalg.norm(rel - np.outer(t, axis), axis=1)
        length = (ankle - knee).length
        r_top = float(np.percentile(radial[(t > 0.1 * length) & (t < 0.4 * length)], 97))
        r_bot = float(np.percentile(radial[(t > 0.6 * length) & (t < 0.9 * length)], 97))
        k.add(armour_lib.limb(k.name('greave'), knee + axis * 0.05, ankle - axis * 0.02, r_top * 1.08 + 0.012, r_bot * 1.1 + 0.012, e_v=0.35, nu=12, nv=6,
                     material=r['plate']), f'{P}{sname}Leg', 1.0)
        mid = knee.lerp(ankle, 0.45)
        front = float((shin[:, 1][np.abs(shin[:, 2] - mid.z) < 0.03]).min())
        k.add(armour_lib.volume(k.name('shinplate'), (0.045, 0.025, 0.12), 0.6, 0.7, 10, 6, material=r['enamel'], location=(mid.x, front - 0.018, mid.z)),
              f'{P}{sname}Leg', 0.8)
        at_knee = np.abs(shin[:, 2] - knee.z) < 0.04
        kfront = float(shin[:, 1][at_knee].min()) if at_knee.any() else knee.y - 0.07
        k.add(armour_lib.plate(k.name('knee'), (0.07, 0.066, 0.06), (-180, 180), (20, 90), 0.016, 0.9, 0.9, 10, 3, material=r['plate_light'],
                      location=(knee.x, kfront + 0.03, knee.z - 0.02), rotation=(math.pi / 2, 0, 0)), f'{P}{sname}Leg', 0.9, 'plate')
        foot = fit.pts(f'{P}{sname}Foot', f'{P}{sname}ToeBase')
        lo, hi = foot.min(0), foot.max(0)
        c = (lo + hi) / 2
        half = (hi - lo) / 2
        bw, bl, bh = half[0] * 1.08 + 0.014, half[1] * 1.05 + 0.014, half[2] * 1.02 + 0.012
        base = bh * 0.9
        # The boot and sole are flattened at the ground (z 0), which is the ground contract's lowest point.
        k.add(armour_lib.volume(k.name('boot'), (bw, bl, bh), 0.45, 0.65, 14, 8, deform=lambda p, lv=base: Vector((p.x, p.y, max(p.z, -lv))),
                       material=r['plate'], location=(c[0], c[1], base)), f'{P}{sname}Foot', 1.0)
        k.add(armour_lib.volume(k.name('sole'), (bw * 1.04, bl * 1.03, 0.03), 0.4, 0.6, 14, 4, deform=lambda p: Vector((p.x, p.y, max(p.z, -0.026))),
                       material=r['plate_dark'], location=(c[0], c[1], 0.026)), f'{P}{sname}Foot', 0.9)
        k.add(armour_lib.volume(k.name('toe'), (bw * 0.86, bl * 0.4, bh * 0.66), 0.55, 0.6, 10, 6, material=r['plate_light'],
                       location=(c[0], c[1] - bl * 0.62, bh * 0.66)), f'{P}{sname}Foot', 0.8)
        cuff = armour_lib.loft(k.name('bootcuff'), [(-0.03, r_bot * 1.12 + 0.012, r_bot * 1.12 + 0.012), (0.0, r_bot * 1.2 + 0.014, r_bot * 1.2 + 0.014),
                                           (0.03, r_bot * 1.3 + 0.016, r_bot * 1.3 + 0.016)], (-180, 180), 0.016, 0.9, 12, r['plate_light'])
        cuff.location = (ankle.x, ankle.y, bh * 2.0 + 0.02)
        k.add(cuff, f'{P}{sname}Foot', 0.9, 'plate')
    weapons(k, arm, r, fit, mitten_c, s)
    return assemble(k, 'cf_armour')


def aim_pose(arm, directions):
    """Poses bones so each one's head-to-tail points along a world direction, by the smallest rotation, parents
    first. A recipe's poses are easier to author and check this way than as Euler angles on the Mixamo bones, whose
    local axes differ bone to bone."""
    arm.data.pose_position = 'POSE'
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    for name, d in directions.items():
        pb = arm.pose.bones[name]
        h, t = pb.head.copy(), pb.tail.copy()
        rot = (t - h).rotation_difference(Vector(d)).to_matrix().to_4x4()
        pb.matrix = Matrix.Translation(h) @ rot @ Matrix.Translation(-h) @ pb.matrix
        bpy.context.view_layer.update()


def weapons(kit, arm, r, fit, mitten_c, s):
    """The sword in the right mitten and the shield on the left forearm, placed in the commander pose and carried
    back to the rest pose through their bone's deform, so any pose (a clip, the guard) puts them back in the hand."""
    aim_pose(arm, s['commander_pose'])
    blade_l, blade_w, blade_t = s['weapons']['blade']
    shield_h, shield_hw, shield_r = s['weapons']['shield']
    fist = deform(arm, P + 'RightHand') @ mitten_c['Right']
    n0 = len(kit.parts)
    # the sword: grip, pommel, a curved guard with a glowing gem, the blade with two glowing fullers
    d = Vector((-0.04, -0.72, -0.69)).normalized()
    parts = [
        armour_lib.limb(kit.name('grip'), (0, 0.08, 0), (0, -0.09, 0), 0.024, 0.024, e_v=0.3, nu=10, nv=6, material=r['leather']),
        armour_lib.volume(kit.name('pommel'), (0.042, 0.042, 0.042), 0.7, 0.7, 12, 8, material=r['plate_light'], location=(0, 0.12, 0)),
        armour_lib.volume(kit.name('guard'), (0.034, 0.036, blade_w * 2.3), 0.5, 0.5, 12, 10,
                 deform=lambda p: Vector((p.x, p.y - 0.035 * (p.z / (blade_w * 2.3)) ** 2, p.z)), material=r['enamel'], location=(0, -0.115, 0)),
    ]
    glow = [armour_lib.volume(kit.name('gem'), (0.04, 0.02, 0.028), 0.6, 0.6, 10, 6, material=r['glow'], location=(0, -0.115, 0))]
    blade = armour_lib.blade(kit.name('blade'), (0, -0.135, 0), blade_l, blade_w, blade_t, r['blade'])
    for sgn in (-1, 1):
        glow.append(armour_lib.volume(kit.name('fuller'), (0.003, blade_l * 0.34, blade_w * 0.16), 0.3, 0.3, 8, 6, material=r['glow'],
                             location=(sgn * (blade_t + 0.0006), -0.135 - blade_l * 0.4, 0)))
    xform(parts + glow + [blade], Matrix.Translation(fist) @ frame(d, (1, 0, 0)))
    for ob in parts:
        kit.add(ob, P + 'RightHand', 0.8, 'round', 'weapon')
    for ob in glow:
        kit.add(ob, P + 'RightHand', 0.0, 'round', 'weapon')
    kit.add(blade, P + 'RightHand', 0.9, 'flat', 'weapon')
    n1 = len(kit.parts)
    # the shield: a curved slab, an enamel face, a boss and the player's upward chevron in glow
    elbow = bone_head(arm, P + 'LeftForeArm', True)
    wrist = bone_head(arm, P + 'LeftHand', True)
    fore = fit.pts(P + 'LeftForeArm')
    fr = float(np.percentile(np.sqrt((fore[:, 1] - fore[:, 1].mean()) ** 2 + (fore[:, 2] - fore[:, 2].mean()) ** 2), 90))
    axis_x = -shield_r

    def surf(u, z, off):
        a = u / (shield_r + off)
        return Vector((axis_x + (shield_r + off) * math.cos(a), (shield_r + off) * math.sin(a), z))

    def rows(off, margin, nu=12, nv=4):
        out = []
        for j in range(nv + 1):
            row = []
            for i in range(nu + 1):
                u = 2 * i / nu - 1
                top = shield_h / 2 + 0.07 * (1 - u * u) - margin
                bottom = -shield_h / 2 - 0.08 * (1 - u * u) + margin
                row.append(surf(u * (shield_hw - margin), bottom + (top - bottom) * j / nv, off))
            out.append(row)
        return out

    slab = armour_lib.solid(armour_lib.rows_mesh(kit.name('shield'), rows(0.0, 0.0), False, r['plate']), 0.045)
    face = armour_lib.solid(armour_lib.rows_mesh(kit.name('shieldface'), rows(0.014, 0.05), False, r['enamel']), 0.016)
    boss = armour_lib.plate(kit.name('boss'), (0.075, 0.075, 0.04), (-180, 180), (0, 90), 0.016, 0.9, 0.9, 14, 3, material=r['plate_light'],
                   location=(0.013, 0, -shield_h * 0.16), rotation=(0, math.pi / 2, 0))
    zc = shield_h * 0.2
    centre = [(-0.13, zc - 0.07), (-0.065, zc - 0.005), (0.0, zc + 0.06), (0.065, zc - 0.005), (0.13, zc - 0.07)]
    band = stroke(centre, [0.03] * 5)
    emblem = armour_lib.rows_mesh(kit.name('emblem'), [[surf(u, z, 0.03) for u, z in row] for row in band], False, r['glow'])
    armour_lib.solid(emblem, 0.017, bevel=False)
    d = (wrist - elbow).normalized()
    yaw = math.atan2(-d.x, d.y) + math.pi  # local -y along the forearm
    n = Matrix.Rotation(yaw, 3, 'Z') @ Vector((1, 0, 0))
    pos = (elbow + wrist) / 2 + d * 0.02 + n * (fr + 0.03 + 0.045) + Vector((0, 0, -0.1))
    xform([slab, face, boss, emblem], Matrix.Translation(pos) @ Matrix.Rotation(yaw, 4, 'Z'))
    kit.add(slab, P + 'LeftForeArm', 1.3, 'plate', 'weapon')
    kit.add(face, P + 'LeftForeArm', 0.8, 'plate', 'weapon')
    kit.add(boss, P + 'LeftForeArm', 0.7, 'plate', 'weapon')
    kit.add(emblem, P + 'LeftForeArm', 0.0, 'round', 'weapon')
    n2 = len(kit.parts)
    for i in range(n0, n2):
        bone = P + 'RightHand' if i < n1 else P + 'LeftForeArm'
        kit.parts[i][0].data.transform(deform(arm, bone).inverted())
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()


def assemble(kit, name):
    """Joins the parts into one mesh with one rigid group per part's bone. The face attribute cf_part tells the
    weapons apart for the clip checks (1 sword, 3 its blade, 2 shield, 0 armour); the export removes it."""
    obs = []
    for (ob, group), bone in zip(kit.parts, kit.bones):
        ob.vertex_groups.new(name=bone).add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')
        code = 0
        if group == 'weapon':
            code = 2 if bone == P + 'LeftForeArm' else (3 if '_blade_' in ob.name else 1)
        ob.data.attributes.new('cf_part', 'INT', 'FACE').data.foreach_set('value', np.full(len(ob.data.polygons), code, np.int32))
        obs.append(ob)
    return scene.join(obs, name)


def paint_armour(armour, name, out_dir, textures_dir):
    """Paints the armour with the Bulwark's style, occlusion distance and brush scale, so it matches the family, and
    returns the albedo and emissive paths for the commander atlas."""
    paint.paint([armour], name=name, out_dir=out_dir, textures_dir=textures_dir, size=1024, style=armour_lib.PLATE_STYLE, ao_distance=0.18,
                brush_scale=armour_lib.BRUSH_SCALE, emissive_strength=4.0)
    return {'albedo': out_dir / f'{name}_albedo.png', 'emissive': out_dir / f'{name}_emissive.png'}


# ---------------------------------------------------------------- 7 and 8: decimation, normals, UVs, morphs

def head_faces(ob, src_rgb, chin):
    """The face region: faces on the front of the face (between the chin and the brow line, inside the cheeks) that
    are dominated by the head and neck bones, on the body material, and not blue in the source (the hood). This region
    keeps its triangles, gets the dedicated head texture and `_skin` 1. Everything on the front belongs, brows and
    nostrils included; taking every non-hair head and neck face instead (16k source triangles) left the rest of the
    body about 1.5k."""
    me = ob.data
    uv = np.empty(len(me.loops) * 2)
    me.uv_layers.active.data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    cen, st, tot, lv = face_centres(me)
    fuv = np.add.reduceat(uv, st, axis=0) / tot[:, None]
    h, w = src_rgb.shape[:2]
    c = src_rgb[np.clip(((1 - fuv[:, 1]) * h).astype(int), 0, h - 1), np.clip((fuv[:, 0] * w).astype(int), 0, w - 1)]
    hue, sat, _ = hsv(c)
    blue = (hue >= 180) & (hue <= 300) & (sat > 0.15)
    fdom = dominant(ob)[lv[st]]
    mi = np.empty(len(me.polygons), np.int64)
    me.polygons.foreach_get('material_index', mi)
    front = (np.abs(cen[:, 0]) < 0.1) & (cen[:, 1] < -0.03) & (cen[:, 2] > chin - 0.02) & (cen[:, 2] < chin + 0.2)
    fmask = front & ~blue & np.isin(fdom, HEADNECK) & (mi == 0)
    vmask = np.zeros(len(me.vertices), bool)
    for i in np.flatnonzero(fmask):
        vmask[list(me.polygons[i].vertices)] = True
    return fmask, vmask


def decimate_protecting_face(orig, arm, src_img, chin, armour_tris, s):
    """A decimated copy of the body. Geometry the armour hides for good goes first (fingers inside the mitten
    gauntlets, sneakers inside the boots, lower shins inside the greaves). Then two Decimate passes on one mesh, so no
    seam can open: the face region locked while the rest goes down to rest_tris, then (only if the total still passes
    total_tris less the armour) the rest locked while the face goes down. The face is marked with the face attribute
    p99_head before decimation so the locked faces carry it (recomputing it afterwards from texels gave a patchy
    region). A Decimate vertex group acts as a lock, not a weight: even at factor 0.0005 it froze the group whole."""
    cfg = s['decimate']
    total = cfg['total_tris'] - armour_tris
    dec = orig.copy()
    dec.data = orig.data.copy()
    scene.link(dec)
    dec.shape_key_clear()
    for m in list(dec.modifiers):
        dec.modifiers.remove(m)
    dec.parent = None
    dom = dominant(dec)
    co = co_of(dec.data)
    knee_z = bone_head(arm, P + 'LeftLeg').z
    hidden = np.array([('Hand' in bn) or bn.endswith(('Foot', 'ToeBase')) for bn in dom])
    hidden |= np.isin(dom, [P + 'LeftLeg', P + 'RightLeg']) & (co[:, 2] < knee_z - 0.08)
    bm = bmesh.new()
    bm.from_mesh(dec.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(hidden[v.index] for v in f.verts)], context='FACES')
    bm.to_mesh(dec.data)
    bm.free()
    fmask, vmask = head_faces(dec, image_pixels(src_img), chin)
    dec.vertex_groups.new(name='face_protect').add(np.flatnonzero(vmask).tolist(), 1.0, 'REPLACE')
    dec.data.attributes.new('p99_head', 'INT', 'FACE').data.foreach_set('value', fmask.astype(np.int32))
    before = scene.tri_count([dec])
    head0 = int(fmask.sum())

    def run(ratio, invert):
        m = dec.modifiers.new('dec', 'DECIMATE')
        m.ratio = min(1.0, ratio)
        m.use_collapse_triangulate = True
        m.vertex_group = 'face_protect'
        m.invert_vertex_group = invert
        m.vertex_group_factor = 1.0
        scene.apply_modifiers(dec)

    run((cfg['rest_tris'] + head0) / before, True)
    mid = scene.tri_count([dec])
    if mid > total:
        run(total / mid, False)
    hv = np.empty(len(dec.data.polygons), np.int32)
    dec.data.attributes['p99_head'].data.foreach_get('value', hv)
    stats = dict(after_cull=before, head_source_tris=head0, pass1=mid, final=scene.tri_count([dec]), head_tris=int(hv.sum()))
    log('decimate', stats)
    dec.vertex_groups.remove(dec.vertex_groups['face_protect'])
    for p in dec.data.polygons:
        p.use_smooth = True
    return dec, stats


def normals_from_source(orig, dec):
    """Smooth normals from the undecimated source carried onto the decimated body through a Data Transfer of custom
    normals (nearest face, interpolated): no centre crease, no faceted patches, no backward eye-band normals and no
    seam where UV islands meet, all of which the decimated mesh's own normals showed in the renderer."""
    for ob in (orig, dec):
        scene.select_only([ob])
        try:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
        except RuntimeError:
            pass  # no custom normals to clear
        for p in ob.data.polygons:
            p.use_smooth = True
        if ob.data.attributes.get('sharp_edge') is not None:
            ob.data.attributes.remove(ob.data.attributes['sharp_edge'])
    m = dec.modifiers.new('normals', 'DATA_TRANSFER')
    m.object = orig
    m.use_loop_data = True
    m.data_types_loops = {'CUSTOM_NORMAL'}
    m.loop_mapping = 'POLYINTERP_NEAREST'
    scene.apply_modifiers(dec)


def repack_body_uvs(dec, chin, painted_srgb, s, work):
    """The decimated body's own atlas UVs (UVpaint): the source islands, the face's scaled up by face_island_scale,
    packed, and the source paint baked across at the atlas size. The source UVs stay as UVsource, because the head
    texture samples the source through them. Returns the body atlas (sRGB, top-down); `work` is a folder for the
    intermediate file."""
    me = dec.data
    old = me.uv_layers[0].name
    new = me.uv_layers.new(name='UVpaint', do_init=True)
    me.uv_layers.active = new
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv['UVpaint']
    bm.faces.ensure_lookup_table()
    parent = list(range(len(bm.faces)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def uv_at(f, v):
        for lp in f.loops:
            if lp.vert == v:
                return lp[uvl].uv
        return None

    for e in bm.edges:
        if len(e.link_faces) == 2:
            f1, f2 = e.link_faces
            if all((uv_at(f1, v) - uv_at(f2, v)).length < 1e-5 for v in e.verts):
                parent[find(f1.index)] = find(f2.index)
    roots = set()
    for f in bm.faces:
        c = f.calc_center_median()
        if abs(c.x) < 0.1 and c.y < -0.02 and chin - 0.03 < c.z < chin + 0.2:
            roots.add(find(f.index))
    groups = {}
    for f in bm.faces:
        if find(f.index) in roots:
            groups.setdefault(find(f.index), []).append(f)
    sc = s['uv']['face_island_scale']
    for faces in groups.values():
        uvs = [lp[uvl].uv.copy() for f in faces for lp in f.loops]
        c = sum(uvs, Vector((0, 0))) / len(uvs)
        for f in faces:
            for lp in f.loops:
                lp[uvl].uv = c + (lp[uvl].uv - c) * sc
    bm.to_mesh(me)
    bm.free()
    scene.select_only([dec])
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    src = image_file(work / 'painted_source.png', painted_srgb)

    def tree(mat, nt, colour):
        if 'mouth' in mat.name.lower():
            colour.default_value = (0.2, 0.07, 0.07, 1.0)
            return
        image_tree(src, old)(mat, nt, colour)

    res, _ = bake_emit([dec], s['uv']['atlas_size'], tree)
    bpy.data.images.remove(src)
    me.uv_layers[old].name = 'UVsource'
    me.uv_layers['UVpaint'].active = True
    me.uv_layers['UVpaint'].active_render = True
    return np.clip(res, 0, 1)


def transfer_morphs(orig, dec):
    """Surface Deform's equivalent done directly: each decimated vertex finds its nearest point on the source's basis
    surface, and every key's displacement is the barycentric mix of that triangle's three displacements. Surface
    Deform itself reported unbound after binding on Pip's mesh, so every key came through empty. Returns each key's
    largest displacement before and after, in millimetres."""
    ome = orig.data
    kbs = ome.shape_keys.key_blocks
    n = len(ome.vertices)
    base = key_co(kbs[0], n)
    ome.calc_loop_triangles()
    tris = np.empty(len(ome.loop_triangles) * 3, np.int64)
    ome.loop_triangles.foreach_get('vertices', tris)
    tris = tris.reshape(-1, 3)
    bvh = BVHTree.FromPolygons(base.tolist(), tris.tolist())
    dco = co_of(dec.data)
    idx = np.empty(len(dco), np.int64)
    loc = np.empty_like(dco)
    for i, p in enumerate(dco):
        hit, _, j, _ = bvh.find_nearest(Vector(p))
        idx[i], loc[i] = j, hit
    a, b, c = base[tris[idx, 0]], base[tris[idx, 1]], base[tris[idx, 2]]
    v0, v1, v2 = b - a, c - a, loc - a
    d00, d01, d11 = (v0 * v0).sum(1), (v0 * v1).sum(1), (v1 * v1).sum(1)
    d20, d21 = (v2 * v0).sum(1), (v2 * v1).sum(1)
    den = d00 * d11 - d01 * d01
    den = np.where(np.abs(den) < 1e-20, 1e-20, den)
    wv = (d11 * d20 - d01 * d21) / den
    ww = (d00 * d21 - d01 * d20) / den
    wu = 1 - wv - ww
    dec.shape_key_add(name='Basis', from_mix=False)
    report = {}
    for kb in kbs[1:]:
        disp = key_co(kb, n) - base
        dd = wu[:, None] * disp[tris[idx, 0]] + wv[:, None] * disp[tris[idx, 1]] + ww[:, None] * disp[tris[idx, 2]]
        nk = dec.shape_key_add(name=kb.name, from_mix=False)
        nk.data.foreach_set('co', (dco + dd).ravel())
        # A new key starts at full weight in Blender 5.2, and the exporter writes each key's value as the mesh's
        # default morph weight: left at 1 the commander shipped with every morph on (eyes shut, lips puckered).
        nk.value = 0.0
        report[kb.name] = dict(source_max_mm=round(float(np.linalg.norm(disp, axis=1).max()) * 1000, 1),
                               body_max_mm=round(float(np.linalg.norm(dd, axis=1).max()) * 1000, 1))
    log('morphs', report)
    return report


# ---------------------------------------------------------------- 9: landmarks, ink, skin, face normals

def face_landmarks(body):
    """The eye-lid curves (the rim each lid rests on and where it closes, per 2 mm column) from the blink morphs, the
    mouth centre from pucker, and the nose tip (the most forward vertex between them)."""
    me = body.data
    n = len(me.vertices)
    kbs = me.shape_keys.key_blocks
    base = key_co(kbs[0], n)
    lids = {}
    for key in ('blink_L', 'blink_R'):
        dv = key_co(kbs[key], n) - base
        m = np.linalg.norm(dv, axis=1) > 0.005
        side = 1 if base[m][:, 0].mean() > 0 else -1
        xs, zs, zc = base[m][:, 0], base[m][:, 2], (base + dv)[m][:, 2]
        cx, rz, cz = [], [], []
        for lo in np.arange(xs.min(), xs.max() + 0.002, 0.002):
            sel = (xs >= lo) & (xs < lo + 0.002)
            if sel.sum() >= 2:
                cx.append(lo + 0.001)
                rz.append(zs[sel].min())
                cz.append(zc[sel].min())
        lids[side] = (np.array(cx), np.array(rz), np.array(cz))
    mouth = base[np.linalg.norm(key_co(kbs['pucker'], n) - base, axis=1) > 0.0015].mean(0)
    eyez = np.mean([lids[sd][1].mean() for sd in lids])
    near = (np.abs(base[:, 0]) < 0.02) & (base[:, 2] > mouth[2]) & (base[:, 2] < eyez) & (base[:, 1] < 0)
    tip = base[near][np.argmin(base[near][:, 1])]
    return SimpleNamespace(lids=lids, mouth=mouth, tip=tip)


def head_mask(body):
    hv = np.empty(len(body.data.polygons), np.int32)
    body.data.attributes['p99_head'].data.foreach_get('value', hv)
    return hv.astype(bool)


def ink_and_skin(body, chin, src_img, painted_srgb):
    """The `_ink` and `_skin` vertex attributes of the body (the armour keeps the ink its parts were given).

    `_ink` is 0 on the face interior; on fringe strands over the forehead and face (a box stopping at |x| 0.09 missed
    the strands' outer ends, whose outline read as dark flecks where the hair meets the skin); and on the neck under
    the chin, whose outline shell showed through the jaw as small dark triangles that vanish with the shells hidden.

    `_skin` is a full 1.0 on every vertex of the face region and falls off outward only. Read from lit colour it sat
    at 0.4 to 0.7 on the shadowed cheek; the ears and neck keep that colour rule, which suits them."""
    me = body.data
    n = len(me.vertices)
    co = co_of(me)
    src = image_pixels(src_img)
    vh, vs, vv = hsv(sample_at_loops(me, 'UVsource', src))
    hairv = (vs > 0.55) & (vh >= 8) & (vh <= 42) & (vv > 0.15)
    vn = np.empty(n * 3)
    me.vertices.foreach_get('normal', vn)
    vn = vn.reshape(-1, 3)
    hw = weight_of(body, HEAD_BONES)
    off = (hw > 0.3) & (np.abs(co[:, 0]) < 0.09) & (co[:, 1] < -0.02) & (co[:, 2] > chin + 0.015) & (co[:, 2] < chin + 0.24)
    fringe = (hw > 0.3) & hairv & (np.abs(co[:, 0]) < 0.115) & (co[:, 1] < -0.02) & (co[:, 2] > chin + 0.08) & (co[:, 2] < chin + 0.27) & (vn[:, 1] < 0.1)
    nw = np.zeros(n)
    if P + 'Neck' in body.vertex_groups:
        ni = body.vertex_groups[P + 'Neck'].index
        nw = np.array([sum(g.weight for g in v.groups if g.group == ni) for v in me.vertices])
    neck_under = (nw > 0.5) & (co[:, 2] < chin + 0.012) & (co[:, 1] < 0.0) & (np.abs(co[:, 0]) < 0.085)
    ink_v = np.empty(n, np.float32)
    me.attributes['_ink'].data.foreach_get('value', ink_v)
    stats = dict(ink_face=int((off & (ink_v > 0)).sum()), ink_fringe=int((fringe & ~off & (ink_v > 0)).sum()), ink_neck=int((neck_under & (ink_v > 0)).sum()))
    ink_v[off | fringe | neck_under] = 0.0
    me.attributes['_ink'].data.foreach_set('value', ink_v)
    a, b = edges_of(me)
    face = np.zeros(n)
    for i in np.flatnonzero(head_mask(body)):
        face[list(me.polygons[i].vertices)] = 1.0
    th, ts, tv = hsv(sample_at_loops(me, 'UVsource', painted_srgb))
    hnw = weight_of(body, HEADNECK)
    colour_skin = ((th >= 3) & (th <= 38) & (ts >= 0.12) & (ts <= 0.62) & (tv >= 0.42) & (hnw > 0.5)).astype(np.float64)
    skin = np.maximum(face, smooth_values(np.maximum(face, colour_skin), a, b, 3))
    skin[face > 0] = 1.0
    attr = me.attributes.get('_skin') or me.attributes.new('_skin', 'FLOAT', 'POINT')
    attr.data.foreach_set('value', skin.astype(np.float32))
    stats.update(skin_face_verts=int((face > 0).sum()), skin_face_min=float(skin[face > 0].min()), skin_above_half=int((skin > 0.5).sum()))
    log('ink and skin', stats)
    return stats


def relax_face_normals(body, chin, face_lm):
    """Relaxes the transferred normals where the decimated face is coarse. Sampling the sculpt's normals at the
    decimated vertices kept its small bumps, and linear interpolation over the large triangles showed them as faint
    flat patches across the cheeks and as facets on the nose tip. Four rounds of neighbour averaging, blended in by a
    weight that is full across the cheek band (between the nose and the cheek's edge, from just above the jaw to under
    the eyes) and 0.7 on the nose tip, fading to nothing over 1.2 cm so the nose keeps its form."""
    me = body.data
    n = len(me.vertices)
    co = co_of(me)
    lv = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get('vertex_index', lv)
    a, b = edges_of(me)
    face = np.zeros(n)
    for i in np.flatnonzero(head_mask(body)):
        face[list(me.polygons[i].vertices)] = 1.0
    cn = np.empty(len(me.loops) * 3)
    me.corner_normals.foreach_get('vector', cn)
    cn = cn.reshape(-1, 3)
    vnm = np.zeros((n, 3))
    np.add.at(vnm, lv, cn)
    vnm /= np.maximum(np.linalg.norm(vnm, axis=1, keepdims=True), 1e-9)
    cheek = (face > 0) * ss(0.02, 0.035, np.abs(co[:, 0])) * ss(chin + 0.02, chin + 0.045, co[:, 2]) * (1 - ss(chin + 0.11, chin + 0.125, co[:, 2]))
    nose = (face > 0) * 0.7 * ss(0.02, 0.008, np.linalg.norm(co - face_lm.tip, axis=1))
    w = np.maximum(cheek, nose)

    def nbr_mean(v):
        acc = v.copy()
        np.add.at(acc, a, v[b])
        np.add.at(acc, b, v[a])
        return acc / np.maximum(np.linalg.norm(acc, axis=1, keepdims=True), 1e-9)

    def roughness(v, m):
        return round(float(np.degrees(np.arccos(np.clip((v * nbr_mean(v)).sum(1), -1, 1)))[m].mean()), 3)

    vs = vnm.copy()
    for _ in range(4):
        vs = nbr_mean(vs)
    new = vnm * (1 - w[:, None]) + vs * w[:, None]
    new /= np.maximum(np.linalg.norm(new, axis=1, keepdims=True), 1e-9)
    lw = w[lv] > 0
    cn[lw] = new[lv[lw]]
    me.normals_split_custom_set(cn.tolist())
    stats = dict(cheek_deg=(roughness(vnm, cheek > 0.5), roughness(new, cheek > 0.5)), nose_deg=(roughness(vnm, nose > 0.35), roughness(new, nose > 0.35)))
    log('face normals: neighbour angle before and after', stats)
    return stats


# ---------------------------------------------------------------- 10: the commander's textures

def _uv_islands(me, uv_name):
    """Face island ids by UV connectivity: two faces share an island when they share an edge with matching UVs."""
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv[uv_name]
    bm.faces.ensure_lookup_table()
    parent = list(range(len(bm.faces)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def uv_at(f, v):
        for lp in f.loops:
            if lp.vert == v:
                return lp[uvl].uv
        return None

    for e in bm.edges:
        if len(e.link_faces) == 2:
            f1, f2 = e.link_faces
            if all((uv_at(f1, v) - uv_at(f2, v)).length < 1e-6 for v in e.verts):
                parent[find(f1.index)] = find(f2.index)
    roots = {}
    ids = np.array([roots.setdefault(find(f.index), len(roots)) for f in bm.faces], np.int64)
    bm.free()
    return ids


def blend_island_seams(img, cover, isl, pos, measure, reach_m=0.02, match_m=0.002, reach_px=64, max_shift=0.08):
    """Removes the tone step where two UV islands of the same texture meet on the surface (down the centre of the face
    on Pip): each island's low-frequency colour is measured along the seam, both sides move half way to meet, and the
    correction fades out over reach_m of surface. Neighbours are found in 3D through the baked position map, so it works
    whatever the islands' layout in texture space. Only seam texels inside `measure` (plain skin) are measured, and a
    pair whose sides differ by more than 30 percent in luminance is a real edge (a lash, a strand of hair), not a tone
    step, so it is skipped; measured over every texel, eye and hair edges pushed shifts of 0.28 into the skin."""
    cv = cover.astype(bool)
    border = cv & (box(cv.astype(np.float64), 1) < 0.999)
    ids = [int(i) for i in np.unique(isl[cv]) if i >= 0]
    low = np.zeros_like(img)
    for i in ids:
        m = cv & (isl == i)
        low[m] = masked_blur(img, m, 10)[m]
    fpos, fisl, flow, fmeas = pos.reshape(-1, 3), isl.ravel(), low.reshape(-1, 3), measure.ravel()
    bidx = np.flatnonzero(border.ravel())
    kd = KDTree(len(bidx))
    for j, t in enumerate(bidx):
        kd.insert(fpos[t], j)
    kd.balance()
    seams = {i: ([], []) for i in ids}
    for t in bidx:
        best = None
        for _co, jj, dist in kd.find_range(fpos[t], match_m):
            other = bidx[jj]
            if fisl[other] != fisl[t] and (best is None or dist < best[1]):
                best = (other, dist)
        if best is None or fisl[t] not in seams or not (fmeas[t] and fmeas[best[0]]):
            continue
        a, b = lum(flow[t]), lum(flow[best[0]])
        if abs(b / max(a, 1e-4) - 1) > 0.3:
            continue
        seams[fisl[t]][0].append(fpos[t])
        seams[fisl[t]][1].append(np.clip((flow[best[0]] - flow[t]) * 0.5, -max_shift, max_shift))
    corr = np.zeros_like(flow)
    dist = np.full(len(flow), np.inf)
    near = (box(border.astype(np.float64), reach_px) > 0).ravel()
    for i in ids:
        pts, diffs = seams[i]
        if len(pts) < 3:
            continue
        kdi = KDTree(len(pts))
        for j, p in enumerate(pts):
            kdi.insert(p, j)
        kdi.balance()
        diffs = np.array(diffs)
        for t in np.flatnonzero(cv.ravel() & (fisl == i) & near):
            hits = kdi.find_n(fpos[t], 8)
            if not hits or hits[0][2] > reach_m:
                continue
            dist[t] = hits[0][2]
            corr[t] = diffs[[h[1] for h in hits]].mean(0) * ss(reach_m, 0.0, hits[0][2])
    out = img + corr.reshape(img.shape)
    stats = dict(islands=len(ids), seam_texels={i: len(seams[i][0]) for i in ids}, max_shift=round(float(np.abs(corr).max()), 4))
    log('island seams', stats)
    return out, dist.reshape(img.shape[:2]), stats


def _atlas_tree(kind, armour_imgs, body_img):
    def tree(mat, nt, colour):
        name = mat.name.lower()
        if 'armour' in name:
            return image_tree(armour_imgs[kind], 'UVpaint')(mat, nt, colour)
        if 'mouth' in name:
            colour.default_value = (0.2, 0.07, 0.07, 1.0) if kind == 'albedo' else (0, 0, 0, 1)
            return
        if kind == 'albedo' and 'head' not in name:
            return image_tree(body_img, 'UVpaint')(mat, nt, colour)
        colour.default_value = (0, 0, 0, 1)
    return tree


def _pack(objs, masks):
    scene.select_only(objs)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.context.scene.tool_settings.mesh_select_mode = (False, False, True)
    bpy.ops.object.mode_set(mode='EDIT')
    for ob in objs:
        bm = bmesh.from_edit_mesh(ob.data)
        bm.faces.ensure_lookup_table()
        for f in bm.faces:
            f.select_set(bool(masks[ob.name][f.index]))
        bmesh.update_edit_mesh(ob.data)
    bpy.ops.uv.pack_islands(margin=0.003, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')


def _density(ob, fmask, size, uv_name='UVgame'):
    """Texels per metre over the faces in fmask: the square root of UV area times size squared over surface area."""
    m = ob.data
    m.calc_loop_triangles()
    n = len(m.loop_triangles)
    tv = np.empty(n * 3, np.int64)
    m.loop_triangles.foreach_get('vertices', tv)
    tl = np.empty(n * 3, np.int64)
    m.loop_triangles.foreach_get('loops', tl)
    tp = np.empty(n, np.int64)
    m.loop_triangles.foreach_get('polygon_index', tp)
    keep = fmask[tp]
    c = co_of(m)[tv.reshape(-1, 3)][keep]
    uv = np.empty(len(m.loops) * 2)
    m.uv_layers[uv_name].data.foreach_get('uv', uv)
    u = uv.reshape(-1, 2)[tl.reshape(-1, 3)][keep]
    a3 = np.linalg.norm(np.cross(c[:, 1] - c[:, 0], c[:, 2] - c[:, 0]), axis=1).sum() / 2
    au = np.abs(np.cross(u[:, 1] - u[:, 0], u[:, 2] - u[:, 0])).sum() / 2
    return math.sqrt(au * size * size / a3)


def _seam_triangles(head_only, cover, size):
    """Head triangles whose source UVs span a seam of the source atlas (decimation merged across it) sample the wrong
    part of the texture and showed as dark polygon patches on the cheeks. They are found by UV edge stretch (an edge
    over 3x the median UV length per metre) and baked to a mask."""
    hm = head_only.data
    nl = len(hm.loops)
    uvh = np.empty(nl * 2)
    hm.uv_layers['UVsource'].data.foreach_get('uv', uvh)
    uvh = uvh.reshape(-1, 2)
    lvh = np.empty(nl, np.int64)
    hm.loops.foreach_get('vertex_index', lvh)
    cov = co_of(hm)
    ls = np.empty(len(hm.polygons), np.int64)
    hm.polygons.foreach_get('loop_start', ls)
    lt = np.empty(len(hm.polygons), np.int64)
    hm.polygons.foreach_get('loop_total', lt)
    nxt = np.arange(nl) + 1
    nxt[ls + lt - 1] = ls
    rl = np.linalg.norm(uvh[nxt] - uvh, axis=1) / np.maximum(np.linalg.norm(cov[lvh[nxt]] - cov[lvh], axis=1), 1e-9)
    rmax = np.zeros(len(hm.polygons))
    np.maximum.at(rmax, np.repeat(np.arange(len(hm.polygons)), lt), rl)
    bad = rmax > 3.0 * np.median(rl)
    hm.attributes.new('p99_bad', 'FLOAT', 'FACE').data.foreach_set('value', bad.astype(np.float32))
    baked, _ = bake_emit([head_only], size, attr_tree('p99_bad'))
    return box((baked[..., 0] > 0.25).astype(np.float64), 2) > 0, int(bad.sum())


def _atlas_touchups(body_rest, alb, chin, hair_srgb, size):
    """Outside the head texture: small dark specks on the face-adjacent skin (jaw, outer cheeks) are inpainted, and
    the orange line where the fringe meets the forehead takes the hair colour with its own shading."""
    me = body_rest.data
    cen, st, tot, lv = face_centres(me)
    skr = np.empty(len(me.vertices), np.float32)
    me.attributes['_skin'].data.foreach_get('value', skr)
    skin_f = np.add.reduceat(skr[lv], st) / tot > 0.5
    fringe_f = (np.abs(cen[:, 0]) < 0.12) & (cen[:, 1] < -0.02) & (cen[:, 2] > chin + 0.14) & (cen[:, 2] < chin + 0.3)
    for name, fm in (('p99_skf', skin_f), ('p99_frf', fringe_f)):
        me.attributes.new(name, 'FLOAT', 'FACE').data.foreach_set('value', fm.astype(np.float32))
    ska = bake_emit([body_rest], size, attr_tree('p99_skf'))[0][..., 0] > 0.5
    fra = bake_emit([body_rest], size, attr_tree('p99_frf'))[0][..., 0] > 0.5
    ma = ska & (lum(alb) > 0.03)
    rata = lum(alb) / np.maximum(lum(mblur(alb, ma, (4, 12, 32))), 1e-4)
    spa = ma & (rata < 0.9) & (box((ma & (rata < 0.9)).astype(np.float64), 4) < 0.45)
    wa = np.clip(box(spa.astype(np.float64), 1) * 2.0, 0, 1)
    alb = alb + (mblur(alb, ma & ~spa, (4, 12, 32)) - alb) * wa[..., None]
    ah, as_, av = hsv(np.clip(alb, 0, 1))
    ora = fra & (as_ > 0.55) & (av > 0.3) & (ah >= 3) & (ah <= 40)
    alb = np.where(ora[..., None], hair_srgb[None, None] * np.clip(lum(alb) / lum(hair_srgb), 0.7, 1.3)[..., None], alb)
    return alb, dict(specks=int(spa.sum()), orange=int(ora.sum()))


def paint_head(layers, lm, chin, hair_lin):
    """The head texture from its baked layers (position, normal, occlusion, the 4K source and the source paint, all
    sampled through the source UVs at head density), keeping every feature the character's own. Only the defects
    change: paint the source labelled wrongly is replaced by the source's skin, the baked key light comes out of the
    skin, specks and hair-edge flecks are inpainted, the nose blob becomes a warm shadow and the nose tip's facets are
    evened, the features take the source's fine detail (the source paint sampled a 2,048 copy, which is why its eyes
    read soft), the tone steps where UV islands meet are blended away, and the fringe (with a brow it covers) takes
    the hair colour. Returns the linear RGB image and its stats."""
    pos, nrm, ao, src_s, v3_s, cover, isl = (layers[k] for k in ('pos', 'nrm', 'ao', 'src', 'v3', 'cover', 'island'))
    X, Z = pos[..., 0] * 2 - 1, pos[..., 2] + 1
    ny = nrm[..., 1] * 2 - 1
    src, v3 = srgb_to_linear(np.clip(src_s, 0, 1)), srgb_to_linear(np.clip(v3_s, 0, 1))
    front = ny < -0.15
    fbox = front & (np.abs(X) < 0.105) & (Z > chin - 0.01) & (Z < chin + 0.22)
    # Hair at the region's edge is read from the source, where hair is saturated orange and shadowed skin is not:
    # read from the source paint, dark skin shadows were kept as dark patches.
    sh_, ss_, sv_ = hsv(np.clip(src_s, 0, 1))
    src_hair = (ss_ > 0.55) & (sh_ >= 8) & (sh_ <= 42) & (sv_ > 0.15)
    lids = lm.lids

    def rim(sd, x):
        cx, rz, _ = lids[sd]
        return np.interp(x, cx, rz)

    def closed(sd, x):
        cx, _, cz = lids[sd]
        return np.interp(x, cx, cz)

    eyes = {}
    dark = (lum(src) < 0.035) & fbox & (Z > chin + 0.09)
    white = (lum(src) > 0.45) & (ss_ < 0.25) & fbox
    for sd in lids:
        lx = lids[sd][0]
        # The pupil: the darkest texels inside the eye opening, below the lid rim (above it are lashes and brows).
        band = (X >= lx.min()) & (X <= lx.max()) & (Z < rim(sd, X) - 0.001) & (Z > closed(sd, X))
        d = dark & band
        px = float(X[d].mean()) if d.sum() > 5 else float(lx.mean())
        pz = float(Z[d].mean()) if d.sum() > 5 else float(rim(sd, np.array([lx.mean()]))[0] - 0.01)
        # The opening is fitted to the painted whites and iris (the lid's lowest vertices tuck into the socket).
        near = fbox & (np.abs(X - px) < 0.032) & (np.abs(Z - pz) < 0.022)
        ir = near & (lum(src) < 0.14) & (np.hypot(X - px, Z - pz) < 0.02)
        ey = (near & white) | ir
        if ey.sum() > 40:
            x0, x1 = np.percentile(X[ey], [3, 97])
            z0, z1 = np.percentile(Z[ey], [3, 97])
        else:
            x0, x1, z0, z1 = px - 0.017, px + 0.017, pz - 0.012, pz + 0.012
        a, b = float((x1 - x0) / 2), float((z1 - z0) / 2)
        b = min(max(b, 0.008), 0.02)
        eyes[sd] = dict(cx=float((x0 + x1) / 2), cz=float((z0 + z1) / 2), a=min(max(a, 0.012), 0.026), b=b)
    browz = np.zeros(X.shape, bool)
    for e in eyes.values():
        browz |= fbox & (Z > e['cz'] + e['b'] * 0.6) & (Z < e['cz'] + e['b'] + 0.05) & (np.abs(X - e['cx']) < 0.042)
    # Hair is kept only where the source hair is a dense region above the eyes (fringe strands): freckles and nostrils
    # are saturated orange too, and were kept as dark dots. Below the eyes only large kept areas stay hair; small
    # dense islands on the cheek sides were kept as dark hair-coloured specks.
    eye_top = max(e['cz'] + e['b'] for e in eyes.values())
    dense_hair = box(src_hair.astype(np.float64), 4) > 0.55
    hair_keep = src_hair & dense_hair & ~browz & ~((Z < eye_top + 0.004) & (np.abs(X) < 0.085))
    hair_keep &= ~((Z < eye_top) & (box(hair_keep.astype(np.float64), 8) < 0.5))
    # How much of the 3 cm above each eye the source paints as hair: on Pip 77 percent over the right eye, where the
    # fringe covers the brow, and 35 over the left (step 9 restores a covered brow).
    covered = {}
    for sd, e in eyes.items():
        above = fbox & (Z > e['cz'] + e['b']) & (Z < e['cz'] + e['b'] + 0.03) & (np.abs(X - e['cx']) < 0.042)
        covered[sd] = round(float(src_hair[above].mean()), 3) if above.any() else 0.0

    def ell(cx, cz, rx, rz):
        return np.sqrt(((X - cx) / rx) ** 2 + ((Z - cz) / rz) ** 2)

    fz = np.zeros(X.shape)
    fzx = np.zeros(X.shape, bool)  # a generous no-touch zone for the skin clean-up
    for e in eyes.values():
        de = ell(e['cx'], e['cz'] + 0.003, e['a'] * 1.6, e['b'] * 2.1)
        fz = np.maximum(fz, ss(1.1, 0.85, de))
        fzx |= de < 1.5
    brow = box((browz & src_hair).astype(np.float64), 2) > 0.05
    fz = np.maximum(fz, box(brow.astype(np.float64), 2))
    fzx |= box(brow.astype(np.float64), 3) > 0
    mouth, tip = lm.mouth, lm.tip
    mz = (np.abs(X - mouth[0]) < 0.034) & (np.abs(Z - mouth[2]) < 0.012)
    fz = np.maximum(fz, box(mz.astype(np.float64), 3))
    fzx |= (np.abs(X - mouth[0]) < 0.042) & (np.abs(Z - mouth[2]) < 0.018)
    fz = fz * front
    # The nose tip and nostrils. The clean-up stays out of the core only, so the ring round it is covered by one pass
    # or the other (dark nostril flecks survived in a gap between the two).
    wn = ss(1.0, 0.7, ell(tip[0], tip[2] - 0.005, 0.025, 0.018)) * front
    nz = wn > 0.5
    cv = cover.astype(bool)
    # 0. Where the source paint is far darker than the source itself and the source is plain skin there, its labels
    # were wrong (a small island beside the nose was painted hair-brown, the dark notch): those texels take the source
    # with the paint's own skin colour shift, the median ratio of paint to source over the skin.
    ls, lv3 = lum(src), lum(v3)
    plain = cv & ~src_hair & ~fzx & (ls > 0.1)
    agree = plain & (lv3 > 0.6 * ls) & (lv3 < 1.6 * ls)
    k = np.median(v3[agree] / np.maximum(src[agree], 1e-4), axis=0)
    wrong = plain & (lv3 < 0.4 * ls)
    wrong = box(wrong.astype(np.float64), 1) > 0
    v3 = np.where((wrong & plain)[..., None], src * k, v3)

    # 1. The baked key light out: divide by the source paint's face-wide luminance, back up to its lit-side level.
    # Only the face-wide gradient counts as light; at 12 mm the socket and nose-side form shading counted too and
    # brightened into a halo round the eyes and nose.
    l3 = lum(v3)
    pre = cv & ~hair_keep & ~fzx & ~nz & (l3 > 0.03)
    # Skin texels: not kept hair, not features, and not much darker than their surroundings (the source reads shadowed
    # skin as hair-coloured, so a hair test left holes all over the cheeks).
    sk_m = pre & (l3 > 0.75 * mblur(l3[..., None], pre, (24, 64, 160))[..., 0])
    lbig = box(mblur(l3[..., None], sk_m, (96, 200, 400)), 24)[..., 0]
    target = float(np.percentile(lbig[sk_m], 70))
    gain = np.clip(target / np.maximum(lbig, 1e-4), 0.8, 1.6)
    aob = box(ao[..., 0], 5)
    occl = (0.92 + 0.08 * aob) / (0.92 + 0.08 * float(np.median(aob[sk_m])))
    img = v3 * (gain * occl)[..., None]

    # 2. Features: the source paint's colour and weight at low frequency times the source's luminance detail, then a
    # very light sharpen. With colour detail too, the source's orange hair put orange flecks into the fringe.
    bi, bs = box(img, 2), box(src, 2)
    feat = bi * np.clip(lum(src) / np.maximum(lum(bs), 1e-3), 0.3, 2.5)[..., None]
    feat = np.clip(feat + 0.3 * (feat - box(feat, 1)), 0, 1)
    img = img + (feat - img) * fz[..., None]

    # 3. Specks on cheeks and forehead, hair-coloured flecks outside the kept hair, dark texels at the hair's edge and
    # dark marks under the brows that are neither hair nor features (near-black flecks fail the hair test, which needs
    # value above 0.15). The estimate uses 12 texels (4 mm): at 6 a 3 mm fleck darkened its own estimate and survived.
    est = mblur(img, sk_m, (12, 32, 96, 200))
    rat = lum(img) / np.maximum(lum(est), 1e-4)
    speck = sk_m & (rat < 0.93) & (box((sk_m & (rat < 0.93)).astype(np.float64), 8) < 0.45)
    fleck = cv & src_hair & ~hair_keep & ~fzx & ~nz & (rat < 0.9)
    edge_dark = cv & (box(hair_keep.astype(np.float64), 4) > 0) & ~hair_keep & ~src_hair & ~fzx & ~nz & (rat < 0.85)
    dark_mark = cv & ~hair_keep & ~fzx & ~nz & (rat < 0.8) & (Z < eye_top + 0.01)
    fix = speck | fleck | edge_dark | dark_mark
    est2 = mblur_islands(img, sk_m & ~fix, isl, (6, 16, 48, 128))
    w = np.clip(box(fix.astype(np.float64), 1) * 2.0, 0, 1)
    img = img + (est2 - img) * w[..., None]

    # 4. The nose tip and nostrils: the dark blob lifted to a warm shadow on the local skin (at most 22 percent darker,
    # tinted 1.0, 0.88, 0.82).
    est_n = mblur_islands(img, sk_m & ~fix & (rat > 0.9), isl, (12, 32, 96))
    tint = np.array([1.0, 0.88, 0.82])
    d = np.clip(1 - lum(img) / np.maximum(lum(est_n), 1e-4), 0, 1)
    t = np.clip(d / 0.5, 0, 1)
    shadow = est_n * (1 - 0.22 * t)[..., None] * (1 - t[..., None] * (1 - tint))
    wnose = wn * ss(0.03, 0.12, d)
    img = img + (shadow - img) * wnose[..., None]
    # Beside the nose, where the zone's weight is partial, a dark notch kept most of its darkness. Anything in the
    # zone still darker than the deepest warm shadow (two thirds of the local skin) becomes a half-depth warm shadow.
    notch = (wn > 0.05) & cv & (lum(img) / np.maximum(lum(est_n), 1e-4) < 0.66)
    half = est_n * (1 - 0.11) * (1 - 0.5 * (1 - tint))
    wnotch = np.clip(box(notch.astype(np.float64), 1) * 2.0, 0, 1) * (wn > 0.02)
    img = img + (half - img) * wnotch[..., None]
    # The nose tip's few large triangles stretch the painted highlight differently each, and the tip is cut into
    # pieces scattered over the texture, so it read as facets 5 to 10 mm across even in flat light (a blur in texture
    # space left their edges in place). A 5 mm blur in the front view, over the front-facing tip, evens them.
    tipm = cv & (ny < -0.3) & (wn > 0.05)
    wtip = 0.9 * ss(0.15, 0.5, wn) * tipm
    img = img + (front_blur(img, tipm, X, Z) - img) * wtip[..., None]
    # The bridge and sides of the nose carry the same patches where the islands and the large triangles meet; a
    # lighter 4 mm front-view blur covers them, clear of the eyes and the mouth.
    sidem = cv & front & ~fzx & (ss(1.0, 0.6, ell(tip[0], tip[2] + 0.012, 0.03, 0.035)) > 0.02)
    wside = 0.6 * ss(1.0, 0.6, ell(tip[0], tip[2] + 0.012, 0.03, 0.035)) * sidem * (1 - wtip)
    img = img + (front_blur(img, sidem, X, Z, r=8) - img) * wside[..., None]

    # 5. Lighter patches (the bridge and cheek beside the nose, lifted by the nose and dark-mark passes) take the
    # colour of the skin around them; only patches 2 to 6 percent or more lighter than their surroundings are touched.
    skt = cv & ~hair_keep & ~fzx & (wn < 0.5)
    loc = mblur(img, skt, (10, 24, 64))
    bro = mblur(img, skt, (80, 160, 320))
    wp = box(ss(1.02, 1.06, lum(loc) / np.maximum(lum(bro), 1e-4)) * skt, 6)
    img = img * (1 + (np.clip(bro / np.maximum(loc, 1e-4), 0.8, 1.05) - 1) * wp[..., None])

    # 6. The edge band eases into the source paint the body atlas carries, cleaned the same way, so no boundary line
    # shows and the removed specks do not return at the jaw.
    v3c = v3 + (mblur_islands(v3, sk_m & ~fix, isl, (6, 16, 48, 128)) - v3) * w[..., None]
    d_edge = np.minimum.reduce([0.1 - np.abs(X), Z - (chin - 0.02), (chin + 0.2) - Z])
    edge = 1.0 - ss(0.0, 0.014, d_edge)
    img = img + (v3c - img) * edge[..., None]

    # 7. The tone steps where UV islands meet are blended across: the faint vertical seam down the centre of the face,
    # and the nose tip, which the decimated mesh splits into small islands that read as facets.
    img, seam_dist, seam_stats = blend_island_seams(img, cover, isl, np.stack([X, pos[..., 1] * 2 - 1, Z], -1), cv & ~hair_keep & ~fzx)
    # The tone matched, a thin line was left where the two sides' fine detail differs; a 2 mm front-view blur within
    # 4 mm of the seam on the front of the face closes it.
    seamm = cv & (ny < -0.3) & (seam_dist < 0.006) & ~fzx
    wseam = ss(0.004, 0.0, seam_dist) * seamm
    img = img + (front_blur(img, seamm, X, Z, r=4) - img) * wseam[..., None]

    # 8. The fringe keeps the source paint's shading in the hair colour (it carried orange and near-black flecks where
    # the strands meet the skin); orange strand edges touching the kept fringe and the reddish line along the fringe's
    # lower edge join it.
    hk = hair_lin[None, None] * np.clip(lum(v3) / lum(hair_lin), 0.7, 1.3)[..., None]
    strand_edge = cv & src_hair & ~hair_keep & ~fzx & (box(hair_keep.astype(np.float64), 6) > 0) & (Z > eye_top + 0.004)
    img = np.where((hair_keep | strand_edge)[..., None], hk, img)
    oh, os_, ov = hsv(np.clip(linear_to_srgb(np.clip(img, 0, 1)), 0, 1))
    orange = cv & (Z > eye_top) & (box(hair_keep.astype(np.float64), 5) > 0) & ~hair_keep & (os_ > 0.5) & (ov > 0.25) & (oh >= 3) & (oh <= 40)
    img = np.where(orange[..., None], hk, img)

    # 9. A brow the fringe covers (Pip's right, over 60 percent hair above the eye) is painted back as the mirror of the
    # other brow, placed by the eyes' tops, and the fringe over that side of the forehead stops 4 mm above it with a
    # clean edge. As the source has it the brow and the strands over it read as rust patches; painted over as hair the
    # brow was gone. The edge is a majority filter over the hair mask: no skin specks inside the hair and no hair
    # specks on the skin.
    hairish = hair_keep | strand_edge | orange
    restored = {}
    for sd, e_c in eyes.items():
        e_v = eyes.get(-sd)
        if covered[sd] <= 0.6 or e_v is None or covered[-sd] > 0.6:
            continue
        top_c, top_v = e_c['cz'] + e_c['b'], e_v['cz'] + e_v['b']
        side_v = cv & front & (Z > top_v + 0.002) & (Z < top_v + 0.06) & (np.abs(X - e_v['cx']) < 0.05)
        brow_v = side_v & browz & src_hair & (box(src_hair.astype(np.float64), 2) > 0.3)
        if brow_v.sum() < 200:
            continue
        bx, bz = X[brow_v], Z[brow_v]
        cols = [(lo + 0.0005, bz[(bx >= lo) & (bx < lo + 0.001)].max()) for lo in np.arange(bx.min(), bx.max(), 0.001)
                if ((bx >= lo) & (bx < lo + 0.001)).sum() > 3]
        tx, tz = np.array(cols).T
        tz = np.convolve(np.pad(tz, 2, mode='edge'), np.ones(5) / 5, mode='valid')
        xm = e_v['cx'] - (X - e_c['cx'])
        zm = Z - top_c + top_v
        cut = np.interp(xm, tx, tz) - top_v + top_c + 0.004
        side_c = cv & front & (Z > top_c + 0.002) & (Z < top_c + 0.06) & (np.abs(X - e_c['cx']) < 0.05)
        grid = front_grid(img, side_v, X, Z, 0.00025, r=2)
        mirror, ok = front_sample(grid, xm, zm)
        brow_a, _ = front_sample(front_grid(brow_v.astype(np.float64)[..., None], side_v, X, Z, 0.00025, r=2), xm, zm)
        inside = ss(tx.min() - 0.006, tx.min() - 0.002, xm) * ss(tx.max() + 0.006, tx.max() + 0.002, xm)
        # The mirrored skin takes this side's tone (its median over the skin just above the eye), and the copy fades
        # in over 6 mm above the eye: a 2 mm fade left a lighter band with a hard lower edge.
        under = side_c & ok & (Z < top_c + 0.012) & (brow_a[..., 0] < 0.1) & ~hairish
        if under.sum() > 200:
            mirror = mirror * (np.median(img[under], axis=0) / np.maximum(np.median(mirror[under], axis=0), 1e-4))
        wr = side_c * ok * inside * ss(cut, cut - 0.0015, Z) * ss(top_c, top_c + 0.006, Z)
        img = img + (mirror - img) * wr[..., None]
        # The fringe over this side: hair above the cut, cleaned; whatever hair paint is left under it becomes skin.
        # The cut runs on past the brow's inner end to the middle of the forehead, so no strand hangs between the
        # brows, and stops past its outer end, where the hair at the temple comes down beside the eye.
        region = cv & (Z > top_c) & (np.abs(X - e_c['cx']) < 0.06)
        outer = ss(tx.max() + 0.006, tx.max() + 0.002, xm)
        hm = (hairish & region & ((Z >= cut) | (outer < 0.5))).astype(np.float64)
        clean = box((box(hm, 3) > 0.5).astype(np.float64), 3) > 0.5
        skin_fill = mblur_islands(img, sk_m & ~fix & ~hairish, isl, (6, 16, 48))
        hk_s = hair_lin[None, None] * np.clip(box(lum(v3), 4) / lum(hair_lin), 0.7, 1.3)[..., None]
        stray = region & ~clean & hairish & (wr < 0.5)
        img = np.where(stray[..., None], skin_fill, img)
        wh = box(clean.astype(np.float64), 1) * region
        img = img + (hk_s - img) * wh[..., None]
        restored[sd] = dict(brow_texels=int((wr > 0.5).sum()), hair_texels=int(clean.sum()), stray_hair_to_skin=int(stray.sum()))
    img = paint._pad(np.concatenate([img, cover[..., None].astype(np.float64)], -1))[..., :3]
    stats = dict(delight_target=round(target, 4), wrong_paint=int(wrong.sum()), specks=int(speck.sum()), flecks=int(fleck.sum()),
                 edge_dark=int(edge_dark.sum()),
                 dark_marks=int(dark_mark.sum()), nose=int((wnose > 0.1).sum()), notch=int(notch.sum()), light_patch=int((wp > 0.5).sum()),
                 fringe_orange=int(orange.sum()), strand_edge=int(strand_edge.sum()), brow_covered=covered, brow_restored=restored, seams=seam_stats)
    log('head texture', stats)
    return np.clip(img, 0, 1), stats


def paint_commander(arm, body, armour, src_img, painted_srgb, body_atlas_srgb, armour_paths, face_lm, chin, out_dir, name, s, work):
    """The commander's final textures and materials: one atlas (albedo and emissive) for the body outside the face
    and the armour, and a head texture for the face region on the body's second material, at about 3,200 texels per
    metre against the atlas's 500. Bakes, repairs and paints them, writes them to out_dir as <name>_albedo.png,
    _emissive.png, _head.png and _preview.png, assigns the final materials and removes the working UVs and attributes.
    Returns the stats."""
    me = body.data
    size_a, size_h = s['uv']['atlas_size'], s['uv']['head_size']
    headf = head_mask(body)
    mi = np.empty(len(me.polygons), np.int64)
    me.polygons.foreach_get('material_index', mi)
    head_mat = bpy.data.materials.new(f'{name}_head')
    me.materials.append(head_mat)
    hidx = len(me.materials) - 1
    me.polygons.foreach_set('material_index', np.where(headf & (mi == 0), hidx, mi))
    armour.data.uv_layers[0].name = 'UVpaint'
    for ob in (body, armour):
        ob.data.uv_layers.active = ob.data.uv_layers['UVpaint']
        new = ob.data.uv_layers.new(name='UVgame', do_init=True)
        ob.data.uv_layers.active = new
        new.active_render = True
    objs = [body, armour]
    allb, alla = np.ones(len(me.polygons), bool), np.ones(len(armour.data.polygons), bool)
    _pack(objs, {body.name: allb, armour.name: alla})
    before = round(_density(body, headf, size_a))
    _pack(objs, {body.name: headf, armour.name: ~alla})
    after = round(_density(body, headf, size_h))
    _pack(objs, {body.name: ~headf, armour.name: alla})
    body_rest, head_only = split_copy(body, ~headf), split_copy(body, headf)
    head_only.data.attributes.new('p99_island', 'FLOAT', 'FACE').data.foreach_set(
        'value', ((_uv_islands(head_only.data, 'UVgame') + 1) / 64.0).astype(np.float32))
    armour_imgs = {k: bpy.data.images.load(str(p), check_existing=True) for k, p in armour_paths.items()}
    body_img = image_file(work / 'body_atlas_source.png', body_atlas_srgb)
    scene.configure_cycles(16)
    alb, _ = bake_emit([body_rest, armour], size_a, _atlas_tree('albedo', armour_imgs, body_img))
    emi, _ = bake_emit([body_rest, armour], size_a, _atlas_tree('emissive', armour_imgs, body_img))
    layers = {}
    layers['pos'], layers['cover'] = bake_emit([head_only], size_h, geo_tree('pos'))
    layers['nrm'], _ = bake_emit([head_only], size_h, geo_tree('nrm'))
    layers['ao'], _ = bake_emit([head_only], size_h, ao_tree())
    layers['src'], _ = bake_emit([head_only], size_h, image_tree(src_img, 'UVsource'))
    painted_img = image_file(work / 'painted_source_head.png', painted_srgb)
    layers['v3'], _ = bake_emit([head_only], size_h, image_tree(painted_img, 'UVsource'))
    isl, _ = bake_emit([head_only], size_h, attr_tree('p99_island'))
    layers['island'] = np.where(layers['cover'], np.round(isl[..., 0] * 64.0).astype(np.int64) - 1, -1)
    bad, n_bad = _seam_triangles(head_only, layers['cover'], size_h)
    good = layers['cover'].astype(bool) & ~bad
    # The refill comes from the same island: drawn from every island it borrowed colours from unrelated parts of the
    # face and left flat lavender and brown facets on the nose tip.
    for k in ('src', 'v3'):
        layers[k] = np.where(bad[..., None], mblur_islands(layers[k], good, layers['island'], (4, 12, 32, 96)), layers[k])
    hair_lin = np.array(palette.hex_to_linear(s['garments']['target_hex']['hair']))
    alb, atlas_stats = _atlas_touchups(body_rest, alb, chin, linear_to_srgb(hair_lin), size_a)
    for ob in (body_rest, head_only):
        bpy.data.objects.remove(ob)
    for img in (body_img, painted_img):
        bpy.data.images.remove(img)
    ap, ep, hp, pp = (out_dir / f'{name}_{k}.png' for k in ('albedo', 'emissive', 'head', 'preview'))
    write_png(ap, np.clip(alb, 0, 1))
    write_png(ep, np.clip(emi, 0, 1))
    write_png(pp, np.clip(alb + emi, 0, 1))
    head, head_stats = paint_head(layers, face_lm, chin, hair_lin)
    write_png(hp, linear_to_srgb(head))
    paint_mat = paint.final_material(f'{name}_paint', ap, ep, 4.0, pp)
    head_final = paint.final_material(f'{name}_head_paint', hp, None, 0.0, hp)
    mi = np.empty(len(me.polygons), np.int64)
    me.polygons.foreach_get('material_index', mi)
    mi = np.where(mi == hidx, 1, 0)
    me.materials.clear()
    me.materials.append(paint_mat)
    me.materials.append(head_final)
    me.polygons.foreach_set('material_index', mi)
    bpy.data.materials.remove(head_mat)
    armour.data.materials.clear()
    armour.data.materials.append(paint_mat)
    armour.data.polygons.foreach_set('material_index', np.zeros(len(armour.data.polygons), np.int64))
    for ob in objs:
        for uv_name in ('UVpaint', 'UVsource'):
            if uv_name in ob.data.uv_layers:
                ob.data.uv_layers.remove(ob.data.uv_layers[uv_name])
        ob.data.uv_layers['UVgame'].active = True
        ob.data.uv_layers['UVgame'].active_render = True
        for attr_name in [a.name for a in ob.data.color_attributes]:
            ob.data.color_attributes.remove(ob.data.color_attributes[attr_name])
        for attr_name in [a.name for a in ob.data.attributes if a.name.startswith('p99_')]:
            ob.data.attributes.remove(ob.data.attributes[attr_name])
    stats = dict(head_texels_per_m=dict(atlas=before, head=after), seam_triangles=n_bad, atlas=atlas_stats, head=head_stats)
    log('commander textures', {k: v for k, v in stats.items() if k != 'head'})
    return stats


# ---------------------------------------------------------------- 11: clips and export

def _channelbags(action):
    """The F-curve collections of an action: the legacy list, or every channelbag of a layered (slotted) action."""
    try:
        return [action.fcurves]
    except AttributeError:
        return [cb.fcurves for layer in action.layers for strip in layer.strips for cb in strip.channelbags]


def _stash(arm, action):
    """Puts an action on its own NLA track, the way lib/anim.make_action does, so every clip reaches the glTF
    exporter's ACTIONS mode the same way."""
    arm.animation_data_create()
    track = arm.animation_data.nla_tracks.new()
    track.name = action.name
    start = int(action.frame_range[0])
    track.strips.new(action.name, start, action)


def retarget_clips(arm, actions, scale, keep):
    """The source clips on the reshaped rig. The skeleton keeps its bone names and rest orientations, so rotations
    carry over unchanged; only the root's translation scales with the body (the uniform reshape scale), and channels
    of deleted bones (the fingers) go. Clips not in `keep` are deleted, or the exporter would ship all of them."""
    bones = {b.name for b in arm.data.bones}
    kept = {}
    for name, act in list(actions.items()):
        if name not in keep:
            bpy.data.actions.remove(act)
            continue
        for fcs in _channelbags(act):
            for fc in list(fcs):
                if not fc.data_path.startswith('pose.bones["'):
                    continue
                bn = fc.data_path.split('"')[1]
                if bn not in bones:
                    fcs.remove(fc)
                elif bn == P + 'Hips' and fc.data_path.endswith('.location'):
                    for kp in fc.keyframe_points:
                        kp.co[1] *= scale
                        kp.handle_left[1] *= scale
                        kp.handle_right[1] *= scale
        act.use_fake_user = True
        _stash(arm, act)
        kept[name] = act
    missing = [k for k in keep if k not in kept]
    if missing:
        raise ValueError(f'source clips missing: {missing} (has {sorted(actions)})')
    return kept


def pose_rotations(arm, ops):
    """Every pose bone's rotation (a quaternion in its own frame) after a list of world-space operations applied in
    order from the rest pose: ('aim', bone, direction[, twist]) points the bone's head-to-tail along a direction by the
    smallest rotation and then twists it about that direction; ('turn', bone, axis, angle) rotates the bone about a
    world axis through its head; ('aim_carry', bone, direction, carried_bone, carried_rest, want) aims the bone, then
    twists it so a direction carried by a child (given in the rest pose, such as a blade's axis) points as close to
    `want` as the twist allows; ('move', bone, offset) translates a bone (the hips) in world space; ('leg', side)
    solves that leg's thigh and shin as a two-bone chain so its ankle stays on its rest position, the knee bending
    forward, and puts the foot back at its rest orientation, so the boot stays planted however the hips move.
    A moved bone's offset comes back as '<bone>@loc' (its local translation), as lib/anim's poses carry it.
    Children follow their parents, so a torso turn carries the arms, and a later 'aim'
    of an arm is absolute again. Mixamo bones have different local axes bone to bone, which makes Euler angles hard to
    author and check; world directions read directly against the character. The NLA is switched off meanwhile: with
    the clips on their tracks, every view-layer update posed the rig from the top strip and overwrote the pose being
    built (the guard came out with the run's legs)."""
    ad = arm.animation_data
    saved = (ad.use_nla, ad.action) if ad else None
    if ad:
        ad.use_nla = False
        ad.action = None
    arm.data.pose_position = 'POSE'
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    for op in ops:
        if op[0] == 'leg':
            _solve_leg(arm, op[1])
            continue
        pb = arm.pose.bones[op[1]]
        h = pb.head.copy()
        if op[0] == 'move':
            pb.matrix = Matrix.Translation(Vector(op[2])) @ pb.matrix
            bpy.context.view_layer.update()
            continue
        if op[0] == 'aim_carry':
            d = Vector(op[2]).normalized()
            rot = (pb.tail - h).rotation_difference(d).to_matrix().to_4x4()
            pb.matrix = Matrix.Translation(h) @ rot @ Matrix.Translation(-h) @ pb.matrix
            bpy.context.view_layer.update()
            cb = arm.pose.bones[op[3]]
            cur = (cb.matrix @ arm.data.bones[op[3]].matrix_local.inverted()).to_3x3() @ Vector(op[4])

            def flat(v):
                v = Vector(v)
                return (v - d * v.dot(d)).normalized()

            fa, fb = flat(cur), flat(op[5])
            rot = Matrix.Rotation(math.atan2(fa.cross(fb).dot(d), fa.dot(fb)), 4, d)
        elif op[0] == 'aim':
            d = Vector(op[2]).normalized()
            rot = (pb.tail - h).rotation_difference(d).to_matrix().to_4x4()
            if len(op) > 3 and op[3]:
                rot = Matrix.Rotation(op[3], 4, d) @ rot
        else:
            rot = Matrix.Rotation(op[3], 4, Vector(op[2]).normalized())
        pb.matrix = Matrix.Translation(h) @ rot @ Matrix.Translation(-h) @ pb.matrix
        bpy.context.view_layer.update()
    out = {pb.name: pb.matrix_basis.to_quaternion() for pb in arm.pose.bones}
    for pb in arm.pose.bones:
        if pb.matrix_basis.translation.length > 1e-7:
            out[f'{pb.name}@loc'] = pb.matrix_basis.translation.copy()
        pb.matrix_basis = Matrix.Identity(4)
    if ad:
        ad.use_nla, ad.action = saved
    bpy.context.view_layer.update()
    return out


def _solve_leg(arm, side):
    """Two-bone IK for one Mixamo leg ('Left' or 'Right'): the ankle back on its rest position, the knee in the plane
    of the hip, the ankle and the forward direction, then the foot at its rest orientation. The ankle can only be
    reached while the hip is no further from it than the leg's length, so callers lower the hips, never raise them."""
    up, lo, ft = (arm.pose.bones[f'{P}{side}{n}'] for n in ('UpLeg', 'Leg', 'Foot'))
    rest = arm.data.bones
    hip = up.head.copy()
    ankle = rest[ft.name].head_local.copy()
    l1 = (rest[lo.name].head_local - rest[up.name].head_local).length
    l2 = (rest[ft.name].head_local - rest[lo.name].head_local).length
    d = ankle - hip
    dist = min(max(d.length, 1e-4), l1 + l2 - 1e-5)
    u = d.normalized()
    a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
    h = math.sqrt(max(l1 * l1 - a * a, 0.0))
    fwd = Vector((0.0, -1.0, 0.0))
    perp = (fwd - u * fwd.dot(u)).normalized()
    knee = hip + u * a + perp * h
    for pb, target in ((up, knee), (lo, ankle)):
        hd = pb.head.copy()
        rot = (pb.tail - hd).rotation_difference(target - hd).to_matrix().to_4x4()
        pb.matrix = Matrix.Translation(hd) @ rot @ Matrix.Translation(-hd) @ pb.matrix
        bpy.context.view_layer.update()
    ft.matrix = Matrix.Translation(ft.head) @ rest[ft.name].matrix_local.to_3x3().to_4x4()
    bpy.context.view_layer.update()


def make_action_quat(arm, name, keys, loc_bones=()):
    """lib/anim.make_action with quaternion keys. The source clips rotate their bones by quaternion, and a bone's
    rotation mode is shared by every action, so an Euler clip on this rig would have switched every bone to XYZ and
    the exporter, which samples the posed rig, would have dropped the source clips' rotations. Keys every bone at
    every key frame (keeping consecutive quaternions in one hemisphere so the blend takes the short way) and stashes
    the action on its own NLA track. A bone in `loc_bones` also keys its location from the pose's '<bone>@loc' entry
    (zero when absent)."""
    arm.animation_data_create()
    action = bpy.data.actions.new(name)
    arm.animation_data.action = action
    prev = {}
    for frame, pose in keys:
        for pb in arm.pose.bones:
            pb.rotation_mode = 'QUATERNION'
            q = pose.get(pb.name)
            q = q.copy() if q is not None else Matrix.Identity(3).to_quaternion()
            if pb.name in prev and prev[pb.name].dot(q) < 0:
                q.negate()
            prev[pb.name] = q
            pb.rotation_quaternion = q
            pb.keyframe_insert('rotation_quaternion', frame=frame)
            if pb.name in loc_bones:
                pb.location = pose.get(f'{pb.name}@loc', Vector((0.0, 0.0, 0.0)))
                pb.keyframe_insert('location', frame=frame)
    arm.animation_data.action = None
    _stash(arm, action)
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pb.location = (0.0, 0.0, 0.0)
    return action


def _evaluated_co(ob):
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    tm = ev.to_mesh()
    c = co_of(tm)
    ev.to_mesh_clear()
    return c


def attack_checks(arm, body, armour, action, strike_frame):
    """Measures a clip frame by frame: whether the sword crosses the shield, whether the blade passes through the body
    (BVH overlaps of their triangles on the posed meshes; the grip sits in the mitten against the sleeve by design),
    the lowest point of the figure against the ground, and how far the boots move from the clip's first frame.
    Returns the worst values and the blade tip's position at the strike."""
    from . import anim
    part = np.empty(len(armour.data.polygons), np.int32)
    armour.data.attributes['cf_part'].data.foreach_get('value', part)
    polys = [tuple(p.vertices) for p in armour.data.polygons]
    sword_f = [polys[i] for i in np.flatnonzero((part == 1) | (part == 3))]
    shield_f = [polys[i] for i in np.flatnonzero(part == 2)]
    blade_f = [polys[i] for i in np.flatnonzero(part == 3)]
    blade_v = np.unique([v for f in blade_f for v in f])
    body_tris = [tuple(p.vertices) for p in body.data.polygons]
    foot = weight_of(armour, (P + 'LeftFoot', P + 'RightFoot', P + 'LeftToeBase', P + 'RightToeBase')) > 0.5
    restore = anim.play(arm, action)
    start, end = action.frame_range
    worst = dict(sword_shield_overlaps=0, blade_body_overlaps=0, frames_crossing_shield=[], frames_blade_in_body=[], min_z=1e9, boot_shift_mm=0.0)
    rest_co = None
    tip = None
    for f in range(int(start), int(math.ceil(end)) + 1):
        bpy.context.scene.frame_set(f)
        ac, bc = _evaluated_co(armour), _evaluated_co(body)
        if rest_co is None:
            rest_co = ac.copy()
        sw = BVHTree.FromPolygons(ac.tolist(), sword_f)
        sh = BVHTree.FromPolygons(ac.tolist(), shield_f)
        bl = BVHTree.FromPolygons(ac.tolist(), blade_f)
        bd = BVHTree.FromPolygons(bc.tolist(), body_tris)
        n_sh, n_bd = len(sw.overlap(sh)), len(bl.overlap(bd))
        worst['sword_shield_overlaps'] = max(worst['sword_shield_overlaps'], n_sh)
        worst['blade_body_overlaps'] = max(worst['blade_body_overlaps'], n_bd)
        if n_sh:
            worst['frames_crossing_shield'].append(f)
        if n_bd:
            worst['frames_blade_in_body'].append(f)
        worst['min_z'] = min(worst['min_z'], float(ac[:, 2].min()), float(bc[:, 2].min()))
        worst['boot_shift_mm'] = max(worst['boot_shift_mm'], float(np.linalg.norm(ac[foot] - rest_co[foot], axis=1).max()) * 1000)
        if f == int(round(strike_frame)):
            bv = ac[blade_v]
            far = bv[np.argmax(np.linalg.norm(bv - bv.mean(0), axis=1))]
            tip = dict(z=round(float(far[2]), 3), y=round(float(far[1]), 3), x=round(float(far[0]), 3))
    restore()
    bpy.context.scene.frame_set(1)
    worst['min_z'] = round(worst['min_z'], 4)
    worst['boot_shift_mm'] = round(worst['boot_shift_mm'], 2)
    worst['strike_blade_tip'] = tip
    log('attack checks', worst)
    return worst


def export_commander(arm, objs, path):
    """The GLB with skins, morphs, the custom `_ink` and `_skin` attributes and every action as its own clip, at the pose
    the rig rests in. It exports through lib/export.py's export_glb with its morphs option, so a commander takes the
    exporter settings every recipe takes, its morphs as positions only (export.py says why), and the check that every
    shape key the rework made reached the file. Returns what the file holds, read back from its JSON chunk."""
    import json
    import struct

    from . import export
    for ob in objs:
        if ob.type == 'MESH':
            for attr_name in [a.name for a in ob.data.attributes if a.name.startswith('cf_')]:
                ob.data.attributes.remove(ob.data.attributes[attr_name])
    path.parent.mkdir(parents=True, exist_ok=True)
    arm.data.pose_position = 'POSE'
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    export.export_glb([arm] + list(objs), path, animations=True, morphs=True)
    data = path.read_bytes()
    gl = json.loads(data[20:20 + struct.unpack('<I', data[12:16])[0]])
    acc = gl['accessors']
    meta = dict(
        bones=len(gl['skins'][0]['joints']),
        meshes={m['name']: dict(primitives=len(m['primitives']), attributes=sorted(m['primitives'][0]['attributes']),
                                morphs=m.get('extras', {}).get('targetNames', [])) for m in gl['meshes']},
        clips={a['name']: round(max(acc[smp['input']]['max'][0] for smp in a['samplers']), 3) for a in gl.get('animations', [])},
        height_m=round(max(acc[p['attributes']['POSITION']]['max'][1] for m in gl['meshes'] for p in m['primitives']), 3),
        bind_min_y_m=round(min(acc[p['attributes']['POSITION']]['min'][1] for m in gl['meshes'] for p in m['primitives']), 4),
        bytes=len(data))
    log('exported', path.name, meta)
    return meta


def render_face(objs, path, chin, size=768, width_m=0.3):
    """A front close-up of the face in the bind pose with the textures shown as they are (Workbench, flat light, no
    outline), for judging the head texture: studio light split the face down the middle and the outline drew specks
    wherever geometry behind showed at the jaw, both of which read as paint defects."""
    from . import export
    export._workbench(size)
    shading = bpy.context.scene.display.shading
    shading.light = 'FLAT'
    shading.show_object_outline = False
    cam = export._camera()
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = width_m
    cam.location = (0.0, -3.0, chin + 0.1)
    cam.rotation_euler = (math.pi / 2, 0.0, 0.0)
    with export.bind_pose(objs):
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
    cam.data.type = 'PERSP'
    shading.light = 'STUDIO'
    shading.show_object_outline = True
    return path


def render_action_side(arm, objs, action, out_dir, prefix, frames=6, size=384):
    """lib/export.render_action's filmstrip seen from the character's right side, at the same frames, so the legs'
    bend and the weight's travel forward and back show."""
    from . import anim, export
    restore = anim.play(arm, action)
    export._workbench(size)
    cam = export._camera()
    centre, radius = export._framing(objs)
    distance = radius * 1.35 / math.sin(cam.data.angle / 2)
    start, end = action.frame_range
    paths = []
    for k in range(frames):
        bpy.context.scene.frame_set(int(round(start + (end - start) * k / max(frames - 1, 1))))
        export._aim(cam, centre, distance, math.radians(-90), math.radians(5))
        path = out_dir / f'{prefix}_{action.name}_side_{k}.png'
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    restore()
    bpy.context.scene.frame_set(1)
    return paths


def filmstrip(rows, out_path):
    """Joins equally sized PNG renders into one sheet: a list of paths makes one row, a list of lists one row each."""
    if rows and not isinstance(rows[0], (list, tuple)):
        rows = [rows]
    out = []
    for paths in rows:
        imgs = []
        for p in paths:
            im = bpy.data.images.load(str(p))
            imgs.append(image_pixels(im))
            bpy.data.images.remove(im)
        out.append(np.concatenate(imgs, axis=1))
    write_png(out_path, np.clip(np.concatenate(out, axis=0), 0, 1))
    return out_path
