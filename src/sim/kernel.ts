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
