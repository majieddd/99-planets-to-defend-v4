import { AnimationClip, InterpolateBezier, PropertyBinding, type Interpolant, type InterpolationModes, type KeyframeTrack, type Object3D } from 'three';
import { placeholderAnchors, warpTime, type HitContract, type WarpAnchors } from './combo';

/**
 * The bone the upper-body mask starts from: Play Pip's attacks play on this bone and everything under it, while the hips
 * and legs keep the locomotion blend. Pip's rig (Mixamo names, the loader dropping their colon) hangs mixamorigSpine,
 * Spine1, Spine2, both shoulders, arms, forearms and hands, the neck, the head, the jaw and HeadTop_End under it, and the
 * hips carry the two legs (UpLeg, Leg, Foot, ToeBase) beside it. The sword and the shield have no bones of their own:
 * they are skinned to the hands, which the mask holds. The first bone whose name ends with this is taken, so Spine1 and
 * Spine2, which end otherwise, never stand in for it.
 */
export const UPPER_BODY_ROOT = 'Spine';

/**
 * How many times a second a placeholder hit is sampled from the source clip: twice the source's 30, so the warp's faster
 * stretches still show each source key, and the strike moment and the end are sampled exactly as well.
 */
export const PLACEHOLDER_SAMPLES_PER_SECOND = 60;

/** Where a hit's clip came from: the GLB itself, or a placeholder warped at runtime from the attack clip. */
export type HitSource = 'clip' | 'placeholder';

export interface HitClip {
  contract: HitContract;
  clip: AnimationClip;
  source: HitSource;
  /** The clip's length less its contract's, in seconds: 0 for a placeholder, which is warped to the contract exactly. */
  lengthOff: number;
}

/** The names of the upper-body mask's nodes: the UPPER_BODY_ROOT bone and everything under it, or null without one. */
export function upperBodyBones(root: Object3D): Set<string> | null {
  let spine: Object3D | null = null;
  root.traverse((node) => {
    if (!spine && (node as Object3D & { isBone?: boolean }).isBone && node.name.endsWith(UPPER_BODY_ROOT)) spine = node;
  });
  if (!spine) return null;
  const names = new Set<string>();
  (spine as Object3D).traverse((node) => names.add(node.name));
  return names;
}

/** A track's interpolant factory, which three sets on every track but its type declarations leave out. */
type InterpolantFactory = (() => Interpolant) & { isInterpolantFactoryMethodGLTFCubicSpline?: boolean };

/**
 * A track's own interpolant, the one the mixer samples it with (a quaternion track's slerps). three sets
 * createInterpolant on every track from its interpolation mode at construction, and GLTFLoader replaces it with a cubic
 * spline interpolant for a CUBICSPLINE sampler.
 */
function interpolantOf(track: KeyframeTrack): Interpolant {
  return (track as KeyframeTrack & { createInterpolant: InterpolantFactory }).createInterpolant();
}

/**
 * The size of one sampled value of a track. A glTF CUBICSPLINE track stores three values per key (the in tangent, the
 * value and the out tangent), so its getValueSize() is three times what its interpolant returns: read at that size, a
 * warp of a cubic track read two values past each sample into NaN. GLTFLoader marks such a track's interpolant factory.
 */
function sampleSize(track: KeyframeTrack): number {
  const factory = (track as KeyframeTrack & { createInterpolant: InterpolantFactory }).createInterpolant;
  return factory.isInterpolantFactoryMethodGLTFCubicSpline ? track.getValueSize() / 3 : track.getValueSize();
}

/** The node a track animates, as the mixer binds it. */
function trackNode(track: KeyframeTrack): string {
  return PropertyBinding.parseTrackName(track.name).nodeName;
}

/**
 * Splits a clip into the tracks on the upper-body mask's nodes and the rest (the hips and legs, and any track on a node
 * outside the rig's bones). The mixer weighs a whole action, so the halves are separate clips the page weighs apart.
 */
export function splitClip(clip: AnimationClip, upper: ReadonlySet<string>): { upper: AnimationClip; lower: AnimationClip } {
  const above = clip.tracks.filter((track) => upper.has(trackNode(track)));
  const below = clip.tracks.filter((track) => !upper.has(trackNode(track)));
  return { upper: new AnimationClip(`${clip.name}_upper`, clip.duration, above), lower: new AnimationClip(`${clip.name}_lower`, clip.duration, below) };
}

/**
 * The bone the lower half's hips are, by the end of its name: the hips carry the spine, so a clip's hips turn and lean
 * the whole upper body with them, where the legs below only stand him. Play Pip weighs a clip's legs apart from its
 * hips (splitHips) when a lunge is cut short (play.ts legShare): swapped with the legs, the hips of the stance took the
 * forehand's whole hip turn out from under the swinging arms, and its blade struck 0.8 m out to his right, where the
 * build measured it 0.75 m to his left.
 */
export const HIPS_BONE = 'Hips';

/** The name of a rig's hips bone (HIPS_BONE), or null without one. */
export function hipsBoneName(root: Object3D): string | null {
  let name: string | null = null;
  root.traverse((node) => {
    if (!name && (node as Object3D & { isBone?: boolean }).isBone && node.name.endsWith(HIPS_BONE)) name = node.name;
  });
  return name;
}

/** Splits a lower half into its hips' tracks and the legs' (every other track), each the clip's whole length. */
export function splitHips(lower: AnimationClip, hips: string): { hips: AnimationClip; legs: AnimationClip } {
  const own = lower.tracks.filter((track) => trackNode(track) === hips);
  const rest = lower.tracks.filter((track) => trackNode(track) !== hips);
  return { hips: new AnimationClip(`${lower.name}_hips`, lower.duration, own), legs: new AnimationClip(`${lower.name}_legs`, lower.duration, rest) };
}

/** The moments a warped clip is sampled at: evenly at PLACEHOLDER_SAMPLES_PER_SECOND, and each anchor's hit time exactly. */
export function warpSampleTimes(anchors: WarpAnchors, duration: number): number[] {
  const times = new Set<number>();
  const count = Math.floor(duration * PLACEHOLDER_SAMPLES_PER_SECOND + 1e-9);
  for (let i = 0; i <= count; i++) times.add(i / PLACEHOLDER_SAMPLES_PER_SECOND);
  for (const [time] of anchors) if (time >= 0 && time <= duration) times.add(time);
  times.add(duration);
  const sorted = [...times].sort((a, b) => a - b);
  // Drops a sample within a microsecond of the one before, which an anchor on a whole sample would otherwise repeat.
  return sorted.filter((time, i) => i === 0 || time - sorted[i - 1]! > 1e-6);
}

/**
 * A copy of `source` time-warped through the anchors into a clip of `duration` seconds named `name`: each track is
 * sampled from the source, through its own interpolant (a quaternion track slerps), at the hit times warpSampleTimes
 * gives, each mapped to its source time by warpTime. Sampling rather than moving the source's keys lets a warp run the
 * source backward or start partway into it. Each warped track keeps its source's interpolation, so a stepped (discrete)
 * track still steps between its samples rather than sliding from one to the next, where every warped track used to be
 * built linear; a glTF cubic spline or Bezier track, whose tangents belong to its own keys and do not survive the
 * resample, plays its dense samples linearly, which three does for a track whose mode it cannot name.
 */
export function warpClip(source: AnimationClip, name: string, anchors: WarpAnchors, duration: number): AnimationClip {
  const times = warpSampleTimes(anchors, duration);
  const tracks = source.tracks.map((track) => {
    const interpolant = interpolantOf(track);
    const size = sampleSize(track);
    const values = new Float32Array(times.length * size);
    times.forEach((time, i) => {
      const result = interpolant.evaluate(warpTime(anchors, time));
      for (let k = 0; k < size; k++) values[i * size + k] = result[k] as number;
    });
    const mode = track.getInterpolation();
    const interpolation = mode === InterpolateBezier ? undefined : mode;
    const Track = track.constructor as new (name: string, times: ArrayLike<number>, values: ArrayLike<number>, interpolation?: InterpolationModes) => KeyframeTrack;
    return new Track(track.name, Float32Array.from(times), values, interpolation);
  });
  return new AnimationClip(name, duration, tracks);
}

/**
 * How far a GLB's own hit clip may run from its contract's length, in seconds: one frame at 30 fps, assets:check's
 * tolerance for every timed clip (`FRAME`, tools/assets/check.mjs), so a clip that passes there passes here.
 */
export const CLIP_LENGTH_TOLERANCE = 1 / 30;

/**
 * Each hit's clip, in the contracts' order: the GLB's own clip of the hit's name (attack_1, or attack_1_hand for the
 * hand-keyed set) when it exports one, so the swap to the real clips is an asset change alone, and otherwise a
 * placeholder warped from the `attack` clip (placeholderAnchors) with the source's strike at `sourceStrike`. Null when
 * there is neither for some hit, and the page then has no combo to play.
 *
 * The combo's clock runs each hit to its contract, whatever its clip's length, so a GLB clip that misses its contract
 * by more than CLIP_LENGTH_TOLERANCE is named in the console (`warn`) and its miss kept in `lengthOff` for the reading:
 * a real attack_N replaced its placeholder unchecked, and a long clip would have been cut off before its end, a short
 * one held on its last pose, with nothing to say why.
 */
export function hitClips(
  animations: readonly AnimationClip[],
  sourceStrike: number,
  hits: readonly HitContract[],
  warn: (text: string) => void = (text) => console.warn(text),
): HitClip[] | null {
  const attack = animations.find((clip) => clip.name === 'attack') ?? null;
  const out: HitClip[] = [];
  for (const contract of hits) {
    const own = animations.find((clip) => clip.name === contract.name);
    if (own) {
      const lengthOff = own.duration - contract.duration;
      if (Math.abs(lengthOff) > CLIP_LENGTH_TOLERANCE) {
        warn(
          `Play Pip: the GLB's ${contract.name} is ${own.duration.toFixed(3)} s long, ${lengthOff > 0 ? '+' : ''}${lengthOff.toFixed(3)} s off its ` +
            `${contract.duration} s contract (combo.ts); the combo plays it to the contract's length, strike and cancel`,
        );
      }
      out.push({ contract, clip: own, source: 'clip', lengthOff });
    } else if (attack) {
      out.push({ contract, clip: warpClip(attack, contract.name, placeholderAnchors(contract, attack.duration, sourceStrike), contract.duration), source: 'placeholder', lengthOff: 0 });
    } else return null;
  }
  return out;
}
