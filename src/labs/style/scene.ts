import {
  AnimationMixer,
  Group,
  InstancedMesh,
  LoopOnce,
  LoopRepeat,
  Matrix4,
  Object3D,
  Quaternion,
  Vector3,
  type AnimationAction,
  type Mesh,
  type PerspectiveCamera,
} from 'three';
import { Rng, seedRng } from '../../sim/rng';
import type { LoadedAsset, MaterialContext } from '../../render/assets/loadAsset';
import { attachHull } from '../../render/ink/hull';
import type { StylePatch } from '../../render/terrain/stylePatch';

export type BulwarkMode = 'cycle' | 'idle' | 'run' | 'attack';
export type PresetName = 'hero' | 'strategic' | 'closeup' | 'horizon';
export const PRESETS: PresetName[] = ['hero', 'strategic', 'closeup', 'horizon'];

export interface StyleAssets {
  bulwark: LoadedAsset;
  husk: LoadedAsset;
  bolt: LoadedAsset;
  heart: LoadedAsset;
  nest: LoadedAsset;
  kit: LoadedAsset;
}

export interface StyleScene {
  root: Group;
  update(dt: number): void;
  setHeartStage(level: number): void;
  setBulwarkMode(mode: BulwarkMode): void;
  preset(name: PresetName): { position: Vector3; target: Vector3 };
}

// The layout. Distances are metres on the plane tangent at the pole, the coordinates patch.surfaceAt takes, and
// angles run from +x toward +z. Tests import these rather than keep copies.
export const HUSK_RADIUS = 13;
export const HUSK_SPEED = 1.85; // v3 Husk speed, metres per second
export const RUN_SPEED = 7; // blueprint commander run speed, metres per second
export const TURN_RATE = 9; // v3 turret head turn rate, radians per second
export const TURRET_RING_RADIUS = 7;
export const TURRET_ANGLES_DEG = [200, 240, 280] as const; // Bolt Sentinel marks I to III
export const BULWARK_HOME = { x: 3.2, z: 2.4 } as const;
// Bulwark's lap runs through his home, so he leaves it and rejoins it a single step at a time. It also stays 3 m
// inside the turret ring, and a rail reaches at most 1.7 m from its turret's axis, so no rail reaches the lap
// whichever way the turrets aim.
export const RUN_RADIUS = Math.hypot(BULWARK_HOME.x, BULWARK_HOME.z);

/** A kit piece's scatter: its node name, its count at scatter scale 1, and the ring it fills. */
export type ScatterEntry = readonly [name: string, baseCount: number, minRadius: number, maxRadius: number];

// Rocks and bushes start at least 6 m out, which keeps them off Bulwark's lap 2 m further in.
export const SCATTER_PLAN: readonly ScatterEntry[] = [
  ['tree_broad', 14, 18, 46],
  ['tree_conifer', 12, 20, 48],
  ['rock_a', 8, 6, 44],
  ['rock_b', 7, 7, 44],
  ['rock_c', 9, 6, 40],
  ['bush', 26, 6, 42],
  ['grass_tuft', 420, 2.5, 40],
  ['flowers', 70, 3, 36],
];

const UP = new Vector3(0, 1, 0);
const HOME_ANGLE = Math.atan2(BULWARK_HOME.z, BULWARK_HOME.x);
const HOME_YAW = Math.PI;
const LAP_SECONDS = (2 * Math.PI * RUN_RADIUS) / RUN_SPEED;
// Rocks and bushes keep this far from the Husk's ring so he does not walk through one. It covers the stand-ins: the
// largest rock at its largest scale reaches 1.25 m from its centre and the Husk's body 0.6 m from his.
const HUSK_PATH_CLEARANCE = 2;

function place(object: Object3D, patch: StylePatch, x: number, z: number, yaw: number, alignToGround = 0): void {
  const surface = patch.surfaceAt(x, z);
  object.position.copy(surface.position);
  const up = surface.up.clone().lerp(surface.normal, alignToGround).normalize();
  object.quaternion.setFromUnitVectors(UP, up).multiply(new Quaternion().setFromAxisAngle(UP, yaw));
}

class Actor {
  readonly mixer: AnimationMixer;
  private readonly actions = new Map<string, AnimationAction>();
  private current: AnimationAction | null = null;

  constructor(readonly root: Object3D, asset: LoadedAsset) {
    this.mixer = new AnimationMixer(root);
    for (const clip of asset.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
  }

  /** Crossfades in 0.18 s, the reference game's clip blend. Missing clips are ignored (placeholders). */
  play(name: string, once = false): number {
    const next = this.actions.get(name);
    if (!next) return 0;
    if (next === this.current && !once) return next.getClip().duration;
    next.reset();
    next.setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.play();
    // Replaying the current clip (attack mode strikes every 1.6 s) restarts it in place without a crossfade.
    // Crossfading an action to itself schedules its fade-out and then its fade-in on the same weight curve, so the
    // strike would fade in from zero with nothing under it and the rig would sag toward its bind pose for 0.18 s.
    if (this.current && this.current !== next) this.current.crossFadeTo(next, 0.18, false);
    this.current = next;
    return next.getClip().duration;
  }
}

function scatter(root: Group, patch: StylePatch, kit: LoadedAsset, ctx: MaterialContext, scale: number): void {
  const rng = new Rng(seedRng(2026));
  const matrix = new Matrix4();
  const holder = new Group();
  // An instance draws a piece's geometry without the piece's node, so the node's transform within the kit joins
  // every instance's placement. The stand-ins' is the identity, but a GLB piece can carry one: M0c's optimizer
  // quantizes positions, and gltf-transform moves each mesh's dequantizing scale and offset onto its node.
  // Without it such a piece would be drawn at the size and offset of its quantization box.
  kit.root.updateMatrixWorld(true);
  const kitInverse = kit.root.matrixWorld.clone().invert();
  const piece = new Matrix4();
  for (const [name, baseCount, minRadius, maxRadius] of SCATTER_PLAN) {
    const source = kit.root.getObjectByName(name) as Mesh | undefined;
    if (!source) continue;
    piece.multiplyMatrices(kitInverse, source.matrixWorld);
    const count = Math.max(1, Math.round(baseCount * scale));
    const solid = name.startsWith('rock') || name === 'bush';
    const instanced = new InstancedMesh(source.geometry, source.material, count);
    instanced.name = `${name}_instances`;
    instanced.castShadow = name !== 'grass_tuft';
    instanced.receiveShadow = true;
    // Every tier draws the high tier's whole layout from the one stream and keeps the first `count` of each piece,
    // so the stream reaches each piece in the same state at every tier and a lower tier's scatter is part of the
    // high tier's. Drawing only what a tier keeps would shift every later piece whenever the counts change.
    for (let i = 0; i < Math.max(baseCount, count); i++) {
      let angle: number;
      let radius: number;
      // A solid piece's ring must reach past the band or the redraw would never end; each here does by far, so only
      // 5 to 7 percent of its draws land in the band.
      do {
        angle = rng.range(0, Math.PI * 2);
        radius = Math.sqrt(rng.range(minRadius * minRadius, maxRadius * maxRadius));
      } while (solid && Math.abs(radius - HUSK_RADIUS) < HUSK_PATH_CLEARANCE);
      const yaw = rng.range(0, Math.PI * 2);
      const size = rng.range(0.8, 1.25);
      if (i >= count) continue;
      place(holder, patch, Math.cos(angle) * radius, Math.sin(angle) * radius, yaw, name.startsWith('rock') ? 0.8 : 0.2);
      holder.scale.setScalar(size);
      holder.updateMatrix();
      instanced.setMatrixAt(i, matrix.multiplyMatrices(holder.matrix, piece));
    }
    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
    attachHull(instanced, ctx.hullMaterial, ctx.hullLayer);
    root.add(instanced);
  }
}

export function buildStyleScene(patch: StylePatch, assets: StyleAssets, ctx: MaterialContext, scatterScale: number): StyleScene {
  const root = new Group();
  root.name = 'style_scene';

  const heart = assets.heart.root;
  place(heart, patch, 0, 0, 0);
  root.add(heart);
  const stages = Array.from({ length: 11 }, (_, level) => heart.getObjectByName(`heart_stage_${String(level).padStart(2, '0')}`));
  const setHeartStage = (level: number) => stages.forEach((stage, index) => stage && (stage.visible = index === level));
  setHeartStage(3);

  const turrets: { yaw: Object3D; pitch: Object3D }[] = [];
  TURRET_ANGLES_DEG.forEach((degrees, index) => {
    const level = index + 1;
    const mark = assets.bolt.root.getObjectByName(`bolt_mk${level}`);
    if (!mark) return;
    const angle = (degrees * Math.PI) / 180;
    // The site stands on the ground and the mark keeps its authored offset from the asset origin inside it, because
    // M0c's base node sits half the base's height up; placing the mark itself would overwrite that offset and sink
    // half the base into the ground.
    const site = new Group();
    site.name = `bolt_mk${level}_site`;
    place(site, patch, Math.cos(angle) * TURRET_RING_RADIUS, Math.sin(angle) * TURRET_RING_RADIUS, -angle + Math.PI / 2, 0.5);
    site.add(mark);
    root.add(site);
    const yaw = mark.getObjectByName(`bolt_mk${level}_yaw`);
    const pitch = mark.getObjectByName(`bolt_mk${level}_pitch`);
    if (yaw && pitch) turrets.push({ yaw, pitch });
  });

  const nest = assets.nest.root;
  place(nest, patch, -15, -14, 0.4, 0.6);
  root.add(nest);

  const husk = new Actor(assets.husk.root, assets.husk);
  root.add(husk.root);
  const bulwark = new Actor(assets.bulwark.root, assets.bulwark);
  root.add(bulwark.root);

  scatter(root, patch, assets.kit, ctx, scatterScale);

  // The hero and close-up presets frame Bulwark's home pose rather than wherever he is, so a preset gives the same
  // view whenever it is applied: before-and-after dial comparisons and the lab's evidence frames then line up.
  const homePose = new Object3D();
  place(homePose, patch, BULWARK_HOME.x, BULWARK_HOME.z, HOME_YAW);

  let huskAngle = 0;
  let huskTimer = 0;
  let huskAttacking = 0;
  let mode: BulwarkMode = 'cycle';
  let cycleTime = 0;
  let runAngle = HOME_ANGLE;
  const huskWorld = new Vector3();
  const temp = new Vector3();

  function updateHusk(dt: number) {
    huskTimer += dt;
    if (huskAttacking > 0) {
      huskAttacking -= dt;
      if (huskAttacking <= 0) husk.play('walk');
    } else {
      huskAngle += (HUSK_SPEED / HUSK_RADIUS) * dt;
      if (huskTimer > 7) {
        huskTimer = 0;
        huskAttacking = husk.play('attack', true) || 1.4;
      } else {
        husk.play('walk');
      }
    }
    const x = Math.cos(huskAngle) * HUSK_RADIUS;
    const z = Math.sin(huskAngle) * HUSK_RADIUS;
    place(husk.root, patch, x, z, -huskAngle); // faces along its path (glTF characters face +Z)
    husk.mixer.update(dt);
  }

  function updateBulwark(dt: number) {
    cycleTime += dt;
    let running = mode === 'run';
    if (running) runAngle -= (RUN_SPEED / RUN_RADIUS) * dt;
    if (mode === 'cycle') {
      const t = cycleTime % 12;
      if (t < 3) bulwark.play('idle');
      else if (t < 3.85) bulwark.play('attack', t - dt < 3);
      else if (t < 6) bulwark.play('idle');
      else if (t < 6 + LAP_SECONDS) {
        running = true;
        // The angle comes from the cycle clock rather than accumulating, so every lap leaves home at 6 s and closes
        // on it one lap later, however the frames fall.
        runAngle = HOME_ANGLE - (RUN_SPEED / RUN_RADIUS) * (t - 6);
      } else bulwark.play('idle');
    } else if (mode === 'idle') bulwark.play('idle');
    else if (mode === 'attack') {
      // Strikes land every 1.6 s from the switch. Until the first he idles, or the previous mode's clip (a run, say)
      // would go on playing in place for 1.6 s.
      if (Math.floor((cycleTime - dt) / 1.6) !== Math.floor(cycleTime / 1.6)) bulwark.play('attack', true);
      else if (cycleTime < 1.6) bulwark.play('idle');
    }
    if (running) {
      bulwark.play('run');
      // The lap runs toward decreasing angle, with the heart on his left, because its direction at home is then 37
      // degrees from his home facing (-z) and he turns only that far where he leaves and rejoins it; run the other
      // way, he would swing through 143 degrees. His velocity is (sin a, 0, -cos a) and a glTF character faces +Z,
      // so his yaw is pi - a.
      place(bulwark.root, patch, Math.cos(runAngle) * RUN_RADIUS, Math.sin(runAngle) * RUN_RADIUS, Math.PI - runAngle);
    } else {
      place(bulwark.root, patch, BULWARK_HOME.x, BULWARK_HOME.z, HOME_YAW);
    }
    bulwark.mixer.update(dt);
  }

  /** Turns each head toward the Husk by at most maxTurn radians; the barrel's elevation follows at once. */
  function aimTurrets(maxTurn: number) {
    husk.root.getWorldPosition(huskWorld).add(temp.set(0, 0.8, 0));
    for (const { yaw, pitch } of turrets) {
      const local = yaw.parent ? yaw.parent.worldToLocal(huskWorld.clone()) : huskWorld.clone();
      const desired = Math.atan2(local.x - yaw.position.x, local.z - yaw.position.z);
      let delta = desired - yaw.rotation.y;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      yaw.rotation.y += Math.sign(delta) * Math.min(Math.abs(delta), maxTurn);
      const flat = Math.hypot(local.x - yaw.position.x, local.z - yaw.position.z);
      pitch.rotation.x = -Math.atan2(local.y - yaw.position.y - pitch.position.y, flat);
    }
  }

  // Every actor takes its place now, so the scene is whole before the first update(): the Husk on its ring, Bulwark
  // at home and every rail on the Husk. A turn of pi snaps the heads onto the Husk (a wrapped turn never exceeds pi)
  // rather than starting them facing outward.
  updateHusk(0);
  updateBulwark(0);
  aimTurrets(Math.PI);

  return {
    root,
    update(dt) {
      updateHusk(dt);
      updateBulwark(dt);
      aimTurrets(TURN_RATE * dt);
    },
    setHeartStage,
    setBulwarkMode(next) {
      // Each mode starts over: its clock from zero, and run mode's lap from home.
      mode = next;
      cycleTime = 0;
      runAngle = HOME_ANGLE;
    },
    preset(name) {
      const body = homePose.position;
      const forward = new Vector3(0, 0, 1).applyQuaternion(homePose.quaternion);
      // A glTF character's left is +X. The close-up stands on his left, toward the heart, because the lap passes
      // through home: his axis passes 1.4 m from the camera there, and would pass 0.3 m from one on his right.
      const left = new Vector3(1, 0, 0).applyQuaternion(homePose.quaternion);
      switch (name) {
        case 'hero':
          return { position: body.clone().addScaledVector(forward, -5.5).add(new Vector3(0, 2.4, 0)), target: body.clone().addScaledVector(forward, 4).add(new Vector3(0, 1.3, 0)) };
        case 'closeup':
          return {
            position: body.clone().addScaledVector(forward, 2.6).addScaledVector(left, 0.6).add(new Vector3(0, 1.6, 0)),
            target: body.clone().add(new Vector3(0, 1.35, 0)),
          };
        case 'strategic':
          return { position: new Vector3(0, 38, 30), target: new Vector3(0, 0, 0) };
        case 'horizon':
          return { position: new Vector3(-12, 1.6, 22), target: new Vector3(10, 2, -20) };
      }
    },
  };
}

export function applyPreset(scene: StyleScene, name: PresetName, camera: PerspectiveCamera, target: Vector3): void {
  const { position, target: look } = scene.preset(name);
  camera.position.copy(position);
  target.copy(look);
  camera.lookAt(look);
}
