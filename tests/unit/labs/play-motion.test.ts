import { Group, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  clampToArea,
  groundDistance,
  groundToTangent,
  moveDirection,
  PLAY_AREA_RADIUS,
  PLAY_BODY_RADIUS,
  PLAY_SPAWN,
  PLAY_SPRINT_SPEED,
  PLAY_STICK_DEAD_ZONE,
  PLAY_TURN_RATE_DEG,
  PLAY_WALK_SPEED,
  resolveObstacles,
  runLoopDistance,
  stepMotion,
  stickInput,
  turnToward,
  wrapAngle,
  yawOf,
  type FootSample,
  type MotionState,
  type Obstacle,
} from '../../../src/labs/world/playMotion';
import { MEMBERS, toTangent } from '../../../src/labs/world/registry';
import { DEFAULT_DIALS } from '../../../src/render/defaults';
import { createPaintUniforms } from '../../../src/render/materials/painted';
import { place } from '../../../src/render/terrain/place';
import { createStylePatch, STYLE_PLANET_RADIUS } from '../../../src/render/terrain/stylePatch';
import { VERDANT } from '../../../src/render/themes';

const R = STYLE_PLANET_RADIUS;
const DT = 1 / 60;
const forward = { right: 0, forward: 1, sprint: false };

/** Runs frames of one input from a state, as the page's loop does, and returns the last state. */
function run(state: MotionState, input: typeof forward, camera: [number, number], seconds: number, obstacles: Obstacle[] = []): MotionState {
  let now = state;
  for (let t = 0; t < seconds; t += DT) now = stepMotion(now, moveDirection(input, camera[0], camera[1]), input.sprint, DT, obstacles, R);
  return now;
}

describe('the play prototype movement', () => {
  it('moves relative to the camera facing on the ground', () => {
    // A camera looking along -z: forward is -z and right is +x; looking along +x, right is +z.
    const along = (input: typeof forward, fx: number, fz: number) => {
      const d = moveDirection(input, fx, fz)!;
      return [Number(d.x.toFixed(6)) + 0, Number(d.z.toFixed(6)) + 0, d.amount];
    };
    expect(along(forward, 0, -1)).toEqual([0, -1, 1]);
    expect(along({ right: 1, forward: 0, sprint: false }, 0, -1)).toEqual([1, 0, 1]);
    expect(along({ right: 1, forward: 0, sprint: false }, 3, 0)).toEqual([0, 1, 1]);
    const diagonal = moveDirection({ right: 1, forward: 1, sprint: false }, 0, -1)!;
    expect(diagonal.amount).toBe(1);
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(1, 12);
    expect(moveDirection({ right: 0, forward: 0, sprint: false }, 0, -1)).toBeNull();

    // Held long enough, he faces the way asked and walks there at the walk pace, or the sprint pace with Shift.
    const start: MotionState = { x: 0, z: 0, yaw: 0, speed: 0, drive: 0 };
    const walked = run(start, forward, [1, 1], 1.5);
    expect(wrapAngle(walked.yaw - yawOf(1, 1))).toBeCloseTo(0, 9);
    expect(walked.speed).toBeCloseTo(PLAY_WALK_SPEED, 9);
    expect(Math.atan2(walked.x, walked.z)).toBeCloseTo(Math.PI / 4, 2);
    expect(run(start, { ...forward, sprint: true }, [1, 1], 1.5).speed).toBeCloseTo(PLAY_SPRINT_SPEED, 9);
    // Let go, he stops.
    expect(run(walked, { right: 0, forward: 0, sprint: false }, [1, 1], 0.5).speed).toBe(0);
  });

  it('covers its pace along the curved ground anywhere on the patch, and stands on the surface there', () => {
    // Out from the pole and across, at 40 m and inside the area at 18 m, a step covers its length along the sphere, not
    // along the plane (at 40 m the plane alone would lose 6 percent outward and 3 percent across).
    for (const [dx, dz] of [
      [0.05, 0],
      [0, 0.05],
    ] as [number, number][]) {
      const [tx, tz] = groundToTangent(40, 0, dx, dz, R);
      expect(groundDistance(40, 0, 40 + tx, tz, R) / 0.05).toBeCloseTo(1, 3);
    }
    for (const camera of [
      [1, 0],
      [0, 1],
    ] as [number, number][]) {
      const from: MotionState = { x: 18, z: 0, yaw: yawOf(camera[0], camera[1]), speed: PLAY_WALK_SPEED, drive: PLAY_WALK_SPEED };
      const to = run(from, forward, camera, 1);
      expect(groundDistance(from.x, from.z, to.x, to.z, R) / PLAY_WALK_SPEED).toBeCloseTo(1, 3);
    }
    // place() stands his root on surfaceAt at his tangent point, upright to the local up, however far out he is.
    const patch = createStylePatch(VERDANT, createPaintUniforms(VERDANT, DEFAULT_DIALS, null), 32);
    const root = new Group();
    for (const [x, z] of [
      [13, -4],
      [-30, 25],
      [PLAY_AREA_RADIUS, 0],
    ] as [number, number][]) {
      place(root, patch, x, z, 1.2);
      const surface = patch.surfaceAt(x, z);
      expect(root.position.distanceTo(surface.position)).toBeLessThan(1e-9);
      expect(new Vector3(0, 1, 0).applyQuaternion(root.quaternion).angleTo(surface.up)).toBeLessThan(1e-6);
    }
  });

  it('slides round a member reach rather than stopping dead, and stops against one head on', () => {
    const post: Obstacle = { x: 0, z: 5, radius: 1 };
    // Aimed a little to the left of the post's centre, he glances off it and goes on past on its left.
    const past = run({ x: 0.3, z: 0, yaw: 0, speed: PLAY_WALK_SPEED, drive: PLAY_WALK_SPEED }, forward, [0, 1], 4, [post]);
    expect(past.z).toBeGreaterThan(post.z + 1);
    expect(past.x).toBeGreaterThan(0.99);
    // Head on, he is held at the reach's edge and his speed falls to the ground he covers, so he does not run on the spot.
    const stopped = run({ x: 0, z: 0, yaw: 0, speed: PLAY_WALK_SPEED, drive: PLAY_WALK_SPEED }, forward, [0, 1], 3, [post]);
    expect(Math.hypot(stopped.x - post.x, stopped.z - post.z)).toBeCloseTo(post.radius, 6);
    expect(stopped.speed).toBeLessThan(0.1);
    // A point pushed from one reach into its neighbour's settles outside both.
    const pair: Obstacle[] = [
      { x: -0.6, z: 0, radius: 1 },
      { x: 0.6, z: 0, radius: 1 },
    ];
    const settled = resolveObstacles(0.05, 0.2, 0.05, -3, pair);
    expect(settled.blocked).toBe(true);
    for (const o of pair) expect(Math.hypot(settled.x - o.x, settled.z - o.z)).toBeGreaterThanOrEqual(o.radius - 1e-9);
  });

  it('keeps him inside the patch area, sliding along its edge', () => {
    expect(clampToArea(10, 0)).toEqual({ x: 10, z: 0, blocked: false });
    const out = clampToArea(60, 80);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(PLAY_AREA_RADIUS, 12);
    // Run straight out from the pole for a minute, he ends on the edge; run along it, he follows it round.
    const edge = run({ x: 0, z: 0, yaw: yawOf(1, 0), speed: 0, drive: 0 }, forward, [1, 0], 20);
    expect(Math.hypot(edge.x, edge.z)).toBeCloseTo(PLAY_AREA_RADIUS, 9);
    expect(edge.speed).toBeLessThan(0.1);
    const heading = [0.5 / Math.hypot(0.5, 1), 1 / Math.hypot(0.5, 1)] as const;
    const along = run(edge, { ...forward, sprint: true }, [heading[0], heading[1]], 1.5);
    const r = Math.hypot(along.x, along.z);
    expect(r).toBeLessThanOrEqual(PLAY_AREA_RADIUS + 1e-9);
    expect(along.z).toBeGreaterThan(3);
    // Sliding, he keeps the share of his sprint that runs along the edge where he is; with the held-back speed fed back
    // into his drive, the ease restarted from it every frame and he crawled.
    const share = PLAY_SPRINT_SPEED * Math.abs(heading[0] * (-along.z / r) + heading[1] * (along.x / r));
    expect(along.speed / share).toBeGreaterThan(0.9);
  });

  it('turns no faster than the cap, the short way round', () => {
    const cap = ((PLAY_TURN_RATE_DEG * Math.PI) / 180) * DT;
    expect(turnToward(0, 2, cap)).toBeCloseTo(cap, 12);
    expect(turnToward(0, 0.001, cap)).toBeCloseTo(0.001, 12);
    // From just short of +pi to just past -pi is a small turn across the seam, not most of a circle.
    expect(wrapAngle(turnToward(3.1, -3.1, cap) - 3.1)).toBeCloseTo(Math.min(cap, 2 * Math.PI - 6.2), 12);
    // Asked to reverse, he turns on the spot: every frame turns at most the cap, and he gathers no speed facing away.
    let state: MotionState = { x: 0, z: 0, yaw: 0, speed: 0, drive: 0 };
    for (let i = 0; i < 10; i++) {
      const next = stepMotion(state, moveDirection(forward, 0, -1), false, DT, [], R);
      expect(Math.abs(wrapAngle(next.yaw - state.yaw))).toBeLessThanOrEqual(cap + 1e-12);
      if (Math.abs(wrapAngle(next.yaw - Math.PI)) > Math.PI / 2) expect(next.speed).toBe(0);
      state = next;
    }
  });

  it('spawns him clear of every placed member root', () => {
    const at = toTangent(PLAY_SPAWN.s, PLAY_SPAWN.d);
    const nearest = Math.min(...MEMBERS.map((m) => Math.hypot(at.x - toTangent(m.s, m.d).x, at.z - toTangent(m.s, m.d).z)));
    // Pip-A's idle and run members, the nearest, stand 3.7 m away: room for their reach and his.
    expect(nearest).toBeGreaterThan(3 + PLAY_BODY_RADIUS);
  });

  it('reads an in-place run clip loop from its planted feet, and a thumb pad push as a move', () => {
    // Two feet half a loop apart, each planted for half the loop and sliding back at 4 m/s, lifted for the other half.
    const duration = 0.7;
    const moments = 70;
    const foot = (phase: number): FootSample => {
      const t = phase % 1;
      return t < 0.5 ? { y: 0, z: 0.7 - t * duration * 4 } : { y: 0.2 * Math.sin((t - 0.5) * 2 * Math.PI), z: -0.7 + (t - 0.5) * duration * 4 };
    };
    const samples = Array.from({ length: moments }, (_, i) => [foot(i / moments), foot(i / moments + 0.5)]);
    expect(runLoopDistance(samples, duration)).toBeCloseTo(4 * duration, 6);
    expect(runLoopDistance([], duration)).toBeNull();

    expect(stickInput(2, 2, 60)).toEqual({ right: 0, forward: 0, sprint: false });
    const up = stickInput(0, -30, 60);
    expect(up.right).toBeCloseTo(0, 12);
    expect(up.forward).toBeCloseTo((0.5 - PLAY_STICK_DEAD_ZONE) / (1 - PLAY_STICK_DEAD_ZONE), 12);
    expect(up.sprint).toBe(false);
    expect(stickInput(200, 0, 60)).toEqual({ right: 1, forward: -0, sprint: true });
  });
});
