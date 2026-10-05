import { readFileSync } from 'node:fs';
import {
  AnimationClip,
  BoxGeometry,
  Float32BufferAttribute,
  Frustum,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Vector3,
  type Object3D,
} from 'three';
import { describe, expect, it } from 'vitest';
import type { LoadedAsset, MaterialContext } from '../../../src/render/assets/loadAsset';
import { paintAndInk } from '../../../src/render/assets/loadAsset';
import { DEFAULT_DIALS } from '../../../src/render/defaults';
import { createHullMaterial, createInkUniforms } from '../../../src/render/ink/hull';
import { LAYERS } from '../../../src/render/layers';
import { createPaintUniforms } from '../../../src/render/materials/painted';
import { createStylePatch, STYLE_PLANET_RADIUS } from '../../../src/render/terrain/stylePatch';
import { VERDANT } from '../../../src/render/themes';
import { FACE_DEMO_BLEND_SECONDS, FACE_DEMO_HOLD_SECONDS, FACE_DEMO_STEPS, faceDemoWeights } from '../../../src/labs/shared/commanderFace';
import { NO_EDGE_PIECES } from '../../../src/labs/shared/meadow';
import type { LabelSpec } from '../../../src/labs/world/labels';
import { buildAssetWorld, HEART_STAGES, LABEL_AXIS_LINES, LABEL_AXIS_RADIUS, SHADOWLESS_PIECES, type AssetWorld, type PlacedMember } from '../../../src/labs/world/layout';
import { fromTangent, LIVE_HEART_START_LEVEL, MEMBERS, toTangent, WORLD_FACING_DEG, ZONES } from '../../../src/labs/world/registry';
import {
  boundsCorners,
  CHARACTER_FAMILIES,
  CHARACTERS,
  CHARACTERS_MEMBER_LABELS_MIN_WIDTH,
  familyLabelAnchor,
  familyLabelKey,
  FAMILY_MEMBER_LABELS_MIN_WIDTH,
  FIT_NDC,
  fitFloorOf,
  fitPoints,
  frameView,
  labelRule,
  labelSpecs,
  MEMBER_MIN_FIT_HALF_SIZE,
  MEMBER_PITCH_DEG,
  memberLabelAnchor,
  MIN_FIT_HALF_SIZE,
  OVERVIEW,
  OVERVIEW_MEMBER_LABELS_MIN_WIDTH,
  registryOverview,
  resolveAddress,
  styleLabQuery,
  viewPoints,
  type Lens,
  type OpenView,
  type ViewPose,
} from '../../../src/labs/world/views';

const paint = createPaintUniforms(VERDANT, DEFAULT_DIALS, null);
const hullMaterial = createHullMaterial(createInkUniforms(DEFAULT_DIALS));
const ctx: MaterialContext = { paint, hullMaterial, hullLayer: LAYERS.hull };
// surfaceAt is analytic, so a coarse patch places everything exactly where a tier's patch would.
const patch = createStylePatch(VERDANT, paint, 32);
const CENTER = new Vector3(0, -STYLE_PLANET_RADIUS, 0);
const UP = new Vector3(0, 1, 0);

interface ManifestModel {
  name: string;
  kind: string;
  nodes: string[];
  animations: { name: string }[];
  morphs?: string[];
}
const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')) as { assets: ManifestModel[] };

/**
 * Stand-in sizes, width and height in metres, rounded from the shipped assets as the world draws them (measured in the
 * browser from __P99__.bounds() on 2026-09-28), so a view's fit meets the proportions it meets on the page: a flower
 * smaller than even a member view's MEMBER_MIN_FIT_HALF_SIZE, a tree taller than a phone frame is wide, a heart's stage
 * 10 over five metres.
 */
const KIT_SIZE: Readonly<Record<string, readonly [number, number]>> = {
  flowers: [0.4, 0.45],
  grass_tuft: [0.45, 0.68],
  bush: [1.4, 1],
  rock_c: [1.5, 1.46],
  rock_a: [1.8, 1.06],
  rock_b: [2.4, 1.04],
  tree_conifer: [2, 3.6],
  tree_broad: [3, 4.2],
};
const TOWER_SIZE: readonly (readonly [number, number])[] = [
  [2.1, 0.85],
  [2.3, 1.22],
  [2.8, 1.65],
];
const CHARACTER_SIZE: Readonly<Record<string, readonly [number, number]>> = { husk: [1.9, 1.2], bulwark: [1.3, 2.3], commander_pip: [1, 1.8] };
/**
 * The value Pip-A's stand-in idle clip keys on blink_L, as a clip that carried a face track would: the face driver runs
 * after the mixer, so the lids it draws must be its own, never this.
 */
const CLIP_BLINK = 0.7;
/** Bulwark's upright sword, beside his body: taller than him, and further from his up line than LABEL_AXIS_RADIUS. */
const SWORD = { offset: 0.5, width: 0.08, height: 2.6 };

/** A painted, inked box standing on its node's origin, so its lowest face is the ground contact. */
function box(name: string, width = 0.6, height = width): Mesh {
  const geometry = new BoxGeometry(width, height, width).translate(0, height / 2, 0);
  const mesh = new Mesh(geometry, new MeshStandardMaterial());
  mesh.name = name;
  return mesh;
}

/**
 * Stand-ins shaped like each shipped GLB where the world reads it: the kit's pieces are mesh nodes carrying a
 * quantization-like matrix (an offset and a scale that the geometry undoes, as gltf-transform leaves them), the tower
 * marks are empties with a head on a yaw node, the heart has its plinth and eleven stages, and the characters carry one
 * clip per name the manifest lists, each moving a named part differently; Bulwark holds a sword beside his body.
 */
function standIns(): Map<string, LoadedAsset> {
  const assets = new Map<string, LoadedAsset>();
  for (const entry of manifest.assets.filter((asset) => asset.kind === 'model')) {
    const root = new Group();
    const animations: AnimationClip[] = [];
    if (entry.name === 'verdant_kit') {
      for (const node of entry.nodes) {
        const [width, height] = KIT_SIZE[node] ?? [0.6, 0.6];
        const piece = box(node, width, height);
        // The node's matrix is a quantization box, and the geometry is authored inside it so the piece's origin is the
        // kit's: an offset of (0.3, 0.2, -0.1) at scale 2 is undone by moving the geometry back by it and halving it.
        piece.position.set(0.3, 0.2, -0.1);
        piece.scale.setScalar(2);
        piece.geometry.translate(-0.3, -0.2, 0.1).scale(0.5, 0.5, 0.5);
        root.add(piece);
      }
    } else if (entry.name === 'bolt_sentinel') {
      for (const level of [1, 2, 3]) {
        const [width, height] = TOWER_SIZE[level - 1]!;
        const mark = new Group();
        mark.name = `bolt_mk${level}`;
        const base = box(`bolt_mk${level}_base`, width, height - 0.4);
        const yaw = box(`bolt_mk${level}_yaw`, 0.6, 0.4);
        yaw.position.y = height - 0.4;
        base.add(yaw);
        mark.add(base);
        root.add(mark);
      }
    } else if (entry.name === 'worldheart') {
      root.add(box('heart_plinth', 2.6, 0.6));
      for (let level = 0; level < HEART_STAGES; level++) {
        const stage = box(`heart_stage_${String(level).padStart(2, '0')}`, 0.8, 1.26 + 0.38 * level);
        stage.position.y = 0.6;
        root.add(stage);
      }
    } else {
      const [width, height] = CHARACTER_SIZE[entry.name] ?? [1.2, 1.2];
      const part = box(`${entry.name}_part`, width, height);
      root.add(part);
      if (entry.name === 'bulwark') {
        const sword = box('bulwark_sword', SWORD.width, SWORD.height);
        sword.position.x = SWORD.offset;
        root.add(sword);
      }
      // The face morphs the manifest lists, which three names from the morph attributes (Mesh.updateMorphTargets), so the
      // world gives the stand-in a face driver as it does the shipped Pip-A.
      if (entry.morphs?.length) {
        const count = part.geometry.getAttribute('position').count;
        part.geometry.morphAttributes['position'] = entry.morphs.map((name) => {
          const target = new Float32BufferAttribute(new Float32Array(count * 3), 3);
          target.name = name;
          return target;
        });
        part.geometry.morphTargetsRelative = true;
        part.updateMorphTargets();
        // Inked, so the stand-in has a hull to share its morphs with, as the shipped body does.
        part.geometry.setAttribute('_ink', new Float32BufferAttribute(new Float32Array(count).fill(0.5), 1));
      }
      entry.animations.forEach((clip, index) => {
        const tracks = [new NumberKeyframeTrack(`${entry.name}_part.rotation[y]`, [0, 1], [0, index + 1])];
        if (entry.morphs?.includes('blink_L')) tracks.push(new NumberKeyframeTrack(`${entry.name}_part.morphTargetInfluences[blink_L]`, [0, 1], [CLIP_BLINK, CLIP_BLINK]));
        animations.push(new AnimationClip(clip.name, 1, tracks));
      });
    }
    paintAndInk(root, ctx, 0.1);
    root.name = entry.name;
    assets.set(entry.name, { root, animations });
  }
  return assets;
}

function build(): { assets: Map<string, LoadedAsset>; world: AssetWorld; kitRelative: Map<string, Matrix4> } {
  const assets = standIns();
  const kit = assets.get('verdant_kit')!.root;
  kit.updateMatrixWorld(true);
  const kitInverse = kit.matrixWorld.clone().invert();
  const kitRelative = new Map(kit.children.map((piece) => [piece.name, kitInverse.clone().multiply(piece.matrixWorld)]));
  return { assets, world: buildAssetWorld(patch, assets, ctx, MEMBERS), kitRelative };
}

function worldPosition(object: Object3D): Vector3 {
  object.updateWorldMatrix(true, false);
  return new Vector3().setFromMatrixPosition(object.matrixWorld);
}

function visibleStages(root: Object3D): number[] {
  return Array.from({ length: HEART_STAGES }, (_, level) => level).filter((level) => root.getObjectByName(`heart_stage_${String(level).padStart(2, '0')}`)!.visible);
}

/** Every drawn vertex of a member in world space, ink hulls left out, read independently of layout.ts. */
function drawnVertices(root: Object3D): Vector3[] {
  const out: Vector3[] = [];
  root.updateMatrixWorld(true);
  root.traverseVisible((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || mesh.material === hullMaterial) return;
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) out.push(new Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld));
  });
  return out;
}

describe('buildAssetWorld', () => {
  it('places every registry member, each root on the ground point its layout names, facing as the registry turns it', () => {
    const { world } = build();
    expect(world.members.map((entry) => entry.member.name)).toEqual(MEMBERS.map((m) => m.name));
    for (const { member, root } of world.members) {
      const { x, z } = toTangent(member.s, member.d);
      const ground = patch.surfaceAt(x, z);
      expect(worldPosition(root).distanceTo(ground.position), member.name).toBeLessThan(1e-9);
      // Measured independently of the layout: the root's own world position, taken back to the tangent plane, is on
      // the ground there, which is the check the browser test makes on the real assets.
      const p = worldPosition(root).sub(CENTER);
      const under = patch.surfaceAt((p.x / p.y) * STYLE_PLANET_RADIUS, (p.z / p.y) * STYLE_PLANET_RADIUS);
      expect(worldPosition(root).distanceTo(under.position), member.name).toBeLessThan(1e-9);
      // Its up leans as far toward the ground's normal as the registry says, and nothing sits between it and the world.
      root.updateWorldMatrix(true, false);
      const up = new Vector3(0, 1, 0).transformDirection(root.matrixWorld);
      expect(up.distanceTo(ground.up.clone().lerp(ground.normal, member.lean).normalize()), member.name).toBeLessThan(1e-9);
      expect(root.parent, member.name).toBe(world.root);
      // Its face: the root's +Z, carried back to the pole along the shortest turn from its up to the pole's up (the
      // turn place() stands it on), lies on the tangent plane at the bearing the registry gives, WORLD_FACING_DEG toward
      // the cameras plus the member's turn toward the key's side. A glTF model faces +Z.
      const face = new Vector3(0, 0, 1).transformDirection(root.matrixWorld).applyQuaternion(new Quaternion().setFromUnitVectors(up, UP));
      expect(Math.abs(face.y), member.name).toBeLessThan(1e-9);
      const bearing = (Math.atan2(face.z, face.x) * 180) / Math.PI;
      const expected = WORLD_FACING_DEG + member.turnDeg;
      expect(Math.abs((((bearing - expected) % 360) + 540) % 360 - 180), `${member.name} faces ${bearing.toFixed(3)} degrees, not ${expected}`).toBeLessThan(1e-9);
    }
  });

  it('stands a tower mark, an empty, on the ground itself, and a kit piece, a mesh node, inside a holder that keeps its matrix', () => {
    const { assets, world, kitRelative } = build();
    for (const level of [1, 2, 3]) {
      const mark = world.members.find((entry) => entry.member.name === `bolt_mk${level}`)!;
      expect(mark.root.name).toBe(`bolt_mk${level}`);
      expect(mark.root.getObjectByName(`bolt_mk${level}_base`)).toBeDefined();
    }
    for (const entry of world.members.filter((placed) => placed.member.entry === 'verdant_kit')) {
      const node = entry.member.node!;
      // The holder carries the member's name, which for a kit piece is the piece's own, so the piece is its only child.
      expect(entry.root.children).toHaveLength(1);
      const piece = entry.root.children[0] as Mesh;
      expect(piece.name).toBe(node);
      piece.updateWorldMatrix(true, false);
      // The piece stands inside its holder exactly as it stood inside the kit, so its authored origin, the kit's,
      // is the holder's, and that is the ground point.
      const inHolder = entry.root.matrixWorld.clone().invert().multiply(piece.matrixWorld);
      const kept = kitRelative.get(node)!.toArray();
      expect(Math.max(...inHolder.toArray().map((v, i) => Math.abs(v - (kept[i] as number)))), node).toBeLessThan(1e-12);
      // The stand-in's bottom centre, the kit's origin, is the geometry point (-0.15, -0.1, 0.05) under the node's
      // matrix, and it lands on the ground point: the piece stands on the ground, not a quantization box away from it.
      const contact = new Vector3(-0.15, -0.1, 0.05).applyMatrix4(piece.matrixWorld);
      expect(contact.distanceTo(worldPosition(entry.root)), node).toBeLessThan(1e-9);
    }
    // The kit's pieces left the kit, one each.
    expect(assets.get('verdant_kit')!.root.children).toHaveLength(0);
  });

  it('draws the grass and flowers out of the edge pass, and the grass tuft without a shadow, as the Style Lab meadow does', () => {
    const { world } = build();
    for (const entry of world.members.filter((placed) => placed.member.entry === 'verdant_kit')) {
      const node = entry.member.node!;
      entry.root.traverse((child) => {
        const mesh = child as Mesh;
        if (!mesh.isMesh || mesh.material === hullMaterial) return;
        expect(mesh.layers.mask, node).toBe(NO_EDGE_PIECES.includes(node) ? 1 << LAYERS.noEdge : 1 << LAYERS.world);
        expect(mesh.castShadow, node).toBe(!SHADOWLESS_PIECES.includes(node));
      });
    }
    expect(SHADOWLESS_PIECES).toEqual(['grass_tuft']);
  });

  it('gives each heart its own stage, the first heart the loaded root and the rest copies, and moves only the slider heart', () => {
    const { assets, world } = build();
    const hearts = world.members.filter((entry) => entry.member.entry === 'worldheart');
    expect(hearts[0]!.root).toBe(assets.get('worldheart')!.root);
    expect(new Set(hearts.map((entry) => entry.root)).size).toBe(4);
    expect(hearts.map((entry) => visibleStages(entry.root))).toEqual([[0], [5], [10], [LIVE_HEART_START_LEVEL]]);
    world.setHeartLevel(3);
    expect(world.heartLevel()).toBe(3);
    expect(hearts.map((entry) => visibleStages(entry.root))).toEqual([[0], [5], [10], [3]]);
    world.setHeartLevel(14);
    expect(visibleStages(hearts[3]!.root)).toEqual([10]);
    // The slider heart's bounds and top follow its stage, for its label and its view.
    world.setHeartLevel(0);
    const low = hearts[3]!.bounds.max.y;
    const lowTop = hearts[3]!.top.y;
    world.setHeartLevel(10);
    expect(hearts[3]!.bounds.max.y).toBeGreaterThan(low);
    expect(hearts[3]!.top.y).toBeGreaterThan(lowTop);
  });

  it('loops each character instance on its own clip, in place, every clip its entry exports', () => {
    const { world } = build();
    const characters = world.members.filter((entry) => entry.member.clip);
    expect(characters.map((entry) => entry.member.name)).toEqual([
      'husk_idle',
      'husk_walk',
      'husk_attack',
      'pip_idle',
      'pip_run',
      'pip_face',
      'pip_attack',
      'bulwark_idle',
      'bulwark_run',
      'bulwark_attack',
    ]);
    const before = characters.map((entry) => worldPosition(entry.root));
    world.update(0.5);
    const turns = characters.map((entry) => (entry.root.getObjectByName(`${entry.member.entry}_part`) as Object3D).rotation.y);
    // Each stand-in clip turns the part by (clip index + 1) over a second, so half a second in each shows its own clip.
    const clipTurn = (entry: (typeof characters)[number]) => {
      const clips = manifest.assets.find((asset) => asset.name === entry.member.entry)!.animations.map((clip) => clip.name);
      return (clips.indexOf(entry.member.clip!) + 1) * 0.5;
    };
    characters.forEach((entry, index) => expect(turns[index], entry.member.name).toBeCloseTo(clipTurn(entry), 6));
    characters.forEach((entry, index) => expect(worldPosition(entry.root).distanceTo(before[index]!), entry.member.name).toBe(0));
    // Looping: after a whole period more, every part is where it was.
    world.update(1);
    characters.forEach((entry, index) => expect((entry.root.getObjectByName(`${entry.member.entry}_part`) as Object3D).rotation.y).toBeCloseTo(turns[index]!, 6));
  });

  it('gives every Pip instance its own face, blinking out of step after its mixer, and cycles the demo on the face member alone', () => {
    const { world } = build();
    const faces = () => new Map(world.faces().map((face) => [face.name, face]));
    // Only rigs with face morphs get a face: Pip's four, never Bulwark's visor or the Husk.
    const pips = ['pip_idle', 'pip_run', 'pip_face', 'pip_attack'];
    expect([...faces().keys()]).toEqual(pips);
    // Before any draw, every instance's hull, the rig copies' included, already shares its body's influences.
    for (const name of pips) {
      const part = world.root.getObjectByName(name)!.getObjectByName('commander_pip_part') as Mesh;
      const hull = part.children.find((child) => (child as Mesh).material === hullMaterial) as Mesh;
      expect(hull.morphTargetInfluences, name).toBe(part.morphTargetInfluences);
      expect(faces().get(name)!.hullsShared, name).toBe(true);
    }
    // Frame by frame for 6 s, longer than the longest wait before a first blink (5 s) plus the blink itself.
    const firstBlink = new Map<string, number>();
    const most = new Map<string, number>();
    for (let frame = 1; frame <= 360; frame++) {
      world.update(1 / 60);
      for (const face of world.faces()) {
        most.set(face.name, Math.max(most.get(face.name) ?? 0, face.blink));
        if (face.blink > 0 && !firstBlink.has(face.name)) firstBlink.set(face.name, frame);
        // The mixer's clip keys blink_L at CLIP_BLINK every frame; the face runs after it, so the lids are the face's.
        const part = world.root.getObjectByName(face.name)!.getObjectByName('commander_pip_part') as Mesh;
        expect(part.morphTargetInfluences![part.morphTargetDictionary!['blink_L']!], face.name).toBe(face.blink);
      }
    }
    for (const name of pips) expect(most.get(name), name).toBeGreaterThan(0.9);
    // Seeded one after another, the four never start a blink on the same frame.
    expect(new Set(firstBlink.values()).size).toBe(pips.length);
  });

  it('cycles neutral, smile and brows up on the face member, holds every face while frozen, and holds a posed face for a frame', () => {
    const { world } = build();
    const read = (name: string) => world.faces().find((face) => face.name === name)!;
    // Opens on neutral.
    expect(read('pip_face').expressions).toEqual({ smile: 0, brows_up: 0, pucker: 0 });
    // Halfway through the blend out of neutral, the smile is half in; a second into its hold, it is whole.
    world.update(FACE_DEMO_HOLD_SECONDS + FACE_DEMO_BLEND_SECONDS / 2);
    expect(read('pip_face').expressions.smile).toBeCloseTo(0.5, 9);
    world.update(FACE_DEMO_BLEND_SECONDS / 2 + 1);
    expect(read('pip_face').expressions).toEqual({ smile: 1, brows_up: 0, pucker: 0 });
    expect(faceDemoWeights(FACE_DEMO_HOLD_SECONDS + FACE_DEMO_BLEND_SECONDS + 1)).toEqual({ smile: 1, brows_up: 0, pucker: 0 });
    // The other instances only blink.
    expect(read('pip_idle').expressions).toEqual({ smile: 0, brows_up: 0, pucker: 0 });
    // Frozen, even a step the page would never pass while frozen changes no face, the demo included.
    const period = FACE_DEMO_HOLD_SECONDS + FACE_DEMO_BLEND_SECONDS;
    world.setFrozen(true);
    const before = world.faces();
    world.update(period);
    expect(world.faces()).toEqual(before);
    // A held pose shows at once, frozen; handed back, the face takes up the demo where the world's clock now stands,
    // two periods in: the brows up.
    expect(world.setFace('pip_face', { blink: 1, smile: 0.8 })).toBe(true);
    expect(read('pip_face')).toMatchObject({ blink: 1, expressions: { smile: 0.8, brows_up: 0, pucker: 0 } });
    expect(world.setFace('bulwark_idle', { blink: 1 })).toBe(false);
    world.setFace('pip_face', null);
    expect(read('pip_face').expressions).toEqual(faceDemoWeights(2 * period + 1));
    expect(read('pip_face').expressions).toEqual({ smile: 0, brows_up: 1, pucker: 0 });
    // A period on, the cycle is back at neutral.
    world.setFrozen(false);
    world.update(period);
    expect(read('pip_face').expressions).toEqual({ smile: 0, brows_up: 0, pucker: 0 });
    expect(FACE_DEMO_STEPS).toEqual([null, 'smile', 'brows_up']);
  });

  it('sweeps the tower heads around their rest, out of step', () => {
    const { world } = build();
    const heads = [1, 2, 3].map((level) => world.root.getObjectByName(`bolt_mk${level}_yaw`)!);
    world.update(1);
    const yaws = heads.map((head) => head.rotation.y);
    expect(new Set(yaws.map((y) => y.toFixed(6))).size).toBe(3);
    for (const yaw of yaws) expect(Math.abs(yaw)).toBeLessThanOrEqual((35 * Math.PI) / 180 + 1e-9);
  });

  it('adds nothing but the members: no scatter a viewer could take for a placed member', () => {
    const { world } = build();
    expect(world.root.children.map((child) => child.name)).toEqual(MEMBERS.map((m) => m.name));
  });

  it('reads each member lowest point along its ground up, and its body top on its own up line, beside a sword', () => {
    const { world } = build();
    const raycaster = new Raycaster();
    // The grass and flowers draw on the noEdge layer alone, which a raycaster skips unless it tests every layer.
    raycaster.layers.enableAll();
    for (const entry of world.members) {
      const root = worldPosition(entry.root);
      const { x, z } = toTangent(entry.member.s, entry.member.d);
      const groundUp = patch.surfaceAt(x, z).up;
      entry.root.updateWorldMatrix(true, false);
      const ownUp = new Vector3(0, 1, 0).transformDirection(entry.root.matrixWorld);
      const vertices = drawnVertices(entry.root);
      const depth = (v: Vector3) => v.clone().sub(root).dot(groundUp);
      const deepest = Math.min(...vertices.map(depth));
      expect(depth(entry.lowest), entry.member.name).toBeCloseTo(deepest, 9);
      expect(vertices.some((v) => v.distanceTo(entry.lowest) < 1e-9), entry.member.name).toBe(true);
      // The top lies on the member's own up line, as high as the highest point where a ray cast down its up line, or
      // down one of the lines LABEL_AXIS_RADIUS around it, first meets its drawn surface.
      const rise = entry.top.clone().sub(root);
      expect(rise.clone().cross(ownUp).length(), entry.member.name).toBeLessThan(1e-9);
      const across = new Vector3(1, 0, 0).projectOnPlane(ownUp).normalize();
      const across2 = new Vector3().crossVectors(ownUp, across);
      let highest = -Infinity;
      for (let i = -1; i < LABEL_AXIS_LINES; i++) {
        const angle = (i / LABEL_AXIS_LINES) * Math.PI * 2;
        const out = i < 0 ? 0 : LABEL_AXIS_RADIUS;
        const from = root.clone().addScaledVector(across, out * Math.cos(angle)).addScaledVector(across2, out * Math.sin(angle)).addScaledVector(ownUp, 50);
        raycaster.set(from, ownUp.clone().negate());
        // A raycaster also meets hidden objects (the heart's other stages), so a hit counts only if it is drawn.
        const drawn = (object: Object3D | null): boolean => !object || (object.visible && drawn(object.parent));
        const hit = raycaster.intersectObject(entry.root, true).find((candidate) => (candidate.object as Mesh).material !== hullMaterial && drawn(candidate.object));
        if (hit) highest = Math.max(highest, hit.point.clone().sub(root).dot(ownUp));
      }
      expect(rise.dot(ownUp), entry.member.name).toBeCloseTo(highest, 6);
    }
    // Bulwark's label stands on his body, not on his sword, which rises 0.3 m higher beside him.
    for (const name of ['bulwark_idle', 'bulwark_run', 'bulwark_attack']) {
      const entry = world.members.find((placed) => placed.member.name === name)!;
      const rise = entry.top.clone().sub(worldPosition(entry.root)).length();
      // To float precision, which the geometry is stored in.
      expect(rise, name).toBeCloseTo(CHARACTER_SIZE['bulwark']![1], 6);
      entry.root.updateWorldMatrix(true, false);
      const ownUp = new Vector3(0, 1, 0).transformDirection(entry.root.matrixWorld);
      const reach = Math.max(...drawnVertices(entry.root).map((v) => v.sub(worldPosition(entry.root)).dot(ownUp)));
      expect(reach, name).toBeCloseTo(SWORD.height, 6);
    }
  });
});

/** The camera a pose puts in place for a lens. */
function cameraAt(pose: ViewPose, lens: Lens): PerspectiveCamera {
  const camera = new PerspectiveCamera(lens.fov, lens.aspect, 0.1, 2500);
  camera.position.copy(pose.position);
  camera.lookAt(pose.target);
  camera.updateMatrixWorld();
  return camera;
}

const SCREENS = [
  ['a 1920 x 1080 screen', 1920, 1080],
  ['a 375 x 667 phone', 375, 667],
] as const;

/**
 * How much further a member's own view may stand than a fit to the member's bounds alone, at the same least half-size
 * (MEMBER_MIN_FIT_HALF_SIZE), so a small member's view is held to its own close fit rather than to the family views'
 * larger one. The label and its tail rise FOCUSED_MEMBER_LABEL_ROOM_PX over the member's top, a sixth of a 667 px
 * phone's half height, which only a view as tall as it is wide feels in full; framing the family's placard as well stood
 * the flowers 3.75 times as far on a phone with these stand-ins (3.90 in the browser, on the shipped assets), both at
 * the 1.2 m floor member views then had.
 */
const MEMBER_VIEW_REACH = 1.3;

describe('the Asset World views', () => {
  for (const [label, width, height] of SCREENS) {
    it(`frames every member and every label of the overview, the characters, each family and each member closely on ${label}`, () => {
      const { world } = build();
      const specs = labelSpecs(world.members, patch);
      const lens: Lens = { fov: 50, aspect: width / height, heightPx: height };
      const context = { labels: true, widthPx: width };
      const frustum = new Frustum();
      const ndc = new Vector3();
      const opens: OpenView[] = [
        ...[OVERVIEW, CHARACTERS, ...ZONES.map((zone) => zone.family)].map((view) => ({ view, member: '' })),
        ...MEMBERS.map((m) => ({ view: m.zone, member: m.name })),
      ];
      for (const open of opens) {
        const name = open.member || open.view;
        const pose = frameView(open, world.members, specs, context, lens)!;
        const camera = cameraAt(pose, lens);
        frustum.setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        const framed = world.members.filter((entry) =>
          open.member ? entry.member.name === open.member : open.view === OVERVIEW ? true : open.view === CHARACTERS ? CHARACTER_FAMILIES.includes(entry.member.zone) : entry.member.zone === open.view,
        );
        expect(framed.length, name).toBeGreaterThan(0);
        // Every corner of what is drawn is inside the frame, and every label the view shows, with the room it takes.
        let reach = 0;
        for (const entry of framed) {
          expect(frustum.containsPoint(worldPosition(entry.root)), `${entry.member.name} in ${name}`).toBe(true);
          for (const corner of boundsCorners([entry])) {
            ndc.copy(corner).project(camera);
            reach = Math.max(reach, Math.abs(ndc.x), Math.abs(ndc.y));
            expect(Math.max(Math.abs(ndc.x), Math.abs(ndc.y)), `${entry.member.name} corner in ${name}`).toBeLessThanOrEqual(FIT_NDC + 1e-6);
          }
        }
        for (const point of viewPoints(open, world.members, specs, context)!) {
          ndc.copy(point.point).project(camera);
          const top = ndc.y + (point.abovePx ?? 0) / (height / 2);
          const bottom = ndc.y - (point.belowPx ?? 0) / (height / 2);
          reach = Math.max(reach, Math.abs(ndc.x), top, -bottom);
          expect(Math.max(Math.abs(ndc.x), top, -bottom), `a label point in ${name}`).toBeLessThanOrEqual(FIT_NDC + 1e-6);
        }
        // The fit is tight: something reaches FIT_NDC, a corner, a label's room, or, for a view smaller than its least
        // half-size along some axis (MIN_FIT_HALF_SIZE, or a member view's MEMBER_MIN_FIT_HALF_SIZE), the padding cube
        // the fit frames around the middle of its points. So the flowers' view framed at the family views' larger floor
        // would stand back from its own padding cube and fail here.
        const points = viewPoints(open, world.members, specs, context)!.map((point) => point.point);
        const middle = new Vector3();
        const lo = points.reduce((a, p) => a.min(p), points[0]!.clone());
        const hi = points.reduce((a, p) => a.max(p), points[0]!.clone());
        middle.addVectors(lo, hi).multiplyScalar(0.5);
        expect(fitFloorOf(open), name).toBe(open.member ? MEMBER_MIN_FIT_HALF_SIZE : MIN_FIT_HALF_SIZE);
        for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
          ndc.set(x, y, z).multiplyScalar(fitFloorOf(open)).add(middle).project(camera);
          reach = Math.max(reach, Math.abs(ndc.x), Math.abs(ndc.y));
        }
        expect(reach, name).toBeGreaterThan(FIT_NDC - 0.01);
      }
      expect(frameView({ view: 'no_such_view', member: '' }, world.members, specs, context, lens)).toBeNull();
    });

    it(`stands each member view within ${MEMBER_VIEW_REACH} times the distance of a fit to that member alone on ${label}`, () => {
      const { world } = build();
      const specs = labelSpecs(world.members, patch);
      const lens: Lens = { fov: 50, aspect: width / height, heightPx: height };
      const context = { labels: true, widthPx: width };
      const rows: string[] = [];
      let worst = 0;
      for (const entry of world.members) {
        const open = { view: entry.member.zone, member: entry.member.name };
        const page = frameView(open, world.members, specs, context, lens)!;
        const alone = fitPoints(
          boundsCorners([entry]).map((point) => ({ point })),
          MEMBER_PITCH_DEG,
          lens,
          MEMBER_MIN_FIT_HALF_SIZE,
        );
        const ratio = page.position.distanceTo(page.target) / alone.position.distanceTo(alone.target);
        worst = Math.max(worst, ratio);
        rows.push(`${entry.member.name} ${ratio.toFixed(2)}`);
        // The view names the member alone: its own label, or, for a family's only member, its family's placard.
        const shows = labelRule(open, world.members, context);
        const shown = specs.filter((spec) => shows(spec)).map((spec) => spec.key);
        expect(shown, entry.member.name).toEqual([entry.member.label ? entry.member.name : familyLabelKey(entry.member.zone)]);
      }
      expect(worst, rows.join(', ')).toBeLessThanOrEqual(MEMBER_VIEW_REACH);
    });
  }

  it('hangs each family placard in front of its zone, on the ground, and stands each member label on its body top', () => {
    const { world } = build();
    const specs = labelSpecs(world.members, patch);
    const onGround = (anchor: Vector3, name: string) => {
      const p = anchor.clone().sub(CENTER);
      const ground = patch.surfaceAt((p.x / p.y) * STYLE_PLANET_RADIUS, (p.z / p.y) * STYLE_PLANET_RADIUS);
      expect(anchor.distanceTo(ground.position), name).toBeLessThan(1e-9);
    };
    const frontOf = (entry: PlacedMember) =>
      Math.min(...[entry.bounds.min, entry.bounds.max].flatMap((a) => [entry.bounds.min, entry.bounds.max].map((b) => fromTangent(a.x, b.z).d)));
    for (const family of ['env', 'towers', 'nests', 'xeno', 'heart']) {
      const members = world.members.filter((entry) => entry.member.zone === family);
      const anchor = familyLabelAnchor(members, patch);
      onGround(anchor, family);
      expect(specs.find((spec) => spec.key === familyLabelKey(family))!.anchor.distanceTo(anchor), family).toBe(0);
      const { d } = fromTangent(anchor.x, anchor.z);
      for (const entry of members) expect(d, `${family} placard in front of ${entry.member.name}`).toBeLessThan(frontOf(entry));
      for (const entry of members) expect(memberLabelAnchor(entry).distanceTo(entry.top), entry.member.name).toBe(0);
    }
    // The commanders' zone hangs a placard under each commander's row, Pip's first, both in front of the whole zone in one
    // line, each across the middle of its own row, naming him over the zone's key.
    const zone = world.members.filter((entry) => entry.member.zone === 'commanders');
    const placards = specs.filter((spec) => spec.kind === 'family' && spec.family === 'commanders');
    expect(placards.map((spec) => [spec.key, spec.text, spec.detail])).toEqual([
      ['family:commanders:commander_pip', 'Pip (commander)', 'commanders'],
      ['family:commanders:bulwark', 'Bulwark', 'commanders'],
    ]);
    // On the tangent plane the anchor's point stands on (its world x and z shrink with the planet's curve).
    const tangentOf = (anchor: Vector3) => {
      const p = anchor.clone().sub(CENTER);
      return fromTangent((p.x / p.y) * STYLE_PLANET_RADIUS, (p.z / p.y) * STYLE_PLANET_RADIUS);
    };
    const depths = placards.map((spec) => tangentOf(spec.anchor).d);
    expect(depths[0]!).toBeCloseTo(depths[1]!, 9);
    for (const [index, entryName] of ['commander_pip', 'bulwark'].entries()) {
      const placard = placards[index]!;
      onGround(placard.anchor, placard.key);
      const row = zone.filter((entry) => entry.member.entry === entryName);
      const { s, d } = tangentOf(placard.anchor);
      for (const entry of zone) expect(d, `${placard.key} in front of ${entry.member.name}`).toBeLessThan(frontOf(entry));
      expect(s, placard.key).toBeGreaterThan(Math.min(...row.map((entry) => entry.member.s)));
      expect(s, placard.key).toBeLessThan(Math.max(...row.map((entry) => entry.member.s)));
      for (const entry of row) expect(memberLabelAnchor(entry).distanceTo(entry.top), entry.member.name).toBe(0);
    }
  });

  it('names what each view shows: families and, on a wide screen, members in the overview; a family and its members; a member alone', () => {
    const { world } = build();
    const specs = labelSpecs(world.members, patch);
    const shown = (open: OpenView, labels = true, widthPx = 1920) => {
      const shows = labelRule(open, world.members, { labels, widthPx });
      return specs.filter((spec) => shows(spec)).map((spec) => spec.key);
    };
    const families = specs.filter((spec) => spec.kind === 'family').map((spec) => spec.key);
    // Six zones, the commanders' with a placard for each commander.
    expect(families).toEqual(['family:env', 'family:towers', 'family:nests', 'family:xeno', 'family:commanders:commander_pip', 'family:commanders:bulwark', 'family:heart']);
    const labelled = MEMBERS.filter((m) => m.label).map((m) => m.name);
    expect(shown({ view: OVERVIEW, member: '' }, true, OVERVIEW_MEMBER_LABELS_MIN_WIDTH - 1)).toEqual(families);
    expect(shown({ view: OVERVIEW, member: '' }, true, OVERVIEW_MEMBER_LABELS_MIN_WIDTH)).toEqual([...families, ...labelled]);
    expect(shown({ view: 'towers', member: '' })).toEqual(['family:towers', 'bolt_mk1', 'bolt_mk2', 'bolt_mk3']);
    const commanders = ['pip_idle', 'pip_run', 'pip_face', 'pip_attack', 'bulwark_idle', 'bulwark_run', 'bulwark_attack'];
    const commanderPlacards = ['family:commanders:commander_pip', 'family:commanders:bulwark'];
    expect(shown({ view: CHARACTERS, member: '' })).toEqual(['family:xeno', ...commanderPlacards, 'husk_idle', 'husk_walk', 'husk_attack', ...commanders]);
    // Pip leads the commanders' view, Bulwark after him; Pip has no view of his own any more. With Pip's attack the zone's
    // seven labels crowd a portrait phone, so there it names the two placards alone, from the characters' 640 px.
    expect(shown({ view: 'commanders', member: '' })).toEqual([...commanderPlacards, ...commanders]);
    expect(FAMILY_MEMBER_LABELS_MIN_WIDTH['commanders']).toBe(CHARACTERS_MEMBER_LABELS_MIN_WIDTH);
    for (const widthPx of [375, 390, CHARACTERS_MEMBER_LABELS_MIN_WIDTH - 1]) expect(shown({ view: 'commanders', member: '' }, true, widthPx), `${widthPx} px`).toEqual(commanderPlacards);
    expect(shown({ view: 'commanders', member: '' }, true, CHARACTERS_MEMBER_LABELS_MIN_WIDTH)).toEqual([...commanderPlacards, ...commanders]);
    expect(shown({ view: 'commanders', member: 'pip_attack' }, true, 375)).toEqual(['pip_attack']);
    expect(resolveAddress(null, 'pip').problems).toEqual(['no family named "pip"']);
    // The kit's eight labels crowd a narrow screen, so there its view names the kit alone, as the overview does, and each
    // piece keeps its own view; the other families' views, but the commanders', name their members on a phone.
    const kit = MEMBERS.filter((m) => m.family === 'env').map((m) => m.name);
    const kitWidth = FAMILY_MEMBER_LABELS_MIN_WIDTH['env']!;
    for (const widthPx of [375, 390, kitWidth - 1]) expect(shown({ view: 'env', member: '' }, true, widthPx), `${widthPx} px`).toEqual(['family:env']);
    expect(shown({ view: 'env', member: '' }, true, kitWidth)).toEqual(['family:env', ...kit]);
    expect(shown({ view: 'env', member: 'flowers' }, true, 375)).toEqual(['flowers']);
    expect(Object.keys(FAMILY_MEMBER_LABELS_MIN_WIDTH)).toEqual(['env', 'commanders']);
    expect(shown({ view: 'towers', member: '' }, true, 375)).toEqual(['family:towers', 'bolt_mk1', 'bolt_mk2', 'bolt_mk3']);
    // On a phone the characters' view, which frames the whole 27.2 m character row, names the placards alone.
    expect(shown({ view: CHARACTERS, member: '' }, true, CHARACTERS_MEMBER_LABELS_MIN_WIDTH - 1)).toEqual(['family:xeno', ...commanderPlacards]);
    expect(shown({ view: CHARACTERS, member: '' }, true, CHARACTERS_MEMBER_LABELS_MIN_WIDTH)).toHaveLength(3 + 10);
    expect(shown({ view: 'towers', member: 'bolt_mk2' })).toEqual(['bolt_mk2']);
    // A member opened from the overview's list is named the same way.
    expect(shown({ view: OVERVIEW, member: 'rock_a' })).toEqual(['rock_a']);
    expect(shown({ view: 'nests', member: 'nest' })).toEqual(['family:nests']);
    expect(shown({ view: OVERVIEW, member: '' }, false)).toEqual([]);
    // Each member label carries its family's name, for the second line its own view shows.
    const lines = new Map(specs.filter((spec) => spec.kind === 'member').map((spec: LabelSpec) => [spec.key, spec.line]));
    expect(lines.get('bolt_mk2')).toBe('Bolt Sentinel');
    expect(lines.get('husk_idle')).toBe('Husk');
    expect(lines.get('flowers')).toBe('Verdant kit');
    // In the commanders' shared zone the second line names the commander.
    expect(lines.get('bulwark_idle')).toBe('Bulwark');
    expect(lines.get('pip_face')).toBe('Pip (commander)');
    expect(specs.find((spec) => spec.key === 'pip_face')!.text).toBe('Face');
  });

  it('frames the ground where the members stand when no asset loaded, rather than leaving the camera at the origin', () => {
    for (const [, width, height] of SCREENS) {
      const lens: Lens = { fov: 50, aspect: width / height, heightPx: height };
      const pose = registryOverview(patch, lens);
      expect(pose.position.length()).toBeGreaterThan(20);
      const camera = cameraAt(pose, lens);
      const ndc = new Vector3();
      for (const m of MEMBERS) {
        const { x, z } = toTangent(m.s, m.d);
        ndc.copy(patch.surfaceAt(x, z).position).project(camera);
        expect(Math.max(Math.abs(ndc.x), Math.abs(ndc.y)), m.name).toBeLessThanOrEqual(FIT_NDC + 1e-6);
      }
    }
    // And the page falls back to it: with no members, every view frames nothing.
    const none: PlacedMember[] = [];
    expect(frameView({ view: OVERVIEW, member: '' }, none, [], { labels: true, widthPx: 375 }, { fov: 50, aspect: 375 / 667, heightPx: 667 })).toBeNull();
  });
});

describe('the Asset World address', () => {
  it('opens a member, else a family, else the overview, reading each parameter as its own kind', () => {
    expect(resolveAddress('bolt_mk2', null)).toEqual({ open: { view: 'towers', member: 'bolt_mk2' }, problems: [] });
    expect(resolveAddress(null, 'towers')).toEqual({ open: { view: 'towers', member: '' }, problems: [] });
    expect(resolveAddress(null, 'characters')).toEqual({ open: { view: CHARACTERS, member: '' }, problems: [] });
    expect(resolveAddress(null, null)).toEqual({ open: { view: OVERVIEW, member: '' }, problems: [] });
    // An empty value is absent: an empty member no longer hides a good family.
    expect(resolveAddress('', 'towers')).toEqual({ open: { view: 'towers', member: '' }, problems: [] });
    expect(resolveAddress('rock_a', '')).toEqual({ open: { view: 'env', member: 'rock_a' }, problems: [] });
  });

  it('opens the Style Lab in the look on screen, on Bulwark from one of his members and on the default commander elsewhere', () => {
    expect(styleLabQuery('abc', '')).toBe('?dials=abc');
    expect(styleLabQuery('abc', 'pip_face')).toBe('?dials=abc');
    expect(styleLabQuery('abc', 'husk_walk')).toBe('?dials=abc');
    for (const name of ['bulwark_idle', 'bulwark_run', 'bulwark_attack']) expect(styleLabQuery('abc', name), name).toBe('?dials=abc&commander=bulwark');
  });

  it('names a bad name and falls through to the other parameter, or to the overview', () => {
    expect(resolveAddress('bolt_mk9', 'towers')).toEqual({ open: { view: 'towers', member: '' }, problems: ['no member named "bolt_mk9"'] });
    expect(resolveAddress('bolt_mk2', 'no_such_family')).toEqual({ open: { view: 'towers', member: 'bolt_mk2' }, problems: ['no family named "no_such_family"'] });
    expect(resolveAddress('nope', 'nada')).toEqual({ open: { view: OVERVIEW, member: '' }, problems: ['no member named "nope"', 'no family named "nada"'] });
    // A name of the other kind is a bad name for this parameter.
    expect(resolveAddress('towers', null)).toEqual({ open: { view: OVERVIEW, member: '' }, problems: ['no member named "towers"'] });
    expect(resolveAddress(null, 'bolt_mk2')).toEqual({ open: { view: OVERVIEW, member: '' }, problems: ['no family named "bolt_mk2"'] });
  });
});
