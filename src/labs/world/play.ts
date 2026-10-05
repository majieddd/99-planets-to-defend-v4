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
  comboWeights,
  contractOf,
  fadeStep,
  FIRST_FADE_STEP,
  stepCombo,
  swingMotion,
  swingSetContracts,
  type ComboFrame,
  type ComboPhase,
  type ComboState,
  type ComboStep,
  type HitContract,
  type SwingSet,
} from './combo';
import { hipsBoneName, hitClips, splitClip, splitHips, upperBodyBones, type HitClip, type HitSource } from './comboClips';
import type { PlacedMember } from './layout';
import { freshLunge, resetLunge, rootMotionCurves, ScriptedLunge, stepLunge, type LungeCurve } from './lunge';
import {
  clearance,
  FREE_MOTION,
  groundForward,
  moveDirection,
  obstacleGap,
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
  type SwingMotion,
} from './playMotion';
import { THREE_QUARTER_TURN_DEG, toTangent, TOWARD_CAMERAS } from './registry';
import { createSwordTrail, trailEmitting, type SwordTrail, type TrailLook, type TrailReading } from './swordTrail';

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
/** The guard idle Pip raises in combat (Quaternius's Idle_Shield_Loop), in place of the relaxed idle. */
export const GUARD_IDLE = 'idle_guard';
/**
 * How near a target's footprint (widened by his reach, as he walks round it) his root must come for him to raise his
 * guard, in metres: within half a metre of where his walk stops at it. At the arena's start he stands 0.82 m from the
 * middle dummy's footprint and keeps the relaxed idle; one step toward it raises the guard.
 */
export const GUARD_NEAR_M = 0.5;
/** Seconds the guard idle takes to take over from the relaxed idle, or to hand back to it. */
export const GUARD_BLEND_SECONDS = 0.4;
/**
 * Seconds the legs take to follow a change in the share of a clip's root motion he is given (legShare): quick enough to
 * meet a lunge cut short at a body within a few frames, slow enough that the cut does not snap the legs to the stance.
 */
export const LEG_SHARE_SECONDS = 0.08;

/**
 * The share of a clip's leg motion his legs take, from the share of its root motion he is given: a clip with root motion
 * places its feet for the travel it records, so a lunge the assist shortens to `planned` of the curve's `reach`, or a
 * body stops, would slide the planted feet back under him by what was cut (the forehand from contact, 0.75 m of steps
 * on the spot). Weighing the clip's legs by the share he travels, and the stance by the rest, keeps the feet where they
 * stand: the clip's feet slide back by what is cut while the stance's feet are carried on by what is kept, and the two
 * cancel at that weight. Only the legs: the hips stay the clip's (Halves), since they turn his upper body and so aim his
 * blade. A clip with no root motion (the scripted lunge) keeps its legs whole.
 */
export function legShare(curve: LungeCurve | null, planned: number | null, blocked: boolean): number {
  if (!curve || curve.source !== 'root' || !(curve.reach > 0)) return blocked && curve?.source === 'root' ? 0 : 1;
  if (blocked) return 0;
  return planned === null ? 1 : Math.min(1, Math.max(0, planned / curve.reach));
}

const UP = new Vector3(0, 1, 0);
const ASSET = 'commander_pip';
/**
 * The source attack clip's strike moment, in seconds into it, from the shared contract (src/shared/timings.json) that
 * assets:check holds the exported clip to: the placeholder hits are warped so this moment lands on each hit's own strike.
 */
const SOURCE_STRIKE = timings.commanders.commander_pip.attack.strike;
const SET_NAMES: readonly SwingSet[] = ['quaternius', 'hand'];

/** What the test handle and the evidence read of the play mode. */
export interface PlayReading {
  on: boolean;
  position: number[] | null;
  tangent: number[] | null;
  yaw: number;
  speed: number;
  /** The run's weight against the idle by his speed. */
  runWeight: number;
  runTimeScale: number;
  /** The run clip's measured loop: the ground it covers, its length in seconds, and so the ground speed it plays at 1. */
  stride: { loopMetres: number; loopSeconds: number; clipSpeed: number } | null;
  /** How far he stands outside the nearest obstacle, in metres on the tangent plane (negative inside one). */
  clearance: number | null;
  /** The swing set the combo plays now, and the sets this build offers. */
  swingSet: SwingSet;
  swingSets: SwingSet[];
  /** Whether a hit of the combo is playing, and its clip time, in seconds (null out of a hit). */
  attacking: boolean;
  attackTime: number | null;
  /** The playing hit's own weight, from 0 to 1. */
  attackWeight: number;
  /** The playing hit's clip and contract: its name, its length, its strike moment and its cancel point (null out of a hit). */
  attackClip: string | null;
  attackSeconds: number | null;
  strikeAt: number | null;
  cancelAt: number | null;
  /** The playing hit's playback speed, and the clip time from which the next hit (or the finisher's new chain) may start. */
  attackSpeed: number | null;
  opensAt: number | null;
  /** Whether the playing hit is the finisher. */
  finisher: boolean;
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
  /** The clip fading out under the playing hit (its hit's step, 0 for none), its weight, and whether it is a recovery clip. */
  outgoingStep: number;
  outgoingWeight: number;
  outgoingRecovery: boolean;
  /** The recovery clip playing after a chain stopped (null for none): its clip, the hit it follows, its time and weight. */
  recovery: { clip: string; step: number; time: number; weight: number; moved: number } | null;
  /** The guard idle's share of the idle, from 0 (the relaxed idle) to 1. */
  guardWeight: number;
  /** The share of the current clip's leg motion his legs take (legShare), the stance the rest. */
  legShare: number;
  /** Where each hit's clip came from, attack_1 to attack_3 of the set playing (null without a combo), and the playing hit's. */
  sources: HitSource[] | null;
  source: HitSource | null;
  /** Each hit's clip length less its contract's, in seconds (null without a combo; hitClips). */
  clipLengthOff: number[] | null;
  /** Presses dropped since he came out: before a buffer opened, while one was kept, or on a frozen frame. */
  dropped: number;
  /** The clips' total weight on the upper body and on the lower body, and the run's weight on the legs. */
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
  lunge: { moved: number; planned: number; target: number; turnDeg: number; blocked: boolean; source: LungeCurve['source'] | null; total: number };
  /** Where each hit's lunge curve comes from, attack_1 to attack_3 of the set playing: its clip's root motion, or the scripted profile. */
  lungeSources: LungeCurve['source'][];
  /** What the root-motion records said when they were read: a step back noted, a faulty record dropped. */
  rootMotionNotes: string[];
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
 * dummies stand, so world x and z stand in for the ground's own two directions. Every member of the Asset World is read
 * this way and widened by his own PLAY_BODY_RADIUS; a training dummy is met at its footprint instead
 * (labs/combat/footprint.ts), and this reach only spaces the dummies from each other.
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
   * The contracts of the swing set he plays now (combatFeel's swingSet, from src/shared/timings.json), which the arena's
   * impact and the sounds read too, so a hit's active frames, strike and cancel come from one place. A change of set
   * takes effect when no hit or recovery clip plays.
   */
  readonly contracts: readonly HitContract[];
  readonly active: boolean;
  /**
   * Puts him out at `start` (the Asset World's, worldPlayStart, by default) among the reaches `obstacles` gives on each
   * update, his face blinking on `seed` and held while `frozen`. `targets` gives what the lunge's assist may turn him
   * toward and what raises his guard when near (the arena's dummies); the Asset World gives none, so there he lunges
   * straight ahead and raises his guard only after a hit.
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
   * His root on the tangent plane and his facing, or null when he is not out: one object, rewritten on each call, for a
   * caller that reads it often (a knocked-back dummy stops at his body on every push), where reading() builds the whole
   * reading.
   */
  at(): Readonly<{ x: number; z: number; yaw: number }> | null;
  /**
   * Writes the blade's base and tip in world space as last drawn into `base` and `tip`, and the point its sweep turns
   * about (his shoulders, BLADE_SWING_PIVOT_M up his up line) into `pivot`; false without a blade.
   */
  blade(base: Vector3, tip: Vector3, pivot?: Vector3): boolean;
  /** His rig as drawn, or null when he is not out: an evidence reading's (the arena's body gap), not the page's. */
  rig(): Object3D | null;
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
 * A clip's halves (comboClips.ts, splitClip), its lower half parted again into its hips and its legs (splitHips), or the
 * whole clip as the legs when the rig has no mask. The hips carry the upper body and take the lower half's weight; the
 * legs take it too, less what legShare gives the stance.
 */
interface Halves {
  upper: AnimationClip | null;
  hips: AnimationClip | null;
  lower: AnimationClip;
}

/** A clip's actions on the play mixer, one for each part of Halves. */
interface HalfActions {
  upper: AnimationAction | null;
  hips: AnimationAction | null;
  lower: AnimationAction;
}

/** One swing set as Play Pip plays it: its contracts, each hit's clip and halves, and each light hit's recovery clip's halves. */
interface SetClips {
  contracts: readonly HitContract[];
  hits: HitClip[];
  hitHalves: Halves[];
  recoveryHalves: (Halves | null)[];
}

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
  /**
   * Each swing set's contracts, swingSetContracts by default: a new set of clips with new numbers drops in here.
   */
  swingSets?: Partial<Record<SwingSet, readonly HitContract[]>>;
  /**
   * The notes of his model's sidecar (its .meta.json's `notes`), whose `root_motion` gives a clip's lunge curve from its
   * root motion (lunge.ts, rootMotionCurves); null or absent, each clip takes it from its glTF extras, or a hit the
   * scripted profile.
   */
  sidecarNotes?: unknown;
}

/**
 * The play prototype's Pip: an instance of his rig of its own, not one of the placed members, which the keys or the
 * thumb pad walk about the patch while the camera follows, and F, a click or the attack button swing his sword through
 * the three-hit combo (combo.ts: the chain, the buffered press, the crossfades, and how each hit slows and turns him).
 * The hits, the light hits' recovery clips and the finisher all play on his upper body over the run or the idle, and on
 * his legs in the idle's place, so he keeps walking through every swing; his clips are split at the spine for it
 * (comboClips.ts). In combat he raises his guard (GUARD_IDLE) in place of the relaxed idle. A hit's root motion carries
 * him as his lunge, combined with his drive and swept against the bodies (lunge.ts). His sword trail goes in `energy`,
 * the page's energy scene (labs/shared/paintedStage.ts), which the pipeline draws over the inked frame. `feel` is the
 * page's one combat feel object, which the panel's sliders write and every frame reads, so a change takes effect on the
 * next frame. Call it before buildAssetWorld: it keeps a copy of his rig in the bind pose, before the world's mixers
 * pose the loaded one, because the face driver reads the jaw's axis from it.
 */
export function createPipPlay(options: PipPlayOptions): PipPlay {
  const { assets, ground, parent, energy, hullMaterial, planetRadius, feel } = options;
  const brush: IUniform<Texture | null> = options.brush ?? { value: flatTexture(128) };
  const asset = assets.get(ASSET);
  const clipNamed = (name: string): AnimationClip | null => asset?.animations.find((clip) => clip.name === name) ?? null;
  const template = asset ? cloneRig(asset.root) : null;
  const idleClip = clipNamed('idle');
  const runClip = clipNamed('run');
  const guardClip = clipNamed(GUARD_IDLE);
  const upperNames = template ? upperBodyBones(template) : null;
  if (template && !upperNames) console.warn('Play Pip: the rig has no spine bone to split the attacks at, so every hit plays on his whole body');
  const hipsName = template ? hipsBoneName(template) : null;
  const halvesOf = (clip: AnimationClip): Halves => {
    if (!upperNames) return { upper: null, hips: null, lower: clip };
    const { upper, lower } = splitClip(clip, upperNames);
    if (!hipsName) return { upper, hips: null, lower };
    const parted = splitHips(lower, hipsName);
    return { upper, hips: parted.hips, lower: parted.legs };
  };

  // Each swing set's clips. A recovery clip timings.json names but the GLB lacks is dropped from its hit's contract,
  // named in the console, so the chain stops there as a hit without one does rather than weighing a clip that is not
  // there over the idle, which would let his bones fall toward the bind pose.
  const sets: Partial<Record<SwingSet, SetClips>> = {};
  for (const name of SET_NAMES) {
    if (!asset) break;
    const given = options.swingSets?.[name] ?? swingSetContracts(name);
    const contracts = given.map((contract) => {
      if (contract.recovery === null || clipNamed(contract.recovery)) return contract;
      console.warn(`Play Pip: ${contract.name}'s recovery clip ${contract.recovery} is not in the GLB, so a chain that stops after it fades to the idle`);
      return { ...contract, recovery: null, recoveryDuration: null };
    });
    // The hand-keyed set plays only from its own clips: warped placeholders of the attack would pass for it unseen.
    if (name === 'hand' && contracts.some((contract) => !clipNamed(contract.name))) continue;
    const hits = hitClips(asset.animations, SOURCE_STRIKE, contracts);
    if (!hits) continue;
    sets[name] = {
      contracts,
      hits,
      hitHalves: hits.map((hit) => halvesOf(hit.clip)),
      recoveryHalves: contracts.map((contract) => {
        const clip = contract.recovery ? clipNamed(contract.recovery) : null;
        return clip ? halvesOf(clip) : null;
      }),
    };
  }
  const offered = SET_NAMES.filter((name) => sets[name]);
  // Each clip's lunge curve from its root motion, where the build records one; a hit without one takes the scripted
  // profile when it begins. A faulty record is named and skipped; a step back is noted (rootMotionNotes).
  const rootMotionNotes: string[] = [];
  const curveNames = offered.flatMap((name) => sets[name]!.contracts.flatMap((contract) => [contract.name, ...(contract.recovery ? [contract.recovery] : [])]));
  const extras: Record<string, unknown> = {};
  const durations: Record<string, number> = {};
  for (const name of curveNames) {
    const clip = clipNamed(name);
    if (!clip) continue;
    durations[name] = clip.duration;
    const motion = (clip.userData as { root_motion?: unknown } | undefined)?.root_motion;
    if (motion !== undefined) extras[name] = motion;
  }
  const rootCurves = rootMotionCurves(
    curveNames,
    options.sidecarNotes ?? null,
    extras,
    (said, kind) => {
      rootMotionNotes.push(said);
      // A step back is a record as the clip was authored (the Quaternius backhand's 6 cm), so it is noted, not warned.
      if (kind === 'fault') console.warn(`Play Pip: ${said}`);
      else console.info(`Play Pip: ${said}`);
    },
    durations,
  );
  const idleHalves = idleClip ? halvesOf(idleClip) : null;
  const runHalves = runClip ? halvesOf(runClip) : null;
  const guardHalves = guardClip ? halvesOf(guardClip) : null;
  // The blade, read once from the bind-pose copy (blade.ts): its base and tip in the hand's frame, which every copy of
  // the rig shares.
  const bladeMeasure = template ? measureBlade(template) : null;
  if (template && !bladeMeasure) console.warn('Play Pip: the rig has no blade on its right hand, so no sword trail is drawn');
  let stride: PlayReading['stride'] | undefined;

  // The set the combo plays, from the feel, while the build offers it.
  const wanted = (): SwingSet | null => (sets[feel.swingSet] ? feel.swingSet : (offered[0] ?? null));
  let setName: SwingSet = wanted() ?? 'quaternius';
  let set: SetClips | null = sets[setName] ?? null;
  let contracts: readonly HitContract[] = set ? set.contracts : swingSetContracts(setName);

  let root: Object3D | null = null;
  let feet: (Object3D | null)[] = [];
  let mixer: AnimationMixer | null = null;
  let idle: HalfActions | null = null;
  let guard: HalfActions | null = null;
  let run: HalfActions | null = null;
  // Each set's hit actions and recovery actions, by the hit's step; the set not playing stands at no weight.
  let hitActions: Partial<Record<SwingSet, HalfActions[]>> = {};
  let recoveryActions: Partial<Record<SwingSet, (HalfActions | null)[]>> = {};
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
  // The playing hit's lunge (lunge.ts): its curve taken when the hit begins, planned when the curve first moves, carried
  // by the curve's metres the hit's time has reached and swept against the bodies a frame's share at a time. A recovery
  // clip playing alone carries its own root motion the same way, straight ahead.
  const lunge = freshLunge();
  const recoveryLunge = freshLunge();
  const lungeAt = { x: 0, z: 0, yaw: 0 };
  const driven = { metres: 0, yaw: 0 };
  // The crescent's look as the feel has it, written into one object each frame.
  const trailLook: TrailLook = { width: 0, brightness: 1 };
  let lungeCurve: LungeCurve | null = null;
  let recoveryCurve: LungeCurve | null = null;
  const lastClocks: PlayClocks = { combo: 0, motion: 0, frame: 0 };
  let motion: MotionState = { x: 0, z: 0, yaw: 0, speed: 0, drive: 0 };
  let combo: ComboState = COMBO_READY;
  // The step the clips' fades read: the combo's last moving step, kept through a held clock (fadeStep, combo.ts).
  let fadeStepNow = FIRST_FADE_STEP;
  let strikes = 0;
  let strikesByStep = [0, 0, 0];
  let lastStrikeStep: ComboStep | null = null;
  let dropped = 0;
  let frozen = false;
  let runShare = 0;
  let weights = { current: 0, outgoing: 0, recovery: 0 };
  let body = bodyWeights(0, 0, 0);
  let swing: SwingMotion = FREE_MOTION;
  let timeScale = 0;
  // The guard: its share of the idle, and the seconds since combat last called for it (a hit, a recovery clip or a target
  // near), which feel.guardHold measures out before it hands back to the relaxed idle.
  let guardWeight = 0;
  let sinceCombat = Infinity;
  // The share of the current clip's leg motion his legs take (legShare), eased over LEG_SHARE_SECONDS.
  let legs = 1;
  const follow = new Vector3();
  const here = { x: 0, z: 0, yaw: 0 };
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
    return { upper: halves.upper ? make(halves.upper) : null, hips: halves.hips ? make(halves.hips) : null, lower: make(halves.lower) };
  }

  /**
   * A clip whose time the combo sets every frame rather than the mixer advancing it, so the pose, the reading and the
   * strike moment all come from the one clock in combo.ts. With its time scale at 0 the mixer never moves its time, so
   * its loop mode and clampWhenFinished, which act only on a time the mixer moves, would do nothing, and they are left
   * off.
   */
  function heldActionsOf(on: AnimationMixer, halves: Halves): HalfActions {
    const actions = actionsOf(on, halves, false);
    for (const action of [actions.upper, actions.hips, actions.lower]) if (action) action.timeScale = 0;
    return actions;
  }

  /** Weighs a clip's parts: its upper half, its hips by the lower half's weight, and its legs by `legs` (the same unless given). */
  function weigh(actions: HalfActions, upper: number, lower: number, legs = lower): void {
    actions.upper?.setEffectiveWeight(upper);
    actions.hips?.setEffectiveWeight(lower);
    actions.lower.setEffectiveWeight(actions.hips ? legs : lower);
  }

  function setTime(actions: HalfActions, time: number): void {
    for (const action of [actions.upper, actions.hips, actions.lower]) if (action) action.time = time;
  }

  /** Forgets the lunges: a new hit, or a new recovery clip, plans its own. */
  function clearLunge(): void {
    resetLunge(lunge);
    lungeCurve = null;
  }
  function clearRecoveryLunge(): void {
    resetLunge(recoveryLunge);
    recoveryCurve = null;
  }

  /**
   * The lunge curve a hit begins with: its clip's root motion where the build recorded one, or the scripted profile at
   * the feel's metres for a light hit or the finisher, fixed for the hit so a slider moved mid-hit lunges the next.
   */
  function curveFor(contract: HitContract): LungeCurve {
    return rootCurves[contract.name] ?? new ScriptedLunge(contract, contract.finisher ? feel.lungeFinisher : feel.lungeLight);
  }

  /**
   * Carries the playing hit's lunge (stepLunge, lunge.ts) on top of what his drive moved him this frame, combined so he
   * travels the larger of the two along its way, and a recovery clip's root motion while one plays alone. A step of 0, a
   * hit-stop, holds the clips' times and so the lunges.
   */
  function carryLunges(): void {
    driven.metres = motion.speed * lastClocks.motion;
    driven.yaw = motion.yaw;
    const hit = combo.hit;
    if (hit) {
      const contract = contractOf(hit.step, contracts);
      lungeCurve ??= curveFor(contract);
      carry(lunge, lungeCurve, hit.time, targets(), (feel.assistTurn * Math.PI) / 180, contract.activeFrom);
    }
    const recovery = combo.recovery;
    const clip = recovery ? contractOf(recovery.step, contracts).recovery : null;
    // A recovery clip that ended or that a hit took over from is forgotten, so the next one plans afresh.
    if (!recovery || !clip || !rootCurves[clip]) {
      if (recoveryCurve) clearRecoveryLunge();
      return;
    }
    recoveryCurve ??= rootCurves[clip]!;
    carry(recoveryLunge, recoveryCurve, recovery.time, noObstacles, 0);
  }

  function carry(state: typeof lunge, curve: LungeCurve, time: number, aimAt: readonly Obstacle[], assistTurn: number, turnBy = Infinity): void {
    lungeAt.x = motion.x;
    lungeAt.z = motion.z;
    lungeAt.yaw = motion.yaw;
    const before = state.done;
    const beforeSide = state.sideDone;
    stepLunge(state, curve, time, lungeAt, aimAt, obstacles(), assistTurn, planetRadius, driven, turnBy);
    if (state.done !== before || state.sideDone !== beforeSide) motion = { ...motion, x: lungeAt.x, z: lungeAt.z, yaw: lungeAt.yaw };
  }

  /**
   * The guard idle's share of the idle on a frame of `dt` seconds: up while a hit or a recovery clip plays or a target's
   * footprint stands within GUARD_NEAR_M, held for the feel's guardHold after the last of those, then handed back to the
   * relaxed idle, each way over GUARD_BLEND_SECONDS.
   */
  function stepGuard(dt: number): void {
    if (!guard) {
      guardWeight = 0;
      return;
    }
    const near = targets().some((target) => obstacleGap(target, motion.x, motion.z) <= GUARD_NEAR_M);
    if (combo.hit || combo.recovery || near) sinceCombat = 0;
    else if (dt > 0) sinceCombat += dt;
    const up = sinceCombat <= feel.guardHold ? 1 : 0;
    const step = dt > 0 ? dt / GUARD_BLEND_SECONDS : 0;
    guardWeight = up > guardWeight ? Math.min(up, guardWeight + step) : Math.max(up, guardWeight - step);
  }

  /** Switches to the swing set the feel asks for, once no hit and no recovery clip of the set playing is showing. */
  function followSwingSet(): void {
    const next = wanted();
    if (!next || next === setName || combo.hit || combo.recovery) return;
    setName = next;
    set = sets[next] ?? null;
    contracts = set ? set.contracts : swingSetContracts(next);
    combo = COMBO_READY;
    clearLunge();
    clearRecoveryLunge();
  }

  /**
   * Stands him at the start, still and out of any hit, and frames him there: the orbit's centre on his chest and the
   * camera on the start's bearing from him, at its distance and pitch. The next update weighs his clips from this.
   */
  function toStart(camera: PerspectiveCamera, controls: OrbitControls): void {
    motion = { x: start.x, z: start.z, yaw: start.yaw, speed: 0, drive: 0 };
    combo = COMBO_READY;
    clearLunge();
    clearRecoveryLunge();
    trail?.clear();
    bladeDrawn = false;
    // The fades' step starts afresh with the hits: kept from before, a respawn after a stall carried that stall's step
    // into the first hit's fade (fadeStep).
    fadeStepNow = FIRST_FADE_STEP;
    runShare = 0;
    weights = { current: 0, outgoing: 0, recovery: 0 };
    body = bodyWeights(0, 0, 0);
    swing = FREE_MOTION;
    timeScale = 0;
    guardWeight = 0;
    sinceCombat = Infinity;
    legs = 1;
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
    get contracts() {
      return contracts;
    },
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
      guard = guardHalves ? actionsOf(on, guardHalves, true) : null;
      run = actionsOf(on, runHalves, true);
      for (const action of [run.upper, run.hips, run.lower]) if (action) action.timeScale = 0;
      hitActions = {};
      recoveryActions = {};
      for (const name of offered) {
        const clips = sets[name]!;
        hitActions[name] = clips.hitHalves.map((halves) => heldActionsOf(on, halves));
        recoveryActions[name] = clips.recoveryHalves.map((halves) => (halves ? heldActionsOf(on, halves) : null));
      }
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
      mixer = idle = guard = run = null;
      hitActions = {};
      recoveryActions = {};
      face = null;
      combo = COMBO_READY;
      obstacles = () => noObstacles;
      targets = () => noObstacles;
      trail?.dispose();
      trail = null;
      hand = null;
      bladeDrawn = false;
      clearLunge();
      clearRecoveryLunge();
      if (saved) Object.assign(controls, saved);
      saved = null;
    },
    update(clocks, input, attackAsked, camera, controls) {
      if (!root || !mixer || !idle || !run) return null;
      followSwingSet();
      const asked = attackAsked && set !== null;
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
      carryLunges();
      pose();
      stepGuard(clocks.combo);

      // The weights follow the combo on every frame but a frozen one, at the combo's last moving step (fadeStep), so a
      // held combo clock (phase B's hit-stop), whose clips stand still, draws the same weights as the frame before the
      // stop, and a hit begun in the stop starts its crossfade from them.
      if (!frozen) weights = comboWeights(combo, fadeStepNow, contracts);
      runShare = runWeight(motion.speed);
      timeScale = stride ? runTimeScale(motion.speed, stride.clipSpeed) : 1;
      const current = combo.hit;
      const outgoing = current ? combo.outgoing : null;
      const recovery = current ? null : combo.recovery;
      // A hit, or a recovery clip playing alone, is the current layer; every clip is layered the same way (bodyWeights).
      const currentWeight = current ? weights.current : recovery ? weights.recovery : 0;
      body = bodyWeights(runShare, currentWeight, outgoing ? weights.outgoing : 0);
      // The legs take the share of the clip's root motion he is given, the stance the rest (legShare says why).
      const wantLegs = current
        ? legShare(lungeCurve, lunge.plan ? lunge.plan.length : null, lunge.blocked)
        : recovery
          ? legShare(recoveryCurve, null, recoveryLunge.blocked)
          : 1;
      legs = clocks.combo > 0 ? wantLegs + (legs - wantLegs) * Math.exp(-clocks.combo / LEG_SHARE_SECONDS) : legs;
      if (!current && !recovery) legs = 1;
      // The legs' own weights: the clip's legs take legShare of its lower weight and the stance's legs the rest; the hips
      // keep the lower weights whole, so the clip still turns his upper body as it was built to.
      const kept = body.lower.current * (1 - legs);
      const legsCurrent = body.lower.current - kept;
      const legsIdle = body.lower.idle + kept;
      // On a rig the mask could not split, every clip plays on his whole body: the lower half is the whole clip.
      const g = guard ? guardWeight : 0;
      weigh(idle, body.upper.idle * (1 - g), body.lower.idle * (1 - g), legsIdle * (1 - g));
      if (guard) weigh(guard, body.upper.idle * g, body.lower.idle * g, legsIdle * g);
      weigh(run, body.upper.run, body.lower.run);
      for (const action of [run.upper, run.hips, run.lower]) if (action) action.timeScale = timeScale;
      for (const name of offered) {
        const playing = name === setName;
        hitActions[name]!.forEach((actions, index) => {
          const step = (index + 1) as ComboStep;
          const isCurrent = playing && current !== null && current.step === step;
          const isOutgoing = playing && outgoing !== null && !outgoing.recovery && outgoing.step === step;
          setTime(actions, isCurrent ? current.time : isOutgoing ? outgoing.time : 0);
          weigh(
            actions,
            (isCurrent ? body.upper.current : 0) + (isOutgoing ? body.upper.outgoing : 0),
            (isCurrent ? body.lower.current : 0) + (isOutgoing ? body.lower.outgoing : 0),
            (isCurrent ? legsCurrent : 0) + (isOutgoing ? body.lower.outgoing : 0),
          );
        });
        recoveryActions[name]!.forEach((actions, index) => {
          if (!actions) return;
          const step = (index + 1) as ComboStep;
          const isCurrent = playing && recovery !== null && recovery.step === step;
          const isOutgoing = playing && outgoing !== null && outgoing.recovery && outgoing.step === step;
          setTime(actions, isCurrent ? recovery.time : isOutgoing ? outgoing.time : 0);
          weigh(
            actions,
            (isCurrent ? body.upper.current : 0) + (isOutgoing ? body.upper.outgoing : 0),
            (isCurrent ? body.lower.current : 0) + (isOutgoing ? body.lower.outgoing : 0),
            (isCurrent ? legsCurrent : 0) + (isOutgoing ? body.lower.outgoing : 0),
          );
        });
      }
      mixer.update(clocks.combo);
      // After the mixer, which would otherwise write any morph or jaw track a clip carries over the face. The blinks run
      // through the swings and hold with the clips, on the combo's clock; so do the idle's and the run's loops, which is
      // why a hit-stop must hold his movement with it (PlayClocks): the figure holds together only while both hold.
      face?.update(clocks.combo);
      // The blade where this frame draws it, and the trail's crescent along its arc from the hit's late wind-up through
      // its early recovery (trailEmitting), on the combo's clock, so the trail holds through a hit-stop as the swing does.
      // It took samples through the active frames alone, and began where the cut was half done.
      if (hand && bladeMeasure) {
        sampleBlade(hand, bladeMeasure, bladeBase, bladeTip);
        // Sampling brought his root's world matrix up to date too: his shoulders, up the root's own up.
        rootUp.setFromMatrixColumn(root.matrixWorld, 1).normalize();
        bladePivot.setFromMatrixPosition(root.matrixWorld).addScaledVector(rootUp, BLADE_SWING_PIVOT_M);
        bladeDrawn = true;
        const emitting = combo.hit !== null && trailEmitting(contractOf(combo.hit.step, contracts), combo.hit.time);
        trailLook.width = feel.trailWidth;
        trailLook.brightness = feel.trailBrightness;
        trail?.update(clocks.combo, bladeBase, bladeTip, emitting, feel.trailLength, feel.trailFade, trailLook);
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
      here.yaw = motion.yaw;
      return here;
    },
    rig() {
      return root;
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
      const recovery = hit ? null : combo.recovery;
      const hits = set?.hits ?? null;
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
        swingSet: setName,
        swingSets: [...offered],
        attacking: hit !== null,
        attackTime: hit ? hit.time : null,
        attackWeight: weights.current,
        attackClip: contract ? contract.name : null,
        attackSeconds: contract ? contract.duration : null,
        strikeAt: contract ? contract.strike : null,
        cancelAt: contract ? contract.cancel : null,
        attackSpeed: hit ? hit.speed : null,
        opensAt: hit ? hit.opensAt : null,
        finisher: contract ? contract.finisher : false,
        bufferOpensAt: hit ? bufferOpensAt(hit.opensAt, feel.buffer) : null,
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
        outgoingRecovery: hit !== null && combo.outgoing !== null && combo.outgoing.recovery,
        recovery: recovery
          ? { clip: contractOf(recovery.step, contracts).recovery ?? '', step: recovery.step, time: recovery.time, weight: weights.recovery, moved: recoveryLunge.moved }
          : null,
        guardWeight,
        legShare: legs,
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
          source: lungeCurve ? lungeCurve.source : null,
          total: lungeCurve ? lungeCurve.total : 0,
        },
        lungeSources: contracts.map((entry) => (rootCurves[entry.name] ? 'root' : 'scripted')),
        rootMotionNotes: [...rootMotionNotes],
        trail: trail ? trail.stroke.reading(feel.trailLength) : { points: 0, alpha: 0, emitting: false },
        blade: bladeDrawn ? { base: bladeBase.toArray(), tip: bladeTip.toArray() } : null,
      };
    },
  };
}
