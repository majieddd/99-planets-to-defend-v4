import { AnimationMixer, Box3, Group, InstancedMesh, LoopRepeat, Matrix4, Vector3, type Mesh, type Object3D } from 'three';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import type { LoadedAsset, MaterialContext } from '../../render/assets/loadAsset';
import { attachHull } from '../../render/ink/hull';
import { LAYERS } from '../../render/layers';
import { place, type Ground } from '../../render/terrain/place';
import { Rng, seedRng } from '../../sim/rng';
import { NO_EDGE_PIECES } from '../style/scene';
import { LEAN, LIVE_HEART_START_LEVEL, memberYaw, toTangent, WORLD_REACH, type WorldMember } from './registry';

/** The heart's growth stages, one node per level (blender/recipes/heart.py), of which a heart shows one. */
export const HEART_STAGES = 11;
/** One sweep of a tower head, left and right of its rest, in seconds and in degrees to each side. */
export const TURRET_SWEEP_SECONDS = 9;
export const TURRET_SWEEP_DEG = 35;
/**
 * A few grass tufts between the zones, so the members stand in a meadow rather than on a painted floor, and no more:
 * the world is for inspection, not scatter. They keep this far from every member's root and fill a disc this far past
 * the furthest root, drawn from their own seeded stream so the layout is the same on every load and tier.
 */
export const CONTEXT_TUFTS = 40;
export const CONTEXT_CLEARANCE = 2.2;
export const CONTEXT_MARGIN = 4;
export const CONTEXT_SEED = 2026;

export interface PlacedMember {
  member: WorldMember;
  /** The object place() stood on the ground: the asset's root, a tower mark's own node, or a kit piece's holder. */
  root: Object3D;
  /** The visible geometry's world bounds, drawn stages only, taken in the pose the member opens in. */
  bounds: Box3;
}

export interface AssetWorld {
  root: Group;
  members: PlacedMember[];
  /** Advances the loops and the tower sweeps by `dt` seconds of animation time (already scaled by the speed dial). */
  update(dt: number): void;
  setHeartLevel(level: number): void;
  heartLevel(): number;
}

/** The world bounds of an object's visible meshes, ink hulls left out, skinned meshes in the pose they are in. */
export function visibleBounds(root: Object3D, hullMaterial: unknown, into = new Box3()): Box3 {
  into.makeEmpty();
  root.updateMatrixWorld(true);
  const vertex = new Vector3();
  root.traverseVisible((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || mesh.material === hullMaterial) return;
    const position = mesh.geometry.getAttribute('position');
    if (!position) return;
    // getVertexPosition applies a skinned mesh's bones, and so the dequantization M0c moves into its inverse bind
    // matrices: a skinned mesh's own bounding box is its quantization box, about 2 m on a side whatever the body.
    for (let i = 0; i < position.count; i++) into.expandByPoint(mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld));
  });
  return into;
}

/**
 * Takes the object a member stands on the ground, following the ground contract M0c's asset check measures
 * (tools/assets/inspect.mjs): the runtime sets a whole asset's root, and a top-level empty's own position and rotation,
 * so both are placed themselves; a mesh node's matrix is its quantization box, not its authored origin, so it keeps that
 * matrix inside a holder, and the holder is placed. A whole asset's first member takes the loaded root and every later
 * one a copy, cloned with its rig so each copy's skeleton follows its own mixer.
 */
function takeRoot(member: WorldMember, asset: LoadedAsset, used: Set<LoadedAsset>): Object3D {
  if (member.node === null) {
    const first = !used.has(asset);
    used.add(asset);
    const root = first ? asset.root : cloneRig(asset.root);
    root.name = member.name;
    return root;
  }
  const node = asset.root.getObjectByName(member.node);
  if (!node) throw new Error(`asset ${member.entry} has no node ${member.node} for the Asset World member ${member.name}`);
  if (!(node as Mesh).isMesh) {
    node.removeFromParent();
    return node;
  }
  asset.root.updateMatrixWorld(true);
  const relative = asset.root.matrixWorld.clone().invert().multiply(node.matrixWorld);
  node.removeFromParent();
  relative.decompose(node.position, node.quaternion, node.scale);
  const holder = new Group();
  holder.name = member.name;
  holder.add(node);
  return holder;
}

function stageName(level: number): string {
  return `heart_stage_${String(level).padStart(2, '0')}`;
}

export function buildAssetWorld(ground: Ground, assets: ReadonlyMap<string, LoadedAsset>, ctx: MaterialContext, members: readonly WorldMember[]): AssetWorld {
  const root = new Group();
  root.name = 'asset_world';
  const used = new Set<LoadedAsset>();
  const placed: PlacedMember[] = [];
  const mixers: AnimationMixer[] = [];
  const turrets: { yaw: Object3D; rest: number; phase: number }[] = [];
  const hearts: { member: PlacedMember; stages: (Object3D | undefined)[]; live: boolean }[] = [];
  let liveLevel = LIVE_HEART_START_LEVEL;

  // The grass tuft's geometry and its matrix inside the kit, read before its member takes the node away.
  const kit = assets.get('verdant_kit');
  const tuftSource = kit?.root.getObjectByName('grass_tuft') as Mesh | undefined;
  let tuftMatrix: Matrix4 | null = null;
  if (kit && tuftSource) {
    kit.root.updateMatrixWorld(true);
    tuftMatrix = kit.root.matrixWorld.clone().invert().multiply(tuftSource.matrixWorld);
  }

  for (const member of members) {
    const asset = assets.get(member.entry);
    if (!asset) throw new Error(`the Asset World has no loaded asset ${member.entry} for its member ${member.name}`);
    const object = takeRoot(member, asset, used);
    const { x, z } = toTangent(member.s, member.d);
    place(object, ground, x, z, memberYaw(member), member.lean);
    root.add(object);
    // The Style Lab draws its grass and flowers out of the screen-space edge pass (NO_EDGE_PIECES), which outlined every
    // blade; the world draws them the same way, so each piece looks here as it does in the game's meadow.
    if (member.node && NO_EDGE_PIECES.includes(member.node)) {
      object.traverse((child) => {
        if ((child as Mesh).isMesh && (child as Mesh).material !== ctx.hullMaterial) child.layers.set(LAYERS.noEdge);
      });
    }
    const entry: PlacedMember = { member, root: object, bounds: new Box3() };
    placed.push(entry);

    if (member.clip) {
      const clip = asset.animations.find((candidate) => candidate.name === member.clip);
      if (!clip) throw new Error(`asset ${member.entry} has no clip ${member.clip} for the Asset World member ${member.name}`);
      const mixer = new AnimationMixer(object);
      // Every clip loops in place, the attacks included, which the game plays once: the world is for reading a clip,
      // so it repeats it rather than waiting between strikes.
      mixer.clipAction(clip).setLoop(LoopRepeat, Infinity).play();
      mixers.push(mixer);
    }
    if (member.node?.startsWith('bolt_mk')) {
      const yaw = object.getObjectByName(`${member.node}_yaw`);
      // The three heads sweep a third of a period apart, so the row never moves in step and each reads on its own.
      if (yaw) turrets.push({ yaw, rest: yaw.rotation.y, phase: (turrets.length * 2 * Math.PI) / 3 });
    }
    if (member.heartStage !== null) {
      const stages = Array.from({ length: HEART_STAGES }, (_, level) => object.getObjectByName(stageName(level)));
      hearts.push({ member: entry, stages, live: member.heartStage === 'live' });
    }
  }

  const showStages = () => {
    for (const heart of hearts) {
      const level = heart.live ? liveLevel : (heart.member.member.heartStage as number);
      heart.stages.forEach((stage, index) => stage && (stage.visible = index === level));
    }
  };
  showStages();

  let clock = 0;
  const sweep = (seconds: number) => {
    for (const turret of turrets) {
      turret.yaw.rotation.y = turret.rest + ((TURRET_SWEEP_DEG * Math.PI) / 180) * Math.sin((2 * Math.PI * seconds) / TURRET_SWEEP_SECONDS + turret.phase);
    }
  };
  // Every member takes its opening pose before the bounds are read, so the labels and camera fits frame what is drawn.
  for (const mixer of mixers) mixer.update(0);
  sweep(0);
  for (const entry of placed) visibleBounds(entry.root, ctx.hullMaterial, entry.bounds);

  if (tuftSource && tuftMatrix) root.add(contextTufts(ground, tuftSource, tuftMatrix, placed, ctx));

  return {
    root,
    members: placed,
    update(dt) {
      clock += dt;
      for (const mixer of mixers) mixer.update(dt);
      sweep(clock);
    },
    setHeartLevel(level) {
      liveLevel = Math.min(HEART_STAGES - 1, Math.max(0, Math.round(level)));
      showStages();
      for (const heart of hearts) if (heart.live) visibleBounds(heart.member.root, ctx.hullMaterial, heart.member.bounds);
    },
    heartLevel: () => liveLevel,
  };
}

function contextTufts(ground: Ground, source: Mesh, piece: Matrix4, placed: readonly PlacedMember[], ctx: MaterialContext): InstancedMesh {
  const rng = new Rng(seedRng(CONTEXT_SEED));
  const tufts = new InstancedMesh(source.geometry, source.material, CONTEXT_TUFTS);
  tufts.name = 'context_grass_instances';
  tufts.castShadow = false;
  tufts.receiveShadow = true;
  tufts.layers.set(LAYERS.noEdge);
  const roots = placed.map((entry) => toTangent(entry.member.s, entry.member.d));
  const holder = new Group();
  const matrix = new Matrix4();
  const radius = WORLD_REACH + CONTEXT_MARGIN;
  let count = 0;
  // Each draw that lands too near a member is drawn again; the disc is mostly open meadow, so this ends quickly, and the
  // cap on draws keeps a future crowded layout from spinning.
  for (let draw = 0; draw < CONTEXT_TUFTS * 50 && count < CONTEXT_TUFTS; draw++) {
    const angle = rng.range(0, Math.PI * 2);
    const distance = Math.sqrt(rng.range(0, radius * radius));
    const yaw = rng.range(0, Math.PI * 2);
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    if (roots.some((spot) => Math.hypot(spot.x - x, spot.z - z) < CONTEXT_CLEARANCE)) continue;
    place(holder, ground, x, z, yaw, LEAN.flora);
    holder.updateMatrix();
    tufts.setMatrixAt(count, matrix.multiplyMatrices(holder.matrix, piece));
    count += 1;
  }
  tufts.count = count;
  tufts.instanceMatrix.needsUpdate = true;
  tufts.computeBoundingSphere();
  attachHull(tufts, ctx.hullMaterial, ctx.hullLayer);
  return tufts;
}
