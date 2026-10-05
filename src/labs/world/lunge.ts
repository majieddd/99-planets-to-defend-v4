/**
 * Play Pip (prototype)'s lunge: the step forward each hit of the combo carries him through around its strike, on top of
 * whatever his drive does, and the soft target assist that may turn it a little toward a target ahead and cut it short
 * of overrunning. Kept apart from three and the page so the unit test drives it directly; the page sweeps each frame's
 * share against the bodies and the area's edge (sweepMove, playMotion.ts).
 *
 * A hit's lunge follows a curve of metres along his facing by its clip time (LungeCurve): the clip's own root motion when
 * its build records one (rootMotionCurve, read from the sidecar's notes.root_motion or the clip's glTF extras), or the
 * scripted profile otherwise (ScriptedLunge). Pip's hand-keyed hits are authored in place, their boots planted by IK
 * (blender/recipes/commander_pip.py), so they take the scripted profile; Quaternius's sword combo, retargeted onto him,
 * brings per-clip root motion (the forehand 0.75 m, the backhand a 6 cm step back, the spin finisher 1.47 m, and the
 * light hits' recovery clips 0.31 and 0.38 m), which comes in by data alone. A clip that drives the lunge by its root
 * motion exports with no root translation of its own, or the mixer and the lunge would both move him.
 *
 * The lunge and his drive combine without double-moving him (blendRootStep): along the lunge's way he travels the
 * larger of the two on each frame, never their sum, so a hit swung on the move carries him no further than the faster
 * of his walk and the clip's own step, and his legs, which run under the swinging arms, keep the walk's pace when it is
 * the faster. A step back is added as recorded, since it can only slow him.
 */
import type { HitContract } from './combo';
import { groundDistance, groundToTangent, obstacleGap, sweepMove, wrapAngle, yawOf, type Obstacle } from './playMotion';

/** How long before a hit's strike its scripted lunge begins, and how long after it the lunge ends, in seconds. */
export const LUNGE_LEAD = 0.12;
export const LUNGE_TAIL = 0.04;
/**
 * The assist looks for a target whose root stands within this angle of his facing, either side, and whose edge (its
 * footprint, widened by his reach, as he walks round it) is within ASSIST_RANGE of his root: a target he is already
 * squaring up to, close enough that a lunge could carry him to it.
 */
export const ASSIST_CONE_DEG = 40;
export const ASSIST_RANGE = 1.2;
/**
 * How far outside a target's footprint the assisted lunge stops, in metres: 1 cm keeps the last swept step off its edge.
 * The footprint is the Husk's own shape widened by his reach in a swing (labs/combat/footprint.ts), so the lunge stops
 * where his fists and belly meet its head or body, the blade through it. Phase B stopped the lunge at a round core of
 * half the dummy's reach, which kept his body off the hump and thorax but put his fist and belly about 0.5 m into the
 * head and mandibles on the finisher, which reach 1.18 m in front of the root at his hip height.
 */
export const ASSIST_GAP = 0.01;
/** How finely the assist reads where the lunge's way meets a target's footprint, in metres (footprintEntry). */
export const ENTRY_STEP = 0.02;

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
 * A lunge as a curve of its clip time: `at(time)` is the metres along his facing it has carried him by then, from 0 at
 * the clip's start to `total` at its end, and `side(time)`, when the clip's root motion has a side part, the metres to
 * his right. `reach` is the farthest ahead the curve ever carries him (0 for a curve that only steps back); the lunge
 * plans its length against it and scales the curve by that length over the reach, so the assist shortens the whole
 * curve rather than cutting its end.
 */
export interface LungeCurve {
  at(time: number): number;
  side?(time: number): number;
  readonly total: number;
  readonly reach: number;
  /** 'root' for a clip's root-motion curve, 'scripted' for the profile. */
  readonly source: 'root' | 'scripted';
}

/**
 * The scripted profile as a curve: `metres` carried by lungeShare's smoothstep around the strike. A hit takes its curve
 * when it begins and keeps it, so a slider moved mid-hit lunges the next hit, not this one.
 */
export class ScriptedLunge implements LungeCurve {
  readonly source = 'scripted';
  readonly reach: number;
  constructor(
    readonly contract: HitContract,
    readonly total: number,
  ) {
    this.reach = Math.max(0, total);
  }

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

/** One frame at the clips' 30 fps: how far a record's last sample may stand from its clip's end. */
export const ROOT_MOTION_END_TOLERANCE = 1 / 30;

const isFiniteList = (value: unknown): value is number[] => Array.isArray(value) && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));

/**
 * What is wrong with a root-motion record, or nothing: an object; `times` a list of two or more finite numbers starting
 * at 0 and rising strictly, its last within a frame of its clip's length (`clipDuration`, when known); `forward` a
 * finite list as long, starting at 0; `side`, if given, the same. The lunge falls back to the scripted profile on any
 * fault, and the page names it. A record that ended short of its clip used to be taken as it was, and its last sample
 * then held him still through the rest of the clip while its feet, placed for the travel, slid.
 */
export function rootMotionFaults(value: unknown, clipDuration?: number): string[] {
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
    const last = times[times.length - 1]!;
    if (clipDuration !== undefined && Number.isFinite(clipDuration) && Math.abs(last - clipDuration) > ROOT_MOTION_END_TOLERANCE) {
      faults.push(`its last sample at ${last} s misses the clip's ${clipDuration.toFixed(3)} s by more than a frame`);
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

/**
 * A valid root-motion record (rootMotionFaults finds nothing) as a lunge curve: its total is its last forward sample,
 * its reach its farthest forward sample (0 when it never moves ahead).
 */
export function rootMotionCurve(motion: RootMotion): LungeCurve {
  const times = [...motion.times];
  const forward = [...motion.forward];
  const side = motion.side ? [...motion.side] : null;
  return {
    source: 'root',
    total: forward[forward.length - 1]!,
    reach: Math.max(0, ...forward),
    at: (time) => sampleTrack(times, forward, time),
    ...(side ? { side: (time: number) => sampleTrack(times, side, time) } : {}),
  };
}

/** How a record's travel is reported: a fault drops it (the scripted profile stands in), a note keeps it. */
export type RootMotionReport = 'fault' | 'note';

/**
 * Each clip's root-motion curve, from the sidecar's `notes.root_motion` (`sidecar`, the parsed notes or null) and, for a
 * clip the sidecar does not name, the clip's glTF extras (`extras`, by clip name: GLTFLoader puts them in the clip's
 * userData); where both name a clip the sidecar's is taken, since the build writes it beside the GLB it measured. A
 * record with a fault (rootMotionFaults, its clip's length from `durations`) is named through `report` and left out, so
 * that clip falls back to the scripted profile. A record whose total is not ahead of 0 (a step back, or a clip in place)
 * is kept and noted: phase B planned a lunge from the total, so a total of 0 or less scaled the curve to nothing and the
 * step was dropped without a word; the lunge now plans from the curve's reach and plays a step back as recorded.
 */
export function rootMotionCurves(
  names: readonly string[],
  sidecar: unknown,
  extras: Readonly<Record<string, unknown>>,
  report: (said: string, kind: RootMotionReport) => void,
  durations: Readonly<Record<string, number>> = {},
): Record<string, LungeCurve> {
  const recorded = typeof sidecar === 'object' && sidecar !== null ? (sidecar as { root_motion?: unknown }).root_motion : undefined;
  const fromSidecar = typeof recorded === 'object' && recorded !== null ? (recorded as Record<string, unknown>) : {};
  const curves: Record<string, LungeCurve> = {};
  for (const name of names) {
    const [value, where] = name in fromSidecar ? [fromSidecar[name], 'the sidecar'] : [extras[name], "the clip's glTF extras"];
    if (value === undefined) continue;
    const faults = rootMotionFaults(value, durations[name]);
    if (faults.length) {
      report(`${name}'s root motion in ${where} is invalid (${faults.join('; ')}); its lunge falls back to the scripted profile`, 'fault');
      continue;
    }
    const curve = rootMotionCurve(value as RootMotion);
    if (!(curve.total > 0)) {
      report(`${name}'s root motion in ${where} ends ${curve.total.toFixed(3)} m along his facing, not ahead of where it began; it plays as recorded and the assist has nothing to shorten`, 'note');
    }
    curves[name] = curve;
  }
  return curves;
}

/** What a hit's lunge does, fixed on the frame it begins: its way, its length, the turn it adds, and its target. */
export interface LungePlan {
  /** The way he lunges, as a yaw (place()'s convention: a yaw of y faces (sin y, cos y)). */
  yaw: number;
  /** How far ahead at most, in metres along the ground: the curve's reach, or less where the assist cuts it. */
  length: number;
  /** The turn it carries him through over the lunge, in radians, added to his yaw by the same share as the step. */
  turn: number;
  /** The target the assist chose (its index in the list), or -1. */
  target: number;
}

/**
 * How far along a way (dirX, dirZ) from (x, z) a target's footprint begins (obstacleGap at 0 or below), read in steps of
 * ENTRY_STEP and narrowed between the last step outside and the first inside, up to `limit` metres; Infinity when it
 * does not begin within that, and 0 from a start already inside.
 */
export function footprintEntry(x: number, z: number, dirX: number, dirZ: number, target: Obstacle, limit: number): number {
  if (obstacleGap(target, x, z) <= 0) return 0;
  let outside = 0;
  for (let s = ENTRY_STEP; s < limit + ENTRY_STEP; s += ENTRY_STEP) {
    const at = Math.min(s, limit);
    if (obstacleGap(target, x + dirX * at, z + dirZ * at) > 0) {
      outside = at;
      if (at >= limit) break;
      continue;
    }
    let inside = at;
    for (let i = 0; i < 12; i++) {
      const mid = (outside + inside) / 2;
      if (obstacleGap(target, x + dirX * mid, z + dirZ * mid) > 0) outside = mid;
      else inside = mid;
    }
    return inside;
  }
  return Infinity;
}

/**
 * Plans a lunge reaching `reach` metres ahead from (x, z) facing `yaw`. With an assist turn above 0, the nearest target
 * whose root lies within ASSIST_CONE_DEG of his facing and whose footprint is within ASSIST_RANGE draws it: he turns
 * toward its root by at most `assistTurn` radians, and the lunge stops ASSIST_GAP outside its footprint along the turned
 * way (footprintEntry), never further than `reach`, and not at all if he is already that close. With no such target, or
 * an assist turn of 0, he lunges straight ahead by the whole reach.
 */
export function planLunge(x: number, z: number, yaw: number, reach: number, targets: readonly Obstacle[], assistTurn: number): LungePlan {
  const plan: LungePlan = { yaw, length: Math.max(0, reach), turn: 0, target: -1 };
  if (!(assistTurn > 0) || plan.length === 0) return plan;
  const cone = (ASSIST_CONE_DEG * Math.PI) / 180;
  let best = Infinity;
  targets.forEach((target, index) => {
    const dx = target.x - x;
    const dz = target.z - z;
    const apart = Math.hypot(dx, dz);
    const edge = obstacleGap(target, x, z);
    if (edge > ASSIST_RANGE || apart < 1e-9) return;
    const off = wrapAngle(yawOf(dx, dz) - yaw);
    if (Math.abs(off) > cone || edge >= best) return;
    best = edge;
    plan.target = index;
    plan.turn = Math.sign(off) * Math.min(Math.abs(off), assistTurn);
    plan.yaw = wrapAngle(yaw + plan.turn);
  });
  if (plan.target >= 0) {
    const target = targets[plan.target]!;
    const entry = footprintEntry(x, z, Math.sin(plan.yaw), Math.cos(plan.yaw), target, Math.max(0, reach) + ASSIST_GAP);
    plan.length = Math.min(Math.max(0, reach), Math.max(0, entry - ASSIST_GAP));
  }
  return plan;
}

/**
 * A hit's lunge as it runs: its plan (made when its curve first moves), the curve's metres carried along his facing and
 * to his right, the share of the turn carried, the metres he actually moved, and whether a body stopped him; and where
 * the hit entered its clip (startLunge): the curve's metres ahead there, which the plan's reach counts from, and the
 * turn's share there, which the turn counts from (both 0 for a hit begun at its first moment).
 */
export interface LungeState {
  plan: LungePlan | null;
  done: number;
  sideDone: number;
  turned: number;
  moved: number;
  blocked: boolean;
  from: number;
  turnFrom: number;
}

export function freshLunge(): LungeState {
  return { plan: null, done: 0, sideDone: 0, turned: 0, moved: 0, blocked: false, from: 0, turnFrom: 0 };
}

/** Forgets a lunge in place: a new hit plans its own. */
export function resetLunge(state: LungeState): void {
  Object.assign(state, freshLunge());
}

/** The share of a lunge's turn a time into its clip has reached: by the curve's progress, and whole by `turnBy`. */
function turnShare(curve: LungeCurve, time: number, forward: number, turnBy: number): number {
  return Math.max(curve.reach > 0 ? Math.min(1, Math.max(0, forward / curve.reach)) : 1, Math.min(1, Math.max(0, time / turnBy)));
}

/**
 * Starts a lunge at `time` into its clip, where a restart entered it (restart.ts): the curve's metres there count as
 * carried already, so its first step moves him only by what the curve moves after the entry, from wherever he stands,
 * and the assist plans from the reach left and turns him by the share of its turn left. Begun at 0, as every hit was, a
 * restart entering the forehand 0.083 s in would have carried him the 0.29 m its root motion covers by then on its first
 * frame, and turned him at once by the share of the assist's turn the entry had passed.
 */
export function startLunge(state: LungeState, curve: LungeCurve, time: number, turnBy = Infinity): void {
  resetLunge(state);
  if (!(time > 0)) return;
  state.from = state.done = curve.at(time);
  state.sideDone = curve.side ? curve.side(time) : 0;
  state.turnFrom = turnShare(curve, time, state.from, turnBy);
}

/** Where he stands and faces, which a lunge's frame starts from and writes back. */
export interface LungeStep {
  x: number;
  z: number;
  yaw: number;
}

/**
 * What a lunge's step adds along its way once his drive has moved him `driven` metres along it this frame: for a step
 * ahead, only what the drive did not already cover, so he travels the larger of the two and never their sum (a light hit
 * swung at the walk's 0.4 pace, 1.28 m/s, against the forehand's root motion, which peaks near 4.5 m/s, moves at the
 * clip's speed while it is the faster and at the walk's after); a step back in full, since it only slows him. Summed, as
 * phase B's scripted lunge was, a hit on the move carried him its whole lunge on top of the walk, and with the
 * Quaternius clips' 0.75 m and 1.47 m of travel he would have surged through every swing.
 */
export function blendRootStep(step: number, driven: number): number {
  return step > 0 ? Math.max(0, step - Math.max(0, driven)) : step;
}

/**
 * Carries a lunge along `curve` by what `time` has reached since the last call, on top of what his drive moved him to
 * (x, z, yaw): planned when the curve first moves (planLunge, over `targets` with `assistTurn` radians, reaching at most
 * the curve's reach) from where he stands and faces then, scaled by the plan's length over the curve's reach, combined
 * with the drive (blendRootStep; `driven` is the metres and the way his drive moved him this frame), and swept against
 * `obstacles` (each dummy's footprint widened by his reach, as his walk is) and the area's edge (sweepMove), stopping
 * for the rest of the hit at the first that holds it. The turn the assist plans goes on by the share of the reach
 * carried. Writes the new place and facing into `at` and keeps its own count in `state`. A time that has not moved (a
 * hit-stop) carries nothing.
 */
export function stepLunge(
  state: LungeState,
  curve: LungeCurve,
  time: number,
  at: LungeStep,
  targets: readonly Obstacle[],
  obstacles: readonly Obstacle[],
  assistTurn: number,
  planetRadius: number,
  driven: { metres: number; yaw: number } = { metres: 0, yaw: 0 },
  turnBy = Infinity,
): void {
  const forward = curve.at(time);
  const side = curve.side ? curve.side(time) : 0;
  if (forward === state.done && side === state.sideDone) return;
  // The reach left from where the hit entered its clip: the whole reach for a hit begun at its first moment.
  const reach = Math.max(0, curve.reach - state.from);
  state.plan ??= planLunge(at.x, at.z, at.yaw, reach, targets, assistTurn);
  const plan = state.plan;
  const scale = reach > 0 ? plan.length / reach : 1;
  const along = (forward - state.done) * scale;
  const right = (side - state.sideDone) * scale;
  state.done = forward;
  state.sideDone = side;
  // The turn goes on with the curve's progress, and is whole by `turnBy` (a hit's active frames, where his facing locks)
  // whatever the curve has done. It followed the curve alone, so the scripted lunge, whose curve runs to 0.04 s past
  // the strike, went on turning him through the active frames his facing is locked for, and a root-motion curve that
  // had not moved far by then left the turn part done at the strike.
  // Counted from the share where the hit entered its clip, so a restart's entry is not turned through at once.
  const reached = turnShare(curve, time, forward, turnBy);
  const share = state.turnFrom < 1 ? Math.min(1, Math.max(0, (reached - state.turnFrom) / (1 - state.turnFrom))) : 1;
  const turn = (share - state.turned) * plan.turn;
  state.turned = share;
  const ahead = blendRootStep(along, driven.metres * Math.cos(wrapAngle(driven.yaw - plan.yaw)));
  if (!state.blocked && (ahead !== 0 || right !== 0)) {
    // His right, facing (sin yaw, cos yaw) on a y-up frame, is (-cos yaw, sin yaw).
    const dx = Math.sin(plan.yaw) * ahead - Math.cos(plan.yaw) * right;
    const dz = Math.cos(plan.yaw) * ahead + Math.sin(plan.yaw) * right;
    const [tx, tz] = groundToTangent(at.x, at.z, dx, dz, planetRadius);
    const swept = sweepMove(at.x, at.z, tx, tz, obstacles);
    state.moved += groundDistance(at.x, at.z, swept.x, swept.z, planetRadius);
    state.blocked = swept.blocked;
    at.x = swept.x;
    at.z = swept.z;
  }
  at.yaw = wrapAngle(at.yaw + turn);
}
