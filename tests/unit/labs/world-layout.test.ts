import { readFileSync } from 'node:fs';
import {
  AnimationClip,
  Box3,
  BoxGeometry,
  Frustum,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  PerspectiveCamera,
  Vector3,
  type InstancedMesh,
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
import { buildAssetWorld, CONTEXT_CLEARANCE, CONTEXT_TUFTS, HEART_STAGES, type AssetWorld } from '../../../src/labs/world/layout';
import { fromTangent, LIVE_HEART_START_LEVEL, MEMBERS, memberYaw, toTangent } from '../../../src/labs/world/registry';
import { CHARACTERS, familyLabelAnchor, FIT_NDC, memberLabelAnchor, MIN_FIT_HALF_SIZE, OVERVIEW, viewPose } from '../../../src/labs/world/views';

const paint = createPaintUniforms(VERDANT, DEFAULT_DIALS, null);
const hullMaterial = createHullMaterial(createInkUniforms(DEFAULT_DIALS));
const ctx: MaterialContext = { paint, hullMaterial, hullLayer: LAYERS.hull };
// surfaceAt is analytic, so a coarse patch places everything exactly where a tier's patch would.
const patch = createStylePatch(VERDANT, paint, 32);
const CENTER = new Vector3(0, -STYLE_PLANET_RADIUS, 0);

interface ManifestModel {
  name: string;
  kind: string;
  nodes: string[];
  animations: { name: string }[];
}
const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')) as { assets: ManifestModel[] };

/** A painted, inked box standing on its node's origin, so its lowest face is the ground contact. */
function box(name: string, size = 0.6): Mesh {
  const geometry = new BoxGeometry(size, size, size).translate(0, size / 2, 0);
  const mesh = new Mesh(geometry, new MeshStandardMaterial());
  mesh.name = name;
  return mesh;
}

/**
 * Stand-ins shaped like each shipped GLB where the world reads it: the kit's pieces are mesh nodes carrying a
 * quantization-like matrix (an offset and a scale that the geometry undoes, as gltf-transform leaves them), the tower
 * marks are empties with a yaw node, the heart has its plinth and eleven stages, and the characters carry one clip per
 * name the manifest lists, each moving a named part differently.
 */
function standIns(): Map<string, LoadedAsset> {
  const assets = new Map<string, LoadedAsset>();
  for (const entry of manifest.assets.filter((asset) => asset.kind === 'model')) {
    const root = new Group();
    const animations: AnimationClip[] = [];
    if (entry.name === 'verdant_kit') {
      for (const node of entry.nodes) {
        const piece = box(node);
        // The node's matrix is a quantization box, and the geometry is authored inside it so the piece's origin is the
        // kit's: an offset of (0.3, 0.2, -0.1) at scale 2 is undone by moving the geometry back by it and halving it.
        piece.position.set(0.3, 0.2, -0.1);
        piece.scale.setScalar(2);
        piece.geometry.translate(-0.3, -0.2, 0.1).scale(0.5, 0.5, 0.5);
        root.add(piece);
      }
    } else if (entry.name === 'bolt_sentinel') {
      for (const level of [1, 2, 3]) {
        const mark = new Group();
        mark.name = `bolt_mk${level}`;
        const base = box(`bolt_mk${level}_base`);
        const yaw = box(`bolt_mk${level}_yaw`, 0.3);
        yaw.position.y = 0.6;
        base.add(yaw);
        mark.add(base);
        root.add(mark);
      }
    } else if (entry.name === 'worldheart') {
      root.add(box('heart_plinth', 1));
      for (let level = 0; level < HEART_STAGES; level++) {
        const stage = box(`heart_stage_${String(level).padStart(2, '0')}`, 0.4 + level * 0.1);
        stage.position.y = 1;
        root.add(stage);
      }
    } else {
      const part = box(`${entry.name}_part`);
      root.add(part);
      entry.animations.forEach((clip, index) => {
        animations.push(new AnimationClip(clip.name, 1, [new NumberKeyframeTrack(`${entry.name}_part.rotation[y]`, [0, 1], [0, index + 1])]));
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
      expect(memberYaw(member)).toBeTypeOf('number');
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
    // The slider heart's bounds follow its stage, for its label.
    world.setHeartLevel(0);
    const low = hearts[3]!.bounds.max.y;
    world.setHeartLevel(10);
    expect(hearts[3]!.bounds.max.y).toBeGreaterThan(low);
  });

  it('loops each character instance on its own clip, in place', () => {
    const { world } = build();
    const characters = world.members.filter((entry) => entry.member.clip);
    expect(characters.map((entry) => entry.member.name)).toEqual(['husk_walk', 'husk_attack', 'bulwark_idle', 'bulwark_run', 'bulwark_attack']);
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

  it('sweeps the tower heads around their rest, out of step', () => {
    const { world } = build();
    const heads = [1, 2, 3].map((level) => world.root.getObjectByName(`bolt_mk${level}_yaw`)!);
    world.update(1);
    const yaws = heads.map((head) => head.rotation.y);
    expect(new Set(yaws.map((y) => y.toFixed(6))).size).toBe(3);
    for (const yaw of yaws) expect(Math.abs(yaw)).toBeLessThanOrEqual((35 * Math.PI) / 180 + 1e-9);
  });

  it('adds a few grass tufts for context, each clear of every member', () => {
    const { world, kitRelative } = build();
    const tufts = world.root.getObjectByName('context_grass_instances') as InstancedMesh;
    // An instance's matrix is its placement times the tuft's matrix inside the kit, so undoing the second gives the root.
    const unpiece = kitRelative.get('grass_tuft')!.clone().invert();
    expect(tufts.count).toBeGreaterThan(0);
    expect(tufts.count).toBeLessThanOrEqual(CONTEXT_TUFTS);
    expect(tufts.castShadow).toBe(false);
    const matrix = new Matrix4();
    // Compared on the tangent plane, where the layout measures the clearance.
    const tangent = (p: Vector3) => {
      const d = p.clone().sub(CENTER);
      return { x: (d.x / d.y) * STYLE_PLANET_RADIUS, z: (d.z / d.y) * STYLE_PLANET_RADIUS };
    };
    const roots = world.members.map((entry) => tangent(worldPosition(entry.root)));
    for (let i = 0; i < tufts.count; i++) {
      tufts.getMatrixAt(i, matrix);
      const at = tangent(new Vector3().setFromMatrixPosition(matrix.multiply(unpiece)));
      for (const root of roots) expect(Math.hypot(at.x - root.x, at.z - root.z)).toBeGreaterThanOrEqual(CONTEXT_CLEARANCE - 1e-9);
    }
  });
});

describe('the Asset World views', () => {
  for (const [label, width, height] of [
    ['a 1920 x 1080 screen', 1920, 1080],
    ['a 375 x 667 phone', 375, 667],
  ] as const) {
    it(`frames every member of the overview, the characters, each family and each member closely on ${label}`, () => {
      const { world } = build();
      const lens = { fov: 50, aspect: width / height, heightPx: height };
      const camera = new PerspectiveCamera(lens.fov, lens.aspect, 0.1, 2500);
      const frustum = new Frustum();
      const ndc = new Vector3();
      const views = [OVERVIEW, CHARACTERS, 'env', 'towers', 'nests', 'xeno', 'commanders', 'heart', ...MEMBERS.map((m) => m.name)];
      for (const view of views) {
        const pose = viewPose(view, world.members, lens)!;
        camera.position.copy(pose.position);
        camera.lookAt(pose.target);
        camera.updateMatrixWorld();
        frustum.setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        const framed = world.members.filter((entry) =>
          view === OVERVIEW ? true : view === CHARACTERS ? ['xeno', 'commanders'].includes(entry.member.family) : entry.member.family === view || entry.member.name === view,
        );
        expect(framed.length, view).toBeGreaterThan(0);
        // Every corner of what is drawn is inside the frame, and the frame is fitted: some corner reaches FIT_NDC.
        let reach = 0;
        for (const entry of framed) {
          expect(frustum.containsPoint(worldPosition(entry.root)), `${entry.member.name} in ${view}`).toBe(true);
          const { min, max } = entry.bounds;
          for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
            ndc.set(x, y, z).project(camera);
            reach = Math.max(reach, Math.abs(ndc.x), Math.abs(ndc.y));
            expect(Math.max(Math.abs(ndc.x), Math.abs(ndc.y)), `${entry.member.name} corner in ${view}`).toBeLessThanOrEqual(FIT_NDC + 1e-6);
          }
        }
        // The fit is tight: something reaches FIT_NDC, a corner or, for a view smaller than MIN_FIT_HALF_SIZE along some
        // axis, the padding cube the fit frames around the middle of the members' bounds.
        const union = framed.reduce((box, entry) => box.union(entry.bounds), new Box3());
        const middle = union.getCenter(new Vector3());
        for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
          ndc.set(x, y, z).multiplyScalar(MIN_FIT_HALF_SIZE).add(middle).project(camera);
          reach = Math.max(reach, Math.abs(ndc.x), Math.abs(ndc.y));
        }
        expect(reach, view).toBeGreaterThan(FIT_NDC - 0.01);
        expect(reach, view).toBeLessThanOrEqual(FIT_NDC + 1e-6);
      }
      expect(viewPose('no_such_view', world.members, lens)).toBeNull();
    });
  }

  it('hangs each family placard in front of its zone, on the ground, clear of every member', () => {
    const { world } = build();
    for (const family of ['env', 'towers', 'nests', 'xeno', 'commanders', 'heart']) {
      const members = world.members.filter((entry) => entry.member.family === family);
      const anchor = familyLabelAnchor(members, patch);
      const p = anchor.clone().sub(CENTER);
      const ground = patch.surfaceAt((p.x / p.y) * STYLE_PLANET_RADIUS, (p.z / p.y) * STYLE_PLANET_RADIUS);
      expect(anchor.distanceTo(ground.position), family).toBeLessThan(1e-9);
      const { d } = fromTangent(anchor.x, anchor.z);
      for (const entry of members) {
        const front = Math.min(...[entry.bounds.min, entry.bounds.max].flatMap((a) => [entry.bounds.min, entry.bounds.max].map((b) => fromTangent(a.x, b.z).d)));
        expect(d, `${family} placard in front of ${entry.member.name}`).toBeLessThan(front);
      }
      const label = memberLabelAnchor(members[0]!);
      expect(label.y, family).toBeGreaterThan(members[0]!.bounds.max.y);
    }
  });
});
