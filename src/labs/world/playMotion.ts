/**
 * The movement maths of the Asset World's "Play Pip (prototype)" mode, kept apart from three and the page so the unit
 * test drives it directly. This is a lab prototype for walking Pip around the world, not the M1 commander controller
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
 * How far from the pole he may go on the tangent plane, in metres: inside the world sun's shadow box, 27.8 m to each
 * side of the pole across the sun's bearing (WORLD_SHADOW_HALF_WIDTH) since Pip's attack member moved Bulwark's row out,
 * with his shoulders and 4.45 m to spare, so he never runs out of his own shadow, and 4 m past the kit arc's trees. It
 * was set when the box reached 24.2 m, and a wider box only adds to the spare.
 */
export const PLAY_AREA_RADIUS = 23;
/** The ground speed at which the run clip has taken over from the idle completely, in metres a second. */
export const PLAY_RUN_FULL_WEIGHT_SPEED = 1.2;
/**
 * Where he appears, on the world's view frame (s, d): 3.5 m in front of Pip's row, midway between his idle (2.8 m) and
 * run (5.4 m) members, on the level clearing. It moved from (13.3, -3.5) when Pip's row took the clearing and Bulwark's
 * the spots past it, so it stays in front of Pip's own row rather than Bulwark's.
 */
export const PLAY_SPAWN = { s: 4.1, d: -3.5 } as const;
/** A foot counts as planted within this many metres of its lowest point in the run clip, for the stride measure. */
export const PLAY_CONTACT_TOLERANCE = 0.03;
/** A thumb pad pushed less than this share of its reach moves nothing, and pushed past the second share sprints. */
export const PLAY_STICK_DEAD_ZONE = 0.15;
export const PLAY_STICK_SPRINT = 0.9;
/**
 * The share of the pace asked that he keeps while he swings: none. The cleave plants both boots (the recipe holds them
 * by IK on every frame), so any pace under it would slide them across the ground; he stops dead instead, on the frame
 * the swing starts (startSwing zeroes his drive), and a direction asked mid-swing neither moves nor turns him. The
 * cleave is committed (Pillar 4): he keeps the facing he had when the swing began. He used to shed his pace at the
 * PLAY_SECONDS_TO_STOP rate, but the clip reaches full weight in PLAY_ATTACK_FADE_IN, 0.07 s, and that rate takes
 * 0.12 s from a walk and 0.21 s from a sprint, so he slid about 0.19 m and 0.59 m with his boots planted.
 */
export const PLAY_ATTACK_MOVE_SCALE = 0;
/**
 * Seconds the attack clip takes to take over from the idle and run, and to hand back to them at its end. The fade in
 * is short, a fifth of the 0.34 s wind-up, so the wind-up reads from its first frames; the fade out spans the clip's last
 * stretch, where the recovery returns to the guard, so he settles into the idle or the run without a pop, and ends one
 * frame before the clip does (attackWeight says why).
 */
export const PLAY_ATTACK_FADE_IN = 0.07;
export const PLAY_ATTACK_FADE_OUT = 0.2;
/**
 * A left press on the canvas counts as an attack only if it moves less than this many CSS pixels and lifts within this
 * many seconds; anything longer or further is OrbitControls' drag. 5 px turns the orbit by 1.7 degrees on a 1080 px
 * tall canvas, too little to read as a drag, and 0.25 s holds an ordinary click (about 0.1 s) with room to spare.
 */
export const PLAY_CLICK_SLOP_PX = 5;
export const PLAY_CLICK_MAX_SECONDS = 0.25;

/** Whether a left press that moved `movedPx` CSS pixels and lifted after `seconds` was a click rather than a drag. */
export function isAttackClick(movedPx: number, seconds: number): boolean {
  return movedPx < PLAY_CLICK_SLOP_PX && seconds >= 0 && seconds < PLAY_CLICK_MAX_SECONDS;
}

/** His swing: seconds into the attack clip, or null when he is not swinging. */
export interface AttackState {
  time: number | null;
}

export const NOT_SWINGING: AttackState = { time: null };

/**
 * A trigger starts the swing from its first frame, once per trigger. A trigger during a swing is ignored, not buffered:
 * the cleave is committed and the prototype has no input buffer (the M1 controller's buffers are Decided), so a second
 * press lands only once he is out of the swing.
 */
export function triggerAttack(state: AttackState): AttackState {
  return state.time === null ? { time: 0 } : state;
}

/**
 * One frame's trigger, as the page's loop takes it before it moves him: a swing starts only on a frame that advances
 * time, and the frame that starts it stops him dead, his drive and speed at 0, so the stop is a committed plant rather
 * than a slide under planted boots (PLAY_ATTACK_MOVE_SCALE says how far he slid). A trigger on a frozen frame (dt 0) is
 * dropped like one mid-swing: it used to start a swing that sat at its first frame until the lab unfroze and then
 * played, a buffered press, which the prototype does not keep.
 */
export function startSwing(attack: AttackState, motion: MotionState, asked: boolean, dt: number): { attack: AttackState; motion: MotionState } {
  if (!asked || dt <= 0 || attack.time !== null) return { attack, motion };
  return { attack: triggerAttack(attack), motion: { ...motion, drive: 0, speed: 0 } };
}

/**
 * Advances the swing by dt over a clip of `duration` seconds, and says whether the strike moment, `strikeAt` seconds in,
 * passed in this step: once per swing, on the step that reaches it. The swing ends, and he is free to move, on the step
 * that reaches the clip's end.
 */
export function stepAttack(state: AttackState, dt: number, duration: number, strikeAt: number): { state: AttackState; struck: boolean } {
  if (state.time === null || dt <= 0) return { state, struck: false };
  const next = state.time + dt;
  const struck = state.time < strikeAt && next >= strikeAt;
  return { state: next >= duration ? NOT_SWINGING : { time: next }, struck };
}

/**
 * The attack clip's weight over the idle and run at a time into the swing: faded in, held, and faded out to 0 one frame
 * before the clip's end, `step` (the frame's dt, the best guess at the next one) short of it. The swing ends on the
 * frame that reaches the clip's end, so a fade that reached 0 only there left the last swing frame up to step /
 * PLAY_ATTACK_FADE_OUT of weight, a quarter at the 0.05 s step SwiftShader runs at, which then vanished in one frame
 * and popped; ending one frame early, the last swing frame already stands at 0 at a steady frame rate.
 */
export function attackWeight(time: number | null, duration: number, step = 0): number {
  if (time === null || duration <= 0) return 0;
  const fadeIn = time / PLAY_ATTACK_FADE_IN;
  const fadeOut = (duration - Math.max(0, step) - time) / PLAY_ATTACK_FADE_OUT;
  return Math.min(1, Math.max(0, Math.min(fadeIn, fadeOut)));
}

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

/** A direction in world space, shaped as three's Vector3 is, so the page passes its own vectors without a copy. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * The camera's forward laid on his ground: his up crossed with the camera's right, as a unit vector, or null when the
 * two are parallel or either is zero. OrbitControls orbits about world y and keeps the camera's right level, so this
 * is square to the right: W never drifts to the side of the screen, and runs up it at every pitch, straight down
 * included. The view ray projected onto his ground, which this replaces, drifted off that line as the camera rose,
 * because his up leans out from world y by atan(r / R), 8.2 degrees at the play area's edge: there it ran 22.8 degrees
 * off at a 20 degree polar angle, and straight overhead, with his up leaning toward the foot of the screen, it reversed
 * and walked him toward the camera.
 */
export function groundForward(up: Vec3, right: Vec3): Vec3 | null {
  const x = up.y * right.z - up.z * right.y;
  const y = up.z * right.x - up.x * right.z;
  const z = up.x * right.y - up.y * right.x;
  const length = Math.hypot(x, y, z);
  if (length < 1e-9) return null;
  return { x: x / length, y: y / length, z: z / length };
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

/**
 * How far a point stands outside the nearest obstacle's reach, in metres on the tangent plane, and negative inside one:
 * the margin the browser test reads at his spawn, so a re-laid world cannot put him out inside a member.
 */
export function clearance(x: number, z: number, obstacles: readonly Obstacle[]): number {
  return Math.min(Infinity, ...obstacles.map((obstacle) => Math.hypot(x - obstacle.x, z - obstacle.z) - obstacle.radius));
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
 * wall settled far below its share of the pace asked along the wall. `moveScale` is the share of the pace asked that
 * he keeps, PLAY_ATTACK_MOVE_SCALE while he swings; at 0 the direction asked neither moves nor turns him.
 */
export function stepMotion(
  state: MotionState,
  direction: MoveDirection | null,
  sprint: boolean,
  dt: number,
  obstacles: readonly Obstacle[],
  planetRadius: number,
  moveScale = 1,
): MotionState {
  if (dt <= 0) return { ...state };
  let yaw = state.yaw;
  let target = 0;
  if (direction && moveScale > 0) {
    const desired = yawOf(direction.x, direction.z);
    yaw = turnToward(yaw, desired, ((PLAY_TURN_RATE_DEG * Math.PI) / 180) * dt);
    const facing = Math.max(0, Math.cos(wrapAngle(desired - yaw)));
    target = direction.amount * (sprint ? PLAY_SPRINT_SPEED : PLAY_WALK_SPEED) * facing * Math.min(1, moveScale);
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
