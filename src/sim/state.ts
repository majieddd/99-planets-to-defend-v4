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
