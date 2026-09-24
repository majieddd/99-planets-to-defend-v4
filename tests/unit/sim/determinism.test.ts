import { describe, expect, it } from 'vitest';
import { pulseSystem, type PulseData } from '../../../src/sim/dev/pulse';
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
    // The save lands inside a boost, so an effect in flight has to survive it.
    const first = createSim({ seed: 21, systems: [pulseSystem] });
    queueCommand(first, { type: 'dev/boost', playerId: 0 }, 9_950);
    runTicks(first, 10_000);
    expect((first.state.systems['dev/pulse'] as PulseData).boosted).toBeGreaterThan(0);
    const saved = serialize(first.state);

    // A real load starts in a fresh page. Playing another game first replaces anything the first run left
    // outside its state (module variables, caches), so such state makes the resumed game diverge.
    const continuous = play(21, 20_000, [9_950, 12_000]);

    const resumed = restoreSim(deserialize(saved), [pulseSystem]);
    queueCommand(resumed, { type: 'dev/boost', playerId: 0 }, 12_000);
    runTicks(resumed, 10_000);

    expect(resumed.state.tick).toBe(20_000);
    expect(hashState(resumed.state)).toBe(continuous);
  });

  it('emits pulse events on schedule', () => {
    const sim = createSim({ seed: 5, systems: [pulseSystem] });
    const pulses = runTicks(sim, 1_800).filter((e) => e.type === 'dev/pulse');
    expect(pulses.map((e) => e.tick)).toEqual([599, 1_199, 1_799]);
  });
});
