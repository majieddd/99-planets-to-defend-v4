import { Group, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  attackWeight,
  clampToArea,
  clearance,
  groundDistance,
  groundForward,
  groundToTangent,
  isAttackClick,
  moveDirection,
  NOT_SWINGING,
  PLAY_AREA_RADIUS,
  PLAY_ATTACK_FADE_IN,
  PLAY_ATTACK_FADE_OUT,
  PLAY_ATTACK_MOVE_SCALE,
  PLAY_BODY_RADIUS,
  PLAY_CLICK_MAX_SECONDS,
  PLAY_CLICK_SLOP_PX,
  PLAY_SECONDS_TO_STOP,
  PLAY_SPAWN,
  PLAY_SPRINT_SPEED,
  PLAY_STICK_DEAD_ZONE,
  PLAY_TURN_RATE_DEG,
  PLAY_WALK_SPEED,
  resolveObstacles,
  runLoopDistance,
  stepAttack,
  stepMotion,
  stickInput,
  triggerAttack,
  turnToward,
  wrapAngle,
  yawOf,
  type AttackState,
  type FootSample,
  type MotionState,
  type Obstacle,
  type Vec3,
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

  it("spawns him in front of his own row, between his idle and run members, clear of every placed member's reach", () => {
    const at = toTangent(PLAY_SPAWN.s, PLAY_SPAWN.d);
    const nearest = Math.min(...MEMBERS.map((m) => Math.hypot(at.x - toTangent(m.s, m.d).x, at.z - toTangent(m.s, m.d).z)));
    // Pip's idle and run members, the nearest, stand 3.7 m away: room for their reach and his.
    expect(nearest).toBeGreaterThan(3 + PLAY_BODY_RADIUS);
    // In front of Pip's row (the cameras' side), between his idle and run, wherever the row stands.
    const idle = MEMBERS.find((m) => m.name === 'pip_idle')!;
    const run = MEMBERS.find((m) => m.name === 'pip_run')!;
    expect(PLAY_SPAWN.s).toBeGreaterThan(idle.s);
    expect(PLAY_SPAWN.s).toBeLessThan(run.s);
    expect(PLAY_SPAWN.d).toBeLessThan(idle.d);
    // Clear of every reach a member could have: a 3 m reach round each root, wider than any shipped member's plus his
    // body (the browser test reads his clearance against the real bounds). Inside one, the margin is negative.
    const generous = MEMBERS.map((m) => ({ ...toTangent(m.s, m.d), radius: 3 }));
    expect(clearance(at.x, at.z, generous)).toBeGreaterThan(0);
    expect(clearance(toTangent(idle.s, idle.d).x, toTangent(idle.s, idle.d).z, generous)).toBeLessThan(0);
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

describe('camera-relative steering on the curve', () => {
  const DEG = Math.PI / 180;
  const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const unit = (a: Vec3): Vec3 => {
    const length = Math.hypot(a.x, a.y, a.z);
    return { x: a.x / length, y: a.y / length, z: a.z / length };
  };
  /** His up at a tangent point: straight out from the planet's centre, which lies R under the pole. */
  const upAt = (x: number, z: number): Vec3 => unit({ x, y: R, z });
  /** The play area's edge in each of 12 bearings, where his up leans furthest from world y: atan(23 / 160), 8.2 degrees. */
  const edge = Array.from({ length: 12 }, (_, i) => upAt(PLAY_AREA_RADIUS * Math.sin(i * 30 * DEG), PLAY_AREA_RADIUS * Math.cos(i * 30 * DEG)));
  /** An OrbitControls camera about world y at a polar angle (0 straight overhead) and an azimuth: its view ray, its level right and the screen's up. */
  function cameraAt(polarDeg: number, azimuthDeg = 0): { view: Vec3; right: Vec3; screenUp: Vec3 } {
    const p = polarDeg * DEG;
    const t = azimuthDeg * DEG;
    const view = { x: -Math.sin(p) * Math.sin(t), y: -Math.cos(p), z: -Math.sin(p) * Math.cos(t) };
    const right = { x: Math.cos(t), y: 0, z: -Math.sin(t) };
    return { view, right, screenUp: cross(right, view) };
  }
  /** The steering this replaced: the view ray projected onto his ground. */
  const viewRayOnGround = (up: Vec3, view: Vec3): Vec3 => {
    const k = dot(view, up);
    return unit({ x: view.x - k * up.x, y: view.y - k * up.y, z: view.z - k * up.z });
  };
  /** How far a ground direction runs off "up the screen", in degrees, positive to the right. */
  const offScreenUp = (f: Vec3, camera: ReturnType<typeof cameraAt>): number => Math.atan2(dot(f, camera.right), dot(f, camera.screenUp)) / DEG;

  it('matches the view ray on the ground at the play camera pitch, within 3 degrees at the area edge', () => {
    // The follow camera opens 16 degrees above his horizon (PLAY_CAMERA_PITCH_DEG), a polar angle of 74 degrees; the two
    // agree exactly for a lean along the view, part by atan(sin 8.2 / tan 74), 2.34 degrees, for a lean straight across
    // it, and by 2.58 degrees at the widest of these bearings, a lean across and a third toward the camera.
    let widest = 0;
    for (let azimuth = 0; azimuth < 360; azimuth += 45) {
      const camera = cameraAt(74, azimuth);
      for (const up of edge) {
        const ahead = groundForward(up, camera.right)!;
        expect(Math.hypot(ahead.x, ahead.y, ahead.z)).toBeCloseTo(1, 12);
        expect(dot(ahead, up)).toBeCloseTo(0, 12);
        widest = Math.max(widest, Math.acos(Math.min(1, dot(ahead, viewRayOnGround(up, camera.view)))) / DEG);
      }
    }
    expect(widest).toBeCloseTo(2.58, 2);
    expect(widest).toBeLessThan(3);
  });

  it('keeps W up the screen with the camera high or straight overhead at the area edge, where the view ray turned it', () => {
    // Straight overhead, his up leaning toward the foot of the screen (the pole lies up the screen from him): the view ray
    // on his ground points down the screen, toward the camera, and a lean to the side turns it a quarter turn.
    const overhead = cameraAt(0);
    const towardFoot = upAt(0, PLAY_AREA_RADIUS);
    expect(Math.abs(offScreenUp(viewRayOnGround(towardFoot, overhead.view), overhead))).toBeCloseTo(180, 9);
    expect(offScreenUp(viewRayOnGround(upAt(PLAY_AREA_RADIUS, 0), overhead.view), overhead)).toBeCloseTo(90, 9);
    const ahead = groundForward(towardFoot, overhead.right)!;
    expect(dot(ahead, overhead.screenUp)).toBeGreaterThan(0.98);
    expect(Math.abs(offScreenUp(ahead, overhead))).toBeLessThan(1e-9);

    // At a 20 degree polar angle with his up leaning across the view, the view ray ran atan(tan 8.2 / sin 20), 22.80
    // degrees, off up the screen, where the new forward runs 0 off it.
    const high = cameraAt(20);
    const acrossHigh = upAt(PLAY_AREA_RADIUS, 0);
    expect(offScreenUp(viewRayOnGround(acrossHigh, high.view), high)).toBeCloseTo(22.8, 2);
    expect(Math.abs(offScreenUp(groundForward(acrossHigh, high.right)!, high))).toBeLessThan(1e-9);

    // Every edge bearing and azimuth, from overhead to the orbit's lowest (PLAY_CAMERA_MAX_POLAR_DEG): no sideways drift
    // at all, and always along the camera's level forward, which is up the screen overhead. At the lowest orbit with his
    // up leaning away the camera sits 2 degrees under his horizon, where up the screen means little, so that is the test.
    for (let polar = 0; polar <= 84; polar += 6) {
      for (let azimuth = 0; azimuth < 360; azimuth += 30) {
        const camera = cameraAt(polar, azimuth);
        const levelForward = cross({ x: 0, y: 1, z: 0 }, camera.right);
        for (const up of edge) {
          const f = groundForward(up, camera.right)!;
          expect(Math.abs(dot(f, camera.right))).toBeLessThan(1e-12);
          expect(dot(f, levelForward)).toBeGreaterThan(0.98);
        }
      }
    }
  });

  it('never returns NaN, and gives null for degenerate input', () => {
    expect(groundForward({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 })).toBeNull();
    expect(groundForward({ x: 0, y: 1, z: 0 }, { x: 0, y: -2, z: 0 })).toBeNull();
    expect(groundForward({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeNull();
    expect(groundForward({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 })).toBeNull();
    expect(groundForward({ x: 0, y: 1, z: 0 }, { x: 1e-12, y: 0, z: 0 })).toBeNull();
    // Unnormalised input still gives a unit vector, and a near-parallel pair a finite one.
    for (const [up, right] of [
      [{ x: 0, y: 5, z: 0 }, { x: 3, y: 0, z: 0 }],
      [{ x: 0, y: 1, z: 0 }, { x: 1e-6, y: 1, z: 0 }],
      [upAt(-17, 9), { x: 0.6, y: 0, z: -0.8 }],
    ] as [Vec3, Vec3][]) {
      const f = groundForward(up, right)!;
      expect([f.x, f.y, f.z].every(Number.isFinite)).toBe(true);
      expect(Math.hypot(f.x, f.y, f.z)).toBeCloseTo(1, 12);
    }
  });
});

describe('the play prototype attack', () => {
  // Pip's exported clip: 0.85 s by contract (timings.json), 25 frames at 30 fps as the export writes it.
  const DURATION = 25 / 30;
  const STRIKE = 0.34;

  /** Frames of the page's loop with the swing in it: a trigger on the first frame, the move input held throughout. */
  function swing(state: MotionState, input: typeof forward, camera: [number, number], seconds: number, triggerAt = 0) {
    let motion = state;
    let attack: AttackState = NOT_SWINGING;
    let strikes = 0;
    const frames: { motion: MotionState; attack: AttackState; weight: number }[] = [];
    for (let frame = 0; frame * DT < seconds; frame++) {
      if (frame === triggerAt) attack = triggerAttack(attack);
      const moveScale = attack.time !== null ? PLAY_ATTACK_MOVE_SCALE : 1;
      motion = stepMotion(motion, moveDirection(input, camera[0], camera[1]), input.sprint, DT, [], R, moveScale);
      const stepped = stepAttack(attack, DT, DURATION, STRIKE);
      attack = stepped.state;
      if (stepped.struck) strikes += 1;
      frames.push({ motion, attack, weight: attackWeight(attack.time, DURATION) });
    }
    return { frames, strikes, motion, attack };
  }

  it('plays the clip once per trigger, crossing the strike moment once, and ignores a trigger mid-swing', () => {
    expect(triggerAttack(NOT_SWINGING)).toEqual({ time: 0 });
    // Mid-swing a trigger is ignored, not buffered: the swing carries on from where it was.
    expect(triggerAttack({ time: 0.2 })).toEqual({ time: 0.2 });
    const struck: number[] = [];
    let attack = triggerAttack(NOT_SWINGING);
    let frames = 0;
    while (attack.time !== null) {
      const before = attack.time;
      const stepped = stepAttack(attack, DT, DURATION, STRIKE);
      if (stepped.struck) struck.push(before);
      attack = frames === 10 ? triggerAttack(stepped.state) : stepped.state;
      frames += 1;
    }
    // The swing lasts the clip, to the frame, and the strike lands on the frame that reaches 0.34 s.
    expect(frames).toBe(Math.ceil(DURATION / DT - 1e-9));
    expect(struck).toHaveLength(1);
    expect(struck[0]!).toBeLessThan(STRIKE);
    expect(struck[0]! + DT).toBeGreaterThanOrEqual(STRIKE);
    // A frozen frame (dt 0) holds the swing where it is.
    expect(stepAttack({ time: 0.3 }, 0, DURATION, STRIKE)).toEqual({ state: { time: 0.3 }, struck: false });
  });

  it('fades the clip in over the idle or run, holds it through the strike, and hands back to them by its end', () => {
    expect(attackWeight(null, DURATION)).toBe(0);
    expect(attackWeight(0, DURATION)).toBe(0);
    expect(attackWeight(PLAY_ATTACK_FADE_IN / 2, DURATION)).toBeCloseTo(0.5, 9);
    for (const t of [PLAY_ATTACK_FADE_IN, STRIKE, DURATION - PLAY_ATTACK_FADE_OUT]) expect(attackWeight(t, DURATION), `${t} s`).toBeCloseTo(1, 9);
    expect(attackWeight(DURATION - PLAY_ATTACK_FADE_OUT / 2, DURATION)).toBeCloseTo(0.5, 9);
    expect(attackWeight(DURATION, DURATION)).toBe(0);
    // The fade in is over well before the strike, so the wind-up reads at full weight.
    expect(PLAY_ATTACK_FADE_IN).toBeLessThan(STRIKE / 3);
  });

  it('stops him through the swing without turning him, then lets him run again the way the key asks', () => {
    // Sprinting along +z, he is asked to keep going toward +x as the swing starts.
    const sprint = { right: 0, forward: 1, sprint: true };
    const running = run({ x: 0, z: 0, yaw: 0, speed: 0, drive: 0 }, sprint, [0, 1], 1.5);
    expect(running.speed).toBeCloseTo(PLAY_SPRINT_SPEED, 9);
    const { frames, strikes, attack } = swing(running, sprint, [1, 0], DURATION + 1);
    const during = frames.filter((frame) => frame.attack.time !== null);
    expect(during.length).toBeGreaterThan(0);
    // His facing holds through the whole swing, though the key asks for a quarter turn.
    for (const frame of during) expect(frame.motion.yaw).toBe(running.yaw);
    // He sheds the sprint at the stop rate (5.6 m/s in 0.21 s), and stands still from then until the swing ends.
    const stopAfter = (PLAY_SPRINT_SPEED / PLAY_WALK_SPEED) * PLAY_SECONDS_TO_STOP;
    const still = during.filter((_, index) => (index + 1) * DT > stopAfter + DT);
    expect(still.length).toBeGreaterThan(during.length / 2);
    for (const frame of still) expect(frame.motion.speed).toBe(0);
    // He is not moved while still: his position holds from the stop to the end of the swing.
    expect(Math.hypot(still.at(-1)!.motion.x - still[0]!.motion.x, still.at(-1)!.motion.z - still[0]!.motion.z)).toBe(0);
    expect(strikes).toBe(1);
    // Out of the swing he turns toward the key and runs again, and the clip has handed back completely.
    expect(attack).toEqual(NOT_SWINGING);
    const after = frames.at(-1)!;
    expect(after.weight).toBe(0);
    expect(wrapAngle(after.motion.yaw - yawOf(1, 0))).toBeCloseTo(0, 6);
    expect(after.motion.speed).toBeCloseTo(PLAY_SPRINT_SPEED, 6);
    // Standing still with no key held, the swing ends where it began, and he stays put.
    const standing = swing({ x: 1, z: 2, yaw: 0.3, speed: 0, drive: 0 }, { right: 0, forward: 0, sprint: false }, [0, 1], DURATION + 0.5);
    expect(standing.motion).toEqual({ x: 1, z: 2, yaw: 0.3, speed: 0, drive: 0 });
    expect(PLAY_ATTACK_MOVE_SCALE).toBe(0);
  });

  it('tells a click from an orbit drag by how far the press moved and how soon it lifted', () => {
    expect(isAttackClick(0, 0.1)).toBe(true);
    expect(isAttackClick(PLAY_CLICK_SLOP_PX - 0.5, PLAY_CLICK_MAX_SECONDS - 0.01)).toBe(true);
    // A drag that went a few pixels, or a press held while the camera was being lined up, is the orbit's.
    expect(isAttackClick(PLAY_CLICK_SLOP_PX, 0.1)).toBe(false);
    expect(isAttackClick(40, 0.1)).toBe(false);
    expect(isAttackClick(0, PLAY_CLICK_MAX_SECONDS)).toBe(false);
    expect(isAttackClick(0, -0.01)).toBe(false);
  });
});
