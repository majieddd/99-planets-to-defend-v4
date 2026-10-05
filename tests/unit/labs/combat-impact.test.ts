import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { HitStop } from '../../../src/labs/combat/hitStop';
import { HIT_SAMPLES_MAX, segmentToAxis, SwingHits, sweepHit, sweepSteps, swingPoint, type HitBody, type Vec3 } from '../../../src/labs/combat/hitShape';
import {
  FLINCH_FINISHER_DEG,
  FLINCH_LIGHT_DEG,
  FLINCH_RISE,
  FLINCH_SECONDS,
  flinchWeight,
  idleReaction,
  KNOCKBACK_SECONDS,
  knockbackShare,
  reactionLean,
  startReaction,
  stepReaction,
} from '../../../src/labs/combat/reactions';
import { createCameraShake, shakeAt, SHAKE_FINISHER_M, SHAKE_FINISHER_SECONDS, SHAKE_LIGHT_M, SHAKE_LIGHT_SECONDS } from '../../../src/labs/combat/shake';
import { FLASH_SECONDS, SPARK_LIFE_MAX, SPARK_POOL, SparkPool, SPARKS_FINISHER, SPARKS_LIGHT } from '../../../src/labs/combat/sparks';
import { DEFAULT_COMBAT_FEEL } from '../../../src/labs/world/combatFeel';
import { COMBO_HITS, COMBO_READY, comboWeights, fadeStep, stepCombo, swingMotion, type ComboState } from '../../../src/labs/world/combo';
import type { PlayClocks } from '../../../src/labs/world/play';
import { moveDirection, stepMotion, type MotionState } from '../../../src/labs/world/playMotion';

// The combat arena's impact (labs/combat): the hit test, the hit-stop's clock, the dummies' reactions, the camera
// shake and the sparks.

const R = 160;
const DT = 1 / 60;
const FEEL = { ...DEFAULT_COMBAT_FEEL };
const HIT1 = COMBO_HITS[0]!;
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/**
 * A blade 0.7 m long held flat at chest height by Pip standing at `pivot`, pointing at `angle` (a yaw, place()'s way: it
 * points along (sin, cos)), its base 0.35 m and its tip 1.05 m from his root. The body under test stands on its own
 * frame's origin, so the pivot is where Pip stands from it.
 */
function bladeAt(pivot: Vec3, angle: number): { base: Vec3; tip: Vec3 } {
  const dx = Math.sin(angle);
  const dz = Math.cos(angle);
  return { base: v(pivot.x + dx * 0.35, 1.1, pivot.z + dz * 0.35), tip: v(pivot.x + dx * 1.05, 1.1, pivot.z + dz * 1.05) };
}

/**
 * Whether a flat cut from a0 to a1 by a blade swung from `pivot` meets the body, and where: tested as the page tests it,
 * frame by frame, `frames` frames over the cut, each frame's sweep swung about his root at the blade's height.
 */
function cut(pivot: Vec3, a0: number, a1: number, body: HitBody, frames = 8): { s: number; contact: Vec3 } {
  const contact = v(0, 0, 0);
  const turn = v(pivot.x, 1.1, pivot.z);
  for (let f = 0; f < frames; f++) {
    const from = bladeAt(pivot, a0 + ((a1 - a0) * f) / frames);
    const to = bladeAt(pivot, a0 + ((a1 - a0) * (f + 1)) / frames);
    const steps = sweepSteps(from.base, from.tip, to.base, to.tip, 0, 1, turn, turn);
    const s = sweepHit(from.base, from.tip, to.base, to.tip, turn, turn, body, 0, 1, steps, contact);
    if (s >= 0) return { s: (f + s) / frames, contact };
  }
  return { s: -1, contact };
}

describe("the arena's hit test (labs/combat/hitShape.ts)", () => {
  const body: HitBody = { radius: 0.6, low: 0.15, high: 2 };
  const deg = Math.PI / 180;

  it('meets a body in range of the blade, and misses one beyond its reach or behind him', () => {
    // Pip 1.55 m from the body (his reach and the body's touching), facing it, swings from 60 degrees to one side of it
    // to 60 to the other: `facingBody` turns an angle off the line to the body into a yaw.
    const facingBody = (pivot: Vec3) => (angle: number) => {
      const toward = Math.atan2(-pivot.x, -pivot.z);
      return toward + angle;
    };
    const near = v(0, 0, 1.55);
    const turn = facingBody(near);
    const hit = cut(near, turn(-60 * deg), turn(60 * deg), body);
    expect(hit.s).toBeGreaterThanOrEqual(0);
    // The contact is on the body's surface, across the ground from its axis, at the blade's height.
    expect(Math.hypot(hit.contact.x, hit.contact.z)).toBeCloseTo(body.radius, 9);
    expect(hit.contact.y).toBeCloseTo(1.1, 9);
    // 2.0 m off, his 1.05 m blade stops 0.35 m short of the body's surface: missed.
    const far = v(0, 0, 2.0);
    expect(cut(far, facingBody(far)(-60 * deg), facingBody(far)(60 * deg), body).s).toBe(-1);
    // The same cut with him facing away (the body behind him): missed.
    const away = (angle: number) => turn(angle) + Math.PI;
    expect(cut(near, away(-60 * deg), away(60 * deg), body).s).toBe(-1);
  });

  it('meets a body only inside the arc the blade sweeps, to the edge of its body and no further', () => {
    // From 1.55 m, the body's 0.6 m radius spans asin(0.6 / d) either side of the line to it as the blade's tip sees it;
    // a cut that stops short of that edge misses, one that just reaches past it hits.
    const near = v(0, 0, 1.55);
    const toward = Math.atan2(-near.x, -near.z);
    // The tip's circle (1.05 m) meets the body's (0.6 m about a centre 1.55 m off) at this angle off the line.
    const edge = Math.acos((1.05 ** 2 + 1.55 ** 2 - 0.6 ** 2) / (2 * 1.05 * 1.55));
    // A cut from far out to the right that stops 2 degrees short of the edge misses; 2 degrees past it hits.
    expect(cut(near, toward - 90 * deg, toward - edge - 2 * deg, body).s).toBe(-1);
    expect(cut(near, toward - 90 * deg, toward - edge + 2 * deg, body).s).toBeGreaterThan(0);
    // And on the other side the same.
    expect(cut(near, toward + 90 * deg, toward + edge + 2 * deg, body).s).toBe(-1);
    expect(cut(near, toward + 90 * deg, toward + edge - 2 * deg, body).s).toBeGreaterThan(0);
  });

  it('takes the blade against the body by height band, and tests a fast sweep often enough to catch it', () => {
    const near = v(0, 0, 0);
    // A segment wholly above the band misses; one that crosses into it is cut to the band.
    expect(segmentToAxis(v(-1, 2.5, 0.2), v(1, 2.5, 0.2), 0.15, 2, near)).toBe(Infinity);
    const d = segmentToAxis(v(0.3, 3, 0), v(0.3, 1, 0), 0.15, 2, near);
    expect(d).toBeCloseTo(0.3, 12);
    expect(near.y).toBeLessThanOrEqual(2);
    // A tip moving 3.2 m in a frame (the finisher at the labs' 1/20 s step) is tested at least every 0.1 m.
    expect(sweepSteps(v(0, 1, 0), v(0, 1, 1), v(0, 1, 0), v(3.2, 1, 1), 0, 1)).toBe(HIT_SAMPLES_MAX);
    expect(sweepSteps(v(0, 1, 0), v(0, 1, 1), v(0, 1, 0), v(0.25, 1, 1), 0, 1)).toBe(3);
  });

  it('swings a big step between two frames about his shoulders, where a straight line between the poses cut under the body', () => {
    // 120 degrees of cut in one frame, the labs' 1/20 s step at the finisher's speed: the chord between the two poses
    // passes 0.53 m from his root, short of a body whose surface is 0.95 m off; swung about his root, the blade crosses it.
    const near = v(0, 0, 1.55);
    const toward = Math.atan2(-near.x, -near.z);
    const deg = Math.PI / 180;
    expect(cut(near, toward - 60 * deg, toward + 60 * deg, body, 1).s).toBeGreaterThan(0);
    const from = bladeAt(near, toward - 60 * deg);
    const to = bladeAt(near, toward + 60 * deg);
    const contact = v(0, 0, 0);
    const straight = { x: 0, y: 0, z: 0 };
    // About his root the tip's middle moment stands on the arc, its full reach out; swung instead about the blade's base,
    // itself taken in a straight line, it falls short of the body as the chord did.
    const mid = swingPoint(from.tip, to.tip, v(near.x, 1.1, near.z), v(near.x, 1.1, near.z), 0.5, straight);
    expect(Math.hypot(mid.x - near.x, mid.z - near.z)).toBeCloseTo(1.05, 9);
    expect(sweepHit(from.base, from.tip, to.base, to.tip, from.base, to.base, body, 0, 1, 32, contact)).toBe(-1);
    // A sweep's moments are counted along the arc, not the chord.
    expect(sweepSteps(from.base, from.tip, to.base, to.tip, 0, 1, v(near.x, 1.1, near.z), v(near.x, 1.1, near.z))).toBe(Math.ceil((1.05 * 120 * deg) / 0.1));
  });

  it('hits each body at most once a swing', () => {
    const hits = new SwingHits(3);
    expect(hits.take(1)).toBe(true);
    expect(hits.take(1)).toBe(false);
    expect(hits.has(1)).toBe(true);
    expect(hits.take(0)).toBe(true);
    hits.begin();
    expect(hits.has(1)).toBe(false);
    expect(hits.take(1)).toBe(true);
  });
});

describe('the hit-stop clock (labs/combat/hitStop.ts)', () => {
  it('holds the combo and movement for its length while the frame runs, to the millisecond at any frame rate', () => {
    for (const [dt, seconds] of [
      [1 / 60, 0.055],
      [1 / 60, 0.09],
      [1 / 20, 0.055],
      [1 / 144, 0.09],
    ] as const) {
      const stop = new HitStop();
      const out: PlayClocks = { combo: 0, motion: 0, frame: 0 };
      stop.start(seconds);
      let held = 0;
      let frames = 0;
      while (stop.active) {
        stop.clocks(dt, out);
        expect(out.frame).toBe(dt);
        expect(out.combo).toBe(out.motion);
        held += out.frame - out.combo;
        frames += 1;
      }
      expect(held).toBeCloseTo(seconds, 12);
      expect(stop.lengths).toEqual([expect.closeTo(seconds, 12)]);
      expect(frames).toBe(Math.ceil(seconds / dt - 1e-9));
      // Then everything runs on the frame's step again.
      stop.clocks(dt, out);
      expect(out.combo).toBe(dt);
    }
  });

  it('stops time on contact with nothing skating or popping, keeps a press made in it, and resumes where it held', () => {
    // Pip moving in attack_1 at the reduced pace, its strike just reached: the contact starts the stop.
    const stop = new HitStop();
    const out: PlayClocks = { combo: 0, motion: 0, frame: 0 };
    let combo: ComboState = { ...COMBO_READY, hit: { step: 1, time: HIT1.strike, struck: true, crossfaded: false, chainedAt: null, fades: { rise: FEEL.fadeIn, fadeOut: FEEL.fadeOut } } };
    let motion: MotionState = { x: 0, z: 0, yaw: 0, speed: 1.28, drive: 1.28 };
    let lastStep = DT;
    const weightBefore = comboWeights(combo, lastStep).current;
    stop.start(FEEL.hitStopLight);
    const tight = { ...FEEL, buffer: 0.05 };
    let pressedInStop = false;
    while (stop.active) {
      stop.clocks(DT, out);
      lastStep = fadeStep(lastStep, out.combo);
      const frame = stepCombo(combo, !pressedInStop, out.combo, tight, lastStep);
      if (!pressedInStop) expect(frame.press).toBe('queued');
      pressedInStop = true;
      combo = frame.state;
      const before = motion;
      motion = stepMotion(motion, moveDirection({ right: 0, forward: 1, sprint: false }, 0, 1), false, out.motion, [], R, swingMotion(combo, tight));
      if (out.combo === 0) {
        // Held: his clip time, his place and his weights stand still, so neither his legs nor his body move.
        expect(combo.hit!.time).toBe(HIT1.strike);
        expect([motion.x, motion.z]).toEqual([before.x, before.z]);
        expect(comboWeights(combo, lastStep).current).toBe(weightBefore);
      }
    }
    // The last frame of the stop let the rest of it run: the clip moved on by exactly that much.
    expect(combo.hit!.time).toBeCloseTo(HIT1.strike + (4 * DT - FEEL.hitStopLight), 12);
    // The press made in the stop chains attack_2 at the cancel point.
    let started = null;
    for (let i = 0; i < 20 && started === null; i++) {
      const frame = stepCombo(combo, false, DT, tight, DT);
      combo = frame.state;
      started = frame.started;
    }
    expect(started).toBe(2);
    expect(combo.hit!.chainedAt).toBe(HIT1.cancel);
  });
});

describe("the dummies' reactions (labs/combat/reactions.ts)", () => {
  it('knocks a dummy back eased out over its time, and stops the push for good once a body holds it', () => {
    expect(knockbackShare(0)).toBe(0);
    expect(knockbackShare(KNOCKBACK_SECONDS)).toBe(1);
    expect(knockbackShare(KNOCKBACK_SECONDS / 2)).toBeCloseTo(0.875, 12);
    const reaction = idleReaction();
    startReaction(reaction, 0, 0, 0, 2, 0.25, FLINCH_LIGHT_DEG);
    expect([reaction.dirX, reaction.dirZ]).toEqual([0, 1]);
    let total = 0;
    for (let i = 0; i < 30; i++) total += stepReaction(reaction, DT);
    expect(total).toBeCloseTo(0.25, 12);
    // Blocked part way, it asks for nothing more.
    const stopped = idleReaction();
    startReaction(stopped, 0, 0, 2, 0, 0.6, FLINCH_FINISHER_DEG);
    stepReaction(stopped, DT);
    stopped.blocked = true;
    expect(stepReaction(stopped, DT)).toBe(0);
    // A held clock (the stop) moves nothing.
    const held = idleReaction();
    startReaction(held, 0, 0, 0, 1, 0.25, FLINCH_LIGHT_DEG);
    expect(stepReaction(held, 0)).toBe(0);
    expect(held.time).toBe(0);
  });

  it('flinches up to its peak and back to rest, and a second hit rises from the lean the first left', () => {
    expect(flinchWeight(0)).toBe(0);
    expect(flinchWeight(FLINCH_RISE)).toBeCloseTo(1, 12);
    expect(flinchWeight(FLINCH_SECONDS)).toBe(0);
    const reaction = idleReaction();
    startReaction(reaction, 0, 0, 0, 1, 0.25, FLINCH_LIGHT_DEG);
    for (let i = 0; i < 12; i++) stepReaction(reaction, DT);
    const leaning = reactionLean(reaction);
    expect(leaning).toBeGreaterThan(0);
    // The next hit lands: through its stop (time 0) the lean holds where it was, where it used to snap to 0.
    startReaction(reaction, 0, 0, 0, 1, 0.25, FLINCH_LIGHT_DEG);
    expect(reactionLean(reaction)).toBeCloseTo(leaning, 12);
    stepReaction(reaction, FLINCH_RISE);
    expect(reactionLean(reaction)).toBeCloseTo((FLINCH_LIGHT_DEG * Math.PI) / 180, 9);
  });
});

describe('the camera shake (labs/combat/shake.ts)', () => {
  it('kicks hardest at once, more on the finisher, dies away to nothing, and is off under reduced motion', () => {
    const out = { x: 0, y: 0 };
    const peak = (amplitude: number, duration: number) => {
      let most = 0;
      for (let t = 0; t < duration; t += 0.001) most = Math.max(most, Math.hypot(...Object.values(shakeAt(t, duration, amplitude, out))));
      return most;
    };
    expect(peak(SHAKE_FINISHER_M, SHAKE_FINISHER_SECONDS)).toBeGreaterThan(peak(SHAKE_LIGHT_M, SHAKE_LIGHT_SECONDS));
    expect(peak(SHAKE_LIGHT_M, SHAKE_LIGHT_SECONDS)).toBeLessThanOrEqual(SHAKE_LIGHT_M * Math.SQRT2);
    expect(shakeAt(SHAKE_LIGHT_SECONDS, SHAKE_LIGHT_SECONDS, SHAKE_LIGHT_M, out)).toEqual({ x: 0, y: 0 });
    // Laid on for the draw and taken off after, the camera's position comes back to the bit.
    const camera = { position: new Vector3(1.5, 2.25, -3.125), quaternion: { x: 0, y: 0.3826834, z: 0, w: 0.9238795 }, updateMatrixWorld() {} };
    const shake = createCameraShake(false);
    shake.start(true, 1);
    shake.update(0.004);
    const before = camera.position.clone();
    shake.apply(camera as never);
    expect(camera.position.distanceTo(before)).toBeGreaterThan(0);
    shake.remove(camera as never);
    expect(camera.position.equals(before)).toBe(true);
    const calm = createCameraShake(true);
    calm.start(true, 1);
    calm.update(0.004);
    expect(calm.reading()).toEqual({ offset: 0, active: false, enabled: false });
  });
});

describe('the hit sparks (labs/combat/sparks.ts)', () => {
  it('throws a light or a finisher burst from a fixed pool, the same burst every run, and lets every spark die', () => {
    const at = v(1, 1, 1);
    const normal = v(0, 0, -1);
    const sweep = v(1, 0, 0);
    const pool = new SparkPool();
    pool.burst(at, normal, sweep, false);
    expect(pool.alive).toBe(SPARKS_LIGHT);
    expect(pool.lastCount).toBe(SPARKS_LIGHT);
    pool.burst(at, normal, sweep, true);
    expect(pool.alive).toBe(SPARKS_LIGHT + SPARKS_FINISHER);
    expect(pool.sparks.length).toBe(SPARK_POOL);
    // A fourth burst in a row reuses the oldest sparks rather than growing the pool.
    for (let i = 0; i < 3; i++) pool.burst(at, normal, sweep, true);
    expect(pool.sparks.length).toBe(SPARK_POOL);
    expect(pool.alive).toBe(SPARK_POOL);
    // Every spark is thrown off the contact, and all of them are gone within their longest life.
    for (let t = 0; t < SPARK_LIFE_MAX + DT; t += DT) pool.step(DT);
    expect(pool.alive).toBe(0);
    expect(pool.flashes.every((flash) => !flash.alive)).toBe(true);
    expect(FLASH_SECONDS).toBeLessThan(SPARK_LIFE_MAX);
    // Reset, it throws the same burst again.
    const a = new SparkPool();
    const b = new SparkPool();
    b.burst(at, normal, sweep, false);
    b.reset();
    a.burst(at, normal, sweep, false);
    b.burst(at, normal, sweep, false);
    expect(b.sparks.map((spark) => spark.vx)).toEqual(a.sparks.map((spark) => spark.vx));
  });
});
