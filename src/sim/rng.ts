import { fnv1a32 } from './hash';

/** The four 32-bit words of an sfc32 generator, stored unsigned so saves are canonical. */
export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/**
 * sfc32: small, fast, statistically strong, and its whole state is four integers, which keeps saves
 * exact. Every random draw in the simulation goes through one of these.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(state: RngState) {
    this.a = state.a | 0;
    this.b = state.b | 0;
    this.c = state.c | 0;
    this.d = state.d | 0;
  }

  nextU32(): number {
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [0, n). */
  int(n: number): number {
    if (!Number.isInteger(n) || n <= 0) throw new Error(`Rng.int: n must be a positive integer, got ${n}`);
    return Math.floor(this.next() * n);
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty list');
    return items[this.int(items.length)] as T;
  }

  state(): RngState {
    return { a: this.a >>> 0, b: this.b >>> 0, c: this.c >>> 0, d: this.d >>> 0 };
  }
}

/** Expands one integer seed into a warmed-up generator state. */
export function seedRng(seed: number): RngState {
  const next = splitmix32(seed);
  const rng = new Rng({ a: next(), b: next(), c: next(), d: next() });
  for (let i = 0; i < 12; i++) rng.nextU32();
  return rng.state();
}

/**
 * A named stream: the same world seed and name always give the same sequence, and drawing from one
 * stream never shifts another. Systems name their streams ('waves', 'loot') so a new draw in one system
 * cannot change what another system rolls.
 */
export function streamState(worldSeed: number, name: string): RngState {
  return seedRng((fnv1a32(name) ^ Math.imul(worldSeed >>> 0, 0x9e3779b1)) >>> 0);
}
