import { Color, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIALS, type RenderDials } from '../../../src/render/defaults';
import {
  AUTHORED_CHARACTER_BLEND,
  createPaintedMaterial,
  createPaintUniforms,
  SKIN_BAND_SOFTNESS,
  SKIN_PROP_BRUSH,
  SKIN_STANDARD_BLEND,
  SKIN_TERMINATOR_NOISE,
} from '../../../src/render/materials/painted';
import { VERDANT } from '../../../src/render/themes';

// Only the GPU runs the shader, so its skin lines are held twice: as text, so an edit to any of them fails here, and as
// the same arithmetic in JavaScript, so the properties they must keep are checked. The GPU frames of a sphere face in the
// locked look, and the weight-0 frames that match no skin bit for bit, are in docs/blueprint.md (Render constants).
const shared = createPaintUniforms(VERDANT, DEFAULT_DIALS, new Texture());
const skinned = createPaintedMaterial(shared, { map: new Texture(), standardBlend: AUTHORED_CHARACTER_BLEND, skin: true });
const plain = createPaintedMaterial(shared, { map: new Texture(), standardBlend: AUTHORED_CHARACTER_BLEND });

// Each skin line, and the dial line it replaces, which every material without the weight still compiles.
const PAIRS = [
  ['albedo *= 1.0 + (brush - 0.5) * mix(uPropBrush, SKIN_PROP_BRUSH, skin);', 'albedo *= 1.0 + (brush - 0.5) * uPropBrush;'],
  [
    'float lit = clamp(mix(stepped, lambert, mix(clamp(uStandardBlend * uStandardBlendScale, 0.0, 1.0), SKIN_STANDARD_BLEND, skin)), 0.0, 1.0);',
    'float lit = clamp(mix(stepped, lambert, clamp(uStandardBlend * uStandardBlendScale, 0.0, 1.0)), 0.0, 1.0);',
  ],
] as const;
const LERPS = ['breakup = mix(breakup, SKIN_TERMINATOR_NOISE, skin);', 'softness = mix(softness, SKIN_BAND_SOFTNESS, skin);'];

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
// GLSL's mix, which takes its first argument exactly at a weight of 0.
const mix = (a: number, b: number, t: number): number => a * (1 - t) + b * t;

/**
 * One pixel of a character's skin (Bulwark's authored blend, a warm skin albedo) facing the camera, lit through the
 * lines above: brush is the atlas sample, which strokes the albedo and breaks the terminator; no cast shadow, rim or
 * emission, since the property checked is the key's own ramp.
 */
function shade(d: RenderDials, skin: number, ndl: number, brush = 0.5): number {
  const albedo0: Rgb = [0.8, 0.52, 0.4];
  const albedo = albedo0.map((c) => c * (1 + (brush - 0.5) * mix(d.propBrush, SKIN_PROP_BRUSH, skin))) as Rgb;
  const breakup = mix(d.terminatorNoise, SKIN_TERMINATOR_NOISE, skin);
  const t = ndl + (brush - 0.5) * 2 * breakup;
  const x = clamp(t * (d.bands - 1) + 0.5, 0, d.bands - 1);
  const softness = mix(d.bandSoftness, SKIN_BAND_SOFTNESS, skin);
  const stepped = (Math.floor(x) + smoothstep(0.5 - softness, 0.5 + softness, x - Math.floor(x))) / (d.bands - 1);
  const lambert = Math.max(ndl, 0);
  const blend = mix(clamp(AUTHORED_CHARACTER_BLEND * (d.standardBlend / AUTHORED_CHARACTER_BLEND), 0, 1), SKIN_STANDARD_BLEND, skin);
  const lit = clamp(mix(stepped, lambert, blend), 0, 1);
  const sun = linear(d.sunColor).map((c) => (c * d.sunIntensity) / Math.PI) as Rgb;
  const tint = linear(d.shadowTint).map((c) => c * d.shadowDepth) as Rgb;
  const ground = linear(VERDANT.ambient.ground);
  const sky = linear(VERDANT.ambient.sky);
  const hemisphere = ground.map((g, i) => g + (sky[i]! - g) * 0.5) as Rgb;
  return luminance(
    [0, 1, 2].map((i) => {
      const direct = tint[i]! + (sun[i]! - tint[i]!) * lit;
      // Facing the camera, the actor fill is whole, and it gives way to the key by the smooth key.
      return albedo[i]! * (direct + hemisphere[i]! * d.ambientStrength) + albedo[i]! * hemisphere[i]! * d.actorFill * (1 - lambert);
    }) as Rgb,
  );
}

/** The largest luminance change over any 0.04 of ndl near the terminator, and the smallest slope there. */
function terminator(d: RenderDials, skin: number): { step: number; slope: number } {
  let step = 0;
  let slope = Infinity;
  for (let n = -0.6; n <= 0.6; n += 0.005) {
    const change = shade(d, skin, n + 0.02) - shade(d, skin, n - 0.02);
    step = Math.max(step, Math.abs(change));
    slope = Math.min(slope, change / 0.04);
  }
  return { step, slope };
}

describe('soft light on skin', () => {
  it('turns on only for a material made for a skin weight, with every skin value a float literal', () => {
    expect(skinned.defines['PAINT_SKIN']).toBe('');
    expect(plain.defines['PAINT_SKIN']).toBeUndefined();
    const values = { SKIN_BAND_SOFTNESS, SKIN_TERMINATOR_NOISE, SKIN_STANDARD_BLEND, SKIN_PROP_BRUSH };
    for (const [name, value] of Object.entries(values)) {
      expect(skinned.defines[name], name).toMatch(/^\d+\.\d+$/);
      expect(Number(skinned.defines[name]), name).toBe(value);
      expect(plain.defines[name], name).toBeUndefined();
    }
    expect(skinned.vertexShader).toContain('#ifdef PAINT_SKIN\n  attribute float skinMask;\n  varying float vSkin;\n#endif');
    expect(skinned.vertexShader).toContain('vSkin = skinMask;');
  });

  it('lerps each value by the weight inside the skin define, and keeps the dial line itself in its #else', () => {
    const f = skinned.fragmentShader;
    expect(f).toContain('float skin = clamp(vSkin, 0.0, 1.0);');
    for (const [skin, dial] of PAIRS) {
      const at = f.indexOf(skin);
      expect(at, skin).toBeGreaterThan(-1);
      // The skin line opens its own #ifdef PAINT_SKIN, and the original line follows in the #else, unchanged.
      expect(f.lastIndexOf('#ifdef PAINT_SKIN', at)).toBeGreaterThan(f.lastIndexOf('#endif', at));
      const rest = f.slice(at + skin.length);
      expect(rest.trimStart().startsWith('#else')).toBe(true);
      expect(rest.slice(rest.indexOf('#else') + 5).trimStart().startsWith(dial)).toBe(true);
    }
    for (const lerp of LERPS) {
      const at = f.indexOf(lerp);
      expect(at, lerp).toBeGreaterThan(-1);
      expect(f.lastIndexOf('#ifdef PAINT_SKIN', at)).toBeGreaterThan(f.lastIndexOf('#endif', at));
    }
    // The weight is read before any lerp uses it, and each lerp lands before the line that reads its value.
    expect(f.indexOf('float skin = clamp(vSkin, 0.0, 1.0);')).toBeLessThan(f.indexOf(PAIRS[0][0]));
    expect(f.indexOf(LERPS[0]!)).toBeLessThan(f.indexOf('float t = ndl + (brush - 0.5) * 2.0 * breakup;'));
    expect(f.indexOf(LERPS[1]!)).toBeLessThan(f.indexOf('float stepped = '));
  });

  it('takes every dial exactly at a weight of 0, whatever the brush and the light', () => {
    // The dial lines alone, as every material without the weight runs them: no mix anywhere.
    const d = DEFAULT_DIALS;
    const dials = (ndl: number, brush: number): number => {
      const albedo = ([0.8, 0.52, 0.4] as Rgb).map((c) => c * (1 + (brush - 0.5) * d.propBrush)) as Rgb;
      const x = clamp(ndl + (brush - 0.5) * 2 * d.terminatorNoise + 0.5, 0, 1);
      const stepped = Math.floor(x) + smoothstep(0.5 - d.bandSoftness, 0.5 + d.bandSoftness, x - Math.floor(x));
      const lambert = Math.max(ndl, 0);
      const lit = clamp(mix(stepped, lambert, clamp(AUTHORED_CHARACTER_BLEND * (d.standardBlend / AUTHORED_CHARACTER_BLEND), 0, 1)), 0, 1);
      const sun = linear(d.sunColor).map((c) => (c * d.sunIntensity) / Math.PI) as Rgb;
      const tint = linear(d.shadowTint).map((c) => c * d.shadowDepth) as Rgb;
      const ground = linear(VERDANT.ambient.ground);
      const sky = linear(VERDANT.ambient.sky);
      const hemisphere = ground.map((g, i) => g + (sky[i]! - g) * 0.5) as Rgb;
      return luminance([0, 1, 2].map((i) => albedo[i]! * (tint[i]! + (sun[i]! - tint[i]!) * lit + hemisphere[i]! * d.ambientStrength) + albedo[i]! * hemisphere[i]! * d.actorFill * (1 - lambert)) as Rgb);
    };
    expect(d.bands).toBe(2);
    for (const brush of [0.1, 0.29, 0.5, 0.71, 0.9]) {
      for (let ndl = -1; ndl <= 1; ndl += 0.01) expect(shade(d, 0, ndl, brush)).toBe(dials(ndl, brush));
    }
  });

  it('softens the locked key\'s terminator over ten-fold on a face at weight 1, with no dip and no brush in it', () => {
    const cel = terminator(DEFAULT_DIALS, 0);
    const skin = terminator(DEFAULT_DIALS, 1);
    // The largest change over 0.04 of ndl: 0.344 of linear luminance on the cel bands, 0.029 on skin.
    expect(cel.step).toBeCloseTo(0.344, 3);
    expect(skin.step).toBeCloseTo(0.029, 3);
    expect(skin.step).toBeLessThan(cel.step / 10);
    // Luminance never falls as the face turns toward the key, so no darker sliver sits inside the ramp.
    expect(skin.slope).toBeGreaterThanOrEqual(0);
    // The brush strokes and breaks the cel terminator by 0.41 of luminance across the atlas's 5th to 95th percentiles,
    // and reaches skin not at all.
    expect(Math.abs(shade(DEFAULT_DIALS, 0, 0.1, 0.71) - shade(DEFAULT_DIALS, 0, 0.1, 0.29))).toBeGreaterThan(0.4);
    expect(shade(DEFAULT_DIALS, 1, 0.1, 0.71)).toBe(shade(DEFAULT_DIALS, 1, 0.1, 0.29));
    // A gentle gradient: from the flat shadow through the terminator's middle to the lit side.
    const [shadow, middle, lit] = [-0.5, 0, 1].map((n) => shade(DEFAULT_DIALS, 1, n));
    expect(middle).toBeGreaterThan(shadow! + 0.1);
    expect(lit).toBeGreaterThan(middle! + 0.2);
  });

  it('keeps its band ramp continuous at every band count the dial allows, which caps the softness at half a band', () => {
    expect(SKIN_BAND_SOFTNESS).toBeLessThanOrEqual(0.5);
    for (let bands = 2; bands <= 5; bands++) {
      const stepped = (x: number) => (Math.floor(x) + smoothstep(0.5 - SKIN_BAND_SOFTNESS, 0.5 + SKIN_BAND_SOFTNESS, x - Math.floor(x))) / (bands - 1);
      for (let edge = 1; edge < bands - 1; edge++) expect(stepped(edge) - stepped(edge - 1e-9)).toBeLessThan(1e-6);
    }
    // Past half a band the ramp would step at every band's top: at 0.6, by 0.039 of a band.
    const wide = (x: number) => Math.floor(x) + smoothstep(-0.1, 1.1, x - Math.floor(x));
    expect(wide(1) - wide(1 - 1e-9)).toBeGreaterThan(0.02);
  });
});
