"""GLB export and Workbench previews."""
import json
import math
import struct
from contextlib import contextmanager
from pathlib import Path

import bpy
from mathutils import Vector

from . import anim, scene


def _morph_options(morphs):
    """The exporter's shape key options. Off, the default, every recipe exports exactly as it always has.

    On, the shape keys (a commander's face morphs) export as morph targets of positions only: morph normals and tangents
    stay off, because the runtime's hull ink pushes along its own averaged normals (src/render/ink/hull.ts), a blink
    bends a lid's normals too little to change the painted light, and each would add a delta per vertex to the file."""
    if not morphs:
        return {'export_morph': False}
    return {'export_morph': True, 'export_morph_normal': False, 'export_morph_tangent': False}


def _glb_json(path):
    data = Path(path).read_bytes()
    length = struct.unpack('<I', data[12:16])[0]
    return json.loads(data[20:20 + length])


def _check_morphs_shipped(objs, path):
    """Fails the export when a shape key the recipe made is missing from the GLB. Modifiers are applied on every export,
    and the exporter keeps shape keys through the armature modifier and deforming ones, but an applied modifier that
    changes the topology (triangulate, bevel, subdivision, measured in Blender 5.2.1) drops every key of its mesh without
    a word, which would ship a face that never blinks. Apply such modifiers before adding the shape keys."""
    shipped = {name for mesh in _glb_json(path).get('meshes', []) for name in mesh.get('extras', {}).get('targetNames', [])}
    for ob in objs:
        if ob.type != 'MESH' or ob.data.shape_keys is None:
            continue
        blocks = ob.data.shape_keys.key_blocks
        # The keys the exporter writes: not the basis, not muted, not relative to themselves (io_scene_gltf2 skip_sk).
        keys = [k.name for i, k in enumerate(blocks) if i > 0 and not k.mute and k.relative_key != k]
        missing = [name for name in keys if name not in shipped]
        if missing:
            topology = [f'{m.name} ({m.type})' for m in ob.modifiers if m.type != 'ARMATURE']
            raise RuntimeError(
                f"export_glb: {ob.name}'s shape keys {missing} are missing from {Path(path).name}; the exporter drops "
                f"a mesh's shape keys when it applies a modifier that changes the topology ({', '.join(topology) or 'none'}), "
                'so apply those before adding the shape keys')


def export_glb(objs, path, animations=False, morphs=False):
    """`morphs` exports the objects' shape keys as morph targets (see _morph_options); a recipe that names nothing
    exports without them, exactly as before the option existed."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    scene.select_only(objs)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_extras=True,
        export_animations=animations,
        export_animation_mode='ACTIONS',
        # Clip time 0 must be the action's first frame, so an exported strike lands at the sidecar's strike time
        # and a looping clip does not hold its first frame for one frame.
        export_anim_slide_to_zero=True,
        export_skins=True,
        export_lights=False,
        export_cameras=False,
        export_attributes=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_optimize_animation_size=True,
        export_def_bones=False,
        **_morph_options(morphs),
    )
    if morphs:
        _check_morphs_shipped(objs, path)
    return path


def _workbench(size):
    scn = bpy.context.scene
    scn.render.engine = 'BLENDER_WORKBENCH'
    scn.render.resolution_x = size
    scn.render.resolution_y = size
    scn.render.film_transparent = False
    # The default AgX view transform measurably dulls the painted atlas (about 14% chroma on foliage), and the
    # owner judges the look from these previews.
    scn.view_settings.view_transform = 'Standard'
    shading = scn.display.shading
    shading.light = 'STUDIO'
    shading.color_type = 'TEXTURE'
    # The runtime shader has no specular term; Workbench's studio sheen on smooth normals reads as plastic.
    shading.show_specular_highlight = False
    shading.show_object_outline = True
    shading.object_outline_color = (0.05, 0.05, 0.07)


def _camera():
    cam = bpy.data.objects.get('p99_preview_cam')
    if cam is None:
        cam = scene.link(bpy.data.objects.new('p99_preview_cam', bpy.data.cameras.new('p99_preview_cam')))
    cam.data.lens = 50
    bpy.context.scene.camera = cam
    return cam


def _aim(cam, target, distance, yaw, pitch):
    cam.location = (
        target.x + distance * math.cos(pitch) * math.sin(yaw),
        target.y - distance * math.cos(pitch) * math.cos(yaw),
        target.z + distance * math.sin(pitch),
    )
    cam.rotation_euler = (target - Vector(cam.location)).to_track_quat('-Z', 'Y').to_euler()


def _framing(objs):
    lo, hi = scene.world_bounds(objs)
    center = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.1)
    return center, radius


@contextmanager
def bind_pose(objs):
    """Shows the armature-driven meshes among `objs` in their bind pose, then restores each armature's setting.
    With the NLA on, the top track poses a rig at every frame (a strip holds its pose outside its range), so a
    rest view would otherwise show a pose from whichever action was made last."""
    arms = {m.object for ob in objs for m in ob.modifiers if m.type == 'ARMATURE' and m.object}
    previous = {arm: arm.data.pose_position for arm in arms}
    for arm in arms:
        arm.data.pose_position = 'REST'
    try:
        yield
    finally:
        for arm, position in previous.items():
            arm.data.pose_position = position


def render_views(objs, out_dir, prefix, views=4, size=512, pitch_deg=18.0):
    """Renders the objects from `views` yaw angles, starting at a front three-quarter view. Rigged meshes show
    their bind pose."""
    _workbench(size)
    cam = _camera()
    paths = []
    with bind_pose(objs):
        center, radius = _framing(objs)
        distance = radius / math.sin(cam.data.angle / 2) * 1.05
        for i in range(views):
            _aim(cam, center, distance, math.radians(-35 + i * 360 / views), math.radians(pitch_deg))
            path = Path(out_dir) / f'{prefix}_view{i}.png'
            bpy.context.scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            paths.append(path)
    return paths


def render_action(arm, objs, action, out_dir, prefix, frames=6, size=384):
    """A filmstrip: `frames` evenly spaced poses of one action from a front three-quarter view."""
    restore = anim.play(arm, action)
    _workbench(size)
    cam = _camera()
    center, radius = _framing(objs)
    distance = radius * 1.35 / math.sin(cam.data.angle / 2)
    start, end = action.frame_range
    paths = []
    for k in range(frames):
        frame = start + (end - start) * k / max(frames - 1, 1)
        bpy.context.scene.frame_set(int(round(frame)))
        _aim(cam, center, distance, math.radians(-35), math.radians(12))
        path = Path(out_dir) / f'{prefix}_{action.name}_{k}.png'
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    restore()
    bpy.context.scene.frame_set(1)
    return paths
