import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIALS } from '../../../src/render/defaults';
import { BloomKeyMaterial, WARM_BLUE_FULL, WARM_BLUE_NONE } from '../../../src/render/post/pipeline';

type Rgb = readonly [number, number, number];

const bluePerPeak = ([r, g, b]: Rgb): number => b / Math.max(r, g, b, 1e-4);

/** The key material's warm test as its shader runs it: red must lead, then blue over peak ramps from warm to not. */
function warmth(texel: Rgb): number {
  const [r, g, b] = texel;
  const t = Math.min(Math.max((bluePerPeak(texel) - WARM_BLUE_FULL) / (WARM_BLUE_NONE - WARM_BLUE_FULL), 0), 1);
  return (r >= Math.max(g, b) ? 1 : 0) * (1 - t * t * (3 - 2 * t));
}

// Emitter texels of the committed assets (public/assets at 73a7f46) with a key past the default threshold's ramp: each
// texel's albedo at the default saturation, lit by the default sun facing it plus the Verdant sky ambient, with its
// emission capped at EMISSIVE_PEAK added, which is the linear colour the bloom's input reads off a lit emitter. Picked
// at the 1st, 50th and 99th percentile of blue over peak for the heart and the nest, and at the 50th for the cyan assets.
const HEART: Record<string, Rgb> = {
  p1: [2.1799, 0.7027, 0.0896],
  p50: [2.0339, 0.6122, 0.0975],
  p99: [2.2069, 0.7919, 0.1644],
};
const NEST: Record<string, Rgb> = {
  p1: [1.2784, 0.0772, 0.488],
  p50: [1.2883, 0.0829, 0.5233],
  p99: [1.3932, 0.2246, 0.7232],
};
const CYAN: Record<string, Rgb> = {
  bolt: [0.2395, 1.2, 1.3196],
  bulwark: [0.4822, 1.2994, 1.3248],
};

describe('bloom warm test', () => {
  it('gives every heart texel the heart halo and no nest seam or cyan channel any of it', () => {
    for (const [name, texel] of Object.entries(HEART)) expect(warmth(texel), `heart ${name}`).toBe(1);
    for (const [name, texel] of Object.entries(NEST)) expect(warmth(texel), `nest ${name}`).toBe(0);
    for (const [name, texel] of Object.entries(CYAN)) expect(warmth(texel), `cyan ${name}`).toBe(0);
  });

  it('keeps the measured margins of Pillar 5 on either side of its two edges', () => {
    // The heart's bluest texel sits 0.126 under the edge where warmth starts to fall, the nest's least blue seam 0.032
    // over the edge where it is gone. A palette or lighting change that closes either gap should be seen here first.
    expect(bluePerPeak(HEART.p1!)).toBeCloseTo(0.041, 3);
    expect(bluePerPeak(HEART.p99!)).toBeCloseTo(0.074, 3);
    expect(bluePerPeak(NEST.p1!)).toBeCloseTo(0.382, 3);
    expect(bluePerPeak(NEST.p99!)).toBeCloseTo(0.519, 3);
    expect(WARM_BLUE_FULL - bluePerPeak(HEART.p99!)).toBeGreaterThan(0.12);
    expect(bluePerPeak(NEST.p1!) - WARM_BLUE_NONE).toBeGreaterThan(0.03);
  });

  it('keeps a dim anti-aliased heart edge warm', () => {
    // The crystal's silhouette meets its hull ink, so an edge pixel is part crystal and part ink. At 80 percent crystal its
    // key (0.8 of the heart's 1.37) is just inside the default threshold's ramp, and the ink's blue barely moves it.
    const ink = new Color('#0e0f14');
    const edge: Rgb = [0.8 * HEART.p50![0] + 0.2 * ink.r, 0.8 * HEART.p50![1] + 0.2 * ink.g, 0.8 * HEART.p50![2] + 0.2 * ink.b];
    expect(bluePerPeak(edge)).toBeLessThan(0.05);
    expect(warmth(edge)).toBe(1);
  });

  it('documents the known failure: a strong orange key and a rim warm the nest seams (unreachable at the defaults)', () => {
    // The nest's median seam texel under a sunColor of #ff8844 at intensity 8 with a silhouette rim: its blue falls to
    // 0.259 of its peak and it tests two thirds warm, so the seams take most of the heart's strength. Deciding warmth in
    // painted.ts from the emitter's own colour would end it; this case should then read 0.
    const failure: Rgb = [1.9956, 0.1244, 0.5159];
    expect(bluePerPeak(failure)).toBeCloseTo(0.259, 3);
    expect(warmth(failure)).toBeGreaterThan(0.5);
    expect(DEFAULT_DIALS.sunColor).not.toBe('#ff8844');
    expect(DEFAULT_DIALS.sunIntensity).toBeLessThan(8);
  });

  it('is the test the key material runs, with these edges as float literals', () => {
    const material = new BloomKeyMaterial(DEFAULT_DIALS);
    expect(material.fragmentShader).toContain('(1.0 - smoothstep(WARM_BLUE_FULL, WARM_BLUE_NONE, texel.b / peak))');
    expect(material.fragmentShader).toContain('step(max(texel.g, texel.b), texel.r)');
    expect(material.defines['WARM_BLUE_FULL']).toBe('0.2');
    expect(material.defines['WARM_BLUE_NONE']).toBe('0.35');
    expect(Number(material.defines['WARM_BLUE_FULL'])).toBe(WARM_BLUE_FULL);
    expect(Number(material.defines['WARM_BLUE_NONE'])).toBe(WARM_BLUE_NONE);
  });
});
