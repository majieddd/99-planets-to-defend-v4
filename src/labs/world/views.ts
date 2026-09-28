import { Box3, PerspectiveCamera, Vector3 } from 'three';
import type { Ground } from '../../render/terrain/place';
import type { LabelSpec } from './labels';
import type { PlacedMember } from './layout';
import { fromTangent, MEMBERS, toTangent, TOWARD_CAMERAS, ZONES } from './registry';

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
/**
 * The screen room a label takes beyond the point it marks, in CSS pixels, which a view keeps inside its frame: a member's
 * label and tail rise above its point, a family's placard and tail hang below its point (world.css). In its own view a
 * member's label carries its family's name as a second line, so it rises further.
 */
export const MEMBER_LABEL_ROOM_PX = 36;
export const FOCUSED_MEMBER_LABEL_ROOM_PX = 52;
export const FAMILY_LABEL_ROOM_PX = 56;
/**
 * The overview names every member only on a screen at least this wide, in CSS pixels; narrower, the labels of 22
 * members crowd each other, so the overview names the families alone and a family's view names its members.
 */
export const OVERVIEW_MEMBER_LABELS_MIN_WIDTH = 1280;

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

/**
 * What is open: a view (the overview, the characters or a family, as `?family=` takes it) and, inside it, one member
 * (as `?member=` takes it) or '' for the whole view.
 */
export interface OpenView {
  view: string;
  member: string;
}

/** What else decides which labels show: the labels toggle, and the canvas width, which decides the overview's. */
export interface LabelContext {
  labels: boolean;
  widthPx: number;
}

/** A family placard's key among the labels, apart from the members' names. */
export function familyLabelKey(family: string): string {
  return `family:${family}`;
}

/** Whether a name is a member's, as `?member=` takes it: the registry's, whether or not its asset loaded. */
export function isMemberName(name: string): boolean {
  return MEMBERS.some((m) => m.name === name);
}

/** Whether a name is a view's, as `?family=` takes it: the overview, the characters or a zone's family. */
export function isViewName(name: string): boolean {
  return name === OVERVIEW || name === CHARACTERS || ZONES.some((zone) => zone.family === name);
}

/** The members a view frames, or null for a name that is no view. */
export function membersOf(focus: string, members: readonly PlacedMember[]): PlacedMember[] | null {
  if (focus === OVERVIEW) return [...members];
  if (focus === CHARACTERS) return members.filter((entry) => CHARACTER_FAMILIES.includes(entry.member.family));
  if (ZONES.some((zone) => zone.family === focus)) return members.filter((entry) => entry.member.family === focus);
  const one = members.find((entry) => entry.member.name === focus);
  return one ? [one] : null;
}

/** The members an open view frames: its member alone, or the whole view. */
function framedBy(open: OpenView, members: readonly PlacedMember[]): PlacedMember[] | null {
  return open.member ? members.filter((entry) => entry.member.name === open.member) : membersOf(open.view, members);
}

export function pitchOf(open: OpenView): number {
  if (open.member) return MEMBER_PITCH_DEG;
  return open.view === OVERVIEW ? OVERVIEW_PITCH_DEG : FAMILY_PITCH_DEG;
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
 * The point a member's label's tail marks: its body's top, on its own up line (PlacedMember.top). No lift is added in
 * metres: the tail (world.css) stands the label off the point by the same few pixels at every distance, where a lift of
 * 0.15 m rose about 40 px over a tower in its own view.
 */
export function memberLabelAnchor(entry: PlacedMember): Vector3 {
  return entry.top.clone();
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
 * Every label the world shows: a placard under each zone with members, naming the family with its key as a second
 * line, and a label over each member that has one (a family's only member has none; its placard names it), whose second
 * line, its family's name, shows only in the member's own view.
 */
export function labelSpecs(members: readonly PlacedMember[], ground: Ground): LabelSpec[] {
  const specs: LabelSpec[] = [];
  for (const zone of ZONES) {
    const own = members.filter((entry) => entry.member.family === zone.family);
    if (own.length) specs.push({ key: familyLabelKey(zone.family), kind: 'family', family: zone.family, text: zone.label, detail: zone.family, anchor: familyLabelAnchor(own, ground) });
  }
  for (const entry of members) {
    const { member } = entry;
    if (!member.label) continue;
    const zone = ZONES.find((candidate) => candidate.family === member.family);
    specs.push({ key: member.name, kind: 'member', family: member.family, text: member.label, line: zone?.label ?? member.family, anchor: memberLabelAnchor(entry) });
  }
  return specs;
}

/**
 * Which labels an open view shows, as a test on a label, resolved once per view so the frame loop only calls it. The
 * overview names every family, and on a wide screen every member too; the characters' view names both character
 * families and their members; a family's view names the family and its members. A member's view names the member alone,
 * its label carrying the family's name: its family's placard stands in front of the whole zone, and framing it too took
 * an end-of-row member's camera back until the zone fitted (the flowers at 27.9 m on a phone, against 7.5 m for the
 * flowers alone). A family's only member has no label, so its view shows its family's placard, which stands just in
 * front of it. Other families' names stay off a close view, where they would crowd its edges.
 */
export function labelRule(open: OpenView, members: readonly PlacedMember[], context: LabelContext): (spec: Pick<LabelSpec, 'kind' | 'key' | 'family'>) => boolean {
  if (!context.labels) return () => false;
  if (open.member) {
    const entry = members.find((candidate) => candidate.member.name === open.member);
    if (!entry) return () => false;
    const { family, label } = entry.member;
    return label ? (spec) => spec.kind === 'member' && spec.key === open.member : (spec) => spec.kind === 'family' && spec.family === family;
  }
  if (open.view === OVERVIEW) {
    const everyMember = context.widthPx >= OVERVIEW_MEMBER_LABELS_MIN_WIDTH;
    return (spec) => spec.kind === 'family' || everyMember;
  }
  if (open.view === CHARACTERS) return (spec) => CHARACTER_FAMILIES.includes(spec.family);
  return (spec) => spec.family === open.view;
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

/**
 * The points an open view keeps in frame: its members' bounds, and each label it shows with the room that label takes.
 * Null when the view frames no member (an unknown name, or a page whose assets did not load).
 */
export function viewPoints(open: OpenView, members: readonly PlacedMember[], specs: readonly LabelSpec[], context: LabelContext): FitPoint[] | null {
  const framed = framedBy(open, members);
  if (!framed || framed.length === 0) return null;
  const points: FitPoint[] = boundsCorners(framed).map((point) => ({ point }));
  const shown = labelRule(open, members, context);
  const memberRoom = open.member ? FOCUSED_MEMBER_LABEL_ROOM_PX : MEMBER_LABEL_ROOM_PX;
  for (const spec of specs) {
    if (!shown(spec)) continue;
    points.push(spec.kind === 'family' ? { point: spec.anchor, belowPx: FAMILY_LABEL_ROOM_PX } : { point: spec.anchor, abovePx: memberRoom });
  }
  return points;
}

/** The pose the page opens a view in: its points (viewPoints) fitted at its pitch, or null when it frames no member. */
export function frameView(open: OpenView, members: readonly PlacedMember[], specs: readonly LabelSpec[], context: LabelContext, lens: Lens): ViewPose | null {
  const points = viewPoints(open, members, specs, context);
  return points ? fitPoints(points, pitchOf(open), lens) : null;
}

/**
 * The overview's pose from the registry alone, for a page whose assets did not load: it frames the ground where the
 * members would stand, so the camera looks at the patch instead of sitting at the origin inside the ground.
 */
export function registryOverview(ground: Ground, lens: Lens): ViewPose {
  const points = MEMBERS.map((m): FitPoint => {
    const { x, z } = toTangent(m.s, m.d);
    return { point: ground.surfaceAt(x, z).position.clone() };
  });
  return fitPoints(points, OVERVIEW_PITCH_DEG, lens);
}

/** The view an address opens, and a sentence for each name in it that is not what its parameter takes. */
export interface AddressView {
  open: OpenView;
  problems: string[];
}

/**
 * Reads `?member=` and `?family=`, each as its own kind: a member's name, and a view's name. The member opens when it
 * names one, else the family when it names one, else the overview; an empty value is skipped as absent, and any other
 * value that names nothing of its kind is reported. The page read `member ?? family`, so an empty `?member=` hid a good
 * `?family=` and opened the overview, and either parameter took either kind of name.
 */
export function resolveAddress(member: string | null, family: string | null): AddressView {
  const problems: string[] = [];
  let open: OpenView | null = null;
  if (member) {
    const found = MEMBERS.find((m) => m.name === member);
    if (found) open = { view: found.family, member: found.name };
    else problems.push(`no member named "${member}"`);
  }
  if (family) {
    if (!isViewName(family)) problems.push(`no family named "${family}"`);
    else open ??= { view: family, member: '' };
  }
  return { open: open ?? { view: OVERVIEW, member: '' }, problems };
}
