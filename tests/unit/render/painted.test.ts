import { Color, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIALS, NUMERIC_RANGES, type RenderDials } from '../../../src/render/defaults';
import {
  applyPaintDials,
  AUTHORED_CHARACTER_BLEND,
  createPaintedMaterial,
  createPaintUniforms,
  DEFAULT_STANDARD_BLEND,
  EMISSIVE_KEY_RANGE,
  EMISSIVE_PEAK,
  isActorBlend,
  shadowLiftColor,
  SOIL_EDGE_GAIN,
  SOIL_EDGE_SOFTNESS,
  TERMINATOR_BAND_TILES,
} from '../../../src/render/materials/painted';
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
      shadowLift: 0.047,
      ambientStrength: 0.93,
      rimStrength: 1.14,
      rimPower: 5.6,
      paintStrength: 0.41,
      saturation: 0.72,
      terrainBrush: 1.27,
      propBrush: 0.88,
      soilBreakup: 0.64,
      litSaturation: 0.77,
      actorFill: 1.31,
      standardBlend: 0.56,
      sunColor: '#ff8844',
    };
    const reaches = [
      ['brushScale', 'uBrushScale', changed.brushScale],
      ['terminatorNoise', 'uTerminatorNoise', changed.terminatorNoise],
      ['bands', 'uBands', changed.bands],
      ['bandSoftness', 'uBandSoftness', changed.bandSoftness],
      ['shadowDepth', 'uShadowDepth', changed.shadowDepth],
      ['shadowLift', 'uShadowLift', changed.shadowLift],
      ['ambientStrength', 'uAmbientStrength', changed.ambientStrength],
      ['rimStrength', 'uRimStrength', changed.rimStrength],
      ['rimPower', 'uRimPower', changed.rimPower],
      ['paintStrength', 'uPaintStrength', changed.paintStrength],
      ['saturation', 'uSaturation', changed.saturation],
      ['terrainBrush', 'uTerrainBrush', changed.terrainBrush],
      ['propBrush', 'uPropBrush', changed.propBrush],
      ['soilBreakup', 'uSoilBreakup', changed.soilBreakup],
      ['litSaturation', 'uLitSaturation', changed.litSaturation],
      ['actorFill', 'uActorFill', changed.actorFill],
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
    // The rim is sunlight at a grazing angle, so it takes the sun colour dial, whose default is the theme's sun.
    expect(created.uRimColor.value.getHexString()).toBe('ff8844');
    expect(applied.uRimColor.value.getHexString()).toBe('ff8844');
    expect(createPaintUniforms(VERDANT, DEFAULT_DIALS, null).uRimColor.value.getHexString()).toBe(VERDANT.sun.color.slice(1));
    // Both paths above use VERDANT, so the theme-driven lines need a theme switch of their own to show. A theme's own
    // sun colour no longer reaches the rim: the dial does.
    const dusk = {
      ...VERDANT,
      sun: { ...VERDANT.sun, color: '#ff9a6a' },
      ambient: { sky: '#7f95c8', ground: '#5c4a6e' },
      grade: { ...VERDANT.grade, shadows: '#6fa3b0' },
    };
    expect(created.uShadowLiftColor.value.equals(shadowLiftColor(VERDANT))).toBe(true);
    applyPaintDials(applied, changed, dusk);
    expect(applied.uShadowLiftColor.value.equals(shadowLiftColor(dusk))).toBe(true);
    expect(applied.uAmbientSky.value.getHexString()).toBe('7f95c8');
    expect(applied.uAmbientGround.value.getHexString()).toBe('5c4a6e');
    expect(applied.uRimColor.value.getHexString()).toBe('ff8844');
    const fresh = createPaintUniforms(dusk, changed, null);
    expect(fresh.uAmbientSky.value.getHexString()).toBe('7f95c8');
    expect(fresh.uAmbientGround.value.getHexString()).toBe('5c4a6e');
    expect(fresh.uRimColor.value.getHexString()).toBe('ff8844');
    expect(fresh.uShadowLiftColor.value.equals(shadowLiftColor(dusk))).toBe(true);
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

describe('the emissive key and cap', () => {
  const shared = createPaintUniforms(VERDANT, DEFAULT_DIALS, null);
  // Only the GPU runs the shader, so these hold the lines that carry the behaviour.
  const { fragmentShader } = createPaintedMaterial(shared, { emissiveMap: new Texture() });

  it('writes the brightest emissive channel, before the cap, into alpha as the bloom key', () => {
    // Both the map path and the colour-only path build the one emissive the key reads.
    expect(fragmentShader.match(/vec3 emissive = /g)).toHaveLength(2);
    expect(fragmentShader).toContain('float emissiveKey = max(emissive.r, max(emissive.g, emissive.b));');
    expect(fragmentShader).toContain('gl_FragColor = vec4(color, emissiveKey / EMISSIVE_KEY_RANGE);');
    // The cap scales what is added and leaves the key alone, so the threshold dial keeps its whole range.
    expect(fragmentShader).not.toMatch(/emissiveKey\s*=\s*min|emissive\s*\*=|emissive\s*=\s*emissive/);
    expect(fragmentShader).not.toContain('vec4(color, 1.0)');
  });

  it('caps the emissive light it adds with one factor on all three channels, which keeps the hue', () => {
    expect(fragmentShader).toContain('color += emissive * min(1.0, EMISSIVE_PEAK / max(emissiveKey, 1e-4));');
  });

  it('hands both constants to GLSL as float literals', () => {
    // GLSL ES 3.0 has no implicit int to float conversion, so "4" would not compile in the divide.
    for (const material of [createPaintedMaterial(shared, {}), createPaintedMaterial(shared, { terrain: true })]) {
      expect(material.defines['EMISSIVE_PEAK']).toMatch(/^\d+\.\d+$/);
      expect(material.defines['EMISSIVE_KEY_RANGE']).toMatch(/^\d+\.\d+$/);
      expect(Number(material.defines['EMISSIVE_PEAK'])).toBe(EMISSIVE_PEAK);
      expect(Number(material.defines['EMISSIVE_KEY_RANGE'])).toBe(EMISSIVE_KEY_RANGE);
    }
  });

  it('keeps anything created without an emissive colour out of the bloom', () => {
    // Terrain and plain props get a black emissive, so their key is 0: decoration does not emit.
    for (const material of [createPaintedMaterial(shared, { terrain: true }), createPaintedMaterial(shared, { baseColor: new Color('#ffffff') })]) {
      expect((material.uniforms['uEmissiveColor']!.value as Color).getHex()).toBe(0);
    }
  });
});

describe('the soil edge', () => {
  const shared = createPaintUniforms(VERDANT, DEFAULT_DIALS, null);
  const soil = createPaintedMaterial(shared, { terrain: true, vertexColors: true, soilColor: new Color('#8a6a4a') });

  it('turns on only for a material given a soil colour, so no other mesh reads a soilWeight it lacks', () => {
    expect(soil.defines['PAINT_SOIL']).toBe('');
    expect((soil.uniforms['uSoilColor']!.value as Color).getHexString()).toBe('8a6a4a');
    for (const material of [createPaintedMaterial(shared, { terrain: true }), createPaintedMaterial(shared, { map: new Texture() })]) {
      expect(material.defines['PAINT_SOIL']).toBeUndefined();
    }
    expect(soil.vertexShader).toContain('#ifdef PAINT_SOIL\n  attribute float soilWeight;\n  varying float vSoil;\n#endif');
    expect(soil.vertexShader).toContain('vSoil = soilWeight;');
  });

  it('hands its constants to GLSL as float literals', () => {
    expect(soil.defines['SOIL_EDGE_GAIN']).toMatch(/^\d+\.\d+$/);
    expect(Number(soil.defines['SOIL_EDGE_GAIN'])).toBe(SOIL_EDGE_GAIN);
    expect(soil.defines['SOIL_EDGE_SOFTNESS']).toMatch(/^\d+\.\d+$/);
    expect(Number(soil.defines['SOIL_EDGE_SOFTNESS'])).toBe(SOIL_EDGE_SOFTNESS);
  });

  it('thresholds the soil weight against the brush, and at a breakup of 0 mixes by the weight alone, as the vertex colour did', () => {
    expect(DEFAULT_DIALS.soilBreakup).toBe(0);
    const f = soil.fragmentShader;
    expect(f).toContain('float soilEdge = clamp(0.5 + (brush - 0.5) * SOIL_EDGE_GAIN, SOIL_EDGE_SOFTNESS + 0.01, 0.99 - SOIL_EDGE_SOFTNESS);');
    expect(f).toContain('float soil = mix(vSoil, smoothstep(soilEdge - SOIL_EDGE_SOFTNESS, soilEdge + SOIL_EDGE_SOFTNESS, vSoil), uSoilBreakup);');
    expect(f).toContain('albedo = mix(albedo, uBaseColor * uSoilColor, soil);');
    // Mixed before the terrain brush and the saturation dial, where the vertex colour it replaces came in.
    expect(f.indexOf('albedo = mix(albedo, uBaseColor * uSoilColor, soil);')).toBeLessThan(f.indexOf('albedo *= 1.0 + (brush - 0.5) * uTerrainBrush;'));
    expect(f.indexOf('albedo = mix(albedo, uBaseColor * uSoilColor, soil);')).toBeLessThan(f.indexOf('albedo = withSaturation(albedo, uSaturation);'));
  });
});

describe('the look dials in the painted shader', () => {
  const shared = createPaintUniforms(VERDANT, DEFAULT_DIALS, null);
  const prop = createPaintedMaterial(shared, { map: new Texture(), standardBlend: 0.35 });
  const terrain = createPaintedMaterial(shared, { terrain: true, vertexColors: true, standardBlend: 0, soilColor: new Color('#8a6a4a') });
  const kit = createPaintedMaterial(shared, { map: new Texture(), standardBlend: 0 });
  // Only the GPU runs the shader, so these hold the lines that carry each behaviour and where they sit.
  const f = prop.fragmentShader;
  const at = (line: string): number => {
    const index = f.indexOf(line);
    expect(index, line).toBeGreaterThan(-1);
    return index;
  };

  it('start at the look they were added to: no prop brush, full lit saturation, no actor fill, no shadow lift', () => {
    expect(DEFAULT_DIALS.propBrush).toBe(0);
    expect(DEFAULT_DIALS.litSaturation).toBe(1);
    expect(DEFAULT_DIALS.actorFill).toBe(0);
    expect(DEFAULT_DIALS.shadowLift).toBe(0);
  });

  it("lifts the shadow band toward the theme's shadow grade colour at unit luminance, on every painted surface", () => {
    const colour = shadowLiftColor(VERDANT);
    expect(0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b).toBeCloseTo(1, 6);
    // The hue survives the scaling: every channel keeps its ratio to the others.
    const source = new Color(VERDANT.grade.shadows);
    expect(colour.g / colour.r).toBeCloseTo(source.g / source.r, 6);
    expect(colour.b / colour.r).toBeCloseTo(source.b / source.r, 6);
    expect(shadowLiftColor({ ...VERDANT, grade: { ...VERDANT.grade, shadows: '#000000' } }).getHex()).toBe(0xffffff);
    const line = 'color += uShadowLiftColor * uShadowLift * (1.0 - lit) * spare;';
    for (const material of [prop, terrain, kit]) expect(material.fragmentShader).toContain(line);
    // After the key, ambient and fill light the colour, and before the lit saturation restrains it.
    expect(at('vec3 color = albedo * (direct + ambient);')).toBeLessThan(at(line));
    expect(at(line)).toBeLessThan(at('if (restraint != 1.0) color = withSaturation(color, restraint);'));
  });

  it('strokes the albedo of everything but the terrain with the prop brush, in the terrain brush branch\'s else', () => {
    expect(f).toContain('#ifdef PAINT_TERRAIN\n    albedo *= 1.0 + (brush - 0.5) * uTerrainBrush;\n  #else');
    expect(f).toContain('albedo *= 1.0 + (brush - 0.5) * uPropBrush;');
    // Before the saturation dial, as the terrain brush is, so both brushes feed the same albedo.
    expect(at('albedo *= 1.0 + (brush - 0.5) * uPropBrush;')).toBeLessThan(at('albedo = withSaturation(albedo, uSaturation);'));
  });

  it('marks actors by their authored standard blend, so terrain and the Verdant kit take no fill', () => {
    expect(isActorBlend(0.35, false)).toBe(true);
    expect(isActorBlend(0.1, false)).toBe(true);
    expect(isActorBlend(0, false)).toBe(false);
    expect(isActorBlend(0.35, true)).toBe(false);
    expect(DEFAULT_STANDARD_BLEND).toBe(0.1);
    expect(prop.defines['PAINT_ACTOR']).toBe('');
    expect(terrain.defines['PAINT_ACTOR']).toBeUndefined();
    expect(kit.defines['PAINT_ACTOR']).toBeUndefined();
    // A material created without a blend is a prop at 0.1, as before, and so an actor.
    const unnamed = createPaintedMaterial(shared, {});
    expect(unnamed.uniforms['uStandardBlend']!.value).toBe(DEFAULT_STANDARD_BLEND);
    expect(unnamed.defines['PAINT_ACTOR']).toBe('');
  });

  it('adds the actor fill from the camera side, in the hemisphere colour, only where the key does not light', () => {
    expect(f).toContain('vec3 hemisphere = mix(uAmbientGround, uAmbientSky, dot(worldN, uUp) * 0.5 + 0.5);');
    expect(f).toContain('vec3 ambient = hemisphere * uAmbientStrength;');
    expect(f).toContain('#ifdef PAINT_ACTOR\n');
    // Weighted by the authored blend against the character's: Bulwark takes it all, a 0.1 structure 0.29 of it.
    expect(f).toContain('float actorWeight = clamp(uStandardBlend / AUTHORED_CHARACTER_BLEND, 0.0, 1.0);');
    expect(f).toContain('color += albedo * hemisphere * uActorFill * actorWeight * clamp(dot(N, V), 0.0, 1.0) * (1.0 - lit) * spare;');
    expect(prop.defines['AUTHORED_CHARACTER_BLEND']).toMatch(/^\d+\.\d+$/);
    expect(Number(prop.defines['AUTHORED_CHARACTER_BLEND'])).toBe(AUTHORED_CHARACTER_BLEND);
    expect(AUTHORED_CHARACTER_BLEND).toBe(0.35);
    expect(terrain.defines['AUTHORED_CHARACTER_BLEND']).toBeUndefined();
    // After the key and ambient light the colour, before the rim and the lit saturation.
    expect(at('vec3 color = albedo * (direct + ambient);')).toBeLessThan(at('color += albedo * hemisphere * uActorFill'));
    expect(at('color += albedo * hemisphere * uActorFill')).toBeLessThan(at('float facing = 1.0 - clamp(dot(N, V), 0.0, 1.0);'));
  });

  it('restrains lit colour after the rim and before any emitter adds its light, and skips the work at 1', () => {
    const line = 'if (restraint != 1.0) color = withSaturation(color, restraint);';
    expect(f).toContain('float restraint = mix(1.0, uLitSaturation, spare);');
    expect(f).toContain(line);
    expect(at('color += pow(facing, uRimPower)')).toBeLessThan(at(line));
    expect(at(line)).toBeLessThan(at('color += emissive * min(1.0, EMISSIVE_PEAK / max(emissiveKey, 1e-4));'));
    // Terrain and the kit restrain their lit colour too: the dial is for the meadow above all.
    expect(terrain.fragmentShader).toContain(line);
  });

  it("spares emitting pixels from the fill, the lift and the restraint, fading in over the emissive key's first unit", () => {
    expect(f).toContain('float spare = 1.0 - clamp(emissiveKey, 0.0, 1.0);');
    // The key is known before any of the three reads it, and each of the three reads it.
    expect(at('float spare = 1.0 - clamp(emissiveKey, 0.0, 1.0);')).toBeLessThan(at('vec3 color = albedo * (direct + ambient);'));
    for (const use of ['clamp(dot(N, V), 0.0, 1.0) * (1.0 - lit) * spare;', 'uShadowLift * (1.0 - lit) * spare;', 'mix(1.0, uLitSaturation, spare)']) {
      expect(f, use).toContain(use);
    }
    // The bloom still reads the key it always did, and the emission is still added last.
    expect(at('float emissiveKey = max(emissive.r, max(emissive.g, emissive.b));')).toBeLessThan(at('float spare'));
    expect(at('if (restraint != 1.0)')).toBeLessThan(at('color += emissive * min(1.0, EMISSIVE_PEAK / max(emissiveKey, 1e-4));'));
  });

  it('caps the terrain terminator\'s break-up by the rate ndl changes, near the terminator only', () => {
    expect(terrain.defines['TERMINATOR_BAND_TILES']).toMatch(/^\d+\.\d+$/);
    expect(Number(terrain.defines['TERMINATOR_BAND_TILES'])).toBe(TERMINATOR_BAND_TILES);
    expect(prop.defines['TERMINATOR_BAND_TILES']).toBeUndefined();
    const t = terrain.fragmentShader;
    expect(t).toContain('abs(dFdx(ndl)) / max(length(dFdx(vBrushPos)), 1e-5)');
    expect(t).toContain('abs(dFdy(ndl)) / max(length(dFdy(vBrushPos)), 1e-5)');
    // At a noise of 0 the edges would be equal, which GLSL leaves undefined.
    expect(t).toContain('float reach = max(uTerminatorNoise, 1e-4);');
    expect(t).toContain('float nearTerminator = 1.0 - smoothstep(reach, 2.0 * reach, abs(ndl));');
    expect(t).toContain('breakup = mix(breakup, min(breakup, ndlRate * TERMINATOR_BAND_TILES / uBrushScale), nearTerminator);');
    expect(t).toContain('float t = ndl + (brush - 0.5) * 2.0 * breakup;');
    expect(t.indexOf('breakup = mix(breakup')).toBeLessThan(t.indexOf('float t = ndl + (brush - 0.5) * 2.0 * breakup;'));
    // The cap lives in the terrain branch alone; a prop's terminator breaks as the noise dial says.
    const capStart = t.lastIndexOf('#ifdef PAINT_TERRAIN', t.indexOf('float ndlRate'));
    expect(t.slice(capStart, t.indexOf('float t = ndl'))).toContain('#endif');
  });
});
