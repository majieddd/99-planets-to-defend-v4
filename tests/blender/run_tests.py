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
