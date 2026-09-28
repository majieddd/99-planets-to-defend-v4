import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIALS } from '../../../src/render/defaults';
import { BloomKeyMaterial, WARM_BLUE_FULL, WARM_BLUE_NONE } from '../../../src/render/post/pipeline';
import { warmInputs } from '../../../tools/render/warm-texels.mjs';
import { bluePerPeak, inkGateEdges, linearRgb, luminance, warmth, type Rgb } from './bloom-model';

/**
 * Emitter texels of the committed assets with a key past the default threshold's ramp, lit as painted.ts lights an
 * emitter on the lit side at the defaults, with its emission capped at EMISSIVE_PEAK: the linear colour the bloom's
 * input reads. Picked at the 1st, 50th and 99th percentile of blue over peak for the heart and the nest, and at the 50th
 * for the cyan assets; nestRim adds a silhouette pixel's rim light at the defaults, and failure the known failure's
 * orange key under the same rim. halfWarm is the share of seam texels the warm test calls at least half warm. The first
 * test fails with the command to run when an asset or any lighting input has changed since.
 */
// warm-texels: begin. Written by tools/render/warm-texels.mjs; paste its output over this block.
const GENERATED = {
  assets: {
    'heart/worldheart.glb': 'e32c57d8b8e608f7cdc8dec1c7aee80da89b13b9f484bd2dbccaaf34f5d877f5',
    'nests/nest.glb': 'fb070b7540ecdf97682906396dd4a7a59ee35366fda3e5fef304e2b440310402',
    'towers/bolt_sentinel.glb': '7146ee975e77d5597ace11eaf1b3e0ed7a6219eaa2d89075cee1750b3762fea2',
    'commanders/bulwark.glb': '30d684b9da5c6589e2e41777e89a7e2cbc4bd830b10f3712351c39738ce45bd6',
  },
  inputs: {
    sunColor: '#ffd29a',
    sunIntensity: 3.2,
    saturation: 1.3,
    ambientStrength: 0.45,
    ambientSky: '#9cc7e0',
    ambientGround: '#6b8f5a',
    rimStrength: 0.35,
    rimPower: 3,
    emissivePeak: 1.25,
    keyFloor: 1.25,
    halfWarmBlue: 0.275,
  },
  heart: {
    p1: [2.1799, 0.7027, 0.0896],
    p50: [2.0339, 0.6122, 0.0975],
    p99: [2.2069, 0.7919, 0.1644],
  },
  nest: {
    p1: [1.2784, 0.0772, 0.488],
    p50: [1.2883, 0.0829, 0.5233],
    p99: [1.3932, 0.2246, 0.7232],
  },
  cyan: {
    bolt: [0.2395, 1.2, 1.3196],
    bulwark: [0.4822, 1.2994, 1.3248],
  },
  nestRim: {
    p1: [1.5383, 0.1851, 0.5151],
    p50: [1.5414, 0.1869, 0.5479],
    halfWarm: 0,
  },
  failure: {
    p50: [1.9956, 0.1244, 0.5159],
    halfWarm: 0.8948,
  },
} as const;
// warm-texels: end

const RERUN = 're-run npx tsx tools/render/warm-texels.mjs and paste its output into bloom-warm.test.ts';
const { heart: HEART, nest: NEST, cyan: CYAN } = GENERATED;

describe('bloom warm test', () => {
  it('was generated from the committed assets and the current lighting', () => {
    for (const [file, sha256] of Object.entries(GENERATED.assets)) {
      const bytes = readFileSync(new URL(`../../../public/assets/${file}`, import.meta.url));
      expect(createHash('sha256').update(bytes).digest('hex'), `${file} changed: ${RERUN}`).toBe(sha256);
    }
    expect(warmInputs(), `the lighting changed: ${RERUN}`).toEqual(GENERATED.inputs);
  });

  it('gives every heart texel the heart halo and no nest seam or cyan channel any of it', () => {
    for (const [name, texel] of Object.entries(HEART)) expect(warmth(texel), `heart ${name}`).toBe(1);
    for (const [name, texel] of Object.entries(NEST)) expect(warmth(texel), `nest ${name}`).toBe(0);
    for (const [name, texel] of Object.entries(CYAN)) expect(warmth(texel), `cyan ${name}`).toBe(0);
  });

  it('keeps the measured margins of Pillar 5 on either side of its two edges', () => {
    // The heart's bluest texel sits 0.126 under the edge where warmth starts to fall, the nest's least blue seam 0.032
    // over the edge where it is gone. A palette, asset or lighting change reaches these texels only through the
    // generator, which the first test makes someone run, so a change that closes either gap fails here.
    expect(bluePerPeak(HEART.p1)).toBeCloseTo(0.041, 3);
    expect(bluePerPeak(HEART.p99)).toBeCloseTo(0.074, 3);
    expect(bluePerPeak(NEST.p1)).toBeCloseTo(0.382, 3);
    expect(bluePerPeak(NEST.p99)).toBeCloseTo(0.519, 3);
    expect(WARM_BLUE_FULL - bluePerPeak(HEART.p99)).toBeGreaterThan(0.12);
    expect(bluePerPeak(NEST.p1) - WARM_BLUE_NONE).toBeGreaterThan(0.03);
  });

  it('keeps a dim anti-aliased heart edge warm, and no ink to the ink gate', () => {
    // The crystal's silhouette meets its hull ink, so an edge pixel is part crystal and part ink. At 80 percent crystal its
    // key (0.8 of the heart's 1.37) is just inside the default threshold's ramp, and the ink's blue barely moves it.
    const ink = linearRgb(DEFAULT_DIALS.inkColor);
    const edge: Rgb = [0.8 * HEART.p50[0] + 0.2 * ink[0], 0.8 * HEART.p50[1] + 0.2 * ink[1], 0.8 * HEART.p50[2] + 0.2 * ink[2]];
    expect(bluePerPeak(edge)).toBeLessThan(0.05);
    expect(warmth(edge)).toBe(1);
    // Where the shield lets glow onto such a pixel (a key under the threshold), the gate must not take it for ink: even at
    // 5 percent crystal it sits over the default ink's gate.
    const [, gateTop] = inkGateEdges(DEFAULT_DIALS.inkColor);
    const faint: Rgb = [0.05 * HEART.p50[0] + 0.95 * ink[0], 0.05 * HEART.p50[1] + 0.95 * ink[1], 0.05 * HEART.p50[2] + 0.95 * ink[2]];
    expect(luminance(faint)).toBeGreaterThan(gateTop);
  });

  it('keeps the nest seams cool at the defaults, even on a silhouette under the rim light', () => {
    // The failure below needs a strong orange key and a rim together. At the defaults' own key the rim moves the seams
    // toward warm (the least blue 1 percent to 0.335 of their peak) without making any of them half warm, so the heart's
    // strength stays the heart's. A default key that could, such as #ff8845 at 7.9, puts 85 percent of them there.
    expect(GENERATED.nestRim.halfWarm).toBe(0);
    expect(warmth(GENERATED.nestRim.p1)).toBeLessThan(0.5);
    expect(warmth(GENERATED.nestRim.p50)).toBe(0);
  });

  it('documents the known failure: a strong orange key and a rim warm the nest seams (unreachable at the defaults)', () => {
    // The nest's median seam texel under a sunColor of #ff8844 at intensity 8 with a silhouette rim: its blue falls to
    // 0.259 of its peak and it tests two thirds warm, and 89.5 percent of the seams test at least half warm, so they take
    // most of the heart's strength. Deciding warmth in painted.ts from the emitter's own colour would end it; this case
    // should then read 0.
    expect(bluePerPeak(GENERATED.failure.p50)).toBeCloseTo(0.259, 3);
    expect(warmth(GENERATED.failure.p50)).toBeGreaterThan(0.5);
    expect(GENERATED.failure.halfWarm).toBeCloseTo(0.895, 3);
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
