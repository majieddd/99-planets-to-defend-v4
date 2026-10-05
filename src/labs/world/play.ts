import { AnimationMixer, LoopRepeat, Quaternion, Vector3, type AnimationAction, type AnimationClip, type Box3, type Mesh, type Object3D, type PerspectiveCamera, type SkinnedMesh } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import type { LoadedAsset } from '../../render/assets/loadAsset';
import { syncHullMorphs } from '../../render/ink/hull';
import { place, type Ground } from '../../render/terrain/place';
import timings from '../../shared/timings.json';
import { createCommanderFace } from '../shared/commanderFace';
import type { FaceDriver } from '../shared/faceDriver';
import type { CombatFeel } from './combatFeel';
import {
  bodyWeights,
  bufferOpensAt,
  COMBO_READY,
  comboPhase,
  comboWeights,
  contractOf,
  holdsRunWeight,
  stepCombo,
  swingMotion,
  type ComboPhase,
  type ComboState,
  type ComboStep,
} from './combo';
import { hitClips, splitClip, upperBodyBones, type HitClip, type HitSource } from './comboClips';
import type { PlacedMember } from './layout';
import {
  blendRunWeight,
  clearance,
  FREE_MOTION,
  groundForward,
  moveDirection,
  PLAY_BODY_RADIUS,
  PLAY_MIN_MEMBER_REACH,
  PLAY_SPAWN,
  runLoopDistance,
  runTimeScale,
  stepMotion,
  type FootSample,
  type MotionState,
  type MoveInput,
  type Obstacle,
  type SwingMotion,
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
/**
 * The source attack clip's strike moment, in seconds into it, from the shared contract (src/shared/timings.json) that
 * assets:check holds the exported clip to: the placeholder hits are warped so this moment lands on each hit's own strike.
 */
const SOURCE_STRIKE = timings.commanders.commander_pip.attack.strike;

/** What the test handle and the evidence read of the play mode. */
export interface PlayReading {
  on: boolean;
  position: number[] | null;
  tangent: number[] | null;
  yaw: number;
  speed: number;
  /** The run's weight against the idle by his speed (held while the finisher fades in over a stop). */
  runWeight: number;
  runTimeScale: number;
  /** The run clip's measured loop: the ground it covers, its length in seconds, and so the ground speed it plays at 1. */
  stride: { loopMetres: number; loopSeconds: number; clipSpeed: number } | null;
  /** How far he stands outside the nearest member's reach, in metres on the tangent plane (negative inside one). */
  clearance: number | null;
  /** Whether a hit of the combo is playing, and its clip time, in seconds (null out of a hit). */
  attacking: boolean;
  attackTime: number | null;
  /** The playing hit's own weight, from 0 to 1. */
  attackWeight: number;
  /** The playing hit's contract: its length, its strike moment and its cancel point, in seconds (null out of a hit). */
  attackSeconds: number | null;
  strikeAt: number | null;
  cancelAt: number | null;
  /** When a press starts to count during the playing hit (bufferOpensAt), in seconds into it (null out of a hit). */
  bufferOpensAt: number | null;
  /** The strikes since he came out to play, in all, by hit (attack_1 to attack_3), and the hit that struck last. */
  strikes: number;
  strikesByStep: number[];
  lastStrikeStep: number | null;
  /** The combo: the playing hit (1 to 3, 0 for none), where it is, whether a press is kept, and the next hit's step. */
  comboStep: number;
  phase: ComboPhase;
  queued: boolean;
  nextStep: number;
  /** Seconds since the last hit ended, while none plays. */
  sinceEnd: number;
  /** The clip time the hit before had reached when this one began (null for a chain's first hit or out of a hit). */
  chainedAt: number | null;
  /** The hit fading out under the playing one (0 for none), and its weight. */
  outgoingStep: number;
  outgoingWeight: number;
  /** Where each hit's clip came from, attack_1 to attack_3 (null without a combo), and the playing hit's. */
  sources: HitSource[] | null;
  source: HitSource | null;
  /** Each hit's clip length less its contract's, in seconds, attack_1 to attack_3 (null without a combo; hitClips). */
  clipLengthOff: number[] | null;
  /** Presses dropped since he came out: before a buffer opened, while one was kept, or on a frozen frame. */
  dropped: number;
  /** The hits' total weight on the upper body and on the lower body, and the run's weight on the legs. */
  upperAttackWeight: number;
  lowerAttackWeight: number;
  legsRunWeight: number;
  /** How the playing hit holds him back this frame: the share of his pace and of his turn rate he keeps. */
  moveScale: number;
  turnScale: number;
  /**
   * Each foot's ball (its toe base, or its ankle) in world space as last drawn, left then right (null out of play): the
   * browser test reads the finisher's step and the frames around its end from these, for a slide or a snap.
   */
  feet: number[][] | null;
}

/**
 * The two clocks a frame of play runs on, in seconds. Kept apart so phase B's hit-stop can hold the combo's clock at 0
 * for a few frames on contact while his movement, the camera and the input go on: a press in the stop is still taken
 * and kept (combo.ts), and the combo picks up where it stopped once its clock runs again. Both are the frame's step
 * today, and both 0 while the lab is frozen.
 */
export interface PlayClocks {
  /** The combo and his clips: the hits' clip times, the mixer and his face. */
  combo: number;
  /** His movement and the camera's follow; also the frame's real interval, which the hits' fades read (ownWeight). */
  motion: number;
}

/**
 * Where he comes out and how the camera first frames him: his point on the plane tangent at the pole and his yaw, the
 * way from him toward the camera on that plane (any length), and the camera's distance from his chest and its pitch
 * above his horizon. The Asset World and the combat arena each have their own.
 */
export interface PlayStart {
  x: number;
  z: number;
  yaw: number;
  cameraBearing: { x: number; z: number };
  cameraDistance: number;
  cameraPitchDeg: number;
}

/**
 * The Asset World's start: PLAY_SPAWN, facing the cameras' bearing turned toward the key as the placed characters are
 * (THREE_QUARTER_TURN_DEG), with the camera opening on the world cameras' bearing from him, so he stands three-quarters
 * on with the world behind him.
 */
export function worldPlayStart(): PlayStart {
  const { x, z } = toTangent(PLAY_SPAWN.s, PLAY_SPAWN.d);
  return {
    x,
    z,
    yaw: Math.atan2(TOWARD_CAMERAS.x, TOWARD_CAMERAS.z) - (THREE_QUARTER_TURN_DEG * Math.PI) / 180,
    cameraBearing: { x: TOWARD_CAMERAS.x, z: TOWARD_CAMERAS.z },
    cameraDistance: PLAY_CAMERA_DISTANCE,
    cameraPitchDeg: PLAY_CAMERA_PITCH_DEG,
  };
}

/**
 * A body's reach across the ground from its root at `at`, from its drawn bounds: their farthest face from the root, and
 * never less than PLAY_MIN_MEMBER_REACH. The patch lies within 7 degrees of level where the members and the arena's
 * dummies stand, so world x and z stand in for the ground's own two directions. Every obstacle he walks round, a member
 * of the Asset World or a training dummy, is read this way and widened by his own PLAY_BODY_RADIUS.
 */
export function groundReach(at: Vector3, bounds: Box3): number {
  const { min, max } = bounds;
  return Math.max(at.x - min.x, max.x - at.x, at.z - min.z, max.z - at.z, PLAY_MIN_MEMBER_REACH);
}

/** Every placed member of the Asset World as an obstacle: its root on the tangent plane and its reach widened by his. */
export function memberObstacles(members: readonly PlacedMember[]): Obstacle[] {
  return members.map((entry) => {
    const { x, z } = toTangent(entry.member.s, entry.member.d);
    return { x, z, radius: groundReach(entry.root.getWorldPosition(new Vector3()), entry.bounds) + PLAY_BODY_RADIUS };
  });
}

export interface PipPlay {
  /** False when the page has no Pip to play (a build without the assets). */
  readonly available: boolean;
  readonly active: boolean;
  /**
   * Puts him out at `start` (the Asset World's, worldPlayStart, by default) among `obstacles`, the reaches he walks
   * round, his face blinking on `seed` and held while `frozen`.
   */
  enter(camera: PerspectiveCamera, controls: OrbitControls, obstacles: readonly Obstacle[], seed: number, frozen: boolean, start?: PlayStart): void;
  exit(controls: OrbitControls): void;
  /**
   * Stands him back at the start, still and out of any hit, with the camera framing him as it first did, or as `start`
   * frames him when given (the arena reads its framing again for a screen turned since the load); the reading's counts
   * (strikes, dropped presses) run on, since he has not left play.
   */
  respawn(camera: PerspectiveCamera, controls: OrbitControls, start?: PlayStart): void;
  /**
   * One frame: takes the frame's attack press into the combo (combo.ts says what a press does when), moves him by the
   * input as the playing hit allows, poses him, and carries the camera with him. A press while the lab is frozen is
   * dropped here and counted (`dropped`), since a frozen lab takes no input; one on a combo clock of 0 that is not a
   * freeze, phase B's hit-stop, reaches the combo and is kept.
   */
  update(clocks: PlayClocks, input: MoveInput, attack: boolean, camera: PerspectiveCamera, controls: OrbitControls): void;
  setFrozen(on: boolean): void;
  /**
   * Takes new obstacles while he plays: the Asset World's after the slider heart's drawn size changed, the arena's after
   * a dummy moved or went home.
   */
  refreshObstacles(obstacles: readonly Obstacle[]): void;
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

/** A clip's two halves (comboClips.ts, splitClip), or the whole clip as the lower half when the rig has no mask. */
interface Halves {
  upper: AnimationClip | null;
  lower: AnimationClip;
}

/** A clip's two actions on the play mixer. */
interface HalfActions {
  upper: AnimationAction | null;
  lower: AnimationAction;
}

/**
 * The play prototype's Pip: an instance of his rig of its own, not one of the placed members, which the keys or the
 * thumb pad walk about the patch while the camera follows, and F, a click or the attack button swing his sword through
 * the three-hit combo (combo.ts: the chain, the buffered press, the crossfades, and how each hit slows and turns him).
 * The light hits play on his upper body over the run or the idle, the finisher on his whole body; his clips are split
 * at the spine for it (comboClips.ts). `feel` is the page's one combat feel object, which the panel's sliders write and
 * every frame reads, so a change takes effect on the next frame. Call it before buildAssetWorld: it keeps a copy of his
 * rig in the bind pose, before the world's mixers pose the loaded one, because the face driver reads the jaw's axis
 * from it.
 */
export function createPipPlay(assets: ReadonlyMap<string, LoadedAsset>, ground: Ground, parent: Object3D, hullMaterial: unknown, planetRadius: number, feel: CombatFeel): PipPlay {
  const asset = assets.get(ASSET);
  const template = asset ? cloneRig(asset.root) : null;
  const idleClip = asset?.animations.find((clip) => clip.name === 'idle') ?? null;
  const runClip = asset?.animations.find((clip) => clip.name === 'run') ?? null;
  const hits: HitClip[] | null = asset ? hitClips(asset.animations, SOURCE_STRIKE) : null;
  const upperNames = template ? upperBodyBones(template) : null;
  if (template && !upperNames) console.warn('Play Pip: the rig has no spine bone to split the attacks at, so every hit plays on his whole body');
  const halvesOf = (clip: AnimationClip): Halves => (upperNames ? splitClip(clip, upperNames) : { upper: null, lower: clip });
  const idleHalves = idleClip ? halvesOf(idleClip) : null;
  const runHalves = runClip ? halvesOf(runClip) : null;
  const hitHalves = hits ? hits.map((hit) => halvesOf(hit.clip)) : null;
  let stride: PlayReading['stride'] | undefined;

  let root: Object3D | null = null;
  let feet: (Object3D | null)[] = [];
  let mixer: AnimationMixer | null = null;
  let idle: HalfActions | null = null;
  let run: HalfActions | null = null;
  let hitActions: HalfActions[] = [];
  let face: FaceDriver | null = null;
  let obstacles: Obstacle[] = [];
  let motion: MotionState = { x: 0, z: 0, yaw: 0, speed: 0, drive: 0 };
  let combo: ComboState = COMBO_READY;
  let strikes = 0;
  let strikesByStep = [0, 0, 0];
  let lastStrikeStep: ComboStep | null = null;
  let dropped = 0;
  let frozen = false;
  let runShare = 0;
  let weights = { current: 0, outgoing: 0 };
  let body = bodyWeights(0, 0, false, 0, false);
  let swing: SwingMotion = FREE_MOTION;
  let timeScale = 0;
  const follow = new Vector3();
  let saved: { minDistance: number; maxDistance: number; maxPolarAngle: number; enablePan: boolean } | null = null;
  const surfaceUp = new Vector3();
  const right = new Vector3();
  const forward = new Vector3();
  const turn = new Quaternion();
  const desired = new Vector3();
  const shift = new Vector3();

  let start: PlayStart = worldPlayStart();

  function pose(): void {
    if (!root) return;
    place(root, ground, motion.x, motion.z, motion.yaw);
  }

  /** His chest, where the camera looks: PLAY_TARGET_HEIGHT up his up line from his feet. */
  function chest(into: Vector3): Vector3 {
    const surface = ground.surfaceAt(motion.x, motion.z);
    return into.copy(surface.position).addScaledVector(surface.up, PLAY_TARGET_HEIGHT);
  }

  /** Both halves of a clip as actions on the mixer, playing, at no weight. */
  function actionsOf(on: AnimationMixer, halves: Halves, loop: boolean): HalfActions {
    const make = (clip: AnimationClip): AnimationAction => {
      const action = on.clipAction(clip);
      if (loop) action.setLoop(LoopRepeat, Infinity);
      action.play();
      action.setEffectiveWeight(0);
      return action;
    };
    return { upper: halves.upper ? make(halves.upper) : null, lower: make(halves.lower) };
  }

  function weigh(actions: HalfActions, upper: number, lower: number): void {
    actions.upper?.setEffectiveWeight(upper);
    actions.lower.setEffectiveWeight(lower);
  }

  /** Whether a hit plays on his whole body: a planted hit always, and every hit on a rig the mask could not split. */
  const planted = (step: ComboStep): boolean => !upperNames || contractOf(step).planted;

  /**
   * Stands him at the start, still and out of any hit, and frames him there: the orbit's centre on his chest and the
   * camera on the start's bearing from him, at its distance and pitch. The next update weighs his clips from this.
   */
  function toStart(camera: PerspectiveCamera, controls: OrbitControls): void {
    motion = { x: start.x, z: start.z, yaw: start.yaw, speed: 0, drive: 0 };
    combo = COMBO_READY;
    runShare = 0;
    weights = { current: 0, outgoing: 0 };
    body = bodyWeights(0, 0, false, 0, false);
    swing = FREE_MOTION;
    timeScale = 0;
    pose();
    chest(follow);
    const surface = ground.surfaceAt(motion.x, motion.z);
    const pitch = (start.cameraPitchDeg * Math.PI) / 180;
    const away = new Vector3(start.cameraBearing.x, 0, start.cameraBearing.z).projectOnPlane(surface.up).normalize();
    controls.target.copy(follow);
    camera.position.copy(follow).addScaledVector(away, start.cameraDistance * Math.cos(pitch)).addScaledVector(surface.up, start.cameraDistance * Math.sin(pitch));
    camera.lookAt(follow);
  }

  return {
    available: template !== null && idleClip !== null && runClip !== null,
    get active() {
      return root !== null;
    },
    enter(camera, controls, obstaclesNow, seed, frozenNow, startNow) {
      if (!template || !idleHalves || !runHalves || !runClip || root) return;
      frozen = frozenNow;
      start = startNow ?? worldPlayStart();
      stride ??= measureRunLoop(template, runClip);
      if (!stride) console.warn('Play Pip: the run clip gave no stride to read, so it plays at its authored rate');
      root = cloneRig(template);
      root.name = 'play_pip';
      feet = [findBone(root, ['LeftToeBase', 'LeftFoot']), findBone(root, ['RightToeBase', 'RightFoot'])];
      // A SkeletonUtils copy's hulls hold sliced copies of the body's morph influences until their first draw, as in
      // layout.ts, so the ink would not close with the lids until then.
      root.traverse((child) => {
        if ((child as Mesh).isMesh && (child as Mesh).material === hullMaterial) syncHullMorphs(child);
      });
      // Made in the bind pose, before the mixer below moves the rig, as the world's faces are.
      face = createCommanderFace(root, seed);
      face?.setFrozen(frozen);
      const on = new AnimationMixer(root);
      mixer = on;
      idle = actionsOf(on, idleHalves, true);
      weigh(idle, 1, 1);
      run = actionsOf(on, runHalves, true);
      for (const action of [run.upper, run.lower]) if (action) action.timeScale = 0;
      // Each hit's clip time is set from the combo every frame rather than advanced by the mixer, so the pose, the
      // reading and the strike moment all come from the one clock in combo.ts. With its time scale at 0 the mixer never
      // moves a hit's time, so its loop mode and clampWhenFinished, which act only on a time the mixer moves, would do
      // nothing, and they are left off.
      hitActions = (hitHalves ?? []).map((halves) => {
        const actions = actionsOf(on, halves, false);
        for (const action of [actions.upper, actions.lower]) if (action) action.timeScale = 0;
        return actions;
      });
      strikes = 0;
      strikesByStep = [0, 0, 0];
      lastStrikeStep = null;
      dropped = 0;
      obstacles = [...obstaclesNow];

      saved = { minDistance: controls.minDistance, maxDistance: controls.maxDistance, maxPolarAngle: controls.maxPolarAngle, enablePan: controls.enablePan };
      controls.minDistance = PLAY_CAMERA_MIN_DISTANCE;
      controls.maxDistance = PLAY_CAMERA_MAX_DISTANCE;
      controls.maxPolarAngle = (PLAY_CAMERA_MAX_POLAR_DEG * Math.PI) / 180;
      // A pan would move the orbit's centre off him, and the follow would then carry that offset for good.
      controls.enablePan = false;
      toStart(camera, controls);
      on.update(0);
      parent.add(root);
    },
    respawn(camera, controls, startNow) {
      if (!root) return;
      if (startNow) start = startNow;
      toStart(camera, controls);
    },
    exit(controls) {
      if (!root || !mixer) return;
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      root.removeFromParent();
      // The copy shares the loaded geometry and materials, which the world still draws; only its skeletons are its own.
      root.traverse((child) => (child as SkinnedMesh).isSkinnedMesh && (child as SkinnedMesh).skeleton.dispose());
      root = null;
      feet = [];
      mixer = idle = run = null;
      hitActions = [];
      face = null;
      combo = COMBO_READY;
      if (saved) Object.assign(controls, saved);
      saved = null;
    },
    update(clocks, input, attackAsked, camera, controls) {
      if (!root || !mixer || !idle || !run) return;
      const asked = attackAsked && hits !== null;
      // The press and the combo's step go into the combo first, so this frame's movement already follows the hit it
      // leaves playing. The combo keeps a press on a step of 0, for phase B's hit-stop, so the lab's freeze, which takes
      // no input, drops its presses here.
      if (asked && frozen) dropped += 1;
      const frame = stepCombo(combo, asked && !frozen, clocks.combo, feel, clocks.motion);
      combo = frame.state;
      if (frame.press === 'dropped') dropped += 1;
      if (frame.struck !== null) {
        strikes += 1;
        strikesByStep[frame.struck - 1]! += 1;
        lastStrikeStep = frame.struck;
      }
      swing = swingMotion(combo, feel);
      // The camera's facing, laid on the ground at his feet from the camera's level right (groundForward, which says why
      // the view ray is not used) and read in the frame place() turns him in, so W runs up the screen wherever he stands
      // on the curve and however high the camera is.
      surfaceUp.copy(ground.surfaceAt(motion.x, motion.z).up);
      right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      const ahead = groundForward(surfaceUp, right);
      if (ahead) forward.set(ahead.x, ahead.y, ahead.z);
      else forward.set(0, 0, 0);
      turn.setFromUnitVectors(UP, surfaceUp).invert();
      forward.applyQuaternion(turn);
      motion = stepMotion(motion, moveDirection(input, forward.x, forward.z), input.sprint, clocks.motion, obstacles, planetRadius, swing);
      pose();

      // The fades read the frame's real interval (ownWeight), so a frozen frame, whose interval is 0, keeps the weights
      // it had rather than jumping by a frame's worth of fade; a held combo clock with frames still running (phase B's
      // hit-stop) reads the same interval as the frames around it, so its weights hold too.
      if (clocks.motion > 0) weights = comboWeights(combo, clocks.motion);
      // The run keeps its weight while the finisher fades in over his stop (holdsRunWeight says why).
      runShare = blendRunWeight(runShare, motion.speed, holdsRunWeight(combo));
      timeScale = stride ? runTimeScale(motion.speed, stride.clipSpeed) : 1;
      const current = combo.hit;
      const outgoing = current ? combo.outgoing : null;
      body = bodyWeights(runShare, weights.current, current ? planted(current.step) : false, outgoing ? weights.outgoing : 0, outgoing ? planted(outgoing.step) : false);
      weigh(idle, body.upper.idle, body.lower.idle);
      weigh(run, body.upper.run, body.lower.run);
      for (const action of [run.upper, run.lower]) if (action) action.timeScale = timeScale;
      hitActions.forEach((actions, index) => {
        const step = (index + 1) as ComboStep;
        const isCurrent = current !== null && current.step === step;
        const isOutgoing = outgoing !== null && outgoing.step === step;
        const time = isCurrent ? current.time : isOutgoing ? outgoing.time : 0;
        for (const action of [actions.upper, actions.lower]) if (action) action.time = time;
        weigh(actions, (isCurrent ? body.upper.current : 0) + (isOutgoing ? body.upper.outgoing : 0), (isCurrent ? body.lower.current : 0) + (isOutgoing ? body.lower.outgoing : 0));
      });
      mixer.update(clocks.combo);
      // After the mixer, which would otherwise write any morph or jaw track a clip carries over the face; the blinks run
      // through the swings, and hold with the clips, so the whole figure holds together under a held combo clock.
      face?.update(clocks.combo);

      // The orbit's centre closes on his chest, and the camera moves with it, so a drag still orbits and the wheel
      // still zooms about him.
      chest(desired);
      follow.lerp(desired, 1 - Math.exp(-PLAY_FOLLOW_RATE * clocks.motion));
      shift.subVectors(follow, controls.target);
      controls.target.add(shift);
      camera.position.add(shift);
    },
    setFrozen(on) {
      frozen = on;
      face?.setFrozen(on);
    },
    refreshObstacles(obstaclesNow) {
      if (root) obstacles = [...obstaclesNow];
    },
    reading() {
      const at = root ? root.getWorldPosition(new Vector3()).toArray() : null;
      const hit = combo.hit;
      const contract = hit ? contractOf(hit.step) : null;
      return {
        on: root !== null,
        position: at,
        tangent: root ? [motion.x, motion.z] : null,
        yaw: motion.yaw,
        speed: motion.speed,
        runWeight: runShare,
        runTimeScale: timeScale,
        stride: stride ?? null,
        clearance: root ? clearance(motion.x, motion.z, obstacles) : null,
        attacking: hit !== null,
        attackTime: hit ? hit.time : null,
        attackWeight: weights.current,
        attackSeconds: contract ? contract.duration : null,
        strikeAt: contract ? contract.strike : null,
        cancelAt: contract ? contract.cancel : null,
        bufferOpensAt: contract ? bufferOpensAt(contract, feel.buffer) : null,
        strikes,
        strikesByStep: [...strikesByStep],
        lastStrikeStep,
        comboStep: hit ? hit.step : 0,
        phase: comboPhase(combo),
        queued: combo.queued,
        nextStep: combo.next,
        sinceEnd: combo.sinceEnd,
        chainedAt: hit ? hit.chainedAt : null,
        outgoingStep: hit && combo.outgoing ? combo.outgoing.step : 0,
        outgoingWeight: hit && combo.outgoing ? weights.outgoing : 0,
        sources: hits ? hits.map((entry) => entry.source) : null,
        source: hit && hits ? hits[hit.step - 1]!.source : null,
        clipLengthOff: hits ? hits.map((entry) => entry.lengthOff) : null,
        dropped,
        upperAttackWeight: body.upper.current + body.upper.outgoing,
        lowerAttackWeight: body.lower.current + body.lower.outgoing,
        legsRunWeight: body.lower.run,
        moveScale: swing.moveScale,
        turnScale: swing.turnScale,
        feet: root && feet.every(Boolean) ? feet.map((foot) => foot!.getWorldPosition(new Vector3()).toArray()) : null,
      };
    },
  };
}
