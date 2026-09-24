import { Color, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIALS, NUMERIC_RANGES, type RenderDials } from '../../../src/render/defaults';
import { applyPaintDials, createPaintedMaterial, createPaintUniforms } from '../../../src/render/materials/painted';
import { VERDANT } from '../../../src/render/themes';

describe('painted materials', () => {
  const shared = createPaintUniforms(VERDANT, DEFAULT_DIALS, new Texture());

  it('share one set of dial uniforms', () => {
    const a = createPaintedMaterial(shared, { map: new Texture() });
    const b = createPaintedMaterial(shared, { baseColor: new Color('#ff0000') });
    expect(a.uniforms['uBands']).toBe(b.uniforms['uBands']);
    applyPaintDials(shared, { ...DEFAULT_DIALS, bands: 4 }, VERDANT);
    expect(a.uniforms['uBands']!.value).toBe(4);
    expect(b.uniforms['uBands']!.value).toBe(4);
    // The standardBlend dial rescales every authored blend, so at the default each material keeps its authored value.
    expect(createPaintUniforms(VERDANT, DEFAULT_DIALS, null).uStandardBlendScale.value).toBe(1);
    applyPaintDials(shared, { ...DEFAULT_DIALS, standardBlend: 0.7 }, VERDANT);
    expect(a.uniforms['uStandardBlendScale']!.value).toBeCloseTo(2);
    expect(b.uniforms['uStandardBlendScale']!.value).toBeCloseTo(2);
    expect(a.uniforms['uStandardBlendScale']).toBe(b.uniforms['uStandardBlendScale']);

    // Every paint dial must reach its uniform at creation and on a live move. The values sit inside their ranges,
    // off their defaults and apart from each other, so a dropped or cross-wired line fails.
    const changed: RenderDials = {
      ...DEFAULT_DIALS,
      brushScale: 0.83,
      terminatorNoise: 0.27,
      bands: 4,
      bandSoftness: 0.18,
      shadowTint: '#7a3d5c',
      shadowDepth: 0.62,
      ambientStrength: 0.93,
      rimStrength: 1.14,
      rimPower: 5.6,
      paintStrength: 0.41,
      saturation: 0.72,
      terrainBrush: 1.27,
      standardBlend: 0.56,
    };
    const reaches = [
      ['brushScale', 'uBrushScale', changed.brushScale],
      ['terminatorNoise', 'uTerminatorNoise', changed.terminatorNoise],
      ['bands', 'uBands', changed.bands],
      ['bandSoftness', 'uBandSoftness', changed.bandSoftness],
      ['shadowDepth', 'uShadowDepth', changed.shadowDepth],
      ['ambientStrength', 'uAmbientStrength', changed.ambientStrength],
      ['rimStrength', 'uRimStrength', changed.rimStrength],
      ['rimPower', 'uRimPower', changed.rimPower],
      ['paintStrength', 'uPaintStrength', changed.paintStrength],
      ['saturation', 'uSaturation', changed.saturation],
      ['terrainBrush', 'uTerrainBrush', changed.terrainBrush],
      ['standardBlend', 'uStandardBlendScale', changed.standardBlend / 0.35],
    ] as const;
    expect(new Set(reaches.map(([, , value]) => value)).size).toBe(reaches.length);
    const created = createPaintUniforms(VERDANT, changed, null);
    const applied = createPaintUniforms(VERDANT, DEFAULT_DIALS, null);
    applyPaintDials(applied, changed, VERDANT);
    for (const [dial, uniform, value] of reaches) {
      const [min, max] = NUMERIC_RANGES[dial];
      expect(changed[dial], dial).not.toBe(DEFAULT_DIALS[dial]);
      expect(changed[dial], dial).toBeGreaterThanOrEqual(min);
      expect(changed[dial], dial).toBeLessThanOrEqual(max);
      expect(created[uniform].value, uniform).toBeCloseTo(value, 6);
      expect(applied[uniform].value, uniform).toBeCloseTo(value, 6);
    }
    expect(changed.shadowTint).not.toBe(DEFAULT_DIALS.shadowTint);
    expect(created.uShadowTint.value.getHexString()).toBe('7a3d5c');
    expect(applied.uShadowTint.value.getHexString()).toBe('7a3d5c');
    // Both paths above use VERDANT, so the theme-driven lines need a theme switch of their own to show.
    const dusk = {
      ...VERDANT,
      sun: { ...VERDANT.sun, color: '#ff9a6a' },
      ambient: { sky: '#7f95c8', ground: '#5c4a6e' },
    };
    applyPaintDials(applied, changed, dusk);
    expect(applied.uAmbientSky.value.getHexString()).toBe('7f95c8');
    expect(applied.uAmbientGround.value.getHexString()).toBe('5c4a6e');
    expect(applied.uRimColor.value.getHexString()).toBe('ff9a6a');
    const fresh = createPaintUniforms(dusk, changed, null);
    expect(fresh.uAmbientSky.value.getHexString()).toBe('7f95c8');
    expect(fresh.uAmbientGround.value.getHexString()).toBe('5c4a6e');
    expect(fresh.uRimColor.value.getHexString()).toBe('ff9a6a');
  });

  it('enable lights and choose features by define', () => {
    const terrain = createPaintedMaterial(shared, { terrain: true, vertexColors: true });
    const mapped = createPaintedMaterial(shared, { map: new Texture(), emissiveMap: new Texture() });
    expect(terrain.lights).toBe(true);
    expect(terrain.vertexColors).toBe(true);
    expect(terrain.defines['PAINT_TERRAIN']).toBe('');
    expect(mapped.defines['USE_PAINT_MAP']).toBe('');
    expect(mapped.defines['USE_PAINT_EMISSIVE']).toBe('');
    expect(mapped.uniforms['directionalLights']).toBeDefined();
    // three wires each lit material's light uniforms to the scene it renders, so shared ones would leak lights across
    // scenes (and, spread uncloned, would be three's global UniformsLib objects).
    expect(terrain.uniforms['directionalLights']).not.toBe(mapped.uniforms['directionalLights']);
    expect(terrain.uniforms['directionalLightShadows']).not.toBe(mapped.uniforms['directionalLightShadows']);
  });
});
