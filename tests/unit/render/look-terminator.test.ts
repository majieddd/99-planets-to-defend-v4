import { Color, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIALS, NUMERIC_RANGES, type RenderDials } from '../../../src/render/defaults';
import { AUTHORED_CHARACTER_BLEND, createPaintedMaterial, createPaintUniforms, shadowLiftColor } from '../../../src/render/materials/painted';
import { VERDANT } from '../../../src/render/themes';

// Only the GPU runs the shader, so this holds its lighting lines twice: as text, so an edit to any of them fails here,
// and as the same arithmetic in JavaScript, so the property those lines must keep (the key's step at the terminator
// stays positive whatever the fill and the lift do) is checked across the dials' whole ranges. The step is read in
// linear light, before the grade and AgX, which keep its sign.
const LINES = [
  'float x = clamp(t * (uBands - 1.0) + 0.5, 0.0, uBands - 1.0);',
  'float stepped = (floor(x) + smoothstep(0.5 - softness, 0.5 + softness, fract(x))) / (uBands - 1.0);',
  'float lambert = max(ndl, 0.0) * shadow;',
  'float lit = clamp(mix(stepped, lambert, clamp(uStandardBlend * uStandardBlendScale, 0.0, 1.0)), 0.0, 1.0);',
  'vec3 direct = mix(uShadowTint * uShadowDepth, sunColor, lit);',
  'vec3 hemisphere = mix(uAmbientGround, uAmbientSky, dot(worldN, uUp) * 0.5 + 0.5);',
  'vec3 ambient = hemisphere * uAmbientStrength;',
  'vec3 color = albedo * (direct + ambient);',
  'float actorWeight = clamp(uStandardBlend / AUTHORED_CHARACTER_BLEND, 0.0, 1.0);',
  'color += albedo * hemisphere * uActorFill * actorWeight * clamp(dot(N, V), 0.0, 1.0) * (1.0 - lambert) * spare;',
  'color += uShadowLiftColor * uShadowLift * (1.0 - lambert) * spare;',
  'color += pow(facing, uRimPower) * uRimStrength * smoothstep(-0.1, 0.4, ndl) * shadow * uRimColor * sunColor;',
  'sunColor = directionalLights[0].color * RECIPROCAL_PI;',
];

type Rgb = [number, number, number];
const linear = (hex: string): Rgb => {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
};
const luminance = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const clamp = (x: number, a: number, b: number): number => Math.min(Math.max(x, a), b);
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

interface Surface {
  albedo: number;
  /** dot(worldN, uUp) */
  up: number;
  /** dot(N, V) */
  facing: number;
  /** The authored standard blend; above 0 the material is an actor's (PAINT_ACTOR). */
  blend: number;
  rim: boolean;
}

type Weight = 'lambert' | 'lit';

/** LINES in JavaScript, for one pixel with no emission and no terminator noise, so t is ndl lowered by the shadow. */
function shade(d: RenderDials, s: Surface, ndl: number, shadow: number, weight: Weight = 'lambert'): Rgb {
  const t = Math.min(ndl, shadow * 2 - 1);
  const x = clamp(t * (d.bands - 1) + 0.5, 0, d.bands - 1);
  const f = x - Math.floor(x);
  const stepped = (Math.floor(x) + smoothstep(0.5 - d.bandSoftness, 0.5 + d.bandSoftness, f)) / (d.bands - 1);
  const lambert = Math.max(ndl, 0) * shadow;
  const lit = clamp(stepped + (lambert - stepped) * clamp(s.blend * (d.standardBlend / AUTHORED_CHARACTER_BLEND), 0, 1), 0, 1);
  const sunLinear = linear(d.sunColor);
  const sun = sunLinear.map((c) => (c * d.sunIntensity) / Math.PI) as Rgb;
  const tint = linear(d.shadowTint).map((c) => c * d.shadowDepth) as Rgb;
  const ground = linear(VERDANT.ambient.ground);
  const sky = linear(VERDANT.ambient.sky);
  const h = s.up * 0.5 + 0.5;
  const hemisphere = ground.map((g, i) => g + ((sky[i] as number) - g) * h) as Rgb;
  const lift = shadowLiftColor(VERDANT);
  const w = weight === 'lambert' ? 1 - lambert : 1 - lit;
  const actorWeight = clamp(s.blend / AUTHORED_CHARACTER_BLEND, 0, 1);
  const rim = s.rim && s.blend > 0 ? (1 - clamp(s.facing, 0, 1)) ** d.rimPower * d.rimStrength * smoothstep(-0.1, 0.4, ndl) * shadow : 0;
  return [0, 1, 2].map((i) => {
    const direct = (tint[i] as number) + ((sun[i] as number) - (tint[i] as number)) * lit;
    let c = s.albedo * (direct + (hemisphere[i] as number) * d.ambientStrength);
    if (s.blend > 0) c += s.albedo * (hemisphere[i] as number) * d.actorFill * actorWeight * clamp(s.facing, 0, 1) * w;
    c += [lift.r, lift.g, lift.b][i]! * d.shadowLift * w;
    return c + rim * (sunLinear[i] as number) * (sun[i] as number);
  }) as Rgb;
}

/** The luminance step across the terminator: just past the band ramp on each side, so it is the step and nothing else. */
function terminatorStep(d: RenderDials, s: Surface, weight: Weight = 'lambert'): number {
  const e = d.bandSoftness / (d.bands - 1) + 0.001;
  return luminance(shade(d, s, e, 1, weight)) - luminance(shade(d, s, -e, 1, weight));
}

// The locked key (Painted-Anime-Inkline 4.0, the M0 gate) is preset B3's: the owner's three adjustments (edgeStrength,
// edgeFadeFar, litSaturation) are not in these lines. Two other keys stay covered because the dials still reach them.
// The golden-hour key the fill and lift were built for (preset B2): B3's with a darker shadow band, a shadow depth of
// 0.5 against 0.62, and a little more ambient. The shadow band's direct light is the tint times the depth, so the higher
// depth leaves the smaller step at the terminator and the locked key is the harder of the two golden-hour keys (its
// worst step 0.0205 against B2's 0.0209); the ambient lights both sides alike and cancels out of the step.
const GOLDEN: RenderDials = {
  ...DEFAULT_DIALS,
  bands: 2,
  bandSoftness: 0.03,
  shadowDepth: 0.5,
  shadowTint: '#1b7078',
  rimStrength: 0.6,
  standardBlend: 0.45,
  ambientStrength: 0.24,
  sunColor: '#ffc05c',
  sunIntensity: 6.6,
};
// Renderer v1's key, the start the locked dials replaced: the Verdant theme's own light (35 degrees, which these lines
// do not read), three bands and a light teal shadow band, with no fill and no lift.
const V1: RenderDials = {
  ...DEFAULT_DIALS,
  bands: 3,
  bandSoftness: 0.06,
  shadowDepth: 0.35,
  shadowTint: '#2f8f8c',
  rimStrength: 0.35,
  rimPower: 3,
  standardBlend: 0.35,
  ambientStrength: 0.45,
  sunColor: VERDANT.sun.color,
  sunIntensity: VERDANT.sun.intensity,
  actorFill: 0,
  shadowLift: 0,
};
const KEYS: Record<string, RenderDials> = { locked: DEFAULT_DIALS, golden: GOLDEN, v1: V1 };
// Bulwark, the Husk, a tower (or the heart, or the nest) and the terrain, each as authored.
const BLENDS = { character: AUTHORED_CHARACTER_BLEND, husk: 0.3, structure: 0.1, terrain: 0 };
const ALBEDOS = [1, 0.3, 0.1, 0.04];
const [FILL_MIN, FILL_MAX] = NUMERIC_RANGES.actorFill;
const [LIFT_MIN, LIFT_MAX] = NUMERIC_RANGES.shadowLift;

function* surfaces(): Generator<Surface> {
  for (const albedo of ALBEDOS) for (const blend of Object.values(BLENDS)) for (const up of [-1, 0, 1]) for (const facing of [0.25, 0.5, 1]) for (const rim of [false, true]) yield { albedo, up, facing, blend, rim };
}

describe("the terminator's step under the actor fill and the shadow lift", () => {
  const f = createPaintedMaterial(createPaintUniforms(VERDANT, DEFAULT_DIALS, new Texture()), { standardBlend: 0.35 }).fragmentShader;

  it('models the lines the shader runs, so an edit to any of them fails here first', () => {
    for (const line of LINES) expect(f, line).toContain(line);
  });

  it("stays positive across both ranges, on white and dark albedo, for every painted material, at the locked key, B2's and renderer v1's", () => {
    // The step is linear in the fill and in the lift, so each range's ends and middle cover it.
    let worst = Infinity;
    for (const [name, key] of Object.entries(KEYS)) {
      for (const fill of [FILL_MIN, (FILL_MIN + FILL_MAX) / 2, FILL_MAX]) {
        for (const lift of [LIFT_MIN, (LIFT_MIN + LIFT_MAX) / 2, LIFT_MAX]) {
          const d = { ...key, actorFill: fill, shadowLift: lift };
          for (const s of surfaces()) {
            const step = terminatorStep(d, s);
            worst = Math.min(worst, step);
            expect(step, `${name}, fill ${fill}, lift ${lift}, ${JSON.stringify(s)}`).toBeGreaterThan(0);
          }
        }
      }
    }
    // The darkest albedo under the strongest fill and lift keeps a small but real step (0.003 in linear light).
    expect(worst).toBeGreaterThan(0.002);
  });

  it('leaves the step the key gives: the fill does not shrink it on camera-facing white', () => {
    const face: Surface = { albedo: 1, up: 0, facing: 1, blend: AUTHORED_CHARACTER_BLEND, rim: false };
    // At the locked key the step is 0.662 of linear luminance with no fill, 0.645 at the locked fill of 1.4 and 0.638 at
    // the dial's top; at renderer v1's key it was 0.212 with no fill.
    const bare = terminatorStep({ ...DEFAULT_DIALS, actorFill: 0 }, face);
    expect(bare).toBeCloseTo(0.662, 3);
    expect(terminatorStep(DEFAULT_DIALS, face)).toBeCloseTo(0.645, 3);
    expect(terminatorStep({ ...DEFAULT_DIALS, actorFill: FILL_MAX }, face)).toBeGreaterThan(0.95 * bare);
    const v1Bare = terminatorStep(V1, face);
    expect(v1Bare).toBeCloseTo(0.212, 3);
    // Only the smooth key's own slope across 0.031 of ndl to each side separates the two.
    expect(terminatorStep({ ...V1, actorFill: FILL_MAX }, face)).toBeGreaterThan(0.85 * v1Bare);
  });

  it("would have caught the banded weight: (1 - lit) flattens renderer v1's step by 1.6 and inverts it at 2, and halves the locked key's", () => {
    const face: Surface = { albedo: 1, up: 0, facing: 1, blend: AUTHORED_CHARACTER_BLEND, rim: false };
    expect(terminatorStep({ ...V1, actorFill: 1.6 }, face, 'lit')).toBeLessThan(0.01);
    expect(terminatorStep({ ...V1, actorFill: 2 }, face, 'lit')).toBeLessThan(0);
    // At the locked fill the banded weight would have left 0.358 of the locked key's step, the smooth weight keeps 0.645.
    expect(terminatorStep(DEFAULT_DIALS, face, 'lit')).toBeLessThan(0.6 * terminatorStep(DEFAULT_DIALS, face));
    // And the lift inverted it on dark albedo under either key, which the smooth weight does not.
    const dark: Surface = { albedo: 0.04, up: 0, facing: 1, blend: 0, rim: false };
    for (const key of [V1, DEFAULT_DIALS]) {
      expect(terminatorStep({ ...key, shadowLift: 0.06 }, dark, 'lit')).toBeLessThan(0);
      expect(terminatorStep({ ...key, shadowLift: 0.06 }, dark)).toBeGreaterThan(0);
    }
  });
});
