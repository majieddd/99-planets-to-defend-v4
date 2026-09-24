"""Brush atlas: the stroke field used by paint bakes and by runtime terrain painting (flat-bodied strokes
painted over one another on a mid-grey ground, so a bake reads as paint rather than grain or blur), and a
tileable ink noise that varies line width. Both are generated with numpy and tile seamlessly."""
import math

import numpy as np

from lib.ctx import AssetRecord
from lib.png import write_png


def stroke_field(size=512, strokes=220, seed=7):
    """Speed-painted strokes laid over one another on a mid-grey ground, so a box-projected bake reads as paint
    (flat-bodied strokes with visible edges) instead of grain or blur.

    Why this shape: summed soft strokes pile up into dark knots and bright highlights that betray the tiling,
    and their feathered edges blur away once baked at about 3 brush texels per bake texel. Here each stroke
    is one flat value composited over what is under it, so it covers instead of adding: nothing accumulates
    and the mean stays at mid-grey. Edges are anti-aliased over about 1.5 texels, crisp enough to survive the
    bake without stair-stepping. A stroke starts square, tapers and thins toward its tail as the brush runs
    dry, bends slightly, and carries faint bristle streaks along its length. Values sit in a moderate band
    either side of 0.5 and skip its middle, so neighbouring strokes differ enough for their edges to read and
    no single stroke becomes an accent. Strokes are about 12 to 26 texels wide and 60 to 220 long in the 512
    tile (scaled with `size`) because the recipes' brush_scale choices assume those extents. Each stroke's
    window wraps its indices around the tile, so the tile repeats seamlessly by construction; the fixed seed
    keeps it deterministic."""
    rng = np.random.default_rng(seed)
    k = size / 512
    edge = 1.5 * k                                   # soft enough to stop stair-steps, still crisp once baked
    field = np.full((size, size), 0.5, np.float32)   # neutral ground: bare texels leave colour nearly as is
    for _ in range(strokes):
        cx, cy = rng.uniform(0, size, 2)
        angle = rng.normal(0.5, 0.35)
        half_l = rng.uniform(30, 110) * k
        half_w = rng.uniform(6, 13) * k
        value = 0.5 + (1.0 if rng.random() < 0.5 else -1.0) * rng.uniform(0.07, 0.25)
        bend = rng.uniform(-0.5, 0.5) * half_w
        dry = rng.uniform(0.7, 0.95)                 # tail opacity: a drying brush lets older paint through
        # Bristle streaks: the grid overshoots the stroke's soft edge because np.interp holds its end value
        # beyond the grid, which would leave a flat band instead of the faint ripple where the edge fades.
        grid = np.arange(-half_w - 2 * edge - 2.4 * k, half_w + 2 * edge + 2.4 * k, 2.4 * k)
        streaks = rng.uniform(-1.0, 1.0, grid.size)
        # Only the stroke's own window is evaluated; its indices wrap, which is what makes the tile seamless.
        # The window must be no wider than the tile: the composite below is one fancy-index assignment, and
        # numpy does not define which write wins where an index repeats. Tiles under 13 texels can fail this.
        reach = half_l + half_w + abs(bend) + 2 * edge + 2
        xs = np.arange(math.floor(cx - reach), math.ceil(cx + reach) + 1)
        ys = np.arange(math.floor(cy - reach), math.ceil(cy + reach) + 1)
        assert xs.size <= size and ys.size <= size
        dx = (xs - cx).astype(np.float32)[None, :]
        dy = (ys - cy).astype(np.float32)[:, None]
        c, s = math.cos(angle), math.sin(angle)
        u = dx * c + dy * s
        t = u / half_l                               # -1 start, +1 tail: bend, taper and drying fit any length
        w = -dx * s + dy * c - bend * t * t
        width = half_w * (1.0 - 0.45 * np.clip((t - 0.4) / 0.6, 0.0, 1.0) ** 2)
        side = np.clip((width - np.abs(w)) / edge + 0.5, 0.0, 1.0)
        ends = np.clip((half_l - np.abs(u)) / edge + 0.5, 0.0, 1.0)
        alpha = side * ends * (1.0 - (1.0 - dry) * np.clip((t + 1.0) * 0.5, 0.0, 1.0))
        tone = value + 0.02 * np.interp(w, grid, streaks)
        rows = (ys % size)[:, None]
        cols = (xs % size)[None, :]
        under = field[rows, cols]
        field[rows, cols] = under + (tone - under) * alpha
    # Re-centred so the strokes neither brighten nor darken a bake on average, by a shift: a stretch to 0..1
    # would pin the darkest and brightest strokes to black and white, the knots and highlights that betray
    # the tiling. The shift is tiny, so bare ground sits at about 127 of 255 rather than exactly 128.
    field += 0.5 - float(field.mean())
    return np.clip(field, 0.0, 1.0)


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
