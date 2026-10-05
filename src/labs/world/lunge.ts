/**
 * Play Pip (prototype)'s lunge: a short step forward that each hit of the combo carries him through around its strike,
 * on top of whatever his drive does, and the soft target assist that may turn it a little toward a target ahead and cut
 * it short of overrunning. Kept apart from three and the page so the unit test drives it directly; the page sweeps each
 * frame's share against the bodies and the area's edge (sweepMove, playMotion.ts).
 *
 * A hit's lunge follows a curve of metres along his facing by its clip time (LungeCurve): the clip's own root motion when
 * its build records one (rootMotionCurve, read from the sidecar's notes.root_motion or the clip's glTF extras), or the
 * scripted profile otherwise (ScriptedLunge). Pip's hand-keyed hits are authored in place, their boots planted by IK
 * (blender/recipes/commander_pip.py), so they take the scripted profile; Quaternius's sword combo, retargeted onto him,
 * brings per-clip root motion, which comes in by data alone. A clip that drives the lunge by its root motion must then
 * export with no root translation of its own, or the mixer and the lunge would both move him.
 */
import type { HitContract, HitName } from './combo';
import { groundDistance, groundToTangent, sweepMove, wrapAngle, yawOf, type Obstacle } from './playMotion';

/** How long before a hit's strike its scripted lunge begins, and how long after it the lunge ends, in seconds. */
export const LUNGE_LEAD = 0.12;
export const LUNGE_TAIL = 0.04;
/**
 * The assist looks for a target whose root stands within this angle of his facing, either side, and whose reach's
 * edge (its reach widened by his body, as he walks round it) is within ASSIST_RANGE of his root: a target he is already
 * squaring up to, close enough that a lunge could carry him to it.
 */
export const ASSIST_CONE_DEG = 40;
export const ASSIST_RANGE = 1.2;
/**
 * How far outside a target's core the assisted lunge stops, in metres: striking range, his body (PLAY_BODY_RADIUS) just
 * clear of the target's hump and thorax (its core, the arena's hit body), the blade through the body. 1 cm keeps the
 * last swept step off the core's edge. Measured from the target's whole reach, as it was (0.08 m short of it), the lunge
 * stopped where W already parks him, so in the arena's chain from contact the forehand lunged 0 m, the backhand 0.17 m
 * and the finisher 0.26 m against their 0.35 m and 0.55 m. Measured from the core, a chain from contact has the room the
 * light hits ask, and the finisher, which gets what the two knockbacks of 0.25 m leave after two lunges of 0.35 m, more.
 *
 * The Husk's reach is not its legs: at his hip height its head reaches 1.09 m and its mandibles 1.18 m in front of its
 * root, the legs only 0.55 m at the ground. Head on, his fist and belly therefore pass into its head and mandibles on
 * every lunge from contact (they already touch at contact), which a camera from the side shows and the play camera
 * straight behind him does not; the core keeps his body clear of the hump and thorax.
 */
export const ASSIST_GAP = 0.01;

/** A hit's scripted lunge: the window it runs in, in seconds into the hit's clip. */
export function lungeWindow(contract: HitContract): { from: number; to: number } {
  return { from: Math.max(0, contract.strike - LUNGE_LEAD), to: Math.min(contract.duration, contract.strike + LUNGE_TAIL) };
}

/**
 * How much of a hit's scripted lunge has been carried by a time into its clip, from 0 to 1: a smoothstep over the
 * window, so it starts and ends at rest and moves fastest a little before the strike (the window's middle), where the
 * blow's weight goes into the step.
 */
export function lungeShare(contract: HitContract, time: number): number {
  const { from, to } = lungeWindow(contract);
  if (time <= from) return 0;
  if (time >= to) return 1;
  const u = (time - from) / (to - from);
  return u * u * (3 - 2 * u);
}

/**
 * A hit's lunge as a curve of its clip time: `at(time)` is the metres along his facing it has carried him by then, from
 * 0 at the clip's start to `total` at its end, and `side(time)`, when the clip's root motion has a side part, the metres
 * to his right. The lunge plans its length against `total` and scales the curve by that length over `total`, so the
 * assist shortens the whole curve rather than cutting its end.
 */
export interface LungeCurve {
  at(time: number): number;
  side?(time: number): number;
  readonly total: number;
  /** 'root' for a clip's root-motion curve, 'scripted' for the profile. */
  readonly source: 'root' | 'scripted';
}

/**
 * The scripted profile as a curve: `metres` carried by lungeShare's smoothstep around the strike. A hit takes its curve
 * when it begins and keeps it, so a slider moved mid-hit lunges the next hit, not this one.
 */
export class ScriptedLunge implements LungeCurve {
  readonly source = 'scripted';
  constructor(
    readonly contract: HitContract,
    readonly total: number,
  ) {}

  at(time: number): number {
    return lungeShare(this.contract, time) * this.total;
  }
}

/**
 * A clip's root motion as the build records it, under the sidecar's `notes.root_motion.<clip>` (or as the clip's glTF
 * extras `root_motion`): sample times in seconds, ascending from 0; the metres moved along his facing at each, cumulative
 * from 0; and, optionally, the metres moved to his right at each, sampled alike.
 */
export interface RootMotion {
  times: number[];
  forward: number[];
  side?: number[];
}

const isFiniteList = (value: unknown): value is number[] => Array.isArray(value) && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));

/**
 * What is wrong with a root-motion record, or nothing: an object; `times` a list of two or more finite numbers starting
 * at 0 and rising strictly; `forward` a finite list as long, starting at 0; `side`, if given, the same. The lunge falls
 * back to the scripted profile on any fault, and the page names it.
 */
export function rootMotionFaults(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['not an object with times and forward'];
  const { times, forward, side } = value as Record<string, unknown>;
  const faults: string[] = [];
  if (!isFiniteList(times) || times.length < 2) faults.push('times must be two or more finite numbers');
  else {
    if (times[0] !== 0) faults.push(`times must start at 0, not ${times[0]}`);
    for (let i = 1; i < times.length; i++) {
      if (!(times[i]! > times[i - 1]!)) {
        faults.push(`times must rise strictly (${times[i - 1]} then ${times[i]})`);
        break;
      }
    }
  }
  const length = Array.isArray(times) ? times.length : -1;
  const track = (name: string, list: unknown, required: boolean): void => {
    if (list === undefined && !required) return;
    if (!isFiniteList(list)) faults.push(`${name} must be a list of finite numbers`);
    else if (list.length !== length) faults.push(`${name} has ${list.length} samples against ${length} times`);
    else if (list[0] !== 0) faults.push(`${name} must start at 0, not ${list[0]}`);
  };
  track('forward', forward, true);
  track('side', side, false);
  return faults;
}

/** A sampled track's value at `time`: straight lines between its samples, held at its first and last outside them. */
export function sampleTrack(times: readonly number[], values: readonly number[], time: number): number {
  const last = times.length - 1;
  if (!(time > times[0]!)) return values[0]!;
  if (time >= times[last]!) return values[last]!;
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= time) lo = mid;
    else hi = mid;
  }
  const u = (time - times[lo]!) / (times[hi]! - times[lo]!);
  return values[lo]! + (values[hi]! - values[lo]!) * u;
}

/** A valid root-motion record (rootMotionFaults finds nothing) as a lunge curve; its total is its last forward sample. */
export function rootMotionCurve(motion: RootMotion): LungeCurve {
  const times = [...motion.times];
  const forward = [...motion.forward];
  const side = motion.side ? [...motion.side] : null;
  return {
    source: 'root',
    total: forward[forward.length - 1]!,
    at: (time) => sampleTrack(times, forward, time),
    ...(side ? { side: (time: number) => sampleTrack(times, side, time) } : {}),
  };
}

/**
 * Each hit's root-motion curve, from the sidecar's `notes.root_motion` (`sidecar`, the parsed notes or null) and, for a
 * hit the sidecar does not name, the clip's glTF extras (`extras`, by clip name: GLTFLoader puts them in the clip's
 * userData). A record with a fault is named through `report` and left out, so that hit falls back to the scripted
 * profile.
 */
export function rootMotionCurves(
  names: readonly HitName[],
  sidecar: unknown,
  extras: Readonly<Partial<Record<HitName, unknown>>>,
  report: (said: string) => void,
): Partial<Record<HitName, LungeCurve>> {
  const recorded = typeof sidecar === 'object' && sidecar !== null ? (sidecar as { root_motion?: unknown }).root_motion : undefined;
  const fromSidecar = typeof recorded === 'object' && recorded !== null ? (recorded as Record<string, unknown>) : {};
  const curves: Partial<Record<HitName, LungeCurve>> = {};
  for (const name of names) {
    const [value, where] = name in fromSidecar ? [fromSidecar[name], 'the sidecar'] : [extras[name], "the clip's glTF extras"];
    if (value === undefined) continue;
    const faults = rootMotionFaults(value);
    if (faults.length) {
      report(`${name}'s root motion in ${where} is invalid (${faults.join('; ')}); its lunge falls back to the scripted profile`);
      continue;
    }
    curves[name] = rootMotionCurve(value as RootMotion);
  }
  return curves;
}

/** What a hit's lunge does, fixed on the frame it begins: its way, its length, the turn it adds, and its target. */
export interface LungePlan {
  /** The way he lunges, as a yaw (place()'s convention: a yaw of y faces (sin y, cos y)). */
  yaw: number;
  /** How far, in metres along the ground: the curve's total, or less where the assist cuts it. */
  length: number;
  /** The turn it carries him through over the lunge, in radians, added to his yaw by the same share as the step. */
  turn: number;
  /** The target the assist chose (its index in the list), or -1. */
  target: number;
}

/**
 * Plans a lunge of `distance` metres from (x, z) facing `yaw`. With an assist turn above 0, the nearest target whose
 * root lies within ASSIST_CONE_DEG of his facing and whose reach's edge is within ASSIST_RANGE draws it: he turns
 * toward its root by at most `assistTurn` radians over the lunge, and the lunge stops ASSIST_GAP outside the target's
 * core (its `core`, or its reach where it has none), never longer than `distance`, and not at all if he is already that
 * close. With no such target, or an assist turn of 0, he lunges straight ahead by the whole distance.
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
    plan.length = Math.min(Math.max(0, distance), Math.max(0, apart - (target.core ?? target.radius) - ASSIST_GAP));
  });
  return plan;
}

/**
 * A hit's lunge as it runs: its plan (made when its curve first moves), the curve's metres carried along his facing and
 * to his right, the share of the turn carried, the metres he actually moved, and whether a body stopped him.
 */
export interface LungeState {
  plan: LungePlan | null;
  done: number;
  sideDone: number;
  turned: number;
  moved: number;
  blocked: boolean;
}

export function freshLunge(): LungeState {
  return { plan: null, done: 0, sideDone: 0, turned: 0, moved: 0, blocked: false };
}

/** Forgets a lunge in place: a new hit plans its own. */
export function resetLunge(state: LungeState): void {
  Object.assign(state, freshLunge());
}

/** Where he stands and faces, which a lunge's frame starts from and writes back. */
export interface LungeStep {
  x: number;
  z: number;
  yaw: number;
}

/**
 * The bodies a lunge is swept against: each obstacle's core, where it has one, so the Husk's leg tips, which stop his
 * walk at the ground, are no wall at the height his body lunges through, and only its hump and thorax stop the lunge.
 * Written into `into`, one entry per obstacle, reused, so a frame builds nothing.
 */
export function lungeBodies(obstacles: readonly Obstacle[], into: Obstacle[]): Obstacle[] {
  into.length = obstacles.length;
  for (let i = 0; i < obstacles.length; i++) {
    const from = obstacles[i]!;
    const body = (into[i] ??= { x: 0, z: 0, radius: 0 });
    body.x = from.x;
    body.z = from.z;
    body.radius = from.core ?? from.radius;
  }
  return into;
}

/**
 * Carries a hit's lunge along `curve` by what `time` has reached since the last call, on top of what his drive moved him
 * to (x, z, yaw): planned when the curve first moves (planLunge, over `targets` with `assistTurn` radians, its length at
 * most the curve's total) from where he stands and faces then, scaled by the plan's length over the curve's total, and
 * swept against `bodies` (lungeBodies of the obstacles) and the area's edge (sweepMove), stopping for the rest of the hit
 * at the first that holds it. The turn the assist plans goes on by the share of the total carried. Writes the new place
 * and facing into `at` and keeps its own count in `state`. A time that has not moved (a hit-stop) carries nothing.
 */
export function stepLunge(
  state: LungeState,
  curve: LungeCurve,
  time: number,
  at: LungeStep,
  targets: readonly Obstacle[],
  bodies: readonly Obstacle[],
  assistTurn: number,
  planetRadius: number,
): void {
  const forward = curve.at(time);
  const side = curve.side ? curve.side(time) : 0;
  if (forward === state.done && side === state.sideDone) return;
  state.plan ??= planLunge(at.x, at.z, at.yaw, curve.total, targets, assistTurn);
  const plan = state.plan;
  const scale = curve.total > 0 ? plan.length / curve.total : 0;
  const ahead = (forward - state.done) * scale;
  const right = (side - state.sideDone) * scale;
  state.done = forward;
  state.sideDone = side;
  const share = curve.total > 0 ? Math.min(1, Math.max(0, forward / curve.total)) : 1;
  const turn = (share - state.turned) * plan.turn;
  state.turned = share;
  if (!state.blocked && (ahead !== 0 || right !== 0)) {
    // His right, facing (sin yaw, cos yaw) on a y-up frame, is (-cos yaw, sin yaw).
    const dx = Math.sin(plan.yaw) * ahead - Math.cos(plan.yaw) * right;
    const dz = Math.cos(plan.yaw) * ahead + Math.sin(plan.yaw) * right;
    const [tx, tz] = groundToTangent(at.x, at.z, dx, dz, planetRadius);
    const swept = sweepMove(at.x, at.z, tx, tz, bodies);
    state.moved += groundDistance(at.x, at.z, swept.x, swept.z, planetRadius);
    state.blocked = swept.blocked;
    at.x = swept.x;
    at.z = swept.z;
  }
  at.yaw = wrapAngle(at.yaw + turn);
}
