import { describe, expect, it } from 'vitest';
import { canonicalStringify, cyrb53, fnv1a32, hashState } from '../../../src/sim/hash';

describe('fnv1a32', () => {
  it('matches the published FNV-1a vectors', () => {
    expect(fnv1a32('')).toBe(2166136261);
    expect(fnv1a32('a')).toBe(3826002220);
    expect(fnv1a32('waves')).toBe(737491941);
  });
});

describe('cyrb53', () => {
  it('reproduces its golden values', () => {
    expect(cyrb53('')).toBe(3338908027751811);
    expect(cyrb53('a')).toBe(7929297801672961);
    expect(cyrb53('{"a":1}')).toBe(4561562304108614);
  });
});

describe('canonicalStringify', () => {
  it('sorts keys at every depth and keeps array order', () => {
    expect(canonicalStringify({ b: [1, 2, { d: true, c: 'x' }], a: null })).toBe('{"a":null,"b":[1,2,{"c":"x","d":true}]}');
  });

  it('drops undefined object fields, as JSON does', () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('refuses non-finite numbers, which would load back as null', () => {
    expect(() => canonicalStringify({ a: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalStringify([Number.POSITIVE_INFINITY])).toThrow(/non-finite/);
  });

  it('refuses values JSON cannot hold', () => {
    expect(() => canonicalStringify({ f: () => 1 })).toThrow(/unsupported/);
  });

  it('refuses sparse arrays, which JSON would load back with nulls', () => {
    const holey: number[] = [1];
    holey[3] = 4;
    expect(() => canonicalStringify(holey)).toThrow(/unsupported/);
  });
});

describe('hashState', () => {
  it('reproduces its golden fingerprints', () => {
    expect(hashState({ a: 1 })).toBe('1034b77cc1d846');
    expect(hashState({ x: 1, y: [2, 3] })).toBe('18a2a77f0bd00f');
  });

  it('ignores key order and notices value changes', () => {
    expect(hashState({ y: [2, 3], x: 1 })).toBe(hashState({ x: 1, y: [2, 3] }));
    expect(hashState({ x: 1 })).not.toBe(hashState({ x: 2 }));
  });
});
