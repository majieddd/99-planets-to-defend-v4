import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AnimationMixer, Vector3, type AnimationClip, type Group, type Object3D, type SkinnedMesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { BLADE_GUARD_OFFSET, BLADE_MIN_WEIGHT, bladeHand, measureBlade, sampleBlade } from '../../../src/labs/world/blade';
import { COMBO_HITS } from '../../../src/labs/world/combo';
import { assetIO } from '../../../tools/assets/optimize.mjs';

// The shipped Pip, as three r186's GLTFLoader delivers it (as combo-clips.test.ts loads it), so the blade is measured on
// the very rig the page samples.
const FILE = fileURLToPath(new URL('../../../public/assets/commanders/commander_pip.glb', import.meta.url));
/** Each combo clip's blade tip at its strike frame, as Pip's build measured it in Blender (the sidecar's checks). */
const meta = JSON.parse(readFileSync('public/assets/commanders/commander_pip.meta.json', 'utf8')) as {
  notes: { combo: Record<string, { checks: { strike_blade_tip: { x: number; y: number; z: number } }; blade: { strike_frame: number } }> };
};
/** The clips' frame rate, which the build keys and measures at (blender/lib/anim.py FPS). */
const FPS = 30;

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

/** Every vertex skinned to the right hand at BLADE_MIN_WEIGHT or more, in world space as the rig stands. */
function handVertices(rig: Object3D): Vector3[] {
  rig.updateMatrixWorld(true);
  const out: Vector3[] = [];
  rig.traverse((object) => {
    const mesh = object as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const index = mesh.skeleton.bones.findIndex((bone) => bone.name.endsWith('RightHand'));
    const skinIndex = mesh.geometry.getAttribute('skinIndex');
    const skinWeight = mesh.geometry.getAttribute('skinWeight');
    for (let i = 0; i < mesh.geometry.getAttribute('position').count; i++) {
      let weight = 0;
      for (let k = 0; k < 4; k++) if (skinIndex.getComponent(i, k) === index) weight += skinWeight.getComponent(i, k);
      if (weight >= BLADE_MIN_WEIGHT) out.push(mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld));
    }
  });
  return out;
}

describe("Play Pip's blade, read from his shipped rig (labs/world/blade.ts)", () => {
  it('finds the sword on his right hand, its tip the furthest point from the hand and its base past the crossguard', () => {
    const rig = cloneRig(scene) as Object3D;
    const blade = measureBlade(rig)!;
    expect(blade).not.toBeNull();
    expect(blade.handName).toBe('mixamorigRightHand');
    // In the bind pose the measured tip, carried out through the hand, is the hand's furthest vertex.
    const hand = bladeHand(rig, blade)!;
    const base = new Vector3();
    const tip = new Vector3();
    sampleBlade(hand, blade, base, tip);
    const origin = hand.getWorldPosition(new Vector3());
    const vertices = handVertices(rig);
    const furthest = Math.max(...vertices.map((point) => point.distanceTo(origin)));
    expect(tip.distanceTo(origin)).toBeCloseTo(furthest, 6);
    expect(vertices.some((point) => point.distanceTo(tip) < 1e-6)).toBe(true);
    // The base stands on the line to the tip, 0.26 m from the hand, past every vertex that sits BLADE_GUARD_OFFSET or
    // more off that line (the crossguard), and the blade is the 0.7 m from there to the tip.
    const axis = tip.clone().sub(origin).normalize();
    expect(base.clone().sub(origin).normalize().dot(axis)).toBeCloseTo(1, 9);
    expect(base.distanceTo(origin)).toBeGreaterThan(0.2);
    expect(base.distanceTo(origin)).toBeLessThan(0.3);
    expect(blade.length).toBeCloseTo(0.696, 2);
    for (const point of vertices) {
      const offset = point.clone().sub(origin);
      const along = offset.dot(axis);
      if (offset.addScaledVector(axis, -along).length() >= BLADE_GUARD_OFFSET) expect(along).toBeLessThanOrEqual(base.distanceTo(origin) + 1e-6);
    }
  });

  it("puts each hit's blade tip at its strike within 2 mm of where Pip's build measured it, through the clip the page plays", () => {
    const blade = measureBlade(cloneRig(scene) as Object3D)!;
    for (const hit of COMBO_HITS) {
      const clip = animations.find((each) => each.name === hit.name)!;
      const record = meta.notes.combo[hit.name]!;
      // The build reads the tip on the strike's whole frame (attack_checks: frame round(strike)), Blender's axes with -y
      // ahead, which the export turns into three's x, z, -y.
      const frame = Math.round(record.blade.strike_frame);
      const rig = cloneRig(scene) as Object3D;
      const mixer = new AnimationMixer(rig);
      mixer.clipAction(clip).play();
      mixer.setTime((frame - 1) / FPS);
      rig.updateMatrixWorld(true);
      const base = new Vector3();
      const tip = new Vector3();
      sampleBlade(bladeHand(rig, blade)!, blade, base, tip);
      rig.worldToLocal(tip);
      const measured = record.checks.strike_blade_tip;
      const want = new Vector3(measured.x, measured.z, -measured.y);
      expect(tip.distanceTo(want), `${hit.name} at frame ${frame}: ${tip.toArray().map((value) => value.toFixed(3))} against ${want.toArray()}`).toBeLessThan(0.002);
    }
  });
});
