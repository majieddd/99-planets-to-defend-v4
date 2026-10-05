/**
 * The Asset World's placement registry: every model the manifest lists, and every piece of it the runtime stands on the
 * ground by itself, has a place here, and every texture has a reason it is not shown. The layout is plain data, so the
 * unit test reads it without a renderer, and a manifest entry with no place fails that test by name
 * (tests/unit/labs/world-registry.test.ts) before it can silently miss the world.
 *
 * Positions are metres on the world's view frame: s runs to the right as the cameras see it and d away from them, both
 * on the plane tangent at the pole that patch.surfaceAt takes, with the world's centre on the pole. Every camera looks
 * along +d, from WORLD_FACING_DEG, so each zone is a row across the view and each member faces the cameras.
 */

import { COMMANDER_LABELS } from '../shared/commanders';

/**
 * The bearing, from the world's centre toward its cameras, in degrees from +x toward +z (the Style Lab's convention).
 * The Verdant key's azimuth of 250 degrees puts the sun at bearing 200 on this plane, so from 145 every view has the
 * key 55 degrees behind it and to its left: the members are lit three quarters from the front, their shadow side still
 * turned partly to the camera, and their long golden-hour shadows fall away from the cameras and to the right, behind
 * the member rather than across its neighbour.
 */
export const WORLD_FACING_DEG = 145;

/** The Verdant kit stands on an arc around the centre, on the cameras' side, from its left end to its right. */
export const KIT_ARC_RADIUS = 17;
export const KIT_ARC_SPAN_DEG = 96;
/** The rows' depths along d, front to back, and the spacing of the members across each row, all in metres. */
export const TOWER_ROW_DEPTH = -9;
export const TOWER_ROW_START = -7.6;
export const TOWER_SPACING = 3.2;
export const NEST_SPOT = { s: 4.6, d: -9 } as const;
export const CHARACTER_ROW_DEPTH = 0;
export const CHARACTER_SPACING = 2.6;
/** The gap between one character's row and the next, in metres, so the Husk, Pip and Bulwark read apart. */
export const CHARACTER_ROW_GAP = 4;
/**
 * The gap between Pip's row and Bulwark's, a metre wider, because each commander's row hangs a placard of its own: at
 * 4 m, "Pip (commander)" and "Bulwark" overlapped by 2.6 px in a 375 x 667 phone's overview and by 8.8 px at 667 x 375.
 */
export const COMMANDER_ROW_GAP = 5;
/**
 * The Husk's three clips from s -6.4 m. Pip's row starts CHARACTER_ROW_GAP past the Husk's last member, and Bulwark's
 * COMMANDER_ROW_GAP past Pip's. The Husk's row stays where it stood when the idle Husk joined: at -9 m, past the level
 * clearing, the ground under a plumb Husk's feet strayed 7.9 cm from level.
 */
export const HUSK_ROW_START = -6.4;
export const HEART_ROW_DEPTH = 12.5;
export const HEART_ROW_START = -5.4;
export const HEART_SPACING = 3.6;

/**
 * How far each kind of member's up leans from the planet's up toward the ground's normal (place()'s alignToGround).
 * The characters stand plumb, on the level clearing at the pole. The structures (the towers, the hearts and the nest)
 * stand on broad plinths and mounds, 1.9 to 3.2 m across, on the 1 to 8 degree slopes around it. Plumb, as the Style
 * Lab stands its heart on the level clearing, their footprints' edges strayed up to 13.5 cm from the ground, and at the
 * Style Lab's tower lean of 0.5 up to 7.6 cm; at 0.8 none strays more than 4.4 cm (the stage 0 heart, where the ground
 * curves under its plinth, which no lean can follow), and none leans more than 6.1 degrees. Rocks lie as close to their
 * slope (the Style Lab's 0.8), and the flora stands close to plumb (its 0.2).
 */
export const LEAN = { plumb: 0, structure: 0.8, rock: 0.8, flora: 0.2 } as const;

/**
 * Degrees the characters and the towers turn from facing the cameras toward the key's side (the cameras' left), so the
 * lit three-quarter face and a barrel's length show instead of a flat front.
 */
export const THREE_QUARTER_TURN_DEG = 30;

/** The level the slider heart opens at, between the fixed stages so it reads as a fourth heart and not a copy. */
export const LIVE_HEART_START_LEVEL = 7;

export interface WorldZone {
  /** The zone's key, the value `?family=` takes: a manifest family. */
  family: string;
  label: string;
}

export interface WorldMember {
  /** Unique in the world, the value `?member=` takes, and the name `__P99__.placed` lists. */
  name: string;
  /** The manifest entry the member comes from. */
  entry: string;
  /** The placeable inside the entry (a kit piece, a tower mark), or null for the whole asset. */
  node: string | null;
  /** The manifest family of the entry, which the coverage check holds it to. */
  family: string;
  /**
   * The zone the member stands in, the key of one of ZONES: its family's. Kept apart from the family because a preview
   * once stood in a zone of its own (Pip's, before he became the default commander); the coverage check still holds every
   * member's zone to ZONES.
   */
  zone: string;
  /** Shown over the member when its family is in focus; null for a family's only member, which its zone names. */
  label: string | null;
  /**
   * The character the member shows, in a zone that holds more than one (the commanders'): its row's placard names him,
   * and so does the second line of the member's label in its own view. Null in a zone of one character or none.
   */
  character: string | null;
  s: number;
  d: number;
  /** Degrees turned from facing the cameras toward the key's side. */
  turnDeg: number;
  lean: number;
  /** The clip the member loops in place, or null for a static member. */
  clip: string | null;
  /** The heart stage shown, 'live' for the slider's heart, or null for anything but a heart. */
  heartStage: number | 'live' | null;
  /**
   * Whether the member's face cycles the held-expression demo (labs/shared/commanderFace.ts) over its idle. Every
   * member whose rig has a face blinks on its own either way.
   */
  faceDemo: boolean;
}

export const ZONES: readonly WorldZone[] = [
  { family: 'env', label: 'Verdant kit' },
  { family: 'towers', label: 'Bolt Sentinel' },
  { family: 'nests', label: 'Nest' },
  { family: 'xeno', label: 'Husk' },
  { family: 'commanders', label: 'Commanders' },
  { family: 'heart', label: 'Worldheart' },
];

/** The kit's pieces from the arc's left end to its right: the small flora first and the trees last, at the right end,
 * where their long shadows fall off the world instead of across a row behind them. */
const KIT_ORDER: readonly [node: string, label: string, lean: number][] = [
  ['flowers', 'Flowers', LEAN.flora],
  ['grass_tuft', 'Grass tuft', LEAN.flora],
  ['bush', 'Bush', LEAN.flora],
  ['rock_c', 'Rock C', LEAN.rock],
  ['rock_a', 'Rock A', LEAN.rock],
  ['rock_b', 'Rock B', LEAN.rock],
  ['tree_conifer', 'Conifer', LEAN.flora],
  ['tree_broad', 'Broad tree', LEAN.flora],
];

function member(fields: Partial<WorldMember> & Pick<WorldMember, 'name' | 'entry' | 'family' | 's' | 'd'>): WorldMember {
  return { node: null, label: null, character: null, turnDeg: 0, lean: LEAN.plumb, clip: null, heartStage: null, zone: fields.family, faceDemo: false, ...fields };
}

const kit = KIT_ORDER.map(([node, label, lean], index): WorldMember => {
  const phi = ((-KIT_ARC_SPAN_DEG / 2 + (index * KIT_ARC_SPAN_DEG) / (KIT_ORDER.length - 1)) * Math.PI) / 180;
  return member({ name: node, entry: 'verdant_kit', node, family: 'env', label, s: KIT_ARC_RADIUS * Math.sin(phi), d: -KIT_ARC_RADIUS * Math.cos(phi), lean });
});

const towers = ['I', 'II', 'III'].map((numeral, index) =>
  member({
    name: `bolt_mk${index + 1}`,
    entry: 'bolt_sentinel',
    node: `bolt_mk${index + 1}`,
    family: 'towers',
    label: `Mark ${numeral}`,
    s: TOWER_ROW_START + index * TOWER_SPACING,
    d: TOWER_ROW_DEPTH,
    turnDeg: THREE_QUARTER_TURN_DEG,
    lean: LEAN.structure,
  }),
);

/** One character member of a row: its name, its label, the clip it loops and whether its face cycles the demo. */
type CharacterSlot = readonly [name: string, label: string, clip: string, faceDemo: boolean];

/**
 * A character's members side by side along the character row from `start`, CHARACTER_SPACING apart, naming the
 * character when its zone holds another.
 */
const characterRow = (entry: string, family: string, start: number, character: string | null, slots: readonly CharacterSlot[]): WorldMember[] =>
  slots.map(([name, label, clip, faceDemo], index) =>
    member({ name, entry, family, label, character, s: start + index * CHARACTER_SPACING, d: CHARACTER_ROW_DEPTH, turnDeg: THREE_QUARTER_TURN_DEG, clip, faceDemo }),
  );

/** Where the row after one ends begins: a gap past its last member. */
const nextRowStart = (row: readonly WorldMember[], gap = CHARACTER_ROW_GAP): number => Math.max(...row.map((m) => m.s)) + gap;

/** The Husk alone in its zone, so its labels name the clip only, as the placard names the Husk. */
const huskRow = characterRow('husk', 'xeno', HUSK_ROW_START, null, [
  ['husk_idle', 'Idle', 'idle', false],
  ['husk_walk', 'Walk', 'walk', false],
  ['husk_attack', 'Attack', 'attack', false],
]);

/**
 * Pip (commander), the default commander, leads the commanders' zone, first in its order and on the level clearing next
 * to the Husk: idle and running, each blinking on its own, a third idle whose face cycles the held-expression demo, and
 * his attack, last, so the members measured before it stayed where they stood. Bulwark's row, which starts from the end
 * of this one, stepped 2.6 m further out when the attack joined, and WORLD_REACH with the sun's box, the views' fits and
 * the label anchors moved with it; what does not follow the layout by itself (the label width thresholds in views.ts,
 * the shadow figures in sun.ts and Bulwark's ground contact on the slope past the clearing) was measured again then
 * (Asset World layout). The two commanders share a zone, so each row's placard names its commander ("Pip (commander)",
 * the name the labs give him until the owner names the character) and the member labels stay as short as the Husk's: a
 * label that named him too, "Pip (commander) idle", overlapped its neighbours by 68 px in the 1920 x 1080 overview, and
 * still by 39 px at 2560 x 1440. The member names stay as they were (`pip_face` is the face member's address).
 */
const pipRow = characterRow('commander_pip', 'commanders', nextRowStart(huskRow), COMMANDER_LABELS.pip, [
  ['pip_idle', 'Idle', 'idle', false],
  ['pip_run', 'Run', 'run', false],
  ['pip_face', 'Face', 'idle', true],
  ['pip_attack', 'Attack', 'attack', false],
]);

/** Bulwark, the alternate commander, after Pip in the commanders' zone: idle, running and attacking. */
const bulwarkRow = characterRow('bulwark', 'commanders', nextRowStart(pipRow, COMMANDER_ROW_GAP), COMMANDER_LABELS.bulwark, [
  ['bulwark_idle', 'Idle', 'idle', false],
  ['bulwark_run', 'Run', 'run', false],
  ['bulwark_attack', 'Attack', 'attack', false],
]);

/**
 * Where Pip's row and Bulwark's begin along s, in metres: 2.8 m, on the level clearing, and, with Pip's four members,
 * 15.6 m, past it, since Bulwark's row follows the end of Pip's.
 */
export const PIP_ROW_START = pipRow[0]!.s;
export const BULWARK_ROW_START = bulwarkRow[0]!.s;

const hearts = ([0, 5, 10, 'live'] as const).map((stage, index) =>
  member({
    name: stage === 'live' ? 'worldheart_live' : `worldheart_stage_${String(stage).padStart(2, '0')}`,
    entry: 'worldheart',
    family: 'heart',
    // The slider heart's label names its stage at run time, as the slider moves it.
    label: stage === 'live' ? 'Slider' : `Stage ${stage}`,
    s: HEART_ROW_START + index * HEART_SPACING,
    d: HEART_ROW_DEPTH,
    lean: LEAN.structure,
    heartStage: stage,
  }),
);

export const MEMBERS: readonly WorldMember[] = [
  ...kit,
  ...towers,
  member({ name: 'nest', entry: 'nest', family: 'nests', s: NEST_SPOT.s, d: NEST_SPOT.d, lean: LEAN.structure }),
  ...huskRow,
  ...pipRow,
  ...bulwarkRow,
  ...hearts,
];

/** Textures are read by the materials, not stood on the ground, so each is accounted for by the reason it is not shown. */
export const NON_PLACEABLE: Readonly<Record<string, string>> = {
  brush_strokes: 'the brush atlas the painted materials, the terrain and the sky read their strokes from; used by materials, not shown as a model',
  ink_noise: 'the noise the screen-space edge ink wobbles by; used by the ink pass, not shown as a model',
};

/**
 * Clips a model exports that no member loops, each keyed `entry/clip` with the reason it is not shown. Every clip is
 * shown today, so the table is empty; a clip added to a GLB fails the coverage check by name until it has a member or
 * a reason here, and a reason fails it too once its clip leaves the manifest or a member loops it.
 */
export const CLIPS_NOT_SHOWN: Readonly<Record<string, string>> = {};

/**
 * Whether CLIPS_NOT_SHOWN, or the table given, explains a clip of a manifest entry: a blank reason is no reason. The
 * coverage check and the tests that list unlooped clips all ask this, so a written reason passes all of them; the
 * browser test and the registry test once asked only whether a member looped the clip, and failed a reason the
 * coverage check accepted.
 */
export function clipHasReason(entry: string, clip: string, clipsNotShown: Readonly<Record<string, string>> = CLIPS_NOT_SHOWN): boolean {
  return Boolean(clipsNotShown[`${entry}/${clip}`]?.trim());
}

/** The part of public/assets/manifest.json the coverage check reads. */
export interface CoverageManifest {
  assets: readonly {
    name: string;
    kind: string;
    family: string;
    nodes: readonly string[];
    animations?: readonly { name: string }[];
    ground?: readonly { node: string | null }[];
  }[];
}

/**
 * The placeables of a model entry the world has to stand on the ground, from the manifest's ground records, which M0c's
 * asset check writes for exactly the roots the runtime places: when a record names the whole asset (node null), the
 * asset is placed whole and that covers it; otherwise each named node is a placeable of its own (a kit piece, a tower
 * mark) and each must be placed.
 */
export function requiredPieces(entry: CoverageManifest['assets'][number]): string[] {
  const ground = entry.ground ?? [];
  if (ground.length === 0 || ground.some((record) => record.node === null)) return [];
  return ground.map((record) => record.node as string);
}

/**
 * One sentence per gap between the manifest and the registry, each naming the entry, piece, clip or texture: an empty
 * list means every entry is accounted for. A model with no member, a placeable the world leaves out, a kit piece with no
 * place, a clip no member loops and CLIPS_NOT_SHOWN does not explain, and a texture that is neither placed nor given a
 * reason each fail; so does a member whose entry the manifest no longer lists, or whose family disagrees with its
 * entry's, or that loops a clip its entry does not export (a member put in before its clip ships), and a
 * CLIPS_NOT_SHOWN reason whose clip the manifest no longer lists or a member loops. The clips were once left out: the
 * Husk's idle shipped in its GLB and the world showed only its walk and attack, while the blueprint promised every
 * animation.
 */
export function coverageGaps(
  manifest: CoverageManifest,
  members: readonly WorldMember[] = MEMBERS,
  textures: Readonly<Record<string, string>> = NON_PLACEABLE,
  clipsNotShown: Readonly<Record<string, string>> = CLIPS_NOT_SHOWN,
): string[] {
  const gaps: string[] = [];
  const where = 'src/labs/world/registry.ts';
  for (const entry of manifest.assets) {
    const own = members.filter((m) => m.entry === entry.name);
    if (entry.kind === 'texture') {
      if (!textures[entry.name]?.trim()) gaps.push(`manifest texture "${entry.name}" is neither placed in the Asset World nor listed in NON_PLACEABLE with a reason (${where})`);
      continue;
    }
    if (own.length === 0) {
      gaps.push(`manifest entry "${entry.name}" (family ${entry.family}) has no layout in the Asset World registry (${where})`);
      continue;
    }
    for (const piece of requiredPieces(entry)) {
      if (!own.some((m) => m.node === piece)) gaps.push(`manifest entry "${entry.name}" has a placeable "${piece}" with no layout in the Asset World registry (${where})`);
    }
    // Every piece of an environment kit, whatever its ground record says, because the kit is the theme's vocabulary.
    if (entry.family === 'env') {
      for (const node of entry.nodes) {
        if (node && !own.some((m) => m.node === node)) gaps.push(`kit piece "${node}" of "${entry.name}" has no layout in the Asset World registry (${where})`);
      }
    }
    for (const { name: clip } of entry.animations ?? []) {
      if (own.some((m) => m.clip === clip) || clipHasReason(entry.name, clip, clipsNotShown)) continue;
      gaps.push(`manifest entry "${entry.name}" has a clip "${clip}" that no Asset World member loops and CLIPS_NOT_SHOWN gives no reason for (${where})`);
    }
    for (const m of own) {
      if (m.family !== entry.family) gaps.push(`member "${m.name}" sits in family ${m.family}, but its entry "${entry.name}" is in ${entry.family} (${where})`);
      if (m.node !== null && !entry.nodes.includes(m.node)) gaps.push(`member "${m.name}" places node "${m.node}", which "${entry.name}" does not have (${where})`);
      // A member for a clip the model does not ship, put in ahead of its clip, is named here, and the page leaves it out
      // instead of stopping when it builds the world (labs/world/main.ts).
      if (m.clip !== null && !(entry.animations ?? []).some((animation) => animation.name === m.clip)) {
        gaps.push(`member "${m.name}" loops a clip "${m.clip}" that "${entry.name}" does not export; add the member once the clip ships (${where})`);
      }
    }
  }
  for (const m of members) {
    if (!manifest.assets.some((entry) => entry.name === m.entry && entry.kind === 'model')) gaps.push(`member "${m.name}" comes from "${m.entry}", which the manifest does not list as a model (${where})`);
    // A zone no view knows would place the member where no view, label or panel list could reach it.
    if (!ZONES.some((zone) => zone.family === m.zone)) gaps.push(`member "${m.name}" stands in zone "${m.zone}", which ZONES does not list (${where})`);
  }
  // A reason must still explain something: one kept after its clip left the manifest, or after a member took the clip
  // up, would silently explain the next clip given that name, or say a shown clip is hidden.
  for (const key of Object.keys(clipsNotShown)) {
    const slash = key.indexOf('/');
    const entryName = slash < 0 ? key : key.slice(0, slash);
    const clip = slash < 0 ? '' : key.slice(slash + 1);
    const listed = manifest.assets.some((entry) => entry.name === entryName && entry.kind === 'model' && (entry.animations ?? []).some((animation) => animation.name === clip));
    const looping = members.find((m) => m.entry === entryName && m.clip === clip);
    if (!listed) gaps.push(`CLIPS_NOT_SHOWN gives a reason for "${key}", which is no clip the manifest lists; remove it (${where})`);
    else if (looping) gaps.push(`CLIPS_NOT_SHOWN gives a reason for "${key}", but member "${looping.name}" loops that clip; remove the reason (${where})`);
  }
  return gaps;
}

/**
 * The members a build can show, read from what loaded: each one whose model loaded and whose clip, if it loops one, the
 * loaded model carries (`loaded` maps each loaded model's entry to its clip names). The page builds only these, since a
 * member whose clip is missing would stop it with "has no clip". The coverage check reads the manifest instead, so the
 * two can disagree, for instance on a GLB rebuilt without a clip the manifest still lists: such a member used to drop
 * out of the world without a word. `unnamed` has one sentence for every member left out that none of `gaps`
 * (coverageGaps' sentences) already names, for the console and the banner.
 */
export function showableMembers(
  loaded: ReadonlyMap<string, readonly string[]>,
  gaps: readonly string[],
  members: readonly WorldMember[] = MEMBERS,
): { shown: WorldMember[]; unnamed: string[] } {
  const shown: WorldMember[] = [];
  const unnamed: string[] = [];
  for (const m of members) {
    const clips = loaded.get(m.entry);
    if (clips && (m.clip === null || clips.includes(m.clip))) {
      shown.push(m);
      continue;
    }
    if (gaps.some((gap) => gap.includes(`member "${m.name}"`))) continue;
    unnamed.push(
      clips
        ? `member "${m.name}" loops a clip "${m.clip}" that the loaded "${m.entry}" model does not carry, though the manifest lists it; rebuild the assets (npm run assets)`
        : `member "${m.name}" is left out because its model "${m.entry}" is not among the loaded models`,
    );
  }
  return { shown, unnamed };
}

const FACING = (WORLD_FACING_DEG * Math.PI) / 180;
/** Toward the cameras on the tangent plane, and the cameras' right. */
export const TOWARD_CAMERAS = { x: Math.cos(FACING), z: Math.sin(FACING) } as const;
export const CAMERA_RIGHT = { x: Math.sin(FACING), z: -Math.cos(FACING) } as const;

/** A view-frame point on the plane tangent at the pole. */
export function toTangent(s: number, d: number): { x: number; z: number } {
  return { x: s * CAMERA_RIGHT.x - d * TOWARD_CAMERAS.x, z: s * CAMERA_RIGHT.z - d * TOWARD_CAMERAS.z };
}

/** A point of the tangent plane on the view frame, toTangent's inverse (its two axes are perpendicular unit vectors). */
export function fromTangent(x: number, z: number): { s: number; d: number } {
  return { s: x * CAMERA_RIGHT.x + z * CAMERA_RIGHT.z, d: -(x * TOWARD_CAMERAS.x + z * TOWARD_CAMERAS.z) };
}

/**
 * The yaw place() takes for a member, radians about its up. A glTF model faces +Z, which a yaw of a turns to (sin a,
 * cos a) on the tangent plane, so facing the cameras is pi / 2 minus their bearing; a turn toward the key's side, the
 * cameras' left, raises the facing's bearing and so lowers the yaw.
 */
export function memberYaw(m: WorldMember): number {
  return Math.PI / 2 - FACING - (m.turnDeg * Math.PI) / 180;
}

/** The furthest any member's root stands from the world's centre on the tangent plane, in metres. */
export const WORLD_REACH = Math.max(...MEMBERS.map((m) => Math.hypot(m.s, m.d)));
