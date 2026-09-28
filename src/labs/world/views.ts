import { Box3, PerspectiveCamera, Vector3 } from 'three';
import type { Ground } from '../../render/terrain/place';
import type { PlacedMember } from './layout';
import { fromTangent, toTangent, TOWARD_CAMERAS, ZONES } from './registry';

/**
 * How far above the horizontal each kind of view looks down, in degrees: the overview high enough that no row hides the
 * one behind it, a family or a member low enough to see faces, and high enough that the rows in front of a closely
 * fitted zone fall under the frame instead of across it.
 */
export const OVERVIEW_PITCH_DEG = 48;
export const FAMILY_PITCH_DEG = 26;
export const MEMBER_PITCH_DEG = 18;
/** The framed points, labels included, reach at most this far from the frame's middle toward each edge (1 is the edge). */
export const FIT_NDC = 0.9;
/** The least half-size a view frames, in metres, so a single flower or grass tuft is seen with some meadow around it. */
export const MIN_FIT_HALF_SIZE = 1.2;
/** A family's label stands this far in front of its zone's front edge, in metres, on the ground, like a placard. */
export const FAMILY_LABEL_GAP = 0.8;
/** Metres between the top of a member and the point its label's tail marks. */
export const MEMBER_LABEL_LIFT = 0.15;
/**
 * The screen room a label takes beyond the point it marks, in CSS pixels, which a view keeps inside its frame: a member's
 * label and tail rise above its point, a family's placard and tail hang below its point (world.css).
 */
export const MEMBER_LABEL_ROOM_PX = 36;
export const FAMILY_LABEL_ROOM_PX = 56;

/** The views the page opens, besides one per family and one per member. */
export const OVERVIEW = 'overview';
/** The Husk's and Bulwark's rows together, the page's one view of every character clip at once. */
export const CHARACTERS = 'characters';
export const CHARACTER_FAMILIES: readonly string[] = ['xeno', 'commanders'];

export interface ViewPose {
  position: Vector3;
  target: Vector3;
}

/** The camera a view is fitted for: its vertical angle in degrees, its aspect, and its height in CSS pixels. */
export interface Lens {
  fov: number;
  aspect: number;
  heightPx: number;
}

/** A point a view keeps in frame, with the screen room a label takes above or below it. */
export interface FitPoint {
  point: Vector3;
  abovePx?: number;
  belowPx?: number;
}

/** A view's name: the overview, the characters, a family (as `?family=` takes it) or a member (as `?member=` takes it). */
export type Focus = string;

/** The members a view frames, or null for a name that is no view. */
export function membersOf(focus: Focus, members: readonly PlacedMember[]): PlacedMember[] | null {
  if (focus === OVERVIEW) return [...members];
  if (focus === CHARACTERS) return members.filter((entry) => CHARACTER_FAMILIES.includes(entry.member.family));
  if (ZONES.some((zone) => zone.family === focus)) return members.filter((entry) => entry.member.family === focus);
  const one = members.find((entry) => entry.member.name === focus);
  return one ? [one] : null;
}

export function pitchOf(focus: Focus, members: readonly PlacedMember[]): number {
  if (focus === OVERVIEW) return OVERVIEW_PITCH_DEG;
  if (members.some((entry) => entry.member.name === focus)) return MEMBER_PITCH_DEG;
  return FAMILY_PITCH_DEG;
}

/** The eight corners of each member's visible bounds. */
export function boundsCorners(members: readonly PlacedMember[]): Vector3[] {
  const corners: Vector3[] = [];
  for (const { bounds } of members) {
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) corners.push(new Vector3(x, y, z));
  }
  return corners;
}

/**
 * The point a member's label's tail marks: over its root, a little above its highest point. Over the root rather than
 * the middle of its bounds, because a raised sword or a tower's barrels pulled the middle, and the label, off the body.
 */
export function memberLabelAnchor(entry: PlacedMember): Vector3 {
  const root = entry.root.getWorldPosition(new Vector3());
  return new Vector3(root.x, entry.bounds.max.y + MEMBER_LABEL_LIFT, root.z);
}

/**
 * The ground point a family's placard hangs from: in front of the zone's front edge by FAMILY_LABEL_GAP, across the
 * middle of the zone's width, as the cameras see both. Standing under the zone, the family's name never meets the
 * members' names, which stand over the members.
 */
export function familyLabelAnchor(members: readonly PlacedMember[], ground: Ground): Vector3 {
  let front = Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (const corner of boundsCorners(members)) {
    const { s, d } = fromTangent(corner.x, corner.z);
    front = Math.min(front, d);
    left = Math.min(left, s);
    right = Math.max(right, s);
  }
  const { x, z } = toTangent((left + right) / 2, front - FAMILY_LABEL_GAP);
  return ground.surfaceAt(x, z).position.clone();
}

/**
 * The camera pose that frames the points from the cameras' bearing at a pitch, as close as keeps every point, and the
 * room its label takes, within FIT_NDC of the frame's middle, and centred on them: the distance is searched (a point's
 * reach from the middle falls as the camera backs away), then the target shifts to centre the points' screen extent,
 * twice over. So a portrait phone backs away until a row's width fits and a wide screen until its height does, and a
 * zone fills its frame instead of floating in a sphere fitted around it.
 */
export function fitPoints(points: readonly FitPoint[], pitchDeg: number, lens: Lens): ViewPose {
  const camera = new PerspectiveCamera(lens.fov, lens.aspect, 0.05, 5000);
  const pitch = (pitchDeg * Math.PI) / 180;
  const toward = new Vector3(TOWARD_CAMERAS.x * Math.cos(pitch), Math.sin(pitch), TOWARD_CAMERAS.z * Math.cos(pitch));
  const box = new Box3().setFromPoints(points.map((entry) => entry.point));
  const target = box.getCenter(new Vector3());
  // A tiny member is framed as if it were MIN_FIT_HALF_SIZE across in every direction.
  const padded = [...points];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) padded.push({ point: target.clone().add(new Vector3(x, y, z).multiplyScalar(MIN_FIT_HALF_SIZE)) });
  const halfHeightPx = lens.heightPx / 2;
  const view = new Vector3();
  const ndc = new Vector3();
  const extent = (distance: number) => {
    camera.position.copy(target).addScaledVector(toward, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const entry of padded) {
      view.copy(entry.point).applyMatrix4(camera.matrixWorldInverse);
      if (view.z > -camera.near) return { worst: Infinity, minX, maxX, minY, maxY };
      ndc.copy(entry.point).project(camera);
      minX = Math.min(minX, ndc.x);
      maxX = Math.max(maxX, ndc.x);
      minY = Math.min(minY, ndc.y - (entry.belowPx ?? 0) / halfHeightPx);
      maxY = Math.max(maxY, ndc.y + (entry.abovePx ?? 0) / halfHeightPx);
    }
    return { worst: Math.max(-minX, maxX, -minY, maxY), minX, maxX, minY, maxY };
  };
  const radius = Math.max(box.getSize(new Vector3()).length() / 2, MIN_FIT_HALF_SIZE * Math.sqrt(3));
  const nearest = (): number => {
    let high = radius * 4;
    for (let i = 0; i < 12 && extent(high).worst > FIT_NDC; i++) high *= 2;
    let low = 0.05;
    for (let i = 0; i < 40; i++) {
      const middle = (low + high) / 2;
      if (extent(middle).worst > FIT_NDC) low = middle;
      else high = middle;
    }
    return high;
  };
  let distance = nearest();
  for (let pass = 0; pass < 2; pass++) {
    const e = extent(distance);
    const halfHeight = distance * Math.tan((lens.fov * Math.PI) / 360);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    target.addScaledVector(right, ((e.minX + e.maxX) / 2) * halfHeight * lens.aspect).addScaledVector(up, ((e.minY + e.maxY) / 2) * halfHeight);
    distance = nearest();
  }
  return { position: target.clone().addScaledVector(toward, distance), target: target.clone() };
}

/** The pose for a view framing its members alone, or null for a name that is no view. */
export function viewPose(focus: Focus, members: readonly PlacedMember[], lens: Lens): ViewPose | null {
  const framed = membersOf(focus, members);
  if (!framed || framed.length === 0) return null;
  return fitPoints(
    boundsCorners(framed).map((point) => ({ point })),
    pitchOf(focus, members),
    lens,
  );
}
