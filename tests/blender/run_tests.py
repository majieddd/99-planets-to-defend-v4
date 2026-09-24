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
    for part in (upper, lower):
        ink.set_ink(part, 1.0)
    body = rig.bind_rigid(arm, [(upper, 'thigh.L'), (lower, 'shin.L')], 'body')
    assert {g.name for g in body.vertex_groups} == {'thigh.L', 'shin.L'}
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
    mat = paint.paint([a, b], name='t', out_dir=tmp, textures_dir=tmp / 'textures', size=64, ao_samples=4)
    assert (tmp / 't_albedo.png').exists() and (tmp / 't_emissive.png').exists()
    assert list(a.data.materials) == [mat] and list(b.data.materials) == [mat]
    # The bake-only height attribute must not stay behind: glTF export writes it as COLOR_0.
    assert len(a.data.color_attributes) == 0 and len(b.data.color_attributes) == 0, [c.name for c in a.data.color_attributes]
    # glTF export writes only the maps linked to the BSDF; Workbench shows the active image node, a preview.
    gj = glb_json(export.export_glb([a, b], tmp / 't.glb'))
    assert sorted(image['name'] for image in gj['images']) == ['t_albedo', 't_emissive'], gj['images']
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
