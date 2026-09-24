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
