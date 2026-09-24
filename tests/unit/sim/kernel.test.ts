import { describe, expect, it } from 'vitest';
import { createSim, queueCommand, restoreSim, runTicks, stepSim, type SimSystem } from '../../../src/sim/kernel';
import { Rng, streamState } from '../../../src/sim/rng';
import { TICK_DT } from '../../../src/sim/state';

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

  it('creates the requested players as a list', () => {
    expect(createSim({ seed: 1, systems: [], players: 3 }).state.players).toEqual([{ id: 0 }, { id: 1 }, { id: 2 }]);
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

describe('stepSim contract', () => {
  it('inits and steps systems in registration order with the fixed dt and the world seed', () => {
    const trace: string[] = [];
    const tracer = (id: string): SimSystem<{ n: number }> => ({
      id,
      init(seed) {
        trace.push(`${id} init ${seed}`);
        return { n: 0 };
      },
      step(data, ctx) {
        data.n += 1;
        trace.push(`${id}@${ctx.tick} ${ctx.dt === TICK_DT} ${ctx.seed}`);
      },
    });
    runTicks(createSim({ seed: 42, systems: [tracer('z'), tracer('a')] }), 2);
    expect(trace).toEqual(['z init 42', 'a init 42', 'z@0 true 42', 'a@0 true 42', 'z@1 true 42', 'a@1 true 42']);
  });

  it('seeds a stream from the world seed and its name and continues it exactly across ticks', () => {
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
    runTicks(sim, 2);
    const expected = new Rng(streamState(7, 'dice'));
    expect(draws).toEqual(Array.from({ length: 4 }, () => expected.nextU32()));
    expect(sim.state.rng['dice']).toEqual(expected.state());
  });

  it('shows systems the player roster in init and on every tick', () => {
    const seen: number[][] = [];
    const roster: SimSystem<{ n: number }> = {
      id: 'roster',
      init(_seed, players) {
        seen.push(players.map((p) => p.id));
        return { n: 0 };
      },
      step(data, ctx) {
        data.n += 1;
        seen.push(ctx.players.map((p) => p.id));
      },
    };
    runTicks(createSim({ seed: 1, systems: [roster], players: 2 }), 1);
    expect(seen).toEqual([[0, 1], [0, 1]]);
  });

  it('queues for the next tick to run by default and delivers commands in queue order', () => {
    const sim = createSim({ seed: 1, systems: [recorder('a')] });
    runTicks(sim, 2);
    queueCommand(sim, { type: 'b', playerId: 0 });
    queueCommand(sim, { type: 'a', playerId: 0 }, 2);
    stepSim(sim);
    expect((sim.state.systems['a'] as Log).seen).toEqual(['a@0:', 'a@1:', 'a@2:b+a']);
  });
});

describe('restoreSim', () => {
  it('refuses duplicate system ids', () => {
    const sim = createSim({ seed: 1, systems: [recorder('a')] });
    expect(() => restoreSim(sim.state, [recorder('a'), recorder('a')])).toThrow(/duplicate system id/);
  });

  it('refuses data for a system it was not given', () => {
    const sim = createSim({ seed: 1, systems: [recorder('a'), recorder('b')] });
    expect(() => restoreSim(sim.state, [recorder('a')])).toThrow(/no system for the data under 'b'/);
  });

  it('requires data for every system', () => {
    const sim = createSim({ seed: 1, systems: [recorder('a')] });
    expect(() => restoreSim(sim.state, [recorder('a'), recorder('b')])).toThrow(/no data for system 'b'/);
  });
});
