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
 * test fails with the command to run when an asset, a lighting input or one of the generator's own assumptions (where
 * the hemisphere is read, how far a silhouette faces away, the failure's key) has changed since.
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
    sunColor: '#ffc05c',
    sunIntensity: 6.6,
    saturation: 1.12,
    ambientStrength: 0.22,
    ambientSky: '#9cc7e0',
    ambientGround: '#6b8f5a',
    rimStrength: 0.6,
    rimPower: 3,
    emissivePeak: 1.25,
    keyFloor: 1.25,
    halfWarmBlue: 0.275,
    hemisphereSkyWeight: 0.75,
    silhouetteFacing: 0.9,
    failureSunColor: '#ff8844',
    failureSunIntensity: 8,
  },
  heart: {
    p1: [2.966, 0.7257, 0.109],
    p50: [2.9146, 0.8336, 0.1224],
    p99: [2.5743, 0.7623, 0.1557],
  },
  nest: {
    p1: [1.3059, 0.0828, 0.4764],
    p50: [1.3204, 0.091, 0.5072],
    p99: [1.329, 0.1683, 0.625],
  },
  cyan: {
    bolt: [0.2427, 1.1997, 1.2885],
    bulwark: [0.315, 1.2343, 1.2932],
  },
  nestRim: {
    p1: [2.2296, 0.3416, 0.4885],
    p50: [2.2316, 0.3441, 0.5159],
    halfWarm: 0.9831,
  },
  failure: {
    p50: [2.4625, 0.1509, 0.5096],
    halfWarm: 0.9957,
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
    // At the locked defaults the heart's bluest texel sits 0.140 under the edge where warmth starts to fall, and the
    // nest's least blue seam 0.015 over the edge where it is gone. Renderer v1's key left the nest 0.032 over it; the
    // locked amber key at 6.6 warms the seams toward the edge. The GPU shows what that narrower gap does at the four
    // preset cameras (the M0 lock, 2026-09-28, RTX 4080 laptop, high and low tiers): no nest seam pixel the bloom feeds
    // tests half warm; the least blue 1 percent of the fed seam pixels reach 0.33 of their peak at the strategic camera
    // (0.32 on low), where 7 of 132 fed pixels on high (3 of 122 on low) take a trace of the heart's strength, warmth
    // times mask summing to 0.2 pixels, and the halo they add is at most 1.0 luma on high and 1.9 on low (the frame
    // against one whose warm ramp is narrowed to 0.12 to 0.15, which keeps the heart crystal warm). A palette, asset or
    // lighting change reaches these texels only through the generator, which the first test makes someone run, so a
    // change that closes either gap further fails here.
    expect(bluePerPeak(HEART.p1)).toBeCloseTo(0.037, 3);
    expect(bluePerPeak(HEART.p99)).toBeCloseTo(0.06, 3);
    expect(bluePerPeak(NEST.p1)).toBeCloseTo(0.365, 3);
    expect(bluePerPeak(NEST.p99)).toBeCloseTo(0.47, 3);
    expect(WARM_BLUE_FULL - bluePerPeak(HEART.p99)).toBeGreaterThan(0.12);
    expect(bluePerPeak(NEST.p1) - WARM_BLUE_NONE).toBeGreaterThan(0.01);
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

  it('documents that a silhouette rim at the locked defaults warms the nest seams in this model, which no preset camera shows', () => {
    // Under renderer v1's key the rim moved the seams toward warm without making any of them half warm. Under the locked
    // key it takes their median to 0.231 of its peak, 0.89 warm, and puts 98.3 percent of them at least half warm, as the
    // art preset's key and rim did: in this model the failure below is reachable at the defaults. The model's rim is
    // every seam texel on a silhouette facing 0.9 away from the camera with the key on it, which the preset cameras do not
    // frame: on the GPU at the locked defaults (high and low tiers) no nest seam pixel the bloom feeds tests half warm at
    // any of the four (see the margins above). This test used to hold halfWarm at 0; it now holds the model's figure, so
    // a change that warms the seams further, or the fix below, shows here.
    expect(GENERATED.nestRim.halfWarm).toBeCloseTo(0.983, 3);
    expect(bluePerPeak(GENERATED.nestRim.p50)).toBeCloseTo(0.231, 3);
    expect(warmth(GENERATED.nestRim.p1)).toBeGreaterThan(0.5);
    expect(warmth(GENERATED.nestRim.p50)).toBeGreaterThan(0.5);
  });

  it('documents the known failure: a strong orange key and a rim warm the nest seams', () => {
    // The nest's median seam texel under a sunColor of #ff8844 at intensity 8 with a silhouette rim: its blue falls to
    // 0.207 of its peak and it tests almost wholly warm, and 99.6 percent of the seams test at least half warm, so they
    // take most of the heart's strength (89.5 percent under renderer v1's other dials). Deciding warmth in painted.ts
    // from the emitter's own colour would end it and the rim case above; both should then read 0.
    expect(bluePerPeak(GENERATED.failure.p50)).toBeCloseTo(0.207, 3);
    expect(warmth(GENERATED.failure.p50)).toBeGreaterThan(0.5);
    expect(GENERATED.failure.halfWarm).toBeCloseTo(0.996, 3);
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
