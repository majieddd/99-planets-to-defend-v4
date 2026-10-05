import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARENA_CAMERA_PITCH_DEG,
  ARENA_DUMMY_DISTANCE,
  ARENA_DUMMY_NAMES,
  ARENA_DUMMY_SPACING,
  ARENA_SPAWN,
  arenaCameraBearing,
  arenaCameraDistance,
  arenaFacing,
  arenaSpawn,
  dummyFrame,
  dummyHomes,
  dummyStepAngle,
  fromBody,
  type ArenaLens,
} from '../../../src/labs/combat/arena';
import { PLAY_CAMERA_DISTANCE, PLAY_CAMERA_MAX_DISTANCE } from '../../../src/labs/world/play';
import { PLAY_AREA_RADIUS, PLAY_BODY_RADIUS, yawOf } from '../../../src/labs/world/playMotion';
import { TOWARD_CAMERAS } from '../../../src/labs/world/registry';
import { FIT_NDC } from '../../../src/labs/world/views';

const DEG = 180 / Math.PI;
/**
 * A Husk dummy's reach about its root, as the page reads it from the drawn bounds: its legs spread wide, and the bounds
 * are square to the world's axes, so 1.17 to 1.22 m on the GPU for the three dummies' turns. The layout checks below
 * take 1.2 m, and a body's half that, 0.6 m, for how far a blade must reach to touch it.
 */
const MEASURED_HUSK_REACH = 1.2;
const HUSK_REACH = MEASURED_HUSK_REACH / 2;
/** How far in front of his root Pip's blade tip reaches at the strike, from his build's own measure (Blender's -y is ahead). */
const tip = (JSON.parse(readFileSync('public/assets/commanders/commander_pip.meta.json', 'utf8')) as { notes: { attack_checks: { strike_blade_tip: { x: number; y: number } } } }).notes.attack_checks
  .strike_blade_tip;
const BLADE_REACH = Math.hypot(tip.x, tip.y);

describe('the combat arena layout', () => {
  it('spawns Pip facing away from the world cameras, so the camera behind him looks as theirs do', () => {
    const spawn = arenaSpawn();
    const facing = arenaFacing();
    expect(Math.hypot(facing.x, facing.z)).toBeCloseTo(1, 12);
    expect(facing.x * TOWARD_CAMERAS.x + facing.z * TOWARD_CAMERAS.z).toBeCloseTo(-1, 12);
    expect(spawn.yaw).toBeCloseTo(yawOf(facing.x, facing.z), 12);
    // A glTF body faces (sin yaw, cos yaw).
    expect(Math.sin(spawn.yaw)).toBeCloseTo(facing.x, 12);
    expect(Math.cos(spawn.yaw)).toBeCloseTo(facing.z, 12);
    // On the level ground near the pole: the patch's relief begins 6 m out.
    expect(Math.hypot(spawn.x, spawn.z)).toBeCloseTo(Math.abs(ARENA_SPAWN.d), 12);
  });

  it('stands three dummies on an arc 3 m ahead of him, 2.8 m apart, the middle one dead ahead, each facing him', () => {
    const spawn = arenaSpawn();
    const homes = dummyHomes();
    expect(homes).toHaveLength(ARENA_DUMMY_NAMES.length);
    for (const home of homes) {
      expect(Math.hypot(home.x - spawn.x, home.z - spawn.z)).toBeCloseTo(ARENA_DUMMY_DISTANCE, 12);
      // Each faces the spawn: Pip stands dead ahead of it.
      expect(fromBody(home.x, home.z, home.yaw, spawn.x, spawn.z).angleDeg).toBeCloseTo(0, 9);
      // All of them on the level ground about the pole, and far inside his area.
      expect(Math.hypot(home.x, home.z)).toBeLessThan(6);
      expect(Math.hypot(home.x, home.z)).toBeLessThan(PLAY_AREA_RADIUS);
    }
    for (let i = 1; i < homes.length; i++) expect(Math.hypot(homes[i]!.x - homes[i - 1]!.x, homes[i]!.z - homes[i - 1]!.z)).toBeCloseTo(ARENA_DUMMY_SPACING, 12);
    // From the spawn the middle one stands dead ahead and the others 55.6 degrees to either side, left then right.
    const seen = homes.map((home) => fromBody(spawn.x, spawn.z, spawn.yaw, home.x, home.z));
    expect(seen[1]!.angleDeg).toBeCloseTo(0, 9);
    expect(dummyStepAngle() * DEG).toBeCloseTo(55.64, 2);
    expect(seen[0]!.angleDeg).toBeCloseTo(-dummyStepAngle() * DEG, 9);
    expect(seen[2]!.angleDeg).toBeCloseTo(dummyStepAngle() * DEG, 9);
    const frame = dummyFrame(homes);
    expect(frame[0]!.lateral).toBeLessThan(0);
    expect(frame[2]!.lateral).toBeGreaterThan(0);
    expect(frame[1]).toEqual({ lateral: expect.closeTo(0, 9), ahead: expect.closeTo(ARENA_DUMMY_DISTANCE, 9) });
    // Walked straight at the middle one, he stops at its reach and his body's, where his blade's reach at the strike
    // (Pip's sidecar, strike_blade_tip) touches its body; from there a step of under a metre brings the next one within
    // that reach of its body, and no swing from there reaches it unstepped.
    const stand = { lateral: 0, ahead: ARENA_DUMMY_DISTANCE - MEASURED_HUSK_REACH - PLAY_BODY_RADIUS };
    expect(ARENA_DUMMY_DISTANCE - stand.ahead - HUSK_REACH).toBeLessThan(BLADE_REACH);
    const next = Math.hypot(frame[2]!.lateral - stand.lateral, frame[2]!.ahead - stand.ahead);
    expect(next - (BLADE_REACH + HUSK_REACH)).toBeGreaterThan(0);
    expect(next - (BLADE_REACH + HUSK_REACH)).toBeLessThan(1);
  });

  it('reads where a point stands from a body, its bearing positive to the body\'s right', () => {
    // Facing +z (yaw 0), +x is to his left as a camera behind him sees it, and -x to his right.
    expect(fromBody(0, 0, 0, 0, 2)).toEqual({ distance: 2, angleDeg: 0 });
    expect(fromBody(0, 0, 0, -1, 0).angleDeg).toBeCloseTo(90, 12);
    expect(fromBody(0, 0, 0, 1, 0).angleDeg).toBeCloseTo(-90, 12);
    expect(Math.abs(fromBody(0, 0, 0, 0, -3).angleDeg)).toBeCloseTo(180, 12);
  });

  it('opens the camera straight behind him, far enough back to keep all three dummies across the frame', () => {
    const spawn = arenaSpawn();
    const bearing = arenaCameraBearing();
    expect(Math.abs(fromBody(spawn.x, spawn.z, spawn.yaw, spawn.x + bearing.x, spawn.z + bearing.z).angleDeg)).toBeCloseTo(180, 9);
    // Over his head at that pitch the view meets the middle dummy under half a metre up, where at the world's 16 degrees
    // it met it 1.3 m up, over a Husk's back: his chest 1.1 m up, his head 1.78 m, the camera 5.5 m from his chest.
    const overHead = (pitchDeg: number): number => {
      const pitch = (pitchDeg * Math.PI) / 180;
      const up = 1.1 + PLAY_CAMERA_DISTANCE * Math.sin(pitch);
      const back = PLAY_CAMERA_DISTANCE * Math.cos(pitch);
      return 1.78 - ((up - 1.78) / back) * ARENA_DUMMY_DISTANCE;
    };
    expect(overHead(ARENA_CAMERA_PITCH_DEG)).toBeCloseTo(0.48, 2);
    expect(overHead(16)).toBeCloseTo(1.31, 2);
    const lens = (aspect: number): ArenaLens => ({
      fovDeg: 50,
      aspect,
      pitchDeg: ARENA_CAMERA_PITCH_DEG,
      minDistance: PLAY_CAMERA_DISTANCE,
      maxDistance: PLAY_CAMERA_MAX_DISTANCE,
      fit: FIT_NDC,
    });
    const dummies = dummyFrame(dummyHomes()).map((at) => ({ ...at, reach: MEASURED_HUSK_REACH }));
    // A wide screen, or a phone on its side, keeps the play camera's own distance; a square screen opens further back;
    // a phone held upright, as far as the wheel's greatest distance.
    expect(arenaCameraDistance(dummies, lens(16 / 9))).toBe(PLAY_CAMERA_DISTANCE);
    expect(arenaCameraDistance(dummies, lens(844 / 390))).toBe(PLAY_CAMERA_DISTANCE);
    const square = arenaCameraDistance(dummies, lens(1));
    expect(square).toBeGreaterThan(PLAY_CAMERA_DISTANCE);
    expect(square).toBeLessThan(PLAY_CAMERA_MAX_DISTANCE);
    expect(arenaCameraDistance(dummies, lens(390 / 844))).toBe(PLAY_CAMERA_MAX_DISTANCE);
    // At the square screen's distance the outer dummies' reaches stand at FIT_NDC across by the fit's own reckoning.
    const across = FIT_NDC * Math.tan((25 * Math.PI) / 180);
    const pitch = (ARENA_CAMERA_PITCH_DEG * Math.PI) / 180;
    for (const outer of [dummies[0]!, dummies[2]!]) expect((Math.abs(outer.lateral) + outer.reach) / (square + outer.ahead * Math.cos(pitch))).toBeCloseTo(across, 9);
  });
});
