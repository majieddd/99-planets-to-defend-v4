"""Scene utilities shared by every recipe."""
import bpy
from mathutils import Vector


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    scn.render.fps = 30
    scn.frame_start = 1
    world = bpy.data.worlds.new('p99_world')
    world.color = (0.18, 0.20, 0.24)
    scn.world = world


def configure_cycles(samples=32):
    """Cycles on the GPU when OptiX or CUDA is present, otherwise the CPU. Returns the device kind."""
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    scn.cycles.samples = samples
    scn.cycles.use_denoising = False
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for kind in ('OPTIX', 'CUDA'):
            prefs.compute_device_type = kind
            prefs.refresh_devices()
            if any(device.type == kind for device in prefs.devices):
                for device in prefs.devices:
                    device.use = device.type == kind
                scn.cycles.device = 'GPU'
                print(f'CYCLES_DEVICE {kind}')
                return kind
    except Exception as exc:  # no GPU driver: the CPU bakes the same result, only slower
        print(f'CYCLES_DEVICE_ERR {exc}')
    scn.cycles.device = 'CPU'
    print('CYCLES_DEVICE CPU')
    return 'CPU'


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def select_only(objs):
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def apply_modifiers(ob):
    select_only([ob])
    for mod in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def apply_transforms(ob):
    select_only([ob])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def parent_keep(child, parent):
    """Parents without moving the child in world space."""
    # matrix_world refreshes only when Blender re-evaluates the scene, so a parent placed or moved since then would
    # hand over a stale matrix and the child would move by the difference.
    bpy.context.view_layer.update()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()


def join(objs, name):
    select_only(objs)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def descendants(ob):
    out = [ob]
    for child in ob.children:
        out.extend(descendants(child))
    return out


def meshes(objs):
    return [ob for ob in objs if ob.type == 'MESH']


def tri_count(objs):
    deps = bpy.context.evaluated_depsgraph_get()
    total = 0
    for ob in meshes(objs):
        evaluated = ob.evaluated_get(deps)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        total += len(mesh.loop_triangles)
        evaluated.to_mesh_clear()
    return total


def world_bounds(objs):
    """World-space bounds of the evaluated meshes, so posed armatures are measured as they render."""
    deps = bpy.context.evaluated_depsgraph_get()
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for ob in meshes(objs):
        evaluated = ob.evaluated_get(deps)
        mesh = evaluated.to_mesh()
        for vertex in mesh.vertices:
            w = evaluated.matrix_world @ vertex.co
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
        evaluated.to_mesh_clear()
    return lo, hi
