/**
 * The combat arena's hit test, kept apart from three and the page so the unit test drives it directly. A hit's shape is
 * the blade itself swept over the frame: the segment from its base to its tip, where it was drawn on the frame before
 * and where it is drawn now, swung between the two about his shoulders and tested at evenly spaced moments against each
 * dummy's body, a vertical cylinder about its root. Only the part of the frame inside the hit's active frames counts (Mechanics, Commander
 * combat: the active frame is where the hit lands), each swing hits each body at most once (SwingHits), and a body that
 * the blade's sweep never meets in the active frames, one that stepped out of the arc before them or stands behind him,
 * is missed and gets nothing at all. This is the blade's own arc rather than a fixed arc of reach and angle per hit,
 * so the forehand, the backhand and the chop each hit where their blade actually passes.
 */

/** A point or direction, shaped as three's Vector3 is, so the page passes its vectors without a copy. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A body the blade can meet: a vertical cylinder about the y axis of its own frame, from `low` to `high` up it. */
export interface HitBody {
  radius: number;
  low: number;
  high: number;
}

/** The blade's sweep is tested at a moment every HIT_SAMPLE_M of its fastest end's travel, at most HIT_SAMPLES_MAX. */
export const HIT_SAMPLE_M = 0.1;
export const HIT_SAMPLES_MAX = 32;

/**
 * The distance across the ground (x and z) from the body's axis to the segment from a to b, with the segment cut to the
 * body's height band, and the point of the cut segment nearest the axis written into `near`. Infinity, and `near`
 * untouched, when the segment never enters the band.
 */
export function segmentToAxis(a: Vec3, b: Vec3, low: number, high: number, near: Vec3): number {
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  if (Math.abs(dy) < 1e-12) {
    if (a.y < low || a.y > high) return Infinity;
  } else {
    const tl = (low - a.y) / dy;
    const th = (high - a.y) / dy;
    t0 = Math.max(0, Math.min(tl, th));
    t1 = Math.min(1, Math.max(tl, th));
    if (t0 > t1) return Infinity;
  }
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const px = a.x + dx * t0;
  const pz = a.z + dz * t0;
  const ex = dx * (t1 - t0);
  const ez = dz * (t1 - t0);
  const length = ex * ex + ez * ez;
  const u = length > 1e-12 ? Math.min(1, Math.max(0, -(px * ex + pz * ez) / length)) : 0;
  const t = t0 + (t1 - t0) * u;
  near.x = a.x + dx * t;
  near.y = a.y + dy * t;
  near.z = a.z + dz * t;
  return Math.hypot(near.x, near.z);
}

/**
 * The point a share `s` of the way from a to b swinging about a pivot that moves from p0 to p1: the pivot moved on in a
 * straight line, and the point's offset from it turned along the arc between its two offsets (its length eased between
 * theirs), written into `out`. Taken in a straight line instead, a big swing cut its corner: between two frames of the
 * labs' 1/20 s step the finisher's tip turns about two and a half radians, and the chord between the two poses passed
 * under half its reach from his root, short of a body the blade went through.
 */
export function swingPoint(a: Vec3, b: Vec3, p0: Vec3, p1: Vec3, s: number, out: Vec3): Vec3 {
  const ax = a.x - p0.x;
  const ay = a.y - p0.y;
  const az = a.z - p0.z;
  const bx = b.x - p1.x;
  const by = b.y - p1.y;
  const bz = b.z - p1.z;
  const la = Math.hypot(ax, ay, az);
  const lb = Math.hypot(bx, by, bz);
  const px = p0.x + (p1.x - p0.x) * s;
  const py = p0.y + (p1.y - p0.y) * s;
  const pz = p0.z + (p1.z - p0.z) * s;
  const angle = la > 1e-9 && lb > 1e-9 ? Math.acos(Math.min(1, Math.max(-1, (ax * bx + ay * by + az * bz) / (la * lb)))) : 0;
  let wa = 1 - s;
  let wb = s;
  if (angle > 1e-4 && angle < Math.PI - 1e-4) {
    // The directions slerped, then scaled to the eased length.
    const sin = Math.sin(angle);
    const length = la + (lb - la) * s;
    wa = (Math.sin((1 - s) * angle) / sin) * (length / la);
    wb = (Math.sin(s * angle) / sin) * (length / lb);
  }
  out.x = px + ax * wa + bx * wb;
  out.y = py + ay * wa + by * wb;
  out.z = pz + az * wa + bz * wb;
  return out;
}

/**
 * How many moments to test a sweep at, over the share `to - from` of the frame it covers: one for every HIT_SAMPLE_M of
 * its tip's travel about the pivot (the arc, not the chord), at most HIT_SAMPLES_MAX.
 */
export function sweepSteps(base0: Vec3, tip0: Vec3, base1: Vec3, tip1: Vec3, from: number, to: number, pivot0: Vec3 = base0, pivot1: Vec3 = base1): number {
  const chord = Math.max(Math.hypot(tip1.x - tip0.x, tip1.y - tip0.y, tip1.z - tip0.z), Math.hypot(base1.x - base0.x, base1.y - base0.y, base1.z - base0.z));
  const ax = tip0.x - pivot0.x;
  const ay = tip0.y - pivot0.y;
  const az = tip0.z - pivot0.z;
  const bx = tip1.x - pivot1.x;
  const by = tip1.y - pivot1.y;
  const bz = tip1.z - pivot1.z;
  const la = Math.hypot(ax, ay, az);
  const lb = Math.hypot(bx, by, bz);
  const angle = la > 1e-9 && lb > 1e-9 ? Math.acos(Math.min(1, Math.max(-1, (ax * bx + ay * by + az * bz) / (la * lb)))) : 0;
  const travel = Math.max(chord, angle * Math.max(la, lb));
  return Math.max(1, Math.min(HIT_SAMPLES_MAX, Math.ceil((travel * Math.max(0, to - from)) / HIT_SAMPLE_M)));
}

// Scratch points for sweepHit, so a test builds nothing.
const base: Vec3 = { x: 0, y: 0, z: 0 };
const tip: Vec3 = { x: 0, y: 0, z: 0 };
const near: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * The first moment a blade swept from (base0, tip0) to (base1, tip1) about a pivot moving from pivot0 to pivot1 (his
 * shoulders; swingPoint), all in the body's own frame, touches the body: the share of the sweep, from `from` to `to`
 * (0 is the frame before, 1 now), tested at `steps` + 1 even moments, both ends included. The contact is written into
 * `contact`: the blade's point nearest the body's axis, carried out to the body's surface across the ground, where the
 * cut meets it. -1 when the blade never touches.
 */
export function sweepHit(
  base0: Vec3,
  tip0: Vec3,
  base1: Vec3,
  tip1: Vec3,
  pivot0: Vec3,
  pivot1: Vec3,
  body: HitBody,
  from: number,
  to: number,
  steps: number,
  contact: Vec3,
): number {
  const count = Math.max(1, Math.floor(steps));
  for (let i = 0; i <= count; i++) {
    const s = from + ((to - from) * i) / count;
    swingPoint(base0, base1, pivot0, pivot1, s, base);
    swingPoint(tip0, tip1, pivot0, pivot1, s, tip);
    const distance = segmentToAxis(base, tip, body.low, body.high, near);
    if (distance > body.radius) continue;
    const out = distance > 1e-9 ? body.radius / distance : 1;
    contact.x = near.x * out;
    contact.y = near.y;
    contact.z = near.z * out;
    return s;
  }
  return -1;
}

/** Which bodies the swing playing now has hit: each at most once a swing. */
export class SwingHits {
  private readonly hit: boolean[];

  constructor(count: number) {
    this.hit = new Array<boolean>(count).fill(false);
  }

  /** A new swing: every body may be hit again. */
  begin(): void {
    this.hit.fill(false);
  }

  /** Marks a body hit and says whether this swing had not hit it yet. */
  take(index: number): boolean {
    if (this.hit[index]) return false;
    this.hit[index] = true;
    return true;
  }

  has(index: number): boolean {
    return this.hit[index] === true;
  }
}
