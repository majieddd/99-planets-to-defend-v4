"""GLB export and Workbench previews."""
import math
from contextlib import contextmanager
from pathlib import Path

import bpy
from mathutils import Vector

from . import anim, scene


def export_glb(objs, path, animations=False):
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
        export_morph=False,
        export_lights=False,
        export_cameras=False,
        export_attributes=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_optimize_animation_size=True,
        export_def_bones=False,
    )
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
