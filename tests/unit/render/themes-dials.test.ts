import { describe, expect, it } from 'vitest';
import { COLOR_DIALS, DEFAULT_DIALS, NUMERIC_RANGES } from '../../../src/render/defaults';
import { decodeDials, encodeDials } from '../../../src/render/dialsCodec';
import { sunDirection, VERDANT } from '../../../src/render/themes';

describe('VERDANT', () => {
  it('uses valid hex colours everywhere', () => {
    const hexes = JSON.stringify(VERDANT).match(/"#[^"]*"/g) ?? [];
    expect(hexes).toHaveLength(18);
    for (const hex of hexes) expect(hex).toMatch(/^"#[0-9a-fA-F]{6}"$/);
  });

  it('names hue bands inside 0 to 360', () => {
    for (const band of VERDANT.bands) {
      expect(band.hueMin).toBeGreaterThanOrEqual(0);
      expect(band.hueMax).toBeLessThanOrEqual(360);
    }
  });

  it('puts the sun above the horizon on a unit vector', () => {
    const [x, y, z] = sunDirection(VERDANT);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
    expect(y).toBeCloseTo(Math.sin((35 * Math.PI) / 180), 9);
  });
});

describe('dials', () => {
  const toLink = (json: string) => btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  it('keeps every numeric default inside its range', () => {
    for (const [key, range] of Object.entries(NUMERIC_RANGES)) {
      const value = DEFAULT_DIALS[key as keyof typeof DEFAULT_DIALS] as number;
      expect(value, key).toBeGreaterThanOrEqual(range[0]);
      expect(value, key).toBeLessThanOrEqual(range[1]);
    }
  });

  it('round-trips changed dials through the codec', () => {
    const changed = { ...DEFAULT_DIALS, inkWidthPx: 3.1, shadowTint: '#205060', bands: 4 };
    const text = encodeDials(changed);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeDials(text)).toEqual(changed);
    expect(encodeDials({ ...DEFAULT_DIALS, bands: 4 })).toBe('eyJiYW5kcyI6NH0');
    expect(decodeDials(toLink('{"bands":5,"exposure":0.2}'))).toEqual({ ...DEFAULT_DIALS, bands: 5, exposure: 0.2 });
  });

  it('encodes defaults as an empty object and ignores bad input', () => {
    expect(encodeDials(DEFAULT_DIALS)).toBe('e30');
    expect(decodeDials(encodeDials(DEFAULT_DIALS))).toEqual(DEFAULT_DIALS);
    expect(decodeDials('not base64 at all')).toEqual(DEFAULT_DIALS);
    const hostile = toLink(JSON.stringify({ bands: 'x', exposure: Number.NaN, unknown: 1, inkColor: 'red' }));
    expect(decodeDials(hostile)).toEqual(DEFAULT_DIALS);
    expect(decodeDials(toLink('{"bands":9,"edgeFadeFar":5,"grain":-0.1,"exposure":1e999,"inkColor":"#abc"}'))).toEqual(DEFAULT_DIALS);
    for (const json of ['null', '5', '"x"', '[1]']) expect(decodeDials(toLink(json))).toEqual(DEFAULT_DIALS);
  });

  it('gives every dial either a range or a colour, never both, and every colour default is six-digit hex', () => {
    // A dial with neither never reaches a link: the codec writes it but reads only ranged numbers and listed colours.
    for (const key of Object.keys(DEFAULT_DIALS) as (keyof typeof DEFAULT_DIALS)[]) {
      const ranged = key in NUMERIC_RANGES;
      const colour = (COLOR_DIALS as readonly string[]).includes(key);
      expect(ranged !== colour, key).toBe(true);
      if (colour) expect(DEFAULT_DIALS[key], key).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(COLOR_DIALS).toContain('sunColor');
  });

  it('round-trips the halo, height fog, sun and soil dials through a link', () => {
    // Off their defaults, inside their ranges; the colour is the only way a sun colour reaches a link.
    const changed = { ...DEFAULT_DIALS, heartHalo: 5.5, fogHeightFalloff: 0.2, sunElevation: 12.5, sunColor: '#ffaa55', sunIntensity: 2.4, soilBreakup: 0.7 };
    const decoded = decodeDials(encodeDials(changed));
    expect(decoded).toEqual(changed);
    // Out of range, or not a colour: each is dropped as a link's bad value is, and the default stands.
    const hostile = toLink(JSON.stringify({ heartHalo: 12.5, fogHeightFalloff: 0.6, sunElevation: 1, sunColor: 'orange', sunIntensity: 0.1, soilBreakup: 1.5 }));
    expect(decodeDials(hostile)).toEqual(DEFAULT_DIALS);
  });

  it('reaches a heart halo of 12, past preset B2 at the old top of 8, and still opens every link made under 8', () => {
    expect(NUMERIC_RANGES.heartHalo[0]).toBe(0);
    expect(NUMERIC_RANGES.heartHalo[1]).toBe(12);
    for (const heartHalo of [0, 4, 8, 9.5, 12]) expect(decodeDials(toLink(JSON.stringify({ heartHalo })))).toEqual({ ...DEFAULT_DIALS, heartHalo });
    expect(decodeDials(toLink(JSON.stringify({ heartHalo: 12.05 })))).toEqual(DEFAULT_DIALS);
  });

  it('round-trips the prop brush, lit saturation, actor fill and shadow lift through a link', () => {
    // Off their defaults, inside their ranges, and apart from each other.
    const changed = { ...DEFAULT_DIALS, propBrush: 0.65, litSaturation: 0.82, actorFill: 0.9, shadowLift: 0.085 };
    const text = encodeDials(changed);
    expect(decodeDials(text)).toEqual(changed);
    // Only the moved dials are written, so every link made before these dials existed still opens the same look.
    expect(JSON.parse(atob(text.replace(/-/g, '+').replace(/_/g, '/')))).toEqual({ shadowLift: 0.085, propBrush: 0.65, litSaturation: 0.82, actorFill: 0.9 });
    // Out of range or the wrong type: each is dropped and its default stands.
    const hostile = toLink(JSON.stringify({ propBrush: 1.6, litSaturation: 0.3, actorFill: -0.1, shadowLift: '0.01' }));
    expect(decodeDials(toLink(JSON.stringify({ shadowLift: 0.16 })))).toEqual(DEFAULT_DIALS);
    expect(decodeDials(hostile)).toEqual(DEFAULT_DIALS);
    const edges = { ...DEFAULT_DIALS, propBrush: 1.5, litSaturation: 0.4, actorFill: 2, shadowLift: 0.15 };
    expect(decodeDials(encodeDials(edges))).toEqual(edges);
  });

  it('starts the look pass\'s dials at the look before them', () => {
    // No brush on props, lit colour at its own saturation, no fill on actors and no lift in the darks.
    expect(DEFAULT_DIALS.propBrush).toBe(0);
    expect(DEFAULT_DIALS.litSaturation).toBe(1);
    expect(DEFAULT_DIALS.actorFill).toBe(0);
    expect(DEFAULT_DIALS.shadowLift).toBe(0);
    for (const key of ['propBrush', 'litSaturation', 'actorFill', 'shadowLift'] as const) expect(NUMERIC_RANGES[key], key).toBeDefined();
  });

  it('starts every new capability at the look it replaced, except the heart halo', () => {
    // The sun dials are the Verdant theme's light, so the default frame is lit as before.
    expect(DEFAULT_DIALS.sunElevation).toBe(VERDANT.sun.elevationDeg);
    expect(DEFAULT_DIALS.sunColor).toBe(VERDANT.sun.color);
    expect(DEFAULT_DIALS.sunIntensity).toBe(VERDANT.sun.intensity);
    // A falloff of 0 is the distance fog; a breakup of 0 is the smooth soil ring.
    expect(DEFAULT_DIALS.fogHeightFalloff).toBe(0);
    expect(DEFAULT_DIALS.soilBreakup).toBe(0);
    // The fog's density and start keep the values the distance fog was tuned to.
    expect(DEFAULT_DIALS.fogDensity).toBe(0.006);
    expect(DEFAULT_DIALS.fogStart).toBe(20);
    // The heart halo is the one capability that shows at the defaults, and it is stronger than the energy's glow.
    expect(DEFAULT_DIALS.heartHalo).toBeGreaterThan(DEFAULT_DIALS.bloomIntensity);
  });

  it('starts the film grain off, as the owner directed at the style gate, and keeps its dial', () => {
    expect(DEFAULT_DIALS.grain).toBe(0);
    expect(NUMERIC_RANGES.grain).toEqual([0, 0.2, 0.005]);
    // A link that names a grain still turns it on, so the owner can bring it back from the panel or a pasted link.
    const grainy = { ...DEFAULT_DIALS, grain: 0.06 };
    expect(decodeDials(toLink('{"grain":0.06}'))).toEqual(grainy);
    expect(decodeDials(encodeDials(grainy))).toEqual(grainy);
  });
});
