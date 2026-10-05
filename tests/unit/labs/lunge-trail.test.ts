import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT_FEEL } from '../../../src/labs/world/combatFeel';
import { COMBO_HITS } from '../../../src/labs/world/combo';
import { ASSIST_CONE_DEG, ASSIST_GAP, ASSIST_RANGE, freshLunge, LUNGE_LEAD, LUNGE_TAIL, lungeShare, lungeWindow, planLunge, stepLunge } from '../../../src/labs/world/lunge';
import { PLAY_AREA_RADIUS, type Obstacle } from '../../../src/labs/world/playMotion';
import { TRAIL_CAPACITY, TRAIL_SUBSAMPLES_MAX, TrailBuffer, TrailStroke } from '../../../src/labs/world/swordTrail';

// Play Pip's lunge and sword trail, which run on both pages (labs/world): the lunge's window and assist, its sweep
// against the bodies and the area's edge, and the trail's ring, subsampling, length, fade and fresh stroke per hit.

const R = 160;
const DT = 1 / 60;
const FEEL = { ...DEFAULT_COMBAT_FEEL };
const [HIT1, HIT2, HIT3] = COMBO_HITS as [(typeof COMBO_HITS)[number], (typeof COMBO_HITS)[number], (typeof COMBO_HITS)[number]];

describe("Pip's lunge (labs/world/lunge.ts)", () => {
  it('carries each hit forward around its strike, at rest at both ends of its window', () => {
    for (const hit of COMBO_HITS) {
      const { from, to } = lungeWindow(hit);
      expect(from).toBeCloseTo(hit.strike - LUNGE_LEAD, 12);
      expect(to).toBeCloseTo(hit.strike + LUNGE_TAIL, 12);
      expect(lungeShare(hit, from)).toBe(0);
      expect(lungeShare(hit, to)).toBe(1);
      expect(lungeShare(hit, (from + to) / 2)).toBeCloseTo(0.5, 12);
      // Smooth at its ends: a tiny share a frame in, and a tiny share left a frame before the end.
      expect(lungeShare(hit, from + 0.005)).toBeLessThan(0.01);
      expect(1 - lungeShare(hit, to - 0.005)).toBeLessThan(0.01);
    }
  });

  it('goes the whole way on open ground, and stops at a body it meets and at the area edge', () => {
    const run = (x: number, z: number, yaw: number, distance: number, obstacles: Obstacle[], targets: Obstacle[] = [], turn = 0) => {
      const state = freshLunge();
      const at = { x, z, yaw };
      for (let t = 0; t <= HIT3.duration; t += DT) stepLunge(state, HIT3, t, distance, at, targets, obstacles, turn, R);
      return { state, at };
    };
    const open = run(0, 0, 0, 0.55, []);
    expect(open.state.moved).toBeCloseTo(0.55, 6);
    expect(open.at.z).toBeCloseTo(0.55, 4);
    expect(open.state.blocked).toBe(false);
    // A body 0.3 m ahead of his reach: he stops on its reach's edge, 0.3 m on, and goes no further.
    const body: Obstacle = { x: 0, z: 2, radius: 1.7 };
    const blocked = run(0, 0, 0, 0.55, [body]);
    expect(blocked.state.blocked).toBe(true);
    expect(Math.hypot(blocked.at.x - body.x, blocked.at.z - body.z)).toBeGreaterThanOrEqual(body.radius - 1e-9);
    expect(blocked.at.z).toBeCloseTo(0.3, 6);
    // At the area's edge, facing out, he stops on the edge.
    const edge = run(PLAY_AREA_RADIUS - 0.2, 0, Math.PI / 2, 0.55, []);
    expect(Math.hypot(edge.at.x, edge.at.z)).toBeCloseTo(PLAY_AREA_RADIUS, 9);
    expect(edge.state.blocked).toBe(true);
    // A time that does not move (a hit-stop) carries nothing.
    const state = freshLunge();
    const at = { x: 0, z: 0, yaw: 0 };
    stepLunge(state, HIT1, HIT1.strike, 0.35, at, [], [], 0, R);
    const held = { ...at };
    stepLunge(state, HIT1, HIT1.strike, 0.35, at, [], [], 0, R);
    expect(at).toEqual(held);
  });

  it('turns a little toward a target ahead and stops at striking range, and leaves one outside its cone or range alone', () => {
    const turn = (15 * Math.PI) / 180;
    // A target 25 degrees to his left, its reach's edge 0.6 m off: he turns 15 degrees (the cap) toward it, and the
    // lunge stops ASSIST_GAP short of its reach.
    const off = (25 * Math.PI) / 180;
    const target: Obstacle = { x: Math.sin(off) * 2.15, z: Math.cos(off) * 2.15, radius: 1.55 };
    const plan = planLunge(0, 0, 0, 0.55, [target], turn);
    expect(plan.target).toBe(0);
    expect(plan.turn).toBeCloseTo(turn, 12);
    expect(plan.yaw).toBeCloseTo(turn, 12);
    expect(plan.length).toBeCloseTo(0.6 - ASSIST_GAP, 12);
    // A target he faces exactly is not turned toward, and one already at striking range takes no lunge.
    expect(planLunge(0, 0, 0, 0.55, [{ x: 0, z: 1.6, radius: 1.55 }], turn)).toMatchObject({ target: 0, turn: 0, length: 0 });
    // Outside the cone, or beyond the range, or with the assist off: straight ahead, the whole distance.
    const wide = (ASSIST_CONE_DEG + 5) * (Math.PI / 180);
    expect(planLunge(0, 0, 0, 0.55, [{ x: Math.sin(wide) * 2.15, z: Math.cos(wide) * 2.15, radius: 1.55 }], turn)).toEqual({ yaw: 0, length: 0.55, turn: 0, target: -1 });
    expect(planLunge(0, 0, 0, 0.55, [{ x: 0, z: 1.55 + ASSIST_RANGE + 0.1, radius: 1.55 }], turn).target).toBe(-1);
    expect(planLunge(0, 0, 0, 0.55, [target], 0)).toEqual({ yaw: 0, length: 0.55, turn: 0, target: -1 });
    // Carried over the hit, the turn and the step land whole.
    const state = freshLunge();
    const at = { x: 0, z: 0, yaw: 0 };
    for (let t = 0; t <= HIT2.duration; t += DT) stepLunge(state, HIT2, t, 0.35, at, [target], [target], turn, R);
    expect(at.yaw).toBeCloseTo(turn, 9);
    expect(state.moved).toBeCloseTo(0.35, 6);
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
