import { Vector3, type IUniform, type Object3D, type PerspectiveCamera, type Texture } from 'three';
import type { Ground } from '../../render/terrain/place';
import type { CombatFeel } from '../world/combatFeel';
import { contractOf, type ComboFrame, type ComboStep } from '../world/combo';
import type { PipPlay, PlayClocks } from '../world/play';
import { DUMMY_HIT_LOW, DUMMY_HIT_SHARE, DUMMY_HIT_TOP, type DummyHit, type TrainingDummies, type TrainingDummy } from './dummies';
import { createHitNumbers, type HitNumbers } from './hitNumbers';
import { SwingHits, sweepHit, sweepSteps, type HitBody } from './hitShape';
import { HitStop, releaseHeld } from './hitStop';
import { BoneLean, FLINCH_BONE, FLINCH_FINISHER_DEG, FLINCH_LIGHT_DEG, idleReaction, reactionLean, startReaction, stepReaction, type Reaction } from './reactions';
import { createCameraShake } from './shake';
import { createSparks } from './sparks';

/**
 * The combat arena's impact (Pillar 4, "every blow reads"): each frame it tests the blade's sweep through the playing
 * hit's active frames against every training dummy, and on a hit that connects it stops time on contact (the hit-stop:
 * Pip's combo and movement clocks and the struck dummy's held while the frame's clock runs on, PlayClocks), throws a
 * burst of sparks at the wound with a number rising from it, kicks the camera, and starts the dummy's flinch and
 * knockback through its hit hook. A swing that meets nothing (a whiff) gets none of it. Everything here runs on the
 * clocks the page hands it, so the lab's freeze holds it all. Its buffers are made once; a frame builds only the small
 * pose objects it reads from a dummy that is reeling or being pushed (TrainingDummy.pose returns a copy), and a contact
 * builds the event its listeners are handed.
 */

/** One swing as the reading reports it: its hit of the combo, whether it connected, and with which dummies. */
export interface SwingRecord {
  step: ComboStep;
  connected: boolean;
  dummies: number[];
  /** The hit's clip time at the first contact, or null. */
  at: number | null;
}

export interface ImpactReading {
  /** The last few swings, oldest first, and every hit that connected since the load. */
  swings: SwingRecord[];
  connects: number;
  lastConnect: { step: ComboStep; dummy: number; at: number; contact: number[] } | null;
  /**
   * The hit-stop: whether one holds now, the seconds it has left, and the length of each finished stop as measured on
   * the clocks the frames ran on (the frame's time the combo's clock did not get), oldest first.
   */
  hitStop: { active: boolean; remaining: number; lengths: number[]; held: boolean[] };
  /** The sparks alive now, the count and place of the last burst, and the bursts since the load. */
  sparks: { alive: number; lastCount: number; lastPosition: number[] | null; bursts: number };
  shake: { offset: number; active: boolean; enabled: boolean };
  numbers: { live: number; last: number | null };
  /** Each dummy's flinch now (0 to 1 of its peak) and the metres its last knockback has carried it. */
  dummies: { flinch: number; knockback: number; blocked: boolean }[];
}

/** A hit that connected, as the impact's listeners hear of it (onConnect): its hit, the dummy, the contact, the weight. */
export interface ConnectEvent {
  step: ComboStep;
  /** The dummy's index in the set. */
  dummy: number;
  /** Where the blade met it, in world space. */
  contact: readonly number[];
  finisher: boolean;
}

/** A swing whose active frames are over, as the impact's listeners hear of it (onSwingEnd), and whether it connected. */
export interface SwingEndEvent {
  step: ComboStep;
  connected: boolean;
}

export interface CombatImpact {
  /**
   * This frame's clocks for a frame step of `dt` (written into one object, reused): the frame's own, and the combo's and
   * movement's less whatever of the frame a hit-stop holds. A stop that ends part way through a frame lets the rest of
   * that frame run, so its length comes out as set at any frame rate.
   */
  clocks(dt: number): PlayClocks;
  /** Which dummies the hit-stop holds this frame (by index) and the step they take, for TrainingDummies.update. */
  readonly held: readonly boolean[];
  heldStep(): number;
  /** After Pip's update: tests the blade, reacts to hits, and steps the sparks, the shake, the numbers and the flinch. */
  afterPlay(frame: ComboFrame | null, dt: number): void;
  /**
   * Before the draw: places the hit numbers by the camera as this frame draws it (its matrices brought up to date
   * first), then lays the camera's shake on; afterRender takes it off.
   */
  beforeRender(camera: PerspectiveCamera): void;
  afterRender(camera: PerspectiveCamera): void;
  /** Places the hit numbers for the canvas's size. */
  layout(widthPx: number, heightPx: number): void;
  /**
   * Adds a listener told of every hit that connects, on its contact frame (in connect(), as the stop, the sparks and the
   * number start): the combat sounds' impact. Returns the call that removes it.
   */
  onConnect(listener: (event: ConnectEvent) => void): () => void;
  /**
   * Adds a listener told of each swing once its active frames are over, or once it is cut off before that (the next hit
   * begins, or the hit ends), with whether it connected: the combat sounds' whiff. Returns the call that removes it.
   */
  onSwingEnd(listener: (event: SwingEndEvent) => void): () => void;
  reset(): void;
  /** Turns the shake off and holds the numbers in place under prefers-reduced-motion, as the page's query changes. */
  setReducedMotion(on: boolean): void;
  reading(): ImpactReading;
}

/** How many swings the reading keeps. */
const SWINGS_KEPT = 12;
/** Up, where a lean of 0 needs no ground read. */
const UP = new Vector3(0, 1, 0);

export interface CombatImpactOptions {
  /** The page's energy scene (labs/shared/paintedStage.ts), which the sparks go in. */
  energy: Object3D;
  camera: PerspectiveCamera;
  ground: Ground;
  pip: PipPlay;
  dummies: TrainingDummies;
  feel: CombatFeel;
  reducedMotion: boolean;
  /** The painted materials' shared brush atlas uniform, which the sparks' flash breaks its rim with. */
  brush: IUniform<Texture | null>;
  /** The layer over the canvas the hit numbers go in, or null for none. */
  numbers: HTMLElement | null;
}

export function createCombatImpact(o: CombatImpactOptions): CombatImpact {
  const { pip, dummies, feel } = o;
  const list = dummies.list;
  const sparks = createSparks(o.energy, o.brush);
  const shake = createCameraShake(o.reducedMotion);
  const numbers: HitNumbers | null = o.numbers ? createHitNumbers(o.numbers, o.reducedMotion) : null;
  const swingHits = new SwingHits(list.length);
  const reactions: Reaction[] = list.map(() => idleReaction());
  const bodies: HitBody[] = list.map((dummy) => ({ radius: dummy.reach * DUMMY_HIT_SHARE, low: DUMMY_HIT_LOW, high: DUMMY_HIT_TOP }));
  const leans: (BoneLean | null)[] = list.map((dummy) => {
    const bone = dummy.root.getObjectByName(FLINCH_BONE);
    return bone ? new BoneLean(bone) : null;
  });
  const held: boolean[] = list.map(() => false);
  // The dummies a hit struck in this frame's hits, which a stop that ran out in this frame's clocks does not release.
  const struckNow: boolean[] = list.map(() => false);
  // The frame time the numbers have not yet been placed for: afterPlay adds it, beforeRender spends it.
  let numbersStep = 0;
  const out: PlayClocks = { combo: 0, motion: 0, frame: 0 };
  const stop = new HitStop(SWINGS_KEPT);
  const swings: SwingRecord[] = [];
  const connectListeners = new Set<(event: ConnectEvent) => void>();
  const swingEndListeners = new Set<(event: SwingEndEvent) => void>();
  // The swing whose end its listeners have not yet heard, or null.
  let open: SwingRecord | null = null;
  let connects = 0;
  let lastConnect: ImpactReading['lastConnect'] = null;
  let widthPx = 1;
  let heightPx = 1;

  // The blade on the frame before and now, in world space and in a dummy's own frame, and the hit's clip time then.
  const base0 = new Vector3();
  const tip0 = new Vector3();
  const pivot0 = new Vector3();
  const base1 = new Vector3();
  const tip1 = new Vector3();
  const pivot1 = new Vector3();
  const localBase0 = new Vector3();
  const localTip0 = new Vector3();
  const localPivot0 = new Vector3();
  const localBase1 = new Vector3();
  const localTip1 = new Vector3();
  const localPivot1 = new Vector3();
  const contact = new Vector3();
  const normal = new Vector3();
  const sweep = new Vector3();
  const rootAt = new Vector3();
  // The dummies this swing has met and not yet landed on (detect), and where the blade met each.
  const pending: boolean[] = list.map(() => false);
  const met: Vector3[] = list.map(() => new Vector3());
  let havePrevious = false;
  let previousTime = 0;
  let previousStep: ComboStep | 0 = 0;

  // A reaction begun on this frame: its clock starts on the next, so a struck dummy reels only after the stop.
  const fresh: boolean[] = list.map(() => false);

  // A dummy's reaction to a hit through its hook: pushed away from where Pip stood, leaning back as it goes. The arena
  // lives as long as the page, so neither listener is ever taken down.
  dummies.onHit((dummy: TrainingDummy, hit: DummyHit) => {
    const pose = dummy.pose();
    const finisher = contractOf(hit.step, pip.contracts).planted;
    startReaction(reactions[dummy.index]!, hit.from.x, hit.from.z, pose.x, pose.z, finisher ? feel.knockbackFinisher : feel.knockbackLight, finisher ? FLINCH_FINISHER_DEG : FLINCH_LIGHT_DEG);
    fresh[dummy.index] = true;
  });
  dummies.onReset(() => impact.reset());

  /** A swing that met a dummy: the hook (count and reaction), the stop, the sparks, the shake and the number. */
  function connect(index: number, step: ComboStep, time: number): void {
    const dummy = list[index]!;
    const at = pip.at();
    dummy.hit({ step, time, from: { x: at?.x ?? 0, z: at?.z ?? 0 } });
    const finisher = contractOf(step, pip.contracts).planted;
    stop.start(finisher ? feel.hitStopFinisher : feel.hitStopLight);
    held[index] = stop.active;
    struckNow[index] = true;
    // The sparks fly off the body's surface toward the blade and along its sweep.
    dummy.root.getWorldPosition(rootAt);
    normal.subVectors(contact, rootAt).setY(0);
    if (normal.lengthSq() < 1e-12) normal.set(0, 0, 1);
    normal.normalize();
    sweep.subVectors(tip1, tip0);
    if (sweep.lengthSq() < 1e-12) sweep.copy(normal);
    sweep.normalize();
    sparks.burst(contact, normal, sweep, finisher);
    shake.start(finisher, feel.shake);
    numbers?.spawn(contact, finisher);
    connects += 1;
    lastConnect = { step, dummy: index, at: time, contact: contact.toArray() };
    const swing = swings.at(-1);
    if (swing) {
      swing.connected = true;
      swing.dummies.push(index);
      swing.at ??= time;
    }
    if (connectListeners.size) {
      const event: ConnectEvent = { step, dummy: index, contact: contact.toArray(), finisher };
      for (const listener of connectListeners) listener(event);
    }
  }

  /** Tells the swing-end listeners the open swing is over, once. */
  function endSwing(): void {
    const swing = open;
    open = null;
    if (!swing) return;
    for (const listener of swingEndListeners) listener({ step: swing.step, connected: swing.connected });
  }

  /**
   * Tests the blade's sweep since the frame before against every dummy the swing has not hit, over the part of the
   * frame inside the hit's active frames. The frame before must belong to the same hit and a moving clock: a hit begun
   * on this frame has no sweep yet (its active frames start 0.15 s in), and a held clock (the hit-stop) moves no blade.
   *
   * A dummy the blade meets is hit, but the hit lands (the stop, the sparks, the reaction) on the hit's strike frame,
   * or at the meeting if that comes after it (Pillar 4: a strike frame where the hit lands). The shape is the blade's
   * sweep across the ground, up to DUMMY_HIT_TOP, so an overhead cut meets a body while the blade is still high:
   * landed at the meeting, the finisher's stop held the sword raised over the Husk's head, 0.04 s before the chop came
   * down through it at the strike. The sparks fly where the blade met the body, brought down onto it.
   */
  function detect(frame: ComboFrame): void {
    const hit = frame.state.hit;
    if (frame.started !== null && hit) {
      // A swing cut off before its active frames were over (a press past a cancel point) ends here.
      endSwing();
      swingHits.begin();
      pending.fill(false);
      const swing: SwingRecord = { step: hit.step, connected: false, dummies: [], at: null };
      swings.push(swing);
      if (swings.length > SWINGS_KEPT) swings.shift();
      open = swing;
      havePrevious = false;
    }
    if (!hit) endSwing();
    if (!hit || !pip.blade(base1, tip1, pivot1)) {
      havePrevious = false;
      previousStep = 0;
      return;
    }
    const t1 = hit.time;
    if (havePrevious && previousStep === hit.step && t1 > previousTime) {
      const contract = contractOf(hit.step, pip.contracts);
      const t0 = previousTime;
      const lo = Math.max(t0, contract.activeFrom);
      const hi = Math.min(t1, contract.activeTo);
      if (hi >= lo) {
        const from = (lo - t0) / (t1 - t0);
        const to = (hi - t0) / (t1 - t0);
        const steps = sweepSteps(base0, tip0, base1, tip1, from, to, pivot0, pivot1);
        for (let i = 0; i < list.length; i++) {
          if (swingHits.has(i)) continue;
          const root = list[i]!.root;
          root.updateMatrixWorld();
          root.worldToLocal(localBase0.copy(base0));
          root.worldToLocal(localTip0.copy(tip0));
          root.worldToLocal(localPivot0.copy(pivot0));
          root.worldToLocal(localBase1.copy(base1));
          root.worldToLocal(localTip1.copy(tip1));
          root.worldToLocal(localPivot1.copy(pivot1));
          if (sweepHit(localBase0, localTip0, localBase1, localTip1, localPivot0, localPivot1, bodies[i]!, from, to, steps, contact) < 0) continue;
          // On the body, not in the air over it: a contact above the dummy's top (DUMMY_HIT_TOP says why the band
          // reaches past it) is brought down to its top.
          contact.y = Math.min(contact.y, list[i]!.height);
          root.localToWorld(contact);
          swingHits.take(i);
          pending[i] = true;
          met[i]!.copy(contact);
        }
      }
      if (t1 >= contract.strike) {
        for (let i = 0; i < list.length; i++) {
          if (!pending[i]) continue;
          pending[i] = false;
          contact.copy(met[i]!);
          connect(i, hit.step, t1);
        }
      }
      // Past the active frames nothing more can connect, so the swing's end is heard now, a whiff if it met nothing.
      if (t1 >= contract.activeTo) endSwing();
    }
    base0.copy(base1);
    tip0.copy(tip1);
    pivot0.copy(pivot1);
    previousTime = t1;
    previousStep = hit.step;
    havePrevious = true;
  }

  const impact: CombatImpact = {
    held,
    // A stop that runs out in this frame's clocks leaves its dummies held for this frame's remainder (heldStep), and
    // afterPlay lets them go at the frame's end.
    clocks: (dt) => stop.clocks(dt, out),
    heldStep: () => stop.heldStep,
    afterPlay(frame, dt) {
      // Whether no stop holds after this frame's clocks, read before this frame's hits can begin another.
      const stopEnded = !stop.active;
      struckNow.fill(false);
      if (frame) detect(frame);
      // Each dummy's reaction on its own clock: the struck one's waits out the stop with Pip.
      for (let i = 0; i < list.length; i++) {
        const reaction = reactions[i]!;
        const step = fresh[i] ? 0 : held[i] ? stop.heldStep : Math.max(0, dt);
        fresh[i] = false;
        const ask = stepReaction(reaction, step);
        if (ask > 0) {
          const dummy = list[i]!;
          const from = dummy.pose();
          const to = dummies.push(i, reaction.dirX * ask, reaction.dirZ * ask);
          const went = Math.hypot(to.x - from.x, to.z - from.z);
          reaction.moved += went;
          if (went < ask - 1e-6) reaction.blocked = true;
        }
        // Every frame, so the lean laid last is taken off even once the flinch is over (BoneLean says why).
        const angle = reactionLean(reaction);
        const lean = leans[i];
        if (lean) {
          const dummy = list[i]!;
          if (angle !== 0) dummy.root.updateMatrixWorld(true);
          const pose = angle !== 0 ? dummy.pose() : null;
          lean.apply(pose ? o.ground.surfaceAt(pose.x, pose.z).up : UP, reaction.dirX, reaction.dirZ, angle);
        }
      }
      // A stop that ended in this frame's clocks lets its dummies go now, after they took its remainder; a dummy struck
      // in this frame's hits, whose stop begins now, stays held (releaseHeld).
      releaseHeld(held, struckNow, stopEnded);
      const frameStep = dt > 0 ? dt : 0;
      sparks.update(frameStep, o.camera.position);
      shake.update(frameStep);
      numbersStep += frameStep;
    },
    beforeRender(camera) {
      // The numbers go where this frame's camera draws them: placed in afterPlay, before the page moved the camera
      // (the follow, the orbit's update), they were projected with the frame before's view and lagged a frame behind the
      // wound. Before the shake, so the numbers ride the steady view and do not jitter with it.
      camera.updateMatrixWorld();
      numbers?.update(numbersStep, camera, widthPx, heightPx);
      numbersStep = 0;
      shake.apply(camera);
    },
    afterRender(camera) {
      shake.remove(camera);
    },
    layout(width, height) {
      widthPx = width;
      heightPx = height;
    },
    onConnect(listener) {
      connectListeners.add(listener);
      return () => connectListeners.delete(listener);
    },
    onSwingEnd(listener) {
      swingEndListeners.add(listener);
      return () => swingEndListeners.delete(listener);
    },
    setReducedMotion(on) {
      shake.setReducedMotion(on);
      numbers?.setReducedMotion(on);
    },
    reset() {
      stop.reset();
      held.fill(false);
      struckNow.fill(false);
      fresh.fill(false);
      pending.fill(false);
      for (const reaction of reactions) Object.assign(reaction, idleReaction());
      sparks.reset();
      shake.reset();
      numbers?.reset();
      swingHits.begin();
      havePrevious = false;
      previousStep = 0;
      // A reset drops the open swing unheard: the dummies and Pip go home, and no whiff follows them.
      open = null;
    },
    reading() {
      const shakeNow = shake.reading();
      return {
        swings: swings.map((swing) => ({ ...swing, dummies: [...swing.dummies] })),
        connects,
        lastConnect,
        hitStop: { active: stop.active, remaining: stop.remaining, lengths: [...stop.lengths], held: [...held] },
        sparks: {
          alive: sparks.pool.alive,
          lastCount: sparks.pool.lastCount,
          lastPosition: sparks.pool.bursts > 0 ? [sparks.pool.lastPosition.x, sparks.pool.lastPosition.y, sparks.pool.lastPosition.z] : null,
          bursts: sparks.pool.bursts,
        },
        shake: shakeNow,
        numbers: numbers ? numbers.reading() : { live: 0, last: null },
        dummies: reactions.map((reaction) => ({ flinch: reaction.lean > 0 ? reactionLean(reaction) / reaction.lean : 0, knockback: reaction.moved, blocked: reaction.blocked })),
      };
    },
  };
  return impact;
}
