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


# Cycles pointiness on low-poly hard surfaces sits off 0.5 across whole faces, not just at edges, so the default
# gain of 8 lit entire panels. Measured on the plan's Bolt Sentinel bake (brush strength 0.3, brush scale 1.1, the
# soft stroke field): gain 8 baked player gunmetal #3d4757 to about (96, 102, 112) with 72% of the trim clipping a
# channel, and a gain of 2 keeps the edge light on the edges, (68, 77, 91) with 2% clipped.
# Strokes only scale value, so dark gunmetal needs more strength than pale trim to carry visible paint. Measured on
# the Bolt Sentinel recipe's atlas (brush scale 0.3, the painted-over strokes): 0.8 widens the gunmetal's 10th to
# 90th percentile luminance spread from 14 (the plan's 0.3) to 18 sRGB levels and reads as strokes in the previews,
# while the clipped share of the trim grows from 7.9% to 14%; 1.0 mottled the pale trim, 18% of which then clipped.
PLAYER_STYLE = PaintStyle(shadow_tint=(0.40, 0.58, 0.72), curv_gain=2.0, edge_light=0.5, cavity_dark=0.5, brush_strength=0.8)
# The chitin is darker still: at 0.35 the strokes shifted it by about 3 sRGB levels, invisible. At 1.6 they read and
# the chitin stays dark: the Husk's body spans L* 10.2 to 16.7 (10th to 90th percentile) and nothing clips. The nest
# paints with this style too, so a change here repaints both.
XENO_STYLE = PaintStyle(shadow_tint=(0.55, 0.35, 0.70), ao_strength=0.8, curv_gain=2.0, edge_light=0.3, edge_tint=(0.9, 0.8, 1.0), cavity_dark=0.6, brush_strength=1.6)
# Warm light tops against cool, darker bases, strong enough to read before any runtime light, and deeper occlusion.
NATURE_STYLE = PaintStyle(shadow_tint=(0.35, 0.60, 0.62), ao_strength=0.85, edge_light=0.25, cavity_dark=0.35,
                          warm=(1.16, 1.06, 0.86), cool=(0.52, 0.64, 0.80), brush_strength=0.85, stroke_tint_mix=0.35)
HEART_STYLE = PaintStyle(shadow_tint=(0.85, 0.55, 0.50), ao_strength=0.35, edge_light=0.7, edge_tint=(1.0, 0.95, 0.85), cavity_dark=0.2, brush_strength=0.25, emissive_brush=0.35)
