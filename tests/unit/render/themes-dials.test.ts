import { describe, expect, it } from 'vitest';
import { DEFAULT_DIALS, NUMERIC_RANGES } from '../../../src/render/defaults';
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
});
