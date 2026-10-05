/**
 * The combat arena's layout (labs/combat.html): where Pip comes out, where the three training dummies stand, and how far
 * back the camera first opens so all of them are in frame. Plain maths on the Asset World's view frame (registry.ts:
 * s to the right as the world's cameras see it and d away from them, on the plane tangent at the pole), kept apart from
 * three and the page so the unit test drives it directly. The arena is a lab for trying Play Pip's combat quickly, and
 * its numbers are lab numbers (Numbers, Combat arena), not the game's.
 */
import { toTangent, TOWARD_CAMERAS } from '../world/registry';
import { wrapAngle, yawOf } from '../world/playMotion';

/**
 * Where Pip comes out, on the world's view frame: 1.5 m in front of the pole on the world cameras' side, so the dummies
 * 3 m ahead of him stand within 1.6 m of the pole and every body in the arena stands on the level ground there (the
 * patch's relief begins 6 m from the pole, stylePatch.ts).
 */
export const ARENA_SPAWN = { s: 0, d: -1.5 } as const;
/** How far each training dummy's root stands from Pip's spawn, in metres: all three on one arc about him. */
export const ARENA_DUMMY_DISTANCE = 3;
/**
 * How far apart two neighbouring dummies' roots stand, in metres, straight across: close enough that a short step and a
 * turn bring the next one into reach after the last falls, far enough that one swing at a dummy never reaches the next.
 */
export const ARENA_DUMMY_SPACING = 2.8;
/** The training dummies' names, left to right as the camera behind him sees them; the middle one stands dead ahead. */
export const ARENA_DUMMY_NAMES = ['dummy_left', 'dummy_middle', 'dummy_right'] as const;

/** A body's place on the plane tangent at the pole and its yaw, as place() takes them. */
export interface GroundPose {
  x: number;
  z: number;
  yaw: number;
}

/**
 * The way Pip faces at the spawn, on the tangent plane: away from the world cameras (+d), so the camera behind him looks
 * the way the world's cameras look and the Verdant key falls on the dummies as it falls on the world's members, 55
 * degrees behind the camera and to its left (WORLD_FACING_DEG).
 */
export function arenaFacing(): { x: number; z: number } {
  return { x: -TOWARD_CAMERAS.x, z: -TOWARD_CAMERAS.z };
}

/** Pip's start: ARENA_SPAWN, facing the middle dummy. */
export function arenaSpawn(): GroundPose {
  const { x, z } = toTangent(ARENA_SPAWN.s, ARENA_SPAWN.d);
  const facing = arenaFacing();
  return { x, z, yaw: yawOf(facing.x, facing.z) };
}

/** The angle between neighbouring dummies as seen from the spawn, in radians, for ARENA_DUMMY_SPACING across. */
export function dummyStepAngle(): number {
  return 2 * Math.asin(ARENA_DUMMY_SPACING / (2 * ARENA_DUMMY_DISTANCE));
}

/**
 * The dummies' home poses, left to right: each on the arc ARENA_DUMMY_DISTANCE about the spawn, the middle one dead ahead
 * and its neighbours ARENA_DUMMY_SPACING to either side, every one turned to face the spawn, so each meets him front on
 * when he steps up to it.
 */
export function dummyHomes(): GroundPose[] {
  const step = dummyStepAngle();
  const middle = (ARENA_DUMMY_NAMES.length - 1) / 2;
  const spawn = arenaSpawn();
  return ARENA_DUMMY_NAMES.map((_, index) => {
    const angle = (index - middle) * step;
    const { x, z } = toTangent(ARENA_SPAWN.s + ARENA_DUMMY_DISTANCE * Math.sin(angle), ARENA_SPAWN.d + ARENA_DUMMY_DISTANCE * Math.cos(angle));
    return { x, z, yaw: yawOf(spawn.x - x, spawn.z - z) };
  });
}

/**
 * Where a point stands from a body at (x, z) facing `yaw`: its distance on the tangent plane, and its bearing off the
 * facing in degrees, positive to the body's right (the camera's right, with the camera behind him).
 */
export function fromBody(x: number, z: number, yaw: number, toX: number, toZ: number): { distance: number; angleDeg: number } {
  const dx = toX - x;
  const dz = toZ - z;
  // A glTF body facing yaw faces (sin yaw, cos yaw); its right on this y-up plane is (-cos yaw, sin yaw) as the camera
  // behind it sees it (moveDirection's camera right, (-fz, fx)).
  return { distance: Math.hypot(dx, dz), angleDeg: (wrapAngle(yaw - yawOf(dx, dz)) * 180) / Math.PI };
}

/**
 * The opening camera's pitch above his horizon, in degrees, straight behind him. At the Asset World's 16 degrees his
 * body hid the middle dummy whole: the line over his head met the dummy 1.31 m up, and a Husk stands lower. At 30 it
 * meets the dummy 0.48 m up, so the Husk's back and eyes show over his shoulders, while the horizon and the planet's
 * curve stay in the frame's top. Turning the camera off his back instead, over a shoulder, showed the dummy beside him
 * but turned W off his facing by the same angle, since W runs up the screen: he veered off the dummy he faced. The
 * follow and the orbit take over from this framing as in the world.
 */
export const ARENA_CAMERA_PITCH_DEG = 30;

/** The way from Pip at the spawn toward the opening camera, on the tangent plane: straight behind him. */
export function arenaCameraBearing(): { x: number; z: number } {
  const facing = arenaFacing();
  return { x: -facing.x, z: -facing.z };
}

/** The follow camera's lens and limits, as the page has them (play.ts and the page's camera). */
export interface ArenaLens {
  fovDeg: number;
  aspect: number;
  pitchDeg: number;
  minDistance: number;
  maxDistance: number;
  /** The share of the half-frame a framed body may reach (views.ts, FIT_NDC). */
  fit: number;
}

/**
 * How far back the camera opens behind him so every dummy, its reach to either side included, stands inside `fit` of
 * the half-frame across, between the lens's least and greatest distance: on a wide screen the play camera's own
 * distance holds them all, and on a phone held upright, whose frame is narrow, the camera opens further back rather
 * than leaving the outer dummies off screen, as far as the wheel's greatest distance. A dummy `lateral` metres to his
 * side and `ahead` metres in front of him stands about the camera's distance plus `ahead` along the pitched view from
 * the camera: close enough for a framing the viewer then adjusts with the wheel or a pinch.
 */
export function arenaCameraDistance(dummies: readonly { lateral: number; ahead: number; reach: number }[], lens: ArenaLens): number {
  const across = lens.fit * lens.aspect * Math.tan((lens.fovDeg * Math.PI) / 360);
  const pitch = (lens.pitchDeg * Math.PI) / 180;
  let distance = lens.minDistance;
  for (const dummy of dummies) distance = Math.max(distance, (Math.abs(dummy.lateral) + dummy.reach) / across - dummy.ahead * Math.cos(pitch));
  return Math.min(lens.maxDistance, distance);
}

/** Each dummy's home as the camera fit reads it: across from the spawn's facing (`lateral`) and along it (`ahead`). */
export function dummyFrame(homes: readonly GroundPose[]): { lateral: number; ahead: number }[] {
  const spawn = arenaSpawn();
  const facing = arenaFacing();
  return homes.map((home) => {
    const dx = home.x - spawn.x;
    const dz = home.z - spawn.z;
    return { lateral: dx * -facing.z + dz * facing.x, ahead: dx * facing.x + dz * facing.z };
  });
}
