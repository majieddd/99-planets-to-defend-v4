"""Armatures and rigid binding. Armour and chitin are rigid, so each part binds fully to one bone: no
weight painting, no twisting artefacts, and silhouettes hold in every pose.

Bones are listed for the left side and the centre; right-side bones are mirrored across X. Roll is
computed with calculate_roll, which aligns each bone's Z axis; the axis conventions this produces are
measured and recorded in anim.py."""
import bpy

from . import ink, scene

HUMANOID_LEFT = [
    ('root', (0, 0, 0), (0, 0, 0.3), None),
    ('hips', (0, 0, 1.06), (0, 0, 1.16), 'root'),
    ('spine', (0, 0, 1.16), (0, 0, 1.35), 'hips'),
    ('chest', (0, 0, 1.35), (0, 0, 1.58), 'spine'),
    ('neck', (0, 0, 1.58), (0, 0, 1.67), 'chest'),
    ('head', (0, 0, 1.67), (0, 0, 1.93), 'neck'),
    ('shoulder.L', (0.06, 0, 1.53), (0.22, 0, 1.53), 'chest'),
    ('upper_arm.L', (0.25, 0, 1.51), (0.31, 0.01, 1.22), 'shoulder.L'),
    ('forearm.L', (0.31, 0.01, 1.22), (0.35, -0.03, 0.97), 'upper_arm.L'),
    ('hand.L', (0.35, -0.03, 0.97), (0.36, -0.05, 0.85), 'forearm.L'),
    ('socket.L', (0.37, -0.06, 1.08), (0.37, -0.20, 1.08), 'forearm.L'),  # shield mount on the forearm
    ('thigh.L', (0.12, 0, 1.06), (0.13, 0, 0.58), 'hips'),
    ('shin.L', (0.13, 0, 0.58), (0.13, 0.03, 0.10), 'thigh.L'),
    ('foot.L', (0.13, 0.03, 0.10), (0.13, -0.15, 0.03), 'shin.L'),
]

# socket.R sits in the right hand at the sword grip; replace the mirrored one after mirroring.
HUMANOID_SOCKET_R = ('socket.R', (-0.36, -0.05, 0.90), (-0.36, -0.20, 0.90), 'hand.R')

CREATURE_LEFT = [
    ('root', (0, 0, 0), (0, 0, 0.3), None),
    ('body', (0, 0.15, 0.75), (0, -0.25, 0.80), 'root'),
    ('thorax', (0, -0.25, 0.80), (0, -0.60, 0.85), 'body'),
    ('head', (0, -0.60, 0.85), (0, -0.85, 0.78), 'thorax'),
    ('carapace', (0, 0.25, 1.05), (0, -0.35, 1.15), 'body'),
    ('claw_upper.L', (0.28, -0.55, 0.85), (0.40, -0.85, 1.05), 'thorax'),
    ('claw_lower.L', (0.40, -0.85, 1.05), (0.42, -1.15, 0.70), 'claw_upper.L'),
    ('leg_front_upper.L', (0.30, -0.35, 0.70), (0.55, -0.50, 0.45), 'thorax'),
    ('leg_front_lower.L', (0.55, -0.50, 0.45), (0.60, -0.55, 0.0), 'leg_front_upper.L'),
    ('leg_back_upper.L', (0.30, 0.20, 0.70), (0.58, 0.40, 0.45), 'body'),
    ('leg_back_lower.L', (0.58, 0.40, 0.45), (0.64, 0.48, 0.0), 'leg_back_upper.L'),
]


def mirror_name(name):
    if name.endswith('.L'):
        return name[:-2] + '.R'
    if name.endswith('.R'):
        return name[:-2] + '.L'
    return name


def with_mirrors(bones):
    out = list(bones)
    for name, head, tail, parent in bones:
        if name.endswith('.L'):
            out.append((mirror_name(name), (-head[0], head[1], head[2]), (-tail[0], tail[1], tail[2]), mirror_name(parent) if parent else None))
    return out


def _roll(arm_data, names, kind):
    for eb in arm_data.edit_bones:
        eb.select = eb.select_head = eb.select_tail = eb.name in names
    bpy.ops.armature.calculate_roll(type=kind)


def build_armature(name, bones, roll, roll_overrides=None):
    arm_data = bpy.data.armatures.new(name)
    arm = scene.link(bpy.data.objects.new(name, arm_data))
    scene.select_only([arm])
    bpy.ops.object.mode_set(mode='EDIT')
    for bone_name, head, tail, _parent in bones:
        eb = arm_data.edit_bones.new(bone_name)
        eb.head = head
        eb.tail = tail
    for bone_name, _head, _tail, parent in bones:
        if parent:
            arm_data.edit_bones[bone_name].parent = arm_data.edit_bones[parent]
    _roll(arm_data, [b[0] for b in bones], roll)
    for kind, names in (roll_overrides or {}).items():
        _roll(arm_data, names, kind)
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'
    return arm


def humanoid(name='rig'):
    bones = [b for b in with_mirrors(HUMANOID_LEFT) if b[0] != 'socket.R'] + [HUMANOID_SOCKET_R]
    # Shoulder bones lie along X, where aligning Z to +X is degenerate, so they align Z to up instead.
    return build_armature(name, bones, 'GLOBAL_POS_X', {'GLOBAL_POS_Z': ['shoulder.L', 'shoulder.R']})


def creature(name='rig'):
    return build_armature(name, with_mirrors(CREATURE_LEFT), 'GLOBAL_POS_Z')


def bone_head(arm, name):
    return arm.matrix_world @ arm.data.bones[name].head_local


def bone_tail(arm, name):
    return arm.matrix_world @ arm.data.bones[name].tail_local


def bind_rigid(arm, parts, name):
    """parts: list of (object, bone). Applies each part's transform, gives it one full-weight vertex group,
    joins the parts into one mesh and adds the armature modifier."""
    for ob, bone in parts:
        if bone not in arm.data.bones:
            raise KeyError(f'bind_rigid: armature has no bone {bone}')
        scene.apply_transforms(ob)
        ink.ensure_ink(ob, 1.0)
        group = ob.vertex_groups.new(name=bone)
        group.add([v.index for v in ob.data.vertices], 1.0, 'REPLACE')
    mesh = scene.join([p[0] for p in parts], name)
    mod = mesh.modifiers.new('armature', 'ARMATURE')
    mod.object = arm
    mesh.parent = arm
    return mesh
