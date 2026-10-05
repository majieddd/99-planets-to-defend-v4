import { Quaternion, Vector3, type Object3D } from 'three';

/**
 * A training dummy's reaction to a hit: a flinch, leaning its body back away from the blow and settling again, and a
 * knockback, eased out over a moment and swept through TrainingDummies.push, so it stops at Pip, a neighbour or the
 * area's edge. The Husk has no flinch clip, so the lean is procedural, on its `body` bone (the hump everything above its
 * legs hangs from), over the idle its mixer plays. Both run on the dummy's own clock, which a hit-stop holds for the
 * struck dummy, so the blow lands, time stops, and only then does it reel.
 */

/** The bone the flinch leans: the Husk's body, its hips, whose head stands 0.75 m up (blender/lib/rig.py CREATURE_LEFT). */
export const FLINCH_BONE = 'body';
/** Seconds from the hit to the lean's peak, and to the dummy standing back in its idle. */
export const FLINCH_RISE = 0.05;
export const FLINCH_SECONDS = 0.38;
/** The lean at its peak, in degrees: a light hit's, and the finisher's. */
export const FLINCH_LIGHT_DEG = 9;
export const FLINCH_FINISHER_DEG = 16;
/** Seconds a knockback takes, easing out: fast at the blow and settling. */
export const KNOCKBACK_SECONDS = 0.22;

/** The flinch's weight at `t` seconds after the hit, 0 to 1: up to its peak with an ease out, then down with an ease. */
export function flinchWeight(t: number): number {
  if (!(t > 0) || t >= FLINCH_SECONDS) return 0;
  if (t < FLINCH_RISE) {
    const u = t / FLINCH_RISE;
    return 1 - (1 - u) * (1 - u);
  }
  const u = (t - FLINCH_RISE) / (FLINCH_SECONDS - FLINCH_RISE);
  return 1 - u * u * (3 - 2 * u);
}

/** How much of a knockback has been carried by `t` seconds after the hit, 0 to 1: a cubic ease out. */
export function knockbackShare(t: number): number {
  if (!(t > 0)) return 0;
  if (t >= KNOCKBACK_SECONDS) return 1;
  const u = 1 - t / KNOCKBACK_SECONDS;
  return 1 - u * u * u;
}

/** One dummy's reaction as it runs: its clock, the way it was hit, how far it is pushed and how far it has gone. */
export interface Reaction {
  /** Seconds on the dummy's own clock since the hit; Infinity before any. */
  time: number;
  /** The way the blow pushes it on the tangent plane (unit), from Pip's root toward the dummy's. */
  dirX: number;
  dirZ: number;
  /** Metres the knockback carries it, and metres it has gone so far. */
  knock: number;
  moved: number;
  /** The share of the knockback carried so far, and whether a body or the edge stopped it. */
  share: number;
  blocked: boolean;
  /** The lean at the flinch's peak, in radians. */
  lean: number;
  /** The lean it had when this hit landed, in radians, which the new flinch rises from (0 from rest). */
  from: number;
}

export function idleReaction(): Reaction {
  return { time: Infinity, dirX: 0, dirZ: 0, knock: 0, moved: 0, share: 1, blocked: false, lean: 0, from: 0 };
}

/**
 * Starts a reaction in place: pushed `knock` metres away from (fromX, fromZ), leaning by `leanDeg` at the peak. A hit on a
 * dummy still reeling from the last starts its flinch from the lean it has, so the body never snaps upright at the
 * contact: started from rest each time, the backhand's contact stood the middle dummy up from 0.29 of its forehand lean
 * in one frame, and held it there through the stop.
 */
export function startReaction(reaction: Reaction, fromX: number, fromZ: number, atX: number, atZ: number, knock: number, leanDeg: number): void {
  const leaning = reactionLean(reaction);
  let dx = atX - fromX;
  let dz = atZ - fromZ;
  const length = Math.hypot(dx, dz);
  if (length < 1e-9) [dx, dz] = [0, 1];
  else [dx, dz] = [dx / length, dz / length];
  reaction.time = 0;
  reaction.dirX = dx;
  reaction.dirZ = dz;
  reaction.knock = Math.max(0, knock);
  reaction.moved = 0;
  reaction.share = 0;
  reaction.blocked = false;
  reaction.lean = (leanDeg * Math.PI) / 180;
  reaction.from = leaning;
}

/**
 * Advances a reaction by the dummy's step and returns the push this step asks for, in metres along its way (0 once it
 * is done or stopped); the caller sweeps it (TrainingDummies.push) and reports a shortfall with `stopped`.
 */
export function stepReaction(reaction: Reaction, dt: number): number {
  if (!Number.isFinite(reaction.time) || !(dt > 0)) return 0;
  reaction.time += dt;
  const share = knockbackShare(reaction.time);
  const ask = reaction.blocked ? 0 : (share - reaction.share) * reaction.knock;
  reaction.share = share;
  return ask;
}

/**
 * The lean the flinch puts on the dummy now, in radians: from the lean it had at the hit up to the peak over FLINCH_RISE
 * (flinchWeight's rise), then down to rest as flinchWeight falls.
 */
export function reactionLean(reaction: Reaction): number {
  const t = reaction.time;
  if (!Number.isFinite(t)) return 0;
  if (t < FLINCH_RISE) return reaction.from + (reaction.lean - reaction.from) * flinchWeight(Math.max(t, 0));
  return reaction.lean * flinchWeight(t);
}

const parentTurn = new Quaternion();
const lean = new Quaternion();
const axis = new Vector3();

/**
 * Leans a bone back from a blow by `angle` radians: about the ground axis square to the push, through the bone's own
 * head, so its top goes the way the push goes. It turns the bone's rotation as it stands, in its parent's frame, so call
 * it with the parent's world matrix current, and through BoneLean, which takes last frame's lean off first. `up` is the
 * ground's up at the dummy, and (dirX, dirZ) the push on the tangent plane, taken as world x and z, as the arena's level
 * ground near the pole allows.
 */
export function leanBone(bone: Object3D, up: Vector3, dirX: number, dirZ: number, angle: number): void {
  if (!bone.parent || angle === 0) return;
  // Turning about up x push carries up toward the push: (up x p) x up = p for a push square to up.
  axis.set(up.y * dirZ, up.z * dirX - up.x * dirZ, -up.y * dirX);
  if (axis.lengthSq() < 1e-12) return;
  axis.normalize().applyQuaternion(bone.parent.getWorldQuaternion(parentTurn).invert());
  bone.quaternion.premultiply(lean.setFromAxisAngle(axis, angle));
}

/**
 * One bone's flinch lean, laid over its mixer's pose frame by frame. three's mixer writes a bone only when the pose it
 * works out differs from the one it worked out the frame before, so on a held clock (a hit-stop, or the lab frozen) it
 * writes nothing, and a lean laid on again each frame built up: frozen in the arena, the struck Husk reared up past 70
 * degrees within a second. So each frame the lean it laid last is taken off first, wherever the mixer left the bone as
 * the lean put it, and the bone's own pose is what the new lean turns.
 */
export class BoneLean {
  private readonly clean = new Quaternion();
  private readonly written = new Quaternion();
  private leaned = false;

  constructor(readonly bone: Object3D) {}

  /** Call on every frame after the mixer's update, with the lean now (0 once the flinch is over). */
  apply(up: Vector3, dirX: number, dirZ: number, angle: number): void {
    if (this.leaned && this.bone.quaternion.equals(this.written)) this.bone.quaternion.copy(this.clean);
    this.leaned = false;
    if (angle === 0) return;
    this.clean.copy(this.bone.quaternion);
    leanBone(this.bone, up, dirX, dirZ, angle);
    this.written.copy(this.bone.quaternion);
    this.leaned = true;
  }
}
