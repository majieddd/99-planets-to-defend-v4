"""Clip authoring for a Mixamo-rigged commander: pose specs, spline tracks with layered timing, a whole-pose solver,
the retarget of UniMate joint positions, the clean-up passes and the previews the owner judges fluidity with.

A pose spec is a dict of plain numbers (see SPEC): the hips' offset and turn, the torso's twist and bend, the head's
turn and nod, the sword arm's upper-arm and forearm directions and where the blade should point, the shield arm's
directions and each foot's offset. A clip is a list of keyed specs. Between keys every number follows a C1 Hermite
spline (Catmull-Rom tangents, zero at the clip's ends), so the motion passes through its keys without the stop at
every key that per-segment easing gives, and each body part reads the track at its own time offset (LAGS): the hips
lead, the sword arm follows, the shield arm and the head trail and settle last. Every output frame is solved whole by
lib/charforge.py pose_rotations, legs by IK, so the boots stay where they stand unless a step moves them.

Nothing here needs UniMate itself: its retarget helpers read joint positions a generation was stored as (plain
numbers), so a recipe that selects them reads a committed file and the build still needs only the repository and
Blender. combo_preview and render_frames are for previews made by hand in a Blender session, not part of the build."""
import math

import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import charforge as cf

P = cf.P
UP, AHEAD = (0.0, 0.0, 1.0), (1.0, 0.0, 0.0)
SPEC = ('hips_off', 'hips_turn', 'torso', 'head', 's_up', 's_fore', 's_want', 'h_up', 'h_fore', 'step_l', 'step_r')
GROUPS = {'hips': ('hips_off', 'hips_turn', 'step_l', 'step_r'), 'torso': ('torso',), 'sword': ('s_up', 's_fore', 's_want'),
          'shield': ('h_up', 'h_fore'), 'head': ('head',)}
# Frames each part reads ahead (+) or behind (-) the clip's clock: the hips start each move, the shoulders and the
# sword follow a frame later, the shield arm and the head arrive two frames after the torso and settle last.
LAGS = {'hips': 1.5, 'torso': 0.5, 'sword': 0.0, 'shield': -1.5, 'head': -2.0}


def spec(hips_off=(0.0, 0.0, 0.0), hips_turn=0.0, torso=(0.0, 0.0), head=(0.0, 0.0), sword=None, shield=None,
         step_l=(0.0, 0.0, 0.0), step_r=(0.0, 0.0, 0.0)):
    """A pose spec from readable parts: sword = (upper arm, forearm, blade want), shield = (upper arm, forearm), all
    world directions (x the character's left, -y forward, z up)."""
    return dict(hips_off=np.array(hips_off, float), hips_turn=np.array([hips_turn], float), torso=np.array(torso, float),
                head=np.array(head, float), s_up=np.array(sword[0], float), s_fore=np.array(sword[1], float),
                s_want=np.array(sword[2], float), h_up=np.array(shield[0], float), h_fore=np.array(shield[1], float),
                step_l=np.array(step_l, float), step_r=np.array(step_r, float))


def blend(a, b, w):
    """Part way from spec a to spec b (directions renormalised when solved)."""
    return {k: a[k] + (b[k] - a[k]) * w for k in SPEC}


def hermite(times, values, t):
    """The value at t of a C1 curve through (times, values): Catmull-Rom tangents inside, zero tangents at both ends,
    so a clip eases out of its first pose and into its last one and flows through the rest."""
    times = np.asarray(times, float)
    values = np.asarray(values, float)
    if t <= times[0]:
        return values[0]
    if t >= times[-1]:
        return values[-1]
    i = int(np.searchsorted(times, t) - 1)
    t0, t1 = times[i], times[i + 1]
    h = t1 - t0
    s = (t - t0) / h

    def tangent(k):
        if k == 0 or k == len(times) - 1:
            return np.zeros_like(values[0])
        return (values[k + 1] - values[k - 1]) / (times[k + 1] - times[k - 1])

    m0, m1 = tangent(i) * h, tangent(i + 1) * h
    return (2 * s ** 3 - 3 * s ** 2 + 1) * values[i] + (s ** 3 - 2 * s ** 2 + s) * m0 + (-2 * s ** 3 + 3 * s ** 2) * values[i + 1] + (s ** 3 - s ** 2) * m1


def track_at(keys, t, lags=LAGS):
    """The spec at clip time t (frames) from keys [(time, spec)], each part read at its own lag."""
    times = [k[0] for k in keys]
    out = {}
    for group, params in GROUPS.items():
        tg = min(max(t + lags.get(group, 0.0), times[0]), times[-1])
        for name in params:
            out[name] = hermite(times, [k[1][name] for k in keys], tg)
    return out


def torso_ops(twist, bend):
    """The torso's twist (positive turns the chest to the character's left) and forward bend, shared over the three
    spine bones so the torso curves rather than kinking at one joint."""
    ops = []
    for bone, share in ((P + 'Spine', 0.25), (P + 'Spine1', 0.35), (P + 'Spine2', 0.4)):
        ops.append(('turn', bone, UP, twist * share))
        ops.append(('turn', bone, AHEAD, bend * share))
    return ops


def _unit(v):
    v = np.asarray(v, float)
    n = float(np.linalg.norm(v))
    return tuple(v / n) if n > 1e-9 else (0.0, 0.0, -1.0)


def solve(arm, s, blade_rest):
    """Every bone's rotation (and the hips' offset) for one spec."""
    ops = [('move', P + 'Hips', tuple(s['hips_off'])), ('turn', P + 'Hips', UP, float(s['hips_turn'][0]))]
    ops += torso_ops(float(s['torso'][0]), float(s['torso'][1]))
    turn, nod = float(s['head'][0]), float(s['head'][1])
    ops += [('turn', P + 'Neck', UP, turn * 0.4), ('turn', P + 'Head', UP, turn * 0.6), ('turn', P + 'Head', AHEAD, nod)]
    ops += [('aim', P + 'RightArm', _unit(s['s_up'])),
            ('aim_carry', P + 'RightForeArm', _unit(s['s_fore']), P + 'RightHand', blade_rest, _unit(s['s_want'])),
            ('aim', P + 'LeftArm', _unit(s['h_up'])), ('aim', P + 'LeftForeArm', _unit(s['h_fore'])),
            ('leg', 'Left', tuple(s['step_l'])), ('leg', 'Right', tuple(s['step_r']))]
    return cf.pose_rotations(arm, ops)


def bake(arm, name, spec_at, end_frame, strike_frame, blade_rest):
    """An action keyed on every frame from 1 to end_frame and on the strike's own (fractional) frame, each solved
    whole from spec_at(frame). Keyed only at the authored poses, rotations blended bone by bone let the boots slide."""
    frames = sorted(set([float(f) for f in range(1, int(math.floor(end_frame)) + 1)] + [float(strike_frame), float(end_frame)]))
    keys = [(f, solve(arm, spec_at(f), blade_rest)) for f in frames]
    return cf.make_action_quat(arm, name, keys, loc_bones=(P + 'Hips',))


# ---------------------------------------------------------------- UniMate retarget

def yaw(v):
    return math.atan2(v[1], v[0])


def unimate_specs(pos, names, hip_height, guard, frames=None):
    """Pose specs from UniMate joint positions (T, 22, 3), already in Blender axes (x left, -y forward, z up), one per
    frame. The data's own facing at its first frame becomes straight ahead; the hips' travel is scaled by the ratio of
    hip heights; arms come over as directions, so Pip's proportions and rest pose do not matter; the head counters the
    torso's twist (UniMate's 22 joints carry no face direction). Feet stay planted: steps are designed, not taken from
    the data. `guard` supplies what the data cannot (the head's nod, the feet)."""
    j = {n.replace(P, ''): i for i, n in enumerate(names)}
    pos = np.asarray(pos, float)
    lat0 = pos[0, j['LeftUpLeg']] - pos[0, j['RightUpLeg']]
    rot = Matrix.Rotation(-yaw(lat0), 3, 'Z')
    r = np.array(rot)
    pos = pos @ r.T
    scale = hip_height / max(float(pos[0, j['Hips'], 2] - min(pos[0, j['LeftToeBase'], 2], pos[0, j['RightToeBase'], 2])), 1e-6)
    hips0 = pos[0, j['Hips']].copy()
    out = []
    for f in range(len(pos)) if frames is None else frames:
        q = pos[f]
        hip_lat = q[j['LeftUpLeg']] - q[j['RightUpLeg']]
        sh_lat = q[j['LeftArm']] - q[j['RightArm']]
        hips_turn = yaw(hip_lat)
        twist = math.remainder(yaw(sh_lat) - hips_turn, 2 * math.pi)
        spine = q[j['Neck']] - q[j['Hips']]
        fwd = np.array([math.sin(hips_turn), -math.cos(hips_turn), 0.0])
        bend = math.atan2(float(spine @ fwd), float(spine[2]))
        # The boots stay planted only while the legs can reach them: the hips' travel is held within 7 cm across the
        # floor and dropped half as far as it travels (the data's hips drifted up to 20 cm and the boots slid 8 cm).
        off = (q[j['Hips']] - hips0) * scale
        across = float(np.linalg.norm(off[:2]))
        if across > 0.07:
            off[:2] *= 0.07 / across
        off[2] = min(off[2], 0.0) - 0.5 * min(across, 0.07)
        arm_line = q[j['RightHand']] - q[j['RightArm']]
        out.append(spec(hips_off=off, hips_turn=hips_turn, torso=(twist, bend), head=(-0.35 * twist, float(guard['head'][1])),
                        sword=(q[j['RightForeArm']] - q[j['RightArm']], q[j['RightHand']] - q[j['RightForeArm']],
                               np.array(_unit(arm_line)) + 0.35 * fwd),
                        shield=(q[j['LeftForeArm']] - q[j['LeftArm']], q[j['LeftHand']] - q[j['LeftForeArm']]),
                        step_l=guard['step_l'], step_r=guard['step_r']))
    return out


def smooth_specs(specs, sigma=1.0):
    """A light Gaussian over time on every number: UniMate's frames carry a little jitter that reads as buzz once a
    clip is compressed to a fraction of a second."""
    if sigma <= 0:
        return specs
    rad = int(math.ceil(3 * sigma))
    kern = np.exp(-0.5 * (np.arange(-rad, rad + 1) / sigma) ** 2)
    kern /= kern.sum()
    out = [dict() for _ in specs]
    for k in SPEC:
        arr = np.stack([s[k] for s in specs])
        pad = np.concatenate([np.repeat(arr[:1], rad, 0), arr, np.repeat(arr[-1:], rad, 0)])
        sm = np.stack([np.tensordot(kern, pad[i:i + 2 * rad + 1], axes=(0, 0)) for i in range(len(arr))])
        for i in range(len(specs)):
            out[i][k] = sm[i]
    return out


def strike_window(pos, names, lo=4, hi=None):
    """The data's wind-up start, strike and settle (frames): the strike is the right hand's fastest frame, the wind-up
    starts at the slowest frame before it (the top of the back-swing) less three frames, and the settle is the first
    frame after it where the hand is back under a quarter of its peak speed, plus four."""
    j = {n.replace(P, ''): i for i, n in enumerate(names)}
    hand = np.asarray(pos)[:, j['RightHand']]
    speed = np.linalg.norm(np.diff(hand, axis=0), axis=1)
    hi = hi or len(speed) - 3
    s = lo + int(np.argmax(speed[lo:hi])) + 1
    before = speed[max(0, s - 18):s - 1]
    a = max(0, s - 18 + int(np.argmin(before)) - 3) if len(before) else max(0, s - 6)
    after = np.flatnonzero(speed[s:] < 0.25 * speed[s - 1])
    b = min(len(hand) - 1, s + (int(after[0]) if len(after) else 8) + 4)
    return a, s, b, float(speed.max() * 30)


def retimed(data_specs, window, strike_frame, end_frame, guard, end_spec=None, blend_in=0.55, blend_out=0.45):
    """spec_at(frame) for a UniMate segment retimed to the clip's contract: the data's wind-up start to strike maps
    onto frames 1 to strike_frame and strike to settle onto strike_frame to end_frame (piecewise linear in time, then
    read through the Hermite spline of the data frames). The clip leaves the guard over the first blend_in of its
    wind-up and returns to end_spec (the guard by default) over the last blend_out of its recovery, so it starts where
    the previous clip ends and blends into idle or the next attack."""
    a, s, b = window
    times = list(range(len(data_specs)))
    end_spec = end_spec or guard

    def data_time(f):
        if f <= strike_frame:
            return a + (s - a) * (f - 1) / max(strike_frame - 1, 1e-6)
        return s + (b - s) * (f - strike_frame) / max(end_frame - strike_frame, 1e-6)

    def at(f):
        td = data_time(f)
        d = {k: hermite(times, [x[k] for x in data_specs], td) for k in SPEC}
        w_in = cf.ss(1.0, 1.0 + blend_in * (strike_frame - 1), f)
        w_out = 1.0 - cf.ss(end_frame - blend_out * (end_frame - strike_frame), end_frame, f)
        out = blend(guard, d, float(w_in)) if f < strike_frame else blend(end_spec, d, float(w_out))
        return out
    return at


# ---------------------------------------------------------------- clean-up checks and fixes

def shield_fix(arm, body, armour, action, strike_frame, spec_at, end_frame, blade_rest, name, tries=3):
    """Re-bakes a clip with the shield arm swung further out to the left wherever the sword crossed the shield, until
    the checks are clean or the tries run out. Returns the final action, its checks and the spec_at it was baked from,
    so a clip chained from this one starts from the pose this one really plays at its cancel frame, fix included; the
    unfixed spec would start the next clip with the shield where the fix moved it from."""
    n = int(math.ceil(end_frame)) + 6
    weight = np.zeros(n)
    base_at = spec_at
    for _ in range(tries):
        checks = cf.attack_checks(arm, body, armour, action, strike_frame)
        bad = checks['frames_crossing_shield']
        if not bad:
            return action, checks, spec_at
        # each crossing frame pushes the shield out a step more, faded over three frames either side
        for f in bad:
            for g in range(max(0, int(f) - 3), min(n, int(f) + 4)):
                weight[g] += 1.0 - abs(g - f) / 4.0
        _remove_action(arm, action)

        def fixed(f, w_arr=weight.copy()):
            s = dict(base_at(f))
            w = float(np.interp(f, np.arange(n), w_arr))
            s['h_up'] = s['h_up'] + np.array([0.6, 0.15, 0.25]) * w
            s['h_fore'] = s['h_fore'] + np.array([0.5, 0.0, 0.2]) * w
            return s
        spec_at = fixed
        action = bake(arm, name, spec_at, end_frame, strike_frame, blade_rest)
    return action, cf.attack_checks(arm, body, armour, action, strike_frame), spec_at


def _remove_action(arm, action):
    ad = arm.animation_data
    for tr in list(ad.nla_tracks):
        if any(st.action == action for st in tr.strips):
            ad.nla_tracks.remove(tr)
    bpy.data.actions.remove(action)


def blade_speed(arm, armour, action, strike_frame):
    """The blade tip's speed (m/s) through the clip, frame to frame, and its peak frame: the strike should be the
    fastest moment."""
    from . import anim
    part = np.empty(len(armour.data.polygons), np.int32)
    armour.data.attributes['cf_part'].data.foreach_get('value', part)
    verts = np.unique([v for i in np.flatnonzero(part == 3) for v in armour.data.polygons[i].vertices])
    restore = anim.play(arm, action)
    start, end = action.frame_range
    tips = []
    for f in range(int(start), int(math.ceil(end)) + 1):
        bpy.context.scene.frame_set(f)
        co = cf._evaluated_co(armour)[verts]
        hand = np.array(cf.bone_head(arm, P + 'RightHand', True))
        tips.append(co[np.argmax(np.linalg.norm(co - hand, axis=1))])
    restore()
    bpy.context.scene.frame_set(1)
    tips = np.array(tips)
    sp = np.linalg.norm(np.diff(tips, axis=0), axis=1) * anim.FPS
    return dict(peak_mps=round(float(sp.max()), 2), peak_frame=int(start) + 1 + int(np.argmax(sp)), strike_frame=round(float(strike_frame), 2))


def clip_ground(arm, body, armour, action, checks):
    """An authored clip's clip_ground record for the sidecar, as ground_clips (lib/charforge.py) writes one for a
    retargeted clip: no hips offset, since an authored clip's boots are held by IK where they stand in the rest pose, on
    the ground; its lowest boot point and its lowest sword point over every frame, read apart, so a dip under the
    ground names what dips; and the lowest point of the whole figure, which attack_checks measured (`checks`)."""
    boots = cf.weight_of(armour, cf.BOOT_BONES) > 0.5
    part = np.empty(len(armour.data.polygons), np.int32)
    armour.data.attributes['cf_part'].data.foreach_get('value', part)
    sword = np.zeros(len(armour.data.vertices), bool)
    sword[[v for i in np.flatnonzero(np.isin(part, cf.SWORD_PARTS)) for v in armour.data.polygons[i].vertices]] = True
    low = cf._clip_lowest(arm, body, armour, action, {'boots': boots, 'sword': sword}).low
    return dict(offset_m=0.0, boot_min_z=round(low['boots'][0], 4), sword_min_z=round(low['sword'][0], 4), min_z=checks['min_z'])


# ---------------------------------------------------------------- previews

def combo_preview(arm, segments, name='combo_preview', fade=2.0):
    """One preview action that plays clips back to back: segments = [(action, play_until_frame_offset)], each cut at
    its offset (a cancel window) and crossfaded into the next over `fade` frames by blending the bones' rotations
    and the hips' offset, the way the runtime chains them. Returns the action and its length in frames."""
    from . import anim
    samples = []
    for k, (action, until) in enumerate(segments):
        restore = anim.play(arm, action)
        start = action.frame_range[0]
        n = int(round(until))
        seg = []
        for i in range(n + 1):
            bpy.context.scene.frame_set(int(start + i))
            seg.append({pb.name: (pb.matrix_basis.to_quaternion(), pb.matrix_basis.translation.copy()) for pb in arm.pose.bones})
        restore()
        samples.append(seg)
    frames = []
    for k, seg in enumerate(samples):
        if k == 0:
            frames.extend(seg)
            continue
        f = int(round(fade))
        for i in range(f):
            w = (i + 1) / (f + 1)
            prev = frames[-f + i] if len(frames) >= f else frames[-1]
            cur = seg[i]
            frames[-f + i] = {bn: (prev[bn][0].slerp(cur[bn][0], w), prev[bn][1].lerp(cur[bn][1], w)) for bn in cur}
        frames.extend(seg[f:])
    arm.animation_data_create()
    action = bpy.data.actions.new(name)
    arm.animation_data.action = action
    for i, pose in enumerate(frames):
        for pb in arm.pose.bones:
            pb.rotation_mode = 'QUATERNION'
            pb.rotation_quaternion, pb.location = pose[pb.name]
            pb.keyframe_insert('rotation_quaternion', frame=1 + i)
            pb.keyframe_insert('location', frame=1 + i)
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pb.location = (0.0, 0.0, 0.0)
    return action, len(frames)


def render_frames(arm, objs, action, out_dir, prefix, views=(('threeq', -35.0, 12.0), ('side', -90.0, 5.0)), size=480):
    """Renders every frame of an action from fixed cameras (the stand-in Workbench shading of lib/export), framed once
    for the whole clip so the motion reads against a still frame. Returns {view: [paths]}."""
    from . import anim, export
    restore = anim.play(arm, action)
    export._workbench(size)
    cam = export._camera()
    # A 2.7 m tall frame centred at hip height a little in front of the figure: room for the sword at full reach
    # without the figure shrinking to a stick (framing on the T-posed bounds put the camera twice as far).
    centre = Vector((0.0, -0.25, 0.95))
    distance = 1.35 / math.tan(cam.data.angle / 2)
    start, end = action.frame_range
    out = {v[0]: [] for v in views}
    for f in range(int(start), int(math.ceil(end)) + 1):
        bpy.context.scene.frame_set(f)
        for view, yaw_deg, pitch_deg in views:
            export._aim(cam, centre, distance, math.radians(yaw_deg), math.radians(pitch_deg))
            path = out_dir / f'{prefix}_{view}_{f:03d}.png'
            bpy.context.scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            out[view].append(path)
    restore()
    bpy.context.scene.frame_set(1)
    return out
