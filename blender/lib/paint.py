"""The painted colour map. Six Cycles EMIT passes are baked into float images: the region colour, ambient
occlusion, curvature (pointiness), a per-object height gradient, box-projected brush strokes and the
emissive colour. numpy composites them into an albedo and an emissive map (see composite), which are
written as sRGB PNG files and assigned through one final material, so each asset draws with a single
material and a single atlas."""
import math
from pathlib import Path

import bpy
import numpy as np

from . import scene
from .palette import PaintStyle
from .png import linear_to_srgb, write_png

PASSES = ('region', 'ao', 'curv', 'height', 'brush', 'emit')


def composite(region, ao, curv, height, brush, emit, style):
    """All inputs linear: region (H, W, 3); ao, curv, height, brush (H, W); emit (H, W, 3).
    Occlusion shifts toward the style's shadow colour instead of grey; convex edges catch warm light;
    cavities darken; tops lean warm and bottoms cool; brush strokes vary value and pull dark strokes
    toward the shadow hue."""
    shadow = np.asarray(style.shadow_tint, dtype=np.float64)
    occlusion = 1.0 - style.ao_strength * (1.0 - np.clip(ao, 0.0, 1.0))
    col = region * (occlusion[..., None] + (1.0 - occlusion[..., None]) * shadow)
    convex = np.clip((curv - 0.5) * style.curv_gain, 0.0, 1.0)[..., None]
    concave = np.clip((0.5 - curv) * style.curv_gain, 0.0, 1.0)[..., None]
    col = col + convex * style.edge_light * np.asarray(style.edge_tint) * (0.25 + col)
    col = col * (1.0 - style.cavity_dark * concave)
    t = np.clip(height, 0.0, 1.0)
    t = t * t * (3.0 - 2.0 * t)
    cool = np.asarray(style.cool)
    warm = np.asarray(style.warm)
    col = col * (cool + (warm - cool) * t[..., None])
    stroke = (np.clip(brush, 0.0, 1.0) - 0.5) * 2.0
    col = col * (1.0 + stroke[..., None] * style.brush_strength * 0.5)
    dark = np.clip(-stroke, 0.0, 1.0)[..., None] * style.stroke_tint_mix
    col = col * (1.0 - dark) + col * shadow * 1.6 * dark
    albedo = np.clip(col, 0.0, 1.0)
    emissive = np.clip(emit * (1.0 + stroke[..., None] * style.emissive_brush), 0.0, 1.0)
    return albedo, emissive


def prepare_uvs(objs, angle_deg=66.0, margin=0.02):
    """Large islands shared across all objects: smart project in multi-object edit mode, then pack."""
    scene.select_only(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle_deg), island_margin=margin)
    bpy.ops.uv.pack_islands(margin=margin * 0.5, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')


def write_height_attribute(objs):
    """Normalised object-space height per vertex (0 at the lowest point, 1 at the highest)."""
    for ob in objs:
        mesh = ob.data
        co = np.empty(len(mesh.vertices) * 3, np.float32)
        mesh.vertices.foreach_get('co', co)
        z = co[2::3]
        span = max(float(z.max() - z.min()), 1e-6)
        h = (z - z.min()) / span
        attr = mesh.color_attributes.get('p99_height') or mesh.color_attributes.new('p99_height', 'FLOAT_COLOR', 'POINT')
        rgba = np.repeat(h, 4).astype(np.float32)
        rgba[3::4] = 1.0
        attr.data.foreach_set('color', rgba)


def _materials(objs):
    seen = []
    for ob in objs:
        for mat in ob.data.materials:
            if mat is not None and mat not in seen:
                seen.append(mat)
    return seen


def _pass_tree(mat, pass_name, target, params):
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    emission = nt.nodes.new('ShaderNodeEmission')
    emission.inputs['Strength'].default_value = 1.0
    nt.links.new(emission.outputs['Emission'], out.inputs['Surface'])
    color = emission.inputs['Color']
    if pass_name == 'region':
        color.default_value = (*mat['p99_base'], 1.0)
    elif pass_name == 'emit':
        color.default_value = (*mat['p99_emit'], 1.0)
    elif pass_name == 'ao':
        ao = nt.nodes.new('ShaderNodeAmbientOcclusion')
        ao.samples = params['ao_samples']
        ao.inputs['Distance'].default_value = params['ao_distance']
        nt.links.new(ao.outputs['AO'], color)
    elif pass_name == 'curv':
        geometry = nt.nodes.new('ShaderNodeNewGeometry')
        nt.links.new(geometry.outputs['Pointiness'], color)
    elif pass_name == 'height':
        attribute = nt.nodes.new('ShaderNodeAttribute')
        attribute.attribute_type = 'GEOMETRY'
        attribute.attribute_name = 'p99_height'
        nt.links.new(attribute.outputs['Color'], color)
    elif pass_name == 'brush':
        coords = nt.nodes.new('ShaderNodeTexCoord')
        mapping = nt.nodes.new('ShaderNodeMapping')
        s = params['brush_scale']
        mapping.inputs['Scale'].default_value = (s, s, s)
        image = nt.nodes.new('ShaderNodeTexImage')
        image.image = params['brush_image']
        image.projection = 'BOX'
        image.projection_blend = 0.35
        nt.links.new(coords.outputs['Object'], mapping.inputs['Vector'])
        nt.links.new(mapping.outputs['Vector'], image.inputs['Vector'])
        nt.links.new(image.outputs['Color'], color)
    target_node = nt.nodes.new('ShaderNodeTexImage')
    target_node.image = target
    nt.nodes.active = target_node


_NEIGHBOURS = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1))


def _pad(pixels):
    """Fills the whole gutter so no mip level pulls in black: ring by ring outward from the islands, each empty
    texel takes the mean of its filled neighbours. Only the ring being filled is computed, so the cost follows
    the gutter's area, not its width. Blender's own bake margin pads each object as it bakes it, which painted
    a later object's colours up to 5 texels deep into earlier objects' islands of a shared atlas (measured), so
    the bake runs without a margin and the gutter is filled here from every object's coverage (alpha)."""
    height, width = pixels.shape[:2]
    stride = width + 2
    # A one-texel frame that never fills keeps every neighbour lookup inside the arrays.
    covered = np.zeros((height + 2, stride), bool)
    covered[1:-1, 1:-1] = pixels[..., 3] > 0.5
    inside = np.zeros_like(covered)
    inside[1:-1, 1:-1] = True
    rgb = np.zeros((height + 2, stride, 3))
    rgb[1:-1, 1:-1] = pixels[..., :3]
    covered, inside, rgb = covered.ravel(), inside.ravel(), rgb.reshape(-1, 3)
    offsets = np.array([dy * stride + dx for dy, dx in _NEIGHBOURS])
    empty = np.flatnonzero(inside & ~covered)
    ring = empty[covered[empty[:, None] + offsets].any(axis=1)]
    while ring.size:
        near = ring[:, None] + offsets
        weight = covered[near]
        rgb[ring] = (rgb[near] * weight[..., None]).sum(axis=1) / weight.sum(axis=1, keepdims=True)
        covered[ring] = True
        ring = np.unique(near[inside[near] & ~covered[near]])
    out = np.empty_like(pixels)
    out[..., :3] = rgb.reshape(height + 2, stride, 3)[1:-1, 1:-1]
    out[..., 3] = covered.reshape(height + 2, stride)[1:-1, 1:-1]
    return out


def _bake(objs, pass_name, size, params):
    # RGBA: the bake writes alpha 1 where it covers and use_clear leaves alpha 0 elsewhere (measured).
    target = bpy.data.images.new(f'p99_bake_{pass_name}', size, size, alpha=True, float_buffer=True)
    target.colorspace_settings.name = 'Non-Color'  # set before the bake writes, never after
    for mat in _materials(objs):
        _pass_tree(mat, pass_name, target, params)
    scene.select_only(objs)
    bpy.ops.object.bake(type='EMIT', margin=0, use_clear=True)
    buffer = np.empty(size * size * 4, np.float32)
    target.pixels.foreach_get(buffer)
    bpy.data.images.remove(target)
    return _pad(buffer.reshape(size, size, 4)[::-1].astype(np.float64))  # row 0 at the top, as PNG expects


def final_material(name, albedo_path, emissive_path, emissive_strength, preview_path):
    mat = bpy.data.materials.new(name)
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Metallic'].default_value = 0.0
    albedo = nt.nodes.new('ShaderNodeTexImage')
    albedo.image = bpy.data.images.load(str(albedo_path))
    albedo.image.colorspace_settings.name = 'sRGB'
    nt.links.new(albedo.outputs['Color'], bsdf.inputs['Base Color'])
    if emissive_path is not None:
        emissive = nt.nodes.new('ShaderNodeTexImage')
        emissive.image = bpy.data.images.load(str(emissive_path))
        emissive.image.colorspace_settings.name = 'sRGB'
        nt.links.new(emissive.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = emissive_strength
    # Workbench previews show the active image node, which alone would hide every glow; left unlinked, the
    # preview stays out of the glTF export.
    preview = nt.nodes.new('ShaderNodeTexImage')
    preview.image = bpy.data.images.load(str(preview_path))
    preview.image.colorspace_settings.name = 'sRGB'
    nt.nodes.active = preview
    mat['p99_painted'] = True
    return mat


def paint(objs, *, name, out_dir, textures_dir, size=1024, style=None, ao_distance=0.4, ao_samples=32,
          brush_scale=1.0, emissive_strength=4.0):
    """Bakes, composites and assigns the painted material to every mesh in objs. Returns the material."""
    style = style or PaintStyle()
    objs = scene.meshes(objs)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    prepare_uvs(objs)
    write_height_attribute(objs)
    brush = bpy.data.images.load(str(Path(textures_dir) / 'brush_strokes.png'), check_existing=True)
    brush.colorspace_settings.name = 'Non-Color'
    params = {'ao_samples': ao_samples, 'ao_distance': ao_distance, 'brush_scale': brush_scale, 'brush_image': brush}
    baked = {pass_name: _bake(objs, pass_name, size, params) for pass_name in PASSES}
    albedo, emissive = composite(
        baked['region'][..., :3], baked['ao'][..., 0], baked['curv'][..., 0],
        baked['height'][..., 0], baked['brush'][..., 0], baked['emit'][..., :3], style,
    )
    albedo_path = out_dir / f'{name}_albedo.png'
    emissive_path = out_dir / f'{name}_emissive.png'
    preview_path = out_dir / f'{name}_preview.png'
    write_png(albedo_path, linear_to_srgb(albedo))
    write_png(emissive_path, linear_to_srgb(emissive))
    write_png(preview_path, linear_to_srgb(np.clip(albedo + emissive, 0.0, 1.0)))
    has_emissive = float(emissive.max()) > 0.01
    mat = final_material(f'{name}_paint', albedo_path, emissive_path if has_emissive else None, emissive_strength,
                         preview_path)
    for ob in objs:
        ob.data.materials.clear()
        ob.data.materials.append(mat)
        # Once baked, the height lives in the atlas; left on the mesh it exports as COLOR_0 and COLOR_1 (measured),
        # and a glTF loader multiplies COLOR_0 into the albedo. A mesh shared by two objects has lost it already.
        attr = ob.data.color_attributes.get('p99_height')
        if attr is not None:
            ob.data.color_attributes.remove(attr)
    return mat
