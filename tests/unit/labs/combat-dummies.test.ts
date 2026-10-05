import { AnimationClip, CylinderGeometry, Group, Mesh, MeshBasicMaterial, Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { arenaSpawn, ARENA_DUMMY_NAMES, dummyHomes } from '../../../src/labs/combat/arena';
import { createTrainingDummies, type TrainingDummies } from '../../../src/labs/combat/dummies';
import { PLAY_AREA_RADIUS, PLAY_BODY_RADIUS } from '../../../src/labs/world/playMotion';
import type { Ground } from '../../../src/render/terrain/place';

/**
 * A stand-in Husk: one round column 2.4 m across, rooted at its base, so each dummy's reach reads 1.2 m from its drawn
 * bounds however it is turned (a square box's bounds, square to the world's axes, grew as each dummy turned to face Pip),
 * with an idle of no tracks; the ground is level at 0, its up straight up. The dummies need nothing else to stand, move
 * and be pushed.
 */
function standIn(): { asset: { root: Group; animations: AnimationClip[] }; ground: Ground } {
  const root = new Group();
  const body = new Mesh(new CylinderGeometry(1.2, 1.2, 1, 64), new MeshBasicMaterial());
  body.position.y = 0.5;
  root.add(body);
  const up = new Vector3(0, 1, 0);
  const ground = { surfaceAt: (x: number, z: number) => ({ position: new Vector3(x, 0, z), up, normal: up }) } as unknown as Ground;
  return { asset: { root, animations: [new AnimationClip('idle', 2, [])] }, ground };
}

function arena(pip: { x: number; z: number } | null = arenaSpawn()): TrainingDummies {
  const { asset, ground } = standIn();
  return createTrainingDummies(asset, ground, new Object3D(), {}, dummyHomes(), ARENA_DUMMY_NAMES, () => pip)!;
}

const apart = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe("the training dummies' knockback seam", () => {
  it('reads each reach from the drawn bounds and keeps one obstacle list that follows every move', () => {
    const dummies = arena();
    for (const dummy of dummies.list) expect(dummy.reach).toBeCloseTo(1.2, 2);
    const list = dummies.obstacles();
    expect(list.map((obstacle) => obstacle.radius)).toEqual(dummies.list.map((dummy) => dummy.reach + PLAY_BODY_RADIUS));
    const pushed = dummies.push(1, 0.3, 0);
    // The same list, moved with the dummy, so Pip reads it every frame with nothing built for him.
    expect(dummies.obstacles()).toBe(list);
    expect([list[1]!.x, list[1]!.z]).toEqual([pushed.x, pushed.z]);
    // Each dummy has a mixer of its own, which phase B's flinch plays on.
    expect(new Set(dummies.list.map((dummy) => dummy.mixer)).size).toBe(3);
  });

  it("stops a knocked-back dummy at Pip's body, at its neighbour's and inside his play area", () => {
    const pip = arenaSpawn();
    const dummies = arena(pip);
    const [left, middle, right] = dummies.list;
    // The middle dummy driven 2 m straight at Pip, 3 m off, stands off him by its reach and his body, as he walks round it.
    const towardPip = { x: pip.x - middle!.home.x, z: pip.z - middle!.home.z };
    const length = Math.hypot(towardPip.x, towardPip.z);
    const atPip = dummies.push(1, (towardPip.x / length) * 2, (towardPip.z / length) * 2);
    expect(apart(atPip, pip)).toBeCloseTo(middle!.reach + PLAY_BODY_RADIUS, 9);
    // Its yaw is kept: a knockback moves a dummy and does not turn it.
    expect(atPip.yaw).toBe(middle!.home.yaw);
    // The left dummy driven at the middle one, now by Pip, stops body to body, both reaches apart.
    const toMiddle = { x: atPip.x - left!.home.x, z: atPip.z - left!.home.z };
    const far = Math.hypot(toMiddle.x, toMiddle.z);
    const atMiddle = dummies.push(0, (toMiddle.x / far) * 4, (toMiddle.z / far) * 4);
    expect(apart(atMiddle, atPip)).toBeGreaterThanOrEqual(left!.reach + middle!.reach - 1e-9);
    // The right dummy driven 40 m out stops on the play area's edge.
    const out = dummies.push(2, right!.home.x * 20, right!.home.z * 20);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(PLAY_AREA_RADIUS, 9);
    // With Pip not out, nothing of his stops it.
    const alone = arena(null);
    const free = alone.push(1, (towardPip.x / length) * 1.2, (towardPip.z / length) * 1.2);
    expect(apart(free, middle!.home)).toBeCloseTo(1.2, 9);
  });

  it('sweeps a knockback in steps, so a dummy touching Pip and driven 3 m straight at him stays on its own side', () => {
    const pip = arenaSpawn();
    const dummies = arena(pip);
    const middle = dummies.list[1]!;
    const contact = middle.reach + PLAY_BODY_RADIUS;
    // Stood touching him on the line from his spawn to its home, then driven 3 m straight at him.
    const toward = { x: pip.x - middle.home.x, z: pip.z - middle.home.z };
    const length = Math.hypot(toward.x, toward.z);
    const unit = { x: toward.x / length, z: toward.z / length };
    middle.moveTo({ x: pip.x - unit.x * contact, z: pip.z - unit.z * contact, yaw: middle.home.yaw });
    const pushed = dummies.push(1, unit.x * 3, unit.z * 3);
    // Met only where the push ended, it came out 1.45 m past him, on his far side (dot product with the push above 0).
    const side = (pushed.x - pip.x) * unit.x + (pushed.z - pip.z) * unit.z;
    expect(side).toBeLessThan(0);
    expect(apart(pushed, pip)).toBeCloseTo(contact, 9);
    // Pushed out toward the play area's edge, it stops on the edge.
    const right = dummies.list[2]!;
    const outward = Math.hypot(right.home.x, right.home.z);
    const out = dummies.push(2, (right.home.x / outward) * 30, (right.home.z / outward) * 30);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(PLAY_AREA_RADIUS, 9);
    // The obstacle list Pip reads is still the one it was, moved with the dummies.
    expect(dummies.obstacles()[1]!.x).toBe(pushed.x);
  });

  it('tells its reset listeners once every dummy is home, and lets a hit listener go', () => {
    const dummies = arena();
    const heard: string[] = [];
    const stopHit = dummies.onHit((dummy) => heard.push(`hit ${dummy.name}`));
    const stopReset = dummies.onReset(() => heard.push(`reset, the middle one ${dummies.list[1]!.pose().x === dummies.list[1]!.home.x ? 'home' : 'away'}`));
    dummies.push(1, 0.5, 0.5);
    dummies.list[1]!.hit({ step: 1, time: 0.2, from: { x: 0, z: 0 } });
    dummies.reset();
    expect(heard).toEqual(['hit dummy_middle', 'reset, the middle one home']);
    expect(dummies.list.every((dummy) => dummy.hits === 0 && apart(dummy.pose(), dummy.home) === 0)).toBe(true);
    // Unsubscribed, neither hears again.
    stopHit();
    stopReset();
    dummies.list[0]!.hit({ step: 2, time: 0.2, from: { x: 0, z: 0 } });
    dummies.reset();
    expect(heard).toHaveLength(2);
    expect(dummies.list[0]!.hits).toBe(0);
  });
});
