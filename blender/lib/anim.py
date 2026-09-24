"""Keyframe helpers. A pose maps bone names to (rx, ry, rz) Euler radians; a bone listed in `loc_bones`
also keys its location from the pose entry '<bone>@loc' (default zero).

Axis conventions, measured in Blender 5.2 after calculate_roll (see rig.py):
- Humanoid (roll GLOBAL_POS_X). Bones pointing down (thigh, shin, upper_arm, forearm, hand): +rz swings
  the tail backward (world +Y), -rz forward; +rx moves the tail toward world +X on both sides.
  Bones pointing up (spine, chest, neck, head): +rz bends forward; +rx leans toward world +X;
  +ry twists the front toward world +X, the character's left. The hips' local +Y is world up.
- Creature (roll GLOBAL_POS_Z). Horizontal bones (body, thorax, head, carapace): +rx pitches the tail up,
  +rz yaws toward world +X; the body's local +Y is forward and +Z is up. Legs: +rx lifts; +rz swings .L
  backward but .R forward, so use leg_swing().
"""
import bpy

from .rig import mirror_name

FPS = 30


def leg_swing(side, forward):
    """rz for a creature leg such that positive `forward` swings it forward on either side."""
    return -forward if side == 'L' else forward


def clear_pose(arm):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = (0.0, 0.0, 0.0)
        pb.location = (0.0, 0.0, 0.0)


def key_pose(arm, pose, frame, loc_bones=()):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = pose.get(pb.name, (0.0, 0.0, 0.0))
        pb.keyframe_insert('rotation_euler', frame=frame)
        if pb.name in loc_bones:
            pb.location = pose.get(f'{pb.name}@loc', (0.0, 0.0, 0.0))
            pb.keyframe_insert('location', frame=frame)


def make_action(arm, name, keys, loc_bones=()):
    """keys: list of (frame, pose). Keys every bone at every key frame and stashes the action on its own NLA
    track, which is what the glTF exporter's ACTIONS mode turns into a separate animation."""
    arm.animation_data_create()
    action = bpy.data.actions.new(name)
    arm.animation_data.action = action
    for frame, pose in keys:
        key_pose(arm, pose, frame, loc_bones)
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, int(keys[0][0]), action)
    arm.animation_data.action = None
    clear_pose(arm)
    return action


def duration(action):
    start, end = action.frame_range
    return (end - start) / FPS


def play(arm, action):
    """Shows one action alone (NLA off) for previews; returns a callable that restores the NLA."""
    data = arm.animation_data
    data.use_nla = False
    data.action = action

    def restore():
        data.action = None
        data.use_nla = True

    return restore


def mirror_pose(pose, kind='humanoid'):
    """Mirrors a pose across world X, swapping .L and .R. Humanoid bones other than the shoulders roll Z to +X
    on both sides, so a mirrored rotation keeps rz (a forward swing stays forward) and flips rx and ry. The
    shoulders and every creature bone roll Z to up, which mirrors their frames, so they keep rx and flip ry
    and rz instead (hence leg_swing). An '@loc' offset flips its world-X component: local z on the humanoid
    (the hips' local Z is world X) and local x on the creature (the body's local X is world -X)."""
    out = {}
    for key, value in pose.items():
        if key.endswith('@loc'):
            bone = key[:-4]
            x, y, z = value
            out[f'{mirror_name(bone)}@loc'] = (x, y, -z) if kind == 'humanoid' else (-x, y, z)
            continue
        rx, ry, rz = value
        swing_mirrors = kind != 'humanoid' or key.startswith('shoulder.')
        out[mirror_name(key)] = (rx, -ry, -rz) if swing_mirrors else (-rx, -ry, rz)
    return out


def merge(*poses):
    out = {}
    for pose in poses:
        out.update(pose)
    return out
