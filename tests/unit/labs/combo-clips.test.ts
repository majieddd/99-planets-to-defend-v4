import { fileURLToPath } from 'node:url';
import { AnimationClip, AnimationMixer, NumberKeyframeTrack, PropertyBinding, Quaternion, Vector3, type AnimationAction, type Group, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { BACKHAND_STRIKE_BEFORE_STRIKE, COMBO_HITS, placeholderAnchors } from '../../../src/labs/world/combo';
import { hitClips, PLACEHOLDER_SAMPLES_PER_SECOND, splitClip, upperBodyBones, warpClip, warpSampleTimes } from '../../../src/labs/world/comboClips';
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

beforeAll(async () => {
  const io = await assetIO();
  const doc = await io.read(FILE);
  for (const texture of doc.getRoot().listTextures()) texture.dispose();
  const bytes = await io.writeBinary(doc);
  await MeshoptDecoder.ready;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
  scene = gltf.scene;
  animations = gltf.animations;
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
  it('stand placeholders in for attack_1 to attack_3, each its contract long, with the strike pose at the contract strike', () => {
    expect(animations.map((clip) => clip.name)).not.toContain('attack_1');
    const hits = hitClips(animations, SOURCE_STRIKE)!;
    expect(hits.map((hit) => [hit.contract.name, hit.source, hit.clip.name])).toEqual([
      ['attack_1', 'placeholder', 'attack_1'],
      ['attack_2', 'placeholder', 'attack_2'],
      ['attack_3', 'placeholder', 'attack_3'],
    ]);
    const attack = animations.find((clip) => clip.name === 'attack')!;
    for (const hit of hits) {
      expect(hit.clip.duration).toBe(hit.contract.duration);
      expect(hit.clip.tracks.length).toBe(attack.tracks.length);
      // The sword hand stands at the hit's strike where the source's stands at its own strike (the backhand's, a little
      // before it, at the cut's fastest moment).
      const source = hit.contract.name === 'attack_2' ? SOURCE_STRIKE - BACKHAND_STRIKE_BEFORE_STRIKE : SOURCE_STRIKE;
      expect(handAt(hit.clip, hit.contract.strike).distanceTo(handAt(attack, source)), hit.contract.name).toBeLessThan(1e-4);
    }
    // attack_1's cancel point and the backhand's first pose are both in the follow-through, so the crossfade between
    // them barely moves the sword: under 7 cm.
    const [first, second] = hits as [(typeof hits)[number], (typeof hits)[number]];
    expect(handAt(first.clip, first.contract.cancel!).distanceTo(handAt(second.clip, 0))).toBeLessThan(0.07);
  });

  it("plays a clip the GLB exports under a hit's name instead of a placeholder, so the swap is an asset change alone", () => {
    const attack = animations.find((clip) => clip.name === 'attack')!;
    const real = new AnimationClip('attack_2', 0.55, attack.tracks);
    const hits = hitClips([...animations, real], SOURCE_STRIKE)!;
    expect(hits.map((hit) => hit.source)).toEqual(['placeholder', 'clip', 'placeholder']);
    expect(hits[1]!.clip).toBe(real);
    // With neither the hit's own clip nor an attack clip to warp, there is no combo.
    expect(hitClips(animations.filter((clip) => clip.name !== 'attack'), SOURCE_STRIKE)).toBeNull();
  });

  it('samples a warp at an even rate and at its anchors, and maps each sample through the warp', () => {
    // A track whose value is its own time shows the source time each sample was read at.
    const identity = new AnimationClip('ramp', 1, [new NumberKeyframeTrack('.ramp', [0, 1], [0, 1])]);
    const contract = COMBO_HITS[0]!;
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
