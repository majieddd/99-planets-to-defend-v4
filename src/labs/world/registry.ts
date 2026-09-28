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
/**
 * The Husk's three clips from s -6.4 m and Bulwark's from 2.8 m, 4 m apart. Bulwark's row moved one spacing right
 * when the idle Husk joined, rather than the Husk's row moving left: at -9 m, past the level clearing, the ground
 * under a plumb Husk's feet strayed 7.9 cm from level, and here the new idle Husk takes the walking Husk's old spot.
 */
export const HUSK_ROW_START = -6.4;
export const BULWARK_ROW_START = 2.8;
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
  /** The manifest family, and the value `?family=` takes. */
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
  family: string;
  /** Shown over the member when its family is in focus; null for a family's only member, which its zone names. */
  label: string | null;
  s: number;
  d: number;
  /** Degrees turned from facing the cameras toward the key's side. */
  turnDeg: number;
  lean: number;
  /** The clip the member loops in place, or null for a static member. */
  clip: string | null;
  /** The heart stage shown, 'live' for the slider's heart, or null for anything but a heart. */
  heartStage: number | 'live' | null;
}

export const ZONES: readonly WorldZone[] = [
  { family: 'env', label: 'Verdant kit' },
  { family: 'towers', label: 'Bolt Sentinel' },
  { family: 'nests', label: 'Nest' },
  { family: 'xeno', label: 'Husk' },
  { family: 'commanders', label: 'Bulwark' },
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
  return { node: null, label: null, turnDeg: 0, lean: LEAN.plumb, clip: null, heartStage: null, ...fields };
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

const characters = (entry: string, family: string, start: number, clips: readonly string[]): WorldMember[] =>
  clips.map((clip, index) =>
    member({
      name: `${entry}_${clip}`,
      entry,
      family,
      label: clip.charAt(0).toUpperCase() + clip.slice(1),
      s: start + index * CHARACTER_SPACING,
      d: CHARACTER_ROW_DEPTH,
      turnDeg: THREE_QUARTER_TURN_DEG,
      clip,
    }),
  );

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
  ...characters('husk', 'xeno', HUSK_ROW_START, ['idle', 'walk', 'attack']),
  ...characters('bulwark', 'commanders', BULWARK_ROW_START, ['idle', 'run', 'attack']),
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
 * entry's, and a CLIPS_NOT_SHOWN reason whose clip the manifest no longer lists or a member loops. The clips were once
 * left out: the Husk's idle shipped in its GLB and the world showed only its walk and attack, while the blueprint
 * promised every animation.
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
    }
  }
  for (const m of members) {
    if (!manifest.assets.some((entry) => entry.name === m.entry && entry.kind === 'model')) gaps.push(`member "${m.name}" comes from "${m.entry}", which the manifest does not list as a model (${where})`);
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
