# M0b Simulation Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the pure, deterministic simulation kernel that every game system will run on: a fixed 60 Hz tick, seeded named RNG streams, a typed event log, a command queue, canonical state hashing, a versioned save envelope with migrations, a fixed-step clock for the shell, and a headless bot that prints a result line.

**Architecture:** `src/sim` holds only plain TypeScript with no DOM, engine, clock or unseeded randomness (enforced by ESLint and `tsconfig.sim.json` from M0a). State is plain JSON, so a save is the state and a hash of the state fingerprints the whole game. Systems are objects with `init` and `step`; the kernel runs them in registration order and hands each a context with the tick, the fixed `dt`, the tick's commands, named RNG streams and an event emitter. A development-only `pulse` system exercises the kernel until the game systems arrive in M2.

**Tech Stack:** TypeScript 6.0.3, Vitest 5.0.1, tsx 4.23.15 (for the bot CLI). No runtime dependencies.

**Prerequisite:** M0a is complete (`npm run check` and `npm test` pass on `main`).

---

## File map

| File | Responsibility |
|---|---|
| `src/sim/types.ts` | `JsonValue` and `JsonObject` |
| `src/sim/hash.ts` | FNV-1a, cyrb53, canonical JSON, `hashState` |
| `src/sim/rng.ts` | sfc32 generator, seeding, named streams |
| `src/sim/events.ts` | `SimEvent` and the `EventLog` |
| `src/sim/commands.ts` | `Command` and the tick-keyed `CommandQueue` |
| `src/sim/state.ts` | `TICK_HZ`, `TICK_DT`, `SIM_VERSION`, `SimState` |
| `src/sim/kernel.ts` | systems, `createSim`, `restoreSim`, `queueCommand`, `stepSim`, `runTicks` |
| `src/sim/clock.ts` | `FixedStepper` for the shell |
| `src/sim/save.ts` | save envelope, `serialize`, `deserialize`, migrations |
| `src/sim/dev/pulse.ts` | development fixture system (not part of the game) |
| `src/sim/index.ts` | public exports |
| `tools/bot/runBot.ts`, `tools/bot/run.ts` | headless bot and its CLI |
| `tests/unit/sim/*.test.ts`, `tests/unit/tools/bot.test.ts` | the tests below |

---

### Task 1: JSON types and hashing

**Files:**
- Create: `src/sim/types.ts`, `src/sim/hash.ts`
- Test: `tests/unit/sim/hash.test.ts`

- [ ] **Step 1: Write the failing test `tests/unit/sim/hash.test.ts`**

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/sim/hash.test.ts`
Expected: FAIL, `src/sim/hash` cannot be resolved.

- [ ] **Step 3: Write `src/sim/types.ts`**

```ts
/** Plain JSON. Everything in simulation state is one of these, so saves and hashes are exact. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };
```

- [ ] **Step 4: Write `src/sim/hash.ts`**

```ts
import type { JsonValue } from './types';

/** FNV-1a over UTF-16 code units. Small and stable; used to derive RNG stream seeds from names. */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** cyrb53: a 53-bit string hash with far fewer collisions than 32 bits, used for state fingerprints. */
export function cyrb53(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * JSON with object keys sorted at every level, so equal states give equal text whatever order their
 * fields were written in. Non-finite numbers throw: JSON would write NaN as null and quietly change the
 * game when the save loads.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'number':
      if (!Number.isFinite(value)) throw new Error(`canonicalStringify: non-finite number ${String(value)}`);
      return JSON.stringify(value);
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((item) => canonicalStringify(item)).join(',')}]`;
      const record = value as Record<string, unknown>;
      const fields = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`);
      return `{${fields.join(',')}}`;
    }
    default:
      throw new Error(`canonicalStringify: unsupported type ${typeof value}`);
  }
}

/** A 14-hex-digit fingerprint of any JSON value, stable across key order. */
export function hashState(value: JsonValue | object): string {
  return cyrb53(canonicalStringify(value)).toString(16).padStart(14, '0');
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/sim/hash.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add src/sim/types.ts src/sim/hash.ts tests/unit/sim/hash.test.ts
git commit -F - <<'EOF'
Add JSON types and canonical state hashing to the simulation

canonicalStringify sorts keys at every depth and refuses non-finite numbers,
because JSON writes NaN as null and a save would silently change the game.
hashState fingerprints any state as 14 hex digits of cyrb53. FNV-1a stays for
deriving RNG stream seeds. Golden values are pinned in the tests, including
the published FNV-1a vectors for "" and "a".

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Seeded RNG streams

**Files:**
- Create: `src/sim/rng.ts`
- Test: `tests/unit/sim/rng.test.ts`

- [ ] **Step 1: Write the failing test `tests/unit/sim/rng.test.ts`**

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/sim/rng.test.ts`
Expected: FAIL, `src/sim/rng` cannot be resolved.

- [ ] **Step 3: Write `src/sim/rng.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/sim/rng.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/sim/rng.ts tests/unit/sim/rng.test.ts
git commit -F - <<'EOF'
Add sfc32 RNG with named, independent streams

Each stream is seeded from the world seed and an FNV-1a hash of its name, so
a new draw in one system never changes what another system rolls. State is
four unsigned integers, which keeps saves exact; a resumed generator
continues the original sequence. Golden sequences for seed 1 and for the
('waves', 555) stream are pinned, and a 100k-draw histogram stays within 4%
of flat.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Events, commands and state constants

**Files:**
- Create: `src/sim/events.ts`, `src/sim/commands.ts`, `src/sim/state.ts`
- Test: `tests/unit/sim/events-commands.test.ts`

- [ ] **Step 1: Write the failing test `tests/unit/sim/events-commands.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { CommandQueue } from '../../../src/sim/commands';
import { EventLog } from '../../../src/sim/events';
import { SIM_VERSION, TICK_DT, TICK_HZ } from '../../../src/sim/state';

describe('EventLog', () => {
  it('drains in emission order and clears', () => {
    const log = new EventLog();
    log.emit(3, 'a');
    log.emit(3, 'b', { n: 1 });
    expect(log.drain()).toEqual([
      { tick: 3, type: 'a' },
      { tick: 3, type: 'b', data: { n: 1 } },
    ]);
    expect(log.drain()).toEqual([]);
    expect(log.count).toBe(2);
  });
});

describe('CommandQueue', () => {
  it('returns commands only for their tick, in push order', () => {
    const queue = new CommandQueue();
    queue.push(5, { type: 'x', playerId: 0 });
    queue.push(5, { type: 'y', playerId: 0 });
    queue.push(6, { type: 'z', playerId: 1 });
    expect(queue.size).toBe(3);
    expect(queue.take(4)).toEqual([]);
    expect(queue.take(5).map((c) => c.type)).toEqual(['x', 'y']);
    expect(queue.take(5)).toEqual([]);
    expect(queue.size).toBe(1);
  });

  it('refuses a negative or fractional tick', () => {
    const queue = new CommandQueue();
    expect(() => queue.push(-1, { type: 'x', playerId: 0 })).toThrow(/bad tick/);
    expect(() => queue.push(1.5, { type: 'x', playerId: 0 })).toThrow(/bad tick/);
  });
});

describe('state constants', () => {
  it('ticks at 60 Hz', () => {
    expect(TICK_HZ).toBe(60);
    expect(TICK_DT).toBeCloseTo(1 / 60, 12);
    expect(SIM_VERSION).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/sim/events-commands.test.ts`
Expected: FAIL, modules cannot be resolved.

- [ ] **Step 3: Write `src/sim/events.ts`**

```ts
import type { JsonValue } from './types';

/** Something that happened on a tick, reported to the shell (renderer, audio, UI) and to tests. */
export interface SimEvent {
  readonly tick: number;
  readonly type: string;
  readonly data?: JsonValue;
}

/** Events collected during steps and drained by whoever advances the simulation. */
export class EventLog {
  private pending: SimEvent[] = [];
  private total = 0;

  emit(tick: number, type: string, data?: JsonValue): void {
    this.pending.push(data === undefined ? { tick, type } : { tick, type, data });
    this.total += 1;
  }

  /** Returns and clears the events emitted since the last drain, in emission order. */
  drain(): SimEvent[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /** How many events have ever been emitted. */
  get count(): number {
    return this.total;
  }
}
```

- [ ] **Step 4: Write `src/sim/commands.ts`**

```ts
import type { JsonValue } from './types';

/** An input from a player or the bot. Commands are the only way intent enters the simulation. */
export interface Command {
  readonly type: string;
  readonly playerId: number;
  readonly data?: JsonValue;
}

/** Commands keyed by the tick they apply on, so a replay is a seed plus this list. */
export class CommandQueue {
  private readonly byTick = new Map<number, Command[]>();

  push(tick: number, command: Command): void {
    if (!Number.isInteger(tick) || tick < 0) throw new Error(`CommandQueue.push: bad tick ${tick}`);
    const list = this.byTick.get(tick);
    if (list) list.push(command);
    else this.byTick.set(tick, [command]);
  }

  /** Removes and returns the commands for a tick, in the order they were pushed. */
  take(tick: number): Command[] {
    const list = this.byTick.get(tick) ?? [];
    this.byTick.delete(tick);
    return list;
  }

  get size(): number {
    let n = 0;
    for (const list of this.byTick.values()) n += list.length;
    return n;
  }
}
```

- [ ] **Step 5: Write `src/sim/state.ts`**

```ts
import type { RngState } from './rng';
import type { JsonValue } from './types';

/** Simulation ticks per second. The shell interpolates rendering between ticks. */
export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;

/** Bumped whenever the shape of SimState changes; saves carry it and migrate forward. */
export const SIM_VERSION = 1;

/** Players are a list even when solo, so co-op never needs a rewrite (v3 invariant 1). */
export interface PlayerState {
  id: number;
}

/**
 * Everything the game is. Plain JSON by construction: a save is this object, and a hash of it
 * fingerprints the whole game.
 */
export interface SimState {
  version: number;
  seed: number;
  tick: number;
  players: PlayerState[];
  rng: Record<string, RngState>;
  systems: Record<string, JsonValue>;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/unit/sim/events-commands.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add src/sim/events.ts src/sim/commands.ts src/sim/state.ts tests/unit/sim/events-commands.test.ts
git commit -F - <<'EOF'
Add the event log, the command queue and the state shape

Commands are keyed by the tick they apply on, so a replay is a seed plus the
command list. Events drain in emission order. SimState is plain JSON with
players as a list even when solo, per the reference game's first invariant.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: The kernel

**Files:**
- Create: `src/sim/kernel.ts`
- Test: `tests/unit/sim/kernel.test.ts`

- [ ] **Step 1: Write the failing test `tests/unit/sim/kernel.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createSim, queueCommand, restoreSim, runTicks, stepSim, type SimSystem } from '../../../src/sim/kernel';

type Log = { seen: string[] };

function recorder(id: string): SimSystem<Log> {
  return {
    id,
    init: () => ({ seen: [] }),
    step(data, ctx) {
      data.seen.push(`${id}@${ctx.tick}:${ctx.commands.map((c) => c.type).join('+')}`);
    },
  };
}

describe('createSim', () => {
  it('starts at tick 0 with one player and each system initialised', () => {
    const sim = createSim({ seed: 42, systems: [recorder('a')] });
    expect(sim.state).toMatchObject({ version: 1, seed: 42, tick: 0, players: [{ id: 0 }] });
    expect(sim.state.systems['a']).toEqual({ seen: [] });
  });

  it('refuses duplicate system ids', () => {
    expect(() => createSim({ seed: 1, systems: [recorder('a'), recorder('a')] })).toThrow(/duplicate system id/);
  });
});

describe('stepSim', () => {
  it('runs systems in registration order and advances the tick', () => {
    const sim = createSim({ seed: 1, systems: [recorder('a'), recorder('b')] });
    const first = stepSim(sim);
    stepSim(sim);
    expect(sim.state.tick).toBe(2);
    expect((sim.state.systems['a'] as Log).seen).toEqual(['a@0:', 'a@1:']);
    expect((sim.state.systems['b'] as Log).seen).toEqual(['b@0:', 'b@1:']);
    expect(first.map((e) => e.type)).toEqual(['sim/created']);
  });

  it('delivers a command on its tick only', () => {
    const sim = createSim({ seed: 1, systems: [recorder('a')] });
    queueCommand(sim, { type: 'go', playerId: 0 }, 2);
    const events = runTicks(sim, 4);
    expect((sim.state.systems['a'] as Log).seen).toEqual(['a@0:', 'a@1:', 'a@2:go', 'a@3:']);
    expect(events.filter((e) => e.type === 'command/received')).toEqual([
      { tick: 2, type: 'command/received', data: { type: 'go', playerId: 0 } },
    ]);
  });

  it('refuses a command for a past tick', () => {
    const sim = createSim({ seed: 1, systems: [] });
    runTicks(sim, 3);
    expect(() => queueCommand(sim, { type: 'late', playerId: 0 }, 1)).toThrow(/in the past/);
  });

  it('keeps a stream continuous within a tick and persists it after', () => {
    const draws: number[] = [];
    const roller: SimSystem<{ n: number }> = {
      id: 'roller',
      init: () => ({ n: 0 }),
      step(data, ctx) {
        draws.push(ctx.rng('dice').nextU32(), ctx.rng('dice').nextU32());
        data.n += 1;
      },
    };
    const sim = createSim({ seed: 7, systems: [roller] });
    stepSim(sim);
    expect(draws[0]).not.toBe(draws[1]);
    expect(sim.state.rng['dice']).toBeDefined();
  });

  it('lets systems emit events stamped with the tick', () => {
    const shouter: SimSystem<{ n: number }> = {
      id: 'shouter',
      init: () => ({ n: 0 }),
      step(data, ctx) {
        data.n += 1;
        if (ctx.tick === 1) ctx.emit('shout', { n: data.n });
      },
    };
    const sim = createSim({ seed: 1, systems: [shouter] });
    stepSim(sim);
    expect(stepSim(sim)).toEqual([{ tick: 1, type: 'shout', data: { n: 2 } }]);
  });
});

describe('restoreSim', () => {
  it('requires data for every system', () => {
    const sim = createSim({ seed: 1, systems: [recorder('a')] });
    expect(() => restoreSim(sim.state, [recorder('a'), recorder('b')])).toThrow(/no data for system 'b'/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/sim/kernel.test.ts`
Expected: FAIL, `src/sim/kernel` cannot be resolved.

- [ ] **Step 3: Write `src/sim/kernel.ts`**

```ts
import { CommandQueue, type Command } from './commands';
import { EventLog, type SimEvent } from './events';
import { Rng, streamState } from './rng';
import { SIM_VERSION, TICK_DT, type SimState } from './state';
import type { JsonObject, JsonValue } from './types';

/** What a system sees on each tick. */
export interface SystemContext {
  readonly tick: number;
  readonly dt: number;
  readonly seed: number;
  readonly commands: readonly Command[];
  /** A named RNG stream. The same name returns the same generator for the rest of the tick. */
  rng(name: string): Rng;
  emit(type: string, data?: JsonValue): void;
}

/**
 * One piece of game logic. `init` returns the system's starting data, which lives in
 * state.systems[id] and must be a plain object; `step` mutates that object in place. Declare data as a
 * `type` alias, not an interface, so it satisfies JsonObject.
 */
export interface SimSystem<D extends JsonObject = JsonObject> {
  readonly id: string;
  init(seed: number): D;
  step(data: D, ctx: SystemContext): void;
}

export interface Sim {
  readonly state: SimState;
  readonly systems: readonly SimSystem[];
  readonly events: EventLog;
  readonly queue: CommandQueue;
}

export interface CreateSimOptions {
  seed: number;
  systems: readonly SimSystem[];
  players?: number;
}

function assertUniqueIds(systems: readonly SimSystem[]): void {
  const seen = new Set<string>();
  for (const system of systems) {
    if (seen.has(system.id)) throw new Error(`duplicate system id '${system.id}'`);
    seen.add(system.id);
  }
}

export function createSim(options: CreateSimOptions): Sim {
  assertUniqueIds(options.systems);
  const seed = options.seed >>> 0;
  const state: SimState = {
    version: SIM_VERSION,
    seed,
    tick: 0,
    players: Array.from({ length: options.players ?? 1 }, (_, id) => ({ id })),
    rng: {},
    systems: {},
  };
  for (const system of options.systems) state.systems[system.id] = system.init(seed);
  const sim: Sim = { state, systems: options.systems, events: new EventLog(), queue: new CommandQueue() };
  sim.events.emit(0, 'sim/created', { seed });
  return sim;
}

/** Rebuilds a simulation around a loaded state. The systems must be the set that produced it. */
export function restoreSim(state: SimState, systems: readonly SimSystem[]): Sim {
  assertUniqueIds(systems);
  for (const system of systems) {
    if (!(system.id in state.systems)) throw new Error(`restoreSim: state has no data for system '${system.id}'`);
  }
  const sim: Sim = { state, systems, events: new EventLog(), queue: new CommandQueue() };
  sim.events.emit(state.tick, 'sim/restored', { version: state.version });
  return sim;
}

/** Queues a command for a tick (default: the next tick to run). Past ticks are refused. */
export function queueCommand(sim: Sim, command: Command, tick: number = sim.state.tick): void {
  if (tick < sim.state.tick) throw new Error(`queueCommand: tick ${tick} is in the past (now ${sim.state.tick})`);
  sim.queue.push(tick, command);
}

/** Advances exactly one tick and returns every event emitted since the last drain. */
export function stepSim(sim: Sim): SimEvent[] {
  const { state } = sim;
  const tick = state.tick;
  const commands = sim.queue.take(tick);
  const live = new Map<string, Rng>();
  const ctx: SystemContext = {
    tick,
    dt: TICK_DT,
    seed: state.seed,
    commands,
    rng(name) {
      let rng = live.get(name);
      if (!rng) {
        rng = new Rng(state.rng[name] ?? streamState(state.seed, name));
        live.set(name, rng);
      }
      return rng;
    },
    emit(type, data) {
      sim.events.emit(tick, type, data);
    },
  };
  for (const command of commands) {
    sim.events.emit(tick, 'command/received', { type: command.type, playerId: command.playerId });
  }
  for (const system of sim.systems) system.step(state.systems[system.id] as JsonObject, ctx);
  for (const [name, rng] of live) state.rng[name] = rng.state();
  state.tick = tick + 1;
  return sim.events.drain();
}

/** Steps n ticks and returns every event, for tests and the bot. */
export function runTicks(sim: Sim, n: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    for (const event of stepSim(sim)) all.push(event);
  }
  return all;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/sim/kernel.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/sim/kernel.ts tests/unit/sim/kernel.test.ts
git commit -F - <<'EOF'
Add the simulation kernel: systems, commands, streams and events per tick

stepSim takes the tick's commands, runs systems in registration order with a
context holding the fixed dt, named RNG streams and an emitter, writes the
streams back into state, and advances the tick. System data is a plain object
mutated in place. Past-tick commands and duplicate system ids are refused, and
restoreSim refuses a state missing any system's data.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: The fixed-step clock

**Files:**
- Create: `src/sim/clock.ts`
- Test: `tests/unit/sim/clock.test.ts`

- [ ] **Step 1: Write the failing test `tests/unit/sim/clock.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../../../src/sim/clock';

describe('FixedStepper', () => {
  it('runs one tick per tick of elapsed time', () => {
    const clock = new FixedStepper();
    expect(clock.advance(1 / 60)).toEqual({ steps: 1, alpha: 0, dropped: 0 });
  });

  it('carries a partial tick as alpha', () => {
    const clock = new FixedStepper();
    const half = clock.advance(0.5 / 60);
    expect(half.steps).toBe(0);
    expect(half.alpha).toBeCloseTo(0.5, 9);
    expect(clock.advance(0.5 / 60).steps).toBe(1);
  });

  it('never loses a tick to floating point over many frames', () => {
    const clock = new FixedStepper();
    let total = 0;
    for (let i = 0; i < 6000; i++) total += clock.advance(1 / 60).steps;
    expect(total).toBe(6000);
  });

  it('caps a long frame and drops the excess instead of spiralling', () => {
    const clock = new FixedStepper(1 / 60, 5);
    const plan = clock.advance(1);
    expect(plan.steps).toBe(5);
    expect(plan.dropped).toBe(55);
    expect(clock.advance(1 / 60).steps).toBe(1);
  });

  it('ignores negative elapsed time', () => {
    expect(new FixedStepper().advance(-1)).toEqual({ steps: 0, alpha: 0, dropped: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/sim/clock.test.ts`
Expected: FAIL, `src/sim/clock` cannot be resolved.

- [ ] **Step 3: Write `src/sim/clock.ts`**

```ts
import { TICK_DT } from './state';

export interface StepPlan {
  /** Ticks to run now. */
  steps: number;
  /** Progress into the next tick, 0 to 1, for render interpolation. */
  alpha: number;
  /** Ticks skipped because the frame was too long. */
  dropped: number;
}

/**
 * Converts real elapsed time into whole simulation ticks. The shell owns the real clock and passes
 * elapsed seconds in, so the simulation never reads time itself. A long frame (a tab switch, a pause in
 * the browser) runs at most maxSteps ticks and drops the rest instead of spiralling.
 */
export class FixedStepper {
  private accumulator = 0;

  constructor(
    readonly dt: number = TICK_DT,
    readonly maxSteps: number = 5,
  ) {}

  advance(elapsedSeconds: number): StepPlan {
    this.accumulator += Math.max(0, elapsedSeconds);
    // The small epsilon keeps exact multiples of dt (1/60 added 60 times) from losing a tick to rounding.
    let steps = Math.floor(this.accumulator / this.dt + 1e-6);
    let dropped = 0;
    if (steps > this.maxSteps) {
      dropped = steps - this.maxSteps;
      steps = this.maxSteps;
    }
    this.accumulator = Math.max(0, this.accumulator - (steps + dropped) * this.dt);
    const alpha = this.accumulator / this.dt;
    return { steps, alpha: alpha < 1e-6 ? 0 : alpha, dropped };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/sim/clock.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/sim/clock.ts tests/unit/sim/clock.test.ts
git commit -F - <<'EOF'
Add the fixed-step clock the shell uses to drive ticks

The shell passes real elapsed seconds; the stepper returns whole ticks, an
interpolation alpha, and how many ticks a long frame dropped (at most five
run per frame). 6000 frames of 1/60 s produce exactly 6000 ticks, which a
plain floor on the accumulator does not guarantee.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Saves and migrations

**Files:**
- Create: `src/sim/save.ts`
- Test: `tests/unit/sim/save.test.ts`

- [ ] **Step 1: Write the failing test `tests/unit/sim/save.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { hashState } from '../../../src/sim/hash';
import { createSim, runTicks, type SimSystem } from '../../../src/sim/kernel';
import { deserialize, SAVE_FORMAT, SaveError, serialize } from '../../../src/sim/save';

const counter: SimSystem<{ n: number }> = {
  id: 'counter',
  init: () => ({ n: 0 }),
  step(data) {
    data.n += 1;
  },
};

function savedAt(ticks: number): string {
  const sim = createSim({ seed: 3, systems: [counter] });
  runTicks(sim, ticks);
  return serialize(sim.state);
}

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof SaveError) return error.reason;
    throw error;
  }
  return 'no error';
}

describe('serialize and deserialize', () => {
  it('round-trips the state exactly', () => {
    const sim = createSim({ seed: 3, systems: [counter] });
    runTicks(sim, 10);
    const loaded = deserialize(serialize(sim.state));
    expect(loaded).toEqual(sim.state);
    expect(hashState(loaded)).toBe(hashState(sim.state));
  });

  it('writes a recognisable envelope', () => {
    const envelope = JSON.parse(savedAt(5));
    expect(envelope).toMatchObject({ format: SAVE_FORMAT, version: 1, savedTick: 5 });
    expect(envelope.hash).toMatch(/^[0-9a-f]{14}$/);
  });

  it('rejects text that is not JSON, not an envelope, tampered or too new', () => {
    expect(reason(() => deserialize('{nope'))).toBe('not-json');
    expect(reason(() => deserialize('{"format":"other"}'))).toBe('wrong-format');
    const tampered = JSON.parse(savedAt(5));
    tampered.state.tick = 999;
    expect(reason(() => deserialize(JSON.stringify(tampered)))).toBe('corrupt');
    const future = JSON.parse(savedAt(5));
    future.version = 99;
    expect(reason(() => deserialize(JSON.stringify(future)))).toBe('too-new');
  });

  it('migrates forward one version at a time', () => {
    const migrations = { 1: (state: Record<string, unknown>) => ({ ...state, addedInV2: true }) };
    const loaded = deserialize(savedAt(2), migrations, 2) as unknown as Record<string, unknown>;
    expect(loaded['version']).toBe(2);
    expect(loaded['addedInV2']).toBe(true);
  });

  it('refuses a save it has no migration for', () => {
    expect(reason(() => deserialize(savedAt(2), {}, 2))).toBe('no-migration');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/sim/save.test.ts`
Expected: FAIL, `src/sim/save` cannot be resolved.

- [ ] **Step 3: Write `src/sim/save.ts`**

```ts
import { hashState } from './hash';
import { SIM_VERSION, type SimState } from './state';

export const SAVE_FORMAT = 'p99v4-save';

export interface SaveEnvelope {
  format: typeof SAVE_FORMAT;
  version: number;
  savedTick: number;
  hash: string;
  state: SimState;
}

export type SaveErrorReason = 'not-json' | 'wrong-format' | 'corrupt' | 'too-new' | 'no-migration';

export class SaveError extends Error {
  constructor(
    readonly reason: SaveErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'SaveError';
  }
}

/** Turns a state of version N into version N + 1. */
export type Migration = (state: Record<string, unknown>) => Record<string, unknown>;

/** Forward migrations keyed by the version they upgrade from. Empty until SIM_VERSION 2. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export function serialize(state: SimState): string {
  const envelope: SaveEnvelope = {
    format: SAVE_FORMAT,
    version: state.version,
    savedTick: state.tick,
    hash: hashState(state),
    state,
  };
  return JSON.stringify(envelope);
}

function isEnvelope(value: unknown): value is SaveEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v['format'] === SAVE_FORMAT &&
    typeof v['version'] === 'number' &&
    typeof v['hash'] === 'string' &&
    typeof v['state'] === 'object' &&
    v['state'] !== null
  );
}

/**
 * Parses a save, verifies it against its own hash (so a corrupted or hand-edited save is refused
 * rather than half-loaded), then migrates it forward to the current version.
 */
export function deserialize(
  text: string,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  currentVersion: number = SIM_VERSION,
): SimState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SaveError('not-json', 'the save is not valid JSON');
  }
  if (!isEnvelope(parsed)) throw new SaveError('wrong-format', `the save is not a ${SAVE_FORMAT} envelope`);
  if (hashState(parsed.state) !== parsed.hash) throw new SaveError('corrupt', 'the save state does not match its hash');
  if (parsed.version > currentVersion) {
    throw new SaveError('too-new', `save version ${parsed.version} is newer than ${currentVersion}`);
  }
  let state = parsed.state as unknown as Record<string, unknown>;
  for (let version = parsed.version; version < currentVersion; version++) {
    const migrate = migrations[version];
    if (!migrate) throw new SaveError('no-migration', `no migration from version ${version}`);
    state = migrate(state);
    state['version'] = version + 1;
  }
  return state as unknown as SimState;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/sim/save.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/sim/save.ts tests/unit/sim/save.test.ts
git commit -F - <<'EOF'
Add the versioned save envelope with hash verification and migrations

A save carries its format, version, tick and the hash of its state. Loading
refuses non-JSON, foreign envelopes, tampered states and versions newer than
the game, then migrates older saves forward one version at a time. The
migration registry is empty until the state shape first changes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: The development pulse system and determinism

**Files:**
- Create: `src/sim/dev/pulse.ts`, `src/sim/index.ts` (replace the M0a stub)
- Test: `tests/unit/sim/determinism.test.ts`, `tests/unit/sim/purity.test.ts`
- Modify: `package.json` (add `test:determinism`)

- [ ] **Step 1: Write the failing test `tests/unit/sim/determinism.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { pulseSystem } from '../../../src/sim/dev/pulse';
import { createSim, hashState, queueCommand, restoreSim, runTicks, deserialize, serialize } from '../../../src/sim/index';

function play(seed: number, ticks: number, boostAt: number[]): string {
  const sim = createSim({ seed, systems: [pulseSystem] });
  for (const tick of boostAt) queueCommand(sim, { type: 'dev/boost', playerId: 0 }, tick);
  runTicks(sim, ticks);
  return hashState(sim.state);
}

describe('determinism', () => {
  it('gives the same hash for the same seed and commands after 20,000 ticks', () => {
    expect(play(11, 20_000, [100, 9_000, 15_000])).toBe(play(11, 20_000, [100, 9_000, 15_000]));
  });

  it('gives a different hash for a different seed or a different command', () => {
    const base = play(11, 20_000, [100]);
    expect(play(12, 20_000, [100])).not.toBe(base);
    expect(play(11, 20_000, [101])).not.toBe(base);
  });

  it('continues identically after a save and load mid-run', () => {
    const continuous = createSim({ seed: 21, systems: [pulseSystem] });
    queueCommand(continuous, { type: 'dev/boost', playerId: 0 }, 12_000);
    runTicks(continuous, 20_000);

    const first = createSim({ seed: 21, systems: [pulseSystem] });
    runTicks(first, 10_000);
    const resumed = restoreSim(deserialize(serialize(first.state)), [pulseSystem]);
    queueCommand(resumed, { type: 'dev/boost', playerId: 0 }, 12_000);
    runTicks(resumed, 10_000);

    expect(resumed.state.tick).toBe(20_000);
    expect(hashState(resumed.state)).toBe(hashState(continuous.state));
  });

  it('emits pulse events on schedule', () => {
    const sim = createSim({ seed: 5, systems: [pulseSystem] });
    const pulses = runTicks(sim, 1_800).filter((e) => e.type === 'dev/pulse');
    expect(pulses.map((e) => e.tick)).toEqual([599, 1_199, 1_799]);
  });
});
```

- [ ] **Step 2: Write the failing test `tests/unit/sim/purity.test.ts`**

A second line of defence behind ESLint: this scans the source text itself, so it also catches a rule
that was switched off.

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

const FORBIDDEN: RegExp[] = [
  /from ['"]three/,
  /from ['"]postprocessing/,
  /Math\.random/,
  /Date\.now/,
  /new Date\(/,
  /performance\.now/,
  /\bwindow\./,
  /\bdocument\./,
  /localStorage/,
];

describe('src/sim purity', () => {
  it('contains no engine imports, clock reads or unseeded randomness', () => {
    const files = sourceFiles('src/sim');
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN) expect(pattern.test(text), `${file} matches ${pattern}`).toBe(false);
    }
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npx vitest run tests/unit/sim/determinism.test.ts tests/unit/sim/purity.test.ts`
Expected: FAIL. The determinism test cannot resolve `src/sim/dev/pulse`; the purity test may pass already, which is fine because it guards later changes.

- [ ] **Step 4: Write `src/sim/dev/pulse.ts`**

```ts
import type { SimSystem } from '../kernel';

/**
 * Development only. Exercises the kernel the way real systems will: two named RNG streams, a command,
 * plain JSON state and scheduled events. The bot and the determinism tests run it until the game systems
 * exist in M2. It is not part of the game.
 */
export type PulseData = {
  /** x, y pairs in a 100 by 100 field. */
  points: number[];
  pulses: number;
  /** Ticks of boost remaining after a 'dev/boost' command. */
  boosted: number;
};

export const pulseSystem: SimSystem<PulseData> = {
  id: 'dev/pulse',
  init() {
    return { points: [], pulses: 0, boosted: 0 };
  },
  step(data, ctx) {
    for (const command of ctx.commands) {
      if (command.type === 'dev/boost') data.boosted = 120;
    }
    const spawn = ctx.rng('dev/spawn');
    if (data.points.length < 128 && spawn.chance(0.1)) data.points.push(spawn.range(0, 100), spawn.range(0, 100));
    const drift = ctx.rng('dev/drift');
    const speed = data.boosted > 0 ? 3 : 1;
    for (let i = 0; i < data.points.length; i++) {
      const moved = (data.points[i] as number) + drift.range(-0.5, 0.5) * speed * ctx.dt * 60;
      data.points[i] = ((moved % 100) + 100) % 100;
    }
    if (data.boosted > 0) data.boosted -= 1;
    if (ctx.tick % 600 === 599) {
      data.pulses += 1;
      ctx.emit('dev/pulse', { count: data.pulses, points: data.points.length / 2 });
    }
  },
};
```

- [ ] **Step 5: Replace `src/sim/index.ts`**

```ts
// Public surface of the pure simulation. The development pulse system is imported directly from
// src/sim/dev/pulse and deliberately not re-exported.
export * from './types';
export * from './hash';
export * from './rng';
export * from './events';
export * from './commands';
export * from './state';
export * from './kernel';
export * from './clock';
export * from './save';
```

- [ ] **Step 6: Add the determinism script to `package.json`**

In `"scripts"`, add after `"test"`:

```json
    "test:determinism": "vitest run tests/unit/sim/determinism.test.ts",
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run test:determinism && npx vitest run tests/unit/sim/purity.test.ts`
Expected: PASS, 4 tests then 1 test.

- [ ] **Step 8: Commit**

```bash
git add src/sim/dev/pulse.ts src/sim/index.ts package.json tests/unit/sim/determinism.test.ts tests/unit/sim/purity.test.ts
git commit -F - <<'EOF'
Prove determinism across seeds, commands and a mid-run save

The development pulse system draws from two named streams, reacts to a
command and emits scheduled events. Two runs with the same seed and commands
hash identically after 20,000 ticks; changing the seed or moving one command
by a tick changes the hash; saving at tick 10,000, loading and continuing
gives the same hash as an uninterrupted run. A source scan backs up ESLint's
purity rules.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: The headless bot

**Files:**
- Create: `tools/bot/runBot.ts`, `tools/bot/run.ts`
- Test: `tests/unit/tools/bot.test.ts`
- Modify: `package.json` (add `bot`)

- [ ] **Step 1: Write the failing test `tests/unit/tools/bot.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { formatResult, runBot } from '../../../tools/bot/runBot';

describe('runBot', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = runBot({ seed: 1, ticks: 3_000 });
    const b = runBot({ seed: 1, ticks: 3_000 });
    const c = runBot({ seed: 2, ticks: 3_000 });
    expect(a.hash).toBe(b.hash);
    expect(c.hash).not.toBe(a.hash);
    expect(a.events).toBeGreaterThan(0);
  });

  it('prints a parseable result line', () => {
    const line = formatResult({ seed: 7, ticks: 60, hash: '00000000000abc', events: 3, ms: 12 });
    expect(line).toBe('bot result: seed=7 ticks=60 hash=00000000000abc events=3 ms=12');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/tools/bot.test.ts`
Expected: FAIL, `tools/bot/runBot` cannot be resolved.

- [ ] **Step 3: Write `tools/bot/runBot.ts`**

```ts
import { pulseSystem } from '../../src/sim/dev/pulse';
import { createSim, hashState, queueCommand, stepSim, type SimSystem } from '../../src/sim/index';

export interface BotOptions {
  seed: number;
  ticks: number;
  systems?: readonly SimSystem[];
  /** Queue a 'dev/boost' command every N ticks (0 disables). */
  boostEvery?: number;
}

export interface BotResult {
  seed: number;
  ticks: number;
  hash: string;
  events: number;
  ms: number;
}

/** Plays the simulation headless. M0 drives the development pulse system; M2 swaps in the game systems. */
export function runBot(options: BotOptions, now: () => number = () => performance.now()): BotResult {
  const sim = createSim({ seed: options.seed, systems: options.systems ?? [pulseSystem] });
  const boostEvery = options.boostEvery ?? 1_800;
  const started = now();
  let events = 0;
  for (let i = 0; i < options.ticks; i++) {
    if (boostEvery > 0 && sim.state.tick % boostEvery === 0) queueCommand(sim, { type: 'dev/boost', playerId: 0 });
    events += stepSim(sim).length;
  }
  return { seed: options.seed, ticks: options.ticks, hash: hashState(sim.state), events, ms: Math.round(now() - started) };
}

export function formatResult(result: BotResult): string {
  return `bot result: seed=${result.seed} ticks=${result.ticks} hash=${result.hash} events=${result.events} ms=${result.ms}`;
}
```

- [ ] **Step 4: Write `tools/bot/run.ts`**

```ts
import { formatResult, runBot } from './runBot';

function numberArg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value)) throw new Error(`--${name} needs a number`);
  return value;
}

// Ten simulated minutes by default.
const result = runBot({ seed: numberArg('seed', 1), ticks: numberArg('ticks', 36_000) });
console.log(formatResult(result));
```

- [ ] **Step 5: Add the bot script to `package.json`**

In `"scripts"`, add:

```json
    "bot": "tsx tools/bot/run.ts",
```

- [ ] **Step 6: Run the test and the CLI**

Run: `npx vitest run tests/unit/tools/bot.test.ts && npm run bot -- --seed 555 --ticks 36000`
Expected: PASS, 2 tests; then one line matching `bot result: seed=555 ticks=36000 hash=[0-9a-f]{14} events=\d+ ms=\d+`. Run the CLI twice and confirm the `hash=` value is identical both times.

- [ ] **Step 7: Run everything**

Run: `npm run check && npm test`
Expected: `npm run check` clean and every unit test passes.

- [ ] **Step 8: Update `docs/blueprint.md`**

In the Task list, tick:

```markdown
- [x] Simulation kernel: fixed tick, seeded RNG streams, event log, save envelope, bot harness
```

Append to the Where we are paragraph:

```markdown
M0b is complete: the simulation kernel is deterministic across seeds, commands and a mid-run save
(tests/unit/sim/determinism.test.ts), and `npm run bot` prints a stable result line.
```

- [ ] **Step 9: Commit and push**

```bash
git add tools/bot/runBot.ts tools/bot/run.ts tests/unit/tools/bot.test.ts package.json docs/blueprint.md
git commit -F - <<'EOF'
Add the headless bot and record M0b in the blueprint

npm run bot plays the simulation for ten simulated minutes by default and
prints "bot result: seed ticks hash events ms". Two runs with the same seed
print the same hash. M2 replaces the development pulse system with the game
systems, and the bot becomes the end-to-end playable check (Build order
item 1).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git push
```

---

## Self-review

- **Spec coverage:** fixed 60 Hz tick and `TICK_DT` (Task 3), seeded named streams (Task 2), event log
  (Task 3), command queue for replays (Task 3), canonical hashing (Task 1), versioned saves with
  migrations and idempotent verification (Task 6), the shell's fixed-step clock (Task 5), players as a
  list (Task 3), determinism instrument `npm run test:determinism` (Task 7), bot harness with a result
  line (Task 8). Game systems are M2.
- **Placeholders:** none.
- **Consistency:** `SimSystem<D extends JsonObject>` (Task 4) is used by `pulseSystem` (Task 7) with a
  `type` alias for its data; `hashState`, `serialize`, `deserialize`, `restoreSim` and `queueCommand` have
  the same signatures wherever they appear; the bot imports only from `src/sim/index` plus the dev pulse.
