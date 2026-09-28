/**
 * The movement maths of the Asset World's "Play Pip (prototype)" mode, kept apart from three and the page so the unit
 * test drives it directly. This is a lab prototype for walking Pip-A around the world, not the M1 commander controller
 * (Mechanics, Commander movement), which belongs to the simulation and will replace it.
 *
 * Positions are points on the plane tangent at the pole, as registry.ts's toTangent gives them and the patch's surfaceAt
 * reads them. Speeds and radii are metres along the ground: groundToTangent turns a step on the ground into a step on
 * that plane, so a stride covers the same ground at the pole and at the area's edge.
 */

/** His pace with a key held, and with Shift too, in metres a second along the ground (Asset World layout). */
export const PLAY_WALK_SPEED = 3.2;
export const PLAY_SPRINT_SPEED = 5.6;
/** Seconds from standing to the walk pace, and from the walk pace to standing, the Commander table's feel. */
export const PLAY_SECONDS_TO_WALK = 0.18;
export const PLAY_SECONDS_TO_STOP = 0.12;
/** The fastest he turns toward the way he is asked to go, in degrees a second: a half turn takes a third of a second. */
export const PLAY_TURN_RATE_DEG = 540;
/** His body's reach around his root, which every member's own reach is widened by, in metres. */
export const PLAY_BODY_RADIUS = 0.35;
/** The least reach a member keeps around its root, in metres, so a flower or a grass tuft is still walked around. */
export const PLAY_MIN_MEMBER_REACH = 0.2;
/**
 * How far from the pole he may go on the tangent plane, in metres: inside the world sun's shadow box, 24.2 m to each
 * side of the pole across the sun's bearing (WORLD_SHADOW_HALF_WIDTH), less his shoulders, so he never runs out of his
 * own shadow, and 4 m past the kit arc's trees.
 */
export const PLAY_AREA_RADIUS = 23;
/** The ground speed at which the run clip has taken over from the idle completely, in metres a second. */
export const PLAY_RUN_FULL_WEIGHT_SPEED = 1.2;
/** Where he appears, on the world's view frame (s, d): in front of Pip-A's row, between his idle and run members. */
export const PLAY_SPAWN = { s: 13.3, d: -3.5 } as const;
/** A foot counts as planted within this many metres of its lowest point in the run clip, for the stride measure. */
export const PLAY_CONTACT_TOLERANCE = 0.03;
/** A thumb pad pushed less than this share of its reach moves nothing, and pushed past the second share sprints. */
export const PLAY_STICK_DEAD_ZONE = 0.15;
export const PLAY_STICK_SPRINT = 0.9;

export interface MoveInput {
  /** From -1 (left) to 1 (right), as the camera sees it. */
  right: number;
  /** From -1 (toward the camera) to 1 (away from it). */
  forward: number;
  sprint: boolean;
}

/** A unit direction on the ground's local frame, and how far the input asks along it, from 0 to 1. */
export interface MoveDirection {
  x: number;
  z: number;
  amount: number;
}

export interface MotionState {
  /** His root's point on the plane tangent at the pole. */
  x: number;
  z: number;
  /** His turn about his up, as place() takes it: a glTF character faces +Z, so a yaw of y faces (sin y, cos y). */
  yaw: number;
  /** The pace his legs are driving at, in metres a second, which eases toward the pace asked. */
  drive: number;
  /** The ground he covers a second: his drive, unless a member or the area's edge holds him back. */
  speed: number;
}

/** A member's root on the tangent plane, and the reach he cannot enter around it (his body's reach included). */
export interface Obstacle {
  x: number;
  z: number;
  radius: number;
}

export function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** The yaw place() takes to face a direction on the ground's local frame. */
export function yawOf(x: number, z: number): number {
  return Math.atan2(x, z);
}

/**
 * The way the input asks him to go, relative to the camera's facing on the ground (forwardX, forwardZ, any length), or
 * null when it asks nothing. A diagonal key pair asks as far as one key, not 1.41 times as far.
 */
export function moveDirection(input: MoveInput, forwardX: number, forwardZ: number): MoveDirection | null {
  const length = Math.hypot(forwardX, forwardZ);
  const amount = Math.min(1, Math.hypot(input.right, input.forward));
  if (length < 1e-9 || amount < 1e-6) return null;
  const fx = forwardX / length;
  const fz = forwardZ / length;
  // On a y-up right-handed frame the camera's right is its forward crossed with up: (-fz, fx).
  const x = fx * input.forward - fz * input.right;
  const z = fz * input.forward + fx * input.right;
  const along = Math.hypot(x, z);
  return { x: x / along, z: z / along, amount };
}

/** Turns a yaw toward another by at most maxStep radians, the short way round. */
export function turnToward(yaw: number, desired: number, maxStep: number): number {
  const delta = wrapAngle(desired - yaw);
  return wrapAngle(yaw + Math.sign(delta) * Math.min(Math.abs(delta), maxStep));
}

/**
 * Turns a small step along the ground at the tangent point (x, z) into the step on the tangent plane that covers it. A
 * point r from the pole on the plane lies atan(r / R) round the sphere, so the plane stretches a step away from the pole
 * by 1 / cos squared of that angle and a step across it by 1 / cos; without this he ran 2 percent slow outward at the
 * area's 23 m edge, and would run slower still on a larger area.
 */
export function groundToTangent(x: number, z: number, dx: number, dz: number, planetRadius: number): [number, number] {
  const r = Math.hypot(x, z);
  if (r < 1e-9) return [dx, dz];
  const ux = x / r;
  const uz = z / r;
  const along = dx * ux + dz * uz;
  const cos = planetRadius / Math.hypot(planetRadius, r);
  const outward = along / (cos * cos);
  return [ux * outward + (dx - along * ux) / cos, uz * outward + (dz - along * uz) / cos];
}

/** The distance along the sphere between two tangent-plane points, in metres. */
export function groundDistance(ax: number, az: number, bx: number, bz: number, planetRadius: number): number {
  const la = Math.hypot(ax, planetRadius, az);
  const lb = Math.hypot(bx, planetRadius, bz);
  const cx = planetRadius * bz - az * planetRadius;
  const cy = az * bx - ax * bz;
  const cz = ax * planetRadius - planetRadius * bx;
  const dot = ax * bx + planetRadius * planetRadius + az * bz;
  return planetRadius * Math.atan2(Math.hypot(cx, cy, cz) / (la * lb), dot / (la * lb));
}

/**
 * Pushes a point out of every obstacle's reach, straight out from its root, so a step into a member keeps its part
 * along the reach's edge and he slides round it instead of stopping dead. A few passes settle a point pushed from one
 * reach into a neighbour's. A point exactly on a root is pushed back the way he came.
 */
export function resolveObstacles(x: number, z: number, fromX: number, fromZ: number, obstacles: readonly Obstacle[]): { x: number; z: number; blocked: boolean } {
  let blocked = false;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const obstacle of obstacles) {
      let dx = x - obstacle.x;
      let dz = z - obstacle.z;
      let distance = Math.hypot(dx, dz);
      if (distance >= obstacle.radius) continue;
      if (distance < 1e-9) {
        dx = fromX - obstacle.x;
        dz = fromZ - obstacle.z;
        distance = Math.hypot(dx, dz);
        if (distance < 1e-9) [dx, dz, distance] = [1, 0, 1];
      }
      x = obstacle.x + (dx / distance) * obstacle.radius;
      z = obstacle.z + (dz / distance) * obstacle.radius;
      moved = true;
      blocked = true;
    }
    if (!moved) break;
  }
  return { x, z, blocked };
}

/** Holds a point inside PLAY_AREA_RADIUS of the pole, sliding along the edge rather than stopping at it. */
export function clampToArea(x: number, z: number, radius = PLAY_AREA_RADIUS): { x: number; z: number; blocked: boolean } {
  const r = Math.hypot(x, z);
  if (r <= radius) return { x, z, blocked: false };
  return { x: (x / r) * radius, z: (z / r) * radius, blocked: true };
}

/**
 * One frame of movement. He turns toward the asked direction at PLAY_TURN_RATE_DEG, and runs along his own facing only
 * as fast as he faces the way asked, so a reversal turns him on the spot instead of backing him along; his drive eases
 * toward the pace asked at the Commander table's rates. Blocked by a member or the area's edge, his speed is the ground
 * he actually covered, so the run clip idles when he is held head on instead of running on the spot, while his drive
 * carries on. Fed back into the drive, the held-back speed restarted every frame's ease from it, so a slide along a
 * wall settled far below its share of the pace asked along the wall.
 */
export function stepMotion(state: MotionState, direction: MoveDirection | null, sprint: boolean, dt: number, obstacles: readonly Obstacle[], planetRadius: number): MotionState {
  if (dt <= 0) return { ...state };
  let yaw = state.yaw;
  let target = 0;
  if (direction) {
    const desired = yawOf(direction.x, direction.z);
    yaw = turnToward(yaw, desired, ((PLAY_TURN_RATE_DEG * Math.PI) / 180) * dt);
    const facing = Math.max(0, Math.cos(wrapAngle(desired - yaw)));
    target = direction.amount * (sprint ? PLAY_SPRINT_SPEED : PLAY_WALK_SPEED) * facing;
  }
  const speedUp = PLAY_WALK_SPEED / PLAY_SECONDS_TO_WALK;
  const slowDown = PLAY_WALK_SPEED / PLAY_SECONDS_TO_STOP;
  const drive = target > state.drive ? Math.min(target, state.drive + speedUp * dt) : Math.max(target, state.drive - slowDown * dt);
  const [tx, tz] = groundToTangent(state.x, state.z, Math.sin(yaw) * drive * dt, Math.cos(yaw) * drive * dt, planetRadius);
  const free = resolveObstacles(state.x + tx, state.z + tz, state.x, state.z, obstacles);
  const kept = clampToArea(free.x, free.z);
  const speed = free.blocked || kept.blocked ? Math.min(drive, groundDistance(state.x, state.z, kept.x, kept.z, planetRadius) / dt) : drive;
  return { x: kept.x, z: kept.z, yaw, drive, speed };
}

/** The run clip's weight against the idle at a ground speed: the idle alone standing, the run alone from 1.2 m/s. */
export function runWeight(speed: number): number {
  return Math.min(1, Math.max(0, speed / PLAY_RUN_FULL_WEIGHT_SPEED));
}

/** The run clip's playback rate at a ground speed, so its planted foot moves back as fast as the ground passes. */
export function runTimeScale(speed: number, clipSpeed: number): number {
  return clipSpeed > 0 ? speed / clipSpeed : 1;
}

/** One foot's place in the character's own frame at one moment: its height and how far forward it is. */
export interface FootSample {
  y: number;
  z: number;
}

/**
 * The ground an in-place run clip covers in one loop, in metres, from its feet sampled evenly over the loop
 * (samples[moment][foot], starting at 0 s). A planted foot slides back under the body as fast as the ground would pass,
 * so the median backward speed of each foot while within PLAY_CONTACT_TOLERANCE of its lowest point is the clip's
 * ground speed. Null when too few moments count as planted to read one.
 */
export function runLoopDistance(samples: readonly (readonly FootSample[])[], duration: number, tolerance = PLAY_CONTACT_TOLERANCE): number | null {
  const moments = samples.length;
  if (moments < 3 || duration <= 0) return null;
  const step = duration / moments;
  const feet = samples[0]!.length;
  const speeds: number[] = [];
  for (let foot = 0; foot < feet; foot++) {
    const lowest = Math.min(...samples.map((moment) => moment[foot]!.y));
    for (let i = 0; i < moments; i++) {
      if (samples[i]![foot]!.y > lowest + tolerance) continue;
      const before = samples[(i - 1 + moments) % moments]![foot]!;
      const after = samples[(i + 1) % moments]![foot]!;
      speeds.push(-(after.z - before.z) / (2 * step));
    }
  }
  if (speeds.length < 2) return null;
  speeds.sort((a, b) => a - b);
  const middle = speeds.length / 2;
  const median = speeds.length % 2 ? speeds[Math.floor(middle)]! : (speeds[middle - 1]! + speeds[middle]!) / 2;
  return median > 0 ? median * duration : null;
}

/**
 * A thumb pad's push, in CSS pixels from its centre (screen y down), as a move input: clamped to its reach, nothing
 * inside PLAY_STICK_DEAD_ZONE of it, and a sprint past PLAY_STICK_SPRINT.
 */
export function stickInput(dx: number, dy: number, reach: number): MoveInput {
  const length = Math.hypot(dx, dy);
  if (reach <= 0 || length < PLAY_STICK_DEAD_ZONE * reach) return { right: 0, forward: 0, sprint: false };
  const share = Math.min(1, length / reach);
  // The dead zone is taken off the push, so the pace rises from nothing at its edge rather than jumping to 15 percent.
  const amount = (share - PLAY_STICK_DEAD_ZONE) / (1 - PLAY_STICK_DEAD_ZONE);
  return { right: (dx / length) * amount, forward: (-dy / length) * amount, sprint: share >= PLAY_STICK_SPRINT };
}
