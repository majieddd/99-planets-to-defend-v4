/**
 * A training dummy's footprint: the Husk's body as Pip meets it, measured from its GLB, kept apart from three and the
 * page so the unit test drives it directly.
 *
 * The Husk's reach is not its legs. At Pip's body's height its head and mandibles reach 1.18 m in front of its root,
 * where its legs reach only 0.58 m at the ground, so a round reach either stops him far off to the sides and behind or
 * lets him into its head in front. Phase B swept his lunge against a round core of half the reach and let his walk stop
 * at the whole reach, which put his torso about 0.5 m inside the head on the finisher, and Quaternius's root motion
 * (0.75 m and 1.47 m) would have carried him further. The footprint is the Husk's shape instead: a round core for the
 * hump, the thorax and the claws, and a capsule for the head and mandibles along its facing, both read from its posed
 * vertices in the band of heights his body passes through, and widened by how far his body reaches in a swing. His walk,
 * his lunge and his clips' root motion all stop at it (playMotion.ts, Obstacle's `head`).
 */

/** A point in a body's own frame: x to its right, y up from its root, z ahead along its facing. */
export interface LocalPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * The band of heights over the ground the footprint is read in, in metres: Pip's body from his hips' lowest swing to his
 * shoulders, 0.35 to 1.45 m on his 1.78 m body. Below it only his legs pass, inside the Husk's core; above it only his
 * head, over the Husk's 1.21 m top.
 */
export const FOOTPRINT_BAND_LOW = 0.35;
export const FOOTPRINT_BAND_HIGH = 1.45;
/**
 * Where the head begins, metres ahead of the root: behind it the band holds the hump, the thorax and the claws, which
 * spread 0.6 m to each side up to 0.6 m ahead at hip height (the core, 0.80 m about the root over the idle); in front
 * only the head and the mandibles, 0.17 to 0.49 m to each side and reaching 1.18 m ahead, the mandibles' corners 0.42 m
 * out at 1.15 m, read in 10 cm slices of the shipped Husk's idle. The capsule that holds them all is a round end 0.70 m
 * across about this point, reaching 1.30 m ahead (tests/unit/labs/footprint.test.ts).
 */
export const HEAD_FROM = 0.6;
/**
 * How far Pip's body reaches from his root across the ground in a swing, his sword and his shield left out, in metres:
 * the footprint is widened by this before he meets it, so his fists, arms and belly stop at the Husk's head and body
 * through any hit. Measured on his shipped GLB in the band (tests/unit/labs/footprint.test.ts holds it): the forehand's
 * fist 0.86 m ahead, the backhand's 0.99 m out to his right, the spin finisher's 1.00 m, the hand-keyed hits 0.81 to
 * 0.99 m, his idle 0.56 m and his run 0.76 m. His body circle of 0.35 m (PLAY_BODY_RADIUS), which the Asset World's
 * members are widened by, let his fist and belly into the Husk's head on every lunge from contact. The sword is the hit
 * and passes through by design; the shield, a 1 m prop on his left forearm, punches past his fist in the finisher's
 * wind-up and is left out as the sword is.
 */
export const PIP_STRIKE_REACH = 1.0;
/** The fewest head points the capsule is read from; with fewer the footprint is its core alone. */
export const HEAD_MIN_POINTS = 8;

/**
 * A footprint in its body's own frame: the core's radius about the root, and the head's capsule along the facing, from
 * `from` to `to` metres ahead with `radius` either side, or null for a body with no head. All without Pip's reach.
 */
export interface Footprint {
  core: number;
  head: { from: number; to: number; radius: number } | null;
}

/** The farthest a set of ground points (x, z) stands from the segment along +z from `from` to `to`. */
function farthestFrom(points: readonly (readonly [number, number])[], from: number, to: number): number {
  let far = 0;
  for (const [x, z] of points) far = Math.max(far, Math.hypot(x, z - Math.min(to, Math.max(from, z))));
  return far;
}

/**
 * The footprint of a body from its posed points (its own frame, every pose sampled): points in the band only. The core
 * is the farthest of those behind HEAD_FROM from the root across the ground. The head is the narrowest capsule along
 * +z from HEAD_FROM that holds every point at or past it, with its round end reaching no further back than it must: its
 * line runs to the farthest point ahead less its radius, and the radius is the least that then holds them all (found by
 * halving, since a wider radius only shortens the line). A capsule as wide as the head's widest slice with its tip on
 * the farthest point left the Husk's mandible corners, 0.42 m to each side 1.15 m ahead, 0.13 m outside it; holding
 * every point, it reaches a little past the tip instead. A body with no points in the band has a core of 0.
 */
export function measureFootprint(points: Iterable<LocalPoint>): Footprint {
  let core = 0;
  let tip = -Infinity;
  let side = 0;
  const head: [number, number][] = [];
  for (const p of points) {
    if (p.y < FOOTPRINT_BAND_LOW || p.y > FOOTPRINT_BAND_HIGH) continue;
    if (p.z < HEAD_FROM) core = Math.max(core, Math.hypot(p.x, p.z));
    else {
      head.push([p.x, p.z]);
      side = Math.max(side, Math.abs(p.x));
      tip = Math.max(tip, p.z);
    }
  }
  if (head.length < HEAD_MIN_POINTS) return { core, head: null };
  // The least radius r whose capsule, from HEAD_FROM to tip - r, holds every head point: at r = side the sides fit
  // and only the far corners can stick out; at the distance of the farthest point from HEAD_FROM all of them fit.
  let lo = side;
  let hi = Math.max(side, farthestFrom(head, HEAD_FROM, HEAD_FROM));
  const holds = (r: number): boolean => farthestFrom(head, HEAD_FROM, Math.max(HEAD_FROM, tip - r)) <= r + 1e-9;
  if (holds(lo)) hi = lo;
  for (let i = 0; i < 40 && hi - lo > 1e-6; i++) {
    const mid = (lo + hi) / 2;
    if (holds(mid)) hi = mid;
    else lo = mid;
  }
  return { core, head: { from: HEAD_FROM, to: Math.max(HEAD_FROM, tip - hi), radius: hi } };
}

/** The farthest a footprint reaches ahead of its root: the head's tip, or the core's edge. */
export function footprintFront(footprint: Footprint): number {
  return Math.max(footprint.core, footprint.head ? footprint.head.to + footprint.head.radius : 0);
}
