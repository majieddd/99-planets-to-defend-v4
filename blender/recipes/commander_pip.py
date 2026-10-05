"""Commander Pip: the player's commander, rebuilt from the owner's CharForge character Pip (a cartoon courier) into a
lightly armoured cartoon knight with Pip's own face and hair. The owner chose this look over a helmeted one and
approved its in-engine face after five rounds of fixes; this recipe reproduces it from the committed source.

Source: SOURCE, blender/sources/charforge/pip.glb, the GLB the owner publishes at
https://majieddd.github.io/charforge/pip.glb, as published on 2026-10-03 (78,233 triangles on a 64-bone Mixamo
skeleton, a 2,048 albedo, the face morphs blink_L, blink_R, smile, brows_up and pucker, a jaw bone and 19 clips). It
differs from the first publication (2026-09-28) only in its clips: idle and run carry new arm and leg rotations.
Every step is a lib/charforge.py function; this file holds what is Pip's own: the settings that differ from the
template's defaults, the attack, the three-hit combo, and the record.

Result: 1.78 m and 5.0 heads, 24 bones (the finger bones go: the hands stay culled inside the mitten gauntlets), at most
24,000 triangles with the face kept dense, two meshes (commander_body with the five morphs, `_ink` and `_skin`;
commander_armour with `_ink`), one 1,024 atlas for body and armour and a 1,024 head texture. Clips: Pip's idle and run
retargeted onto the reshaped rig, each moved by one constant so its lowest boot point stands on the ground (both sink
as retargeted, so both are raised; lib/charforge.py ground_clips), an attack authored here (0.85 s, strike at
0.34 s from src/shared/timings.json), and the three hits of Play Pip's combo, attack_1 to attack_3, hand-keyed here
on lib/motion.py's spline tracks to their own entries in the same file (Mechanics, Commander combat). The attack stays:
the commanders' budget requires a clip of that name, and the Style Lab's cycle plays it.
Each clip's lowest point is recorded in the sidecar's notes as clip_ground, which a unit test holds to the ground.

With COMBO_SOURCE = 'quaternius' the three hits come instead from the Quaternius Universal Animation Library 2 (CC0,
blender/sources/quaternius/UAL2_Standard_RM.glb): Sword_Regular_A, B and C at their own timing, with the two light
hits' recoveries (attack_1_rec, attack_2_rec), a block (Sword_Block, the shield held raised as in the guard) and a
guard idle (idle_guard, Idle_Shield_Loop), retargeted at build time by lib/retarget.py (build_quaternius). The library's
root motion is taken out of every clip (the hips keep only their vertical bob) and recorded per clip in the sidecar as
notes.root_motion, for the game to apply as the lunge. The sword is then held as the library's fist holds it, in
every clip: the CharForge sword left the fist 141 degrees from the forearm, nearly carrying the arm's line on, and the
owner found the swings unnatural for it; it now leaves the top of the fist at 104 (regrip_sword). The idle keeps it so;
the run leans the wrist by one constant turn (clear_carry), which keeps the blade out of his head and gives back the
run's approved carry.

The hand-keyed hits ship beside the Quaternius ones as a comparison set (COMPARE_SOURCE), named attack_1_hand to
attack_3_hand with their own timings.json entries, which keep the values they had when they were the combo; the labs'
swing set control plays one set or the other. Both sets share the one sword mesh, which the regrip has turned in the
fist, so the comparison set is solved with the axis its keys were written for and the hand then turned at the wrist to
point the regripped blade the same way (lib/motion.py solve, {'held', 'aim'}): its blade paths stay the ones the owner
judged, the fist bent as the old grip held the sword. Solved on the new axis alone, the forearm's twist could not reach
the keyed blade directions, and every hand-keyed strike's tip moved 0.55 m off its path.

The attack is a shield-and-sword cleave. From the guard the torso coils to the right and the sword rises behind the
right shoulder while the shield comes up in front (a wind-up that reads from the gameplay camera), the cut comes over
and down in front of the body to the strike, the shield swinging out to the left so the blade passes clear of it, and
the follow-through leaves the blade low and the torso turned and bent: a held recovery that opens the commander to a
counter before the guard returns. The weight travels through the knees: loaded onto the right (back) leg in the
wind-up, driven forward onto the left at the strike, settled low in the recovery. The boots stay planted where they
stand (two-bone IK on every frame), so the ground contract holds through the clip; no step was needed. Poses are
written as world directions (lib/charforge.py pose_rotations), and the sword's own axis is aimed through the
forearm's twist, so the blade's path is authored directly. The cleave is authored here rather than taken from a
Mixamo clip: it has to clear this shield and keep these feet planted at this timing, which a library clip would only
reach after the same retargeting, retiming and fixes."""
import math
import shutil

import bpy
import numpy as np

from lib import anim, charforge, export, ink, motion, retarget, scene
from lib.ctx import AnimRecord, AssetRecord

NAME = 'commander_pip'
# The CharForge source, relative to the repository root (BuildContext.root), so the build reads the committed file
# wherever the checkout lives.
SOURCE = 'blender/sources/charforge/pip.glb'
P = charforge.P
# Pip's chin in source units as the approved build placed it. The template's own measure (the lowest centre-line vertex
# the jaw moves) reads 1.275 on this source; every face rule was tuned against 1.258, so the value is pinned.
PIP = {'reshape': {'chin_source_z': 1.258}}

UP, AHEAD = (0, 0, 1), (1, 0, 0)  # a turn about UP twists the torso; a positive turn about AHEAD bends it forward


def torso(twist, bend):
    """The twist (positive turns the chest to the character's left) and the forward bend, shared by the three spine
    bones so the torso curves rather than kinking at one joint."""
    out = []
    for bone, share in ((P + 'Spine', 0.25), (P + 'Spine1', 0.35), (P + 'Spine2', 0.4)):
        out.append(('turn', bone, UP, twist * share))
        out.append(('turn', bone, AHEAD, bend * share))
    return out


def blade_axis(armour, arm):
    """The sword blade's axis in the rest pose, pointing from the grip to the tip: the blade's longest principal
    direction, oriented away from the right hand."""
    part = np.empty(len(armour.data.polygons), np.int32)
    armour.data.attributes['cf_part'].data.foreach_get('value', part)
    co = charforge.co_of(armour.data)
    verts = np.unique([v for i in np.flatnonzero(part == 3) for v in armour.data.polygons[i].vertices])
    pts = co[verts]
    centre = pts.mean(0)
    axis = np.linalg.svd(pts - centre)[2][0]
    hand = np.array(charforge.bone_head(arm, P + 'RightHand'))
    if np.dot(axis, centre - hand) < 0:
        axis = -axis
    return tuple(float(x) for x in axis)


# The attack's key poses as world directions: the hips' offset (metres) and turn, the torso's twist and bend, the right
# upper arm, the right forearm and where the blade should point (the forearm's twist aims it), the left upper arm and
# forearm (the shield rides the forearm). The legs follow the hips by IK with the boots planted where they stand, so
# the weight shifts through the knees: settled a little in the guard, loaded onto the right (sword-side, back) leg in
# the wind-up, driven forward onto the left at the strike, sunk low in the recovery. The guard holds the shield across
# the front and the sword forward and low, its tip clear of the leg.
ATTACK = {
    'guard': dict(hips=((0.0, 0.0, -0.02), 0.0), torso=(0.0, 0.0), sword=((-0.2, -0.05, -0.98), (-0.05, -0.55, -0.83), (0.0, -0.85, -0.5)),
                  shield=((0.3, 0.05, -1.0), (-0.52, -0.84, -0.05))),
    # Wind-up: coiled to the right and leaning back a little, the sword raised high behind the right shoulder, the
    # shield raised in front.
    'windup': dict(hips=((-0.045, 0.03, -0.05), -0.15), torso=(-0.45, -0.1), sword=((-0.5, 0.35, 0.8), (0.3, 0.55, 0.78), (-0.15, 0.6, -0.78)),
                   shield=((0.4, -0.3, -0.87), (-0.42, -0.9, 0.05))),
    # Held a beat later and a touch further, so the wind-up reads before the cut.
    'coil': dict(hips=((-0.05, 0.035, -0.055), -0.18), torso=(-0.5, -0.12), sword=((-0.48, 0.42, 0.78), (0.32, 0.62, 0.72), (-0.1, 0.55, -0.83)),
                 shield=((0.42, -0.28, -0.86), (-0.4, -0.9, 0.08))),
    # Strike: unwound to the left and bent forward, the arm extended and the blade cutting down in front of the body,
    # the shield opened out and down to the left, at hip height, so the blade passes clear of it and the face shows.
    'strike': dict(hips=((0.04, -0.06, -0.075), 0.2), torso=(0.25, 0.22), sword=((-0.25, -0.8, -0.55), (-0.1, -0.88, -0.47), (0.15, -0.75, -0.64)),
                   shield=((0.45, 0.1, -0.89), (0.35, -0.75, -0.56))),
    # Follow-through: the blade carried on down and across to the left front, the torso over-turned and bent, the
    # shield lowered and further out to make room.
    'follow': dict(hips=((0.045, -0.07, -0.085), 0.25), torso=(0.4, 0.32), sword=((0.0, -0.75, -0.66), (0.2, -0.7, -0.68), (0.45, -0.5, -0.74)),
                   shield=((0.55, 0.2, -0.81), (0.6, -0.35, -0.72))),
    # The held recovery: still over-committed, the blade low in front, before the guard returns.
    'hold': dict(hips=((0.03, -0.05, -0.08), 0.2), torso=(0.38, 0.28), sword=((-0.02, -0.72, -0.7), (0.15, -0.68, -0.72), (0.4, -0.55, -0.73)),
                 shield=((0.52, 0.18, -0.83), (0.55, -0.4, -0.73))),
}


def _nlerp(a, b, t):
    v = [x + (y - x) * t for x, y in zip(a, b)]
    n = math.sqrt(sum(c * c for c in v)) or 1.0
    return tuple(c / n for c in v)


def _blend(a, b, t):
    """A pose part way between two ATTACK keys: offsets and angles straight, directions along the arc between them."""
    return dict(
        hips=(tuple(x + (y - x) * t for x, y in zip(a['hips'][0], b['hips'][0])), a['hips'][1] + (b['hips'][1] - a['hips'][1]) * t),
        torso=tuple(x + (y - x) * t for x, y in zip(a['torso'], b['torso'])),
        sword=tuple(_nlerp(x, y, t) for x, y in zip(a['sword'], b['sword'])),
        shield=tuple(_nlerp(x, y, t) for x, y in zip(a['shield'], b['shield'])))


def attack_keys(arm, blade, strike_frame, end_frame):
    """The cleave keyed on every frame (and on the strike's own fractional frame). The ATTACK poses are placed in time
    (the wind-up peaks five frames before the strike and holds two and a half more, the follow-through lands three
    frames after it, the recovery holds until seven frames before the end), eased between, and each frame is solved
    whole, legs included: keyed only at the ATTACK poses, the blend between keys let the boots slide 23 mm and sink
    1 cm, because rotations blended bone by bone do not keep a foot where IK put it."""
    def solve(k):
        (upper, fore, want), (s_upper, s_fore) = k['sword'], k['shield']
        offset, turn = k['hips']
        return charforge.pose_rotations(arm, [('move', P + 'Hips', offset), ('turn', P + 'Hips', UP, turn)] + torso(*k['torso']) + [
            ('aim', P + 'RightArm', upper), ('aim_carry', P + 'RightForeArm', fore, P + 'RightHand', blade, want),
            ('aim', P + 'LeftArm', s_upper), ('aim', P + 'LeftForeArm', s_fore), ('leg', 'Left'), ('leg', 'Right')])

    times = [(1.0, 'guard'), (strike_frame - 5.0, 'windup'), (strike_frame - 2.6, 'coil'), (strike_frame, 'strike'),
             (strike_frame + 3.3, 'follow'), (end_frame - 7.0, 'hold'), (end_frame, 'guard')]
    frames = sorted(set([float(f) for f in range(1, int(end_frame) + 1)] + [strike_frame, end_frame]))
    keys = []
    for f in frames:
        i = max(j for j in range(len(times) - 1) if times[j][0] <= f + 1e-9)
        (f0, a), (f1, b) = times[i], times[min(i + 1, len(times) - 1)]
        t = 0.0 if f1 <= f0 else min(max((f - f0) / (f1 - f0), 0.0), 1.0)
        keys.append((f, solve(_blend(ATTACK[a], ATTACK[b], t * t * (3 - 2 * t)))))
    return keys


# ---------------------------------------------------------------- the three-hit combo

# The combo's clips in the order they chain. Each takes its length and strike from its own entry under
# commanders.commander_pip in src/shared/timings.json, which assets:check holds the export to and the page reads its
# contracts from (labs/world/combo.ts), so the clip and the game cannot time a hit apart.
COMBO = ('attack_1', 'attack_2', 'attack_3')
# Each hit's cancel point, the moment the next hit may take over (null for the finisher, which plays its recovery out),
# is its entry's `cancel` in timings.json, beside its length, strike and active frames (combo_timing). The build needs
# it because a chained hit starts from the pose the hit before it holds at its cancel frame (CHAIN). It lived here as
# COMBO_CANCEL and in labs/world/combo.ts alike, so a clip with other numbers had to be edited in both places in step;
# both now read the shared file, the sidecar records the cancel used (notes.combo), and assets:check holds the two equal.
# The combo's guard: every attack ends here, so each blends into idle; the first one also starts here.
# Weight settled a little, shield across the front, sword low and forward.
GUARD_SPEC = motion.spec(hips_off=(0.0, 0.0, -0.02), head=(0.0, 0.05),
                         sword=((-0.2, -0.05, -0.98), (-0.05, -0.55, -0.83), (0.0, -0.85, -0.5)),
                         shield=((0.3, 0.05, -1.0), (-0.52, -0.84, -0.05)))
# Hand-keyed keys, ((base, offset), spec): base '1' is the first frame, 's' the strike, 'e' the end; offset in frames.
# A first spec of None starts the attack from the previous attack's pose at its cancel frame (CHAIN), so a chained
# attack picks up where the last one was cut, give or take the hips' and torso's lead, which sets them off toward the
# next key on the first frame (13 to 47 mm at the hands, hips and head, about a frame's motion there, which the
# crossfade carries): the forehand ends low on the left, where the backhand loads; the backhand ends out on the right,
# where the finisher's sword starts to rise. The tracks run through them on splines, each body part on its own lag
# (lib/motion.py LAGS: hips lead, head and shield trail).
HAND = {
    # A quick forehand: the sword loads up behind the right shoulder while the hips and chest coil right and the
    # shield lifts clear, then cuts diagonally down across the front to the left hip, the hips unwinding first; the
    # follow-through carries on low to the left and overshoots before settling back to the guard.
    'attack_1': [
        (('1', 0), GUARD_SPEC),
        (('s', -3), motion.spec(hips_off=(-0.02, 0.01, -0.035), hips_turn=-0.22, torso=(-0.4, -0.05), head=(0.14, 0.05),
                                sword=((-0.55, 0.05, 0.4), (-0.15, 0.25, 0.95), (-0.35, 0.35, 0.87)),
                                shield=((0.6, -0.3, -0.45), (-0.3, -0.93, 0.15)))),
        (('s', -1.5), motion.spec(hips_off=(0.0, -0.01, -0.045), hips_turn=0.02, torso=(-0.05, 0.06), head=(0.02, 0.06),
                                  sword=((-0.5, -0.55, 0.2), (-0.25, -0.6, 0.75), (-0.45, -0.55, 0.7)),
                                  shield=((0.78, -0.15, -0.3), (0.1, -0.95, 0.2)))),
        (('s', 0), motion.spec(hips_off=(0.02, -0.03, -0.05), hips_turn=0.25, torso=(0.4, 0.15), head=(-0.1, 0.08),
                               sword=((-0.05, -0.85, -0.5), (0.45, -0.8, -0.4), (0.65, -0.55, -0.5)),
                               shield=((0.9, 0.05, -0.2), (0.35, -0.9, 0.2)))),
        (('s', 3), motion.spec(hips_off=(0.025, -0.035, -0.055), hips_turn=0.3, torso=(0.55, 0.2), head=(-0.18, 0.1),
                               sword=((0.2, -0.65, -0.73), (0.6, -0.5, -0.62), (0.75, -0.25, -0.62)),
                               shield=((0.88, 0.1, -0.3), (0.4, -0.85, 0.15)))),
        (('s', 6.5), motion.spec(hips_off=(0.012, -0.02, -0.04), hips_turn=0.14, torso=(0.25, 0.1), head=(-0.08, 0.07),
                                 sword=((0.0, -0.4, -0.92), (0.25, -0.6, -0.76), (0.35, -0.7, -0.62)),
                                 shield=((0.6, 0.08, -0.65), (-0.1, -0.95, 0.05)))),
        (('e', 0), GUARD_SPEC),
    ],
    # The backhand return: from the forehand's low finish the sword loads at the left hip with the chest turned left
    # (under the raised shield), then sweeps flat to the right at chest height, the hips leading the turn back; it
    # carries on out to the right and slows before the guard.
    'attack_2': [
        (('1', 0), None),
        (('s', -3), motion.spec(hips_off=(0.02, 0.0, -0.04), hips_turn=0.24, torso=(0.5, 0.08), head=(-0.15, 0.06),
                                sword=((0.15, -0.72, -0.68), (0.85, -0.25, -0.2), (0.55, 0.6, 0.05)),
                                shield=((0.82, 0.08, -0.3), (0.35, -0.9, 0.15)))),
        (('s', -1.5), motion.spec(hips_off=(0.0, -0.01, -0.045), hips_turn=0.0, torso=(0.1, 0.08), head=(0.0, 0.05),
                                  sword=((0.0, -0.9, -0.3), (0.4, -0.9, -0.1), (0.35, -0.92, 0.1)),
                                  shield=((0.8, 0.12, -0.4), (0.3, -0.85, 0.05)))),
        (('s', 0), motion.spec(hips_off=(-0.02, -0.02, -0.05), hips_turn=-0.25, torso=(-0.4, 0.1), head=(0.15, 0.05),
                               sword=((-0.55, -0.75, -0.2), (-0.65, -0.72, -0.1), (-0.85, -0.45, -0.1)),
                               shield=((0.6, 0.15, -0.75), (0.2, -0.85, -0.45)))),
        (('s', 3), motion.spec(hips_off=(-0.025, -0.02, -0.055), hips_turn=-0.3, torso=(-0.55, 0.12), head=(0.2, 0.05),
                               sword=((-0.85, -0.25, -0.3), (-0.9, 0.15, -0.2), (-0.75, 0.6, -0.1)),
                               shield=((0.55, -0.3, -0.75), (-0.2, -0.95, 0.1)))),
        (('s', 6.5), motion.spec(hips_off=(-0.012, -0.01, -0.04), hips_turn=-0.15, torso=(-0.28, 0.08), head=(0.1, 0.05),
                                 sword=((-0.6, -0.2, -0.75), (-0.5, -0.45, -0.72), (-0.45, -0.7, -0.55)),
                                 shield=((0.42, -0.1, -0.9), (-0.4, -0.9, -0.05)))),
        (('e', 0), GUARD_SPEC),
    ],
    # The finisher: the sword rises overhead with the weight back while the shield punches forward, holds, then the
    # left foot steps 22 cm forward as the sword chops down to the strike; the body follows through low and bent and
    # holds before the foot steps back into the guard, so the clip ends where it began and the play mode, which plants
    # him for the finisher, never has to move his root to follow the step.
    'attack_3': [
        (('1', 0), None),
        (('s', -9), motion.spec(hips_off=(-0.02, 0.02, -0.025), hips_turn=-0.12, torso=(-0.2, -0.05), head=(0.06, 0.0),
                                sword=((-0.85, 0.0, 0.1), (-0.6, -0.1, 0.8), (-0.7, -0.2, 0.7)),
                                shield=((0.4, -0.35, -0.85), (-0.45, -0.88, 0.1)))),
        (('s', -6), motion.spec(hips_off=(-0.03, 0.04, -0.03), hips_turn=-0.2, torso=(-0.35, -0.15), head=(0.1, -0.05),
                                sword=((-0.35, 0.2, 0.92), (0.15, 0.55, 0.82), (0.05, 0.85, 0.3)),
                                shield=((0.45, -0.5, -0.7), (-0.35, -0.9, 0.2)))),
        (('s', -3), motion.spec(hips_off=(-0.035, 0.03, -0.04), hips_turn=-0.25, torso=(-0.4, -0.2), head=(0.12, -0.08),
                                sword=((-0.3, 0.3, 0.9), (0.2, 0.65, 0.73), (0.1, 0.9, 0.1)),
                                shield=((0.5, -0.55, -0.65), (-0.3, -0.92, 0.2)), step_l=(0.0, -0.08, 0.05))),
        (('s', -1.5), motion.spec(hips_off=(-0.005, -0.06, -0.07), hips_turn=-0.03, torso=(-0.05, 0.1), head=(0.02, 0.05),
                                  sword=((-0.25, -0.35, 0.9), (-0.1, -0.75, 0.65), (0.0, -0.8, 0.6)),
                                  shield=((0.7, -0.15, -0.65), (0.1, -0.85, -0.3)), step_l=(0.0, -0.17, 0.04))),
        (('s', 0), motion.spec(hips_off=(0.02, -0.12, -0.09), hips_turn=0.15, torso=(0.2, 0.32), head=(-0.05, 0.15),
                               sword=((-0.15, -0.92, -0.36), (-0.05, -0.85, -0.52), (0.05, -0.7, -0.71)),
                               shield=((0.85, 0.1, -0.5), (0.45, -0.75, -0.45)), step_l=(0.0, -0.22, 0.0))),
        (('s', 3), motion.spec(hips_off=(0.02, -0.14, -0.1), hips_turn=0.2, torso=(0.25, 0.4), head=(-0.08, 0.18),
                               sword=((-0.05, -0.8, -0.6), (0.05, -0.7, -0.71), (0.15, -0.66, -0.73)),
                               shield=((0.85, 0.15, -0.5), (0.45, -0.7, -0.55)), step_l=(0.0, -0.22, 0.0))),
        (('e', -8), motion.spec(hips_off=(0.015, -0.12, -0.09), hips_turn=0.15, torso=(0.2, 0.34), head=(-0.06, 0.15),
                                sword=((-0.08, -0.8, -0.6), (0.03, -0.7, -0.71), (0.12, -0.68, -0.72)),
                                shield=((0.8, 0.1, -0.58), (0.4, -0.75, -0.5)), step_l=(0.0, -0.22, 0.0))),
        (('e', -4), motion.spec(hips_off=(0.0, -0.05, -0.05), hips_turn=0.05, torso=(0.08, 0.15), head=(0.0, 0.08),
                                sword=((-0.15, -0.3, -0.94), (-0.05, -0.6, -0.8), (0.0, -0.8, -0.6)),
                                shield=((0.5, 0.05, -0.85), (-0.3, -0.9, -0.2)), step_l=(0.0, -0.08, 0.04))),
        (('e', 0), GUARD_SPEC),
    ],
}
# The hit each chained hit starts from, at that hit's cancel frame.
CHAIN = {'attack_2': 'attack_1', 'attack_3': 'attack_2'}
# Where the combo comes from. The string 'quaternius' takes the three hits, their recoveries, a block and a guard idle
# from the Quaternius library (QUATERNIUS below, build_quaternius) and regrips the sword for every clip. A dict gives each
# hit 'hand' (HAND above) or 'unimate', a UniMate (CC BY-NC, accepted by the owner) generation stored as joint positions
# in UNIMATE_DIR/<hit>.json and retargeted at build time; hand-keyed won against UniMate's text-to-motion for all three
# hits, and no generation is committed. The hand-keyed set is {'attack_1': 'hand', 'attack_2': 'hand', 'attack_3': 'hand'}.
COMBO_SOURCE = 'quaternius'
# The comparison set the Quaternius build also ships, each hit's source as a dict COMBO_SOURCE may give, its clips named
# with COMPARE_SUFFIX and timed by their own timings.json entries (attack_1_hand ...), so the owner can still play the
# hand-keyed swings beside the library's; None ships the Quaternius set alone. A dict COMBO_SOURCE (the hand-keyed or
# UniMate combo as attack_1 to attack_3) ships no comparison set.
COMPARE_SOURCE = {'attack_1': 'hand', 'attack_2': 'hand', 'attack_3': 'hand'}
COMPARE_SUFFIX = '_hand'
UNIMATE_DIR = 'blender/sources/unimate'
# The Quaternius Universal Animation Library 2, Standard, Unreal-Godot GLB with root motion (CC0, quaternius.com; its
# licence beside it). `hits` and `extra` name the library clip each exported clip comes from; `grip_clip` is the clip
# whose fist gives the grip axis (the library closes the same fist through every sword clip); `held_shield` holds a
# clip's shield arm at another clip's frame, relative to the chest (the block parries with the sword while the shield
# stays raised as in the guard idle: Sword_Block alone swung the shield behind him); `loops` are exported as loops.
# Each hit's length and strike are the clip's own, measured here, and timings.json must agree within a frame
# (build_quaternius stops the build otherwise, naming the numbers to set).
QUATERNIUS = dict(
    file='blender/sources/quaternius/UAL2_Standard_RM.glb',
    grip_clip='Sword_Regular_A',
    hits={'attack_1': 'Sword_Regular_A', 'attack_2': 'Sword_Regular_B', 'attack_3': 'Sword_Regular_C'},
    extra={'attack_1_rec': 'Sword_Regular_A_Rec', 'attack_2_rec': 'Sword_Regular_B_Rec', 'block': 'Sword_Block',
           'idle_guard': 'Idle_Shield_Loop'},
    held_shield={'block': ('Idle_Shield_Loop', 1)},
    loops=('idle_guard',),
    # The CharForge clips the regrip also changes: each takes the smallest constant wrist turn that keeps the sword out
    # of the body (retarget.clear_carry), and those named here try the regrip's own turn first, which gives back their
    # approved carry: the run's high fist held the regripped blade upright through his head.
    carry_as_before=('run',),
)
# A light hit's cancel window opens this many frames after its strike (the cut has passed) and stays open until the
# blade settles below SETTLE_MPS; the sidecar records both for each hit (notes.quaternius), and timings.json's single
# cancel point is the window's opening.
CANCEL_AFTER_STRIKE_FRAMES = 3
SETTLE_MPS = 1.5


def _key_time(at, strike_frame, end_frame):
    base, offset = at
    return {'1': 1.0, 's': strike_frame, 'e': end_frame}[base] + offset


def combo_timing(timings, attack, suffix=''):
    """A hit's timing in frames from 1: (strike frame, end frame, cancel frame or None). The length, strike and cancel are
    its entry under commanders.commander_pip in timings.json (the hit's name with `suffix`, so the comparison set reads
    attack_1_hand), and a missing entry or a missing `cancel` key stops the build, as the attack's does: a cancel of null
    is the finisher's, which has none."""
    key = attack + suffix
    entry = timings['commanders'][NAME].get(key)
    if entry is None:
        raise ValueError(f'src/shared/timings.json has no commanders.{NAME}.{key} entry, which times that hit of the combo')
    if 'cancel' not in entry:
        raise ValueError(f'src/shared/timings.json commanders.{NAME}.{key} has no cancel (a number, or null for the finisher), '
                         'which the chained hit after it is keyed from')
    cancel = entry['cancel']
    return 1 + entry['strike'] * anim.FPS, 1 + entry['duration'] * anim.FPS, None if cancel is None else 1 + cancel * anim.FPS


def hand_key_times(attack, strike_frame, end_frame, hand=None):
    """Each of a hand-keyed hit's key times in frames, checked: they must rise strictly and lie inside the clip, from
    frame 1 to its end. A key out of order or outside the clip used to reach the spline as it was, which reads a key out
    of order as a curve that doubles back and holds a key past the end at the end pose, so a strike key moved past its
    neighbour, or past a timing change that shortened the hit, built a clip that quietly played something else."""
    keys = (hand or HAND)[attack]
    times = [_key_time(at, strike_frame, end_frame) for at, _ in keys]
    for i, ((base, offset), t) in enumerate(zip([at for at, _ in keys], times)):
        if not 1.0 - 1e-6 <= t <= end_frame + 1e-6:
            raise ValueError(f"{attack} key {i} ('{base}' {offset:+g} frames) falls at frame {t:.2f}, outside the clip's frames 1 to {end_frame:.2f}")
        if i and t <= times[i - 1] + 1e-6:
            prev_base, prev_offset = keys[i - 1][0]
            raise ValueError(f"{attack} key {i} ('{base}' {offset:+g} frames, frame {t:.2f}) does not come after key {i - 1} "
                             f"('{prev_base}' {prev_offset:+g} frames, frame {times[i - 1]:.2f}): key times must rise strictly")
    return times


def hand_spec_at(attack, frames, start=None):
    """spec_at(frame) for a hand-keyed hit; frames = {hit: (strike, end, cancel)}, and `start` the pose its first key
    takes when HAND leaves that key to the hit before it."""
    strike_frame, end_frame, _ = frames[attack]
    first = start if start is not None else GUARD_SPEC
    times = hand_key_times(attack, strike_frame, end_frame)
    keys = [(t, first if sp is None else sp) for t, (_, sp) in zip(times, HAND[attack])]
    return lambda f: motion.track_at(keys, f)


def unimate_spec_at(ctx, attack, arm, frames, start=None):
    """The stored UniMate generation retimed to the hit's contract and blended out of and back into the guard; the
    finisher's step stays the designed one. The generation is read from the repository, never from UniMate or a
    scratch folder, so the build keeps to the repository and Blender; selected without its file, or with one that lacks
    `positions` or `joint_names`, check_combo_sources stops the build before any hit is baked."""
    import json
    # check_combo_sources, at the top of build_combo, has already held the file and its keys to this.
    path = ctx.root / UNIMATE_DIR / f'{attack}.json'
    data = json.loads(path.read_text(encoding='utf-8'))
    strike_frame, end_frame, _ = frames[attack]
    pos = np.array(data['positions'], float)
    hip_height = float(charforge.bone_head(arm, P + 'Hips').z)
    specs = motion.smooth_specs(motion.unimate_specs(pos, data['joint_names'], hip_height, GUARD_SPEC), 1.0)
    window = motion.strike_window(pos, data['joint_names'])[:3]
    base = motion.retimed(specs, window, strike_frame, end_frame, start if start is not None else GUARD_SPEC, end_spec=GUARD_SPEC)
    if attack != 'attack_3':
        return base
    hand = hand_spec_at(attack, frames, start)

    def at(f):
        sp = dict(base(f))
        sp['step_l'] = hand(f)['step_l']
        sp['hips_off'] = sp['hips_off'] + (hand(f)['hips_off'] - GUARD_SPEC['hips_off']) * np.array([0.0, 1.0, 0.0])
        return sp
    return at


def check_combo_sources(root, sources=None):
    """Stops the build before anything is baked unless COMBO_SOURCE gives each hit 'hand' or 'unimate' and every hit
    that selects 'unimate' has its generation in the repository with the `positions` and `joint_names` it is read from,
    naming every fault at once. The file was looked for only when its hit came to be baked, so a missing finisher
    generation stopped the build after the two light hits had been baked and measured, and a file without either key
    stopped it with a bare KeyError. A FileNotFoundError means every fault is a missing file; a file that is there but
    is not JSON or lacks a key is a ValueError, as is any mix of the two (it was a FileNotFoundError for all of them)."""
    import json
    sources = COMBO_SOURCE if sources is None else sources
    if sources == 'quaternius':
        if not (root / QUATERNIUS['file']).is_file():
            raise FileNotFoundError(f"COMBO_SOURCE is 'quaternius', but {QUATERNIUS['file']} is not in the repository")
        return
    if not isinstance(sources, dict):
        raise ValueError(f"COMBO_SOURCE must be 'quaternius' or give each of {', '.join(COMBO)} 'hand' or 'unimate', not {sources!r}")
    unknown = {k: v for k, v in sources.items() if v not in ('hand', 'unimate')}
    if unknown or set(sources) != set(COMBO):
        raise ValueError(f"COMBO_SOURCE must give each of {', '.join(COMBO)} 'hand' or 'unimate', not {sources}")
    faults = []
    invalid = False
    for attack in COMBO:
        if sources[attack] != 'unimate':
            continue
        path = root / UNIMATE_DIR / f'{attack}.json'
        if not path.is_file():
            faults.append(f"COMBO_SOURCE selects 'unimate' for {attack}, but {UNIMATE_DIR}/{attack}.json is not in the repository: "
                          f"commit the generation's joint positions there, or set {attack} back to 'hand'")
            continue
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
        except ValueError as error:
            faults.append(f'{UNIMATE_DIR}/{attack}.json is not JSON ({error})')
            invalid = True
            continue
        missing = [key for key in ('positions', 'joint_names') if not isinstance(data, dict) or key not in data]
        if missing:
            faults.append(f"{UNIMATE_DIR}/{attack}.json has no {' or '.join(repr(key) for key in missing)}, which the retarget reads")
            invalid = True
    if faults:
        raise (ValueError if invalid else FileNotFoundError)('; '.join(faults))


def build_combo(ctx, arm, body, armour, blade, sources=None, suffix=''):
    """attack_1 to attack_3 baked in chain order from `sources` (COMBO_SOURCE's form, a dict of 'hand' or 'unimate'),
    each checked (the shield pushed clear where the sword would cross it) and measured, and each chained hit started
    from the pose the hit before it plays at its cancel frame. Each clip is named, and timed from timings.json, as its
    hit with `suffix` (the comparison set's attack_1_hand ...). Returns {clip: (action, strike frame, cancel frame or
    None, checks, blade speed)}. Stops the build when a hit still sends the blade through the shield or the body after
    the shield fix's tries: the checks used to be recorded and nothing failed, so only the sidecar test caught it, after
    the GLB had been written."""
    sources = COMBO_SOURCE if sources is None else sources
    check_combo_sources(ctx.root, sources)
    timings = ctx.timings()
    frames = {attack: combo_timing(timings, attack, suffix) for attack in COMBO}
    played = {}
    out = {}
    for attack in COMBO:
        name = attack + suffix
        prev = CHAIN.get(attack)
        start = played[prev](frames[prev][2]) if prev else None
        if sources[attack] == 'unimate':
            at = unimate_spec_at(ctx, attack, arm, frames, start)
        else:
            at = hand_spec_at(attack, frames, start)
        strike_frame, end_frame, cancel = frames[attack]
        action = motion.bake(arm, name, at, end_frame, strike_frame, blade)
        if action.name != name:
            raise ValueError(f'{name}: the clip was named {action.name!r}; an action of that name already existed')
        action, checks, played[attack] = motion.shield_fix(arm, body, armour, action, strike_frame, at, end_frame, blade, name)
        if checks['sword_shield_overlaps'] > 0 or checks['blade_body_overlaps'] > 0:
            raise ValueError(f"{name}: the sword still crosses the shield ({checks['sword_shield_overlaps']} overlaps, frames "
                             f"{checks['frames_crossing_shield']}) or the body ({checks['blade_body_overlaps']} overlaps, frames "
                             f"{checks['frames_blade_in_body']}) after the shield fix")
        out[name] = (action, strike_frame, cancel, checks, motion.blade_speed(arm, armour, action, strike_frame))
    return out


def quaternius_library(ctx):
    """The library's armature and clips in the scene (its mannequin mesh deleted), and its fist's grip axis at rest."""
    check_combo_sources(ctx.root)
    src, actions = retarget.import_library(ctx.root / QUATERNIUS['file'])
    clips = list(QUATERNIUS['hits'].values()) + list(QUATERNIUS['extra'].values()) + [QUATERNIUS['grip_clip']]
    missing = sorted({c for c in clips if c not in actions})
    if missing:
        raise ValueError(f"{QUATERNIUS['file']} has no clip {', '.join(missing)} (has {', '.join(sorted(actions))})")
    return src, actions, retarget.grip_axis(src, actions[QUATERNIUS['grip_clip']])


def build_quaternius(ctx, arm, body, armour, src, actions, grip):
    """The Quaternius set on the commander (QUATERNIUS): each clip retargeted with its contacts cleared (the shield arm
    runs ahead or opens where the sword would cross the shield, the sword arm swings off the body, the shield and the
    blade lifted clear of the ground, the boots stood on it) and, for the hits, the edge rolled onto the cut. Stops the
    build when a clip still crosses, when a boot or the sword leaves the ground contract, or when a hit's measured
    length or strike differs from its timings.json entry by more than a frame. Returns (combo, extra, roots, notes):
    combo as build_combo returns it, {hit: (action, strike frame, cancel frame or None, checks, blade speed)}; extra
    {clip: (action, strike frame or None)}; roots {clip: [(seconds, forward, side)]}; notes for the sidecar."""
    entries = ctx.timings()['commanders'][NAME]
    combo, extra, roots, notes = {}, {}, {}, {}
    for key, clip in list(QUATERNIUS['hits'].items()) + list(QUATERNIUS['extra'].items()):
        action = actions[clip]
        n = int(action.frame_range[1] - action.frame_range[0]) + 1
        s_i, _seconds, _peak = retarget.strike(src, action, grip)
        strike_frame = 1 + s_i
        kw = {}
        if key in QUATERNIUS['held_shield']:
            hold, frame = QUATERNIUS['held_shield'][key]
            kw['shield_pose'] = (actions[hold], frame, np.ones(n))
        act, root, checks, fixes = retarget.clean_clip(src, action, arm, body, armour, key, strike_frame, edge=key in COMBO, **kw)
        if act.name != key:
            raise ValueError(f'{key}: the clip was named {act.name!r}; an action of that name already existed')
        if checks['sword_shield_overlaps'] > 0 or checks['blade_body_overlaps'] > 0:
            raise ValueError(f"{key} ({clip}): the sword still crosses the shield (frames {checks['frames_crossing_shield']}) or the "
                             f"body (frames {checks['frames_blade_in_body']}) after the contact fixes")
        ground = motion.clip_ground(arm, body, armour, act, checks)
        if abs(ground['boot_min_z']) > 1e-4 or ground['sword_min_z'] < charforge.BLADE_CLEARANCE_M - 0.0005:
            raise ValueError(f'{key} ({clip}): lowest boot point {ground["boot_min_z"]} m (want 0 within 0.1 mm), lowest sword point '
                             f'{ground["sword_min_z"]} m (want {charforge.BLADE_CLEARANCE_M} m or more)')
        speed = motion.blade_speed(arm, armour, act, strike_frame)
        duration, strike = (n - 1) / anim.FPS, (strike_frame - 1) / anim.FPS
        record = dict(clip=clip, duration=round(duration, 3), fixes=fixes, feet=retarget.foot_report(arm, armour, act, root))
        roots[key] = root
        if key in COMBO:
            entry = entries.get(key) or {}
            if abs(entry.get('duration', -1) - duration) > 1 / anim.FPS or abs(entry.get('strike', -1) - strike) > 1 / anim.FPS:
                cancel = 'null' if key == COMBO[-1] else round(strike + CANCEL_AFTER_STRIKE_FRAMES / anim.FPS, 3)
                raise ValueError(f'{key} ({clip}) measures {duration:.3f} s with its strike at {strike:.3f} s, but src/shared/timings.json '
                                 f'commanders.{NAME}.{key} is {entry}: set it to duration {round(duration, 3)}, strike {round(strike, 3)}, '
                                 f'activeFrom {round(strike - 0.05, 3)}, activeTo {round(strike + 0.08, 3)}, cancel {cancel}')
            cancel = entry.get('cancel')
            cancel_frame = None if cancel is None else 1 + cancel * anim.FPS
            settle = retarget.settle_frame(arm, armour, act, root, strike_frame, SETTLE_MPS)
            record.update(strike=round(strike, 3), edge=retarget.edge_alignment(arm, armour, act, root, strike_frame),
                          cancel_window=[round(strike + CANCEL_AFTER_STRIKE_FRAMES / anim.FPS, 3), round((settle - 1) / anim.FPS, 3)])
            combo[key] = (act, strike_frame, cancel_frame, checks, speed)
        else:
            extra[key] = (act, strike_frame if key == 'block' else None)
            record.update(checks=checks)
        notes[key] = record
    return combo, extra, roots, notes


def build(ctx, source=SOURCE, name=NAME):
    """Builds commanders/<name>.glb from `source`; both default to Pip's, and a comparison build of another CharForge
    publication passes its own."""
    # The attack's contract is Pip's own entry in src/shared/timings.json, which assets:check holds the exported clip to.
    # It once fell back to the Bulwark's entry while Pip had none, and a missing entry now stops the build instead.
    timing = ctx.timings()['commanders'][NAME]['attack']
    # The preview folder is emptied now (BuildContext.preview_dir), so a build that stops part way leaves no renders of
    # an older build behind for the contact sheet to take for this one's.
    if ctx.previews_enabled:
        ctx.preview_dir(name)
    strike_frame = 1 + timing['strike'] * anim.FPS
    end_frame = 1 + timing['duration'] * anim.FPS
    s = charforge.settings(PIP)
    src = charforge.import_source(ctx.root / source)
    arm, orig = src.arm, src.body
    shape = charforge.reshape(arm, orig, s)
    charforge.feature_zones(orig, s)
    charforge.strip_fingers(arm, orig, s)
    painted = charforge.paint_source(orig, src.image, shape.chin, s, ctx.textures / 'brush_strokes.png')
    armour = charforge.build_armour(arm, orig, painted.labels, shape.chin, charforge.armour_regions(), s)
    work = ctx.bake_dir('commanders') / f'{name}_work'
    work.mkdir(parents=True, exist_ok=True)
    armour_paths = charforge.paint_armour(armour, f'{name}_armour', work, ctx.textures)
    body, decimation = charforge.decimate_protecting_face(orig, arm, src.image, shape.chin, scene.tri_count([armour]), s)
    charforge.normals_from_source(orig, body)
    atlas = charforge.repack_body_uvs(body, shape.chin, painted.image, s, work)
    morphs = charforge.transfer_morphs(orig, body)
    ink.set_ink(body, 1.0)
    # A plain stand-in for the source's body material: the atlas bake routes materials by name, and the source's own
    # name is the character author's choice.
    body.data.materials[0] = bpy.data.materials.new(f'{name}_body_source')
    charforge.bind(body, arm)
    charforge.bind(armour, arm)
    bpy.data.objects.remove(orig)
    landmarks = charforge.face_landmarks(body)
    charforge.ink_and_skin(body, shape.chin, src.image, painted.image)
    charforge.relax_face_normals(body, shape.chin, landmarks)
    charforge.paint_commander(arm, body, armour, src.image, painted.image, atlas, armour_paths, landmarks, shape.chin,
                              ctx.bake_dir('commanders'), name, s, work)
    body.name = body.data.name = 'commander_body'
    armour.name = armour.data.name = 'commander_armour'
    arm.name = 'commander_rig'
    library = grip = None
    # The blade's axis on the CharForge grip, before any regrip: the hand-keyed comparison set aims by it.
    blade_before = blade_axis(armour, arm)
    if COMBO_SOURCE == 'quaternius':
        # The sword turns in the fist before any clip is made or measured, so the idle's and the run's ground pass and
        # the authored attack all see the grip the Quaternius clips are swung with.
        library = quaternius_library(ctx)
        grip = retarget.regrip_sword(arm, armour, library[2], blade_axis(armour, arm))
    clips = charforge.retarget_clips(arm, src.actions, shape.scale, s['clips'])
    carry = {}
    if grip is not None:
        for key, action in clips.items():
            prefer = grip['turn_deg'] if key in QUATERNIUS['carry_as_before'] else 0.0
            carry[key] = retarget.clear_carry(arm, body, armour, action, prefer_deg=prefer)[0]
    ground = charforge.ground_clips(arm, body, armour, clips)
    blade = blade_axis(armour, arm)
    attack = charforge.make_action_quat(arm, 'attack', attack_keys(arm, blade, strike_frame, end_frame), loc_bones=(P + 'Hips',))
    checks = charforge.attack_checks(arm, body, armour, attack, strike_frame)
    # The authored clips need no offset: their boots are held by IK where they stand in the rest pose, on the ground (the
    # finisher's step lifts one boot and sets it down again on the ground). Each records its lowest boot and sword points.
    ground['attack'] = motion.clip_ground(arm, body, armour, attack, checks)
    extra, roots, q_notes = {}, {}, {}
    # Each combo clip's set and source for the sidecar (notes.combo): assets:check reads each set's last hit as its
    # finisher, so the two sets' finishers are told apart by `set`.
    sets = {}
    if library is not None:
        combo, extra, roots, q_notes = build_quaternius(ctx, arm, body, armour, *library)
        # The library's armature and clips go before the previews and the export, whose ACTIONS mode ships every action.
        retarget.drop_library(library[0], library[1])
        sets.update({key: ('quaternius', 'quaternius') for key in combo})
        if COMPARE_SOURCE is not None:
            compare = build_combo(ctx, arm, body, armour, {'held': blade, 'aim': blade_before}, COMPARE_SOURCE, COMPARE_SUFFIX)
            sets.update({key: ('hand', COMPARE_SOURCE[key[:-len(COMPARE_SUFFIX)]]) for key in compare})
            combo.update(compare)
    else:
        combo = build_combo(ctx, arm, body, armour, blade)
        sets.update({key: ('hand', COMBO_SOURCE[key]) for key in combo})
    for key, (action, _strike, _cancel, combo_checks, _speed) in combo.items():
        ground[key] = motion.clip_ground(arm, body, armour, action, combo_checks)
    for key, (action, _strike) in extra.items():
        ground[key] = motion.clip_ground(arm, body, armour, action, q_notes[key]['checks'])
    if ctx.previews_enabled:
        out = ctx.preview_dir(name)
        export.render_views([body, armour], out, name, views=4, size=640)
        # The combo's filmstrips go in a folder of their own, which the contact sheet (tools/assets/sheet.mjs) does not
        # read: it tiles every render in the asset's folder at the size of the widest, a filmstrip, and with the three
        # hits' 39 renders beside the attack's the sheet grew to 9,216 x 34,600 px, past what sharp will write, and the
        # build failed after publishing.
        combo_out = out / 'combo'
        combo_out.mkdir(parents=True, exist_ok=True)
        for action, folder in [(attack, out)] + [(entry[0], combo_out) for entry in list(combo.values()) + list(extra.values())]:
            front = export.render_action(arm, [body, armour], action, folder, name, frames=6)
            side = charforge.render_action_side(arm, [body, armour], action, folder, name, frames=6)
            charforge.filmstrip([front, side], folder / f'{name}_{action.name}_strip.png')
        charforge.render_face([body, armour], out / f'{name}_face.png', shape.chin)
    meta = charforge.export_commander(arm, [body, armour], ctx.raw_path('commanders', name))
    shutil.rmtree(work, ignore_errors=True)
    return [AssetRecord(
        name=name, family='commanders', file=f'commanders/{name}.glb', nodes=['commander_rig', 'commander_body', 'commander_armour'],
        tris=scene.tri_count([body, armour]),
        animations=[
            AnimRecord('idle', meta['clips']['idle'], True),
            AnimRecord('run', meta['clips']['run'], True),
            AnimRecord('attack', anim.duration(attack), False, strike=(strike_frame - 1) / anim.FPS),
        ] + [AnimRecord(key, anim.duration(action), False, strike=(sf - 1) / anim.FPS) for key, (action, sf, *_rest) in combo.items()]
        + [AnimRecord(key, anim.duration(action), key in QUATERNIUS['loops'], strike=None if sf is None else (sf - 1) / anim.FPS)
           for key, (action, sf) in extra.items()],
        notes=dict(source=source, bones=meta['bones'], morphs=meta['meshes']['commander_body']['morphs'],
                   height_m=meta['height_m'], decimation=decimation, morph_transfer=morphs, attack_checks=checks,
                   clip_ground=ground,
                   combo={key: dict(set=sets[key][0], source=sets[key][1],
                                    cancel=None if c is None else round((c - 1) / anim.FPS, 3), checks=chk, blade=spd)
                          for key, (_action, _sf, c, chk, spd) in combo.items()},
                   # Each Quaternius clip's travel, for the game to apply as root motion: times in seconds from 0, and
                   # forward and side metres (side positive to his right), cumulative from 0. The clips carry none.
                   **({} if library is None else dict(
                       root_motion={key: retarget.root_motion_notes(root) for key, root in roots.items()},
                       quaternius=dict(file=QUATERNIUS['file'], grip=grip, carry_turn_deg=carry, clips=q_notes))),
                   ),
    )]
