import { Color } from 'three';
import { INK_GATE_HEADROOM, INK_GATE_WIDTH, WARM_BLUE_FULL, WARM_BLUE_NONE } from '../../../src/render/post/pipeline';

/**
 * The bloom shaders' per-pixel tests written again in JS, for pipeline.test.ts and bloom-warm.test.ts. Only a GPU runs
 * the shaders, so the tests hold their lines as text and check what those lines decide here; one copy keeps the two
 * test files from drifting apart.
 */

/** A linear RGB colour, as the bloom's input reads a pixel. */
export type Rgb = readonly [number, number, number];

/** An sRGB hex colour in linear light, as a dial or palette colour reaches the shaders. */
export function linearRgb(hex: string): Rgb {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

/** Rec.709 luminance in linear light: the weights three writes into the effect shaders' luminance(). */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function bluePerPeak([r, g, b]: Rgb): number {
  return b / Math.max(r, g, b, 1e-4);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** The key material's warm test as its shader runs it: red must lead, then blue over peak ramps from warm to not. */
export function warmth(texel: Rgb): number {
  const [r, g, b] = texel;
  return (r >= Math.max(g, b) ? 1 : 0) * (1 - smoothstep(WARM_BLUE_FULL, WARM_BLUE_NONE, bluePerPeak(texel)));
}

/**
 * The ink gate's two edges for an ink colour, in fp32 as the GPU forms them: the uniform is the ink's luminance rounded
 * to fp32, times the headroom define, then plus the width define.
 */
export function inkGateEdges(inkColor: string): [number, number] {
  const f = Math.fround;
  const low = f(f(luminance(linearRgb(inkColor))) * f(INK_GATE_HEADROOM));
  return [low, f(low + f(INK_GATE_WIDTH))];
}
