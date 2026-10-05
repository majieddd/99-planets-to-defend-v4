import {
  AnimationMixer,
  LoopRepeat,
  Quaternion,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Box3,
  type IUniform,
  type Mesh,
  type Object3D,
  type PerspectiveCamera,
  type SkinnedMesh,
  type Texture,
} from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import type { LoadedAsset } from '../../render/assets/loadAsset';
import { syncHullMorphs } from '../../render/ink/hull';
import { place, type Ground } from '../../render/terrain/place';
import timings from '../../shared/timings.json';
import { createCommanderFace } from '../shared/commanderFace';
import { flatTexture } from '../shared/labAssets';
import type { FaceDriver } from '../shared/faceDriver';
import { BLADE_SWING_PIVOT_M, bladeHand, measureBlade, sampleBlade } from './blade';
import type { CombatFeel } from './combatFeel';
import {
  bodyWeights,
  bufferOpensAt,
  COMBO_READY,
  comboPhase,
  COMBO_HITS,
  comboWeights,
  contractOf,
  fadeStep,
  FIRST_FADE_STEP,
  holdsRunWeight,
  stepCombo,
  swingMotion,
  type ComboFrame,
  type ComboPhase,
  type ComboState,
  type ComboStep,
  type HitContract,
} from './combo';
import { hitClips, splitClip, upperBodyBones, type HitClip, type HitSource } from './comboClips';
import type { PlacedMember } from './layout';
import { freshLunge, stepLunge } from './lunge';
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
import { createSwordTrail, type SwordTrail, type TrailReading } from './swordTrail';

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
  /** The clocks the last frame ran on (PlayClocks): a hit-stop shows as a combo and motion step under the frame's. */
  clocks: PlayClocks;
  /**
   * The playing hit's lunge: the metres it has carried him so far, the metres it was planned to, the target the assist
   * chose (an index into the targets, or -1), the turn it adds in degrees, and whether a body or the edge stopped it.
   */
  lunge: { moved: number; planned: number; target: number; turnDeg: number; blocked: boolean };
  /** The sword trail: its samples, its brightest sample's shade and whether it is taking samples. */
  trail: TrailReading;
  /** The blade's base and tip in world space as last drawn, or null without a measured blade. */
  blade: { base: number[]; tip: number[] } | null;
}

/**
 * The clocks a frame of play runs on, in seconds, kept apart so phase B's hit-stop can hold Pip while the view goes on.
 * For a hit-stop, phase B holds `combo` and `motion` both at 0 for the stop's frames and leaves `frame` running. The
 * combo's clock holds his hit and all his clips, the idle's and the run's loops included, since the mixer runs on it,
 * so his movement must hold with it: held alone, the combo froze his legs mid-stride while `motion` carried him on, and
 * he skated. `frame` drives the camera's follow, and phase B's sparks and shake will read it too, so the view stays alive
 * through the stop. A press in the stop is still taken and kept (combo.ts), and the combo picks up where it stopped once
 * its clock runs again; the hits' fades read the combo's last moving step meanwhile (fadeStep, combo.ts), not any of
 * these. `motion` used to be the camera's interval and the fades' too, so a stop that held it would have stopped the
 * camera and read every fade at a step of 0. The pages give all three the frame's interval clamped to MAX_FRAME_STEP
 * (labs/shared/paintedStage.ts), so a stall does not jump the scene, and all three 0 while the lab is frozen.
 */
export interface PlayClocks {
  /** The combo and his clips: the hits' clip times, the mixer (the idle's and run's loops too) and his face. */
  combo: number;
  /** His movement across the ground. */
  motion: number;
  /** The frame's own clamped interval: the camera's follow, which a hit-stop leaves running. */
  frame: number;
}

/**
 * Where he finds the reaches he walks round, read on every update: the Asset World's members, or the arena's training
 * dummies as they stand now. A list handed over once had to be handed over again after every change (a dummy knocked
 * back, the slider heart grown), and a change the page forgot to hand on left him walking into a body or round air.
 * The provider should return a list it keeps rather than build one each frame.
 */
export type ObstacleSource = () => readonly Obstacle[];

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
  /**
   * The combo's contracts he plays (COMBO_HITS from src/shared/timings.json unless the page hands others), which the
   * arena's impact reads too, so a hit's active frames, strike and cancel come from one place.
   */
  readonly contracts: readonly HitContract[];
  readonly active: boolean;
  /**
   * Puts him out at `start` (the Asset World's, worldPlayStart, by default) among the reaches `obstacles` gives on each
   * update, his face blinking on `seed` and held while `frozen`. `targets` gives what the lunge's assist may turn him
   * toward (the arena's dummies); the Asset World gives none, so there he lunges straight ahead.
   */
  enter(camera: PerspectiveCamera, controls: OrbitControls, obstacles: ObstacleSource, seed: number, frozen: boolean, start?: PlayStart, targets?: ObstacleSource): void;
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
   * freeze, phase B's hit-stop, reaches the combo and is kept. Returns the frame's combo step (stepCombo's ComboFrame:
   * the hit that struck on it, the hit that began, what the press did), which phase B's hit detection reads on the
   * frame it happens, with nothing built for it; null when he is not out.
   */
  update(clocks: PlayClocks, input: MoveInput, attack: boolean, camera: PerspectiveCamera, controls: OrbitControls): ComboFrame | null;
  setFrozen(on: boolean): void;
  reading(): PlayReading;
  /**
   * His root on the tangent plane, or null when he is not out: one object, rewritten on each call, for a caller that
   * reads it often (a knocked-back dummy stops at his body on every push), where reading() builds the whole reading.
   */
  at(): Readonly<{ x: number; z: number }> | null;
  /**
   * Writes the blade's base and tip in world space as last drawn into `base` and `tip`, and the point its sweep turns
   * about (his shoulders, BLADE_SWING_PIVOT_M up his up line) into `pivot`; false without a blade.
   */
  blade(base: Vector3, tip: Vector3, pivot?: Vector3): boolean;
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
 * at the spine for it (comboClips.ts). His sword trail goes in `energy`, the page's energy scene (labs/shared/paintedStage.ts),
 * which the pipeline draws over the inked frame. `feel` is the page's one combat feel object, which the panel's sliders write and
 * every frame reads, so a change takes effect on the next frame. Call it before buildAssetWorld: it keeps a copy of his
 * rig in the bind pose, before the world's mixers pose the loaded one, because the face driver reads the jaw's axis
 * from it.
 */
/** What Play Pip is made from (createPipPlay). */
export interface PipPlayOptions {
  /** The page's loaded assets, of which he takes commander_pip. */
  assets: ReadonlyMap<string, LoadedAsset>;
  ground: Ground;
  /** Where his rig goes: the page's scene. */
  parent: Object3D;
  /** Where his sword trail goes: the page's energy scene (labs/shared/paintedStage.ts), drawn over the inked frame. */
  energy: Object3D;
  /** The shared hull material, whose meshes on his copy have their morphs synced. */
  hullMaterial: unknown;
  planetRadius: number;
  /** The page's one combat feel object, which the panel's sliders write and every frame reads. */
  feel: CombatFeel;
  /** The painted materials' shared brush atlas uniform, which the trail paints with (a flat grey without it). */
  brush?: IUniform<Texture | null>;
  /** The combo's contracts, COMBO_HITS by default: a new set of clips with new numbers drops in here. */
  contracts?: readonly HitContract[];
}

export function createPipPlay(options: PipPlayOptions): PipPlay {
  const { assets, ground, parent, energy, hullMaterial, planetRadius, feel } = options;
  const brush: IUniform<Texture | null> = options.brush ?? { value: flatTexture(128) };
  const contracts = options.contracts ?? COMBO_HITS;
  const asset = assets.get(ASSET);
  const template = asset ? cloneRig(asset.root) : null;
  const idleClip = asset?.animations.find((clip) => clip.name === 'idle') ?? null;
  const runClip = asset?.animations.find((clip) => clip.name === 'run') ?? null;
  const hits: HitClip[] | null = asset ? hitClips(asset.animations, SOURCE_STRIKE, contracts) : null;
  const upperNames = template ? upperBodyBones(template) : null;
  if (template && !upperNames) console.warn('Play Pip: the rig has no spine bone to split the attacks at, so every hit plays on his whole body');
  const halvesOf = (clip: AnimationClip): Halves => (upperNames ? splitClip(clip, upperNames) : { upper: null, lower: clip });
  const idleHalves = idleClip ? halvesOf(idleClip) : null;
  const runHalves = runClip ? halvesOf(runClip) : null;
  const hitHalves = hits ? hits.map((hit) => halvesOf(hit.clip)) : null;
  // The blade, read once from the bind-pose copy (blade.ts): its base and tip in the hand's frame, which every copy of
  // the rig shares.
  const bladeMeasure = template ? measureBlade(template) : null;
  if (template && !bladeMeasure) console.warn('Play Pip: the rig has no blade on its right hand, so no sword trail is drawn');
  let stride: PlayReading['stride'] | undefined;

  let root: Object3D | null = null;
  let feet: (Object3D | null)[] = [];
  let mixer: AnimationMixer | null = null;
  let idle: HalfActions | null = null;
  let run: HalfActions | null = null;
  let hitActions: HalfActions[] = [];
  let face: FaceDriver | null = null;
  let hand: Object3D | null = null;
  let trail: SwordTrail | null = null;
  const bladeBase = new Vector3();
  const bladeTip = new Vector3();
  const bladePivot = new Vector3();
  const rootUp = new Vector3();
  let bladeDrawn = false;
  const noObstacles: readonly Obstacle[] = [];
  let obstacles: ObstacleSource = () => noObstacles;
  let targets: ObstacleSource = () => noObstacles;
  // The playing hit's lunge (lunge.ts): planned on the frame it begins, carried by the share of its window the hit's
  // time has reached, swept against the bodies a frame's share at a time.
  const lunge = freshLunge();
  const lungeAt = { x: 0, z: 0, yaw: 0 };
  const lastClocks: PlayClocks = { combo: 0, motion: 0, frame: 0 };
  let motion: MotionState = { x: 0, z: 0, yaw: 0, speed: 0, drive: 0 };
  let combo: ComboState = COMBO_READY;
  // The step the hits' fades read: the combo's last moving step, kept through a held clock (fadeStep, combo.ts).
  let fadeStepNow = FIRST_FADE_STEP;
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
  const here = { x: 0, z: 0 };
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
  const planted = (step: ComboStep): boolean => !upperNames || contractOf(step, contracts).planted;

  /**
   * Stands him at the start, still and out of any hit, and frames him there: the orbit's centre on his chest and the
   * camera on the start's bearing from him, at its distance and pitch. The next update weighs his clips from this.
   */
  /** Forgets the lunge: a new hit plans its own. */
  function clearLunge(): void {
    lunge.plan = null;
    lunge.done = 0;
    lunge.moved = 0;
    lunge.blocked = false;
  }

  /**
   * Carries the playing hit's lunge (stepLunge, lunge.ts) on top of what his drive moved him: the plant's locked
   * steering still holds, and only the lunge moves him. A step of 0, a hit-stop, holds the hit's time and so the lunge.
   */
  function carryLunge(): void {
    const hit = combo.hit;
    if (!hit) return;
    const contract = contractOf(hit.step, contracts);
    lungeAt.x = motion.x;
    lungeAt.z = motion.z;
    lungeAt.yaw = motion.yaw;
    const before = lunge.done;
    stepLunge(lunge, contract, hit.time, contract.planted ? feel.lungeFinisher : feel.lungeLight, lungeAt, targets(), obstacles(), (feel.assistTurn * Math.PI) / 180, planetRadius);
    if (lunge.done !== before) motion = { ...motion, x: lungeAt.x, z: lungeAt.z, yaw: lungeAt.yaw };
  }

  function toStart(camera: PerspectiveCamera, controls: OrbitControls): void {
    motion = { x: start.x, z: start.z, yaw: start.yaw, speed: 0, drive: 0 };
    combo = COMBO_READY;
    clearLunge();
    trail?.clear();
    bladeDrawn = false;
    // The fades' step starts afresh with the hits: kept from before, a respawn after a stall carried that stall's step
    // into the first hit's fade (fadeStep).
    fadeStepNow = FIRST_FADE_STEP;
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
    contracts,
    get active() {
      return root !== null;
    },
    enter(camera, controls, obstaclesNow, seed, frozenNow, startNow, targetsNow) {
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
      obstacles = obstaclesNow;
      targets = targetsNow ?? (() => noObstacles);
      hand = bladeMeasure ? bladeHand(root, bladeMeasure) : null;
      trail = hand ? createSwordTrail(energy, brush) : null;

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
      obstacles = () => noObstacles;
      targets = () => noObstacles;
      trail?.dispose();
      trail = null;
      hand = null;
      bladeDrawn = false;
      clearLunge();
      if (saved) Object.assign(controls, saved);
      saved = null;
    },
    update(clocks, input, attackAsked, camera, controls) {
      if (!root || !mixer || !idle || !run) return null;
      const asked = attackAsked && hits !== null;
      // The press and the combo's step go into the combo first, so this frame's movement already follows the hit it
      // leaves playing. The combo keeps a press on a step of 0, for phase B's hit-stop, so the lab's freeze, which takes
      // no input, drops its presses here. The fades and a hit begun on this frame read the combo's last moving step, so
      // a hit begun in a hit-stop takes over from the weight drawn on the frame before it.
      if (asked && frozen) dropped += 1;
      fadeStepNow = fadeStep(fadeStepNow, clocks.combo);
      const frame = stepCombo(combo, asked && !frozen, clocks.combo, feel, fadeStepNow, contracts);
      combo = frame.state;
      lastClocks.combo = clocks.combo;
      lastClocks.motion = clocks.motion;
      lastClocks.frame = clocks.frame;
      if (frame.started !== null || !combo.hit) clearLunge();
      if (frame.press === 'dropped') dropped += 1;
      if (frame.struck !== null) {
        strikes += 1;
        strikesByStep[frame.struck - 1]! += 1;
        lastStrikeStep = frame.struck;
      }
      swing = swingMotion(combo, feel, contracts);
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
      motion = stepMotion(motion, moveDirection(input, forward.x, forward.z), input.sprint, clocks.motion, obstacles(), planetRadius, swing);
      carryLunge();
      pose();

      // The weights follow the combo on every frame but a frozen one, at the combo's last moving step (fadeStep), so a
      // held combo clock (phase B's hit-stop), whose hit stands still, draws the same weights as the frame before the
      // stop, and a hit begun in the stop starts its crossfade from them. They used to be read at the movement's step,
      // and only while it ran, so a stop that held his movement too, as it must, both froze them and read any hit begun
      // in it at a step of 0.
      if (!frozen) weights = comboWeights(combo, fadeStepNow, contracts);
      // The run keeps its weight while the finisher fades in over his stop (holdsRunWeight says why).
      runShare = blendRunWeight(runShare, motion.speed, holdsRunWeight(combo, contracts));
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
      // After the mixer, which would otherwise write any morph or jaw track a clip carries over the face. The blinks run
      // through the swings and hold with the clips, on the combo's clock; so do the idle's and the run's loops, which is
      // why a hit-stop must hold his movement with it (PlayClocks): the figure holds together only while both hold.
      face?.update(clocks.combo);
      // The blade where this frame draws it, and the trail along its arc through the active frames, on the combo's
      // clock, so the trail holds through a hit-stop as the swing does.
      if (hand && bladeMeasure) {
        sampleBlade(hand, bladeMeasure, bladeBase, bladeTip);
        // Sampling brought his root's world matrix up to date too: his shoulders, up the root's own up.
        rootUp.setFromMatrixColumn(root.matrixWorld, 1).normalize();
        bladePivot.setFromMatrixPosition(root.matrixWorld).addScaledVector(rootUp, BLADE_SWING_PIVOT_M);
        bladeDrawn = true;
        trail?.update(clocks.combo, bladeBase, bladeTip, comboPhase(combo, contracts) === 'active', feel.trailLength, feel.trailFade);
      }

      // The orbit's centre closes on his chest, and the camera moves with it, so a drag still orbits and the wheel
      // still zooms about him. On the frame's own clock, so the view keeps following through a hit-stop.
      chest(desired);
      follow.lerp(desired, 1 - Math.exp(-PLAY_FOLLOW_RATE * clocks.frame));
      shift.subVectors(follow, controls.target);
      controls.target.add(shift);
      camera.position.add(shift);
      return frame;
    },
    setFrozen(on) {
      frozen = on;
      face?.setFrozen(on);
    },
    at() {
      if (!root) return null;
      here.x = motion.x;
      here.z = motion.z;
      return here;
    },
    blade(base, tip, pivot) {
      if (!bladeDrawn) return false;
      base.copy(bladeBase);
      tip.copy(bladeTip);
      pivot?.copy(bladePivot);
      return true;
    },
    reading() {
      const at = root ? root.getWorldPosition(new Vector3()).toArray() : null;
      const hit = combo.hit;
      const contract = hit ? contractOf(hit.step, contracts) : null;
      return {
        on: root !== null,
        position: at,
        tangent: root ? [motion.x, motion.z] : null,
        yaw: motion.yaw,
        speed: motion.speed,
        runWeight: runShare,
        runTimeScale: timeScale,
        stride: stride ?? null,
        clearance: root ? clearance(motion.x, motion.z, obstacles()) : null,
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
        phase: comboPhase(combo, contracts),
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
        clocks: { ...lastClocks },
        lunge: {
          moved: lunge.moved,
          planned: lunge.plan ? lunge.plan.length : 0,
          target: lunge.plan ? lunge.plan.target : -1,
          turnDeg: lunge.plan ? (lunge.plan.turn * 180) / Math.PI : 0,
          blocked: lunge.blocked,
        },
        trail: trail ? trail.stroke.reading(feel.trailLength) : { points: 0, alpha: 0, emitting: false },
        blade: bladeDrawn ? { base: bladeBase.toArray(), tip: bladeTip.toArray() } : null,
      };
    },
  };
}
