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
