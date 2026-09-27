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
