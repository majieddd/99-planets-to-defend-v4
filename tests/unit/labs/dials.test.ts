import { describe, expect, it } from 'vitest';
import { GROUPS, isColorDial } from '../../../src/labs/style/dials';
import { COLOR_DIALS, DEFAULT_DIALS, type RenderDials } from '../../../src/render/defaults';

describe('dials panel', () => {
  it('puts every dial in exactly one folder', () => {
    // A dial missing from the folders exists in links but never on screen, so the owner could not move it.
    const listed = Object.values(GROUPS).flat();
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(Object.keys(DEFAULT_DIALS).sort());
  });

  it('files the sun under Light, the height fog under Atmosphere, the halos under Post and the soil under Paint', () => {
    expect(GROUPS['Light']).toEqual(['sunElevation', 'sunColor', 'sunIntensity', 'actorFill']);
    expect(GROUPS['Atmosphere']).toEqual(['fogDensity', 'fogStart', 'fogHeightFalloff']);
    expect(GROUPS['Post']).toEqual(expect.arrayContaining(['bloomIntensity', 'heartHalo', 'bloomThreshold']));
    expect(GROUPS['Paint']).toContain('soilBreakup');
  });

  it("files the look pass's dials where they act: brush, lift and lit colour under Paint, the fill under Light", () => {
    expect(GROUPS['Paint']).toEqual(expect.arrayContaining(['propBrush', 'litSaturation', 'shadowLift']));
    // The prop brush sits beside the terrain brush it mirrors, and the lift beside the shadow colour it floors.
    expect(GROUPS['Paint']!.indexOf('propBrush')).toBe(GROUPS['Paint']!.indexOf('terrainBrush') + 1);
    expect(GROUPS['Paint']!.indexOf('shadowLift')).toBe(GROUPS['Paint']!.indexOf('shadowTint') + 1);
    expect(GROUPS['Light']).toContain('actorFill');
  });

  it('builds a colour control for exactly the codec\'s colour dials', () => {
    // Hard-coded names handed sunColor to the numeric branch, whose range lookup found nothing and threw.
    const colours = (Object.keys(DEFAULT_DIALS) as (keyof RenderDials)[]).filter(isColorDial);
    expect(colours.sort()).toEqual([...COLOR_DIALS].sort());
  });
});
