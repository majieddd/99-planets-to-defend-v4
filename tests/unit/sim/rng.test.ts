import { describe, expect, it } from 'vitest';
import { Rng, seedRng, streamState } from '../../../src/sim/rng';

describe('seedRng and Rng', () => {
  it('seeds to the golden state', () => {
    expect(seedRng(1)).toEqual({ a: 1074515795, b: 1449623916, c: 1296543226, d: 2041432051 });
  });

  it('reproduces the golden sequence for seed 1', () => {
    const rng = new Rng(seedRng(1));
    const drawn = [rng.nextU32(), rng.nextU32(), rng.nextU32(), rng.nextU32(), rng.nextU32()];
    expect(drawn).toEqual([270604467, 2273286251, 2085451298, 1710828129, 4124056796]);
  });

  it('resumes exactly from a saved state', () => {
    const original = new Rng(seedRng(9));
    original.nextU32();
    const resumed = new Rng(original.state());
    for (let i = 0; i < 5; i++) expect(resumed.nextU32()).toBe(original.nextU32());
  });

  it('stores state as unsigned 32-bit words', () => {
    const words = { a: 0xffffffff, b: 0x80000000, c: 0xfffffffe, d: 0x80000001 };
    expect(new Rng(words).state()).toEqual(words);
    const rng = new Rng(words);
    for (let i = 0; i < 64; i++) {
      rng.nextU32();
      const s = rng.state();
      for (const w of [s.a, s.b, s.c, s.d]) expect(w).toBe(w >>> 0);
    }
  });

  it('keeps next() in [0, 1) with a flat histogram', () => {
    const rng = new Rng(seedRng(3));
    const bins = new Array<number>(10).fill(0);
    let min = 1;
    let max = 0;
    for (let i = 0; i < 100_000; i++) {
      const v = rng.next();
      min = Math.min(min, v);
      max = Math.max(max, v);
      bins[Math.floor(v * 10)]! += 1;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
    for (const count of bins) expect(Math.abs(count - 10_000)).toBeLessThan(400);
  });

  it('keeps range, int, chance and pick in bounds', () => {
    const rng = new Rng(seedRng(4));
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 2_000; i++) {
      const r = rng.range(-2, 5);
      expect(r).toBeGreaterThanOrEqual(-2);
      expect(r).toBeLessThan(5);
      const n = rng.int(7);
      expect(Number.isInteger(n) && n >= 0 && n < 7).toBe(true);
      expect(typeof rng.chance(0.3)).toBe('boolean');
      expect(items).toContain(rng.pick(items));
    }
    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(1)).toBe(true);
  });

  it('refuses bad arguments', () => {
    const rng = new Rng(seedRng(5));
    expect(() => rng.int(0)).toThrow(/positive integer/);
    expect(() => rng.int(2.5)).toThrow(/positive integer/);
    expect(() => rng.pick([])).toThrow(/empty/);
  });
});

describe('streamState', () => {
  it('reproduces the golden stream', () => {
    const rng = new Rng(streamState(555, 'waves'));
    expect([rng.nextU32(), rng.nextU32(), rng.nextU32()]).toEqual([2072225171, 2584098524, 341295879]);
  });

  it('separates names and seeds', () => {
    expect(new Rng(streamState(1, 'a')).nextU32()).not.toBe(new Rng(streamState(1, 'b')).nextU32());
    expect(new Rng(streamState(1, 'a')).nextU32()).not.toBe(new Rng(streamState(2, 'a')).nextU32());
  });
});
