/**
 * Play Pip (prototype)'s lunge: a short step forward that each hit of the combo carries him through around its strike,
 * on top of whatever his drive does, and the soft target assist that may turn it a little toward a target ahead and cut
 * it short of overrunning. Kept apart from three and the page so the unit test drives it directly; the page sweeps each
 * frame's share against the bodies and the area's edge (sweepMove, playMotion.ts).
 *
 * The lunge is scripted rather than taken from the clips: the hits are authored in place, their boots planted by IK
 * (blender/recipes/commander_pip.py), so a root motion would have to be added to all three and the finisher's step
 * re-solved; a displacement over the moments around the strike gives the same read without touching the clips.
 */
import type { HitContract } from './combo';
import { groundDistance, groundToTangent, sweepMove, wrapAngle, yawOf, type Obstacle } from './playMotion';

/** How long before a hit's strike its lunge begins, and how long after it the lunge ends, in seconds. */
export const LUNGE_LEAD = 0.12;
export const LUNGE_TAIL = 0.04;
/**
 * The assist looks for a target whose root stands within this angle of his facing, either side, and whose body's near
 * edge (its reach widened by his body, as he walks round it) is within ASSIST_RANGE of his root: a target he is already
 * squaring up to, close enough that a lunge could carry him to it.
 */
export const ASSIST_CONE_DEG = 40;
export const ASSIST_RANGE = 1.2;
/**
 * How far short of a target's reach the assisted lunge stops, in metres, so it ends at striking range rather than in
 * the reach, where the swept move would stop it anyway but slide him round the body as it did.
 */
export const ASSIST_GAP = 0.08;

/** A hit's lunge: the window it runs in, in seconds into the hit's clip. */
export function lungeWindow(contract: HitContract): { from: number; to: number } {
  return { from: Math.max(0, contract.strike - LUNGE_LEAD), to: Math.min(contract.duration, contract.strike + LUNGE_TAIL) };
}

/**
 * How much of a hit's lunge has been carried by a time into its clip, from 0 to 1: a smoothstep over the window, so it
 * starts and ends at rest and moves fastest a little before the strike (the window's middle), where the blow's weight
 * goes into the step.
 */
export function lungeShare(contract: HitContract, time: number): number {
  const { from, to } = lungeWindow(contract);
  if (time <= from) return 0;
  if (time >= to) return 1;
  const u = (time - from) / (to - from);
  return u * u * (3 - 2 * u);
}

/** What a hit's lunge does, fixed on the frame it begins: its way, its length, the turn it adds, and its target. */
export interface LungePlan {
  /** The way he lunges, as a yaw (place()'s convention: a yaw of y faces (sin y, cos y)). */
  yaw: number;
  /** How far, in metres along the ground. */
  length: number;
  /** The turn it carries him through over the lunge, in radians, added to his yaw by the same share as the step. */
  turn: number;
  /** The target the assist chose (its index in the list), or -1. */
  target: number;
}

/**
 * Plans a lunge of `distance` metres from (x, z) facing `yaw`. With an assist turn above 0, the nearest target whose
 * root lies within ASSIST_CONE_DEG of his facing and whose reach's edge is within ASSIST_RANGE draws it: he turns
 * toward its root by at most `assistTurn` radians over the lunge, and the lunge stops ASSIST_GAP short of the target's
 * reach (its radius as an obstacle), never longer than `distance`, and not at all if he is already that close. With no
 * such target, or an assist turn of 0, he lunges straight ahead by the whole distance.
 */
export function planLunge(x: number, z: number, yaw: number, distance: number, targets: readonly Obstacle[], assistTurn: number): LungePlan {
  const plan: LungePlan = { yaw, length: Math.max(0, distance), turn: 0, target: -1 };
  if (!(assistTurn > 0) || plan.length === 0) return plan;
  const cone = (ASSIST_CONE_DEG * Math.PI) / 180;
  let best = Infinity;
  targets.forEach((target, index) => {
    const dx = target.x - x;
    const dz = target.z - z;
    const apart = Math.hypot(dx, dz);
    const edge = apart - target.radius;
    if (edge > ASSIST_RANGE || apart < 1e-9) return;
    const off = wrapAngle(yawOf(dx, dz) - yaw);
    if (Math.abs(off) > cone || edge >= best) return;
    best = edge;
    plan.target = index;
    plan.turn = Math.sign(off) * Math.min(Math.abs(off), assistTurn);
    plan.yaw = wrapAngle(yaw + plan.turn);
    plan.length = Math.min(Math.max(0, distance), Math.max(0, edge - ASSIST_GAP));
  });
  return plan;
}

/** A hit's lunge as it runs: its plan (made when its window opens), its share carried, its metres, and whether stopped. */
export interface LungeState {
  plan: LungePlan | null;
  done: number;
  moved: number;
  blocked: boolean;
}

export function freshLunge(): LungeState {
  return { plan: null, done: 0, moved: 0, blocked: false };
}

/** What the lunge asks of a frame: where he stands and faces, and the hit's contract and time into it. */
export interface LungeStep {
  x: number;
  z: number;
  yaw: number;
}

/**
 * Carries a hit's lunge by the share of its window that `time` has reached since the last call, on top of what his
 * drive moved him to (x, z, yaw): planned when the window opens (planLunge, over `targets` with `assistTurn` radians),
 * from where he stands and faces then, and swept against `obstacles` and the area's edge (sweepMove), stopping for the
 * rest of the hit at the first that holds it. The turn the assist plans goes on by the same share. Writes the new place
 * and facing into `at` and keeps its own count in `state`. A time that has not moved (a hit-stop) carries nothing.
 */
export function stepLunge(
  state: LungeState,
  contract: HitContract,
  time: number,
  distance: number,
  at: LungeStep,
  targets: readonly Obstacle[],
  obstacles: readonly Obstacle[],
  assistTurn: number,
  planetRadius: number,
): void {
  const share = lungeShare(contract, time);
  if (!(share > state.done)) return;
  state.plan ??= planLunge(at.x, at.z, at.yaw, distance, targets, assistTurn);
  const plan = state.plan;
  const part = share - state.done;
  state.done = share;
  if (!state.blocked && plan.length > 0) {
    const along = part * plan.length;
    const [tx, tz] = groundToTangent(at.x, at.z, Math.sin(plan.yaw) * along, Math.cos(plan.yaw) * along, planetRadius);
    const swept = sweepMove(at.x, at.z, tx, tz, obstacles);
    state.moved += groundDistance(at.x, at.z, swept.x, swept.z, planetRadius);
    state.blocked = swept.blocked;
    at.x = swept.x;
    at.z = swept.z;
  }
  at.yaw = wrapAngle(at.yaw + part * plan.turn);
}
