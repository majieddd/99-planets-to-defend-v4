import { AnimationMixer, LoopRepeat, Quaternion, Vector3, type AnimationAction, type AnimationClip, type Mesh, type Object3D, type PerspectiveCamera, type SkinnedMesh } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import type { LoadedAsset } from '../../render/assets/loadAsset';
import { syncHullMorphs } from '../../render/ink/hull';
import { place, type Ground } from '../../render/terrain/place';
import { createCommanderFace } from '../shared/commanderFace';
import type { FaceDriver } from '../shared/faceDriver';
import type { PlacedMember } from './layout';
import {
  moveDirection,
  PLAY_BODY_RADIUS,
  PLAY_MIN_MEMBER_REACH,
  PLAY_SPAWN,
  runLoopDistance,
  runTimeScale,
  runWeight,
  stepMotion,
  type FootSample,
  type MotionState,
  type MoveInput,
  type Obstacle,
} from './playMotion';
import { THREE_QUARTER_TURN_DEG, toTangent, TOWARD_CAMERAS } from './registry';

/** The follow camera's opening distance from his chest, and its pitch above his horizon, in metres and degrees. */
export const PLAY_CAMERA_DISTANCE = 5.5;
export const PLAY_CAMERA_PITCH_DEG = 16;
/** How close and how far the wheel or a pinch takes the follow camera, in metres. */
export const PLAY_CAMERA_MIN_DISTANCE = 2.5;
export const PLAY_CAMERA_MAX_DISTANCE = 16;
/** The follow camera orbits no lower than this many degrees from straight down, a little above his chest's level. */
export const PLAY_CAMERA_MAX_POLAR_DEG = 84;
/** The point the camera follows, this many metres up his up line from his feet: his chest, on a 1.78 m body. */
export const PLAY_TARGET_HEIGHT = 1.1;
/** How fast the follow point closes on him, per second: it covers 63 percent of the gap in a tenth of a second. */
export const PLAY_FOLLOW_RATE = 10;
/** The moments the run clip is sampled at, evenly over one loop, to measure its stride. */
export const PLAY_STRIDE_SAMPLES = 64;

const UP = new Vector3(0, 1, 0);
const ASSET = 'commander_pip';

/** What the test handle and the evidence read of the play mode. */
export interface PlayReading {
  on: boolean;
  position: number[] | null;
  tangent: number[] | null;
  yaw: number;
  speed: number;
  runWeight: number;
  runTimeScale: number;
  /** The run clip's measured loop: the ground it covers, its length in seconds, and so the ground speed it plays at 1. */
  stride: { loopMetres: number; loopSeconds: number; clipSpeed: number } | null;
}

export interface PipPlay {
  /** False when the page has no Pip-A to play (a build without the assets). */
  readonly available: boolean;
  readonly active: boolean;
  enter(camera: PerspectiveCamera, controls: OrbitControls, members: readonly PlacedMember[], seed: number, frozen: boolean): void;
  exit(controls: OrbitControls): void;
  /** One frame: moves him by the input, poses him, and carries the camera with him; dt is 0 while the lab is frozen. */
  update(dt: number, input: MoveInput, camera: PerspectiveCamera, controls: OrbitControls): void;
  setFrozen(on: boolean): void;
  reading(): PlayReading;
}

/** The first bone whose name ends with one of the names, in the order given: GLTFLoader strips Mixamo's colon. */
function findBone(root: Object3D, names: readonly string[]): Object3D | null {
  const nodes: Object3D[] = [];
  root.traverse((object) => nodes.push(object));
  for (const name of names) {
    const found = nodes.find((object) => object.name.endsWith(name));
    if (found) return found;
  }
  return null;
}

/**
 * Measures the ground an in-place run clip covers in a loop, by posing a copy of the rig at PLAY_STRIDE_SAMPLES moments
 * and reading each foot's ball (its toe base, or its ankle if the rig has none) in the rig's own frame. The rate the
 * run then plays at is read from this, so a new export's stride is picked up without a number to update.
 */
function measureRunLoop(template: Object3D, clip: AnimationClip): PlayReading['stride'] {
  const rig = cloneRig(template);
  const feet = [findBone(rig, ['LeftToeBase', 'LeftFoot']), findBone(rig, ['RightToeBase', 'RightFoot'])];
  if (!feet[0] || !feet[1]) return null;
  const mixer = new AnimationMixer(rig);
  mixer.clipAction(clip).play();
  const samples: FootSample[][] = [];
  const point = new Vector3();
  for (let i = 0; i < PLAY_STRIDE_SAMPLES; i++) {
    mixer.setTime((i / PLAY_STRIDE_SAMPLES) * clip.duration);
    rig.updateMatrixWorld(true);
    samples.push(
      feet.map((foot) => {
        rig.worldToLocal(foot!.getWorldPosition(point));
        return { y: point.y, z: point.z };
      }),
    );
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(rig);
  const loopMetres = runLoopDistance(samples, clip.duration);
  return loopMetres === null ? null : { loopMetres, loopSeconds: clip.duration, clipSpeed: loopMetres / clip.duration };
}

/**
 * The play prototype's Pip-A: an instance of his rig of its own, not one of the placed members, which the keys or the
 * thumb pad walk about the patch while the camera follows. Call it before buildAssetWorld: it keeps a copy of his rig in
 * the bind pose, before the world's mixers pose the loaded one, because the face driver reads the jaw's axis from it.
 */
export function createPipPlay(assets: ReadonlyMap<string, LoadedAsset>, ground: Ground, parent: Object3D, hullMaterial: unknown, planetRadius: number): PipPlay {
  const asset = assets.get(ASSET);
  const template = asset ? cloneRig(asset.root) : null;
  const idleClip = asset?.animations.find((clip) => clip.name === 'idle') ?? null;
  const runClip = asset?.animations.find((clip) => clip.name === 'run') ?? null;
  let stride: PlayReading['stride'] | undefined;

  let root: Object3D | null = null;
  let mixer: AnimationMixer | null = null;
  let idle: AnimationAction | null = null;
  let run: AnimationAction | null = null;
  let face: FaceDriver | null = null;
  let obstacles: Obstacle[] = [];
  let motion: MotionState = { x: 0, z: 0, yaw: 0, speed: 0, drive: 0 };
  let weight = 0;
  let timeScale = 0;
  const follow = new Vector3();
  let saved: { minDistance: number; maxDistance: number; maxPolarAngle: number; enablePan: boolean } | null = null;
  const surfaceUp = new Vector3();
  const forward = new Vector3();
  const turn = new Quaternion();
  const desired = new Vector3();

  /** Every placed member's root on the tangent plane, with its drawn reach from the root widened by his body's. */
  function obstaclesOf(members: readonly PlacedMember[]): Obstacle[] {
    return members.map((entry) => {
      const { x, z } = toTangent(entry.member.s, entry.member.d);
      const at = entry.root.getWorldPosition(new Vector3());
      const { min, max } = entry.bounds;
      // The bounds' farthest face from the root across the ground: the patch lies within 7 degrees of level where the
      // members stand, so world x and z stand in for the ground's own two directions.
      const reach = Math.max(at.x - min.x, max.x - at.x, at.z - min.z, max.z - at.z, PLAY_MIN_MEMBER_REACH);
      return { x, z, radius: reach + PLAY_BODY_RADIUS };
    });
  }

  function pose(): void {
    if (!root) return;
    place(root, ground, motion.x, motion.z, motion.yaw);
  }

  /** His chest, where the camera looks: PLAY_TARGET_HEIGHT up his up line from his feet. */
  function chest(into: Vector3): Vector3 {
    const surface = ground.surfaceAt(motion.x, motion.z);
    return into.copy(surface.position).addScaledVector(surface.up, PLAY_TARGET_HEIGHT);
  }

  return {
    available: template !== null && idleClip !== null && runClip !== null,
    get active() {
      return root !== null;
    },
    enter(camera, controls, members, seed, frozen) {
      if (!template || !idleClip || !runClip || root) return;
      stride ??= measureRunLoop(template, runClip);
      if (!stride) console.warn('Play Pip: the run clip gave no stride to read, so it plays at its authored rate');
      root = cloneRig(template);
      root.name = 'play_pip';
      // A SkeletonUtils copy's hulls hold sliced copies of the body's morph influences until their first draw, as in
      // layout.ts, so the ink would not close with the lids until then.
      root.traverse((child) => {
        if ((child as Mesh).isMesh && (child as Mesh).material === hullMaterial) syncHullMorphs(child);
      });
      // Made in the bind pose, before the mixer below moves the rig, as the world's faces are.
      face = createCommanderFace(root, seed);
      face?.setFrozen(frozen);
      mixer = new AnimationMixer(root);
      idle = mixer.clipAction(idleClip).setLoop(LoopRepeat, Infinity).play();
      run = mixer.clipAction(runClip).setLoop(LoopRepeat, Infinity).play();
      run.setEffectiveWeight(0);
      run.timeScale = 0;
      weight = 0;
      timeScale = 0;
      obstacles = obstaclesOf(members);
      const { x, z } = toTangent(PLAY_SPAWN.s, PLAY_SPAWN.d);
      // He faces the cameras' bearing, turned toward the key as the placed characters are (THREE_QUARTER_TURN_DEG).
      motion = { x, z, yaw: Math.atan2(TOWARD_CAMERAS.x, TOWARD_CAMERAS.z) - (THREE_QUARTER_TURN_DEG * Math.PI) / 180, speed: 0, drive: 0 };
      pose();
      mixer.update(0);
      parent.add(root);

      saved = { minDistance: controls.minDistance, maxDistance: controls.maxDistance, maxPolarAngle: controls.maxPolarAngle, enablePan: controls.enablePan };
      controls.minDistance = PLAY_CAMERA_MIN_DISTANCE;
      controls.maxDistance = PLAY_CAMERA_MAX_DISTANCE;
      controls.maxPolarAngle = (PLAY_CAMERA_MAX_POLAR_DEG * Math.PI) / 180;
      // A pan would move the orbit's centre off him, and the follow would then carry that offset for good.
      controls.enablePan = false;
      // The camera opens on the world cameras' bearing from him, so he stands three-quarters on with the world behind.
      chest(follow);
      const surface = ground.surfaceAt(motion.x, motion.z);
      const pitch = (PLAY_CAMERA_PITCH_DEG * Math.PI) / 180;
      const away = new Vector3(TOWARD_CAMERAS.x, 0, TOWARD_CAMERAS.z).projectOnPlane(surface.up).normalize();
      controls.target.copy(follow);
      camera.position.copy(follow).addScaledVector(away, PLAY_CAMERA_DISTANCE * Math.cos(pitch)).addScaledVector(surface.up, PLAY_CAMERA_DISTANCE * Math.sin(pitch));
      camera.lookAt(follow);
    },
    exit(controls) {
      if (!root || !mixer) return;
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      root.removeFromParent();
      // The copy shares the loaded geometry and materials, which the world still draws; only its skeletons are its own.
      root.traverse((child) => (child as SkinnedMesh).isSkinnedMesh && (child as SkinnedMesh).skeleton.dispose());
      root = null;
      mixer = idle = run = null;
      face = null;
      if (saved) Object.assign(controls, saved);
      saved = null;
    },
    update(dt, input, camera, controls) {
      if (!root || !mixer || !idle || !run) return;
      // The camera's facing, laid on the ground at his feet and read in the frame place() turns him in, so W runs away
      // from the camera wherever he stands on the curve.
      surfaceUp.copy(ground.surfaceAt(motion.x, motion.z).up);
      forward.subVectors(controls.target, camera.position).projectOnPlane(surfaceUp);
      turn.setFromUnitVectors(UP, surfaceUp).invert();
      forward.applyQuaternion(turn);
      motion = stepMotion(motion, moveDirection(input, forward.x, forward.z), input.sprint, dt, obstacles, planetRadius);
      pose();

      weight = runWeight(motion.speed);
      timeScale = stride ? runTimeScale(motion.speed, stride.clipSpeed) : 1;
      idle.setEffectiveWeight(1 - weight);
      run.setEffectiveWeight(weight);
      run.timeScale = timeScale;
      mixer.update(dt);
      // After the mixer, which would otherwise write any morph or jaw track a clip carries over the face.
      face?.update(dt);

      // The orbit's centre closes on his chest, and the camera moves with it, so a drag still orbits and the wheel
      // still zooms about him.
      chest(desired);
      follow.lerp(desired, 1 - Math.exp(-PLAY_FOLLOW_RATE * dt));
      const shift = follow.clone().sub(controls.target);
      controls.target.add(shift);
      camera.position.add(shift);
    },
    setFrozen(on) {
      face?.setFrozen(on);
    },
    reading() {
      const at = root ? root.getWorldPosition(new Vector3()).toArray() : null;
      return {
        on: root !== null,
        position: at,
        tangent: root ? [motion.x, motion.z] : null,
        yaw: motion.yaw,
        speed: motion.speed,
        runWeight: weight,
        runTimeScale: timeScale,
        stride: stride ?? null,
      };
    },
  };
}
