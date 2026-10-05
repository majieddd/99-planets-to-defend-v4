import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { COMBAT_FEEL_RANGES, DEFAULT_COMBAT_FEEL } from '../../../src/labs/world/combatFeel';
import { footprintObstacle } from '../../../src/labs/combat/dummies';
import { PIP_STRIKE_REACH } from '../../../src/labs/combat/footprint';
import { COMBO_HITS, HAND_HITS } from '../../../src/labs/world/combo';
import {
  ASSIST_CONE_DEG,
  ASSIST_GAP,
  ASSIST_RANGE,
  blendRootStep,
  footprintEntry,
  freshLunge,
  LUNGE_LEAD,
  LUNGE_TAIL,
  lungeShare,
  lungeWindow,
  planLunge,
  rootMotionCurve,
  rootMotionCurves,
  rootMotionFaults,
  ROOT_MOTION_END_TOLERANCE,
  sampleTrack,
  ScriptedLunge,
  stepLunge,
  type LungeCurve,
} from '../../../src/labs/world/lunge';
import { legShare } from '../../../src/labs/world/play';
import { holdingGap, obstacleGap, PLAY_AREA_RADIUS, resolveObstacles, stepMotion, type Obstacle } from '../../../src/labs/world/playMotion';
import {
  crescentWidth,
  TRAIL_CAPACITY,
  TRAIL_EMIT_LEAD,
  TRAIL_EMIT_TAIL,
  TRAIL_LENGTH_MAX,
  TRAIL_SUBSAMPLES_MAX,
  TRAIL_TIP_SPEED_MAX,
  trailAgeShare,
  TrailBuffer,
  trailEmitting,
  TrailStroke,
} from '../../../src/labs/world/swordTrail';

// Play Pip's lunge and sword trail, which run on both pages (labs/world): the lunge's window, its curve (scripted or a
// clip's root motion) and assist, how it combines with his drive, its sweep against the dummies' footprints and the
// area's edge, and the trail's ring, subsampling, length, fade and fresh stroke per hit.

const R = 160;
const DT = 1 / 60;
const FEEL = { ...DEFAULT_COMBAT_FEEL };
// The scripted lunge's own tests run on the hand-keyed hits, which take it (the Quaternius hits bring root motion).
const [HIT1, HIT2, HIT3] = HAND_HITS as [(typeof HAND_HITS)[number], (typeof HAND_HITS)[number], (typeof HAND_HITS)[number]];

/** Runs a lunge over a clip at 60 fps from (x, z) facing yaw, swept against the obstacles, his drive moving `driven` m a frame. */
function runLunge(curve: LungeCurve, duration: number, x: number, z: number, yaw: number, obstacles: Obstacle[] = [], targets: Obstacle[] = [], turn = 0, driven = 0) {
  const state = freshLunge();
  const at = { x, z, yaw };
  const track: { t: number; x: number; z: number }[] = [];
  for (let t = 0; t <= duration + 1e-9; t += DT) {
    stepLunge(state, curve, t, at, targets, obstacles, turn, R, { metres: driven, yaw: at.yaw });
    track.push({ t, x: at.x, z: at.z });
  }
  return { state, at, track };
}

/** A dummy's footprint as an obstacle facing -z (toward a Pip south of it): a core and a head, both widened by `widen`. */
const husk = (x: number, z: number, widen = PIP_STRIKE_REACH): Obstacle =>
  footprintObstacle({ x: 0, z: 0, radius: 0 }, x, z, Math.PI, { core: 0.8, head: { from: 0.6, to: 0.6, radius: 0.7 } }, widen);

describe("Pip's lunge (labs/world/lunge.ts)", () => {
  it('carries each scripted hit forward around its strike, at rest at both ends of its window', () => {
    for (const hit of [...COMBO_HITS, ...HAND_HITS]) {
      const { from, to } = lungeWindow(hit);
      expect(from).toBeCloseTo(hit.strike - LUNGE_LEAD, 12);
      expect(to).toBeCloseTo(hit.strike + LUNGE_TAIL, 12);
      expect(lungeShare(hit, from)).toBe(0);
      expect(lungeShare(hit, to)).toBe(1);
      expect(lungeShare(hit, (from + to) / 2)).toBeCloseTo(0.5, 12);
      // Smooth at its ends: a tiny share a frame in, and a tiny share left a frame before the end.
      expect(lungeShare(hit, from + 0.005)).toBeLessThan(0.01);
      expect(1 - lungeShare(hit, to - 0.005)).toBeLessThan(0.01);
      // The scripted curve is that share of its metres, and reaches its whole length.
      const curve = new ScriptedLunge(hit, 0.35);
      expect([curve.source, curve.total, curve.reach, curve.at(to)]).toEqual(['scripted', 0.35, 0.35, 0.35]);
    }
  });

  it('goes the whole way on open ground, and stops at a body it meets and at the area edge', () => {
    const open = runLunge(new ScriptedLunge(HIT3, 0.55), HIT3.duration, 0, 0, 0);
    expect(open.state.moved).toBeCloseTo(0.55, 6);
    expect(open.at.z).toBeCloseTo(0.55, 4);
    expect(open.state.blocked).toBe(false);
    // A body 0.3 m ahead of his reach: he stops on its reach's edge, 0.3 m on, and goes no further.
    const body: Obstacle = { x: 0, z: 2, radius: 1.7 };
    const blocked = runLunge(new ScriptedLunge(HIT3, 0.55), HIT3.duration, 0, 0, 0, [body]);
    expect(blocked.state.blocked).toBe(true);
    expect(Math.hypot(blocked.at.x - body.x, blocked.at.z - body.z)).toBeGreaterThanOrEqual(body.radius - 1e-9);
    expect(blocked.at.z).toBeCloseTo(0.3, 6);
    // At the area's edge, facing out, he stops on the edge.
    const edge = runLunge(new ScriptedLunge(HIT3, 0.55), HIT3.duration, PLAY_AREA_RADIUS - 0.2, 0, Math.PI / 2);
    expect(Math.hypot(edge.at.x, edge.at.z)).toBeCloseTo(PLAY_AREA_RADIUS, 9);
    expect(edge.state.blocked).toBe(true);
    // A time that does not move (a hit-stop) carries nothing.
    const state = freshLunge();
    const at = { x: 0, z: 0, yaw: 0 };
    const curve = new ScriptedLunge(HIT1, 0.35);
    stepLunge(state, curve, HIT1.strike, at, [], [], 0, R);
    const held = { ...at };
    stepLunge(state, curve, HIT1.strike, at, [], [], 0, R);
    expect(at).toEqual(held);
  });

  it("turns a little toward a target ahead and stops just outside its footprint, and leaves one outside its cone or range alone", () => {
    const turn = (15 * Math.PI) / 180;
    // A dummy 25 degrees to his left, 3 m off, facing him: its footprint widened by his reach begins 0.70 m away head on.
    // He turns 15 degrees (the cap) toward it, and the lunge stops ASSIST_GAP outside the footprint along the turned way.
    const off = (25 * Math.PI) / 180;
    const target = footprintObstacle({ x: 0, z: 0, radius: 0 }, Math.sin(off) * 3, Math.cos(off) * 3, off + Math.PI, { core: 0.8, head: { from: 0.6, to: 0.6, radius: 0.7 } }, PIP_STRIKE_REACH);
    const plan = planLunge(0, 0, 0, 1.47, [target], turn);
    expect(plan.target).toBe(0);
    expect(plan.turn).toBeCloseTo(turn, 12);
    expect(plan.yaw).toBeCloseTo(turn, 12);
    const entry = footprintEntry(0, 0, Math.sin(turn), Math.cos(turn), target, 2);
    expect(plan.length).toBeCloseTo(entry - ASSIST_GAP, 12);
    expect(obstacleGap(target, Math.sin(turn) * plan.length, Math.cos(turn) * plan.length)).toBeCloseTo(ASSIST_GAP * Math.cos(turn - off) ** 0, 2);
    // Never further than the curve reaches: 0.35 m asked, 0.35 m planned.
    expect(planLunge(0, 0, 0, 0.35, [target], turn).length).toBe(0.35);
    // Head on at its edge already, no lunge: where W parks him, his reach meets its head.
    const parked = husk(0, 1.3 + PIP_STRIKE_REACH);
    expect(obstacleGap(parked, 0, 0)).toBeCloseTo(0, 9);
    expect(planLunge(0, 0, 0, 0.75, [parked], turn).length).toBe(0);
    // A member, round, with nothing but its reach: stops ASSIST_GAP outside it.
    const member = planLunge(0, 0, 0, 0.55, [{ x: 0, z: 1.55 + 0.3, radius: 1.55 }], turn);
    expect(member).toMatchObject({ target: 0, turn: 0 });
    expect(member.length).toBeCloseTo(0.3 - ASSIST_GAP, 6);
    // Outside the cone, or beyond the range, or with the assist off: straight ahead, the whole reach.
    const wide = (ASSIST_CONE_DEG + 5) * (Math.PI / 180);
    expect(planLunge(0, 0, 0, 0.55, [{ x: Math.sin(wide) * 2.15, z: Math.cos(wide) * 2.15, radius: 1.55 }], turn)).toEqual({ yaw: 0, length: 0.55, turn: 0, target: -1 });
    expect(planLunge(0, 0, 0, 0.55, [{ x: 0, z: 1.55 + ASSIST_RANGE + 0.1, radius: 1.55 }], turn).target).toBe(-1);
    expect(planLunge(0, 0, 0, 0.55, [target], 0)).toEqual({ yaw: 0, length: 0.55, turn: 0, target: -1 });
    // Carried over the hit, the turn and the step land whole.
    const run = runLunge(new ScriptedLunge(HIT2, 0.35), HIT2.duration, 0, 0, 0, [target], [target], turn);
    expect(run.at.yaw).toBeCloseTo(turn, 9);
    expect(run.state.moved).toBeCloseTo(0.35, 6);
  });

  it("stops at a dummy's head as his walk does, swept, where phase B's lunge went on to a core inside it", () => {
    // A dummy facing him head on, its footprint widened by his reach: its head reaches 1.30 m, so the footprint begins
    // 2.30 m ahead of its root. From 0.5 m short of that, the finisher's 1.47 m of root motion stops on its edge.
    const dummy = husk(0, 2.3 + 0.5);
    const finisher = rootMotionCurve({ times: [0, 1, 2], forward: [0, 1.2, 1.47] });
    const straight = runLunge(finisher, 2, 0, 0, 0, [dummy]);
    expect(straight.state.blocked).toBe(true);
    expect(straight.at.z).toBeCloseTo(0.5, 6);
    expect(obstacleGap(dummy, straight.at.x, straight.at.z)).toBeGreaterThanOrEqual(-1e-9);
    // From the side, the head is not there to stop him: he comes up to the widened core, 1.8 m from the root.
    const side = runLunge(finisher, 2, -2.3, 2.8, Math.PI / 2, [dummy]);
    expect(side.state.blocked).toBe(true);
    expect(Math.hypot(side.at.x - dummy.x, side.at.z - dummy.z)).toBeCloseTo(0.8 + PIP_STRIKE_REACH, 6);
    // His walk meets the same footprint: walking on asks nothing deeper.
    const at = { x: 0, z: 0.5, yaw: 0, speed: 0, drive: 3.2 };
    const on = stepMotion(at, { x: 0, z: 1, amount: 1 }, false, DT, [dummy], R);
    expect(obstacleGap(dummy, on.x, on.z)).toBeGreaterThanOrEqual(-1e-9);
    // A point already inside (a body moved onto him) is held as deep as it stands, not thrown out, and may walk away.
    const inside = { x: 0, z: 0.8, yaw: 0, speed: 0, drive: 0 };
    expect(holdingGap(dummy, inside.x, inside.z)).toBeCloseTo(obstacleGap(dummy, 0, 0.8), 12);
    const still = stepMotion(inside, null, false, DT, [dummy], R);
    expect([still.x, still.z]).toEqual([0, 0.8]);
    const back = stepMotion({ ...inside, yaw: Math.PI, drive: 3.2 }, { x: 0, z: -1, amount: 1 }, false, DT, [dummy], R);
    expect(back.z).toBeLessThan(0.8 - 0.05);
    // A point inside a round reach with no head is pushed back to it, as every member's always was.
    expect(resolveObstacles(0, 0.5, 0, 0.4, [{ x: 0, z: 1.55, radius: 1.55 }]).z).toBeCloseTo(0, 9);
  });

  it('follows a clip\'s root-motion curve when one is recorded, scaled by the planned length over its reach, and swept', () => {
    // A synthetic retargeted hit: 0.5 m along his facing, most of it between 0.1 and 0.2 s, and 0.1 m to his right.
    const motion = { times: [0, 0.1, 0.2, 0.3, 0.7], forward: [0, 0.05, 0.4, 0.5, 0.5], side: [0, 0, 0.08, 0.1, 0.1] };
    expect(rootMotionFaults(motion)).toEqual([]);
    const curve = rootMotionCurve(motion);
    expect([curve.source, curve.total, curve.reach]).toEqual(['root', 0.5, 0.5]);
    expect(curve.at(0.15)).toBeCloseTo(0.225, 12);
    expect(curve.side!(0.25)).toBeCloseTo(0.09, 12);
    expect(sampleTrack(motion.times, motion.forward, 5)).toBe(0.5);
    // Open ground, facing +z: he goes the curve's own metres, ahead and to his right (-x, facing +z), on its timing.
    const open = runLunge(curve, 0.7, 0, 0, 0);
    expect(open.at.z).toBeCloseTo(0.5, 4);
    expect(open.at.x).toBeCloseTo(-0.1, 4);
    const at15 = open.track.find((p) => p.t >= 0.15 - 1e-9)!;
    expect(at15.z).toBeCloseTo(curve.at(at15.t), 4);
    // The assist cuts the plan to 0.3 m: the whole curve is scaled by 0.6, not cut off at 0.3 m.
    const target: Obstacle = { x: 0, z: 1.55 + ASSIST_GAP + 0.3, radius: 1.55 };
    const cut = runLunge(curve, 0.7, 0, 0, 0, [], [target], (15 * Math.PI) / 180);
    expect(cut.state.plan!.length).toBeCloseTo(0.3, 6);
    expect(cut.at.z).toBeCloseTo(0.3, 4);
    expect(cut.at.x).toBeCloseTo(-0.06, 4);
    const cut15 = cut.track.find((p) => p.t >= 0.15 - 1e-9)!;
    expect(cut15.z).toBeCloseTo(curve.at(cut15.t) * 0.6, 3);
    // A curve that overshoots and comes back (the forehand's 0.77 m peak, 0.75 m at its end) plans from its peak.
    expect(rootMotionCurve({ times: [0, 0.3, 0.43], forward: [0, 0.77, 0.75] }).reach).toBe(0.77);
  });

  it('plays a step back as recorded, which the assist does not shorten, where phase B scaled it to nothing', () => {
    // The Quaternius backhand ends 6 cm back. Planned from its total, as phase B did, the lunge's length was 0 and its
    // scale 0 over -0.06, so the step was dropped without a word; planned from its reach (0), it plays as recorded.
    const back = rootMotionCurve({ times: [0, 0.2, 0.53], forward: [0, -0.02, -0.06], side: [0, -0.01, -0.03] });
    expect([back.total, back.reach]).toEqual([-0.06, 0]);
    const target: Obstacle = { x: 0, z: 1.6, radius: 1.55 };
    const run = runLunge(back, 0.6, 0, 0, 0, [], [target], (15 * Math.PI) / 180);
    expect(run.at.z).toBeCloseTo(-0.06, 6);
    expect(run.at.x).toBeCloseTo(0.03, 6);
  });

  it("finishes the assist's turn by the hit's active frames, where his facing locks, whatever the curve has done", () => {
    const turn = (15 * Math.PI) / 180;
    const off = (25 * Math.PI) / 180;
    const target: Obstacle = { x: Math.sin(off) * 2.15, z: Math.cos(off) * 2.15, radius: 1.55 };
    // A scripted lunge, whose curve runs to its strike and 0.04 s past it: with the active frames as the deadline the
    // turn is whole there, where it went on turning him through them.
    const curve = new ScriptedLunge(HIT1, 0.35);
    const state = freshLunge();
    const at = { x: 0, z: 0, yaw: 0 };
    for (let t = DT; t <= HIT1.activeFrom + 1e-9; t += DT) stepLunge(state, curve, t, at, [target], [], turn, R, { metres: 0, yaw: 0 }, HIT1.activeFrom);
    expect(at.yaw).toBeCloseTo(turn, 2);
    // Without a deadline the turn follows the curve and is still under way there.
    const late = freshLunge();
    const at2 = { x: 0, z: 0, yaw: 0 };
    for (let t = DT; t <= HIT1.activeFrom + 1e-9; t += DT) stepLunge(late, curve, t, at2, [target], [], turn, R);
    expect(at2.yaw).toBeLessThan(turn * 0.9);
  });

  it('travels the larger of his drive and the lunge along its way, never their sum, and adds a step back in full', () => {
    expect(blendRootStep(0.03, 0)).toBe(0.03);
    expect(blendRootStep(0.03, 0.02)).toBeCloseTo(0.01, 12);
    expect(blendRootStep(0.03, 0.05)).toBe(0);
    expect(blendRootStep(0.03, -0.05)).toBe(0.03);
    expect(blendRootStep(-0.01, 0.05)).toBe(-0.01);
    // Over a whole clip: standing he lunges the curve's 0.5 m; walking at the light hits' 0.4 pace (1.28 m/s, 0.0213 m a
    // frame) the lunge adds only where the clip's own step is the faster, so walk and lunge together cover less than
    // their sum and at least the walk.
    const curve = rootMotionCurve({ times: [0, 0.1, 0.2, 0.3, 0.7], forward: [0, 0.05, 0.4, 0.5, 0.5] });
    const walking = runLunge(curve, 0.7, 0, 0, 0, [], [], 0, 1.28 * DT);
    const walked = 1.28 * DT * Math.round(0.7 / DT + 1);
    expect(walking.state.moved).toBeGreaterThan(0);
    expect(walking.state.moved).toBeLessThan(0.5);
    expect(walking.state.moved + walked).toBeLessThan(0.5 + walked);
    expect(walking.state.moved + walked).toBeGreaterThanOrEqual(walked);
  });

  it("weighs a root-motion clip's legs by the share of its travel he is given, so a lunge cut short does not slide his feet", () => {
    const forehand = rootMotionCurve({ times: [0, 0.3, 0.43], forward: [0, 0.77, 0.75] });
    // Before the lunge is planned, and planned whole: the clip's own legs.
    expect(legShare(forehand, null, false)).toBe(1);
    expect(legShare(forehand, 0.77, false)).toBe(1);
    // From contact the assist plans nothing: the stance's legs; cut to half, half of each; stopped by a body, the stance.
    expect(legShare(forehand, 0, false)).toBe(0);
    expect(legShare(forehand, 0.385, false)).toBeCloseTo(0.5, 12);
    expect(legShare(forehand, 0.77, true)).toBe(0);
    // A step back plays whole unless a body stops it; the scripted lunge, authored in place, always keeps its legs.
    const back = rootMotionCurve({ times: [0, 0.53], forward: [0, -0.06] });
    expect([legShare(back, 0, false), legShare(back, 0, true)]).toEqual([1, 0]);
    expect(legShare(new ScriptedLunge(HIT1, 0.35), 0, true)).toBe(1);
    expect(legShare(null, null, false)).toBe(1);
  });

  it('names a root-motion record with a fault and falls back to the scripted profile for that hit, and notes a step back', () => {
    const good = { times: [0, 0.2, 0.4], forward: [0, 0.3, 0.4] };
    const faults = {
      lengths: { times: [0, 0.2, 0.4], forward: [0, 0.3] },
      descending: { times: [0, 0.3, 0.2], forward: [0, 0.1, 0.2] },
      offset: { times: [0.1, 0.2], forward: [0, 0.1] },
      notFinite: { times: [0, 0.2], forward: [0, Number.NaN] },
      sideLength: { times: [0, 0.2], forward: [0, 0.1], side: [0] },
      notAnObject: [1, 2, 3],
    };
    for (const [why, value] of Object.entries(faults)) expect(rootMotionFaults(value).length, why).toBeGreaterThan(0);
    expect(rootMotionFaults(faults.lengths)).toEqual(['forward has 2 samples against 3 times']);
    expect(rootMotionFaults(faults.descending)).toEqual(['times must rise strictly (0.3 then 0.2)']);
    // A record that ends more than a frame short of its clip, or past it, is a fault; within a frame it is not.
    expect(rootMotionFaults(good, 0.5)).toEqual(["its last sample at 0.4 s misses the clip's 0.500 s by more than a frame"]);
    expect(rootMotionFaults(good, 0.4 + 1 / 40)).toEqual([]);
    expect(ROOT_MOTION_END_TOLERANCE).toBeCloseTo(1 / 30, 12);
    const said: [string, string][] = [];
    const curves = rootMotionCurves(
      ['attack_1', 'attack_2', 'attack_3', 'attack_1_rec', 'block'],
      { root_motion: { attack_1: good, attack_2: faults.descending, attack_1_rec: good, block: { times: [0, 0.4], forward: [0, -0.1] } } },
      { attack_3: faults.lengths, attack_1_rec: { times: [0, 0.4], forward: [0, 0.9] } },
      (text, kind) => said.push([kind, text]),
      { attack_1_rec: 0.4 },
    );
    // attack_1 from the sidecar; attack_2's sidecar record and attack_3's glTF extras are named and dropped; where the
    // sidecar and the extras both name a clip (attack_1_rec), the sidecar's is taken; a step back is kept and noted.
    expect(Object.keys(curves)).toEqual(['attack_1', 'attack_1_rec', 'block']);
    expect(curves['attack_1']!.total).toBe(0.4);
    expect(curves['attack_1_rec']!.total).toBe(0.4);
    expect(curves['block']!.total).toBe(-0.1);
    expect(said.map(([kind]) => kind)).toEqual(['fault', 'fault', 'note']);
    expect(said[0]![1]).toContain("attack_2's root motion in the sidecar is invalid (times must rise strictly");
    expect(said[1]![1]).toContain("attack_3's root motion in the clip's glTF extras is invalid");
    expect(said[2]![1]).toContain("block's root motion in the sidecar ends -0.100 m along his facing");
    // No sidecar notes and no extras: nothing recorded, nothing named, every hit scripted.
    expect(rootMotionCurves(['attack_1'], null, {}, (text, kind) => said.push([kind, text]))).toEqual({});
    expect(said).toHaveLength(3);
  });
});

describe('the sword trail (labs/world/swordTrail.ts)', () => {
  const base = new Vector3();
  const tip = new Vector3();
  /** The blade swung in a flat circle about the origin at `rate` radians a second, at time t. */
  const pose = (t: number, rate = 30) => {
    base.set(Math.sin(rate * t) * 0.35, 1, Math.cos(rate * t) * 0.35);
    tip.set(Math.sin(rate * t) * 1.05, 1, Math.cos(rate * t) * 1.05);
  };

  it('keeps a ring of samples and drops the oldest, and drops samples older than its length', () => {
    const ring = new TrailBuffer(4);
    for (let i = 0; i < 6; i++) ring.push(i, 0, 0, i, 1, 0, i * 0.01);
    expect(ring.count).toBe(4);
    expect(ring.base[ring.slot(0) * 3]).toBe(2);
    ring.trim(0.05, 0.025);
    expect(ring.count).toBe(3);
    expect(TRAIL_CAPACITY).toBeGreaterThanOrEqual(0.2 * 60 * TRAIL_SUBSAMPLES_MAX * 0.95);
  });

  it('draws the arc through the active frames, subsampled, fades out after them, and starts afresh for the next hit', () => {
    const stroke = new TrailStroke();
    const length = FEEL.trailLength;
    const fade = FEEL.trailFade;
    let t = 0;
    // A frame before the active frames: no stroke.
    pose(t);
    stroke.step(DT, base, tip, false, length, fade);
    expect(stroke.buffer.count).toBe(0);
    // Active: the stroke starts from the pose of the frame before, and a fast arc (30 rad/s, the tip 0.5 m a frame) is
    // subsampled every 0.1 m of the tip's travel.
    t += DT;
    pose(t);
    stroke.step(DT, base, tip, true, length, fade);
    expect(stroke.buffer.count).toBe(1 + Math.ceil((2 * 1.05 * Math.sin((30 * DT) / 2)) / 0.1));
    for (let i = 0; i < 6; i++) {
      t += DT;
      pose(t);
      stroke.step(DT, base, tip, true, length, fade);
    }
    // Its tail is no older than its length.
    const b = stroke.buffer;
    expect(stroke.time - b.time[b.slot(0)]!).toBeLessThanOrEqual(length + 1e-9);
    expect(stroke.reading(length)).toMatchObject({ emitting: true, alpha: 1 });
    // A hit-stop holds it as it is: nothing added, nothing aged.
    const held = b.count;
    stroke.step(0, base, tip, true, length, fade);
    expect(b.count).toBe(held);
    // After the active frames it fades over the fade time and is gone.
    let frames = 0;
    while (stroke.buffer.count > 0 && frames < 60) {
      t += DT;
      pose(t);
      stroke.step(DT, base, tip, false, length, fade);
      frames += 1;
    }
    expect(frames).toBeLessThanOrEqual(Math.ceil(fade / DT) + 1);
    expect(stroke.reading(length)).toEqual({ points: 0, alpha: 0, emitting: false });
    // The next hit's stroke never joins the last one's tail: a stroke still fading is dropped when the next begins.
    const next = new TrailStroke();
    for (let i = 0; i < 4; i++) {
      t += DT;
      pose(t);
      next.step(DT, base, tip, true, length, 0.3);
    }
    t += DT;
    pose(t);
    next.step(DT, base, tip, false, length, 0.3);
    expect(next.buffer.count).toBeGreaterThan(0);
    t += DT;
    pose(t, -30);
    next.step(DT, base, tip, true, length, 0.3);
    // Only the frame before's pose and this frame's arc: nothing older than one frame, the old stroke gone.
    const nb = next.buffer;
    expect(next.time - nb.time[nb.slot(0)]!).toBeCloseTo(DT, 9);
    expect(nb.count).toBeLessThanOrEqual(1 + TRAIL_SUBSAMPLES_MAX);
    next.clear();
    expect(next.buffer.count).toBe(0);
  });
});

describe("the sword trail's crescent (labs/world/swordTrail.ts)", () => {
  it('takes samples from the late wind-up through the early recovery, never past a cancel point', () => {
    // The light hits: active 0.15 to 0.28 s, so from 0.11 s to their 0.30 s cancel; the finisher from 0.29 s to 0.50 s.
    expect(trailEmitting(HIT1, HIT1.activeFrom - TRAIL_EMIT_LEAD - 1e-6)).toBe(false);
    expect(trailEmitting(HIT1, HIT1.activeFrom - TRAIL_EMIT_LEAD)).toBe(true);
    expect(trailEmitting(HIT1, 0.299)).toBe(true);
    expect(trailEmitting(HIT1, HIT1.cancel!)).toBe(false);
    expect(trailEmitting(HIT3, 0.29 + 1e-9)).toBe(true);
    expect(trailEmitting(HIT3, HIT3.activeTo + TRAIL_EMIT_TAIL - 1e-6)).toBe(true);
    expect(trailEmitting(HIT3, HIT3.activeTo + TRAIL_EMIT_TAIL)).toBe(false);
  });

  it('is widest at the blade and comes to a point at its tail, bright along its body and falling away at the tail', () => {
    expect(crescentWidth(0, 0.85)).toBe(0.85);
    expect(crescentWidth(0.5, 0.85)).toBeCloseTo(0.425, 12);
    expect(crescentWidth(1, 0.85)).toBe(0);
    expect(crescentWidth(0, 1.5)).toBe(1);
    expect(trailAgeShare(0.08, 0.16)).toBeCloseTo(0.5, 12);
    expect(trailAgeShare(1, 0.16)).toBe(1);
    const stroke = new TrailStroke();
    stroke.fade = 1;
    // An ease out: three quarters bright half way along, where the square of what was left gave a quarter.
    expect(stroke.shade(0, 0.16)).toBe(1);
    expect(stroke.shade(0.08, 0.16)).toBeCloseTo(0.75, 12);
    expect(stroke.shade(0.16, 0.16)).toBe(0);
    // The defaults keep 0.16 s of arc, inside the 0.15 to 0.2 s the crescent wants, and the slider's top is the ring's.
    expect(DEFAULT_COMBAT_FEEL.trailLength).toBe(0.16);
    expect(TRAIL_LENGTH_MAX).toBe(COMBAT_FEEL_RANGES.trailLength.max);
  });

  it("holds a whole stroke of the slider's longest at the tip's fastest at 144 and 240 frames a second", () => {
    for (const fps of [60, 144, 240]) {
      const dt = 1 / fps;
      const stroke = new TrailStroke();
      const base = new Vector3();
      const tip = new Vector3();
      // The tip on a 1.05 m circle at the fastest speed the ring is sized for, for longer than the stroke keeps.
      const rate = TRAIL_TIP_SPEED_MAX / 1.05;
      for (let t = 0; t < 0.3; t += dt) {
        base.set(Math.sin(rate * t) * 0.35, 1, Math.cos(rate * t) * 0.35);
        tip.set(Math.sin(rate * t) * 1.05, 1, Math.cos(rate * t) * 1.05);
        stroke.step(dt, base, tip, true, TRAIL_LENGTH_MAX, 0.12);
      }
      // Its oldest sample is as old as the stroke's length, less a frame: the ring dropped none it should have kept.
      const b = stroke.buffer;
      expect(stroke.time - b.time[b.slot(0)]!, `${fps} fps`).toBeGreaterThan(TRAIL_LENGTH_MAX - dt - 1e-9);
      expect(b.count, `${fps} fps`).toBeLessThanOrEqual(TRAIL_CAPACITY);
    }
    expect(TRAIL_CAPACITY).toBe(279);
  });
});
