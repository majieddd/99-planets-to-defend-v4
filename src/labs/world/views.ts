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
/**
 * The least half-size a view frames, in metres: the overview's and a family's 1.2 m, and a member's own view's 0.5 m.
 * A family of small pieces keeps some meadow around it, and a member's own view comes close enough to study it. At 1.2 m
 * in its own view, a flower 0.4 m across filled 0.07 by 0.14 of a 1920 x 1080 frame, and 16 of the 22 members stood at
 * the same 4.36 m there, however small each was.
 */
export const MIN_FIT_HALF_SIZE = 1.2;
export const MEMBER_MIN_FIT_HALF_SIZE = 0.5;
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
 * The overview names every member only on a screen at least this wide, in CSS pixels; narrower, the 25 member labels
 * (26 members, but the nest, its family's only member, has none) crowd each other, so the overview names the families
 * alone and a family's view names its members. Measured on the GPU with every member label forced on, since Pip's
 * attack member joined his row and moved Bulwark's 2.6 m out, which widens the overview's fit: at 1280 x 720 seven pairs
 * overlapped (the Worldheart's placard over the Husk's "Attack" and Pip's "Idle", "Bolt Sentinel" over "Bush", "Nest"
 * over "Rock B", the Husk's "Walk" over his "Attack", Pip's "Face" over his "Attack" and the hearts' "Stage 10" over
 * "Stage 7 (slider)"), at 1366 x 768 five, at 1440 x 900 and 1600 x 900 one ("Stage 10" over "Stage 7 (slider)" by
 * 0.6 px), and at 1680 x 1050, 1920 x 1080 and 2560 x 1440 none. The 16:9 screen of the same width, 1680 x 945, has
 * none either (2026-10-05, as 1760 x 990), so the threshold holds at both shapes. It was 1600 px, between the 1366 px
 * that overlapped and the 1920 px that did not on the layout before; 1680 is the narrowest screen measured without an
 * overlap now.
 */
export const OVERVIEW_MEMBER_LABELS_MIN_WIDTH = 1680;
/**
 * The characters' view names its members only on a screen at least this wide, in CSS pixels; narrower, it names the
 * Husk's and the commanders' placards alone. It frames the whole character row, 27.2 m from the idle Husk to Bulwark's
 * attack since Pip's attack member joined his row (24.6 m before): measured on the GPU with every member label forced
 * on, at 375 x 667 and 390 x 844 seven pairs of member labels overlapped (neighbours in each of the three rows) and
 * Bulwark's "Attack" ran 1.1 px off the right edge at 375 x 667, and at 667 x 375 and the nine larger sizes measured
 * none. 640 still lies between the widest screen that overlapped and the narrowest that did not.
 */
export const CHARACTERS_MEMBER_LABELS_MIN_WIDTH = 640;
/**
 * The narrowest screen, in CSS pixels, on which a family's view names its members, for each family whose member labels
 * crowd below it; narrower, the view names the family alone, as the overview does, and each member stays one step away
 * in its own view and in the panel's member list. The Verdant kit's eight pieces stand 4.1 m apart on an arc 25 m across,
 * which a portrait phone fits into its width: at 375 x 667 six pairs of their labels overlapped and "Flowers" ran 9.7 px
 * off the left edge, one pair still overlapped at 667 x 375 and at 768 x 1024, and from 1024 x 768 up none did. The
 * commanders' zone holds seven members across 18 m since Pip's attack joined it: measured on the GPU, at 375 x 667 two
 * pairs of its labels overlapped (Pip's "Face" and "Attack" by 3.0 px, Bulwark's "Run" and "Attack" by 1.2 px) and at
 * 390 x 844 one (1.3 px), and at 667 x 375 and the nine larger sizes none, so it takes the characters' 640 px.
 */
export const FAMILY_MEMBER_LABELS_MIN_WIDTH: Readonly<Record<string, number>> = { env: 1024, commanders: 640 };

/** The views the page opens, besides one per family and one per member. */
export const OVERVIEW = 'overview';
/** The Husk's row and the commanders' (Pip's and Bulwark's) together, the page's one view of every character clip at once. */
export const CHARACTERS = 'characters';
/** The zones the characters' view frames, by zone key (a member's `zone`): the Husk's and the commanders'. */
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

/**
 * A family placard's key among the labels, apart from the members' names; in a zone that hangs one placard per character
 * (the commanders'), the character's manifest entry follows.
 */
export function familyLabelKey(family: string, entry: string | null = null): string {
  return entry ? `family:${family}:${entry}` : `family:${family}`;
}

/** Whether a name is a view's, as `?family=` takes it: the overview, the characters or a zone's family. */
export function isViewName(name: string): boolean {
  return name === OVERVIEW || name === CHARACTERS || ZONES.some((zone) => zone.family === name);
}

/** The members a view frames, or null for a name that is no view. */
export function membersOf(focus: string, members: readonly PlacedMember[]): PlacedMember[] | null {
  if (focus === OVERVIEW) return [...members];
  if (focus === CHARACTERS) return members.filter((entry) => CHARACTER_FAMILIES.includes(entry.member.zone));
  if (ZONES.some((zone) => zone.family === focus)) return members.filter((entry) => entry.member.zone === focus);
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

/** The least half-size an open view frames: a member's own view's, or the overview's and a family's. */
export function fitFloorOf(open: OpenView): number {
  return open.member ? MEMBER_MIN_FIT_HALF_SIZE : MIN_FIT_HALF_SIZE;
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
 * members' names, which stand over the members. A character's placard in a shared zone hangs across the middle of his
 * row (`members`) and in front of the whole zone (`zone`), so the zone's placards stand in one line.
 */
export function familyLabelAnchor(members: readonly PlacedMember[], ground: Ground, zone: readonly PlacedMember[] = members): Vector3 {
  let front = Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (const corner of boundsCorners(zone)) front = Math.min(front, fromTangent(corner.x, corner.z).d);
  for (const corner of boundsCorners(members)) {
    const { s } = fromTangent(corner.x, corner.z);
    left = Math.min(left, s);
    right = Math.max(right, s);
  }
  const { x, z } = toTangent((left + right) / 2, front - FAMILY_LABEL_GAP);
  return ground.surfaceAt(x, z).position.clone();
}

/**
 * Every label the world shows: a placard under each zone with members, naming the family with its key as a second
 * line, and a label over each member that has one (a family's only member has none; its placard names it), whose second
 * line, its family's name, shows only in the member's own view. A zone whose members show more than one character, the
 * commanders', hangs a placard under each character's row instead, naming him ("Pip (commander)", "Bulwark") over the
 * zone's key, and each of its members' second lines names its character, so the overview and every close view say
 * whose clips are whose while the member labels stay short.
 */
export function labelSpecs(members: readonly PlacedMember[], ground: Ground): LabelSpec[] {
  const specs: LabelSpec[] = [];
  for (const zone of ZONES) {
    const own = members.filter((entry) => entry.member.zone === zone.family);
    if (!own.length) continue;
    const entries = [...new Set(own.map((entry) => entry.member.entry))];
    const byCharacter = entries.length > 1 && own.every((entry) => entry.member.character !== null);
    if (!byCharacter) {
      specs.push({ key: familyLabelKey(zone.family), kind: 'family', family: zone.family, text: zone.label, detail: zone.family, anchor: familyLabelAnchor(own, ground) });
      continue;
    }
    for (const name of entries) {
      const row = own.filter((entry) => entry.member.entry === name);
      const text = row[0]!.member.character as string;
      specs.push({ key: familyLabelKey(zone.family, name), kind: 'family', family: zone.family, text, detail: zone.family, anchor: familyLabelAnchor(row, ground, own) });
    }
  }
  for (const entry of members) {
    const { member } = entry;
    if (!member.label) continue;
    // The second line names the member's character in a shared zone ("Face" reads "Pip (commander)"), else its zone.
    const zone = ZONES.find((candidate) => candidate.family === member.zone);
    specs.push({ key: member.name, kind: 'member', family: member.zone, text: member.label, line: member.character ?? zone?.label ?? member.zone, anchor: memberLabelAnchor(entry) });
  }
  return specs;
}

/**
 * Which labels an open view shows, as a test on a label, resolved once per view so the frame loop only calls it. The
 * overview names every family, and on a wide screen every member too; the characters' view names both character
 * families and, past a phone's width (CHARACTERS_MEMBER_LABELS_MIN_WIDTH), their members; a family's view names the
 * family and, on a screen wide enough to part their labels
 * (FAMILY_MEMBER_LABELS_MIN_WIDTH), its members. A member's view names the member alone, its label carrying the family's
 * name: its family's placard stands in front of the whole zone, and framing it too took an end-of-row member's camera
 * back until the zone fitted (the flowers at 29.1 m on a phone, against 7.5 m for the flowers alone, both at the 1.2 m
 * floor member views then had). A family's only member has no label, so its view shows its family's placard, which
 * stands just in front of it. Other families' names stay off a close view, where they would crowd its edges.
 */
export function labelRule(open: OpenView, members: readonly PlacedMember[], context: LabelContext): (spec: Pick<LabelSpec, 'kind' | 'key' | 'family'>) => boolean {
  if (!context.labels) return () => false;
  if (open.member) {
    const entry = members.find((candidate) => candidate.member.name === open.member);
    if (!entry) return () => false;
    const { zone, label } = entry.member;
    return label ? (spec) => spec.kind === 'member' && spec.key === open.member : (spec) => spec.kind === 'family' && spec.family === zone;
  }
  if (open.view === OVERVIEW) {
    const everyMember = context.widthPx >= OVERVIEW_MEMBER_LABELS_MIN_WIDTH;
    return (spec) => spec.kind === 'family' || everyMember;
  }
  const named = (spec: Pick<LabelSpec, 'kind' | 'family'>): boolean => spec.kind === 'family' || context.widthPx >= (FAMILY_MEMBER_LABELS_MIN_WIDTH[spec.family] ?? 0);
  if (open.view === CHARACTERS) {
    const membersNamed = context.widthPx >= CHARACTERS_MEMBER_LABELS_MIN_WIDTH;
    return (spec) => CHARACTER_FAMILIES.includes(spec.family) && (spec.kind === 'family' || membersNamed) && named(spec);
  }
  return (spec) => spec.family === open.view && named(spec);
}

/**
 * The camera pose that frames the points from the cameras' bearing at a pitch, as close as keeps every point, and the
 * room its label takes, within FIT_NDC of the frame's middle, and centred on them: the distance is searched (a point's
 * reach from the middle falls as the camera backs away), then the target shifts to centre the points' screen extent,
 * twice over. So a portrait phone backs away until a row's width fits and a wide screen until its height does, and a
 * zone fills its frame instead of floating in a sphere fitted around it. Points closer together than the least
 * half-size (fitFloorOf) are framed as if they spread that far from their middle in every direction.
 */
export function fitPoints(points: readonly FitPoint[], pitchDeg: number, lens: Lens, minHalfSize = MIN_FIT_HALF_SIZE): ViewPose {
  const camera = new PerspectiveCamera(lens.fov, lens.aspect, 0.05, 5000);
  const pitch = (pitchDeg * Math.PI) / 180;
  const toward = new Vector3(TOWARD_CAMERAS.x * Math.cos(pitch), Math.sin(pitch), TOWARD_CAMERAS.z * Math.cos(pitch));
  const box = new Box3().setFromPoints(points.map((entry) => entry.point));
  const target = box.getCenter(new Vector3());
  const padded = [...points];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) padded.push({ point: target.clone().add(new Vector3(x, y, z).multiplyScalar(minHalfSize)) });
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
  const radius = Math.max(box.getSize(new Vector3()).length() / 2, minHalfSize * Math.sqrt(3));
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

/**
 * The pose the page opens a view in: its points (viewPoints) fitted at its pitch and above its least half-size, or null
 * when it frames no member.
 */
export function frameView(open: OpenView, members: readonly PlacedMember[], specs: readonly LabelSpec[], context: LabelContext, lens: Lens): ViewPose | null {
  const points = viewPoints(open, members, specs, context);
  return points ? fitPoints(points, pitchOf(open), lens, fitFloorOf(open)) : null;
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
    if (found) open = { view: found.zone, member: found.name };
    else problems.push(`no member named "${member}"`);
  }
  if (family) {
    if (!isViewName(family)) problems.push(`no family named "${family}"`);
    else open ??= { view: family, member: '' };
  }
  return { open: open ?? { view: OVERVIEW, member: '' }, problems };
}

/**
 * The query "Open this look in the Style Lab" opens: the look on screen as a dials link and, from one of Bulwark's
 * members, `commander=bulwark`, so the lab shows the commander on screen. Anywhere else it opens on the lab's default
 * commander, Pip, the one the world's commanders' zone leads with.
 */
export function styleLabQuery(encodedDials: string, member: string): string {
  const entry = MEMBERS.find((m) => m.name === member)?.entry;
  return `?dials=${encodedDials}${entry === 'bulwark' ? '&commander=bulwark' : ''}`;
}
