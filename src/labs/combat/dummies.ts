import { AnimationMixer, Box3, LoopRepeat, Vector3, type AnimationAction, type Mesh, type Object3D } from 'three';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import type { LoadedAsset } from '../../render/assets/loadAsset';
import { syncHullMorphs } from '../../render/ink/hull';
import { place, type Ground } from '../../render/terrain/place';
import type { ComboStep } from '../world/combo';
import { groundReach } from '../world/play';
import { PLAY_BODY_RADIUS, sweepMove, type Obstacle } from '../world/playMotion';
import { LEAN } from '../world/registry';
import type { GroundPose } from './arena';

/** The clip a training dummy loops while it waits to be hit. */
export const DUMMY_IDLE = 'idle';

/**
 * A hit landing on a dummy, as phase B's hit detection will report it: the combo's hit that landed and how far into its
 * clip, Pip's place when it landed, and the dummy it landed on. Phase A has no hit detection, so nothing reports one
 * yet; the shape is here so phase B's hit-stop, sparks and flinch can hang off the hook below.
 */
export interface DummyHit {
  step: ComboStep;
  /** Seconds into the hit's clip. */
  time: number;
  /** Pip's root on the tangent plane when it landed. */
  from: { x: number; z: number };
}

/**
 * One training dummy: an instance of the Husk on its idle, standing on the ground by the shared place() and walked round
 * by Pip as an obstacle. Phase B adds the hit reactions; this is the interface it builds on.
 */
export interface TrainingDummy {
  readonly index: number;
  readonly name: string;
  readonly root: Object3D;
  /**
   * Its own mixer, which loops its idle: phase B's flinch plays a reaction on it over the idle, and the page advances it
   * with the others (TrainingDummies.update).
   */
  readonly mixer: AnimationMixer;
  /** Where it stands after a reset. */
  readonly home: Readonly<GroundPose>;
  /** Its body's reach across the ground from its root, from its drawn bounds at home (play.ts, groundReach). */
  readonly reach: number;
  /** Where it stands now. */
  pose(): GroundPose;
  /**
   * Stands it at a pose on the ground as given, with no check against the others or Pip (the reset test's debug hook
   * uses it); knockback goes through TrainingDummies.push, which does check. Pip reads the change on his next frame.
   */
  moveTo(pose: GroundPose): void;
  /** The hit hook: phase B's hit detection calls it when a strike lands, and its listeners (onHit) react. */
  hit(hit: DummyHit): void;
  /** The hits it has taken since its last reset, and the last of them. */
  readonly hits: number;
  readonly lastHit: DummyHit | null;
  /** Home, on its idle from its home moment, with no hits. */
  reset(): void;
}

export interface TrainingDummies {
  readonly list: readonly TrainingDummy[];
  /**
   * Adds a listener every dummy's hit hook calls, after it has counted the hit: phase B's reactions. Returns the call
   * that removes it, so a reaction set up for one test or one setting can be taken down again.
   */
  onHit(listener: (dummy: TrainingDummy, hit: DummyHit) => void): () => void;
  /** Adds a listener called after every reset, once all the dummies are home; returns the call that removes it. */
  onReset(listener: () => void): () => void;
  /**
   * Knocks a dummy `dx` and `dz` metres across the tangent plane, swept in steps of at most KNOCKBACK_SWEEP_STEP
   * (sweepMove, playMotion.ts): each step is met against another dummy's body and Pip's (each dummy's reach and the
   * other's, or its reach widened by PLAY_BODY_RADIUS, as he walks round it) and then held inside his play area, and the
   * push stops at the first step either holds back, as the blueprint's knockback stops at illegal edges. Returns where it
   * ends. The bodies used to be met only where the whole push ended, so a dummy touching Pip and driven straight at him
   * came out on his far side once the push passed its reach and his body, about 1.55 m (the old note said 3.1 m, his
   * body's width plus the dummy's, but it only had to pass half of that), and the area's clamp, which ran after the
   * bodies, could put a dummy pushed out of Pip at the edge back into him.
   */
  push(index: number, dx: number, dz: number): GroundPose;
  /**
   * Each dummy as an obstacle where it stands now: its reach widened by Pip's body, as the Asset World's members are. The
   * same list every call, kept up to date as the dummies move, so Pip can read it every frame without a list being built.
   */
  obstacles(): readonly Obstacle[];
  /** Advances the idles by the frame's step; a step of 0, the lab frozen, holds them. */
  update(dt: number): void;
  /** Puts every dummy back home, then tells the reset listeners. */
  reset(): void;
}

/** A dummy's drawn bounds in the pose it stands in, ink hulls left out, skinned meshes posed (layout.ts measures alike). */
function drawnBounds(root: Object3D, hullMaterial: unknown): Box3 {
  const bounds = new Box3();
  const vertex = new Vector3();
  root.updateMatrixWorld(true);
  root.traverseVisible((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || mesh.material === hullMaterial) return;
    const position = mesh.geometry.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count; i++) bounds.expandByPoint(mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld));
  });
  return bounds;
}

/**
 * The combat arena's training dummies: one Husk instance per home pose, each a copy of the loaded rig with a skeleton
 * and a mixer of its own, looping its idle. Each idle starts its own share of the loop in (a third apart for three), so
 * the row does not breathe in step, and a reset takes each back to that moment. Each stands plumb on the ground through
 * place(), as the Asset World's characters do (Kit's ground contract, which roots the Husk at its feet), and its reach
 * is read from its drawn bounds at home, with the formula the Asset World's members use. `pip` gives Pip's root on the
 * tangent plane (null while he is not out), which a knocked-back dummy stops at. Null when the Husk has no idle to loop.
 */
export function createTrainingDummies(
  asset: LoadedAsset,
  ground: Ground,
  parent: Object3D,
  hullMaterial: unknown,
  homes: readonly GroundPose[],
  names: readonly string[],
  pip: () => Readonly<{ x: number; z: number }> | null = () => null,
): TrainingDummies | null {
  const idle = asset.animations.find((clip) => clip.name === DUMMY_IDLE);
  if (!idle) return null;
  const listeners = new Set<(dummy: TrainingDummy, hit: DummyHit) => void>();
  const resetListeners = new Set<() => void>();
  const mixers: AnimationMixer[] = [];
  // Pip's obstacles, one per dummy, kept in step with where each stands (sync), so he reads one list every frame.
  const obstacleList: Obstacle[] = [];
  // What a push is met against (push), one slot per dummy, rewritten in place on every push.
  const bodies: Obstacle[] = homes.map(() => ({ x: 0, z: 0, radius: 0 }));

  const list = homes.map((home, index): TrainingDummy => {
    const root = cloneRig(asset.root);
    root.name = names[index] ?? `dummy_${index + 1}`;
    // A SkeletonUtils copy's hulls hold sliced copies of the body's morph influences until their first draw (layout.ts).
    root.traverse((child) => {
      if ((child as Mesh).isMesh && (child as Mesh).material === hullMaterial) syncHullMorphs(child);
    });
    const mixer = new AnimationMixer(root);
    const action: AnimationAction = mixer.clipAction(idle).setLoop(LoopRepeat, Infinity).play();
    const homeTime = (index / homes.length) * idle.duration;
    let pose: GroundPose = { ...home };
    let hits = 0;
    let lastHit: DummyHit | null = null;
    const stand = (): void => place(root, ground, pose.x, pose.z, pose.yaw, LEAN.plumb);
    const toHomeMoment = (): void => {
      action.time = homeTime;
      mixer.update(0);
    };
    stand();
    toHomeMoment();
    parent.add(root);
    mixers.push(mixer);
    const reach = groundReach(root.getWorldPosition(new Vector3()), drawnBounds(root, hullMaterial));
    const obstacle: Obstacle = { x: home.x, z: home.z, radius: reach + PLAY_BODY_RADIUS };
    obstacleList.push(obstacle);
    const dummy: TrainingDummy = {
      index,
      name: root.name,
      root,
      mixer,
      home: Object.freeze({ ...home }),
      reach,
      pose: () => ({ ...pose }),
      moveTo(next) {
        pose = { ...next };
        obstacle.x = pose.x;
        obstacle.z = pose.z;
        stand();
      },
      hit(event) {
        hits += 1;
        lastHit = event;
        for (const listener of listeners) listener(dummy, event);
      },
      get hits() {
        return hits;
      },
      get lastHit() {
        return lastHit;
      },
      reset() {
        dummy.moveTo(home);
        hits = 0;
        lastHit = null;
        toHomeMoment();
      },
    };
    return dummy;
  });

  return {
    list,
    onHit(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onReset(listener) {
      resetListeners.add(listener);
      return () => resetListeners.delete(listener);
    },
    push(index, dx, dz) {
      const dummy = list[index]!;
      const from = obstacleList[index]!;
      // The other dummies by both bodies' reaches, and Pip, in the dummy's own slot, by its reach widened by his body,
      // as he walks round it; with Pip not out his slot has no reach and stops nothing. The list is reused, so a
      // knockback that pushes on every frame builds nothing.
      list.forEach((other, i) => {
        const body = bodies[i]!;
        if (other !== dummy) {
          body.x = obstacleList[i]!.x;
          body.z = obstacleList[i]!.z;
          body.radius = dummy.reach + other.reach;
          return;
        }
        const at = pip();
        body.x = at ? at.x : 0;
        body.z = at ? at.z : 0;
        body.radius = at ? dummy.reach + PLAY_BODY_RADIUS : 0;
      });
      const kept = sweepMove(from.x, from.z, dx, dz, bodies);
      dummy.moveTo({ x: kept.x, z: kept.z, yaw: dummy.pose().yaw });
      return dummy.pose();
    },
    obstacles: () => obstacleList,
    update(dt) {
      for (const mixer of mixers) mixer.update(dt);
    },
    reset() {
      for (const dummy of list) dummy.reset();
      for (const listener of resetListeners) listener();
    },
  };
}
