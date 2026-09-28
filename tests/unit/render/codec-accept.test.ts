import { describe, expect, it } from 'vitest';
import { COLOR_DIALS, DEFAULT_DIALS, NUMERIC_RANGES, type RenderDials } from '../../../src/render/defaults';
import { acceptDial, decodeDials, encodeDials } from '../../../src/render/dialsCodec';

const toLink = (json: string) => btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const numericKeys = Object.keys(NUMERIC_RANGES) as (keyof typeof NUMERIC_RANGES)[];

// Values that are no number, for every numeric dial. The string forms of valid numbers are the case a hand-typed
// capture or a JSON round trip through a form produces, and the one a lax check would let through.
const NOT_NUMBERS: unknown[] = ['0.1', '1', '', ' ', 'NaN', null, undefined, true, false, {}, [], [1], { valueOf: () => 1 }, Symbol.for('x'), 1n];
// Values that are no six-digit hex colour, for every colour dial. The last is outside Latin-1, which made the old
// link-based check throw from btoa.
const NOT_COLOURS: unknown[] = ['#abc', '#abcd', '#abcdef0', 'abcdef', '#ghijkl', '#12345g', ' #123456', '#123456 ', 'teal', 'rgb(1, 2, 3)', '', 0x123456, null, undefined, {}, ['#123456'], '#1234éé', '#12345☃'];
// Names that are no dial, including the ones every object inherits.
const NOT_DIALS = ['notADial', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'prototype', '', 'Bands', 'shadowtint', 'bands '];

describe('acceptDial', () => {
  it('accepts each numeric dial at both ends of its range and between them, and refuses just outside', () => {
    for (const key of numericKeys) {
      const [min, max, step] = NUMERIC_RANGES[key];
      expect(acceptDial(key, min), key).toBe(true);
      expect(acceptDial(key, max), key).toBe(true);
      expect(acceptDial(key, DEFAULT_DIALS[key]), key).toBe(true);
      if (key !== 'bands') expect(acceptDial(key, (min + max) / 2), key).toBe(true);
      expect(acceptDial(key, min - step), key).toBe(false);
      expect(acceptDial(key, max + step), key).toBe(false);
      // Past the ends by far less than a step is still past them.
      expect(acceptDial(key, min - 1e-9), key).toBe(false);
      expect(acceptDial(key, max + 1e-9), key).toBe(false);
    }
  });

  it('refuses every non-finite number and every value that is not a number, for every numeric dial', () => {
    for (const key of numericKeys) {
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, ...NOT_NUMBERS]) expect(acceptDial(key, value), `${key} ${String(value)}`).toBe(false);
    }
  });

  it('takes the band count only as a whole number, since the shader counts light levels by it', () => {
    for (const bands of [2, 3, 4, 5]) expect(acceptDial('bands', bands)).toBe(true);
    for (const bands of [2.5, 3.0001, 4.999]) expect(acceptDial('bands', bands)).toBe(false);
    // Every other dial takes values between its steps: setDials and links carry measured values like 0.085.
    expect(acceptDial('shadowLift', 0.0853)).toBe(true);
  });

  it('accepts six-digit hex in either case for every colour dial, and refuses everything else', () => {
    for (const key of COLOR_DIALS) {
      for (const value of ['#000000', '#ffffff', '#ABCDEF', '#aBc012', DEFAULT_DIALS[key]]) expect(acceptDial(key, value), `${key} ${value}`).toBe(true);
      for (const value of NOT_COLOURS) expect(acceptDial(key, value), `${key} ${String(value)}`).toBe(false);
    }
  });

  it('refuses names that are no dial, whatever the value', () => {
    for (const key of NOT_DIALS) {
      for (const value of [1, 0.5, '#123456', 'x', null]) expect(acceptDial(key, value), `${key} ${String(value)}`).toBe(false);
    }
  });

  it('knows every dial: each is numeric or a colour, and accepts its own default', () => {
    for (const key of Object.keys(DEFAULT_DIALS) as (keyof RenderDials)[]) expect(acceptDial(key, DEFAULT_DIALS[key]), key).toBe(true);
    expect(numericKeys.length + COLOR_DIALS.length).toBe(Object.keys(DEFAULT_DIALS).length);
  });

  it('never throws, whatever it is handed', () => {
    for (const key of [...numericKeys, ...COLOR_DIALS, ...NOT_DIALS]) {
      for (const value of [...NOT_NUMBERS, ...NOT_COLOURS]) expect(() => acceptDial(key, value)).not.toThrow();
    }
  });
});

describe('decodeDials through acceptDial', () => {
  it('takes a value from a link exactly when acceptDial accepts it, key by key', () => {
    const candidates: unknown[] = [-1, 0, 0.5, 1, 2.5, 3, 8, 12, 12.5, 1000, '0.1', '#123456', 'teal', null, true, [1], {}];
    for (const key of [...numericKeys, ...COLOR_DIALS]) {
      for (const value of candidates) {
        let json: string;
        try {
          json = JSON.stringify({ [key]: value });
        } catch {
          continue;
        }
        const decoded = decodeDials(toLink(json)) as unknown as Record<string, unknown>;
        const expected = acceptDial(key, value) ? value : (DEFAULT_DIALS as unknown as Record<string, unknown>)[key];
        expect(decoded[key], `${key} ${JSON.stringify(value)}`).toEqual(expected);
      }
    }
  });

  it('keeps every good key of a link when some are bad, and a base value where a key is refused', () => {
    const base = { ...DEFAULT_DIALS, sunElevation: 8, shadowTint: '#205060' };
    // Each good value differs from the base's, so a dropped key fails the comparison. The heart halo here was 11 until
    // 11 became the locked default, after which a decoder that dropped it would still have passed.
    expect(base.exposure).not.toBe(0.5);
    expect(base.heartHalo).not.toBe(9.5);
    const link = toLink(JSON.stringify({ sunElevation: 200, shadowTint: 'teal', bandSoftness: '0.1', notADial: 1, exposure: 0.5, heartHalo: 9.5 }));
    expect(decodeDials(link, base)).toEqual({ ...base, exposure: 0.5, heartHalo: 9.5 });
  });

  it("ignores a link's inherited names and prototype keys", () => {
    const link = toLink('{"__proto__":{"bands":4},"constructor":1,"toString":2,"bands":3.5}');
    const decoded = decodeDials(link);
    expect(decoded).toEqual(DEFAULT_DIALS);
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
  });

  it('round-trips every dial at both ends of its range', () => {
    const low = { ...DEFAULT_DIALS } as unknown as Record<string, unknown>;
    const high = { ...DEFAULT_DIALS } as unknown as Record<string, unknown>;
    for (const key of numericKeys) {
      low[key] = NUMERIC_RANGES[key][0];
      high[key] = NUMERIC_RANGES[key][1];
    }
    for (const dials of [low, high]) expect(decodeDials(encodeDials(dials as unknown as RenderDials))).toEqual(dials);
  });
});
