import { fileURLToPath } from 'node:url';
import { AnimationMixer, Vector3, type AnimationClip, type Group, type Mesh, type Object3D, type SkinnedMesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import { describe, expect, it } from 'vitest';
import { footprintObstacle, FOOTPRINT_POSES } from '../../../src/labs/combat/dummies';
import { FOOTPRINT_BAND_HIGH, FOOTPRINT_BAND_LOW, footprintFront, HEAD_FROM, measureFootprint, PIP_STRIKE_REACH, type LocalPoint } from '../../../src/labs/combat/footprint';
import { obstacleGap } from '../../../src/labs/world/playMotion';
import { assetIO } from '../../../tools/assets/optimize.mjs';

async function load(file: string): Promise<{ scene: Group; animations: AnimationClip[] }> {
  const io = await assetIO();
  const doc = await io.read(fileURLToPath(new URL(`../../../public/assets/${file}`, import.meta.url)));
  for (const texture of doc.getRoot().listTextures()) texture.dispose();
  const bytes = await io.writeBinary(doc);
  await MeshoptDecoder.ready;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
  return { scene: gltf.scene, animations: gltf.animations };
}

/** A body's posed vertices in its own frame, every `every`th, those `skip` leaves in. */
function posed(rig: Object3D, every = 1, skip?: (mesh: Mesh, index: number) => boolean): LocalPoint[] {
  const out: LocalPoint[] = [];
  const v = new Vector3();
  rig.updateMatrixWorld(true);
  rig.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i += every) {
      if (skip?.(mesh, i)) continue;
      rig.worldToLocal(mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld));
      out.push({ x: v.x, y: v.y, z: v.z });
    }
  });
  return out;
}

describe("a training dummy's footprint (labs/combat/footprint.ts)", () => {
  it('holds every point in the band: the core behind the head, the head in the narrowest capsule that holds it', () => {
    // A hump 0.5 m about the root, and a head reaching 1.2 m ahead, 0.3 m to each side, with mandibles 0.4 m out at 1.1 m.
    const points: LocalPoint[] = [];
    for (let a = 0; a < 360; a += 10) points.push({ x: 0.5 * Math.sin((a * Math.PI) / 180), y: 0.8, z: 0.5 * Math.cos((a * Math.PI) / 180) });
    for (let z = 0.6; z <= 1.2; z += 0.05) for (const x of [-0.3, 0, 0.3]) points.push({ x, y: 0.9, z });
    points.push({ x: 0.4, y: 0.7, z: 1.1 }, { x: -0.4, y: 0.7, z: 1.1 });
    // Points outside the band are left out: legs at the ground, a crest over it.
    points.push({ x: 2, y: 0.05, z: 0 }, { x: 0, y: 1.6, z: 2 });
    const footprint = measureFootprint(points);
    expect(footprint.core).toBeCloseTo(0.5, 9);
    const head = footprint.head!;
    expect(head.from).toBe(HEAD_FROM);
    const obstacle = footprintObstacle({ x: 0, z: 0, radius: 0 }, 0, 0, 0, footprint, 0);
    const inBand = points.filter((p) => p.y >= FOOTPRINT_BAND_LOW && p.y <= FOOTPRINT_BAND_HIGH);
    for (const p of inBand) expect(obstacleGap(obstacle, p.x, p.z), `${p.x} ${p.z}`).toBeLessThanOrEqual(1e-6);
    // It reaches past the tip only as far as holding the mandibles needs: under 0.1 m here.
    expect(footprintFront(footprint)).toBeGreaterThanOrEqual(1.2 - 1e-9);
    expect(footprintFront(footprint)).toBeLessThan(1.3);
    // With nothing ahead of HEAD_FROM, a body is its core alone.
    expect(measureFootprint(points.filter((p) => p.z < HEAD_FROM)).head).toBeNull();
  });

  it("reads the shipped Husk's footprint over its idle: a core of 0.80 m and a head reaching 1.30 m ahead", async () => {
    const husk = await load('xeno/husk.glb');
    const rig = cloneRig(husk.scene) as Object3D;
    const mixer = new AnimationMixer(rig);
    const idle = husk.animations.find((clip) => clip.name === 'idle')!;
    const action = mixer.clipAction(idle).play();
    const points: LocalPoint[] = [];
    for (let k = 0; k < FOOTPRINT_POSES; k++) {
      action.time = (k / FOOTPRINT_POSES) * idle.duration;
      mixer.update(0);
      points.push(...posed(rig));
    }
    const footprint = measureFootprint(points);
    expect(footprint.core).toBeCloseTo(0.796, 3);
    expect(footprint.head).not.toBeNull();
    // Its farthest point ahead in the band is 1.18 m out (the mandibles' tips); holding the mandibles' corners, 0.42 m to
    // each side, takes the capsule back to a round end 0.70 m across about HEAD_FROM, which reaches 1.30 m ahead.
    const tip = Math.max(...points.filter((p) => p.y >= FOOTPRINT_BAND_LOW && p.y <= FOOTPRINT_BAND_HIGH).map((p) => p.z));
    expect(tip).toBeCloseTo(1.18, 2);
    expect(footprintFront(footprint)).toBeGreaterThanOrEqual(tip);
    expect(footprint.head).toEqual({ from: HEAD_FROM, to: HEAD_FROM, radius: expect.closeTo(0.699, 3) });
    expect(footprintFront(footprint)).toBeCloseTo(1.299, 3);
    const obstacle = footprintObstacle({ x: 0, z: 0, radius: 0 }, 0, 0, 0, footprint, 0);
    for (const p of points) if (p.y >= FOOTPRINT_BAND_LOW && p.y <= FOOTPRINT_BAND_HIGH) expect(obstacleGap(obstacle, p.x, p.z)).toBeLessThanOrEqual(1e-6);
  });
});

describe("Pip's reach in a swing (PIP_STRIKE_REACH), read from his shipped GLB", () => {
  it('holds his body, his sword and shield left out, within PIP_STRIKE_REACH of his root across the ground in the band, in every clip', async () => {
    const pip = await load('commanders/commander_pip.glb');
    const rig = cloneRig(pip.scene) as Object3D;
    rig.updateMatrixWorld(true);
    // The sword: armour on the right hand past the mitten along the line to the blade's tip; the shield: armour on the
    // left forearm. Each is a prop the reach leaves out: the sword cuts through by design, the shield punches past the
    // fist in the finisher's wind-up.
    let hand: Object3D | null = null;
    rig.traverse((object) => {
      if (!hand && (object as Object3D & { isBone?: boolean }).isBone && object.name.endsWith('RightHand')) hand = object;
    });
    const handInverse = (hand as unknown as Object3D).matrixWorld.clone().invert();
    const topBone = (mesh: SkinnedMesh, i: number): string => {
      const index = mesh.geometry.getAttribute('skinIndex');
      const weight = mesh.geometry.getAttribute('skinWeight');
      let best = 0;
      let at = 0;
      for (let k = 0; k < 4; k++) if (weight.getComponent(i, k) > best) [best, at] = [weight.getComponent(i, k), k];
      return mesh.skeleton.bones[index.getComponent(i, at)]!.name;
    };
    const v = new Vector3();
    let tip = new Vector3();
    rig.traverse((object) => {
      const mesh = object as SkinnedMesh;
      if (!mesh.isSkinnedMesh || mesh.name !== 'commander_armour') return;
      const position = mesh.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) {
        if (!topBone(mesh, i).endsWith('RightHand')) continue;
        mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).applyMatrix4(handInverse);
        if (v.length() > tip.length()) tip = v.clone();
      }
    });
    const along = tip.clone().normalize();
    // Sorted once in the bind pose, where the hand's frame is the one the line to the tip was read in.
    const props = new Map<Mesh, boolean[]>();
    rig.traverse((object) => {
      const mesh = object as SkinnedMesh;
      if (!mesh.isSkinnedMesh || mesh.name !== 'commander_armour') return;
      const position = mesh.geometry.getAttribute('position');
      const out: boolean[] = [];
      for (let i = 0; i < position.count; i++) {
        const bone = topBone(mesh, i);
        out.push(bone.endsWith('LeftForeArm') || (bone.endsWith('RightHand') && mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).applyMatrix4(handInverse).dot(along) > 0.1));
      }
      props.set(mesh, out);
    });
    const left = (mesh: Mesh, i: number): boolean => props.get(mesh)?.[i] === true;
    const mixer = new AnimationMixer(rig);
    const reach: Record<string, number> = {};
    for (const clip of pip.animations) {
      mixer.stopAllAction();
      mixer.clipAction(clip).reset().play();
      const frames = Math.round(clip.duration * 30);
      let far = 0;
      for (let f = 0; f <= frames; f += 1) {
        mixer.setTime(Math.min(f / 30, clip.duration - 1e-4));
        for (const p of posed(rig, 2, left)) if (p.y >= FOOTPRINT_BAND_LOW && p.y <= FOOTPRINT_BAND_HIGH) far = Math.max(far, Math.hypot(p.x, p.z));
      }
      reach[clip.name] = far;
    }
    const most = Math.max(...Object.values(reach));
    // The farthest any clip carries his body is under the reach, and within 2 cm of it, so the number cannot drift loose.
    expect(most).toBeLessThanOrEqual(PIP_STRIKE_REACH);
    expect(most).toBeGreaterThan(PIP_STRIKE_REACH - 0.02);
    // Standing and running he reaches far less: the swings are what the footprint is widened for.
    expect(reach['idle']!).toBeLessThan(0.6);
    expect(reach['run']!).toBeLessThan(0.8);
  }, 240000);
});
