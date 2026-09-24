import { parseArgs } from 'node:util';
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
  // Report what the kernel ran, not what it was asked: createSim keeps seed >>> 0 and the loop rounds a
  // fractional count up, so echoing the options printed seed=-1 ticks=1.5 for seed 4294967295 over 2 ticks.
  return { seed: sim.state.seed, ticks: sim.state.tick, hash: hashState(sim.state), events, ms: Math.round(now() - started) };
}

export function formatResult(result: BotResult): string {
  return `bot result: seed=${result.seed} ticks=${result.ticks} hash=${result.hash} events=${result.events} ms=${result.ms}`;
}

/**
 * The CLI arguments. Anything unrecognised throws: an indexOf lookup ignored `--seed=555`, `--planets 20`
 * and the bare values npm passes when the `--` is forgotten, then printed a true line for the default run.
 */
export function parseBotArgs(args: string[]): { seed: number; ticks: number } {
  const { values } = parseArgs({
    args,
    options: { seed: { type: 'string' }, ticks: { type: 'string' } },
    strict: true,
    allowPositionals: false,
  });
  // Ten simulated minutes by default.
  return {
    seed: wholeNumber('seed', values.seed, 1, 0xffff_ffff),
    ticks: wholeNumber('ticks', values.ticks, 36_000, Number.MAX_SAFE_INTEGER),
  };
}

function wholeNumber(name: string, raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  // Number('') is 0, and the kernel and the loop quietly coerce fractions, negatives and overflow.
  if (!/^\d+$/.test(raw) || value > max) throw new Error(`--${name} needs a whole number from 0 to ${max}, got '${raw}'`);
  return value;
}
