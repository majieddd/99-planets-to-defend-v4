import { BoxGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  BLINK_CLOSE_SECONDS,
  BLINK_INTERVAL_MAX_SECONDS,
  BLINK_INTERVAL_MIN_SECONDS,
  BLINK_OPEN_SECONDS,
  DOUBLE_BLINK_CHANCE,
  DOUBLE_BLINK_GAP_SECONDS,
  FaceDriver,
  JAW_OPEN_MAX_DEG,
  seededFaceRandom,
} from '../../../src/labs/shared/faceDriver';
import { DEFAULT_DIALS } from '../../../src/render/defaults';
import { attachHull, createHullMaterial, createInkUniforms } from '../../../src/render/ink/hull';

const MORPHS = ['blink_L', 'blink_R', 'smile', 'brows_up', 'pucker'];
const FRAME = 1 / 60;

// A head with the commander's five face morphs, which three names from the morph attributes (Mesh.updateMorphTargets).
function head(): Mesh {
  const geometry = new BoxGeometry(0.2, 0.24, 0.2);
  const count = geometry.getAttribute('position').count;
  geometry.morphAttributes['position'] = MORPHS.map((name) => {
    const attribute = new Float32BufferAttribute(new Float32Array(count * 3), 3);
    attribute.name = name;
    return attribute;
  });
  geometry.morphTargetsRelative = true;
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  mesh.name = 'commander_body';
  return mesh;
}

// Draws that come back in the order given, then 0.5 forever: fake timing, so every blink's start is known.
function draws(...values: number[]): () => number {
  return () => values.shift() ?? 0.5;
}

const weight = (mesh: Mesh, name: string): number => (mesh.morphTargetInfluences as number[])[mesh.morphTargetDictionary![name]!]!;

/** Steps the driver frame by frame and records the lid closure at every frame's end. */
function run(driver: FaceDriver, seconds: number, step = FRAME): number[] {
  const out: number[] = [];
  for (let t = 0; t < seconds - 1e-9; t += step) {
    driver.update(step);
    out.push(driver.blink);
  }
  return out;
}

describe('the face driver', () => {
  it('blinks both lids together, closing in 60 ms and opening in 90 ms, after a wait drawn from 2.5 to 5 s', () => {
    const body = head();
    const root = new Group().add(body);
    // The first draw sets the first wait: 0 is the shortest, 2.5 s. The second decides a double blink: 0.9 is none.
    const driver = new FaceDriver(root, { random: draws(0, 0.9) });
    expect(driver.hasFace).toBe(true);
    driver.update(2.5 - 1e-6);
    expect(driver.blink).toBe(0);
    driver.update(1e-6 + BLINK_CLOSE_SECONDS / 2);
    expect(driver.blink).toBeCloseTo(0.5, 6);
    expect(weight(body, 'blink_L')).toBe(driver.blink);
    expect(weight(body, 'blink_R')).toBe(driver.blink);
    driver.update(BLINK_CLOSE_SECONDS / 2);
    expect(driver.blink).toBeCloseTo(1, 6);
    driver.update(BLINK_OPEN_SECONDS / 2);
    expect(driver.blink).toBeCloseTo(0.5, 6);
    driver.update(BLINK_OPEN_SECONDS / 2 + 1e-6);
    expect(driver.blink).toBe(0);
    expect(BLINK_CLOSE_SECONDS + BLINK_OPEN_SECONDS).toBeGreaterThanOrEqual(0.12);
    expect(BLINK_CLOSE_SECONDS + BLINK_OPEN_SECONDS).toBeLessThanOrEqual(0.18);
    // The next wait is the next draw, 0.5 of the range: 3.75 s, with the lids open all the while.
    driver.update(3.75 - 0.01);
    expect(driver.blink).toBe(0);
    driver.update(0.02);
    expect(driver.blink).toBeGreaterThan(0);
  });

  it('blinks twice, 100 ms apart, when the double-blink draw lands under its chance, and never three times', () => {
    const driver = new FaceDriver(new Group().add(head()), { random: draws(0, DOUBLE_BLINK_CHANCE / 2, 0.99) });
    const blink = BLINK_CLOSE_SECONDS + BLINK_OPEN_SECONDS;
    const step = 0.001;
    const trace = run(driver, 2.5 + 2 * blink + DOUBLE_BLINK_GAP_SECONDS + 1, step);
    // Count the times the lids start to close.
    const starts = trace.filter((value, i) => value > 0 && (trace[i - 1] ?? 0) === 0).length;
    expect(starts).toBe(2);
    // The lids are open through the gap, from the first blink's end to the second's start.
    const first = trace.findIndex((value) => value > 0);
    const reopen = trace.findIndex((value, i) => i > first && value === 0);
    const second = trace.findIndex((value, i) => i > reopen && value > 0);
    expect((second - reopen) * step).toBeCloseTo(DOUBLE_BLINK_GAP_SECONDS, 2);
  });

  it('keeps every seeded wait inside 2.5 to 5 s at 60 fps and at the labs\' slowest step of 1/20 s', () => {
    for (const step of [FRAME, 1 / 20]) {
      const driver = new FaceDriver(new Group().add(head()), { random: seededFaceRandom(7) });
      const trace = run(driver, 600, step);
      const starts: number[] = [];
      trace.forEach((value, i) => {
        if (value > 0 && (trace[i - 1] ?? 0) === 0) starts.push(i * step);
      });
      expect(starts.length).toBeGreaterThan(100);
      // A pair of blinks starts 0.25 s apart; every other gap between starts is a drawn wait plus one blink, give or take
      // a frame at the coarser rates.
      const blink = BLINK_CLOSE_SECONDS + BLINK_OPEN_SECONDS;
      for (let i = 1; i < starts.length; i++) {
        const gap = starts[i]! - starts[i - 1]!;
        if (gap < 1) continue;
        expect(gap).toBeGreaterThanOrEqual(BLINK_INTERVAL_MIN_SECONDS + blink - step - 1e-9);
        expect(gap).toBeLessThanOrEqual(BLINK_INTERVAL_MAX_SECONDS + blink + step + 1e-9);
      }
    }
  });

  it('runs a long delta through every phase it spans, so one big step and many small ones agree', () => {
    const a = new FaceDriver(new Group().add(head()), { random: seededFaceRandom(3) });
    const b = new FaceDriver(new Group().add(head()), { random: seededFaceRandom(3) });
    for (let i = 0; i < 1000; i++) a.update(0.01);
    b.update(10);
    expect(b.blink).toBeCloseTo(a.blink, 9);
  });

  it('holds smile, brows up and pucker at their set weights through blinks, clamped to 0 to 1', () => {
    const body = head();
    const driver = new FaceDriver(new Group().add(body), { random: draws(0, 0.9) });
    driver.setExpression('smile', 0.7);
    driver.setExpression('brows_up', 1.4);
    driver.setExpression('pucker', -0.2);
    expect([weight(body, 'smile'), weight(body, 'brows_up'), weight(body, 'pucker')]).toEqual([0.7, 1, 0]);
    run(driver, 2.5 + BLINK_CLOSE_SECONDS);
    expect(driver.blink).toBeGreaterThan(0.9);
    expect([weight(body, 'smile'), weight(body, 'brows_up'), weight(body, 'pucker')]).toEqual([0.7, 1, 0]);
  });

  it('opens the jaw bone about its axis by up to 14 degrees, from its rest pose', () => {
    const root = new Group().add(head());
    const jaw = new Object3D();
    jaw.name = 'jaw';
    jaw.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.3);
    root.add(jaw);
    const rest = jaw.quaternion.clone();
    const driver = new FaceDriver(root, { random: draws(), jawAxis: new Vector3(1, 0, 0) });
    driver.setJaw(1);
    const turn = rest.clone().invert().multiply(jaw.quaternion);
    expect((2 * Math.acos(Math.min(1, turn.w)) * 180) / Math.PI).toBeCloseTo(JAW_OPEN_MAX_DEG, 6);
    expect(turn.x).toBeGreaterThan(0);
    driver.setJaw(0);
    expect(jaw.quaternion.angleTo(rest)).toBeCloseTo(0, 6);
    // Without a jaw bone or any face morph there is nothing to move, and the driver says so.
    expect(new FaceDriver(new Group(), { random: draws() }).hasFace).toBe(false);
  });

  it('holds the face while frozen, mid-blink included, and carries on where it stopped', () => {
    const body = head();
    const driver = new FaceDriver(new Group().add(body), { random: draws(0, 0.9) });
    driver.update(2.5 + BLINK_CLOSE_SECONDS / 2);
    const held = driver.blink;
    expect(held).toBeCloseTo(0.5, 6);
    driver.setFrozen(true);
    for (let i = 0; i < 100; i++) driver.update(FRAME);
    expect(driver.blink).toBe(held);
    expect(weight(body, 'blink_L')).toBe(held);
    // The labs freeze by passing 0, which holds it too.
    driver.setFrozen(false);
    driver.update(0);
    expect(driver.blink).toBe(held);
    driver.update(BLINK_CLOSE_SECONDS / 2);
    expect(driver.blink).toBeCloseTo(1, 6);
  });

  it('moves the ink with the lid, because the hull shares the body\'s influences', () => {
    const body = head();
    body.geometry.setAttribute('inkWidth', new Float32BufferAttribute(new Array(body.geometry.getAttribute('position').count).fill(0.5), 1));
    const hull = attachHull(body, createHullMaterial(createInkUniforms(DEFAULT_DIALS)), 1) as Mesh;
    const driver = new FaceDriver(new Group().add(body), { random: draws(0, 0.9) });
    driver.update(2.5 + BLINK_CLOSE_SECONDS);
    expect(hull.morphTargetInfluences).toBe(body.morphTargetInfluences);
    expect(weight(hull, 'blink_L')).toBeCloseTo(1, 6);
  });
});
