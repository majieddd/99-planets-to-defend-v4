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
    expect(reason(() => deserialize(JSON.stringify({ ...JSON.parse(savedAt(5)), format: 'other' })))).toBe('wrong-format');
    const tampered = JSON.parse(savedAt(5));
    tampered.state.systems.counter.n = 999;
    expect(reason(() => deserialize(JSON.stringify(tampered)))).toBe('corrupt');
    const future = serialize({ ...JSON.parse(savedAt(5)).state, version: 99 });
    expect(reason(() => deserialize(future))).toBe('too-new');
  });

  it('refuses a save whose header disagrees with its state', () => {
    const migrations = { 1: (state: Record<string, unknown>) => ({ ...state, addedInV2: true }) };
    const v1 = JSON.parse(savedAt(2));
    const v2 = JSON.parse(serialize({ ...v1.state, version: 2, addedInV2: true }));
    // Relabelled up, v1 would skip migration 1; relabelled down, v2 would run it twice.
    const edits = [
      [v1, { version: 2 }],
      [v2, { version: 1 }],
      [v1, { version: 99 }],
      [v1, { savedTick: 3 }],
    ];
    for (const [envelope, header] of edits) {
      expect(reason(() => deserialize(JSON.stringify({ ...envelope, ...header }), migrations, 2))).toBe('corrupt');
    }
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

  it('chains migrations from the save version', () => {
    const seen: unknown[] = [];
    const step = (state: Record<string, unknown>) => {
      seen.push(state['version']);
      return { ...state, [`from${String(state['version'])}`]: true };
    };
    const v2 = serialize({ ...JSON.parse(savedAt(2)).state, version: 2 });
    const loaded = deserialize(v2, { 1: step, 2: step, 3: step }, 4);
    expect(seen).toEqual([2, 3]);
    expect(loaded).toMatchObject({ version: 4, from2: true, from3: true });
  });
});
