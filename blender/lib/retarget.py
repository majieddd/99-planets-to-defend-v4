"""Quaternius Universal Animation Library clips (CC0) on a Mixamo-named commander rig.

The library's mannequin (UE-style names: pelvis, spine_01, upperarm_r, ...) rests in a T-pose with the palms down, as
a Mixamo rig does, so each mapped bone takes the source bone's rotation away from its rest, in world space, on top of
its own rest: R_target(t) = R_source(t) R_source_rest^-1 R_target_rest. Bone rolls and local axes never enter, so arcs
and wrist angles come over as authored (the blade's peak speeds land within 4% of the source's).

Root motion (the _RM files move the root bone on every step) leaves the clips: the travel is the pelvis's ground point,
recorded per frame as metres forward and to the side for the game to apply, and the clip's hips keep only their
vertical bob. The feet are placed by two-bone IK where the source plants them relative to that point, scaled by the
ratio of hip heights, so they hold once the travel is applied; a gliding step is lifted into an arc, and a boot is
stood on the ground on the evaluated mesh.

The sword is held as the library's fist holds it (regrip_sword: the handle along the curled fingers' tunnel, the blade
out of the top of the fist about 104 degrees from the forearm, its edge on the knuckle line), and in the cut the hand
rolls about the blade so the edge leads (edge_rolls). Contacts this commander's proportions bring (a 1 m shield, a big
head and shoulder domes) are cleared per clip (clean_clip). Fingers are not mapped: the commander wears mittens."""
import math

import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import charforge as cf

P = cf.P
MAP = {
    'pelvis': 'Hips', 'spine_01': 'Spine', 'spine_02': 'Spine1', 'spine_03': 'Spine2', 'neck_01': 'Neck', 'Head': 'Head',
    'clavicle_l': 'LeftShoulder', 'upperarm_l': 'LeftArm', 'lowerarm_l': 'LeftForeArm', 'hand_l': 'LeftHand',
    'clavicle_r': 'RightShoulder', 'upperarm_r': 'RightArm', 'lowerarm_r': 'RightForeArm', 'hand_r': 'RightHand',
    'thigh_l': 'LeftUpLeg', 'calf_l': 'LeftLeg', 'foot_l': 'LeftFoot', 'ball_l': 'LeftToeBase',
    'thigh_r': 'RightUpLeg', 'calf_r': 'RightLeg', 'foot_r': 'RightFoot', 'ball_r': 'RightToeBase',
}
ORDER = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
         'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r']
LEGS = {'l': ('thigh_l', 'calf_l', 'foot_l', 'ball_l'), 'r': ('thigh_r', 'calf_r', 'foot_r', 'ball_r')}


def import_library(path):
    """Imports a library GLB and keeps only its armature and actions (the mannequin mesh and the importer's stray
    icosphere are deleted). Returns the armature and the actions by name."""
    before, before_actions = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=str(path))
    new = [o for o in bpy.data.objects if o not in before]
    src = next(o for o in new if o.type == 'ARMATURE')
    for o in new:
        if o is not src:
            bpy.data.objects.remove(o)
    src.animation_data_create()
    actions = {a.name: a for a in bpy.data.actions if a not in before_actions}
    for a in actions.values():
        a.use_fake_user = True
    return src, actions


def drop_library(src, actions):
    """Removes the library armature and every library action, so the exporter's ACTIONS mode cannot pick them up."""
    for a in actions.values():
        if a.name in bpy.data.actions:
            bpy.data.actions.remove(a)
    bpy.data.objects.remove(src)


def _play(arm, action, frame):
    ad = arm.animation_data
    ad.use_nla = False
    ad.action = action
    try:
        if ad.action_slot is None and len(action.slots):
            ad.action_slot = action.slots[0]
    except AttributeError:
        pass
    bpy.context.scene.frame_set(int(frame))


def _play_at(arm, action, frame):
    """Like _play, at a fractional frame (the shield arm's time warp samples between source frames)."""
    _play(arm, action, int(frame))
    bpy.context.scene.frame_set(int(frame), subframe=float(frame) - int(frame))


def _world(arm, name, posed=True):
    if posed:
        return arm.matrix_world @ arm.pose.bones[name].matrix
    return arm.matrix_world @ arm.data.bones[name].matrix_local


def grip_axis(src, action):
    """The axis of the handle the source's right fist closes on, carried to the rest pose: a line fitted through the
    curled fingers' middle and end joints in a sword clip, pointing from the pinky to the index (where the blade
    leaves the fist). The library animates the fingers as one fixed fist through every sword clip, so one frame
    gives it; at rest it points forward along the palm-down arm, about 14 degrees outward."""
    _play(src, action, action.frame_range[0])
    hand = _world(src, 'hand_r')
    inv = hand.to_3x3().normalized().inverted()
    pts = np.array([np.array(inv @ (_world(src, f'{fn}_0{k}_r').translation - hand.translation))
                    for fn in ('index', 'middle', 'ring', 'pinky') for k in (2, 3)])
    u = np.linalg.svd(pts - pts.mean(0))[2][0]
    tip = np.array(inv @ (_world(src, 'index_02_r').translation - _world(src, 'pinky_02_r').translation))
    if np.dot(u, tip) < 0:
        u = -u
    src.animation_data.action = None
    return (_world(src, 'hand_r', False).to_3x3().normalized() @ Vector(u)).normalized()


def grip_offset(grip, blade_rest):
    """The turn at rest (world axes) that takes the commander's blade axis onto the library's grip axis, for
    retarget's hand_offset: the hand then carries the sword along the source's blade path while the mesh keeps the
    sword's approved angle in the fist, so the idle, the run and the authored clips are unchanged."""
    return Vector(blade_rest).rotation_difference(grip).to_matrix()


def mitten_pivot(arm, armour):
    """The right mitten's centre at rest (armature space): the right hand's vertices that are not the sword's."""
    part = np.empty(len(armour.data.polygons), np.int32)
    armour.data.attributes['cf_part'].data.foreach_get('value', part)
    polys = armour.data.polygons
    sword = {v for i in np.flatnonzero((part == 1) | (part == 3)) for v in polys[i].vertices}
    gid = armour.vertex_groups[P + 'RightHand'].index
    hand = {v.index for v in armour.data.vertices if any(g.group == gid and g.weight > 0.5 for g in v.groups)}
    co = cf.co_of(armour.data)
    return Vector(co[sorted(hand - sword)].mean(0))


def _forearm_angle(arm, axis):
    """The angle between the blade and the forearm as a swordsman measures it: from the wrist back to the elbow, to the
    blade (90 is a blade square to the arm, 180 a blade that carries straight on from it)."""
    back = arm.data.bones[P + 'RightForeArm'].head_local - arm.data.bones[P + 'RightHand'].head_local
    return round(math.degrees(back.angle(Vector(axis))), 1)


def regrip_sword(arm, armour, grip, blade_rest, gap=0.005):
    """The natural grip, taken from the library's fist: turns the sword's vertices (cf_part 1 and 3) about the right
    mitten's centre so the blade, which points along blade_rest at rest, leaves the fist along the source grip axis
    (pinky to index, out of the top of the fist), then slides it along that axis, never inward, until the cross-guard
    sits `gap` above the mitten, so the fist closes just under the guard. The turn is the shortest one, and it also
    carries the blade's edge line onto the fist's knuckle line and its flats onto the palm (measured: both edges and
    the knuckles on one line), so the edge leads where the knuckles do. The mitten stays as it was.

    Pip's CharForge sword left the fist 141 degrees from the forearm (wrist to elbow), nearly carrying the arm's line
    on like a dagger, which made every retargeted swing pivot about the wrist the wrong way; the library's fist holds
    its handle at 105, inside the 90 to 110 a swordsman's neutral wrist gives. Returns the turn, the slide and both
    angles. Corner normals, where the mesh has custom ones, turn with the vertices."""
    part = _part_of(armour)
    polys = armour.data.polygons
    sword = np.unique([v for i in np.flatnonzero((part == 1) | (part == 3)) for v in polys[i].vertices])
    hilt = np.unique([v for i in np.flatnonzero(part == 1) for v in polys[i].vertices])
    gid = armour.vertex_groups[P + 'RightHand'].index
    hand = {v.index for v in armour.data.vertices if any(g.group == gid and g.weight > 0.5 for g in v.groups)}
    mitten = np.array(sorted(hand - set(sword.tolist())))
    me = armour.data
    custom = me.has_custom_normals
    corner = np.array([n.vector[:] for n in me.corner_normals]) if custom else None
    co = cf.co_of(me)
    pivot = Vector(co[mitten].mean(0))
    rot = Vector(blade_rest).rotation_difference(grip).to_matrix()
    r = np.array(rot)
    new = co.copy()
    new[sword] = (co[sword] - np.array(pivot)) @ r.T + np.array(pivot)
    g = np.array(grip) / np.linalg.norm(np.array(grip))
    along = (new - np.array(pivot)) @ g
    radial = np.linalg.norm((new[hilt] - np.array(pivot)) - np.outer(along[hilt], g), axis=1)
    guard = hilt[(radial > 0.6 * radial.max()) & (along[hilt] > 0.0)]
    slide = max(0.0, float(along[mitten].max()) + gap - float(along[guard].min())) if len(guard) else 0.0
    new[sword] += g * slide
    me.vertices.foreach_set('co', new.ravel())
    me.update()
    if custom:
        loops = np.empty(len(me.loops), np.int32)
        me.loops.foreach_get('vertex_index', loops)
        moved = np.isin(loops, sword)
        corner[moved] = corner[moved] @ r.T
        me.normals_split_custom_set([tuple(n) for n in corner])
        me.update()
    return dict(turn_deg=round(math.degrees(Vector(blade_rest).angle(grip)), 1), slide_m=round(slide, 4),
                forearm_deg_before=_forearm_angle(arm, blade_rest), forearm_deg_after=_forearm_angle(arm, grip))


def clear_carry(arm, body, armour, action, prefer_deg=0.0, step_deg=10.0, most_deg=40.0):
    """For a clip made elsewhere (the CharForge idle and run), a constant turn of the right hand that keeps the
    regripped sword out of the body and the shield: about the axis square to the blade and the forearm at rest, so the
    blade only leans toward the forearm's line (positive) or away from it. `prefer_deg` is tried first, then turns
    `step_deg` apart either side of it up to `most_deg` away. The natural grip held the blade upright in the run's high
    fist, through the head on four frames (310 overlaps), and 20 degrees cleared it but still carried the sword like a
    salute in front of his face; leaning it by the regrip's own turn gives back the run's approved carry, the blade
    forward. Returns the turn in degrees and the checks after it; stops the build when no turn clears."""
    from mathutils import Quaternion
    bone = P + 'RightHand'
    path = f'pose.bones["{bone}"].rotation_quaternion'
    curves = [None] * 4
    for fcs in cf._channelbags(action):
        for fc in fcs:
            if fc.data_path == path:
                curves[fc.array_index] = fc
    if any(fc is None for fc in curves):
        raise ValueError(f'clear_carry: {action.name} does not key all four rotation channels of {bone}')
    original = [Quaternion([fc.keyframe_points[k].co[1] for fc in curves]) for k in range(len(curves[0].keyframe_points))]
    _width, axis, _sweet = blade_frame(arm, armour)
    fore = (arm.data.bones[bone].head_local - arm.data.bones[P + 'RightForeArm'].head_local).normalized()
    local = (arm.data.bones[bone].matrix_local.to_3x3().inverted() @ axis.cross(fore)).normalized()

    def measure(deg):
        turn = Quaternion(local, math.radians(deg))
        for k, q in enumerate(original):
            turned = q @ turn
            for i, fc in enumerate(curves):
                kp = fc.keyframe_points[k]
                d = turned[i] - kp.co[1]
                kp.co[1] += d
                kp.handle_left[1] += d
                kp.handle_right[1] += d
        for fc in curves:
            fc.update()
        data = arm.animation_data
        data.use_nla, data.action = False, action
        if getattr(data, 'action_slot', True) is None and len(getattr(action, 'slots', ())):
            data.action_slot = action.slots[0]
        return cf.attack_checks(arm, body, armour, action, 1)

    tries = [prefer_deg] + [prefer_deg + s * step_deg * k for k in range(1, int(most_deg / step_deg) + 1) for s in (1, -1)]
    data = arm.animation_data
    saved = (data.use_nla, data.action)
    try:
        for deg in tries:
            checks = measure(deg)
            if checks['blade_body_overlaps'] == 0 and checks['sword_shield_overlaps'] == 0:
                return deg, checks
    finally:
        data.use_nla, data.action = saved
    raise ValueError(f'clear_carry: no turn of the hand within {most_deg} degrees of {prefer_deg} keeps the sword out of the body in {action.name}')


def _reach(arm, upper, lower, target):
    """Two bones (upper and lower) aimed so the lower one's tail lands on `target`, the middle joint kept in the
    plane the pose already bends it in."""
    up, lo = arm.pose.bones[upper], arm.pose.bones[lower]
    rest = arm.data.bones
    l1 = (rest[lower].head_local - rest[upper].head_local).length
    l2 = (rest[lower].tail_local - rest[lower].head_local).length
    root, mid_fk = up.head.copy(), lo.head.copy()
    d = target - root
    dist = min(max(d.length, 1e-4), l1 + l2 - 1e-5)
    u = d.normalized()
    a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
    h = math.sqrt(max(l1 * l1 - a * a, 0.0))
    pole = (mid_fk - root) - u * (mid_fk - root).dot(u)
    if pole.length < 1e-6:
        return
    mid = root + u * a + pole.normalized() * h
    for pb, aim in ((up, mid), (lo, root + u * dist)):
        hd = pb.head.copy()
        rot = (pb.tail - hd).rotation_difference(aim - hd).to_matrix().to_4x4()
        pb.matrix = Matrix.Translation(hd) @ rot @ Matrix.Translation(-hd) @ pb.matrix
        bpy.context.view_layer.update()


def _solve_leg(arm, side, ankle, foot_rot, toe_rot):
    """Thigh and shin as a two-bone chain onto `ankle`, the knee kept in the plane the forward pose put it in, then the
    foot and toe at their target world rotations."""
    up, lo, ft, toe = (arm.pose.bones[f'{P}{side}{n}'] for n in ('UpLeg', 'Leg', 'Foot', 'ToeBase'))
    rest = arm.data.bones
    hip, knee_fk = up.head.copy(), lo.head.copy()
    l1 = (rest[lo.name].head_local - rest[up.name].head_local).length
    l2 = (rest[ft.name].head_local - rest[lo.name].head_local).length
    d = ankle - hip
    dist = min(max(d.length, 1e-4), l1 + l2 - 1e-5)
    u = d.normalized()
    a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
    h = math.sqrt(max(l1 * l1 - a * a, 0.0))
    pole = (knee_fk - hip) - u * (knee_fk - hip).dot(u)
    if pole.length < 1e-6:
        pole = Vector((0.0, -1.0, 0.0)) - u * u.y * -1.0
    knee = hip + u * a + pole.normalized() * h
    for pb, target in ((up, knee), (lo, ankle)):
        hd = pb.head.copy()
        rot = (pb.tail - hd).rotation_difference(target - hd).to_matrix().to_4x4()
        pb.matrix = Matrix.Translation(hd) @ rot @ Matrix.Translation(-hd) @ pb.matrix
        bpy.context.view_layer.update()
    for pb, r in ((ft, foot_rot), (toe, toe_rot)):
        pb.matrix = Matrix.Translation(pb.head) @ r.to_4x4()
        bpy.context.view_layer.update()


def boot_points(arm, armour):
    """Each boot's vertices (rest pose, armature space) by its foot or toe bone, for keeping the soles out of the
    ground."""
    out = {}
    co = cf.co_of(armour.data)
    for side in ('Left', 'Right'):
        for part in ('Foot', 'ToeBase'):
            name = f'{P}{side}{part}'
            if name not in armour.vertex_groups:
                continue
            gi = armour.vertex_groups[name].index
            ids = [v.index for v in armour.data.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups)]
            if ids:
                out[name] = co[ids]
    return out


def boot_masks(armour):
    """Each boot's vertices (indices into the armour) by side: weighted more than half to the foot and toe bones, as
    the ground pass reads a boot, and given to the side whose bones carry more of the weight."""
    names = {g.index: g.name for g in armour.vertex_groups}
    out = {'Left': [], 'Right': []}
    for v in armour.data.vertices:
        w = {'Left': 0.0, 'Right': 0.0}
        for g in v.groups:
            n = names[g.group]
            for side in w:
                if n in (f'{P}{side}Foot', f'{P}{side}ToeBase'):
                    w[side] += g.weight
        if w['Left'] + w['Right'] > 0.5:
            out['Left' if w['Left'] >= w['Right'] else 'Right'].append(v.index)
    return {side: np.array(ids) for side, ids in out.items()}


def _lowest(arm, boots, side):
    low = 1e9
    for name, pts in boots.items():
        if side not in name:
            continue
        m = np.array(cf.deform(arm, name))
        z = pts @ m[2, :3] + m[2, 3]
        low = min(low, float(z.min()))
    return low


SHIELD_ARM = ('upperarm_l', 'lowerarm_l', 'hand_l')


def _step_lifts(src, action, frames, k, speed=0.012):
    """Per foot, how far to raise the ankle on each frame so a stepping foot leaves the ground. The library's lunges
    glide the stepping foot along the floor (Sword_Regular_A's right foot travels 1.09 m in five frames at zero
    height), which reads as a slide; each run of frames where a foot moves faster than `speed` metres a frame becomes
    an arc peaking at a fifth of the step's length (2 to 7 cm), faded out where the source already lifts the foot
    clear (fully at 10 cm, so the spin's leap keeps its own arc). The clearance is the lower of the ankle's and the
    ball's rise: judged by the ankle alone, the toe-down drags (heel up, toe on the floor) kept sliding 12 cm a frame. Runs of a single frame (shuffles) stay
    on the ground."""
    root_rest = _world(src, 'root', False)
    rest_h = {(side, b): (root_rest.inverted() @ _world(src, LEGS[side][b], False)).translation.z for side in LEGS for b in (2, 3)}
    pos = {side: [] for side in LEGS}
    for f in frames:
        _play(src, action, f)
        rz = _world(src, 'root').translation.z
        for side in LEGS:
            q = _world(src, LEGS[side][2]).translation
            ball = _world(src, LEGS[side][3]).translation
            rise = min(q.z - rz - rest_h[(side, 2)], ball.z - rz - rest_h[(side, 3)])
            pos[side].append((q.x * k, q.y * k, rise * k))
    out = {}
    for side, seq in pos.items():
        a = np.array(seq)
        n = len(a)
        lift = np.zeros(n)
        moving = np.zeros(n, bool)
        moving[1:] = np.linalg.norm(np.diff(a[:, :2], axis=0), axis=1) > speed
        i = 1
        while i < n:
            if not moving[i]:
                i += 1
                continue
            j = i
            while j + 1 < n and moving[j + 1]:
                j += 1
            s0, s1 = i - 1, j
            h = min(max(0.2 * float(np.linalg.norm(a[s1, :2] - a[s0, :2])), 0.02), 0.07)
            for m in range(s0, s1 + 1):
                u = (m - s0) / max(s1 - s0, 1)
                fade = min(max(1.0 - float(a[m, 2]) / 0.10, 0.0), 1.0)
                lift[m] = max(lift[m], h * 4.0 * u * (1.0 - u) * fade)
            i = j + 1
        out[side] = np.maximum(lift, 0.0)
    return out


def retarget(src, action, arm, frames=None, adjust=None, boots=None, lead=None, shield_pose=None, hand_offset=None,
             grip_pivot=None, ground_mesh=None, edge_roll=None):
    """The clip's poses on the commander rig, one per source frame, plus its travel. Returns (keys, root) with keys
    [(frame, pose)] ready for charforge.make_action_quat (frame 1 is the source's first frame) and root a list of
    (seconds, forward, side): metres along the commander's facing and to his right, cumulative from the first frame.

    The travel is the pelvis's ground point, not the library's root bone: the clip then carries no horizontal hips
    translation at all (only the vertical bob), as the renderer's mixer requires, and the feet are placed relative to
    that same point, so they land where the source plants them once the game applies the travel. Both scale by the
    ratio of hip heights; unscaled, a foot the source plants slid by the difference. adjust(i, arm), when given, runs
    on each frame's finished pose (the clean-up's hook). lead, when given, is per frame how many source frames ahead
    the shield arm is sampled (the clean-up's time warp). shield_pose, when given as (action, frame, weights), holds
    the shield arm at that clip's pose relative to the chest, blended in by the per-frame weights (the block keeps
    the guard's raised shield while the sword parries). hand_offset, when given (a rotation at rest, in world axes),
    turns the right hand by it on top of the source's, so a sword held at another angle than the library's grip follows
    the source's blade instead of its fist (grip_offset). With grip_pivot (the mitten's centre at rest) the arm also
    reaches so the turn is about the mitten rather than the wrist, which puts the sword exactly where turning it in the
    fist (regrip_sword) would: turned about the wrist, the grip moved 4 to 5 cm and the spin slash's blade, swept
    through new places, crossed the shield and the body where the regripped one cleared both. edge_roll, when given as
    (angles, point, axis) with the blade's line at rest, rolls the hand about that line by each frame's angle, the
    wrist moving with it, so the blade keeps its path and only turns its edge (edge_rolls)."""
    rest_s = {s: _world(src, s, False).to_3x3().normalized() for s in ORDER}
    rest_t = {s: (arm.matrix_world @ arm.data.bones[P + t].matrix_local).to_3x3().normalized() for s, t in MAP.items()}
    root_rest = _world(src, 'root', False)
    pelvis_rest = (root_rest.inverted() @ _world(src, 'pelvis', False)).translation
    hips_rest = arm.matrix_world @ arm.data.bones[P + 'Hips'].head_local
    k = hips_rest.z / max(pelvis_rest.z, 1e-6)
    ground_rest = Vector((pelvis_rest.x, pelvis_rest.y, 0.0))
    feet_rest_s = {side: (root_rest.inverted() @ _world(src, LEGS[side][2], False)).translation - ground_rest for side in LEGS}
    feet_rest_t = {side: arm.matrix_world @ arm.data.bones[P + MAP[LEGS[side][2]]].head_local for side in LEGS}
    wrist_rest = arm.matrix_world @ arm.data.bones[P + 'RightHand'].head_local
    hand_turn = None
    start, end = action.frame_range
    frames = frames or list(range(int(start), int(end) + 1))
    keys, root = [], []
    root0 = None
    ground0 = None
    ad = arm.animation_data
    saved = (ad.use_nla, ad.action) if ad else None
    if ad:
        ad.use_nla, ad.action = False, None
    arm.data.pose_position = 'POSE'
    lifts = _step_lifts(src, action, frames, k)
    hold = None
    if shield_pose is not None:
        act2, f2, hold_w = shield_pose
        _play(src, act2, f2)
        chest2 = _world(src, 'spine_03').to_3x3().normalized()
        hold = {s: chest2.inverted() @ _world(src, s).to_3x3().normalized() for s in ('clavicle_l',) + SHIELD_ARM}
    for i, f in enumerate(frames):
        _play(src, action, f)
        rm = _world(src, 'root')
        if root0 is None:
            root0 = rm.copy()
        inv = rm.to_3x3().normalized().inverted()
        target = {}
        for s in ORDER:
            r_src = inv @ _world(src, s).to_3x3().normalized()
            if s == 'hand_r' and hand_offset is not None:
                hand_turn = r_src @ rest_s[s].inverted()
                target[s] = hand_turn @ hand_offset @ rest_t[s]
            else:
                target[s] = r_src @ rest_s[s].inverted() @ rest_t[s]
        pelvis_w = _world(src, 'pelvis').translation
        ground = Vector((pelvis_w.x, pelvis_w.y, rm.translation.z))
        if ground0 is None:
            ground0 = ground.copy()
        bob = pelvis_w.z - rm.translation.z - pelvis_rest.z
        feet = {side: inv @ (_world(src, LEGS[side][2]).translation - ground) for side in LEGS}
        if hold is not None and hold_w[i] > 0:
            chest = _world(src, 'spine_03').to_3x3().normalized()
            for s, rel in hold.items():
                want = inv @ chest @ rel @ rest_s[s].inverted() @ rest_t[s]
                target[s] = target[s].to_quaternion().slerp(want.to_quaternion(), float(hold_w[i])).to_matrix()
        if lead is not None and lead[i] > 1e-3:
            # The shield arm runs ahead of the body on the source's own motion: it reaches its next pose early and
            # holds, which reads as the guard opening for the swing, where pushing it off the blade's path did not.
            _play_at(src, action, min(f + float(lead[i]), end))
            inv_g = _world(src, 'root').to_3x3().normalized().inverted()
            for s in SHIELD_ARM:
                target[s] = inv_g @ _world(src, s).to_3x3().normalized() @ rest_s[s].inverted() @ rest_t[s]
            _play(src, action, f)
        for pb in arm.pose.bones:
            pb.matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()
        for s in ORDER:
            pb = arm.pose.bones[P + MAP[s]]
            head = hips_rest + Vector((0.0, 0.0, bob * k)) if s == 'pelvis' else pb.head.copy()
            pb.matrix = Matrix.Translation(head) @ target[s].to_4x4()
            bpy.context.view_layer.update()
        if hand_offset is not None and grip_pivot is not None:
            # w' = w + M (I - Q)(pivot - wrist_rest): the wrist that, with the hand turned by Q, puts every sword point
            # where the unturned hand would carry the sword turned by Q about the pivot
            hb = arm.pose.bones[P + 'RightHand']
            v = grip_pivot - wrist_rest
            _reach(arm, P + 'RightArm', P + 'RightForeArm', hb.head + hand_turn @ (v - hand_offset @ v))
            hb.matrix = Matrix.Translation(hb.head) @ target['hand_r'].to_4x4()
            bpy.context.view_layer.update()
        if edge_roll is not None and abs(float(edge_roll[0][i])) > 1e-4:
            hb = arm.pose.bones[P + 'RightHand']
            m = Matrix(cf.deform(arm, P + 'RightHand'))
            point, axis = m @ edge_roll[1], (m.to_3x3() @ edge_roll[2]).normalized()
            turn = Matrix.Rotation(float(edge_roll[0][i]), 3, axis)
            hand_rot = hb.matrix.to_3x3().normalized()
            _reach(arm, P + 'RightArm', P + 'RightForeArm', point + turn @ (hb.head - point))
            hb.matrix = Matrix.Translation(hb.head) @ (turn @ hand_rot).to_4x4()
            bpy.context.view_layer.update()
        ankles, raised = {}, {}
        for side, name in (('l', 'Left'), ('r', 'Right')):
            ankle = feet_rest_t[side] + (feet[side] - feet_rest_s[side]) * k + Vector((0.0, 0.0, float(lifts[side][i])))
            _solve_leg(arm, name, ankle, target[LEGS[side][2]], target[LEGS[side][3]])
            raised[name] = False
            if boots:
                # The boots are bigger than the mannequin's feet, so a toe or heel the source tips down went up to
                # 5.5 cm into the ground: the ankle rises until the boot's lowest point is on it.
                low = _lowest(arm, boots, name)
                if low < 0.0:
                    ankle = ankle + Vector((0.0, 0.0, -low))
                    raised[name] = True
                    _solve_leg(arm, name, ankle, target[LEGS[side][2]], target[LEGS[side][3]])
            ankles[name] = (ankle, side)
        if ground_mesh is not None:
            # The rigid estimate above reads each boot vertex as riding its foot or toe alone; the skinned boot blends
            # in the shin, and stood up to 3.8 mm under the ground. Measured on the evaluated mesh, a boot under the
            # ground rises onto it, and one the estimate raised is set exactly on it.
            ob, masks = ground_mesh
            for _ in range(3):
                co = cf._evaluated_co(ob)
                moved = False
                for name, (ankle, side) in list(ankles.items()):
                    low = float(co[masks[name], 2].min())
                    if low < -2e-5 or (raised[name] and abs(low) > 2e-5):
                        ankle = ankle + Vector((0.0, 0.0, -low))
                        ankles[name] = (ankle, side)
                        _solve_leg(arm, name, ankle, target[LEGS[side][2]], target[LEGS[side][3]])
                        moved = True
                if not moved:
                    break
        if adjust is not None:
            adjust(i, arm)
        pose = {pb.name: pb.matrix_basis.to_quaternion() for pb in arm.pose.bones}
        hb = arm.pose.bones[P + 'Hips']
        pose[f'{hb.name}@loc'] = hb.matrix_basis.translation.copy()
        keys.append((1.0 + i, pose))
        d = root0.to_3x3().normalized().inverted() @ (ground - ground0) * k
        root.append((round(i / 30.0, 4), round(-d.y, 4), round(-d.x, 4)))
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    if ad:
        ad.use_nla, ad.action = saved
    bpy.context.view_layer.update()
    return keys, root


def root_motion_notes(root):
    """The renderer's root-motion record for one clip: times in seconds from 0, and forward and side metres
    (side positive to the commander's right), cumulative from 0."""
    return dict(times=[r[0] for r in root], forward=[r[1] for r in root], side=[r[2] for r in root])


def travel_offset(r):
    """A root sample (seconds, forward, side) as a Blender offset of the rig object, for previews."""
    return Vector((-r[2], -r[1], 0.0))


def strike(src, action, grip, reach=0.9):
    """The source's strike: the frame of peak speed of a point `reach` metres along the grip axis from the right hand
    (the blade's sweet spot), among frames where that point is in front of the pelvis. Returns (frame index from 0,
    seconds, peak m/s)."""
    start, end = action.frame_range
    pts, front = [], []
    rest_hand = _world(src, 'hand_r', False).to_3x3().normalized()
    g_local = rest_hand.inverted() @ grip
    for f in range(int(start), int(end) + 1):
        _play(src, action, f)
        rm = _world(src, 'root').inverted()
        hand = rm @ _world(src, 'hand_r')
        tip = hand.translation + hand.to_3x3().normalized() @ g_local * reach
        pelvis = (rm @ _world(src, 'pelvis')).translation
        pts.append(np.array(tip))
        front.append(tip.y < pelvis.y - 0.05)
    pts = np.array(pts)
    sp = np.linalg.norm(np.diff(pts, axis=0), axis=1) * 30
    ok = np.array(front[1:])
    masked = np.where(ok, sp, 0.0) if ok.any() else sp
    i = int(np.argmax(masked)) + 1
    return i, round(i / 30.0, 3), round(float(sp[i - 1]), 2)


def turn_bone(arm, name, axis, angle):
    """Rotates a posed bone (and so its children) about a world axis through its head."""
    pb = arm.pose.bones[name]
    h = pb.head.copy()
    pb.matrix = Matrix.Translation(h) @ Matrix.Rotation(angle, 4, Vector(axis)) @ Matrix.Translation(-h) @ pb.matrix
    bpy.context.view_layer.update()


def _parts(arm, armour):
    """The rest-pose sword blade's axis ends and the shield's centre, for steering the arms apart."""
    part = np.empty(len(armour.data.polygons), np.int32)
    armour.data.attributes['cf_part'].data.foreach_get('value', part)
    co = cf.co_of(armour.data)
    pol = armour.data.polygons
    blade = co[np.unique([v for i in np.flatnonzero(part == 3) for v in pol[i].vertices])]
    shield = co[np.unique([v for i in np.flatnonzero(part == 2) for v in pol[i].vertices])]
    hand = np.array(arm.data.bones[P + 'RightHand'].head_local)
    far = blade[np.argmax(np.linalg.norm(blade - hand, axis=1))]
    near = blade[np.argmin(np.linalg.norm(blade - hand, axis=1))]
    return Vector(near), Vector(far), Vector(shield.mean(0))


def _swing_apart(arm, bone, moving, away_from, angle):
    """Rotates `bone` about its head so the point `moving` (carried by it) travels directly away from `away_from`."""
    h = arm.pose.bones[bone].head.copy()
    axis = (moving - h).cross(moving - away_from)
    if axis.length < 1e-6:
        return
    turn_bone(arm, bone, axis.normalized(), angle)


def _rigid_points(armour, codes):
    part = np.empty(len(armour.data.polygons), np.int32)
    armour.data.attributes['cf_part'].data.foreach_get('value', part)
    co = cf.co_of(armour.data)
    pol = armour.data.polygons
    return co[np.unique([v for i in np.flatnonzero(np.isin(part, codes)) for v in pol[i].vertices])]


def _lift(arm, bone, carrier, pts, clear=0.01):
    """Raises `bone` about its head until the points (rest, armature space, carried rigidly by `carrier`) clear the
    ground by `clear`: the 1 m shield on a crouching commander went 3.6 cm into the floor, and the blade's low sweep
    in the spin slash 2.5 cm."""
    up = Vector((0.0, 0.0, 1.0))
    for _ in range(4):
        m = np.array(cf.deform(arm, carrier))
        w = pts @ m[:3, :3].T + m[:3, 3]
        j = int(np.argmin(w[:, 2]))
        deficit = clear - float(w[j, 2])
        if deficit <= 1e-4:
            return
        p = Vector(w[j])
        r = p - arm.pose.bones[bone].head
        lever = (up - r.normalized() * r.normalized().dot(up)).length * r.length
        _swing_apart(arm, bone, p, p - up, deficit / max(lever, 0.1) * 1.1)


def _warp(lead_amp, bad_frames, n):
    """The shield arm's source-time offsets: for each crossing frame, the arm ramps ahead from the clip's first frame
    to `lead_amp` frames ahead one frame before the crossing, and the warped time never runs backwards (the arm holds
    instead), so the first pose and the motion's order are kept."""
    lead = np.zeros(n)
    for f, amp in zip(bad_frames, lead_amp):
        b = int(f) - 1
        top = max(b - 1, 1)
        for i in range(n):
            if i <= top:
                w = i / top
            elif i <= b + 1:
                w = 1.0
            else:
                w = max(0.0, 1.0 - (i - b - 1) / 6.0)
            lead[i] = max(lead[i], amp * w)
    g = np.maximum.accumulate(np.arange(n) + lead)
    return np.minimum(g, n - 1) - np.arange(n)


def clean_clip(src, action, arm, body, armour, name, strike_frame, tries=12, step=0.12, lead_step=1.5, lead_max=4.5, edge=False, **kw):
    """Retargets a clip and clears its contacts for this commander's proportions (a 1 m shield, and a big head and
    shoulder domes that sit closer to the swing than the library mannequin's). Wherever the sword crosses the shield,
    the shield arm first runs ahead on its own source motion (`lead_step` frames more per try, up to `lead_max`), and
    only past that swings away from the blade; pushed off the blade's path from the start, the spin slash raised the
    shield over his head like a plank and still crossed; the swing now opens it out to his left and back, as a shield
    arm opens for a cut. Wherever the blade enters the body, the sword arm swings the blade away from the chest or the
    head, whichever is nearer. Swings grow `step` radians per try, faded over four frames before and two after. Every
    frame, the shield and the blade are lifted clear of the ground. With `edge`, a first plain retarget measures the
    roll that keeps the edge on the blade's path (edge_rolls) and every pass applies it. Extra keywords go to retarget.
    Returns (action, root, checks, fixes)."""
    n = int(action.frame_range[1] - action.frame_range[0]) + 1
    shield_w, sword_w, off_w = np.zeros(n), np.zeros(n), np.zeros(n)
    held = kw.get('shield_pose') is not None
    near_r, far_r, shield_r = _parts(arm, armour)
    shield_pts, blade_pts = _rigid_points(armour, [2]), _rigid_points(armour, [1, 3])
    boots = boot_points(arm, armour)
    kw.setdefault('ground_mesh', (armour, boot_masks(armour)))
    crossing = {}
    roll_deg = 0.0
    if edge:
        keys, root = retarget(src, action, arm, boots=boots, **kw)
        probe = cf.make_action_quat(arm, name + '_edge_probe', keys, loc_bones=(P + 'Hips',))
        kw['edge_roll'], _mis = edge_rolls(arm, armour, probe, root, strike_frame)
        roll_deg = round(math.degrees(float(np.abs(kw['edge_roll'][0]).max())), 1)
        ad = arm.animation_data
        for tr in list(ad.nla_tracks):
            if any(st.action == probe for st in tr.strips):
                ad.nla_tracks.remove(tr)
        bpy.data.actions.remove(probe)

    def adjust(i, a):
        _adjust(i, a)
        _lift(a, P + 'LeftArm', P + 'LeftForeArm', shield_pts)
        _lift(a, P + 'RightArm', P + 'RightHand', blade_pts)

    def _adjust(i, a):
        if shield_w[i] <= 0 and sword_w[i] <= 0 and off_w[i] <= 0:
            return
        hand = cf.deform(a, P + 'RightHand')
        mid = (hand @ near_r + hand @ far_r) / 2
        if shield_w[i] > 0:
            # Out to his left and back in the chest's frame (the torso twists through the spin slash). Pushed straight
            # off the blade the shield went 17 cm into the ground, and biased upward it rose over his head.
            centre = cf.deform(a, P + 'LeftForeArm') @ shield_r
            chest = a.pose.bones[P + 'Spine2'].matrix.to_3x3() @ a.data.bones[P + 'Spine2'].matrix_local.to_3x3().inverted()
            d = (chest @ Vector((1.0, 0.6, 0.15))).normalized()
            _swing_apart(a, P + 'LeftArm', centre, centre - d, shield_w[i])
            hand = cf.deform(a, P + 'RightHand')
            mid = (hand @ near_r + hand @ far_r) / 2
        if sword_w[i] > 0:
            chest = a.pose.bones[P + 'Spine2'].head
            head = a.pose.bones[P + 'Head'].head
            target = head if (mid - head).length < (mid - chest).length else chest
            _swing_apart(a, P + 'RightArm', mid, target, sword_w[i])
        if off_w[i] > 0:
            # a held shield stays put, so the parrying sword moves off it instead
            hand = cf.deform(a, P + 'RightHand')
            _swing_apart(a, P + 'RightArm', (hand @ near_r + hand @ far_r) / 2, cf.deform(a, P + 'LeftForeArm') @ shield_r, off_w[i])

    act, root, checks = None, None, None
    for _ in range(tries + 1):
        lead = _warp(list(crossing.values()), list(crossing), n) if crossing else None
        keys, root = retarget(src, action, arm, adjust=adjust, boots=boots, lead=lead, **kw)
        if act is not None:
            ad = arm.animation_data
            for tr in list(ad.nla_tracks):
                if any(st.action == act for st in tr.strips):
                    ad.nla_tracks.remove(tr)
            bpy.data.actions.remove(act)
        act = cf.make_action_quat(arm, name, keys, loc_bones=(P + 'Hips',))
        checks = cf.attack_checks(arm, body, armour, act, strike_frame)
        bad_shield, bad_body = checks['frames_crossing_shield'], checks['frames_blade_in_body']
        if not bad_shield and not bad_body:
            break
        swing = []
        for f in bad_shield:
            if held:
                for g in range(max(0, int(f) - 4), min(n, int(f) + 3)):
                    off_w[g] += step * (1.0 - abs(g - (f - 1)) / 4.0)
            elif crossing.get(f, 0.0) < lead_max:
                crossing[f] = crossing.get(f, 0.0) + lead_step
            else:
                swing.append(f)
        for bad, w in ((swing, shield_w), (bad_body, sword_w)):
            for f in bad:
                for g in range(max(0, int(f) - 4), min(n, int(f) + 3)):
                    w[g] += step * (1.0 - abs(g - (f - 1)) / 4.0)
    fixes = dict(edge_roll_max_deg=roll_deg, shield_lead_frames=round(max(crossing.values()), 1) if crossing else 0.0,
                 shield_max_deg=round(math.degrees(float(shield_w.max())), 1), sword_max_deg=round(math.degrees(float(sword_w.max())), 1),
                 sword_off_shield_deg=round(math.degrees(float(off_w.max())), 1))
    return act, root, checks, fixes


def foot_report(arm, armour, action, root):
    """How well the feet hold with the root's travel applied: the worst horizontal slide of each boot between frames
    where it is planted (its sole within 1.5 cm of its lowest), and the lowest boot point against the ground."""
    from . import anim
    idx = boot_masks(armour)
    sword = np.unique([v for i in np.flatnonzero(np.isin(_part_of(armour), [1, 3])) for v in armour.data.polygons[i].vertices])
    sword_low = 1e9
    restore = anim.play(arm, action)
    start, end = action.frame_range
    pos = {side: [] for side in idx}
    for i, f in enumerate(range(int(start), int(end) + 1)):
        bpy.context.scene.frame_set(f)
        co = cf._evaluated_co(armour)
        r = np.array(travel_offset(root[min(i, len(root) - 1)]))
        sword_low = min(sword_low, float(co[sword, 2].min()))
        for side, ids in idx.items():
            c = co[ids] + r
            pos[side].append((c.mean(0), c[:, 2].min()))
    restore()
    bpy.context.scene.frame_set(1)
    out = {}
    for side, seq in pos.items():
        cen = np.array([s[0] for s in seq])
        low = np.array([s[1] for s in seq])
        planted = low < low.min() + 0.015
        slide = 0.0
        for a in range(1, len(seq)):
            if planted[a] and planted[a - 1]:
                slide = max(slide, float(np.linalg.norm(cen[a, :2] - cen[a - 1, :2])))
        out[side] = dict(max_slide_mm_per_frame=round(slide * 1000, 1), lowest_mm=round(float(low.min()) * 1000, 2))
    out['sword_lowest_mm'] = round(sword_low * 1000, 2)
    return out


def edge_rolls(arm, armour, action, root, strike_frame, before=3, after=4, ramp=4, limit=math.radians(50.0)):
    """Per frame, the roll about the blade's own line that turns its edge onto the direction it travels across the
    blade (both edges cut, so the nearer one), measured at the sweet spot with the root's travel applied: in full from
    `before` frames ahead of the strike to `after` frames past it (the cut), faded out over `ramp` frames either side,
    smoothed over neighbouring frames and capped at `limit`. On the natural grip the library's own wrist left the
    forehand's edge up to 44 degrees off its path in the cut and the spin slash's within 11.

    The angle is taken continuous from the strike outward. Faded by speed instead, over the whole clip, the forehand's
    wind-up (17 m/s, its flat leading as it goes back) passed the 90 degrees where the nearer edge changes sides, the
    continuous angle ran on past the cap, and the cut's edge ended 85 degrees off. Returns (angles, point, axis) for
    retarget's edge_roll and the per-frame misalignment in degrees before it."""
    from . import anim
    width, axis, sweet = blade_frame(arm, armour)
    restore = anim.play(arm, action)
    start, end = action.frame_range
    pts, edges, axes = [], [], []
    for i, f in enumerate(range(int(start), int(end) + 1)):
        bpy.context.scene.frame_set(f)
        m = Matrix(cf.deform(arm, P + 'RightHand'))
        pts.append(np.array(m @ sweet) + np.array(travel_offset(root[min(i, len(root) - 1)])))
        edges.append(np.array((m.to_3x3() @ width).normalized()))
        axes.append(np.array((m.to_3x3() @ axis).normalized()))
    restore()
    vel = np.gradient(np.array(pts), axis=0) * 30.0
    n = len(pts)
    phi, mis = np.zeros(n), np.zeros(n)
    for j, (v, e, a) in enumerate(zip(vel, edges, axes)):
        vp = v - np.dot(v, a) * a
        s = float(np.linalg.norm(vp))
        if s < 1e-6:
            continue
        d = vp / s
        ang = math.atan2(float(np.dot(np.cross(e, d), a)), float(np.dot(e, d)))
        phi[j] = (ang + math.pi / 2) % math.pi - math.pi / 2
        mis[j] = abs(math.degrees(phi[j]))
    s0 = min(max(int(round(strike_frame)) - 1, 0), n - 1)
    cont = phi.copy()
    for j in range(s0 + 1, n):
        cont[j] = cont[j - 1] + ((phi[j] - cont[j - 1] + math.pi / 2) % math.pi - math.pi / 2)
    for j in range(s0 - 1, -1, -1):
        cont[j] = cont[j + 1] + ((phi[j] - cont[j + 1] + math.pi / 2) % math.pi - math.pi / 2)
    w = np.array([1.0 if s0 - before <= j <= s0 + after else max(0.0, 1.0 - (min(abs(j - (s0 - before)), abs(j - (s0 + after)))) / ramp)
                  for j in range(n)])
    out = np.clip(cont * w, -limit, limit)
    k = np.array([0.25, 0.5, 0.25])
    for _ in range(2):
        out = np.convolve(np.r_[out[0], out, out[-1]], k, mode='valid')
    return (out, sweet, axis), mis


def edge_alignment(arm, armour, action, root, strike_frame):
    """How well the edge leads the cut: on the active frames (one before the strike to two after), the angle between
    the blade's edge line and the sweet spot's velocity across the blade, with the root's travel applied, in degrees
    (0 is the edge leading exactly, 90 the flat). Returns the frames, the angles, their mean and their worst."""
    from . import anim
    width, axis, sweet = blade_frame(arm, armour)
    restore = anim.play(arm, action)
    start, end = action.frame_range
    pts, edges, axes = [], [], []
    for i, f in enumerate(range(int(start), int(end) + 1)):
        bpy.context.scene.frame_set(f)
        m = Matrix(cf.deform(arm, P + 'RightHand'))
        pts.append(np.array(m @ sweet) + np.array(travel_offset(root[min(i, len(root) - 1)])))
        edges.append(np.array((m.to_3x3() @ width).normalized()))
        axes.append(np.array((m.to_3x3() @ axis).normalized()))
    restore()
    vel = np.gradient(np.array(pts), axis=0) * 30.0
    s0 = int(round(strike_frame)) - 1
    frames = [j for j in range(s0 - 1, s0 + 3) if 0 <= j < len(pts)]
    out = []
    for j in frames:
        vp = vel[j] - np.dot(vel[j], axes[j]) * axes[j]
        s = float(np.linalg.norm(vp))
        out.append(round(math.degrees(math.acos(min(1.0, abs(float(np.dot(vp / s, edges[j])))))), 1) if s > 1e-6 else 0.0)
    return dict(frames=[j + 1 for j in frames], degrees=out, mean=round(float(np.mean(out)), 1), worst=max(out))


def settle_frame(arm, armour, action, root, strike_frame, below=1.5):
    """The frame (from 1) from which the blade's sweet spot, with the root's travel applied, stays under `below` m/s to
    the clip's end, looking from the strike on: where the swing has settled. The clip's last frame when it never does
    (a light hit's clip ends still moving, into its recovery or the next hit)."""
    from . import anim
    _width, _axis, sweet = blade_frame(arm, armour)
    restore = anim.play(arm, action)
    start, end = action.frame_range
    pts = []
    for i, f in enumerate(range(int(start), int(end) + 1)):
        bpy.context.scene.frame_set(f)
        pts.append(np.array(Matrix(cf.deform(arm, P + 'RightHand')) @ sweet) + np.array(travel_offset(root[min(i, len(root) - 1)])))
    restore()
    sp = np.r_[0.0, np.linalg.norm(np.diff(np.array(pts), axis=0), axis=1) * 30.0]
    for j in range(max(int(round(strike_frame)) - 1, 0), len(sp)):
        if (sp[j:] < below).all():
            return j + 1
    return len(sp)


def blade_frame(arm, armour, at=0.7):
    """The blade at rest (armature space): its edge line (the width axis, from the blade's principal axes), its
    length axis pointing from the grip to the tip, and its sweet spot `at` of the way from the guard to the tip."""
    co = cf.co_of(armour.data)
    blade = co[np.unique([v for i in np.flatnonzero(_part_of(armour) == 3) for v in armour.data.polygons[i].vertices])]
    c = blade.mean(0)
    vt = np.linalg.svd(blade - c)[2]
    axis = vt[0] if np.dot(vt[0], c - np.array(arm.data.bones[P + 'RightHand'].head_local)) > 0 else -vt[0]
    along = (blade - c) @ axis
    sweet = c + axis * (along.min() + at * (along.max() - along.min()))
    return Vector(vt[1]), Vector(axis), Vector(sweet)


def _part_of(armour):
    part = np.empty(len(armour.data.polygons), np.int32)
    armour.data.attributes['cf_part'].data.foreach_get('value', part)
    return part
