"""Blender-side unit tests: blender -b --factory-startup --python tests/blender/run_tests.py
Each test_* function builds what it needs from an empty scene and asserts."""
import json
import pathlib
import struct
import sys
import tempfile
import traceback

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'blender'))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from lib import anim, export, rig  # noqa: E402
from lib import geo, ink, palette  # noqa: E402
from lib import paint  # noqa: E402
from lib import scene  # noqa: E402
from lib.png import linear_to_srgb, srgb_to_linear, write_png  # noqa: E402


def glb_json(path):
    data = pathlib.Path(path).read_bytes()
    length = struct.unpack('<I', data[12:16])[0]
    return json.loads(data[20:20 + length])


def glb_vec3(path, gj, index):
    """A float VEC3 accessor read from a GLB's binary chunk, back in Blender's Z-up axes."""
    blob, acc = pathlib.Path(path).read_bytes(), gj['accessors'][index]
    start = 28 + struct.unpack('<I', blob[12:16])[0] + gj['bufferViews'][acc['bufferView']].get('byteOffset', 0) + acc.get('byteOffset', 0)
    v = np.frombuffer(blob, np.float32, acc['count'] * 3, start).reshape(-1, 3)
    return np.stack([v[:, 0], -v[:, 2], v[:, 1]], axis=1)


def ellipsoid_error_deg(points, normals, center, radii):
    """Largest angle between each normal and normalize((p - center) / radii^2), the geo.ellipsoid_normals proxy."""
    want = (np.asarray(points) - center) / np.square(radii)
    cos = (want * normals).sum(1) / np.linalg.norm(want, axis=1) / np.linalg.norm(normals, axis=1)
    return float(np.degrees(np.arccos(np.clip(cos, -1.0, 1.0))).max())


def test_png_round_trip(tmp):
    image = np.zeros((4, 6, 3))
    image[0, :, 0] = 1.0  # top row red
    image[3, :, 2] = 1.0  # bottom row blue
    path = tmp / 'rt.png'
    write_png(path, image)
    loaded = bpy.data.images.load(str(path))
    pixels = np.empty(4 * 6 * 4, np.float32)
    loaded.pixels.foreach_get(pixels)
    pixels = pixels.reshape(4, 6, 4)[::-1]  # Blender stores the bottom row first
    assert loaded.size[0] == 6 and loaded.size[1] == 4, loaded.size[:]
    assert pixels[0, 0, 0] > 0.99 and pixels[0, 0, 2] < 0.01, pixels[0, 0]
    assert pixels[3, 0, 2] > 0.99 and pixels[3, 0, 0] < 0.01, pixels[3, 0]


def test_srgb_conversions_invert(tmp):
    values = np.linspace(0, 1, 11)
    assert np.allclose(srgb_to_linear(linear_to_srgb(values)), values, atol=1e-6)


def test_region_material_carries_linear_colours(tmp):
    mat = palette.region('t_steel', '#808080', emit_hex='#59f2ff')
    base = list(mat['p99_base'])
    assert abs(base[0] - 0.2158605) < 1e-4, base
    assert max(mat['p99_emit']) > 0.5
    assert palette.region('t_steel', '#808080') is mat  # cached by name


def test_box_and_cylinder_builders(tmp):
    b = geo.box('b', (2.0, 1.0, 0.5), location=(1, 2, 3), bevel=0.05)
    assert len(b.data.vertices) > 8  # bevel applied
    lo, hi = scene.world_bounds([b])
    assert abs((hi.x - lo.x) - 2.0) < 1e-3 and abs(lo.z - 2.75) < 1e-3
    c = geo.cylinder('c', 0.5, 2.0, segments=8, radius_top=0.1)
    assert len(c.data.polygons) == 10  # 8 sides and 2 caps


def test_segment_aligns_to_head_and_tail(tmp):
    s = geo.segment('s', (0, 0, 1), (0, -1, 1), 0.1, 0.1, segments=6)
    lo, hi = scene.world_bounds([s])
    assert abs(lo.y + 1.0) < 1e-3 and abs(hi.y) < 1e-3, (lo, hi)


def test_ink_attribute_is_written(tmp):
    b = geo.box('b', (1, 1, 1))
    ink.set_ink(b, 1.5)
    values = [d.value for d in b.data.attributes['_ink'].data]
    assert len(values) == len(b.data.vertices) and all(abs(v - 0.75) < 1e-6 for v in values), values[:3]


def _tail(arm, bone):
    bpy.context.view_layer.update()
    return arm.matrix_world @ arm.pose.bones[bone].tail


def _mirror_error(arm, pose, kind, bones):
    """How far mirror_pose misses a world-X reflection: the heads and tails of `bones` under `pose`, reflected,
    against their counterparts under the mirrored pose. Heads count so that '@loc' offsets are checked too."""
    def land(p, names):
        anim.clear_pose(arm)
        for key, value in p.items():
            if key.endswith('@loc'):
                arm.pose.bones[key[:-4]].location = value
            else:
                arm.pose.bones[key].rotation_euler = value
        bpy.context.view_layer.update()
        return [arm.matrix_world @ getattr(arm.pose.bones[n], end) for n in names for end in ('head', 'tail')]

    original = land(pose, bones)
    mirrored = land(anim.mirror_pose(pose, kind), [rig.mirror_name(n) for n in bones])
    return max((m - o.reflect((1, 0, 0))).length for o, m in zip(original, mirrored))


def test_humanoid_has_the_expected_bones(tmp):
    arm = rig.humanoid('rig')
    names = sorted(b.name for b in arm.data.bones)
    assert len(names) == 22, names
    for required in ('root', 'hips', 'chest', 'head', 'upper_arm.L', 'forearm.R', 'thigh.L', 'foot.R', 'socket.R', 'socket.L'):
        assert required in names, required


def test_humanoid_axis_conventions(tmp):
    arm = rig.humanoid('rig')
    anim.clear_pose(arm)
    rest_foot = _tail(arm, 'shin.L').y
    arm.pose.bones['thigh.L'].rotation_euler = (0, 0, -0.5)
    assert _tail(arm, 'shin.L').y < rest_foot - 0.1, 'negative rz must swing a leg forward (toward -Y)'
    anim.clear_pose(arm)
    rest_head = _tail(arm, 'head').y
    arm.pose.bones['spine'].rotation_euler = (0, 0, 0.3)
    assert _tail(arm, 'head').y < rest_head - 0.05, 'positive rz must bend the spine forward'
    pose = {'hips': (0.05, 0.1, 0.08), 'hips@loc': (0.03, 0.02, 0.05), 'shoulder.L': (0.3, 0.2, 0.4),
            'upper_arm.L': (0.2, 0.1, -0.5), 'thigh.L': (0.1, 0.2, -0.3)}
    error = _mirror_error(arm, pose, 'humanoid', ['hips', 'shoulder.L', 'upper_arm.L', 'forearm.L', 'thigh.L', 'shin.L'])
    assert error < 1e-4, f'mirror_pose must reflect a humanoid pose across world X, off by {error}'


def test_creature_leg_swing_is_forward_on_both_sides(tmp):
    arm = rig.creature('rig')
    for side in ('L', 'R'):
        anim.clear_pose(arm)
        rest = _tail(arm, f'leg_front_lower.{side}').y
        arm.pose.bones[f'leg_front_upper.{side}'].rotation_euler = (0, 0, anim.leg_swing(side, 0.4))
        assert _tail(arm, f'leg_front_lower.{side}').y < rest - 0.05, side
    pose = {'body': (0.1, 0.05, 0.08), 'body@loc': (0.04, 0.02, 0.03), 'claw_upper.L': (0.3, 0.1, 0.2),
            'leg_front_upper.L': (0.2, 0.1, anim.leg_swing('L', 0.3))}
    error = _mirror_error(arm, pose, 'creature', ['body', 'thorax', 'claw_upper.L', 'claw_lower.L', 'leg_front_upper.L', 'leg_front_lower.L'])
    assert error < 1e-4, f'mirror_pose must reflect a creature pose across world X, off by {error}'


def test_rigid_binding_and_action_export(tmp):
    arm = rig.humanoid('rig')
    upper = geo.box('upper', (0.2, 0.2, 0.4), location=(0.12, 0, 0.78))
    lower = geo.box('lower', (0.18, 0.18, 0.4), location=(0.12, 0, 0.33))
    # Custom normals must survive the join and the export. Radii equal to the box's half extents would reproduce
    # area-weighted smooth normals at its corners; these differ, so normals recomputed on the way cannot pass.
    proxy = ((0.12, 0, 0.78), (0.1, 0.14, 0.25))
    scene.apply_transforms(upper)
    geo.ellipsoid_normals(upper, *proxy)
    for part in (upper, lower):
        ink.set_ink(part, 1.0)
    body = rig.bind_rigid(arm, [(upper, 'thigh.L'), (lower, 'shin.L')], 'body')
    assert {g.name for g in body.vertex_groups} == {'thigh.L', 'shin.L'}
    corners = np.array([body.data.vertices[loop.vertex_index].co[:] for loop in body.data.loops])
    normals = np.array([n.vector[:] for n in body.data.corner_normals])
    join_err = ellipsoid_error_deg(corners[corners[:, 2] > 0.55], normals[corners[:, 2] > 0.55], *proxy)
    assert join_err < 0.05, f'the join must keep custom normals, off by {join_err:.2f} degrees'
    bind_lo, bind_hi = scene.world_bounds([body])
    walk = anim.make_action(arm, 'walk', [(1, {'thigh.L': (0, 0, -0.4)}), (11, {'thigh.L': (0, 0, 0.4)})])
    kick = anim.make_action(arm, 'kick', [(1, {}), (6, {'shin.L': (0, 0, 0.8)})])
    assert abs(anim.duration(walk) - 10 / 30) < 1e-6
    path = export.export_glb([arm, body], tmp / 'rig.glb', animations=True)
    gj = glb_json(path)
    assert sorted(a['name'] for a in gj['animations']) == ['kick', 'walk'], gj.get('animations')
    walk_gltf = next(a for a in gj['animations'] if a['name'] == 'walk')
    times = [gj['accessors'][s['input']] for s in walk_gltf['samplers']]
    start, end = min(t['min'][0] for t in times), max(t['max'][0] for t in times)
    assert abs(start) < 1e-6 and abs(end - 10 / 30) < 1e-4, f'walk must span clip time 0 to 10 frames, got {start} to {end}'
    attrs = gj['meshes'][0]['primitives'][0]['attributes']
    assert '_INK' in attrs and 'JOINTS_0' in attrs, attrs
    points, normals = glb_vec3(path, gj, attrs['POSITION']), glb_vec3(path, gj, attrs['NORMAL'])
    glb_err = ellipsoid_error_deg(points[points[:, 2] > 0.55], normals[points[:, 2] > 0.55], *proxy)
    assert glb_err < 0.05, f'the GLB NORMAL must carry the custom normals, off by {glb_err:.2f} degrees'
    assert kick is not None
    # From frame 6 the NLA holds kick's bent knee (kick is the top track), yet a rest view must show the bind pose.
    bpy.context.scene.frame_set(6)
    during = []

    def record(*_):
        during.append(scene.world_bounds([body]))

    bpy.app.handlers.render_pre.append(record)
    try:
        export.render_views([body], tmp, 'rest', views=1, size=32)
    finally:
        bpy.app.handlers.render_pre.remove(record)
    off = max((during[0][0] - bind_lo).length, (during[0][1] - bind_hi).length)
    assert off < 1e-4, f'render_views must render the bind pose, bounds off by {off}'
    assert arm.data.pose_position == 'POSE', arm.data.pose_position


def test_morph_export_is_opt_in(tmp):
    # A skinned head with one face shape key, as the commander's body carries five.
    arm = rig.humanoid('rig')
    head = geo.box('head', (0.2, 0.2, 0.24), location=(0, 0, 1.6))
    body = rig.bind_rigid(arm, [(head, 'head')], 'body')
    top = max(v.co.z for v in body.data.vertices)
    body.shape_key_add(name='Basis', from_mix=False)
    blink = body.shape_key_add(name='blink_L', from_mix=False)
    for v in body.data.vertices:
        if v.co.z > top - 1e-4:
            blink.data[v.index].co.z -= 0.05
    # Off by default: a recipe that names nothing exports as every recipe always has, with no targets.
    plain = glb_json(export.export_glb([arm, body], tmp / 'plain.glb'))
    assert all('targets' not in p for m in plain['meshes'] for p in m['primitives']), plain['meshes']
    # On: the shape key ships as a named morph target of positions alone, and the mesh stays skinned.
    face = glb_json(export.export_glb([arm, body], tmp / 'face.glb', morphs=True))
    prim = face['meshes'][0]['primitives'][0]
    assert face['meshes'][0].get('extras', {}).get('targetNames') == ['blink_L'], face['meshes'][0]
    assert [sorted(t) for t in prim['targets']] == [['POSITION']], prim['targets']
    assert 'JOINTS_0' in prim['attributes'] and 'WEIGHTS_0' in prim['attributes'], prim['attributes']
    # glTF is Y-up, so the lid's -0.05 along Blender's z is -0.05 along the accessor's y, its required min.
    delta = face['accessors'][prim['targets'][0]['POSITION']]
    assert abs(delta['min'][1] + 0.05) < 1e-5 and abs(delta['max'][1]) < 1e-5, (delta['min'], delta['max'])
    # Modifiers are applied on every export, and one that changes the topology drops the mesh's shape keys without a
    # word, so the export refuses rather than ship a face that never blinks.
    body.modifiers.new('tri', 'TRIANGULATE')
    try:
        export.export_glb([arm, body], tmp / 'dropped.glb', morphs=True)
    except RuntimeError as error:
        assert "body's shape keys ['blink_L'] are missing from dropped.glb" in str(error) and 'tri (TRIANGULATE)' in str(error), error
    else:
        raise AssertionError('a triangulated mesh lost its shape keys and the export passed')


def test_charforge_settings_refuse_unknown_keys(tmp):
    from lib import charforge
    # A known key merges one level deep, keeping its siblings.
    s = charforge.settings({'reshape': {'chin_source_z': 1.258}})
    assert s['reshape'] == {**charforge.DEFAULTS['reshape'], 'chin_source_z': 1.258}, s['reshape']
    # A misspelt key, at the top, one level down or inside a nested table, stops the recipe with its dotted name.
    for overrides, named in (({'clipz': ('idle',)}, 'clipz'), ({'reshape': {'head_factr': 1.1}}, 'reshape.head_factr'),
                             ({'garments': {'contrast': {'hoody': 0.7}}}, 'garments.contrast.hoody'),
                             ({'commander_pose': {charforge.P + 'RightArmm': (0, 0, -1)}}, f'commander_pose.{charforge.P}RightArmm')):
        try:
            charforge.settings(overrides)
        except ValueError as error:
            assert named in str(error), error
        else:
            raise AssertionError(f'settings accepted the unknown key {named}')
    # An entry whose default is not a table is taken whole: the fist's own keys are its own.
    assert charforge.settings({'fist': {'finger_curl_deg': {'1': 60}}})['fist'] == {'finger_curl_deg': {'1': 60}}


def test_charforge_import_names_what_the_source_lacks(tmp):
    from lib import charforge
    arm = rig.humanoid('rig')
    head = geo.box('head', (0.2, 0.2, 0.24), location=(0, 0, 1.6))
    body = rig.bind_rigid(arm, [(head, 'head')], 'body')
    body.parent = arm
    bare = export.export_glb([arm, body], tmp / 'bare.glb')
    # No shape keys: the error names the file and the missing morphs, where it was an AttributeError on None.
    try:
        charforge.import_source(bare)
    except ValueError as error:
        assert str(bare) in str(error) and 'no shape keys' in str(error), error
    else:
        raise AssertionError('a source without shape keys imported')
    body.shape_key_add(name='Basis', from_mix=False)
    body.shape_key_add(name='blink_L', from_mix=False).data[0].co.z += 0.01
    faced = export.export_glb([arm, body], tmp / 'faced.glb', morphs=True)
    # Shape keys but no albedo: the error names the file and the image, where the build failed later on None.
    try:
        charforge.import_source(faced)
    except ValueError as error:
        assert str(faced) in str(error) and 'no albedo image' in str(error), error
    else:
        raise AssertionError('a source without an albedo image imported')


# The stand-in's wrist (the right hand's head) and its blade's tip, 0.3 m in front of the wrist and 2 cm into the ground.
_WRIST = (-0.2, 0.0, 0.6)
_TIP = (-0.2, -0.3, -0.02)


def _blade():
    """A thin four-sided pyramid hanging point down from the wrist's height to _TIP, so the blade's lowest point is one
    vertex, its tip, whose x a turn about the right axis keeps."""
    x, y, _ = _TIP
    top = _WRIST[2]
    verts = [(x - 0.01, y - 0.02, top), (x + 0.01, y - 0.02, top), (x + 0.01, y + 0.02, top), (x - 0.01, y + 0.02, top), _TIP]
    mesh = bpy.data.meshes.new('blade')
    mesh.from_pydata(verts, [], [(0, 1, 2, 3), (1, 0, 4), (2, 1, 4), (3, 2, 4), (0, 3, 4)])
    mesh.update()
    return scene.link(bpy.data.objects.new('blade', mesh))


def _charforge_stand_in(pinned=False):
    """A stand-in for a CharForge commander: the root hips 1 m up, pointing up (so their local Y is world up), a left
    foot and a right hand under them, a body box on the hips, and an armour of a boot box on the foot from the ground up
    and a blade on the hand (_blade), its faces marked as charforge's assemble marks a blade (cf_part 3). With `pinned`,
    the armour also has a small piece marked as blade but riding the hips, 3 cm into the ground, so the sword's lowest
    point is one the hand's turn does not carry. Bound as charforge binds."""
    from lib import charforge
    data = bpy.data.armatures.new('rig')
    arm = bpy.data.objects.new('rig', data)
    bpy.context.scene.collection.objects.link(arm)
    scene.select_only([arm])
    bpy.ops.object.mode_set(mode='EDIT')
    hips = data.edit_bones.new(charforge.P + 'Hips')
    hips.head, hips.tail = (0, 0, 1.0), (0, 0, 1.1)
    for name, head, tail in (('LeftFoot', (0.1, 0, 0.1), (0.1, -0.1, 0.02)), ('RightHand', _WRIST, (-0.2, -0.1, 0.6))):
        bone = data.edit_bones.new(charforge.P + name)
        bone.head, bone.tail = head, tail
        bone.parent = hips
    bpy.ops.object.mode_set(mode='OBJECT')
    body = geo.box('body', (0.3, 0.2, 0.4), location=(0, 0, 1.0))
    boot = geo.box('boot', (0.1, 0.2, 0.1), location=(0.1, 0, 0.05))
    parts = [(body, 'Hips', None), (boot, 'LeftFoot', 0), (_blade(), 'RightHand', 3)]
    if pinned:
        parts.append((geo.box('pin', (0.02, 0.02, 0.1), location=(0.3, -0.2, 0.02)), 'Hips', 3))
    for ob, bone, code in parts:
        scene.apply_transforms(ob)
        ob.vertex_groups.new(name=charforge.P + bone).add([v.index for v in ob.data.vertices], 1.0, 'REPLACE')
        if code is not None:
            ob.data.attributes.new('cf_part', 'INT', 'FACE').data.foreach_set('value', np.full(len(ob.data.polygons), code, np.int32))
    armour = scene.join([ob for ob, _, code in parts if code is not None], 'armour')
    for ob in (body, armour):
        charforge.bind(ob, arm)
    return arm, body, armour


def _hips_clip(arm, name, heights, hand_turn=None):
    """A clip that only raises and lowers the hips, one key a frame from frame 1, with the hand keyed on every frame as a
    baked source clip keys every bone, stashed as retarget_clips stashes. The hand is keyed at rest, or turned about its
    wrist by `hand_turn`, a rotation in world space, carried into the hand's own frame (the hips never turn)."""
    from lib import charforge
    from mathutils import Quaternion
    arm.animation_data_create()
    action = bpy.data.actions.new(name)
    arm.animation_data.action = action
    pb = arm.pose.bones[charforge.P + 'Hips']
    hand = arm.pose.bones[charforge.P + 'RightHand']
    rest = arm.data.bones[hand.name].matrix_local.to_quaternion()
    hand.rotation_quaternion = rest.inverted() @ hand_turn @ rest if hand_turn is not None else Quaternion()
    for i, height in enumerate(heights):
        pb.location = (0.0, height, 0.0)
        pb.keyframe_insert('location', frame=1 + i)
        hand.keyframe_insert('rotation_quaternion', frame=1 + i)
    arm.animation_data.action = None
    charforge._stash(arm, action)
    pb.location = (0.0, 0.0, 0.0)
    hand.rotation_quaternion = Quaternion()
    return action


def _keys(action, bone, prop, index):
    from lib import charforge
    return [kp.co[1] for fcs in charforge._channelbags(action) for fc in fcs
            if fc.data_path == f'pose.bones["{charforge.P}{bone}"].{prop}' and fc.array_index == index for kp in fc.keyframe_points]


def _sword_mask(armour):
    """The armour's blade vertices, read from cf_part as ground_clips reads them."""
    part = np.empty(len(armour.data.polygons), np.int32)
    armour.data.attributes['cf_part'].data.foreach_get('value', part)
    mask = np.zeros(len(armour.data.vertices), bool)
    for polygon in armour.data.polygons:
        if part[polygon.index] == 3:
            mask[list(polygon.vertices)] = True
    return mask


def _hand_keys(action):
    return np.array([_keys(action, 'RightHand', 'rotation_quaternion', i) for i in range(4)]).T


def test_charforge_ground_pass_stands_each_clip_on_the_ground_by_one_constant(tmp):
    from lib import charforge
    from mathutils import Quaternion, Vector
    arm, body, armour = _charforge_stand_in()
    # The idle's hand rolls 50 degrees about the line from the wrist to the blade's tip on every key, so its keys are far
    # from rest and the turn must be carried into the hand's frame through hand @ basis^-1, while the tip stays put.
    roll = Quaternion((Vector(_TIP) - Vector(_WRIST)).normalized(), np.radians(50))
    sinking = _hips_clip(arm, 'idle', [0.0, -0.01, -0.02, -0.01, 0.0], roll)
    floating = _hips_clip(arm, 'run', [0.05, 0.06, 0.05])
    # The stand's hand swings the blade up to lie level in front of him, 0.3 m over the wrist and 0.88 m up at its
    # lowest, so nothing of it comes near the ground.
    standing = _hips_clip(arm, 'stand', [0.0, 0.01, 0.0], Quaternion((1.0, 0.0, 0.0), np.radians(-90)))
    sword = {'sword': _sword_mask(armour)}
    tip_before = charforge._clip_lowest(arm, body, armour, sinking, sword).low['sword']
    rolled = _hand_keys(sinking)
    stand_hand = _hand_keys(standing)
    out = charforge.ground_clips(arm, body, armour, {'idle': sinking, 'run': floating, 'stand': standing})
    # The idle's boot reached 2 cm under the ground at its lowest frame; one hips offset of 2 cm puts that frame on it.
    idle = out['idle']
    assert abs(idle['retargeted_boot_min_z'] + 0.02) < 1e-4 and abs(idle['offset_m'] - 0.02) < 1e-4, idle
    assert abs(idle['boot_min_z']) < 1e-4 and abs(idle['min_z']) < 1e-4, idle
    # Every hips key moved by the same amount, so the clip's own rise and fall is kept rather than flattened.
    assert np.allclose(_keys(sinking, 'Hips', 'location', 1), [0.02, 0.01, 0.0, 0.01, 0.02], atol=1e-6), _keys(sinking, 'Hips', 'location', 1)
    # The blade, still 2 cm into the ground at the lowest frame after that offset, is lifted to the clearance by one turn
    # of the hand, the same on every key and on top of the roll.
    assert abs(idle['retargeted_sword_min_z'] + 0.04) < 1e-4, idle
    assert idle['sword_turn_deg'] > 0 and abs(idle['sword_min_z'] - charforge.BLADE_CLEARANCE_M) < 5e-4, idle
    hand = _hand_keys(sinking)
    assert np.allclose(hand, hand[0], atol=1e-7) and not np.allclose(hand[0], rolled[0], atol=1e-4), (hand, rolled)
    # The turn is about the level axis square to the line from the wrist to the tip, here the x axis, so the tip rises
    # in its own vertical plane at the worst frame: a turn read through the hand's frame without taking the keyed roll
    # out of it would swing the tip sideways by centimetres.
    tip_after = charforge._clip_lowest(arm, body, armour, sinking, sword).low['sword']
    assert tip_after[1] == tip_before[1] == 3, (tip_before, tip_after)
    assert abs(tip_before[2][0] - _TIP[0]) < 1e-5 and abs(tip_after[2][0] - tip_before[2][0]) < 1e-5, (tip_before, tip_after)
    assert abs(tip_after[0] - charforge.BLADE_CLEARANCE_M) < 5e-4, tip_after
    # A clip that floats is lowered by one offset the same way: its boots were 5 cm up at their lowest, and its blade, 2 cm
    # into the ground once the boots stand, is then lifted to the clearance.
    run = out['run']
    assert abs(run['retargeted_boot_min_z'] - 0.05) < 1e-4 and abs(run['offset_m'] + 0.05) < 1e-4 and abs(run['boot_min_z']) < 1e-4, run
    assert np.allclose(_keys(floating, 'Hips', 'location', 1), [0.0, 0.01, 0.0], atol=1e-6), _keys(floating, 'Hips', 'location', 1)
    assert run['sword_turn_deg'] > 0 and abs(run['sword_min_z'] - charforge.BLADE_CLEARANCE_M) < 5e-4, run
    # A clip whose boots stand on the ground and whose blade stays clear of it is left alone.
    stand = out['stand']
    assert abs(stand['offset_m']) < 1e-4 and stand['sword_turn_deg'] == 0 and stand['sword_min_z'] > 0.5, stand
    assert np.allclose(_keys(standing, 'Hips', 'location', 1), [0.0, 0.01, 0.0], atol=1e-6), _keys(standing, 'Hips', 'location', 1)
    assert np.allclose(_hand_keys(standing), stand_hand, atol=1e-9), (_hand_keys(standing), stand_hand)


def test_charforge_ground_pass_refuses_a_sword_point_the_hand_turn_does_not_carry(tmp):
    from lib import charforge
    arm, body, armour = _charforge_stand_in(pinned=True)
    # The lowest sword point rides the hips, so no turn of the hand moves it: the secant has no slope to follow. It used
    # to divide by 1e-9 there and leap through an arbitrary angle.
    clip = _hips_clip(arm, 'idle', [0.0, 0.01, 0.0])
    try:
        charforge.ground_clips(arm, body, armour, {'idle': clip})
    except RuntimeError as error:
        assert "clip 'idle'" in str(error) and 'does not move the lowest sword point' in str(error), error
    else:
        raise AssertionError('a sword point the hand does not carry passed the ground pass')


def test_motion_spline_track_passes_its_keys_eases_its_ends_and_reads_each_part_at_its_lag(tmp):
    from lib import motion
    times, values = [1.0, 4.0, 7.0, 13.0], [0.0, 1.0, 3.0, 2.0]

    def slope(t, eps=1e-5):
        return (motion.hermite(times, values, t + eps) - motion.hermite(times, values, t - eps)) / (2 * eps)

    # Through every key, held at the first and last outside them.
    for t, v in zip(times, values):
        assert abs(motion.hermite(times, values, t) - v) < 1e-9, (t, motion.hermite(times, values, t))
    assert motion.hermite(times, values, -5.0) == 0.0 and motion.hermite(times, values, 99.0) == 2.0
    # The clip eases out of its first pose and into its last: no speed at either end.
    assert abs(slope(1.0 + 1e-4)) < 1e-2 and abs(slope(13.0 - 1e-4)) < 1e-2, (slope(1.0 + 1e-4), slope(13.0 - 1e-4))
    # Inside, it flows through a key at the Catmull-Rom slope, the same on both sides (C1), where per-segment easing
    # stopped at every key: through 4, (3 - 0) / (7 - 1) = 0.5.
    assert abs(slope(4.0) - 0.5) < 1e-4, slope(4.0)
    left = (motion.hermite(times, values, 7.0) - motion.hermite(times, values, 7.0 - 1e-6)) / 1e-6
    right = (motion.hermite(times, values, 7.0 + 1e-6) - motion.hermite(times, values, 7.0)) / 1e-6
    assert abs(left - right) < 1e-3, (left, right)
    # Each part reads the track at its own lag, clamped to the clip: the hips 1.5 frames ahead, the shield 1.5 behind.
    # A lead eases in over the clip's first LAG_RAMP frames, so on the first frame every part stands on the first key
    # (the hips read frame 2.5 there, already off toward the next key, so a chained hit began 13 to 47 mm from the pose
    # it was keyed from); from frame 1 + LAG_RAMP on, the hips read their full 1.5 frames ahead.
    guard = motion.spec(sword=((0, 0, -1),) * 3, shield=((0, 0, -1),) * 2)
    keys = [(t, {**guard, 'hips_turn': np.array([v]), 'h_up': np.array([v, 0.0, -1.0])}) for t, v in zip(times, values)]
    first = motion.track_at(keys, 1.0)
    assert abs(first['hips_turn'][0] - values[0]) < 1e-12 and abs(first['h_up'][0] - values[0]) < 1e-12, first['hips_turn']
    for t in (2.5, 1.0 + motion.LAG_RAMP, 5.0, 12.5):
        at = motion.track_at(keys, t)
        lead = motion.LAGS['hips'] * float(np.clip((t - 1.0) / motion.LAG_RAMP, 0.0, 1.0) ** 2 * (3 - 2 * np.clip((t - 1.0) / motion.LAG_RAMP, 0.0, 1.0)))
        ahead = motion.hermite(times, values, min(max(t + lead, 1.0), 13.0))
        behind = motion.hermite(times, values, min(max(t + motion.LAGS['shield'], 1.0), 13.0))
        assert abs(at['hips_turn'][0] - ahead) < 1e-9 and abs(at['h_up'][0] - behind) < 1e-9, (t, at['hips_turn'], at['h_up'])
    full = motion.track_at(keys, 5.0)
    assert abs(full['hips_turn'][0] - motion.hermite(times, values, 6.5)) < 1e-9, full['hips_turn']
    # A foot never steps under its rest height: the spline's overshoot past a set-down sank the finisher's boot 3.9 mm.
    assert motion._grounded((0.0, -0.22, -0.004)) == (0.0, -0.22, 0.0)
    assert motion._grounded((0.01, -0.08, 0.05)) == (0.01, -0.08, 0.05)
    # A direction that has collapsed to nothing stops the build with what it was, where it used to aim straight down.
    try:
        motion._unit((0.0, 0.0, 0.0), 'the blade (s_want)')
    except ValueError as error:
        assert 'the blade (s_want)' in str(error), error
    else:
        raise AssertionError('a zero direction was taken')
    assert motion._unit((0.0, 3.0, 4.0)) == (0.0, 0.6, 0.8)


def test_motion_strike_window_counts_the_wind_up_from_its_own_look_back(tmp):
    from lib import motion
    # A right hand that moves steadily, stops at the top of its back-swing (step 12), cuts to its fastest step (15) and
    # settles. The strike is 16, so the 18-step look-back is cut at step 0, and the slowest step was counted from
    # s - 18 = -2 instead: the wind-up began at 7, two steps early, where it begins three before the stop, at 9.
    def hand(speeds):
        pos = np.zeros((len(speeds) + 1, 1, 3))
        pos[1:, 0, 0] = np.cumsum(speeds)
        return pos

    names = ['RightHand']
    swing = [0.05] * 12 + [0.001, 0.1, 0.3, 1.0, 0.2, 0.05, 0.02, 0.01, 0.01, 0.01, 0.01, 0.01]
    a, s, _, _ = motion.strike_window(hand(swing), names)
    assert (a, s) == (9, 16), (a, s)
    # Ten steps earlier in a longer take the look-back is whole, and the start is three before the stop as it always was.
    a2, s2, _, _ = motion.strike_window(hand([0.05] * 10 + swing), names)
    assert (a2, s2) == (19, 26), (a2, s2)


def test_commander_pip_combo_sources_are_checked_before_anything_is_baked(tmp):
    from recipes import commander_pip as pip
    for bad, word in (({'attack_1': 'hand', 'attack_2': 'mocap', 'attack_3': 'hand'}, 'mocap'), ({'attack_1': 'hand'}, 'attack_2')):
        try:
            pip.check_combo_sources(tmp, bad)
        except ValueError as error:
            assert word in str(error), error
        else:
            raise AssertionError(f'COMBO_SOURCE {bad} was taken')
    # The shipped sources pass against the repository, and hand-keyed hits need no file at all.
    pip.check_combo_sources(ROOT)
    pip.check_combo_sources(tmp, {hit: 'hand' for hit in pip.COMBO})
    # Two hits selecting UniMate with no generation committed: both files are named at once, before anything is baked.
    picks = {'attack_1': 'unimate', 'attack_2': 'hand', 'attack_3': 'unimate'}
    try:
        pip.check_combo_sources(tmp, picks)
    except FileNotFoundError as error:
        assert 'attack_1.json' in str(error) and 'attack_3.json' in str(error) and 'attack_2' not in str(error), error
    else:
        raise AssertionError('a UniMate pick without its file was taken')
    # A generation without a key the retarget reads, or not JSON at all, is named too.
    folder = tmp / pip.UNIMATE_DIR
    folder.mkdir(parents=True)
    (folder / 'attack_1.json').write_text(json.dumps({'positions': [[[0, 0, 0]]]}), encoding='utf-8')
    (folder / 'attack_3.json').write_text('not json', encoding='utf-8')
    try:
        pip.check_combo_sources(tmp, picks)
    except FileNotFoundError as error:
        assert "'joint_names'" in str(error) and 'attack_3.json is not JSON' in str(error), error
    else:
        raise AssertionError('a generation without joint_names was taken')
    for hit in ('attack_1', 'attack_3'):
        (folder / f'{hit}.json').write_text(json.dumps({'positions': [], 'joint_names': []}), encoding='utf-8')
    pip.check_combo_sources(tmp, picks)


def test_commander_pip_hand_keys_rise_inside_each_clip(tmp):
    from recipes import commander_pip as pip
    timings = json.loads((ROOT / 'src' / 'shared' / 'timings.json').read_text(encoding='utf-8'))
    for hit in pip.COMBO:
        strike, end, _ = pip.combo_timing(timings, hit)
        times = pip.hand_key_times(hit, strike, end)
        assert times[0] == 1.0 and abs(times[-1] - end) < 1e-9 and all(b > a for a, b in zip(times, times[1:])), (hit, times)
    g = pip.GUARD_SPEC
    for keys, words in (([(('1', 0), g), (('s', 1), g), (('s', 0), g), (('e', 0), g)], ('attack_1 key 2', 'rise strictly')),
                        ([(('1', 0), g), (('s', 0), g), (('e', 2), g)], ('attack_1 key 2', 'outside the clip')),
                        ([(('1', -1), g), (('e', 0), g)], ('attack_1 key 0', 'outside the clip'))):
        try:
            pip.hand_key_times('attack_1', 7.0, 17.5, {'attack_1': keys})
        except ValueError as error:
            assert all(word in str(error) for word in words), error
        else:
            raise AssertionError(f'keys {[k for k, _ in keys]} were taken')


def test_commander_pip_combo_timing_reads_each_cancel_from_timings_json(tmp):
    from recipes import commander_pip as pip
    # The shipped file: the light hits cancel at 0.30 s, frame 10 from 1 at 30 fps, the finisher not at all.
    timings = json.loads((ROOT / 'src' / 'shared' / 'timings.json').read_text(encoding='utf-8'))
    frames = {hit: pip.combo_timing(timings, hit) for hit in pip.COMBO}
    assert [abs(frames[hit][2] - 10.0) < 1e-9 for hit in ('attack_1', 'attack_2')] == [True, True], frames
    assert frames['attack_3'][2] is None, frames
    assert not hasattr(pip, 'COMBO_CANCEL'), 'the recipe keeps a cancel table of its own again'
    # Another set's numbers come through the file alone: a 0.7 s hit striking at 0.32 s and cancelling at 0.45 s.
    other = {'commanders': {pip.NAME: {'attack_1': {'duration': 0.7, 'strike': 0.32, 'activeFrom': 0.26, 'activeTo': 0.4, 'cancel': 0.45}}}}
    strike, end, cancel = pip.combo_timing(other, 'attack_1')
    assert abs(strike - (1 + 0.32 * 30)) < 1e-9 and abs(end - (1 + 0.7 * 30)) < 1e-9 and abs(cancel - (1 + 0.45 * 30)) < 1e-9, (strike, end, cancel)
    # An entry without its cancel stops the build, naming the key.
    del other['commanders'][pip.NAME]['attack_1']['cancel']
    try:
        pip.combo_timing(other, 'attack_1')
    except ValueError as error:
        assert 'attack_1 has no cancel' in str(error), error
    else:
        raise AssertionError('a hit without its cancel was taken')


def test_charforge_leg_ik_moves_the_ankle_by_a_step_and_keeps_the_foot_level(tmp):
    from mathutils import Vector
    from lib import charforge
    P = charforge.P
    data = bpy.data.armatures.new('legs')
    arm = bpy.data.objects.new('legs', data)
    bpy.context.scene.collection.objects.link(arm)
    scene.select_only([arm])
    bpy.ops.object.mode_set(mode='EDIT')
    hips = data.edit_bones.new(P + 'Hips')
    hips.head, hips.tail = (0, 0, 1.0), (0, 0, 1.1)
    parent = hips
    for name, head, tail in (('LeftUpLeg', (0.1, 0, 0.95), (0.1, 0, 0.5)), ('LeftLeg', (0.1, 0, 0.5), (0.1, 0, 0.1)),
                             ('LeftFoot', (0.1, 0, 0.1), (0.1, -0.1, 0.02))):
        bone = data.edit_bones.new(P + name)
        bone.head, bone.tail = head, tail
        bone.parent = parent
        parent = bone
    bpy.ops.object.mode_set(mode='OBJECT')
    rest = arm.data.bones[P + 'LeftFoot']

    def posed_foot(ops):
        pose = charforge.pose_rotations(arm, ops)
        for pb in arm.pose.bones:
            pb.rotation_mode = 'QUATERNION'
            pb.rotation_quaternion = pose[pb.name]
            pb.location = pose.get(f'{pb.name}@loc', (0.0, 0.0, 0.0))
        bpy.context.view_layer.update()
        foot = arm.pose.bones[P + 'LeftFoot']
        return foot.head.copy(), foot.matrix.to_3x3()

    # The hips drop 5 cm: without a step the ankle stays on its rest point; with one it lands on that point moved by the
    # step, 12 cm ahead (-y) and 3 cm up, as the finisher's front boot does; either way the foot keeps its rest
    # orientation, so the boot sets down level.
    for step in (None, (0.0, -0.12, 0.03)):
        ops = [('move', P + 'Hips', (0.0, 0.0, -0.05)), ('leg', 'Left') if step is None else ('leg', 'Left', step)]
        head, basis = posed_foot(ops)
        want = rest.head_local + (Vector(step) if step else Vector())
        assert (head - want).length < 1e-4, (step, tuple(head), tuple(want))
        turned = (basis @ rest.matrix_local.to_3x3().inverted()).to_quaternion().angle
        assert turned < 1e-4, (step, turned)
    # Hips raised 20 cm, the ankle is out of the leg's reach: the build stops with the side named, where the solve used
    # to stretch the leg straight and leave the boot hanging short of the ground.
    try:
        posed_foot([('move', P + 'Hips', (0.0, 0.0, 0.2)), ('leg', 'Left')])
    except ValueError as error:
        assert 'Left leg' in str(error) and 'beyond' in str(error), error
    else:
        raise AssertionError('an ankle out of reach was taken')


def _flat(value, shape=(4, 4)):
    return np.full(shape, value, np.float64)


def test_composite_neutral_inputs_give_region_times_mid_gradient(tmp):
    style = palette.PaintStyle()
    region = np.full((4, 4, 3), 0.5)
    albedo, emissive = paint.composite(region, _flat(1.0), _flat(0.5), _flat(0.5), _flat(0.5), np.zeros((4, 4, 3)), style)
    mid = (np.array(style.warm) + np.array(style.cool)) / 2
    assert np.allclose(albedo[0, 0], 0.5 * mid, atol=1e-6), albedo[0, 0]
    assert float(emissive.max()) == 0.0


def test_composite_occlusion_takes_the_shadow_colour(tmp):
    style = palette.PaintStyle(shadow_tint=(0.2, 0.6, 0.8), ao_strength=1.0)
    region = np.full((4, 4, 3), 0.6)
    open_, _ = paint.composite(region, _flat(1.0), _flat(0.5), _flat(0.5), _flat(0.5), np.zeros((4, 4, 3)), style)
    shut, _ = paint.composite(region, _flat(0.0), _flat(0.5), _flat(0.5), _flat(0.5), np.zeros((4, 4, 3)), style)
    ratio = shut[0, 0] / open_[0, 0]
    assert np.allclose(ratio, (0.2, 0.6, 0.8), atol=1e-6), ratio


def test_paint_bakes_an_atlas_and_assigns_one_material(tmp):
    scene.configure_cycles(samples=4)
    (tmp / 'textures').mkdir()
    write_png(tmp / 'textures' / 'brush_strokes.png', np.full((16, 16), 0.5))
    a = geo.box('a', (1, 1, 1), material=palette.region('t_red', '#c03030'))
    b = geo.box('b', (1, 1, 1), location=(3, 0, 0), material=palette.region('t_glow', '#202020', emit_hex='#59f2ff'))
    blue = paint.add_cap(palette.region('t_blue', '#3030c0'), '#30c030', threshold=0.35)
    capped = geo.cap_factor(geo.box('capped', (1, 1, 1), location=(-3, 0, 0), material=blue))
    mat = paint.paint([a, b, capped], name='t', out_dir=tmp, textures_dir=tmp / 'textures', size=64, ao_samples=4)
    assert (tmp / 't_albedo.png').exists() and (tmp / 't_emissive.png').exists()
    assert list(a.data.materials) == [mat] and list(b.data.materials) == [mat]
    # The bake-only height attribute must not stay behind: glTF export writes it as COLOR_0.
    assert len(a.data.color_attributes) == 0 and len(b.data.color_attributes) == 0, [c.name for c in a.data.color_attributes]
    # glTF export writes only the maps linked to the BSDF; Workbench shows the active image node, a preview.
    gj = glb_json(export.export_glb([a, b], tmp / 't.glb'))
    assert sorted(image['name'] for image in gj['images']) == ['t_albedo', 't_emissive'], gj['images']
    # Without backface culling the exporter writes doubleSided: true, and the runtime would draw and shadow both
    # faces of every painted mesh; a mesh that needs both faces (grass) opts in through its own extras instead.
    two_sided = [m.get('name') for m in gj['materials'] if m.get('doubleSided')]
    assert mat.use_backface_culling and not two_sided, \
        f'backface culling {mat.use_backface_culling}, double-sided materials in the GLB: {two_sided}'
    preview = mat.node_tree.nodes.active.image
    shown = pathlib.Path(preview.filepath).name if preview else None
    assert shown == 't_preview.png', f'the active image node shows {shown}'
    maps = {}
    for key, image in (('albedo', bpy.data.images.load(str(tmp / 't_albedo.png'))),
                       ('emissive', bpy.data.images.load(str(tmp / 't_emissive.png'))), ('preview', preview)):
        pixels = np.empty(64 * 64 * 4, np.float32)
        image.pixels.foreach_get(pixels)
        maps[key] = pixels.reshape(64, 64, 4)  # row 0 at the bottom, like UV v = 0
    # The whole gutter is filled, so no mip level pulls in black.
    black = int(np.all(maps['albedo'][..., :3] == 0.0, axis=2).sum())
    assert black == 0, f'{black} albedo texels left unfilled'
    # A shared atlas: no object's padding may paint over another object's islands (only b glows), and the
    # preview carries b's glow.
    for ob, lit in ((a, False), (b, True)):
        uv = np.empty(len(ob.data.loops) * 2)
        ob.data.uv_layers.active.data.foreach_get('uv', uv)
        uv = uv.reshape(-1, 2)
        ob.data.calc_loop_triangles()
        for tri in ob.data.loop_triangles:
            corners = uv[list(tri.loops)]
            for weights in ((0.6, 0.2, 0.2), (0.2, 0.6, 0.2), (0.2, 0.2, 0.6)):
                u, v = np.dot(weights, corners)
                texel = int(v * 64), int(u * 64)
                glow = float(maps['emissive'][texel][:3].max())
                assert (glow > 0.5) == lit, f'{ob.name} texel at uv ({u:.3f}, {v:.3f}) has emission {glow:.3f}'
                cyan = min(maps['preview'][texel][1:3]) > 0.8
                assert cyan == lit, f'{ob.name} preview texel at uv ({u:.3f}, {v:.3f}) is {maps["preview"][texel][:3]}'
    # A cap is opt-in and follows the up-facing factor: capped's top turns to the cap green while its bottom keeps
    # the base blue, and a, uncapped in the same bake, stays red on both.
    for ob, hues in ((a, 'rr'), (capped, 'gb')):
        uv = np.empty(len(ob.data.loops) * 2)
        ob.data.uv_layers.active.data.foreach_get('uv', uv)
        for facing, hue in zip((1, -1), hues):
            face = max(ob.data.polygons, key=lambda p: facing * p.normal.z)
            u, v = uv.reshape(-1, 2)[list(face.loop_indices)].mean(axis=0)
            colour = maps['albedo'][int(v * 64), int(u * 64)][:3]
            assert 'rgb'[int(np.argmax(colour))] == hue, f'{ob.name} face facing z {facing:+d} is {colour}, not {hue}'
    # A lone object takes another path through Blender's bake than a shared atlas does (use_clear rewrites the whole
    # target, alpha 1 off the islands too), which once left its gutter black: the fill must reach it all the same.
    solo = geo.box('solo', (1, 1, 1), location=(0, 4, 0), material=palette.region('t_solo', '#c0c030'))
    paint.paint([solo], name='solo', out_dir=tmp, textures_dir=tmp / 'textures', size=64, ao_samples=4)
    solo_albedo = np.empty(64 * 64 * 4, np.float32)
    bpy.data.images.load(str(tmp / 'solo_albedo.png')).pixels.foreach_get(solo_albedo)
    solo_black = int(np.all(solo_albedo.reshape(64, 64, 4)[..., :3] == 0.0, axis=2).sum())
    assert solo_black == 0, f'{solo_black} albedo texels left unfilled around a single painted object'
    # Caps follow world up. Recipes apply transforms only when they join, so a part tipped 90 degrees about X and not
    # yet applied must cap what is now its top, not its own +z side. A cube corner's normal is the mean of its three
    # face normals, so each corner reads +-1/sqrt(3) by which way it faces in the world.
    tipped = geo.box('tipped', (1, 1, 1), location=(0, -4, 0), rotation=(np.pi / 2, 0, 0))
    geo.cap_factor(tipped)
    factor = np.empty(len(tipped.data.vertices), np.float32)
    tipped.data.attributes[paint.CAP_ATTRIBUTE].data.foreach_get('value', factor)
    world_z = np.array([(tipped.rotation_euler.to_matrix() @ v.co).z for v in tipped.data.vertices])
    assert np.allclose(factor, np.sign(world_z) / np.sqrt(3), atol=1e-4), \
        f'a part rotated but not applied must cap its world top: factors {factor.round(3)}, world z {world_z.round(3)}'


def main():
    tests = [(name, fn) for name, fn in sorted(globals().items()) if name.startswith('test_') and callable(fn)]
    passed = failed = 0
    for name, fn in tests:
        scene.reset()
        with tempfile.TemporaryDirectory() as tmp:
            try:
                fn(pathlib.Path(tmp))
                passed += 1
                print(f'PASS {name}')
            except Exception:
                failed += 1
                print(f'FAIL {name}')
                traceback.print_exc()
    print(f'BLENDER_TESTS pass={passed} fail={failed}')
    if failed:
        sys.exit(1)


main()
