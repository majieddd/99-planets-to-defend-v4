import { fileURLToPath } from 'node:url';
import {
  AnimationClip,
  AnimationMixer,
  InterpolateDiscrete,
  InterpolateLinear,
  LinearInterpolant,
  NumberKeyframeTrack,
  PropertyBinding,
  Quaternion,
  Vector3,
  type AnimationAction,
  type Group,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { BACKHAND_STRIKE_BEFORE_STRIKE, COMBO_HITS, HAND_HITS, placeholderAnchors } from '../../../src/labs/world/combo';
import { CLIP_LENGTH_TOLERANCE, hipsBoneName, hitClips, PLACEHOLDER_SAMPLES_PER_SECOND, splitClip, splitHips, upperBodyBones, warpClip, warpSampleTimes } from '../../../src/labs/world/comboClips';
import timings from '../../../src/shared/timings.json';
import { assetIO } from '../../../tools/assets/optimize.mjs';

// The shipped Pip, as three r186's GLTFLoader delivers it (tests/unit/render/pip-glb.test.ts loads it the same way), so
// the mask is checked against the bone names the page actually binds.
const FILE = fileURLToPath(new URL('../../../public/assets/commanders/commander_pip.glb', import.meta.url));
const SOURCE_STRIKE = timings.commanders.commander_pip.attack.strike;
const UPPER = [
  'mixamorigSpine',
  'mixamorigSpine1',
  'mixamorigSpine2',
  'mixamorigLeftShoulder',
  'mixamorigLeftArm',
  'mixamorigLeftForeArm',
  'mixamorigLeftHand',
  'mixamorigNeck',
  'mixamorigHead',
  'jaw',
  'mixamorigHeadTop_End',
  'mixamorigRightShoulder',
  'mixamorigRightArm',
  'mixamorigRightForeArm',
  'mixamorigRightHand',
];
const LOWER = [
  'mixamorigHips',
  'mixamorigLeftUpLeg',
  'mixamorigLeftLeg',
  'mixamorigLeftFoot',
  'mixamorigLeftToeBase',
  'mixamorigRightUpLeg',
  'mixamorigRightLeg',
  'mixamorigRightFoot',
  'mixamorigRightToeBase',
];

let scene: Group;
let animations: AnimationClip[];
/** The shipped clips without the real hits, as a GLB from before they shipped, for the placeholder path. */
let withoutHits: AnimationClip[];
const HIT_NAMES = [...COMBO_HITS, ...HAND_HITS].map((hit) => hit.name);

beforeAll(async () => {
  const io = await assetIO();
  const doc = await io.read(FILE);
  for (const texture of doc.getRoot().listTextures()) texture.dispose();
  const bytes = await io.writeBinary(doc);
  await MeshoptDecoder.ready;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
  scene = gltf.scene;
  animations = gltf.animations;
  withoutHits = animations.filter((clip) => !HIT_NAMES.includes(clip.name));
});

const nodeOf = (trackName: string): string => PropertyBinding.parseTrackName(trackName).nodeName;

/** A bone's place in the rig's own frame with one clip posed at a time. */
function handAt(clip: AnimationClip, time: number, bone = 'mixamorigRightHand'): Vector3 {
  const rig = cloneRig(scene) as Object3D;
  const mixer = new AnimationMixer(rig);
  mixer.clipAction(clip).play();
  mixer.setTime(time);
  rig.updateMatrixWorld(true);
  return rig.worldToLocal(rig.getObjectByName(bone)!.getWorldPosition(new Vector3()));
}

describe("Play Pip's upper-body mask on the shipped rig", () => {
  it('holds the spine and everything on it, and leaves out the hips and legs', () => {
    const mask = upperBodyBones(scene)!;
    expect(mask).not.toBeNull();
    for (const name of UPPER) expect(mask.has(name), name).toBe(true);
    for (const name of LOWER) expect(mask.has(name), name).toBe(false);
    // Nothing but the spine's own subtree: the meshes and the rig's root stay out too.
    expect([...mask].sort()).toEqual([...UPPER].sort());
  });

  it("splits every clip at the mask, each track on one side, the hips' and legs' tracks below", () => {
    const mask = upperBodyBones(scene)!;
    for (const clip of animations) {
      const { upper, lower } = splitClip(clip, mask);
      expect(upper.tracks.length + lower.tracks.length, clip.name).toBe(clip.tracks.length);
      for (const track of upper.tracks) expect(UPPER, `${clip.name} ${track.name}`).toContain(nodeOf(track.name));
      for (const track of lower.tracks) expect(LOWER, `${clip.name} ${track.name}`).toContain(nodeOf(track.name));
      expect([upper.duration, lower.duration]).toEqual([clip.duration, clip.duration]);
    }
  });

  it("parts each lower half into the hips, which carry the upper body, and the legs, which only stand him", () => {
    const mask = upperBodyBones(scene)!;
    const hips = hipsBoneName(scene)!;
    expect(hips).toBe('mixamorigHips');
    for (const clip of animations) {
      const { lower } = splitClip(clip, mask);
      const parted = splitHips(lower, hips);
      expect(parted.hips.tracks.length + parted.legs.tracks.length, clip.name).toBe(lower.tracks.length);
      for (const track of parted.hips.tracks) expect(nodeOf(track.name), `${clip.name} ${track.name}`).toBe('mixamorigHips');
      for (const track of parted.legs.tracks) expect(LOWER.filter((name) => name !== 'mixamorigHips'), `${clip.name} ${track.name}`).toContain(nodeOf(track.name));
      expect([parted.hips.duration, parted.legs.duration]).toEqual([clip.duration, clip.duration]);
    }
  });

  it('weighs the two halves apart on one mixer, so the arms swing while the legs run', () => {
    const mask = upperBodyBones(scene)!;
    const attack = animations.find((clip) => clip.name === 'attack')!;
    const run = animations.find((clip) => clip.name === 'run')!;
    const rig = cloneRig(scene) as Object3D;
    const mixer = new AnimationMixer(rig);
    const halves = [splitClip(attack, mask).upper, splitClip(run, mask).lower];
    const actions: AnimationAction[] = halves.map((clip) => mixer.clipAction(clip).play());
    actions[0]!.time = SOURCE_STRIKE;
    actions[1]!.time = 0.2;
    for (const action of actions) action.timeScale = 0;
    mixer.update(0);
    // The arm takes the attack's rotation at its strike, the thigh the run's at 0.2 s.
    const pose = (clip: AnimationClip, time: number, bone: string): Quaternion => {
      const copy = cloneRig(scene) as Object3D;
      const own = new AnimationMixer(copy);
      own.clipAction(clip).play();
      own.setTime(time);
      return copy.getObjectByName(bone)!.quaternion.clone();
    };
    expect(rig.getObjectByName('mixamorigRightArm')!.quaternion.angleTo(pose(attack, SOURCE_STRIKE, 'mixamorigRightArm'))).toBeLessThan(1e-5);
    expect(rig.getObjectByName('mixamorigLeftUpLeg')!.quaternion.angleTo(pose(run, 0.2, 'mixamorigLeftUpLeg'))).toBeLessThan(1e-5);
  });
});

describe("Play Pip's combo clips", () => {
  it("plays the GLB's own clips for both swing sets, each within a frame of its contract's length, with no change to the page", () => {
    const warned: string[] = [];
    for (const [contracts, names] of [
      [COMBO_HITS, ['attack_1', 'attack_2', 'attack_3']],
      [HAND_HITS, ['attack_1_hand', 'attack_2_hand', 'attack_3_hand']],
    ] as const) {
      const hits = hitClips(animations, SOURCE_STRIKE, contracts, (text) => warned.push(text))!;
      expect(hits.map((hit) => [hit.contract.name, hit.source, hit.clip.name])).toEqual(names.map((name) => [name, 'clip', name]));
      for (const hit of hits) {
        expect(hit.clip).toBe(animations.find((clip) => clip.name === hit.contract.name));
        expect(Math.abs(hit.lengthOff), hit.contract.name).toBeLessThanOrEqual(CLIP_LENGTH_TOLERANCE);
      }
    }
    expect(warned).toEqual([]);
  });

  it('hands each Quaternius light hit over to its recovery clip in the pose they share', () => {
    // The library splits each light hit at its chain point: Sword_Regular_A ends where Sword_Regular_A_Rec begins, so a
    // chain that stops there plays on into the recovery with no jump (combo.ts holds the hit's weight to its end for it).
    // Every bone meets within a millimetre but the sword hand, whose edge roll around the strike (blender/lib/retarget.py
    // edge_rolls) leaves it 27 mm from the recovery's first pose after the forehand and 17 mm after the backhand: less
    // than the hand travels in the hit's last frame (78 and 29 mm), so the handover reads as one more frame of the swing.
    for (const hit of COMBO_HITS.slice(0, 2)) {
      const rec = animations.find((clip) => clip.name === hit.recovery)!;
      const own = animations.find((clip) => clip.name === hit.name)!;
      for (const bone of ['mixamorigRightHand', 'mixamorigLeftHand', 'mixamorigHips', 'mixamorigHead', 'mixamorigLeftToeBase', 'mixamorigRightToeBase']) {
        // Just short of the end: the mixer's default loop wraps a time of exactly the clip's length back to its start.
        const gap = handAt(own, own.duration - 1e-4, bone).distanceTo(handAt(rec, 0, bone));
        const last = handAt(own, own.duration - 1e-4, bone).distanceTo(handAt(own, own.duration - 1 / 30, bone));
        expect(gap, `${hit.name}'s end to ${hit.recovery}'s start, ${bone}`).toBeLessThan(bone === 'mixamorigRightHand' ? Math.min(0.03, last) : 0.001);
      }
    }
  });

  it('starts each chained hit where the hit before stands at its cancel point, so the crossfade between them hides no jump', () => {
    // The recipe keys attack_2's first pose from attack_1's at its cancel frame, and attack_3's from attack_2's (CHAIN,
    // blender/recipes/commander_pip.py). On a hit's first frame its hips used to read their track 1.5 frames ahead and
    // its torso 0.5 ahead (lib/motion.py LAGS), already off toward the next key, so the hands, the hips and the head
    // stood 13 to 47 mm from where the hit before left them; the leads now ease in over the clip's first three frames
    // (LAG_RAMP), and read back through the export and the loader every one stands within 0.1 mm of it. A gap of a
    // whole pose, as a hit keyed from the guard would leave, is tens of centimetres.
    const hits = hitClips(animations, SOURCE_STRIKE, HAND_HITS)!;
    for (const [from, to] of [
      [hits[0]!, hits[1]!],
      [hits[1]!, hits[2]!],
    ] as const) {
      for (const bone of ['mixamorigRightHand', 'mixamorigLeftHand', 'mixamorigHips', 'mixamorigHead']) {
        const gap = handAt(from.clip, from.contract.cancel!, bone).distanceTo(handAt(to.clip, 0, bone));
        expect(gap, `${from.contract.name} at its cancel point to ${to.contract.name}'s start, ${bone}`).toBeLessThan(1e-4);
      }
    }
  });

  it("steps the finisher's front boot about 22 cm out and home again inside the clip, its back boot and the light hits' boots still", () => {
    // The hand-keyed finisher's step is the clip's alone (it has no root motion): it must come back by the clip's end, or
    // the boot would jump home when the hit fades out. In the rig's frame, at the start, the strike and the end.
    const hits = hitClips(animations, SOURCE_STRIKE, HAND_HITS)!;
    const finisher = hits[2]!;
    const left = (time: number) => handAt(finisher.clip, time, 'mixamorigLeftToeBase');
    const right = (time: number) => handAt(finisher.clip, time, 'mixamorigRightToeBase');
    const out = Math.max(...[0.3, 0.38, 0.45, 0.5].map((time) => left(time).distanceTo(left(0))));
    expect(out).toBeGreaterThan(0.2);
    expect(out).toBeLessThan(0.25);
    // Read just short of the end: at exactly the clip's length the mixer's default loop wraps back to its first frame,
    // so this check, read there, compared the first frame with itself and could not fail.
    const end = finisher.clip.duration - 1e-4;
    expect(left(end).distanceTo(left(0))).toBeLessThan(0.001);
    expect(Math.max(...[0.2, 0.38, 0.6, end].map((time) => right(time).distanceTo(right(0))))).toBeLessThan(0.001);
    for (const light of hits.slice(0, 2)) {
      for (const toe of ['mixamorigLeftToeBase', 'mixamorigRightToeBase']) {
        const moved = Math.max(...[0.1, 0.2, 0.3, light.clip.duration - 1e-4].map((time) => handAt(light.clip, time, toe).distanceTo(handAt(light.clip, 0, toe))));
        expect(moved, `${light.contract.name} ${toe}`).toBeLessThan(0.001);
      }
    }
  });

  it('stand placeholders in for the hits on a GLB without them, each its contract long, with the strike pose at the contract strike', () => {
    const animations = withoutHits;
    expect(animations.map((clip) => clip.name)).not.toContain('attack_1');
    const hits = hitClips(animations, SOURCE_STRIKE, HAND_HITS)!;
    expect(hits.map((hit) => [hit.contract.name, hit.source, hit.clip.name])).toEqual([
      ['attack_1_hand', 'placeholder', 'attack_1_hand'],
      ['attack_2_hand', 'placeholder', 'attack_2_hand'],
      ['attack_3_hand', 'placeholder', 'attack_3_hand'],
    ]);
    const attack = animations.find((clip) => clip.name === 'attack')!;
    for (const hit of hits) {
      expect(hit.clip.duration).toBe(hit.contract.duration);
      expect(hit.clip.tracks.length).toBe(attack.tracks.length);
      // The sword hand stands at the hit's strike where the source's stands at its own strike (the backhand's, a little
      // before it, at the cut's fastest moment).
      const source = hit.contract.step === 2 ? SOURCE_STRIKE - BACKHAND_STRIKE_BEFORE_STRIKE : SOURCE_STRIKE;
      expect(handAt(hit.clip, hit.contract.strike).distanceTo(handAt(attack, source)), hit.contract.name).toBeLessThan(1e-4);
    }
    // attack_1's cancel point and the backhand's first pose are both in the follow-through, so the crossfade between
    // them barely moves the sword: under 7 cm.
    const [first, second] = hits as [(typeof hits)[number], (typeof hits)[number]];
    expect(handAt(first.clip, first.contract.cancel!).distanceTo(handAt(second.clip, 0))).toBeLessThan(0.07);
  });

  it("plays a clip the GLB exports under a hit's name instead of a placeholder, so the swap is an asset change alone", () => {
    const animations = withoutHits;
    const attack = animations.find((clip) => clip.name === 'attack')!;
    const real = new AnimationClip('attack_2_hand', 0.55, attack.tracks);
    const hits = hitClips([...animations, real], SOURCE_STRIKE, HAND_HITS)!;
    expect(hits.map((hit) => hit.source)).toEqual(['placeholder', 'clip', 'placeholder']);
    expect(hits[1]!.clip).toBe(real);
    // With neither the hit's own clip nor an attack clip to warp, there is no combo.
    expect(hitClips(animations.filter((clip) => clip.name !== 'attack'), SOURCE_STRIKE, HAND_HITS)).toBeNull();
  });

  it("names a GLB hit clip whose length misses its contract by more than a frame, and keeps the miss for the reading", () => {
    const animations = withoutHits;
    const attack = animations.find((clip) => clip.name === 'attack')!;
    const warned: string[] = [];
    const warn = (text: string): void => {
      warned.push(text);
    };
    // Within a frame at 30 fps of its 0.55 s contract, as assets:check allows: kept quietly, its small miss still read.
    const close = hitClips([...animations, new AnimationClip('attack_2_hand', 0.55 + CLIP_LENGTH_TOLERANCE * 0.9, attack.tracks)], SOURCE_STRIKE, HAND_HITS, warn)!;
    expect(warned).toEqual([]);
    expect(close[1]!.lengthOff).toBeCloseTo(CLIP_LENGTH_TOLERANCE * 0.9, 9);
    // 0.15 s long: named, with its length and the miss, and the miss kept.
    const long = hitClips([...animations, new AnimationClip('attack_2_hand', 0.7, attack.tracks)], SOURCE_STRIKE, HAND_HITS, warn)!;
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('attack_2_hand is 0.700 s long, +0.150 s off its 0.55 s contract');
    expect(long[1]!.lengthOff).toBeCloseTo(0.15, 6);
    expect(long.map((hit) => hit.lengthOff)).toEqual([0, long[1]!.lengthOff, 0]);
  });

  it("keeps each warped track's interpolation, and reads a glTF cubic spline track at its value's own size", () => {
    // A stepped track stays stepped: built linear, it slid between the warp's samples where its source held.
    const stepped = new AnimationClip('steps', 1, [new NumberKeyframeTrack('.steps', [0, 0.5], [0, 1], InterpolateDiscrete)]);
    const anchors = placeholderAnchors(HAND_HITS[0]!, 1, 0.4);
    expect(warpClip(stepped, 'steps_warped', anchors, 0.55).tracks[0]!.getInterpolation()).toBe(InterpolateDiscrete);
    const linear = new AnimationClip('ramp', 1, [new NumberKeyframeTrack('.ramp', [0, 1], [0, 1])]);
    expect(warpClip(linear, 'ramp_warped', anchors, 0.55).tracks[0]!.getInterpolation()).toBe(InterpolateLinear);
    // A CUBICSPLINE track as GLTFLoader builds one: three values per key (in tangent, value, out tangent) and an
    // interpolant factory marked as glTF's, here sampling the values linearly. Read at getValueSize(), 3, the warp
    // took two values past each sample and wrote NaN.
    const cubic = new NumberKeyframeTrack('.cubic', [0, 1], [0, 0, 0, 0, 1, 0]);
    const factory = function (this: NumberKeyframeTrack, result?: ArrayLike<number>) {
      return new LinearInterpolant(this.times, Float32Array.from([this.values[1]!, this.values[4]!]), 1, result as never);
    } as unknown as ((result?: ArrayLike<number>) => LinearInterpolant) & { isInterpolantFactoryMethodGLTFCubicSpline: boolean };
    factory.isInterpolantFactoryMethodGLTFCubicSpline = true;
    (cubic as unknown as { createInterpolant: typeof factory }).createInterpolant = factory;
    expect(cubic.getValueSize()).toBe(3);
    const warped = warpClip(new AnimationClip('cubic', 1, [cubic]), 'cubic_warped', anchors, 0.55).tracks[0]!;
    expect(warped.getValueSize()).toBe(1);
    expect(warped.values.length).toBe(warped.times.length);
    expect(Array.from(warped.values).every(Number.isFinite)).toBe(true);
    // The value at the hit's strike is the source's at its 0.4 s strike.
    expect(warped.values[Array.from(warped.times).findIndex((time) => Math.abs(time - 0.2) < 1e-6)]).toBeCloseTo(0.4, 6);
  });

  it('samples a warp at an even rate and at its anchors, and maps each sample through the warp', () => {
    // A track whose value is its own time shows the source time each sample was read at.
    const identity = new AnimationClip('ramp', 1, [new NumberKeyframeTrack('.ramp', [0, 1], [0, 1])]);
    const contract = HAND_HITS[0]!;
    const anchors = placeholderAnchors(contract, 1, 0.4);
    const warped = warpClip(identity, 'ramp_warped', anchors, contract.duration);
    const times = Array.from(warped.tracks[0]!.times);
    expect(times).toEqual(warpSampleTimes(anchors, contract.duration).map((time) => Math.fround(time)));
    // 0.55 s at 60 a second is 33 steps, 34 samples; the strike at 0.2 s and the end fall on samples and add none.
    expect(times.length).toBe(Math.round(contract.duration * PLACEHOLDER_SAMPLES_PER_SECOND) + 1);
    expect(warpSampleTimes([[0.205, 0]], 0.55).length).toBe(35);
    const at = (time: number): number => warped.tracks[0]!.values[times.findIndex((value) => Math.abs(value - time) < 1e-6)]!;
    expect(at(contract.strike)).toBeCloseTo(0.4, 6);
    expect(at(0)).toBeCloseTo(0, 6);
    expect(at(contract.duration)).toBeCloseTo(1, 6);
  });
});
