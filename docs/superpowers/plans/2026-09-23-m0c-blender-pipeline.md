# M0c Blender Pipeline and Style-Scene Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run assets` turns Python recipes into web-ready, painted, inked GLB files through headless Blender 5.2.1, with a manifest, preview contact sheets and budget checks, and uses it to build the M0 style-scene set: brush atlas, Verdant kit, Worldheart (11 stages), nest, Bolt Sentinel marks I to III, Husk (idle, walk, attack) and Bulwark (idle, run, attack).

**Architecture:** every asset is code. `blender/lib` holds the shared pipeline (geometry builders, region palettes, a six-pass paint bake composited in numpy, `_ink` width attributes, rigid-bound rigs with measured axis conventions, keyframed actions stashed on NLA tracks, GLB export, Workbench previews). `blender/recipes/<name>.py` builds one family and returns asset records. Node tools in `tools/assets` run the recipes in parallel, optimize the raw GLB files with glTF-Transform (meshopt geometry, WebP textures), write sidecars and `public/assets/manifest.json`, compose contact sheets with sharp, and check triangle, bone, texture and timing budgets. Exports are committed; CI never runs Blender.

**Tech Stack:** Blender 5.2.1 LTS (Python 3.13, numpy 2.3, Cycles on OptiX), glTF-Transform 4.5.0, meshoptimizer 1.2.0, sharp 0.35.4, Node 24, Vitest 5.

**Prerequisites:** M0a complete. `BLENDER_PATH` set, or Blender at `C:\Users\Majied LaFleur\tools\blender-5.2.1\blender.exe`.

---

## Facts measured before this plan (do not re-derive)

- `export_animation_mode='ACTIONS'` exports every action stashed on an NLA track as its own animation.
- A float mesh attribute named `_ink` exports as `_INK` with `export_attributes=True`, beside `JOINTS_0` and `WEIGHTS_0`.
- Actions are slotted in 5.x: `action.fcurves` does not exist. Key poses with `pose_bone.keyframe_insert`.
- Cycles EMIT bakes several selected objects into one shared atlas (1.5 s on CPU for two rocks at 512).
- Workbench renders the active image texture with object outlines (2.2 s at 480 by 270).
- Changing a generated image's colour space after writing its pixels regenerates it to black. Write PNG
  files with `blender/lib/png.py` and load them.
- `bpy.ops.uv.lightmap_pack` makes one island per triangle, which seams under mipmapping. Use
  `smart_project` on all objects in multi-object edit mode, then `pack_islands`.
- Bone axes after `bpy.ops.armature.calculate_roll` (roll aligns each bone's Z axis):
  - Humanoid (roll `GLOBAL_POS_X`), bones pointing down (thigh, shin, upper_arm, forearm): `+rz` swings
    the tail backward (world +Y), `-rz` forward; `+rx` moves the tail toward world +X on both sides.
  - Humanoid bones pointing up (spine, chest, neck, head): `+rz` bends forward; `+rx` leans toward world
    +X; `+ry` twists the front toward world +X (the character's left).
  - Creature (roll `GLOBAL_POS_Z`), horizontal bones (body, thorax, head): `+rx` pitches the tail up,
    `+rz` yaws toward world +X. Creature legs: `+rx` lifts; `+rz` swings `.L` backward but `.R`
    forward.
- Characters face world -Y in Blender, which exports as +Z in glTF (toward a default three.js camera).
  A character's left side is world +X.

## File map

| File | Responsibility |
|---|---|
| `blender/run.py` | headless entry: parse args, run a recipe, write sidecars |
| `blender/lib/png.py` | PNG writer, sRGB conversions |
| `blender/lib/ctx.py` | `BuildContext`, `AssetRecord`, `AnimRecord` |
| `blender/lib/scene.py` | reset, Cycles device, selection, join, transforms, bounds, counts |
| `blender/lib/palette.py` | blueprint palettes, region materials, paint styles |
| `blender/lib/geo.py` | primitive builders and modifiers |
| `blender/lib/ink.py` | the `_ink` width attribute |
| `blender/lib/paint.py` | UVs, six bake passes, numpy composite, final material |
| `blender/lib/rig.py` | humanoid and creature armatures, rigid binding |
| `blender/lib/anim.py` | pose keying, actions on NLA tracks, mirroring |
| `blender/lib/export.py` | GLB export, Workbench previews |
| `blender/recipes/*.py` | one family each |
| `tests/blender/run_tests.py` | Blender-side unit tests |
| `tools/assets/blender.mjs` | find and run Blender |
| `tools/assets/optimize.mjs`, `inspect.mjs`, `manifest.mjs`, `sheet.mjs`, `check.mjs`, `build.mjs`, `test-blender.mjs` | the Node pipeline |
| `tools/assets/budgets.json`, `src/shared/timings.json` | budgets and shared strike timings |
| `tests/unit/assets/*.test.ts` | Node pipeline tests |

---

### Task 1: Dependencies, timings, budgets and scripts

**Files:**
- Create: `src/shared/timings.json`, `tools/assets/budgets.json`, `blender/lib/__init__.py`, `blender/recipes/__init__.py`
- Modify: `package.json`

- [ ] **Step 1: Install the Node dependencies**

Run: `npm install --save-exact --save-dev @gltf-transform/core@4.5.0 @gltf-transform/extensions@4.5.0 @gltf-transform/functions@4.5.0 meshoptimizer@1.2.0 sharp@0.35.4`
Expected: `added N packages`, no errors.

- [ ] **Step 2: Write `src/shared/timings.json`**

These are the reference game's strike timings (v3: the cleave strikes at 0.40 of its 0.85 s swing; a Husk winds up for 0.40 s of its 1.40 s blow). Recipes key the strike frame from this file and the asset check compares the exported clips to it, so the animation and the simulation can never disagree by more than a frame.

```json
{
  "commanders": {
    "bulwark": {
      "attack": { "duration": 0.85, "strike": 0.34 }
    }
  },
  "xeno": {
    "husk": {
      "attack": { "duration": 1.4, "strike": 0.4 }
    }
  }
}
```

- [ ] **Step 3: Write `tools/assets/budgets.json`**

Triangle budgets count the whole GLB (towers hold three marks, the heart holds eleven stages of which one shows).

```json
{
  "commanders": { "tris": 24000, "bones": 32, "texture": 1024, "ink": true, "animations": ["idle", "run", "attack"] },
  "xeno": { "tris": 9000, "bones": 24, "texture": 1024, "ink": true, "animations": ["idle", "walk", "attack"] },
  "towers": { "tris": 36000, "bones": 0, "texture": 1024, "ink": true },
  "heart": { "tris": 30000, "bones": 0, "texture": 1024, "ink": true },
  "nests": { "tris": 8000, "bones": 0, "texture": 512, "ink": true },
  "env": { "tris": 20000, "bones": 0, "texture": 1024, "ink": true }
}
```

- [ ] **Step 4: Create the Python packages**

```bash
mkdir -p blender/lib blender/recipes tests/blender tools/assets
printf '"""Shared Blender pipeline for 99 Planets To Defend (see docs/superpowers/plans/2026-09-23-m0c-blender-pipeline.md)."""\n' > blender/lib/__init__.py
printf '"""One recipe per asset family. Each module exposes build(ctx) -> list[AssetRecord]."""\n' > blender/recipes/__init__.py
```

- [ ] **Step 5: Add the scripts to `package.json`**

In `"scripts"`, add:

```json
    "assets": "node tools/assets/build.mjs",
    "assets:check": "node tools/assets/check.mjs",
    "test:blender": "node tools/assets/test-blender.mjs",
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/shared/timings.json tools/assets/budgets.json blender/lib/__init__.py blender/recipes/__init__.py
git commit -F - <<'EOF'
Add asset pipeline dependencies, shared strike timings and budgets

timings.json carries the reference game's strike timings; recipes key the
strike frame from it and the asset check compares exported clips to it, so
animation and simulation cannot drift apart by more than one frame.
budgets.json sets per-family triangle, bone and texture ceilings and which
families must carry the _INK width attribute.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Blender runner, test harness and the base library

**Files:**
- Create: `tools/assets/blender.mjs`, `tools/assets/test-blender.mjs`, `tests/blender/run_tests.py`, `blender/lib/png.py`, `blender/lib/ctx.py`, `blender/lib/scene.py`

- [ ] **Step 1: Write `tools/assets/blender.mjs`**

```js
// Finds Blender and runs a Python script headless, collecting its output. --python-exit-code 1 makes an
// uncaught Python exception exit non-zero, which Blender does not do by default.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function findBlender() {
  const candidates = [process.env.BLENDER_PATH, join(homedir(), 'tools', 'blender-5.2.1', 'blender.exe')].filter(Boolean);
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error('Blender not found: set BLENDER_PATH to Blender 5.2.1 LTS');
  return found;
}

export function runBlender(scriptArgs, { label = 'blender', quiet = true } = {}) {
  const args = ['-b', '--factory-startup', '--python-exit-code', '1', ...scriptArgs];
  return new Promise((resolve) => {
    const child = spawn(findBlender(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    const collect = (chunk) => {
      const text = chunk.toString();
      log += text;
      if (!quiet) process.stdout.write(text);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('close', (code) => resolve({ label, code: code ?? 1, log }));
  });
}
```

- [ ] **Step 2: Write `tools/assets/test-blender.mjs`**

```js
#!/usr/bin/env node
// npm run test:blender: runs tests/blender/run_tests.py inside Blender and fails unless it reports fail=0.
import { join, resolve } from 'node:path';
import { runBlender } from './blender.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const result = await runBlender(['--python', join(root, 'tests', 'blender', 'run_tests.py')], { label: 'tests', quiet: false });
const summary = result.log.split(/\r?\n/).find((line) => line.startsWith('BLENDER_TESTS'));
if (result.code !== 0 || !summary || !summary.includes('fail=0')) {
  console.error('blender tests failed');
  process.exit(1);
}
```

- [ ] **Step 3: Write the failing harness `tests/blender/run_tests.py`**

Later tasks append test functions above `main()`. Every test starts from an empty scene.

```python
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
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm run test:blender`
Expected: FAIL with `ModuleNotFoundError: No module named 'lib.scene'` and `blender tests failed`.

- [ ] **Step 5: Write `blender/lib/png.py`**

```python
"""PNG writing and sRGB conversion. Blender regenerates a generated image to black if its colour space
changes after its pixels are written, so every texture is written here and loaded back by path."""
import struct
import zlib

import numpy as np


def write_png(path, array):
    """array: floats in 0..1 shaped (H, W), (H, W, 3) or (H, W, 4); row 0 is the top of the image."""
    a = np.clip(np.asarray(array, dtype=np.float64) * 255.0 + 0.5, 0, 255).astype(np.uint8)
    if a.ndim == 2:
        color_type, channels = 0, 1
    elif a.shape[2] == 3:
        color_type, channels = 2, 3
    elif a.shape[2] == 4:
        color_type, channels = 6, 4
    else:
        raise ValueError(f'write_png: unsupported shape {a.shape}')
    height, width = a.shape[:2]
    rows = a.reshape(height, width * channels)
    raw = b''.join(b'\x00' + rows[y].tobytes() for y in range(height))

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = struct.pack('>IIBBBBB', width, height, 8, color_type, 0, 0, 0)
    with open(path, 'wb') as handle:
        handle.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def linear_to_srgb(x):
    x = np.clip(np.asarray(x, dtype=np.float64), 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1.0 / 2.4) - 0.055)


def srgb_to_linear(x):
    x = np.clip(np.asarray(x, dtype=np.float64), 0.0, 1.0)
    return np.where(x <= 0.04045, x / 12.92, np.power((x + 0.055) / 1.055, 2.4))
```

- [ ] **Step 6: Write `blender/lib/ctx.py`**

```python
"""What a recipe receives and what it returns."""
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass
class AnimRecord:
    name: str
    duration: float            # seconds
    loop: bool
    strike: float | None = None  # seconds from the start, for attacks


@dataclass
class AssetRecord:
    name: str                  # e.g. 'bulwark'
    family: str                # commanders | xeno | towers | heart | nests | env | textures
    file: str                  # path under the output root, e.g. 'commanders/bulwark.glb'
    kind: str = 'model'        # model | texture
    recipe: str = ''
    nodes: list = field(default_factory=list)
    animations: list = field(default_factory=list)
    tris: int = 0
    notes: dict = field(default_factory=dict)


@dataclass
class BuildContext:
    root: Path                 # repository root
    out: Path                  # raw GLB, sidecars and bake textures
    previews: Path             # preview renders
    textures: Path             # public/assets/textures (the brush atlas lives here)
    seed: int = 1
    previews_enabled: bool = True
    recipe: str = ''

    def ensure_dirs(self):
        for path in (self.out, self.previews, self.textures):
            path.mkdir(parents=True, exist_ok=True)

    def raw_path(self, family, name):
        path = self.out / family / f'{name}.glb'
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def bake_dir(self, family):
        path = self.out / family / 'textures'
        path.mkdir(parents=True, exist_ok=True)
        return path

    def preview_dir(self, name):
        path = self.previews / name
        path.mkdir(parents=True, exist_ok=True)
        return path

    def timings(self):
        return json.loads((self.root / 'src' / 'shared' / 'timings.json').read_text(encoding='utf-8'))

    def write_sidecar(self, record):
        record.recipe = self.recipe
        path = self.out / record.family / f'{record.name}.meta.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        data = asdict(record)
        data['animations'] = [asdict(a) if hasattr(a, '__dataclass_fields__') else a for a in record.animations]
        path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
        return path
```

- [ ] **Step 7: Write `blender/lib/scene.py`**

```python
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
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm run test:blender`
Expected: `PASS test_png_round_trip`, `PASS test_srgb_conversions_invert`, `BLENDER_TESTS pass=2 fail=0`.

- [ ] **Step 9: Commit**

```bash
git add tools/assets/blender.mjs tools/assets/test-blender.mjs tests/blender/run_tests.py blender/lib/png.py blender/lib/ctx.py blender/lib/scene.py
git commit -F - <<'EOF'
Add the headless Blender runner, its test harness and the base library

tools/assets/blender.mjs runs Blender with --python-exit-code 1 so a Python
exception fails the run. tests/blender/run_tests.py runs every test_*
function from an empty scene and prints BLENDER_TESTS pass fail. png.py
writes textures with zlib because Blender blanks a generated image whose
colour space changes after its pixels are written; the round-trip test
checks orientation (Blender stores the bottom row first).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Palettes, geometry and ink

**Files:**
- Create: `blender/lib/palette.py`, `blender/lib/geo.py`, `blender/lib/ink.py`
- Modify: `tests/blender/run_tests.py` (add tests above `main()`, and the imports)

- [ ] **Step 1: Add the failing tests**

Add to the imports at the top of `tests/blender/run_tests.py`:

```python
from lib import geo, ink, palette  # noqa: E402
```

Add above `def main():`:

```python
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:blender`
Expected: FAIL, `No module named 'lib.geo'` (or `palette`).

- [ ] **Step 3: Write `blender/lib/palette.py`**

```python
"""Named palettes from docs/blueprint.md (Art direction, Content). Colours are authored as sRGB hex and
converted to linear for Blender. A region material carries its colours as custom properties that the
paint bake reads; its node tree is rebuilt per bake pass."""
from dataclasses import dataclass

import bpy

from .png import srgb_to_linear


def hex_to_linear(hex_color):
    h = hex_color.lstrip('#')
    return tuple(float(srgb_to_linear(int(h[i:i + 2], 16) / 255.0)) for i in (0, 2, 4))


PLAYER = {
    'gunmetal': '#3d4757', 'gunmetal_light': '#566276', 'trim': '#cdd8e6', 'enamel': '#d9d2c0',
    'undersuit': '#22273a', 'leather': '#6b4a33', 'energy': '#59f2ff',
}
XENO = {'chitin': '#241a38', 'chitin_light': '#3a2c52', 'bone': '#8c7f96', 'seam': '#ff3fa6', 'seam_violet': '#d84dff'}
HEART = {'core': '#ffc36b', 'facet': '#ffb38a', 'deep': '#ff8a3d', 'stone': '#9c8a74', 'inlay': '#ffc857'}
VERDANT = {
    'meadow': '#4ec98a', 'meadow_light': '#7fdd9e', 'moss': '#2e8f6a', 'stone': '#8a8378', 'stone_cool': '#6b7a8f',
    'bark': '#6b4a33', 'foliage': '#3e9f6e', 'foliage_light': '#7fdd9e', 'flower': '#ffc857', 'flower_warm': '#ffb347',
}


def region(name, base_hex, emit_hex=None):
    """A paint region: one flat base colour and an optional emissive colour."""
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    mat = bpy.data.materials.new(name)
    base = hex_to_linear(base_hex)
    mat['p99_base'] = list(base)
    mat['p99_emit'] = list(hex_to_linear(emit_hex)) if emit_hex else [0.0, 0.0, 0.0]
    mat.diffuse_color = (*base, 1.0)
    return mat


@dataclass
class PaintStyle:
    """How the numpy composite turns bake passes into a painted colour map (see paint.composite)."""
    shadow_tint: tuple = (0.42, 0.62, 0.70)   # occlusion takes this colour instead of grey
    ao_strength: float = 0.7
    curv_gain: float = 8.0
    edge_light: float = 0.35
    edge_tint: tuple = (1.0, 0.93, 0.8)
    cavity_dark: float = 0.4
    warm: tuple = (1.08, 1.0, 0.9)            # tops lean warm
    cool: tuple = (0.9, 0.96, 1.06)           # bottoms lean cool
    brush_strength: float = 0.45
    stroke_tint_mix: float = 0.25
    emissive_brush: float = 0.25


PLAYER_STYLE = PaintStyle(shadow_tint=(0.40, 0.58, 0.72), edge_light=0.5, cavity_dark=0.5, brush_strength=0.3)
XENO_STYLE = PaintStyle(shadow_tint=(0.55, 0.35, 0.70), ao_strength=0.8, edge_light=0.3, edge_tint=(0.9, 0.8, 1.0), cavity_dark=0.6, brush_strength=0.35)
NATURE_STYLE = PaintStyle(shadow_tint=(0.35, 0.60, 0.62), ao_strength=0.65, edge_light=0.25, cavity_dark=0.35, brush_strength=0.6, stroke_tint_mix=0.35)
HEART_STYLE = PaintStyle(shadow_tint=(0.85, 0.55, 0.50), ao_strength=0.35, edge_light=0.7, edge_tint=(1.0, 0.95, 0.85), cavity_dark=0.2, brush_strength=0.25, emissive_brush=0.35)
```

- [ ] **Step 4: Write `blender/lib/geo.py`**

```python
"""Primitive builders and modifiers. Builders return a linked mesh object whose mesh is centred on its own
origin, with location and rotation left on the object, so a recipe can place parts, parent them and apply
transforms only when it joins them."""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

from . import scene


def _from_bmesh(name, bm, material):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    ob = scene.link(bpy.data.objects.new(name, mesh))
    if material is not None:
        mesh.materials.append(material)
    return ob


def _place(ob, location, rotation):
    ob.location = location
    ob.rotation_euler = rotation
    return ob


def modifier(ob, kind, **settings):
    mod = ob.modifiers.new(kind.lower(), kind)
    for key, value in settings.items():
        setattr(mod, key, value)
    scene.apply_modifiers(ob)
    return ob


def add_bevel(ob, width, segments=2):
    return modifier(ob, 'BEVEL', width=width, segments=segments, limit_method='ANGLE')


def box(name, size, location=(0, 0, 0), rotation=(0, 0, 0), bevel=0.0, segments=2, material=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    ob = _place(_from_bmesh(name, bm, material), location, rotation)
    if bevel > 0:
        add_bevel(ob, bevel, segments)
    return ob


def cylinder(name, radius, depth, segments=16, radius_top=None, location=(0, 0, 0), rotation=(0, 0, 0), bevel=0.0, material=None, caps=True):
    bm = bmesh.new()
    top = radius if radius_top is None else radius_top
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segments, radius1=radius, radius2=top, depth=depth)
    ob = _place(_from_bmesh(name, bm, material), location, rotation)
    if bevel > 0:
        add_bevel(ob, bevel)
    return ob


def ico(name, radius, subdivisions=2, scale=(1, 1, 1), location=(0, 0, 0), rotation=(0, 0, 0), material=None):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    return _place(_from_bmesh(name, bm, material), location, rotation)


def uv_sphere(name, radius, segments=16, rings=8, scale=(1, 1, 1), location=(0, 0, 0), rotation=(0, 0, 0), material=None, hemisphere=False):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    if hemisphere:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, 0), plane_no=(0, 0, 1), clear_inner=True)
        bmesh.ops.holes_fill(bm, edges=bm.edges[:], sides=0)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    return _place(_from_bmesh(name, bm, material), location, rotation)


def segment(name, head, tail, radius_head, radius_tail, segments=8, material=None):
    """A tapered cylinder from head to tail, for limbs laid along bones."""
    head, tail = Vector(head), Vector(tail)
    direction = tail - head
    ob = cylinder(name, radius_head, direction.length, segments=segments, radius_top=radius_tail, material=material)
    ob.rotation_euler = Vector((0, 0, 1)).rotation_difference(direction).to_euler()
    ob.location = (head + tail) / 2
    return ob


def displace(ob, strength, frequency=1.5, seed=0, octaves=3):
    """Pushes vertices along their normals by fractal noise; the seed shifts the noise field."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    offset = Vector((seed * 13.1, seed * 7.7, seed * 3.3))
    for vertex in bm.verts:
        vertex.co += vertex.normal * strength * noise.fractal(vertex.co * frequency + offset, 0.5, 2.0, octaves)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


def facet(ob, angle_deg=12.0):
    """Merges near-coplanar faces into broad planes: the simplified volume Sifu paints over."""
    return modifier(ob, 'DECIMATE', decimate_type='DISSOLVE', angle_limit=math.radians(angle_deg))


def smooth(ob, levels=1):
    return modifier(ob, 'SUBSURF', levels=levels, render_levels=levels)


def bend(ob, angle_deg, axis='Z'):
    return modifier(ob, 'SIMPLE_DEFORM', deform_method='BEND', angle=math.radians(angle_deg), deform_axis=axis)


def taper(ob, factor, axis='Z'):
    return modifier(ob, 'SIMPLE_DEFORM', deform_method='TAPER', factor=factor, deform_axis=axis)


def shade_flat(ob):
    for poly in ob.data.polygons:
        poly.use_smooth = False
    return ob


def shade_smooth(ob, angle_deg=40.0):
    scene.select_only([ob])
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))
    return ob


def assign_by_normal(ob, up, side, threshold=0.55):
    """Faces whose object-space normal points up take `up` (moss on rocks, sunlit crowns on trees)."""
    mesh = ob.data
    mesh.materials.clear()
    mesh.materials.append(side)
    mesh.materials.append(up)
    for poly in mesh.polygons:
        poly.material_index = 1 if poly.normal.z > threshold else 0
    return ob


def rotation_z(angle):
    return Matrix.Rotation(angle, 3, 'Z')
```

- [ ] **Step 5: Write `blender/lib/ink.py`**

```python
"""The `_ink` attribute: a per-vertex width multiplier for the runtime hull outline.

Stored as width / 2 so the value sits in 0..1: glTF-Transform's meshopt step quantizes custom attributes as
normalized integers, which would clamp anything above 1. The runtime multiplies by 2 again."""
import numpy as np


def set_ink(ob, width=1.0):
    mesh = ob.data
    attr = mesh.attributes.get('_ink') or mesh.attributes.new('_ink', 'FLOAT', 'POINT')
    attr.data.foreach_set('value', np.full(len(mesh.vertices), float(width) / 2.0, np.float32))
    ob['ink'] = float(width)
    return ob


def ensure_ink(ob, width=1.0):
    if ob.data.attributes.get('_ink') is None:
        set_ink(ob, width)
    return ob
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:blender`
Expected: `BLENDER_TESTS pass=6 fail=0`.

- [ ] **Step 7: Commit**

```bash
git add blender/lib/palette.py blender/lib/geo.py blender/lib/ink.py tests/blender/run_tests.py
git commit -F - <<'EOF'
Add palettes, geometry builders and the _ink width attribute

Region materials carry linear base and emissive colours as custom properties
for the paint bake. Paint styles hold the composite dials per family (player
tech, Xeno, nature, heart). Geometry builders keep meshes centred on their
own origin so parts can be placed and parented. _ink is stored as width / 2
because meshopt quantizes custom attributes as normalized integers.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Rigs and actions

**Files:**
- Create: `blender/lib/rig.py`, `blender/lib/anim.py`, `blender/lib/export.py`
- Modify: `tests/blender/run_tests.py`

- [ ] **Step 1: Add the failing tests**

Add to the imports:

```python
from lib import anim, export, rig  # noqa: E402
```

Add above `def main():`:

```python
def _tail(arm, bone):
    bpy.context.view_layer.update()
    return arm.matrix_world @ arm.pose.bones[bone].tail


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


def test_creature_leg_swing_is_forward_on_both_sides(tmp):
    arm = rig.creature('rig')
    for side in ('L', 'R'):
        anim.clear_pose(arm)
        rest = _tail(arm, f'leg_front_lower.{side}').y
        arm.pose.bones[f'leg_front_upper.{side}'].rotation_euler = (0, 0, anim.leg_swing(side, 0.4))
        assert _tail(arm, f'leg_front_lower.{side}').y < rest - 0.05, side


def test_rigid_binding_and_action_export(tmp):
    arm = rig.humanoid('rig')
    upper = geo.box('upper', (0.2, 0.2, 0.4), location=(0.12, 0, 0.78))
    lower = geo.box('lower', (0.18, 0.18, 0.4), location=(0.12, 0, 0.33))
    for part in (upper, lower):
        ink.set_ink(part, 1.0)
    body = rig.bind_rigid(arm, [(upper, 'thigh.L'), (lower, 'shin.L')], 'body')
    assert {g.name for g in body.vertex_groups} == {'thigh.L', 'shin.L'}
    walk = anim.make_action(arm, 'walk', [(1, {'thigh.L': (0, 0, -0.4)}), (11, {'thigh.L': (0, 0, 0.4)})])
    kick = anim.make_action(arm, 'kick', [(1, {}), (6, {'shin.L': (0, 0, 0.8)})])
    assert abs(anim.duration(walk) - 10 / 30) < 1e-6
    path = export.export_glb([arm, body], tmp / 'rig.glb', animations=True)
    gj = glb_json(path)
    assert sorted(a['name'] for a in gj['animations']) == ['kick', 'walk'], gj.get('animations')
    attrs = gj['meshes'][0]['primitives'][0]['attributes']
    assert '_INK' in attrs and 'JOINTS_0' in attrs, attrs
    assert kick is not None
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:blender`
Expected: FAIL, `No module named 'lib.rig'`.

- [ ] **Step 3: Write `blender/lib/rig.py`**

```python
"""Armatures and rigid binding. Armour and chitin are rigid, so each part binds fully to one bone: no
weight painting, no twisting artefacts, and silhouettes hold in every pose.

Bones are listed for the left side and the centre; right-side bones are mirrored across X. Roll is
computed with calculate_roll, which aligns each bone's Z axis; the axis conventions this produces are
measured and recorded in anim.py."""
import bpy

from . import ink, scene

HUMANOID_LEFT = [
    ('root', (0, 0, 0), (0, 0, 0.3), None),
    ('hips', (0, 0, 1.00), (0, 0, 1.12), 'root'),
    ('spine', (0, 0, 1.12), (0, 0, 1.30), 'hips'),
    ('chest', (0, 0, 1.30), (0, 0, 1.52), 'spine'),
    ('neck', (0, 0, 1.52), (0, 0, 1.62), 'chest'),
    ('head', (0, 0, 1.62), (0, 0, 1.92), 'neck'),
    ('shoulder.L', (0.06, 0, 1.47), (0.21, 0, 1.47), 'chest'),
    ('upper_arm.L', (0.23, 0, 1.46), (0.30, 0, 1.20), 'shoulder.L'),
    ('forearm.L', (0.30, 0, 1.20), (0.34, -0.03, 0.96), 'upper_arm.L'),
    ('hand.L', (0.34, -0.03, 0.96), (0.35, -0.05, 0.85), 'forearm.L'),
    ('socket.L', (0.36, -0.06, 1.05), (0.36, -0.20, 1.05), 'forearm.L'),  # shield mount on the forearm
    ('thigh.L', (0.11, 0, 1.00), (0.12, 0, 0.56), 'hips'),
    ('shin.L', (0.12, 0, 0.56), (0.12, 0.03, 0.11), 'thigh.L'),
    ('foot.L', (0.12, 0.03, 0.11), (0.12, -0.13, 0.03), 'shin.L'),
]

# socket.R sits in the right hand at the sword grip; replace the mirrored one after mirroring.
HUMANOID_SOCKET_R = ('socket.R', (-0.35, -0.05, 0.88), (-0.35, -0.20, 0.88), 'hand.R')

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
```

- [ ] **Step 4: Write `blender/lib/anim.py`**

```python
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
    """Mirrors left and right. Humanoid axes are the same on both sides, so sideways (rx) and twist (ry)
    flip; creature legs mirror their swing axis, so ry and rz flip there."""
    out = {}
    for key, value in pose.items():
        if key.endswith('@loc'):
            bone = key[:-4]
            x, y, z = value
            out[f'{mirror_name(bone)}@loc'] = (-x, y, z) if kind == 'humanoid' else (x, y, z)
            continue
        rx, ry, rz = value
        out[mirror_name(key)] = (-rx, -ry, rz) if kind == 'humanoid' else (rx, -ry, -rz)
    return out


def merge(*poses):
    out = {}
    for pose in poses:
        out.update(pose)
    return out
```

- [ ] **Step 5: Write `blender/lib/export.py`**

```python
"""GLB export and Workbench previews."""
import math
from pathlib import Path

import bpy
from mathutils import Vector

from . import anim, scene


def export_glb(objs, path, animations=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    scene.select_only(objs)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_extras=True,
        export_animations=animations,
        export_animation_mode='ACTIONS',
        export_skins=True,
        export_morph=False,
        export_lights=False,
        export_cameras=False,
        export_attributes=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_optimize_animation_size=True,
        export_def_bones=False,
    )
    return path


def _workbench(size):
    scn = bpy.context.scene
    scn.render.engine = 'BLENDER_WORKBENCH'
    scn.render.resolution_x = size
    scn.render.resolution_y = size
    scn.render.film_transparent = False
    shading = scn.display.shading
    shading.light = 'STUDIO'
    shading.color_type = 'TEXTURE'
    shading.show_object_outline = True
    shading.object_outline_color = (0.05, 0.05, 0.07)


def _camera():
    cam = bpy.data.objects.get('p99_preview_cam')
    if cam is None:
        cam = scene.link(bpy.data.objects.new('p99_preview_cam', bpy.data.cameras.new('p99_preview_cam')))
    cam.data.lens = 50
    bpy.context.scene.camera = cam
    return cam


def _aim(cam, target, distance, yaw, pitch):
    cam.location = (
        target.x + distance * math.cos(pitch) * math.sin(yaw),
        target.y - distance * math.cos(pitch) * math.cos(yaw),
        target.z + distance * math.sin(pitch),
    )
    cam.rotation_euler = (target - Vector(cam.location)).to_track_quat('-Z', 'Y').to_euler()


def _framing(objs):
    lo, hi = scene.world_bounds(objs)
    center = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.1)
    return center, radius


def render_views(objs, out_dir, prefix, views=4, size=512, pitch_deg=18.0):
    """Renders the objects from `views` yaw angles, starting at a front three-quarter view."""
    _workbench(size)
    cam = _camera()
    center, radius = _framing(objs)
    distance = radius / math.sin(cam.data.angle / 2) * 1.05
    paths = []
    for i in range(views):
        _aim(cam, center, distance, math.radians(-35 + i * 360 / views), math.radians(pitch_deg))
        path = Path(out_dir) / f'{prefix}_view{i}.png'
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    return paths


def render_action(arm, objs, action, out_dir, prefix, frames=6, size=384):
    """A filmstrip: `frames` evenly spaced poses of one action from a front three-quarter view."""
    restore = anim.play(arm, action)
    _workbench(size)
    cam = _camera()
    center, radius = _framing(objs)
    distance = radius * 1.35 / math.sin(cam.data.angle / 2)
    start, end = action.frame_range
    paths = []
    for k in range(frames):
        frame = start + (end - start) * k / max(frames - 1, 1)
        bpy.context.scene.frame_set(int(round(frame)))
        _aim(cam, center, distance, math.radians(-35), math.radians(12))
        path = Path(out_dir) / f'{prefix}_{action.name}_{k}.png'
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    restore()
    bpy.context.scene.frame_set(1)
    return paths
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:blender`
Expected: `BLENDER_TESTS pass=10 fail=0`. If `test_humanoid_axis_conventions` fails, the roll calculation changed: print the tail deltas for each axis (as in the spike recorded under "Facts measured") and update both the conventions in `anim.py` and this plan's poses before continuing.

- [ ] **Step 7: Commit**

```bash
git add blender/lib/rig.py blender/lib/anim.py blender/lib/export.py tests/blender/run_tests.py
git commit -F - <<'EOF'
Add rigid-bound rigs, actions on NLA tracks, GLB export and previews

The humanoid (22 bones with a hand socket and a shield socket) and the Xeno
creature (17 bones) mirror their left side and compute roll with
calculate_roll. The axis conventions that produces are measured, written
into anim.py and pinned by tests: a leg swings forward on negative rz, the
spine bends forward on positive rz, and creature legs need leg_swing because
their swing axis mirrors. An exported rig carries both stashed actions, a
skin and the _INK attribute.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: The paint bake

**Files:**
- Create: `blender/lib/paint.py`
- Modify: `tests/blender/run_tests.py`

- [ ] **Step 1: Add the failing tests**

Add to the imports:

```python
from lib import paint  # noqa: E402
```

Add above `def main():`:

```python
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:blender`
Expected: FAIL, `No module named 'lib.paint'`.

- [ ] **Step 3: Write `blender/lib/paint.py`**

```python
"""The painted colour map. Six Cycles EMIT passes are baked into float images: the region colour, ambient
occlusion, curvature (pointiness), a per-object height gradient, box-projected brush strokes and the
emissive colour. numpy composites them into an albedo and an emissive map (see composite), which are
written as sRGB PNG files and assigned through one final material, so each asset draws with a single
material and a single atlas."""
import math
from pathlib import Path

import bpy
import numpy as np

from . import scene
from .palette import PaintStyle
from .png import linear_to_srgb, write_png

PASSES = ('region', 'ao', 'curv', 'height', 'brush', 'emit')


def composite(region, ao, curv, height, brush, emit, style):
    """All inputs linear: region (H, W, 3); ao, curv, height, brush (H, W); emit (H, W, 3).
    Occlusion shifts toward the style's shadow colour instead of grey; convex edges catch warm light;
    cavities darken; tops lean warm and bottoms cool; brush strokes vary value and pull dark strokes
    toward the shadow hue."""
    shadow = np.asarray(style.shadow_tint, dtype=np.float64)
    occlusion = 1.0 - style.ao_strength * (1.0 - np.clip(ao, 0.0, 1.0))
    col = region * (occlusion[..., None] + (1.0 - occlusion[..., None]) * shadow)
    convex = np.clip((curv - 0.5) * style.curv_gain, 0.0, 1.0)[..., None]
    concave = np.clip((0.5 - curv) * style.curv_gain, 0.0, 1.0)[..., None]
    col = col + convex * style.edge_light * np.asarray(style.edge_tint) * (0.25 + col)
    col = col * (1.0 - style.cavity_dark * concave)
    t = np.clip(height, 0.0, 1.0)
    t = t * t * (3.0 - 2.0 * t)
    cool = np.asarray(style.cool)
    warm = np.asarray(style.warm)
    col = col * (cool + (warm - cool) * t[..., None])
    stroke = (np.clip(brush, 0.0, 1.0) - 0.5) * 2.0
    col = col * (1.0 + stroke[..., None] * style.brush_strength * 0.5)
    dark = np.clip(-stroke, 0.0, 1.0)[..., None] * style.stroke_tint_mix
    col = col * (1.0 - dark) + col * shadow * 1.6 * dark
    albedo = np.clip(col, 0.0, 1.0)
    emissive = np.clip(emit * (1.0 + stroke[..., None] * style.emissive_brush), 0.0, 1.0)
    return albedo, emissive


def prepare_uvs(objs, angle_deg=66.0, margin=0.02):
    """Large islands shared across all objects: smart project in multi-object edit mode, then pack."""
    scene.select_only(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle_deg), island_margin=margin)
    bpy.ops.uv.pack_islands(margin=margin * 0.5, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')


def write_height_attribute(objs):
    """Normalised object-space height per vertex (0 at the lowest point, 1 at the highest)."""
    for ob in objs:
        mesh = ob.data
        co = np.empty(len(mesh.vertices) * 3, np.float32)
        mesh.vertices.foreach_get('co', co)
        z = co[2::3]
        span = max(float(z.max() - z.min()), 1e-6)
        h = (z - z.min()) / span
        attr = mesh.color_attributes.get('p99_height') or mesh.color_attributes.new('p99_height', 'FLOAT_COLOR', 'POINT')
        rgba = np.repeat(h, 4).astype(np.float32)
        rgba[3::4] = 1.0
        attr.data.foreach_set('color', rgba)


def _materials(objs):
    seen = []
    for ob in objs:
        for mat in ob.data.materials:
            if mat is not None and mat not in seen:
                seen.append(mat)
    return seen


def _pass_tree(mat, pass_name, target, params):
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    emission = nt.nodes.new('ShaderNodeEmission')
    emission.inputs['Strength'].default_value = 1.0
    nt.links.new(emission.outputs['Emission'], out.inputs['Surface'])
    color = emission.inputs['Color']
    if pass_name == 'region':
        color.default_value = (*mat['p99_base'], 1.0)
    elif pass_name == 'emit':
        color.default_value = (*mat['p99_emit'], 1.0)
    elif pass_name == 'ao':
        ao = nt.nodes.new('ShaderNodeAmbientOcclusion')
        ao.samples = params['ao_samples']
        ao.inputs['Distance'].default_value = params['ao_distance']
        nt.links.new(ao.outputs['AO'], color)
    elif pass_name == 'curv':
        geometry = nt.nodes.new('ShaderNodeNewGeometry')
        nt.links.new(geometry.outputs['Pointiness'], color)
    elif pass_name == 'height':
        attribute = nt.nodes.new('ShaderNodeAttribute')
        attribute.attribute_type = 'GEOMETRY'
        attribute.attribute_name = 'p99_height'
        nt.links.new(attribute.outputs['Color'], color)
    elif pass_name == 'brush':
        coords = nt.nodes.new('ShaderNodeTexCoord')
        mapping = nt.nodes.new('ShaderNodeMapping')
        s = params['brush_scale']
        mapping.inputs['Scale'].default_value = (s, s, s)
        image = nt.nodes.new('ShaderNodeTexImage')
        image.image = params['brush_image']
        image.projection = 'BOX'
        image.projection_blend = 0.35
        nt.links.new(coords.outputs['Object'], mapping.inputs['Vector'])
        nt.links.new(mapping.outputs['Vector'], image.inputs['Vector'])
        nt.links.new(image.outputs['Color'], color)
    target_node = nt.nodes.new('ShaderNodeTexImage')
    target_node.image = target
    nt.nodes.active = target_node


def _bake(objs, pass_name, size, params, margin):
    target = bpy.data.images.new(f'p99_bake_{pass_name}', size, size, alpha=False, float_buffer=True)
    target.colorspace_settings.name = 'Non-Color'  # set before the bake writes, never after
    for mat in _materials(objs):
        _pass_tree(mat, pass_name, target, params)
    scene.select_only(objs)
    bpy.ops.object.bake(type='EMIT', margin=margin, use_clear=True)
    buffer = np.empty(size * size * 4, np.float32)
    target.pixels.foreach_get(buffer)
    bpy.data.images.remove(target)
    return buffer.reshape(size, size, 4)[::-1].astype(np.float64)  # row 0 at the top, as PNG expects


def final_material(name, albedo_path, emissive_path, emissive_strength):
    mat = bpy.data.materials.new(name)
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Metallic'].default_value = 0.0
    albedo = nt.nodes.new('ShaderNodeTexImage')
    albedo.image = bpy.data.images.load(str(albedo_path))
    albedo.image.colorspace_settings.name = 'sRGB'
    nt.links.new(albedo.outputs['Color'], bsdf.inputs['Base Color'])
    if emissive_path is not None:
        emissive = nt.nodes.new('ShaderNodeTexImage')
        emissive.image = bpy.data.images.load(str(emissive_path))
        emissive.image.colorspace_settings.name = 'sRGB'
        nt.links.new(emissive.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = emissive_strength
    nt.nodes.active = albedo  # Workbench previews show the active image node
    mat['p99_painted'] = True
    return mat


def paint(objs, *, name, out_dir, textures_dir, size=1024, style=None, ao_distance=0.4, ao_samples=32,
          brush_scale=1.0, emissive_strength=4.0, margin=8):
    """Bakes, composites and assigns the painted material to every mesh in objs. Returns the material."""
    style = style or PaintStyle()
    objs = scene.meshes(objs)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    prepare_uvs(objs)
    write_height_attribute(objs)
    brush = bpy.data.images.load(str(Path(textures_dir) / 'brush_strokes.png'), check_existing=True)
    brush.colorspace_settings.name = 'Non-Color'
    params = {'ao_samples': ao_samples, 'ao_distance': ao_distance, 'brush_scale': brush_scale, 'brush_image': brush}
    baked = {pass_name: _bake(objs, pass_name, size, params, margin) for pass_name in PASSES}
    albedo, emissive = composite(
        baked['region'][..., :3], baked['ao'][..., 0], baked['curv'][..., 0],
        baked['height'][..., 0], baked['brush'][..., 0], baked['emit'][..., :3], style,
    )
    albedo_path = out_dir / f'{name}_albedo.png'
    emissive_path = out_dir / f'{name}_emissive.png'
    write_png(albedo_path, linear_to_srgb(albedo))
    write_png(emissive_path, linear_to_srgb(emissive))
    has_emissive = float(emissive.max()) > 0.01
    mat = final_material(f'{name}_paint', albedo_path, emissive_path if has_emissive else None, emissive_strength)
    for ob in objs:
        ob.data.materials.clear()
        ob.data.materials.append(mat)
    return mat
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:blender`
Expected: `BLENDER_TESTS pass=13 fail=0`.

- [ ] **Step 5: Commit**

```bash
git add blender/lib/paint.py tests/blender/run_tests.py
git commit -F - <<'EOF'
Add the six-pass paint bake with a numpy composite

Region colour, ambient occlusion, pointiness curvature, a per-object height
gradient, box-projected brush strokes and emissive colour are baked as EMIT
passes into float images (colour space set before baking, never after) and
composited in numpy: occlusion takes the style's shadow colour rather than
grey, edges catch warm light, cavities darken, tops lean warm, and dark
strokes pull toward the shadow hue. Each asset ends with one material and
one atlas. Tests pin the neutral case and the coloured occlusion ratio.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: The recipe entry point

**Files:**
- Create: `blender/run.py`

- [ ] **Step 1: Write `blender/run.py`**

```python
"""Headless entry point:
blender -b --factory-startup --python-exit-code 1 --python blender/run.py -- --recipe NAME --out DIR --previews DIR --textures DIR
Prints RECIPE_OK <name> on success; tools/assets/build.mjs looks for it."""
import argparse
import importlib
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from lib import scene  # noqa: E402
from lib.ctx import BuildContext  # noqa: E402


def parse(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument('--recipe', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--previews', required=True)
    parser.add_argument('--textures', required=True)
    parser.add_argument('--seed', type=int, default=1)
    parser.add_argument('--no-previews', action='store_true')
    return parser.parse_args(argv)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    args = parse(argv)
    scene.reset()
    scene.configure_cycles()
    ctx = BuildContext(
        root=HERE.parent, out=Path(args.out), previews=Path(args.previews), textures=Path(args.textures),
        seed=args.seed, previews_enabled=not args.no_previews, recipe=args.recipe,
    )
    ctx.ensure_dirs()
    started = time.time()
    module = importlib.import_module(f'recipes.{args.recipe}')
    records = module.build(ctx)
    for record in records:
        ctx.write_sidecar(record)
    print(f'RECIPE_OK {args.recipe} assets={len(records)} seconds={time.time() - started:.1f}')


main()
```

- [ ] **Step 2: Commit**

```bash
git add blender/run.py
git commit -F - <<'EOF'
Add the headless recipe entry point

run.py resets the scene, configures Cycles on the GPU when OptiX or CUDA is
available, runs recipes.<name>.build(ctx) and writes one sidecar per asset
record. Exceptions propagate so --python-exit-code 1 fails the process;
success prints RECIPE_OK for the Node orchestrator.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: The Node pipeline

**Files:**
- Create: `tools/assets/optimize.mjs`, `tools/assets/inspect.mjs`, `tools/assets/manifest.mjs`, `tools/assets/check.mjs`, `tools/assets/sheet.mjs`, `tools/assets/build.mjs`
- Test: `tests/unit/assets/check.test.ts`, `tests/unit/assets/manifest.test.ts`

- [ ] **Step 1: Write the failing test `tests/unit/assets/check.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { evaluateAsset } from '../../../tools/assets/check.mjs';

const budgets = {
  xeno: { tris: 9000, bones: 24, texture: 1024, ink: true, animations: ['idle', 'walk', 'attack'] },
};
const timings = { xeno: { husk: { attack: { duration: 1.4, strike: 0.4 } } } };

function husk(overrides: Record<string, unknown> = {}) {
  return {
    name: 'husk',
    family: 'xeno',
    kind: 'model',
    file: 'xeno/husk.glb',
    tris: 5000,
    bones: 17,
    hasInk: true,
    textures: [{ width: 1024, height: 1024 }],
    animations: [
      { name: 'idle', duration: 2, loop: true, strike: null, exportedDuration: 2 },
      { name: 'walk', duration: 1, loop: true, strike: null, exportedDuration: 1 },
      { name: 'attack', duration: 1.4, loop: false, strike: 0.4, exportedDuration: 1.4 },
    ],
    ...overrides,
  };
}

describe('evaluateAsset', () => {
  it('passes an asset inside every budget', () => {
    expect(evaluateAsset(husk(), budgets, timings)).toEqual([]);
  });

  it('reports each broken budget', () => {
    const failures = evaluateAsset(
      husk({ tris: 9001, bones: 30, hasInk: false, textures: [{ width: 2048, height: 2048 }] }),
      budgets,
      timings,
    );
    expect(failures).toEqual([
      'tris 9001 > 9000',
      'bones 30 > 24',
      'texture 2048x2048 > 1024',
      'missing _INK attribute',
    ]);
  });

  it('reports a missing animation and a strike more than a frame off', () => {
    const entry = husk();
    entry.animations = entry.animations
      .filter((a) => a.name !== 'walk')
      .map((a) => (a.name === 'attack' ? { ...a, strike: 0.5 } : a));
    const failures = evaluateAsset(entry, budgets, timings);
    expect(failures).toContain("missing animation 'walk'");
    expect(failures.some((f) => f.startsWith('attack strike 0.5'))).toBe(true);
  });

  it('accepts a strike within one frame', () => {
    const entry = husk();
    entry.animations = entry.animations.map((a) => (a.name === 'attack' ? { ...a, strike: 0.42 } : a));
    expect(evaluateAsset(entry, budgets, timings)).toEqual([]);
  });

  it('skips textures and flags unknown families', () => {
    expect(evaluateAsset({ ...husk(), kind: 'texture' }, budgets, timings)).toEqual([]);
    expect(evaluateAsset({ ...husk(), family: 'nope' }, budgets, timings)).toEqual(["no budget for family 'nope'"]);
  });
});
```

- [ ] **Step 2: Write the failing test `tests/unit/assets/manifest.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { manifestEntry } from '../../../tools/assets/manifest.mjs';

describe('manifestEntry', () => {
  it('merges what the recipe declared with what the GLB holds', () => {
    const meta = {
      name: 'husk',
      family: 'xeno',
      kind: 'model',
      file: 'xeno/husk.glb',
      recipe: 'husk',
      nodes: ['declared'],
      animations: [{ name: 'attack', duration: 1.4, loop: false, strike: 0.4 }],
      tris: 1,
      notes: {},
    };
    const stats = {
      tris: 4200,
      bones: 17,
      animations: [{ name: 'attack', duration: 1.3999 }],
      textures: [{ width: 1024, height: 1024, mime: 'image/webp' }],
      nodes: ['rig', 'husk'],
      hasInk: true,
      bytes: 123456,
    };
    expect(manifestEntry(meta, stats)).toEqual({
      name: 'husk',
      family: 'xeno',
      kind: 'model',
      file: 'xeno/husk.glb',
      nodes: ['rig', 'husk'],
      animations: [{ name: 'attack', duration: 1.4, loop: false, strike: 0.4, exportedDuration: 1.3999 }],
      tris: 4200,
      bones: 17,
      textures: [{ width: 1024, height: 1024, mime: 'image/webp' }],
      hasInk: true,
      bytes: 123456,
    });
  });

  it('keeps texture entries without GLB stats', () => {
    const entry = manifestEntry({ name: 'ink_noise', family: 'textures', kind: 'texture', file: 'textures/ink_noise.png', nodes: [], animations: [] }, null);
    expect(entry).toMatchObject({ name: 'ink_noise', kind: 'texture', tris: 0, bytes: 0 });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/assets`
Expected: FAIL, the tool modules cannot be resolved.

- [ ] **Step 4: Write `tools/assets/optimize.mjs`**

```js
// Raw Blender GLB in, web GLB out: deduplicated, pruned (keeping empties such as muzzle points and the
// custom _INK attribute), animations resampled, textures as WebP, geometry meshopt-compressed.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

let ioPromise;

export function assetIO() {
  ioPromise ??= (async () => {
    await MeshoptDecoder.ready;
    await MeshoptEncoder.ready;
    return new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  })();
  return ioPromise;
}

export async function optimizeGlb(input, output) {
  const io = await assetIO();
  const doc = await io.read(input);
  await doc.transform(
    dedup(),
    prune({ keepAttributes: true, keepLeaves: true, keepExtras: true }),
    resample(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 92 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  mkdirSync(dirname(output), { recursive: true });
  await io.write(output, doc);
}
```

- [ ] **Step 5: Write `tools/assets/inspect.mjs`**

```js
// Counts what the budget check needs from a GLB.
import { statSync } from 'node:fs';
import { assetIO } from './optimize.mjs';

const TRIANGLES = 4;

export async function inspectGlb(path) {
  const io = await assetIO();
  const root = (await io.read(path)).getRoot();
  let tris = 0;
  let hasInk = false;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getAttribute('_INK')) hasInk = true;
      if (prim.getMode() !== TRIANGLES) continue;
      const indices = prim.getIndices();
      tris += (indices ? indices.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  }
  const bones = root.listSkins().reduce((most, skin) => Math.max(most, skin.listJoints().length), 0);
  const animations = root.listAnimations().map((animation) => ({
    name: animation.getName(),
    duration: Math.max(0, ...animation.listSamplers().map((sampler) => sampler.getInput()?.getMax([])[0] ?? 0)),
  }));
  const textures = root.listTextures().map((texture) => {
    const size = texture.getSize();
    return { width: size?.[0] ?? 0, height: size?.[1] ?? 0, mime: texture.getMimeType() };
  });
  const nodes = root.listNodes().map((node) => node.getName());
  return { tris: Math.round(tris), bones, animations, textures, nodes, hasInk, bytes: statSync(path).size };
}
```

- [ ] **Step 6: Write `tools/assets/manifest.mjs`**

```js
// public/assets/manifest.json: one entry per sidecar, merged with the stats of its exported file.
// No timestamp, so rebuilding unchanged assets leaves the manifest byte-identical.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectGlb } from './inspect.mjs';

export function manifestEntry(meta, stats) {
  return {
    name: meta.name,
    family: meta.family,
    kind: meta.kind,
    file: meta.file,
    nodes: stats?.nodes?.length ? stats.nodes : meta.nodes,
    animations: (meta.animations ?? []).map((animation) => ({
      ...animation,
      exportedDuration: stats?.animations.find((s) => s.name === animation.name)?.duration ?? null,
    })),
    tris: stats?.tris ?? 0,
    bones: stats?.bones ?? 0,
    textures: stats?.textures ?? [],
    hasInk: stats?.hasInk ?? false,
    bytes: stats?.bytes ?? 0,
  };
}

function metaFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return metaFiles(path);
    return name.endsWith('.meta.json') ? [path] : [];
  });
}

export async function writeManifest(publicDir) {
  const entries = [];
  for (const path of metaFiles(publicDir)) {
    const meta = JSON.parse(readFileSync(path, 'utf8'));
    const stats = meta.kind === 'model' ? await inspectGlb(join(publicDir, meta.file)) : null;
    entries.push(manifestEntry(meta, stats));
  }
  entries.sort((a, b) => a.family.localeCompare(b.family) || a.name.localeCompare(b.name));
  const manifest = { version: 1, assets: entries };
  writeFileSync(join(publicDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
```

- [ ] **Step 7: Write `tools/assets/check.mjs`**

```js
#!/usr/bin/env node
// npm run assets:check: every exported asset against its family budget and the shared strike timings.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRAME = 1 / 30;

export function evaluateAsset(entry, budgets, timings) {
  if (entry.kind !== 'model') return [];
  const budget = budgets[entry.family];
  if (!budget) return [`no budget for family '${entry.family}'`];
  const failures = [];
  if (entry.tris > budget.tris) failures.push(`tris ${entry.tris} > ${budget.tris}`);
  if (entry.bones > budget.bones) failures.push(`bones ${entry.bones} > ${budget.bones}`);
  for (const texture of entry.textures) {
    if (texture.width > budget.texture || texture.height > budget.texture) {
      failures.push(`texture ${texture.width}x${texture.height} > ${budget.texture}`);
    }
  }
  if (budget.ink && !entry.hasInk) failures.push('missing _INK attribute');
  for (const name of budget.animations ?? []) {
    const animation = entry.animations.find((a) => a.name === name);
    if (!animation) {
      failures.push(`missing animation '${name}'`);
      continue;
    }
    if (animation.exportedDuration === null) failures.push(`animation '${name}' is not in the GLB`);
    const timing = timings[entry.family]?.[entry.name]?.[name];
    if (!timing) continue;
    if (Math.abs(animation.duration - timing.duration) > FRAME) {
      failures.push(`${name} duration ${animation.duration} != timings ${timing.duration}`);
    }
    if (animation.exportedDuration !== null && Math.abs(animation.exportedDuration - timing.duration) > FRAME) {
      failures.push(`${name} exported duration ${animation.exportedDuration.toFixed(3)} != timings ${timing.duration}`);
    }
    if (Math.abs((animation.strike ?? -1) - timing.strike) > FRAME) {
      failures.push(`${name} strike ${animation.strike} != timings ${timing.strike}`);
    }
  }
  return failures;
}

function main() {
  const root = resolve(import.meta.dirname, '..', '..');
  const manifestPath = join(root, 'public', 'assets', 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.log('assets:check skipped (no manifest yet; run npm run assets)');
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const budgets = JSON.parse(readFileSync(join(root, 'tools', 'assets', 'budgets.json'), 'utf8'));
  const timings = JSON.parse(readFileSync(join(root, 'src', 'shared', 'timings.json'), 'utf8'));
  let pass = 0;
  let fail = 0;
  for (const entry of manifest.assets) {
    const failures = evaluateAsset(entry, budgets, timings);
    if (!existsSync(join(root, 'public', 'assets', entry.file))) failures.push(`file missing: ${entry.file}`);
    if (failures.length) {
      fail += 1;
      console.log(`ASSET ${entry.name} FAIL: ${failures.join('; ')}`);
    } else {
      pass += 1;
      console.log(`ASSET ${entry.name} ok (${entry.tris} tris, ${Math.round(entry.bytes / 1024)} KB)`);
    }
  }
  console.log(`assets:check pass=${pass} fail=${fail}`);
  if (fail) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 8: Write `tools/assets/sheet.mjs`**

```js
// One contact sheet per asset: its preview renders in a grid under a caption, for review and evidence.
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const CAPTION = 40;
const COLUMNS = 4;

function captionSvg(width, text) {
  const safe = text.replace(/[<>&]/g, '');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${CAPTION}"><rect width="100%" height="100%" fill="#14161d"/>` +
      `<text x="12" y="27" font-family="Segoe UI, Arial, sans-serif" font-size="20" fill="#efe6d2">${safe}</text></svg>`,
  );
}

export async function composeSheets(previewRoot, outDir) {
  if (!existsSync(previewRoot)) return [];
  mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const asset of readdirSync(previewRoot).sort()) {
    const dir = join(previewRoot, asset);
    const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
    if (files.length === 0) continue;
    const metas = await Promise.all(files.map((f) => sharp(join(dir, f)).metadata()));
    const tile = Math.max(...metas.map((m) => Math.max(m.width ?? 0, m.height ?? 0)));
    const rows = Math.ceil(files.length / COLUMNS);
    const width = tile * Math.min(COLUMNS, files.length);
    const height = CAPTION + tile * rows;
    const composites = [{ input: captionSvg(width, `${asset}  (${files.length} renders)`), left: 0, top: 0 }];
    files.forEach((file, i) => {
      composites.push({ input: join(dir, file), left: (i % COLUMNS) * tile, top: CAPTION + Math.floor(i / COLUMNS) * tile });
    });
    const out = join(outDir, `${asset}.png`);
    await sharp({ create: { width, height, channels: 3, background: '#2a2e38' } }).composite(composites).png().toFile(out);
    written.push(out);
  }
  return written;
}
```

- [ ] **Step 9: Write `tools/assets/build.mjs`**

```js
#!/usr/bin/env node
// npm run assets [-- --only bulwark,husk] [--jobs 3] [--no-previews]
// Runs Blender recipes headless (brushes first: paint bakes read its stroke texture), optimizes each raw
// GLB into public/assets with its sidecar, rewrites the manifest and composes preview contact sheets.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runBlender } from './blender.mjs';
import { writeManifest } from './manifest.mjs';
import { optimizeGlb } from './optimize.mjs';
import { composeSheets } from './sheet.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const RAW = join(ROOT, 'build', 'assets', 'raw');
const PREVIEWS = join(ROOT, 'build', 'assets', 'previews');
const PUBLIC = join(ROOT, 'public', 'assets');
const TEXTURES = join(PUBLIC, 'textures');
const SHEETS = join(ROOT, 'docs', 'evidence', 'assets');

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

const all = readdirSync(join(ROOT, 'blender', 'recipes'))
  .filter((file) => file.endsWith('.py') && !file.startsWith('_'))
  .map((file) => file.slice(0, -3))
  .sort();
const selected = option('only')?.split(',').filter(Boolean) ?? all;
for (const name of selected) if (!all.includes(name)) throw new Error(`unknown recipe '${name}' (have ${all.join(', ')})`);
const jobs = Number(option('jobs') ?? 3);
const previews = !process.argv.includes('--no-previews');

async function recipe(name) {
  const started = Date.now();
  const args = ['--python', join(ROOT, 'blender', 'run.py'), '--', '--recipe', name, '--out', RAW, '--previews', PREVIEWS, '--textures', TEXTURES];
  if (!previews) args.push('--no-previews');
  const result = await runBlender(args, { label: name });
  const ok = result.code === 0 && result.log.includes(`RECIPE_OK ${name}`);
  console.log(`recipe ${name}: ${ok ? 'ok' : 'FAILED'} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (!ok) console.log(result.log.split(/\r?\n/).slice(-40).join('\n'));
  return { name, ok };
}

async function pool(names, size) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < names.length) results.push(await recipe(names[next++]));
  }
  await Promise.all(Array.from({ length: Math.min(size, names.length) }, worker));
  return results;
}

function sidecars(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sidecars(path);
    return name.endsWith('.meta.json') ? [path] : [];
  });
}

const results = [];
if (selected.includes('brushes') || !existsSync(join(TEXTURES, 'brush_strokes.png'))) results.push(await recipe('brushes'));
results.push(...(await pool(selected.filter((name) => name !== 'brushes'), jobs)));
const built = new Set(results.filter((r) => r.ok).map((r) => r.name));

for (const path of sidecars(RAW)) {
  const meta = JSON.parse(readFileSync(path, 'utf8'));
  if (!built.has(meta.recipe)) continue;
  mkdirSync(join(PUBLIC, meta.family), { recursive: true });
  if (meta.kind === 'model') await optimizeGlb(join(RAW, meta.file), join(PUBLIC, meta.file));
  copyFileSync(path, join(PUBLIC, meta.family, `${meta.name}.meta.json`));
}

const manifest = await writeManifest(PUBLIC);
if (previews) await composeSheets(PREVIEWS, SHEETS);
const failed = results.filter((r) => !r.ok).map((r) => r.name);
console.log(`assets: built=${built.size} failed=${failed.length}${failed.length ? ` (${failed.join(', ')})` : ''} manifest=${manifest.assets.length}`);
if (failed.length) process.exit(1);
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/assets`
Expected: PASS, 7 tests.

- [ ] **Step 11: Commit**

```bash
git add tools/assets/optimize.mjs tools/assets/inspect.mjs tools/assets/manifest.mjs tools/assets/check.mjs tools/assets/sheet.mjs tools/assets/build.mjs tests/unit/assets
git commit -F - <<'EOF'
Add the Node asset pipeline: optimize, inspect, manifest, check, sheets

build.mjs runs recipes in a small pool (brushes first), optimizes raw GLB
files with glTF-Transform (prune keeps empties such as muzzle points and the
_INK attribute; textures become WebP; geometry is meshopt-compressed), copies
each sidecar next to its export and rewrites a timestamp-free manifest.
check.mjs enforces per-family budgets and compares every attack clip's
duration and strike with src/shared/timings.json within one frame.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Brush atlas recipe

**Files:**
- Create: `blender/recipes/brushes.py`

- [ ] **Step 1: Write `blender/recipes/brushes.py`**

```python
"""Brush atlas: the stroke field used by paint bakes and by runtime terrain painting, and a tileable ink
noise that varies line width. Both are generated with numpy and tile seamlessly."""
import math

import numpy as np

from lib.ctx import AssetRecord
from lib.png import write_png


def stroke_field(size=512, strokes=260, seed=7):
    """Overlapping elongated soft strokes along a dominant direction, wrapped so the tile repeats."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    field = np.zeros((size, size), np.float32)
    for _ in range(strokes):
        cx, cy = rng.uniform(0, size, 2)
        angle = rng.normal(0.5, 0.35)
        length = rng.uniform(30, 110) * size / 512
        width = rng.uniform(5, 13) * size / 512
        value = rng.uniform(-1, 1)
        dx = (xx - cx + size / 2) % size - size / 2
        dy = (yy - cy + size / 2) % size - size / 2
        u = dx * math.cos(angle) + dy * math.sin(angle)
        w = -dx * math.sin(angle) + dy * math.cos(angle)
        field += value * np.exp(-(u / length) ** 4 - (w / width) ** 2)
    field -= field.min()
    return field / max(float(field.max()), 1e-6)


def value_noise(size=256, seed=11, octaves=(8, 16, 32)):
    """Smooth tileable value noise in 0..1."""
    rng = np.random.default_rng(seed)
    total = np.zeros((size, size), np.float32)
    weight = 0.0
    for index, cells in enumerate(octaves):
        grid = rng.random((cells, cells)).astype(np.float32)
        t = np.arange(size, dtype=np.float32) * cells / size
        i0 = np.floor(t).astype(int) % cells
        i1 = (i0 + 1) % cells
        f = t - np.floor(t)
        s = f * f * (3 - 2 * f)
        rows0 = grid[i0][:, i0] * (1 - s)[None, :] + grid[i0][:, i1] * s[None, :]
        rows1 = grid[i1][:, i0] * (1 - s)[None, :] + grid[i1][:, i1] * s[None, :]
        layer = rows0 * (1 - s)[:, None] + rows1 * s[:, None]
        amplitude = 0.5 ** index
        total += layer * amplitude
        weight += amplitude
    total /= weight
    total -= total.min()
    return total / max(float(total.max()), 1e-6)


def build(ctx):
    ctx.textures.mkdir(parents=True, exist_ok=True)
    write_png(ctx.textures / 'brush_strokes.png', stroke_field())
    write_png(ctx.textures / 'ink_noise.png', value_noise())
    return [
        AssetRecord(name='brush_strokes', family='textures', file='textures/brush_strokes.png', kind='texture'),
        AssetRecord(name='ink_noise', family='textures', file='textures/ink_noise.png', kind='texture'),
    ]
```

- [ ] **Step 2: Run the recipe**

Run: `npm run assets -- --only brushes --no-previews`
Expected: `recipe brushes: ok`, then `assets: built=1 failed=0 manifest=2`. `public/assets/textures/brush_strokes.png` (512 by 512) and `ink_noise.png` (256 by 256) exist.

- [ ] **Step 3: Look at both textures**

Open both PNG files. Expected: `brush_strokes.png` shows soft diagonal painterly strokes in grey with no visible seam when tiled; `ink_noise.png` shows smooth blotchy grey noise. Tile check:

Run: `node -e "const s=require('sharp');s('public/assets/textures/brush_strokes.png').extend({top:0,bottom:512,left:0,right:512,extendWith:'repeat'}).toFile('build/tile-check.png').then(()=>console.log('ok'))"`
Expected: `ok`; `build/tile-check.png` (1024 by 1024) shows no seams at the tile edges.

- [ ] **Step 4: Commit**

```bash
git add blender/recipes/brushes.py public/assets/textures public/assets/manifest.json
git commit -F - <<'EOF'
Add the brush atlas recipe: stroke field and ink noise

brush_strokes.png (512) is 260 wrapped soft strokes along a dominant
direction, used by every paint bake and later by terrain painting;
ink_noise.png (256) is three-octave tileable value noise for varying line
width. A 2 by 2 repeat shows no seams.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Verdant kit recipe

**Files:**
- Create: `blender/recipes/verdant.py`

- [ ] **Step 1: Write `blender/recipes/verdant.py`**

```python
"""Verdant Highlands kit: three rocks, a broad-crowned tree, a conifer, a bush, a grass tuft and a flower
clump. Volumes are simplified (broad faceted planes, big foliage clumps) so the painted bake carries the
detail, the way Sifu's environments do. Each piece exports at its own origin for instancing."""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

from lib import export, geo, ink, paint, palette, scene
from lib.ctx import AssetRecord

P = palette.VERDANT


def _regions():
    return {
        'stone': palette.region('verdant_stone', P['stone']),
        'moss': palette.region('verdant_moss', P['moss']),
        'bark': palette.region('verdant_bark', P['bark']),
        'leaf': palette.region('verdant_foliage', P['foliage']),
        'leaf_light': palette.region('verdant_foliage_light', P['foliage_light']),
        'grass': palette.region('verdant_grass', P['meadow']),
        'flower': palette.region('verdant_flower', P['flower']),
        'flower_warm': palette.region('verdant_flower_warm', P['flower_warm']),
    }


def _finish(parts, name, width):
    for part in parts:
        scene.apply_transforms(part)
        ink.ensure_ink(part, width)
    ob = scene.join(parts, name) if len(parts) > 1 else parts[0]
    ob.name = name
    return ob


def rock(name, seed, scale, r):
    ob = geo.ico(name, 1.0, subdivisions=3, scale=scale)
    scene.apply_transforms(ob)
    geo.displace(ob, 0.28, frequency=1.3, seed=seed)
    geo.facet(ob, 14.0)
    floor = -0.35 * scale[2]
    for vertex in ob.data.vertices:
        vertex.co.z = max(vertex.co.z, floor) - floor - 0.05  # flat base, sunk 5 cm
    geo.assign_by_normal(ob, up=r['moss'], side=r['stone'], threshold=0.6)
    geo.shade_flat(ob)
    ink.set_ink(ob, 1.1)
    return ob


def tree_broad(name, r):
    parts = [geo.cylinder(name + '_trunk', 0.2, 2.4, segments=8, radius_top=0.1, location=(0, 0, 1.2), material=r['bark'])]
    for i, (yaw, height) in enumerate(((0.3, 1.8), (2.4, 2.0), (4.3, 1.9))):
        direction = Vector((math.cos(yaw), math.sin(yaw), 0.9)).normalized()
        start = Vector((0, 0, height))
        parts.append(geo.segment(f'{name}_branch{i}', start, start + direction * 0.9, 0.07, 0.03, segments=6, material=r['bark']))
    clumps = [(0, 0, 3.0, 1.1), (0.8, 0.2, 2.6, 0.8), (-0.7, -0.3, 2.7, 0.85), (0.2, -0.8, 2.5, 0.75),
              (-0.2, 0.8, 2.9, 0.8), (0.5, 0.5, 3.4, 0.7), (-0.5, 0.2, 3.5, 0.65)]
    for i, (x, y, z, radius) in enumerate(clumps):
        clump = geo.ico(f'{name}_clump{i}', radius, subdivisions=2, location=(x, y, z))
        scene.apply_transforms(clump)
        geo.displace(clump, 0.18, frequency=1.6, seed=10 + i)
        geo.facet(clump, 10.0)
        geo.assign_by_normal(clump, up=r['leaf_light'], side=r['leaf'], threshold=0.35)
        ink.set_ink(clump, 1.25)
        parts.append(clump)
    for part in parts[:4]:
        ink.set_ink(part, 1.0)
    return _finish(parts, name, 1.0)


def tree_conifer(name, r):
    parts = [geo.cylinder(name + '_trunk', 0.14, 1.2, segments=7, radius_top=0.1, location=(0, 0, 0.6), material=r['bark'])]
    ink.set_ink(parts[0], 1.0)
    for i, (z, radius, depth) in enumerate(((1.1, 1.0, 1.4), (1.9, 0.8, 1.2), (2.6, 0.6, 1.0), (3.2, 0.4, 0.9))):
        cone = geo.cylinder(f'{name}_tier{i}', radius, depth, segments=9, radius_top=0.02, location=(0, 0, z), material=r['leaf'])
        scene.apply_transforms(cone)
        geo.displace(cone, 0.08, frequency=3.0, seed=20 + i)
        geo.assign_by_normal(cone, up=r['leaf_light'], side=r['leaf'], threshold=0.45)
        ink.set_ink(cone, 1.2)
        parts.append(cone)
    return _finish(parts, name, 1.0)


def bush(name, r):
    parts = []
    for i, (x, y, z, radius) in enumerate(((0, 0, 0.45, 0.55), (0.45, 0.1, 0.35, 0.4), (-0.4, 0.15, 0.35, 0.42), (0.05, -0.4, 0.3, 0.38))):
        clump = geo.ico(f'{name}_clump{i}', radius, subdivisions=2, location=(x, y, z))
        scene.apply_transforms(clump)
        geo.displace(clump, 0.1, frequency=2.0, seed=30 + i)
        geo.facet(clump, 10.0)
        geo.assign_by_normal(clump, up=r['leaf_light'], side=r['leaf'], threshold=0.35)
        ink.set_ink(clump, 1.1)
        parts.append(clump)
    return _finish(parts, name, 1.1)


def grass_tuft(name, r, seed=5):
    """Nine curved blades. Thin cards carry no ink (width 0): hull lines on blades read as noise."""
    rnd = random.Random(seed)
    bm = bmesh.new()
    for _ in range(9):
        base = Vector((rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12), 0))
        height = rnd.uniform(0.4, 0.7)
        width = rnd.uniform(0.04, 0.07)
        lean = rnd.uniform(0.08, 0.2)
        spin = Matrix.Rotation(rnd.uniform(0, math.tau), 3, 'Z')
        rows = []
        for step in range(3):
            t = step / 3
            half = width * 0.5 * (1 - t)
            rows.append([bm.verts.new(base + spin @ Vector((side * half, lean * t * t, height * t))) for side in (-1, 1)])
        tip = bm.verts.new(base + spin @ Vector((0, lean, height)))
        for a, b in zip(rows[:-1], rows[1:]):
            bm.faces.new((a[0], a[1], b[1], b[0]))
        bm.faces.new((rows[-1][0], rows[-1][1], tip))
    data = bpy.data.meshes.new(name)
    bm.to_mesh(data)
    bm.free()
    mesh = scene.link(bpy.data.objects.new(name, data))
    data.materials.append(r['grass'])
    ink.set_ink(mesh, 0.0)
    mesh['double_sided'] = True  # exported as extras; the runtime renders both faces
    return mesh


def flowers(name, r, seed=9):
    rnd = random.Random(seed)
    parts = []
    for i in range(5):
        x, y = rnd.uniform(-0.25, 0.25), rnd.uniform(-0.25, 0.25)
        height = rnd.uniform(0.25, 0.45)
        parts.append(geo.cylinder(f'{name}_stem{i}', 0.012, height, segments=5, location=(x, y, height / 2), material=r['grass']))
        head = geo.ico(f'{name}_head{i}', 0.07, subdivisions=1, scale=(1, 1, 0.45), location=(x, y, height + 0.02),
                       material=r['flower'] if i % 2 else r['flower_warm'])
        parts.append(head)
    for part in parts:
        ink.set_ink(part, 0.6)
    return _finish(parts, name, 0.6)


def build(ctx):
    r = _regions()
    pieces = [
        rock('rock_a', 1, (1.0, 0.8, 0.7), r),
        rock('rock_b', 2, (1.3, 1.0, 0.6), r),
        rock('rock_c', 3, (0.7, 0.7, 0.9), r),
        tree_broad('tree_broad', r),
        tree_conifer('tree_conifer', r),
        bush('bush', r),
        grass_tuft('grass_tuft', r),
        flowers('flowers', r),
    ]
    for i, piece in enumerate(pieces):
        piece.location = (i * 5.0, 0, 0)  # apart, so ambient occlusion sees each piece alone
    paint.paint(pieces, name='verdant_kit', out_dir=ctx.bake_dir('env'), textures_dir=ctx.textures, size=1024,
                style=palette.NATURE_STYLE, ao_distance=0.6, brush_scale=0.7)
    if ctx.previews_enabled:
        export.render_views(pieces, ctx.preview_dir('verdant_kit'), 'verdant_kit', views=2, size=768)
    for piece in pieces:
        piece.location = (0, 0, 0)
    export.export_glb(pieces, ctx.raw_path('env', 'verdant_kit'))
    return [AssetRecord(name='verdant_kit', family='env', file='env/verdant_kit.glb', nodes=[p.name for p in pieces], tris=scene.tri_count(pieces))]
```

- [ ] **Step 2: Build it**

Run: `npm run assets -- --only verdant`
Expected: `recipe verdant: ok`, `assets: built=1 failed=0`. `public/assets/env/verdant_kit.glb` exists, and `docs/evidence/assets/verdant_kit.png` is written.

- [ ] **Step 3: Review the contact sheet against these expectations**

Open `docs/evidence/assets/verdant_kit.png`. It must show:
- rocks with broad angular planes, moss only on upward faces, sitting flat;
- a tree whose crown reads as six or seven big clumps with lighter tops, not a sphere;
- visible painterly stroke variation on every surface, warmer tops and cooler bottoms;
- dark outlines from the Workbench preview around every piece.

If strokes are invisible, raise `brush_strength` in `NATURE_STYLE` (palette.py) by 0.15 and rebuild. If
occlusion looks grey, move `shadow_tint` toward teal. Keep each change to one dial, rebuild, re-check.

- [ ] **Step 4: Check budgets**

Run: `npm run assets:check`
Expected: `ASSET verdant_kit ok (... tris, ... KB)` and `assets:check pass=3 fail=0`.

- [ ] **Step 5: Commit**

```bash
git add blender/recipes/verdant.py blender/lib/palette.py public/assets docs/evidence/assets/verdant_kit.png
git commit -F - <<'EOF'
Add the Verdant Highlands kit recipe

Three faceted rocks with moss on upward faces, a clumped broad-crowned tree,
a tiered conifer, a bush, a nine-blade grass tuft without ink and a flower
clump, painted into one 1024 atlas with the nature style. Pieces bake apart
so occlusion only sees each piece, then export at their own origins for
instancing. Contact sheet: docs/evidence/assets/verdant_kit.png.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: Worldheart and nest recipes

**Files:**
- Create: `blender/recipes/heart.py`, `blender/recipes/nest.py`

- [ ] **Step 1: Write `blender/recipes/heart.py`**

```python
"""The Worldheart: a warm crystal cluster on a carved stone plinth, in eleven growth stages (one per heart
level, 0 to 10). The runtime shows the plinth and the stage for the current level. Warm light is the
heart's alone (blueprint, material language)."""
import math

from lib import export, geo, ink, paint, palette, scene
from lib.ctx import AssetRecord

H = palette.HEART
PLINTH_TOP = 0.4


def crystal(name, height, radius, material, location, tilt=(0.0, 0.0)):
    """A six-sided prism with a pointed top and a short pointed foot."""
    parts = [
        geo.cylinder(name + '_body', radius, height, segments=6, location=(0, 0, height / 2), material=material),
        geo.cylinder(name + '_top', radius, radius * 1.8, segments=6, radius_top=0.0, location=(0, 0, height + radius * 0.9), material=material),
        geo.cylinder(name + '_foot', radius * 0.001, radius * 0.8, segments=6, radius_top=radius, location=(0, 0, -radius * 0.4), material=material),
    ]
    for part in parts:
        scene.apply_transforms(part)
    ob = scene.join(parts, name)
    ob.rotation_euler = (tilt[0], tilt[1], 0.0)
    ob.location = location
    scene.apply_transforms(ob)
    geo.shade_flat(ob)
    ink.set_ink(ob, 0.9)
    return ob


def stage(level, regions):
    parts = [crystal(f'heart_{level}_core', 1.0 + 0.14 * level, 0.28 + 0.012 * level, regions['core'], (0, 0, PLINTH_TOP))]
    satellites = min(2 + level // 2, 7)
    for i in range(satellites):
        angle = i * math.tau / satellites + level * 0.3
        distance = 0.45 + 0.02 * level
        height = (0.45 + 0.05 * level) * (0.7 if i % 2 else 1.0)
        tilt = (0.3 * math.sin(angle), -0.3 * math.cos(angle))
        parts.append(crystal(f'heart_{level}_sat{i}', height, 0.14 + 0.006 * level, regions['facet'],
                             (distance * math.cos(angle), distance * math.sin(angle), PLINTH_TOP), tilt))
    if level >= 7:
        for i in range(3):
            angle = i * math.tau / 3
            parts.append(crystal(f'heart_{level}_shard{i}', 0.3, 0.08, regions['core'],
                                 (0.35 * math.cos(angle), 0.35 * math.sin(angle), PLINTH_TOP + 2.0 + 0.1 * level)))
    ob = scene.join(parts, f'heart_stage_{level:02d}')
    return ob


def build(ctx):
    regions = {
        'core': palette.region('heart_core', H['facet'], emit_hex=H['core']),
        'facet': palette.region('heart_facet', H['facet'], emit_hex=H['deep']),
        'stone': palette.region('heart_stone', H['stone']),
        'inlay': palette.region('heart_inlay', H['inlay']),
    }
    plinth_parts = [
        geo.cylinder('plinth_base', 1.2, PLINTH_TOP, segments=8, radius_top=1.05, location=(0, 0, PLINTH_TOP / 2), bevel=0.04, material=regions['stone']),
        geo.cylinder('plinth_inlay', 1.12, 0.05, segments=8, location=(0, 0, PLINTH_TOP * 0.55), material=regions['inlay']),
    ]
    for part in plinth_parts:
        scene.apply_transforms(part)
        ink.set_ink(part, 1.2)
    plinth = scene.join(plinth_parts, 'heart_plinth')
    stages = [stage(level, regions) for level in range(11)]
    pieces = [plinth] + stages
    for i, piece in enumerate(pieces):
        piece.location = (i * 3.5, 0, 0)  # apart, so ambient occlusion sees each piece alone
    paint.paint(pieces, name='worldheart', out_dir=ctx.bake_dir('heart'), textures_dir=ctx.textures, size=1024,
                style=palette.HEART_STYLE, ao_distance=0.3, brush_scale=1.2, emissive_strength=3.0)
    for piece in pieces:
        piece.location = (0, 0, 0)
    if ctx.previews_enabled:
        for level in (0, 5, 10):
            for index, other in enumerate(stages):
                other.hide_render = index != level
            export.render_views([plinth, stages[level]], ctx.preview_dir(f'worldheart_stage{level:02d}'), f'stage{level:02d}', views=2)
        for other in stages:
            other.hide_render = False
    export.export_glb(pieces, ctx.raw_path('heart', 'worldheart'))
    return [AssetRecord(name='worldheart', family='heart', file='heart/worldheart.glb', nodes=[p.name for p in pieces], tris=scene.tri_count(pieces))]
```

- [ ] **Step 2: Write `blender/recipes/nest.py`**

```python
"""A Xeno nest: a low chitin mound ringed by inward-leaning spikes, a glowing maw and glowing vents.
Magenta light leaks through seams as pressure, not as a lamp (blueprint, material language)."""
import math

from lib import export, geo, ink, paint, palette, scene
from lib.ctx import AssetRecord

X = palette.XENO


def build(ctx):
    chitin = palette.region('xeno_chitin', X['chitin'])
    chitin_light = palette.region('xeno_chitin_light', X['chitin_light'])
    seam = palette.region('xeno_seam', X['chitin'], emit_hex=X['seam'])
    mound = geo.uv_sphere('nest_mound', 1.6, segments=20, rings=10, scale=(1, 1, 0.62), hemisphere=True, material=chitin)
    scene.apply_transforms(mound)
    geo.displace(mound, 0.16, frequency=1.4, seed=4)
    geo.facet(mound, 10.0)
    ink.set_ink(mound, 1.0)
    parts = [mound]
    maw = geo.cylinder('nest_maw', 0.45, 0.3, segments=12, location=(0, 0, 0.88), material=seam)
    ink.set_ink(maw, 0.5)
    parts.append(maw)
    for i in range(7):
        angle = i * math.tau / 7
        spike = geo.cylinder(f'nest_spike{i}', 0.18, 1.3, segments=6, radius_top=0.0,
                             location=(1.25 * math.cos(angle), 1.25 * math.sin(angle), 0.55),
                             rotation=(0.35 * math.sin(angle), -0.35 * math.cos(angle), 0), material=chitin_light)
        ink.set_ink(spike, 1.2)
        parts.append(spike)
    for i in range(5):
        angle = i * math.tau / 5 + 0.3
        rho = 0.9
        z = 0.62 * 1.6 * math.sqrt(max(0.0, 1 - (rho / 1.6) ** 2))
        vent = geo.cylinder(f'nest_vent{i}', 0.08, 0.25, segments=8, location=(rho * math.cos(angle), rho * math.sin(angle), z - 0.05),
                            rotation=(0.5 * math.sin(angle), -0.5 * math.cos(angle), 0), material=seam)
        ink.set_ink(vent, 0.4)
        parts.append(vent)
    for part in parts:
        scene.apply_transforms(part)
    nest = scene.join(parts, 'nest')
    paint.paint([nest], name='nest', out_dir=ctx.bake_dir('nests'), textures_dir=ctx.textures, size=512,
                style=palette.XENO_STYLE, ao_distance=0.5, brush_scale=0.9, emissive_strength=4.0)
    if ctx.previews_enabled:
        export.render_views([nest], ctx.preview_dir('nest'), 'nest', views=4)
    export.export_glb([nest], ctx.raw_path('nests', 'nest'))
    return [AssetRecord(name='nest', family='nests', file='nests/nest.glb', nodes=['nest'], tris=scene.tri_count([nest]))]
```

- [ ] **Step 3: Build both**

Run: `npm run assets -- --only heart,nest`
Expected: `recipe heart: ok`, `recipe nest: ok`, `assets: built=2 failed=0`.

- [ ] **Step 4: Review the sheets**

Open `docs/evidence/assets/worldheart_stage00.png`, `worldheart_stage05.png`, `worldheart_stage10.png` and `nest.png`. Expected: the heart grows from a core and two satellites to a full cluster with three floating shards at stage 10; crystal facets are warm (peach, gold, amber), the plinth is warm stone with a gold band; the nest is a dark violet mound with pale spikes leaning inward and magenta at the maw and vents only.

- [ ] **Step 5: Check and commit**

Run: `npm run assets:check`
Expected: `assets:check pass=5 fail=0`.

```bash
git add blender/recipes/heart.py blender/recipes/nest.py public/assets docs/evidence/assets
git commit -F - <<'EOF'
Add the Worldheart (eleven growth stages) and the Xeno nest recipes

The heart's core crystal grows from 1.0 m to 2.4 m across levels 0 to 10,
satellites grow from two to seven, and three shards float above it from
level 7. Warm emissive crystal on warm stone keeps warm light the heart's
alone. The nest is a faceted chitin mound with seven inward spikes and
magenta light only at the maw and five vents.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: Bolt Sentinel recipe (marks I to III)

**Files:**
- Create: `blender/recipes/bolt_sentinel.py`

- [ ] **Step 1: Write `blender/recipes/bolt_sentinel.py`**

```python
"""Bolt Sentinel, marks I to III: rapid single-target rails that also hit air. Each mark is a node tree the
runtime drives: bolt_mkN (base) > bolt_mkN_yaw (turns) > bolt_mkN_pitch (elevates) > rails and
bolt_mkN_muzzle<i> empties at the rail tips. Upgrades change the machine, not just its size: mark II adds
armour and a crit coil, mark III a third rail, fins, a sensor dome and buttresses (v3 creative rule)."""
import math

import bpy

from lib import export, geo, ink, paint, palette, scene
from lib.ctx import AssetRecord

T = palette.PLAYER


def _regions():
    return {
        'metal': palette.region('tech_gunmetal', T['gunmetal']),
        'metal_light': palette.region('tech_gunmetal_light', T['gunmetal_light']),
        'trim': palette.region('tech_trim', T['trim']),
        'glow': palette.region('tech_glow', T['gunmetal'], emit_hex=T['energy']),
    }


def _child(part, parent, width):
    scene.parent_keep(part, parent)
    ink.set_ink(part, width)
    return part


def mark(level, r):
    p = f'bolt_mk{level}'
    base_h = 0.35 + 0.12 * (level - 1)
    base = geo.cylinder(p, 0.78 + 0.06 * (level - 1), base_h, segments=8, radius_top=0.7, location=(0, 0, base_h / 2), bevel=0.03, material=r['metal'])
    ink.set_ink(base, 1.2)
    parts = [base]
    for i in range(4):
        angle = 0.785 + i * 1.5708
        foot = geo.box(f'{p}_foot{i}', (0.3, 0.5, 0.18), location=(0.72 * math.cos(angle), 0.72 * math.sin(angle), 0.09), rotation=(0, 0, angle), bevel=0.03, material=r['metal_light'])
        parts.append(_child(foot, base, 1.0))
    parts.append(_child(geo.cylinder(f'{p}_trim', 0.72, 0.05, segments=8, location=(0, 0, base_h), material=r['trim']), base, 0.8))
    if level >= 2:
        parts.append(_child(geo.cylinder(f'{p}_ring', 0.745, 0.04, segments=16, location=(0, 0, base_h * 0.55), material=r['glow']), base, 0.5))
    if level >= 3:
        for i in range(4):
            angle = i * 1.5708
            buttress = geo.box(f'{p}_buttress{i}', (0.16, 0.35, base_h * 0.9), location=(0.82 * math.cos(angle), 0.82 * math.sin(angle), base_h * 0.45), rotation=(0, 0, angle), bevel=0.02, material=r['metal'])
            parts.append(_child(buttress, base, 1.0))
    yaw = geo.cylinder(f'{p}_yaw', 0.5, 0.2, segments=12, location=(0, 0, base_h + 0.1), bevel=0.02, material=r['metal_light'])
    parts.append(_child(yaw, base, 1.0))
    head_z = base_h + 0.45
    pitch = geo.box(f'{p}_pitch', (0.7, 0.9, 0.42), location=(0, 0, head_z), bevel=0.05, material=r['metal'])
    parts.append(_child(pitch, yaw, 1.15))
    rails = [-0.18, 0.18] if level < 3 else [-0.22, 0.0, 0.22]
    length = 1.0 + 0.2 * (level - 1)
    for i, x in enumerate(rails):
        rail = geo.box(f'{p}_rail{i}', (0.1, length, 0.1), location=(x, -length / 2 - 0.3, head_z), material=r['trim'])
        parts.append(_child(rail, pitch, 0.9))
        strip = geo.box(f'{p}_railglow{i}', (0.035, length * 0.9, 0.105), location=(x, -length / 2 - 0.3, head_z + 0.004), material=r['glow'])
        parts.append(_child(strip, pitch, 0.0))
        for k in range(2 + level // 2):
            coil = geo.cylinder(f'{p}_coil{i}_{k}', 0.085, 0.06, segments=8, location=(x, -0.45 - k * 0.22, head_z), rotation=(1.5708, 0, 0), material=r['metal_light'])
            parts.append(_child(coil, pitch, 0.6))
        muzzle = bpy.data.objects.new(f'{p}_muzzle{i}', None)
        scene.link(muzzle)
        muzzle.location = (x, -length - 0.3, head_z)
        scene.parent_keep(muzzle, pitch)
    if level >= 2:
        for side, label in ((1, 'L'), (-1, 'R')):
            plate = geo.box(f'{p}_armor{label}', (0.08, 0.7, 0.36), location=(side * 0.4, 0, head_z), bevel=0.02, material=r['metal_light'])
            parts.append(_child(plate, pitch, 1.0))
        coil = geo.cylinder(f'{p}_critcoil', 0.26 + 0.04 * (level - 2), 0.08, segments=16, location=(0, -0.62, head_z), rotation=(1.5708, 0, 0), material=r['glow'])
        parts.append(_child(coil, pitch, 0.5))
    if level >= 3:
        dome = geo.uv_sphere(f'{p}_sensor', 0.16, segments=12, rings=6, hemisphere=True, location=(0, 0.1, head_z + 0.21), material=r['glow'])
        parts.append(_child(dome, pitch, 0.6))
        for side, label in ((1, 'L'), (-1, 'R')):
            fin = geo.box(f'{p}_fin{label}', (0.05, 0.35, 0.3), location=(side * 0.3, 0.5, head_z + 0.1), rotation=(0.4, 0, 0), bevel=0.01, material=r['metal'])
            parts.append(_child(fin, pitch, 0.9))
    return base, parts


def build(ctx):
    r = _regions()
    roots = []
    meshes = []
    for level in (1, 2, 3):
        base, parts = mark(level, r)
        base.location.x = (level - 1) * 4.0  # apart for the bake; children follow their parents
        roots.append(base)
        meshes.extend(parts)
    bpy.context.view_layer.update()
    paint.paint(meshes, name='bolt_sentinel', out_dir=ctx.bake_dir('towers'), textures_dir=ctx.textures, size=1024,
                style=palette.PLAYER_STYLE, ao_distance=0.35, brush_scale=1.1, emissive_strength=4.0)
    if ctx.previews_enabled:
        export.render_views(meshes, ctx.preview_dir('bolt_sentinel'), 'bolt_sentinel', views=4, size=640)
    for root in roots:
        root.location.x = 0.0
    everything = [ob for root in roots for ob in scene.descendants(root)]
    export.export_glb(everything, ctx.raw_path('towers', 'bolt_sentinel'))
    return [AssetRecord(name='bolt_sentinel', family='towers', file='towers/bolt_sentinel.glb',
                        nodes=[ob.name for ob in everything], tris=scene.tri_count(meshes))]
```

- [ ] **Step 2: Build it**

Run: `npm run assets -- --only bolt_sentinel`
Expected: `recipe bolt_sentinel: ok`.

- [ ] **Step 3: Review the sheet**

Open `docs/evidence/assets/bolt_sentinel.png`. Expected: three turrets side by side, each larger and more elaborate; gunmetal bodies with pale trim; cyan light only in the rail strips, the mark II and III rings, the crit coil and the mark III dome; rails point toward the camera's left-front in the first view; the three marks are distinguishable by silhouette alone.

- [ ] **Step 4: Verify the node tree survived optimization**

Run: `node -e "import('./tools/assets/inspect.mjs').then(m=>m.inspectGlb('public/assets/towers/bolt_sentinel.glb')).then(s=>console.log(s.nodes.filter(n=>/_(yaw|pitch|muzzle\d)$/.test(n)).join(' ')))"`
Expected: `bolt_mk1_yaw bolt_mk1_pitch bolt_mk1_muzzle0 bolt_mk1_muzzle1 bolt_mk2_yaw ... bolt_mk3_muzzle2` (the muzzle empties are present, which requires `keepLeaves: true` in the optimizer).

- [ ] **Step 5: Check and commit**

Run: `npm run assets:check`
Expected: `assets:check pass=6 fail=0`.

```bash
git add blender/recipes/bolt_sentinel.py public/assets docs/evidence/assets/bolt_sentinel.png
git commit -F - <<'EOF'
Add the Bolt Sentinel recipe, marks I to III

Each mark is a node tree the runtime drives (base, yaw, pitch) with muzzle
empties at the rail tips, all of which survive optimization. Mark II adds
side armour, a glowing base ring and a crit coil; mark III adds a third rail,
fins, a sensor dome and buttresses, so each mark reads by silhouette. Cyan
appears only in energy channels.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 12: Husk recipe (idle, walk, attack)

**Files:**
- Create: `blender/recipes/husk.py`

- [ ] **Step 1: Write `blender/recipes/husk.py`**

```python
"""The Husk: a hunched, heavy Xeno soak unit (v3: 85 health, 1.85 m/s, a 0.40 s wind-up on a 1.40 s
blow). Wet dark chitin, pale bone claws, magenta light at the eyes and between the carapace plates.
Animations: idle (2.0 s loop), walk (1.0 s loop, diagonal leg pairs), attack (1.40 s, strike at 0.40 s
keyed from src/shared/timings.json). Axis conventions: see lib/anim.py (creature)."""
from lib import anim, export, geo, ink, paint, palette, rig, scene
from lib.anim import leg_swing
from lib.ctx import AnimRecord, AssetRecord

X = palette.XENO


def parts(arm, r):
    out = []

    def add(ob, bone, width):
        ink.set_ink(ob, width)
        out.append((ob, bone))

    def limb(name, bone, r_head, r_tail, material, segments=8):
        return geo.segment(name, rig.bone_head(arm, bone), rig.bone_tail(arm, bone), r_head, r_tail, segments=segments, material=material)

    body = geo.uv_sphere('husk_body', 0.45, 16, 10, scale=(1.0, 1.35, 0.85), location=(0, -0.05, 0.78), material=r['chitin'])
    scene.apply_transforms(body)
    geo.displace(body, 0.05, frequency=2.0, seed=2)
    add(body, 'body', 1.2)
    add(geo.uv_sphere('husk_thorax', 0.32, 14, 8, scale=(1.0, 1.1, 0.9), location=(0, -0.55, 0.86), material=r['chitin']), 'thorax', 1.1)
    head = geo.box('husk_head', (0.34, 0.36, 0.26), location=(0, -0.88, 0.8), bevel=0.06, material=r['chitin_light'])
    add(head, 'head', 1.0)
    for side in (-1, 1):
        add(geo.ico(f'husk_eye{side:+d}', 0.05, subdivisions=1, location=(side * 0.1, -1.05, 0.86), material=r['seam']), 'head', 0.3)
        add(geo.cylinder(f'husk_mandible{side:+d}', 0.04, 0.22, segments=5, radius_top=0.0, location=(side * 0.1, -1.08, 0.72),
                         rotation=(1.9, 0, side * 0.3), material=r['bone']), 'head', 0.6)
    for i, (y, z, radius) in enumerate(((0.30, 1.02, 0.5), (0.02, 1.10, 0.46), (-0.26, 1.10, 0.40), (-0.48, 1.04, 0.33))):
        plate = geo.uv_sphere(f'husk_plate{i}', radius, 14, 7, scale=(1.1, 0.7, 0.5), hemisphere=True, location=(0, y, z - 0.12),
                              rotation=(-0.25 + 0.12 * i, 0, 0), material=r['chitin_light'])
        add(plate, 'carapace', 1.2)
        if i < 3:
            add(geo.box(f'husk_seam{i}', (0.72, 0.04, 0.05), location=(0, y - 0.15, z + 0.02), material=r['seam']), 'carapace', 0.0)
    for side in ('L', 'R'):
        add(limb(f'husk_claw_upper.{side}', f'claw_upper.{side}', 0.09, 0.07, r['chitin']), f'claw_upper.{side}', 1.0)
        add(limb(f'husk_claw_lower.{side}', f'claw_lower.{side}', 0.1, 0.0, r['bone'], segments=6), f'claw_lower.{side}', 1.1)
        for leg in ('front', 'back'):
            add(limb(f'husk_{leg}_upper.{side}', f'leg_{leg}_upper.{side}', 0.07, 0.05, r['chitin']), f'leg_{leg}_upper.{side}', 0.9)
            add(limb(f'husk_{leg}_lower.{side}', f'leg_{leg}_lower.{side}', 0.05, 0.012, r['bone'], segments=6), f'leg_{leg}_lower.{side}', 0.9)
    return out


NEUTRAL = {}


def walk_keys():
    a = {  # front.L and back.R forward, front.R and back.L back
        'leg_front_upper.L': (0, 0, leg_swing('L', 0.35)), 'leg_back_upper.R': (0, 0, leg_swing('R', 0.35)),
        'leg_front_upper.R': (0, 0, leg_swing('R', -0.35)), 'leg_back_upper.L': (0, 0, leg_swing('L', -0.35)),
        'body': (0.02, 0, 0.04), 'claw_upper.L': (0.1, 0, 0), 'claw_upper.R': (-0.05, 0, 0), 'body@loc': (0, 0, 0.0),
    }
    passing_a = {  # the pair that was back lifts as it swings through
        'leg_front_upper.R': (0.35, 0, 0), 'leg_front_lower.R': (-0.3, 0, 0),
        'leg_back_upper.L': (0.35, 0, 0), 'leg_back_lower.L': (-0.3, 0, 0),
        'body': (0.0, 0, 0.0), 'body@loc': (0, 0, 0.05),
    }
    b = anim.mirror_pose(a, kind='creature')
    b['body@loc'] = (0, 0, 0.0)
    passing_b = anim.mirror_pose(passing_a, kind='creature')
    passing_b['body@loc'] = (0, 0, 0.05)
    return [(1, a), (8, passing_a), (16, b), (23, passing_b), (31, a)]


def attack_keys(strike_frame, end_frame):
    windup = {
        'claw_upper.L': (0.9, 0, 0), 'claw_upper.R': (0.9, 0, 0), 'claw_lower.L': (0.6, 0, 0), 'claw_lower.R': (0.6, 0, 0),
        'body': (0.12, 0, 0), 'thorax': (0.1, 0, 0), 'head': (0.1, 0, 0), 'body@loc': (0, -0.08, 0.02),
    }
    strike = {
        'claw_upper.L': (-0.5, 0, 0), 'claw_upper.R': (-0.5, 0, 0), 'claw_lower.L': (-0.4, 0, 0), 'claw_lower.R': (-0.4, 0, 0),
        'body': (-0.15, 0, 0), 'thorax': (-0.12, 0, 0), 'body@loc': (0, 0.12, -0.03),
    }
    return [(1, NEUTRAL), (strike_frame - 3, windup), (strike_frame, strike), (strike_frame + 6, strike), (end_frame, NEUTRAL)]


def build(ctx):
    timing = ctx.timings()['xeno']['husk']['attack']
    strike_frame = 1 + timing['strike'] * anim.FPS
    end_frame = 1 + timing['duration'] * anim.FPS
    r = {
        'chitin': palette.region('xeno_chitin', X['chitin']),
        'chitin_light': palette.region('xeno_chitin_light', X['chitin_light']),
        'bone': palette.region('xeno_bone', X['bone']),
        'seam': palette.region('xeno_seam', X['chitin'], emit_hex=X['seam']),
    }
    arm = rig.creature('husk_rig')
    mesh = rig.bind_rigid(arm, parts(arm, r), 'husk')
    paint.paint([mesh], name='husk', out_dir=ctx.bake_dir('xeno'), textures_dir=ctx.textures, size=1024,
                style=palette.XENO_STYLE, ao_distance=0.3, brush_scale=1.2, emissive_strength=4.0)
    idle = anim.make_action(arm, 'idle', [(1, NEUTRAL), (31, {'body': (0.03, 0, 0), 'carapace': (-0.04, 0, 0), 'claw_upper.L': (0.05, 0, 0), 'claw_upper.R': (0.05, 0, 0)}), (61, NEUTRAL)], loc_bones=('body',))
    walk = anim.make_action(arm, 'walk', walk_keys(), loc_bones=('body',))
    attack = anim.make_action(arm, 'attack', attack_keys(strike_frame, end_frame), loc_bones=('body',))
    if ctx.previews_enabled:
        out = ctx.preview_dir('husk')
        export.render_views([mesh], out, 'husk', views=4)
        for action in (walk, attack):
            export.render_action(arm, [mesh], action, out, 'husk', frames=6)
    export.export_glb([arm, mesh], ctx.raw_path('xeno', 'husk'), animations=True)
    return [AssetRecord(
        name='husk', family='xeno', file='xeno/husk.glb', nodes=['husk_rig', 'husk'], tris=scene.tri_count([mesh]),
        animations=[
            AnimRecord('idle', anim.duration(idle), True),
            AnimRecord('walk', anim.duration(walk), True),
            AnimRecord('attack', anim.duration(attack), False, strike=(strike_frame - 1) / anim.FPS),
        ],
    )]
```

- [ ] **Step 2: Build it**

Run: `npm run assets -- --only husk`
Expected: `recipe husk: ok`.

- [ ] **Step 3: Review the sheet and filmstrips against these expectations**

Open `docs/evidence/assets/husk.png` (4 views, then 6 walk frames, then 6 attack frames). It must show:
- a hunched body with layered carapace plates, pale claws forward, four splayed legs, magenta eyes and seams only;
- walk: in frames 0 and 3 the front-left and back-right legs are forward together, then the other pair; a swinging pair lifts in between;
- attack: frames 1 and 2 show both claws raised high and the body leaning back; frame 3 shows the claws down at the ground in front with the body lunged forward.

If a leg or claw moves the wrong way, flip the sign of that bone's value in `walk_keys` or `attack_keys` (the conventions are in `lib/anim.py`), rebuild with `npm run assets -- --only husk` and re-check. Save the final sheet.

- [ ] **Step 4: Check timings and budgets, then commit**

Run: `npm run assets:check`
Expected: `ASSET husk ok` and `fail=0`. The attack strike and duration match `src/shared/timings.json` within a frame.

```bash
git add blender/recipes/husk.py public/assets docs/evidence/assets/husk.png
git commit -F - <<'EOF'
Add the Husk recipe with idle, walk and attack

Rigid chitin parts bind to a 17-bone creature rig. The walk moves diagonal
leg pairs and lifts the swinging pair; the attack raises both claws for the
wind-up and slams them down on the strike frame keyed from timings.json
(0.40 s of a 1.40 s clip), which assets:check confirms within one frame.
Filmstrips: docs/evidence/assets/husk.png.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 13: Bulwark recipe (idle, run, attack)

**Files:**
- Create: `blender/recipes/bulwark.py`

- [ ] **Step 1: Write `blender/recipes/bulwark.py`**

```python
"""Bulwark: the heavy commander (v3: 1400 health, heavy cleave). Heroic proportions (1.92 m), fully
armoured, visored helmet with a cyan slit, sword in the right hand and a tower shield on the left forearm.
Gunmetal plates with ivory enamel panels, dark undersuit, cyan energy channels. Animations: idle (2.0 s),
run (0.6 s loop at the 7 m/s run speed), attack (0.85 s, strike at 0.34 s from src/shared/timings.json).
Axis conventions: see lib/anim.py (humanoid)."""
import math

from lib import anim, export, geo, ink, paint, palette, rig, scene
from lib.ctx import AnimRecord, AssetRecord

T = palette.PLAYER


def _regions():
    return {
        'metal': palette.region('tech_gunmetal', T['gunmetal']),
        'metal_light': palette.region('tech_gunmetal_light', T['gunmetal_light']),
        'enamel': palette.region('bulwark_enamel', T['enamel']),
        'suit': palette.region('bulwark_undersuit', T['undersuit']),
        'leather': palette.region('bulwark_leather', T['leather']),
        'trim': palette.region('tech_trim', T['trim']),
        'glow': palette.region('tech_glow', T['gunmetal'], emit_hex=T['energy']),
    }


def parts(arm, r):
    def H(bone):
        return rig.bone_head(arm, bone)

    def Tl(bone):
        return rig.bone_tail(arm, bone)

    out = []

    def add(ob, bone, width=1.0):
        ink.set_ink(ob, width)
        out.append((ob, bone))

    # hips and belt
    add(geo.box('b_hipcore', (0.34, 0.24, 0.2), location=(0, 0, 1.05), bevel=0.04, material=r['suit']), 'hips')
    add(geo.cylinder('b_belt', 0.2, 0.1, segments=12, location=(0, 0, 1.02), material=r['leather']), 'hips', 0.8)
    for name, loc, rot in (('front', (0, -0.16, 0.88), (0.1, 0, 0)), ('back', (0, 0.16, 0.88), (-0.1, 0, 0)),
                           ('left', (0.19, 0, 0.9), (0, -0.12, 0)), ('right', (-0.19, 0, 0.9), (0, 0.12, 0))):
        size = (0.26, 0.05, 0.26) if name in ('front', 'back') else (0.05, 0.22, 0.24)
        add(geo.box(f'b_tasset_{name}', size, location=loc, rotation=rot, bevel=0.015, material=r['metal']), 'hips')
    # abdomen and chest
    add(geo.box('b_abdomen', (0.3, 0.22, 0.2), location=(0, 0, 1.21), bevel=0.04, material=r['suit']), 'spine')
    add(geo.box('b_abplate', (0.26, 0.06, 0.16), location=(0, -0.12, 1.2), bevel=0.02, material=r['metal']), 'spine')
    chest = geo.box('b_chest', (0.46, 0.3, 0.3), location=(0, -0.01, 1.4), bevel=0.08, segments=3, material=r['metal'])
    add(chest, 'chest', 1.2)
    add(geo.box('b_enamel', (0.3, 0.04, 0.18), location=(0, -0.165, 1.43), bevel=0.015, material=r['enamel']), 'chest')
    for side in (-1, 1):
        add(geo.box(f'b_channel{side:+d}', (0.03, 0.02, 0.16), location=(side * 0.1, -0.188, 1.42), material=r['glow']), 'chest', 0.0)
    add(geo.box('b_back', (0.36, 0.14, 0.3), location=(0, 0.17, 1.42), bevel=0.04, material=r['metal_light']), 'chest')
    for side in (-1, 1):
        add(geo.box(f'b_vent{side:+d}', (0.05, 0.02, 0.14), location=(side * 0.09, 0.245, 1.42), material=r['glow']), 'chest', 0.0)
    # shoulders
    for side, bone in ((1, 'shoulder.L'), (-1, 'shoulder.R')):
        add(geo.uv_sphere(f'b_pauldron{side:+d}', 0.16, 14, 7, scale=(1.1, 1.0, 0.8), hemisphere=True, location=(side * 0.27, 0, 1.47), rotation=(0, side * 0.35, 0), material=r['metal']), bone, 1.2)
        add(geo.uv_sphere(f'b_pauldron2{side:+d}', 0.15, 14, 7, scale=(1.15, 1.05, 0.7), hemisphere=True, location=(side * 0.3, 0, 1.4), rotation=(0, side * 0.6, 0), material=r['enamel']), bone, 1.0)
    # neck and helmet
    add(geo.cylinder('b_neck', 0.06, 0.1, segments=10, location=(0, 0, 1.57), material=r['suit']), 'neck', 0.8)
    helmet = geo.uv_sphere('b_helmet', 0.15, 16, 10, scale=(0.95, 1.05, 1.1), location=(0, -0.01, 1.76), material=r['metal'])
    add(helmet, 'head', 1.2)
    add(geo.box('b_faceguard', (0.2, 0.08, 0.12), location=(0, -0.12, 1.7), bevel=0.03, material=r['metal_light']), 'head')
    add(geo.box('b_visor', (0.17, 0.02, 0.025), location=(0, -0.157, 1.765), material=r['glow']), 'head', 0.4)
    add(geo.box('b_crest', (0.03, 0.26, 0.07), location=(0, 0.0, 1.9), bevel=0.012, material=r['enamel']), 'head')
    for side in (-1, 1):
        add(geo.box(f'b_cheek{side:+d}', (0.04, 0.1, 0.12), location=(side * 0.1, -0.07, 1.7), bevel=0.012, material=r['metal']), 'head', 0.9)
    # arms
    for side in ('L', 'R'):
        s = 1 if side == 'L' else -1
        add(geo.segment(f'b_upperarm.{side}', H(f'upper_arm.{side}'), Tl(f'upper_arm.{side}'), 0.06, 0.055, material=r['suit']), f'upper_arm.{side}', 0.9)
        add(geo.segment(f'b_bracer.{side}', H(f'upper_arm.{side}'), Tl(f'upper_arm.{side}'), 0.072, 0.066, segments=8, material=r['metal']), f'upper_arm.{side}', 1.0)
        add(geo.ico(f'b_couter.{side}', 0.068, subdivisions=1, location=H(f'forearm.{side}'), material=r['metal_light']), f'forearm.{side}', 0.9)
        add(geo.segment(f'b_gauntlet.{side}', H(f'forearm.{side}'), Tl(f'forearm.{side}'), 0.066, 0.078, segments=8, material=r['metal']), f'forearm.{side}', 1.0)
        add(geo.box(f'b_hand.{side}', (0.08, 0.1, 0.11), location=(s * 0.35, -0.05, 0.9), bevel=0.02, material=r['leather']), f'hand.{side}', 0.8)
        # legs
        add(geo.segment(f'b_thigh.{side}', H(f'thigh.{side}'), Tl(f'thigh.{side}'), 0.085, 0.07, material=r['suit']), f'thigh.{side}', 0.9)
        add(geo.box(f'b_thighplate.{side}', (0.16, 0.06, 0.3), location=(s * 0.12, -0.085, 0.78), bevel=0.02, material=r['metal']), f'thigh.{side}')
        add(geo.uv_sphere(f'b_knee.{side}', 0.075, 12, 6, scale=(1, 1, 0.8), hemisphere=True, location=(s * 0.12, -0.07, 0.56), rotation=(-1.5708, 0, 0), material=r['metal_light']), f'shin.{side}', 0.9)
        add(geo.segment(f'b_greave.{side}', H(f'shin.{side}'), Tl(f'shin.{side}'), 0.075, 0.065, segments=8, material=r['metal']), f'shin.{side}')
        add(geo.box(f'b_ridge.{side}', (0.05, 0.05, 0.36), location=(s * 0.12, -0.07, 0.34), bevel=0.012, material=r['enamel']), f'shin.{side}', 0.8)
        add(geo.box(f'b_boot.{side}', (0.13, 0.27, 0.1), location=(s * 0.12, -0.05, 0.05), bevel=0.03, material=r['leather']), f'foot.{side}', 0.9)
        add(geo.box(f'b_toecap.{side}', (0.12, 0.08, 0.06), location=(s * 0.12, -0.16, 0.07), bevel=0.02, material=r['metal']), f'foot.{side}', 0.8)
    # sword in the right hand: grip at the socket, blade forward (-Y), edge vertical
    grip_y = -0.05
    add(geo.cylinder('b_grip', 0.02, 0.2, segments=8, location=(-0.35, grip_y, 0.88), rotation=(1.5708, 0, 0), material=r['leather']), 'socket.R', 0.6)
    add(geo.ico('b_pommel', 0.035, subdivisions=1, location=(-0.35, grip_y + 0.11, 0.88), material=r['metal_light']), 'socket.R', 0.6)
    add(geo.box('b_guard', (0.05, 0.05, 0.26), location=(-0.35, grip_y - 0.11, 0.88), bevel=0.012, material=r['enamel']), 'socket.R', 0.8)
    blade = geo.box('b_blade', (0.02, 0.95, 0.09), location=(-0.35, grip_y - 0.61, 0.88), material=r['trim'])
    for vertex in blade.data.vertices:
        if vertex.co.y < -0.4:
            vertex.co.z *= 0.1  # the four tip vertices close to a point
    add(blade, 'socket.R', 0.9)
    add(geo.box('b_fuller', (0.024, 0.8, 0.02), location=(-0.35, grip_y - 0.55, 0.88), material=r['glow']), 'socket.R', 0.0)
    # tower shield on the left forearm, face outward (+X)
    add(geo.box('b_shield', (0.05, 0.55, 0.95), location=(0.45, -0.05, 1.0), bevel=0.03, material=r['metal']), 'socket.L', 1.3)
    add(geo.box('b_shieldpanel', (0.02, 0.42, 0.8), location=(0.476, -0.05, 1.0), bevel=0.01, material=r['enamel']), 'socket.L', 0.8)
    add(geo.box('b_emblem', (0.02, 0.12, 0.2), location=(0.49, -0.05, 1.05), rotation=(math.radians(45), 0, 0), material=r['glow']), 'socket.L', 0.5)
    add(geo.ico('b_boss', 0.06, subdivisions=1, location=(0.5, -0.05, 0.8), material=r['metal_light']), 'socket.L', 0.7)
    return out


GUARD = {
    'upper_arm.L': (-0.2, 0, -0.6), 'forearm.L': (0, 0, -1.2),
    'upper_arm.R': (0.0, 0, -0.45), 'forearm.R': (0, 0, -1.0),
    'chest': (0, 0.12, 0.05), 'spine': (0, 0, 0.08),
    'thigh.L': (0, 0, -0.25), 'shin.L': (0, 0, 0.3), 'thigh.R': (0, 0, 0.2), 'shin.R': (0, 0, 0.25),
    'hips@loc': (0, -0.03, 0),
}


def idle_keys():
    breathe = anim.merge(GUARD, {'chest': (0, 0.12, 0.08), 'spine': (0, 0, 0.1), 'head': (0, 0, -0.03), 'hips@loc': (0, -0.035, 0)})
    return [(1, GUARD), (31, breathe), (61, GUARD)]


def run_keys():
    legs_contact_r = {
        'thigh.R': (0, 0, -0.75), 'shin.R': (0, 0, 0.25), 'foot.R': (0, 0, -0.2),
        'thigh.L': (0, 0, 0.55), 'shin.L': (0, 0, 1.0), 'foot.L': (0, 0, 0.4),
        'spine': (0, -0.12, 0.18), 'chest': (0, 0.1, 0.05), 'head': (0, 0, -0.1), 'hips@loc': (0, -0.02, 0),
    }
    legs_pass_r = {
        'thigh.R': (0, 0, -0.1), 'shin.R': (0, 0, 0.35), 'thigh.L': (0, 0, -0.35), 'shin.L': (0, 0, 1.5),
        'spine': (0, 0, 0.2), 'head': (0, 0, -0.1), 'hips@loc': (0, 0.04, 0),
    }
    arms_contact_r = {'upper_arm.R': (0, 0, 0.5), 'forearm.R': (0, 0, -0.8), 'upper_arm.L': (-0.2, 0, -0.1), 'forearm.L': (0, 0, -1.3)}
    arms_contact_l = {'upper_arm.R': (0, 0, -0.4), 'forearm.R': (0, 0, -0.9), 'upper_arm.L': (-0.2, 0, -0.35), 'forearm.L': (0, 0, -1.2)}
    arms_pass = {'upper_arm.R': (0, 0, 0.05), 'forearm.R': (0, 0, -0.85), 'upper_arm.L': (-0.2, 0, -0.22), 'forearm.L': (0, 0, -1.25)}
    contact_r = anim.merge(legs_contact_r, arms_contact_r)
    pass_r = anim.merge(legs_pass_r, arms_pass)
    # Legs and torso mirror; the arms are authored per contact because the sword and shield arms differ.
    contact_l = anim.merge(anim.mirror_pose(legs_contact_r), arms_contact_l)
    pass_l = anim.merge(anim.mirror_pose(legs_pass_r), arms_pass)
    return [(1, contact_r), (5.5, pass_r), (10, contact_l), (14.5, pass_l), (19, contact_r)]


def attack_keys(strike_frame, end_frame):
    windup = anim.merge(GUARD, {
        'upper_arm.R': (-1.3, 0, 0.4), 'forearm.R': (0, 0, -1.6),
        'chest': (0, -0.5, 0.0), 'spine': (0, -0.2, -0.05),
        'thigh.R': (0, 0, 0.15), 'shin.R': (0, 0, 0.4), 'hips@loc': (0, -0.05, 0),
    })
    strike = anim.merge(GUARD, {
        'upper_arm.R': (-0.9, 0, -1.2), 'forearm.R': (0, 0, -0.3),
        'chest': (0, 0.45, 0.1), 'spine': (0, 0.15, 0.3),
        'thigh.L': (0, 0, -0.5), 'shin.L': (0, 0, 0.5), 'thigh.R': (0, 0, 0.45), 'shin.R': (0, 0, 0.2),
        'hips@loc': (0, -0.06, 0),
    })
    follow = anim.merge(strike, {'upper_arm.R': (0.2, 0, -0.6), 'forearm.R': (0, 0, -0.5), 'chest': (0, 0.6, 0.12)})
    return [(1, GUARD), (strike_frame - 4.2, windup), (strike_frame, strike), (strike_frame + 4.8, follow), (end_frame, GUARD)]


def build(ctx):
    timing = ctx.timings()['commanders']['bulwark']['attack']
    strike_frame = 1 + timing['strike'] * anim.FPS
    end_frame = 1 + timing['duration'] * anim.FPS
    r = _regions()
    arm = rig.humanoid('bulwark_rig')
    mesh = rig.bind_rigid(arm, parts(arm, r), 'bulwark')
    paint.paint([mesh], name='bulwark', out_dir=ctx.bake_dir('commanders'), textures_dir=ctx.textures, size=1024,
                style=palette.PLAYER_STYLE, ao_distance=0.18, brush_scale=1.4, emissive_strength=4.0)
    idle = anim.make_action(arm, 'idle', idle_keys(), loc_bones=('hips',))
    run = anim.make_action(arm, 'run', run_keys(), loc_bones=('hips',))
    attack = anim.make_action(arm, 'attack', attack_keys(strike_frame, end_frame), loc_bones=('hips',))
    if ctx.previews_enabled:
        out = ctx.preview_dir('bulwark')
        export.render_views([mesh], out, 'bulwark', views=4, size=640)
        for action in (run, attack):
            export.render_action(arm, [mesh], action, out, 'bulwark', frames=6)
    export.export_glb([arm, mesh], ctx.raw_path('commanders', 'bulwark'), animations=True)
    return [AssetRecord(
        name='bulwark', family='commanders', file='commanders/bulwark.glb', nodes=['bulwark_rig', 'bulwark'],
        tris=scene.tri_count([mesh]),
        animations=[
            AnimRecord('idle', anim.duration(idle), True),
            AnimRecord('run', anim.duration(run), True),
            AnimRecord('attack', anim.duration(attack), False, strike=(strike_frame - 1) / anim.FPS),
        ],
    )]
```

- [ ] **Step 2: Build it**

Run: `npm run assets -- --only bulwark`
Expected: `recipe bulwark: ok`.

- [ ] **Step 3: Review the sheet and filmstrips against these expectations**

Open `docs/evidence/assets/bulwark.png` (4 views, then 6 run frames, then 6 attack frames). It must show:
- a broad-shouldered armoured figure about 7.5 heads tall, no face visible, a cyan visor slit, enamel panels on chest, pauldrons, crest, shins and shield;
- the sword in the right hand pointing forward in the rest views and the tower shield on the left forearm;
- run: frame 0 has the right leg forward and the right arm back; frame 3 is the mirror (left leg forward); the torso leans forward;
- attack: frame 1 has the sword pulled back and raised at the right with the torso twisted right; frames 2 and 3 have the sword swept across the front with a forward lunge on the left leg; frame 5 returns to guard.

If a limb moves the wrong way, flip the sign of that bone's value in `GUARD`, `run_keys` or `attack_keys` (conventions in `lib/anim.py`), rebuild and re-check. Interpenetration of armour plates at extreme poses is acceptable only where the hull ink hides it.

- [ ] **Step 4: Full rebuild, check and commit**

Run: `npm run assets && npm run assets:check`
Expected: every recipe `ok`, then `assets:check pass=8 fail=0` (two textures, six models).

```bash
git add blender/recipes/bulwark.py public/assets docs/evidence/assets/bulwark.png
git commit -F - <<'EOF'
Add the Bulwark recipe with idle, run and attack

A visored, fully armoured commander on the 22-bone humanoid with rigid
parts: gunmetal plates, ivory enamel panels, cyan visor and channels, sword
on the hand socket and tower shield on the forearm socket. The run is a
0.6 s loop for the 7 m/s run speed; the attack keys its strike at 0.34 s of
0.85 s from timings.json, confirmed by assets:check within one frame.
Filmstrips: docs/evidence/assets/bulwark.png.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 14: Wire the asset check into CI and record M0c

**Files:**
- Modify: `.github/workflows/ci.yml`, `docs/blueprint.md`

- [ ] **Step 1: Add the asset check to CI**

In `.github/workflows/ci.yml`, after `- run: npm run check`, add:

```yaml
      - run: npm run assets:check
```

- [ ] **Step 2: Run the Blender tests and every check once more**

Run: `npm run test:blender && npm run check && npm test && npm run assets:check`
Expected: `BLENDER_TESTS pass=13 fail=0`, checks clean, unit tests pass, `assets:check pass=8 fail=0`.

- [ ] **Step 3: Update `docs/blueprint.md`**

In the Kit section, replace `Current count: 0 files, because nothing is built yet.` with:

```markdown
Current count (M0c): 8 manifest entries: brush_strokes and ink_noise textures; verdant_kit (8 pieces),
worldheart (plinth and 11 stages), nest, bolt_sentinel (marks I to III), husk and bulwark.
```

In the Decided table, change the Blender row to:

```markdown
| Every asset built by script in Blender 5.2.1 | partial | style-scene set built by npm run assets; assets:check pass=8 fail=0; sheets in docs/evidence/assets |
```

Tick in the Task list:

```markdown
- [x] Blender pipeline: headless runner, shared libraries (paint bake, rig, animate, export),
      manifest, turntable sheets, asset checks
- [x] Style scene assets: Bulwark (idle, run, attack), Bolt Sentinel marks I to III, Husk (walk,
      attack), Worldheart, nest, Verdant kit (rocks, flora, grass cards), brush atlas
```

Append to Where we are:

```markdown
M0c is complete: `npm run assets` builds the style-scene set in Blender 5.2.1 and `npm run assets:check`
passes; contact sheets are in docs/evidence/assets.
```

- [ ] **Step 4: Commit and push**

```bash
git add .github/workflows/ci.yml docs/blueprint.md
git commit -F - <<'EOF'
Check committed assets in CI and record M0c in the blueprint

CI now runs npm run assets:check against the committed manifest (it never
runs Blender). The blueprint's Kit section counts the eight manifest entries
and the Decided ledger moves the Blender row to partial with the check line
and the contact sheets as evidence.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git push
```

---

## Self-review

- **Spec coverage:** the blueprint's recipe steps 1 to 5 (build, paint bake, rig, animate with strike
  markers equal to simulation timings, export with previews) are Tasks 3 to 7; the Kit manifest and the
  `assets:check` instrument are Tasks 7 and 14; every M0 style-scene asset is Tasks 8 to 13. Vertex
  animation textures for crowds are deferred to M2, when crowds exist.
- **Placeholders:** none. Review steps carry concrete expectations and a concrete correction procedure.
- **Consistency:** `paint.paint(objs, *, name, out_dir, textures_dir, size, style, ao_distance, ao_samples,
  brush_scale, emissive_strength, margin)` is called with those keywords everywhere; `anim.make_action(arm,
  name, keys, loc_bones)`, `export.render_action(arm, objs, action, out_dir, prefix, frames, size)` and
  `rig.bind_rigid(arm, parts, name)` match their definitions; `_ink` is width / 2 in `ink.py` and the M0d
  loader multiplies by 2.
