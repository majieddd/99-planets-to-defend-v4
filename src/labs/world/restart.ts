/**
 * Play Pip (prototype)'s restart into the combo's first hit, kept apart from three and the page so the unit test drives
 * it directly: which bones say how near his pose is to the hit's, how near two poses are, how far into the hit's wind-up
 * an entry may start, and the entry that matches best.
 *
 * A chain restarts when the first hit begins over the finisher, over a light hit's recovery clip, or from the guard idle.
 * It used to start the hit's clip at its first frame and crossfade into it linearly over 0.1 s from wherever he stood:
 * after the Quaternius spin finisher, whose pose at its cut stands 76 to 93 degrees from the forehand's early wind-up,
 * the blade whipped to the forehand's wind-up at 0.43 to 0.64 m a frame in his own frame (26 to 38 m/s, against 0.15 to
 * 0.28 m a frame through the chain's own crossfade from the forehand into the backhand) after a frame in which it had
 * moved 0.05 m, which the owner saw as the next swing popping back into hit 1. The restart now starts the hit at the
 * frame of its early wind-up that best matches the pose drawn (bestEntry), and blends into it longer and eased (combo.ts,
 * the restart blend); kept in the finisher, it waits for the pose to come near (RESTART_POSE_NEAR_DEG).
 */
import type { HitContract } from './combo';

/** A rotation as three's quaternion array, [x, y, z, w]. */
export type Quat = readonly [number, number, number, number];

/** The match bones' rotations in his root's frame, in RESTART_MATCH_BONES' order. */
export type MatchPose = readonly Quat[];

/**
 * The bones a restart compares, by the end of their names (GLTFLoader drops Mixamo's colon; `Spine` ends no other bone's
 * name, since Spine1 and Spine2 end in digits), each with its share of the distance: the sword hand and its forearm,
 * which aim the blade, most, and the three spine bones, which carry the shoulders, the rest. Each is compared by its
 * rotation in his root's frame, so a bone turned with the spine under it reads as turned, and his travel and facing on the
 * ground do not count.
 */
export const RESTART_MATCH_BONES: readonly { readonly name: string; readonly weight: number }[] = Object.freeze([
  { name: 'RightHand', weight: 0.4 },
  { name: 'RightForeArm', weight: 0.3 },
  { name: 'Spine2', weight: 0.1 },
  { name: 'Spine1', weight: 0.1 },
  { name: 'Spine', weight: 0.1 },
]);

/**
 * The share of the first hit's wind-up (its first moment up to its active frames, hitPhase's wind-up) a restart may enter
 * at: 0.4 of the Quaternius forehand's 0.217 s is 0.087 s, so its strike still comes 0.18 s or more after the restart.
 */
export const RESTART_SEARCH_SHARE = 0.4;

/**
 * How near the drawn pose must be to the first hit's best entry, as the weighted mean of the match bones' turns in
 * degrees (poseDistance), before a restart kept in the finisher's recovery fires; one that is not waits for the pose, up
 * to the finisher's end (combo.ts, stepCombo). The relaxed idle stands 29 degrees from the forehand's first frame, and a
 * chain's first swing from it, faded in over 0.07 s, is the one the owner called good, so a restart from no further
 * away blends over 0.2 s at least as gently. The spin finisher stands 76 to 93 degrees away at its recovery cut and comes
 * within 30 about 0.1 s later as it fades into the guard idle (15 degrees away).
 */
export const RESTART_POSE_NEAR_DEG = 30;

/** How many entries a second the search reads: one a frame at 60 frames a second, and its limit exactly. */
export const RESTART_SAMPLES_PER_SECOND = 60;

/** The angle between two rotations, in degrees, either sign of a quaternion being the same rotation. */
export function quatAngleDeg(a: Quat, b: Quat): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

/** How far apart two poses are: the match bones' turns between them in degrees, weighted by their shares. */
export function poseDistance(a: MatchPose, b: MatchPose): number {
  let sum = 0;
  let total = 0;
  RESTART_MATCH_BONES.forEach(({ weight }, index) => {
    const p = a[index];
    const q = b[index];
    if (!p || !q) return;
    sum += weight * quatAngleDeg(p, q);
    total += weight;
  });
  return total > 0 ? sum / total : 0;
}

/** The latest clip time a restart may enter a hit at: RESTART_SEARCH_SHARE of its wind-up. */
export function restartSearchLimit(contract: HitContract): number {
  return RESTART_SEARCH_SHARE * Math.max(0, contract.activeFrom);
}

/** The clip times the search reads, from 0 to `limit`: every RESTART_SAMPLES_PER_SECOND, and the limit itself. */
export function entryTimes(limit: number): number[] {
  const end = Math.max(0, limit);
  const times: number[] = [];
  for (let i = 0; i / RESTART_SAMPLES_PER_SECOND < end - 1e-9; i++) times.push(i / RESTART_SAMPLES_PER_SECOND);
  times.push(end);
  return times;
}

/** One entry the search may take: a clip time and the match bones' pose there. */
export interface EntrySample {
  time: number;
  pose: MatchPose;
}

/** Where a restart enters the first hit, in seconds into its clip, and how far the drawn pose is from the hit's there. */
export interface RestartEntry {
  at: number;
  distance: number;
}

/**
 * The entry that best matches `current`, among the samples no later than `limit`: the one whose pose the blend into it
 * crosses slowest, its distance over the seconds of blend it leaves (`blendFor`, the restart blend held inside the time
 * before the hit's active frames: combo.ts, restartFades), or simply the nearest when no blend is given. On a tie the
 * earlier, so a pose that matches the first frame as well as a later one keeps the whole wind-up. With no sample inside
 * the limit it enters at the first moment, at the distance to that sample (Infinity without one). The nearest alone took
 * the backhand recovery's pose into the forehand 0.083 s in, a few degrees nearer than its first frame, and the blend
 * then had 0.134 s before the active frames instead of 0.2 s, so the sword hand turned 28.6 degrees in a frame where the
 * straight crossfade had turned it 19.2.
 */
export function bestEntry(samples: readonly EntrySample[], current: MatchPose, limit: number, blendFor?: (at: number) => number): RestartEntry {
  let best: (RestartEntry & { score: number }) | null = null;
  for (const sample of samples) {
    if (sample.time > limit + 1e-9) continue;
    const distance = poseDistance(current, sample.pose);
    const score = blendFor ? distance / Math.max(1e-3, blendFor(sample.time)) : distance;
    if (!best || score < best.score - 1e-9) best = { at: sample.time, distance, score };
  }
  if (best) return { at: best.at, distance: best.distance };
  return { at: 0, distance: samples[0] ? poseDistance(current, samples[0].pose) : Infinity };
}
