"""Commander Pip: the player's commander, rebuilt from the owner's CharForge character Pip (a cartoon courier) into a
lightly armoured cartoon knight with Pip's own face and hair. The owner chose this look over a helmeted one and
approved its in-engine face after five rounds of fixes; this recipe reproduces it from the committed source.

Source: SOURCE, blender/sources/charforge/pip.glb, the GLB the owner publishes at
https://majieddd.github.io/charforge/pip.glb, as published on 2026-10-03 (78,233 triangles on a 64-bone Mixamo
skeleton, a 2,048 albedo, the face morphs blink_L, blink_R, smile, brows_up and pucker, a jaw bone and 19 clips). It
differs from the first publication (2026-09-28) only in its clips: idle and run carry new arm and leg rotations.
Every step is a lib/charforge.py function; this file holds what is Pip's own: the settings that differ from the
template's defaults, the attack, and the record.

Result: 1.78 m and 5.0 heads, 24 bones (the finger bones go: the hands stay culled inside the mitten gauntlets), at most
24,000 triangles with the face kept dense, two meshes (commander_body with the five morphs, `_ink` and `_skin`;
commander_armour with `_ink`), one 1,024 atlas for body and armour and a 1,024 head texture. Clips: Pip's idle and run
retargeted onto the reshaped rig, each raised by one constant so its lowest boot point stands on the ground
(lib/charforge.py ground_clips), and an attack authored here (0.85 s, strike at 0.34 s from src/shared/timings.json).
Each clip's lowest point is recorded in the sidecar's notes as clip_ground, which a unit test holds to the ground.

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

from lib import anim, charforge, export, ink, scene
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


def build(ctx, source=SOURCE, name=NAME):
    """Builds commanders/<name>.glb from `source`; both default to Pip's, and a comparison build of another CharForge
    publication passes its own."""
    # The attack's contract is Pip's own entry in src/shared/timings.json, which assets:check holds the exported clip to.
    # It once fell back to the Bulwark's entry while Pip had none, and a missing entry now stops the build instead.
    timing = ctx.timings()['commanders'][NAME]['attack']
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
    clips = charforge.retarget_clips(arm, src.actions, shape.scale, s['clips'])
    ground = charforge.ground_clips(arm, body, armour, clips)
    attack = charforge.make_action_quat(arm, 'attack', attack_keys(arm, blade_axis(armour, arm), strike_frame, end_frame), loc_bones=(P + 'Hips',))
    checks = charforge.attack_checks(arm, body, armour, attack, strike_frame)
    # The attack needs no offset: its boots are held by IK where they stand in the rest pose, on the ground.
    ground['attack'] = dict(offset_m=0.0, min_z=checks['min_z'])
    if ctx.previews_enabled:
        out = ctx.preview_dir(name)
        export.render_views([body, armour], out, name, views=4, size=640)
        front = export.render_action(arm, [body, armour], attack, out, name, frames=6)
        side = charforge.render_action_side(arm, [body, armour], attack, out, name, frames=6)
        charforge.filmstrip([front, side], out / f'{name}_attack_strip.png')
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
        ],
        notes=dict(source=source, bones=meta['bones'], morphs=meta['meshes']['commander_body']['morphs'],
                   height_m=meta['height_m'], decimation=decimation, morph_transfer=morphs, attack_checks=checks,
                   clip_ground=ground),
    )]
