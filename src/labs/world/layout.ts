import { AnimationMixer, Box3, Group, LoopRepeat, Vector3, type Mesh, type Object3D } from 'three';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import type { LoadedAsset, MaterialContext } from '../../render/assets/loadAsset';
import { syncHullMorphs } from '../../render/ink/hull';
import { LAYERS } from '../../render/layers';
import { place, type Ground } from '../../render/terrain/place';
import { createCommanderFace, FACE_SEED, faceDemoWeights, holdFacePose, type FacePose } from '../shared/commanderFace';
import { EXPRESSION_MORPHS, type Expression, type FaceDriver } from '../shared/faceDriver';
import { NO_EDGE_PIECES } from '../shared/meadow';
import { LIVE_HEART_START_LEVEL, memberYaw, toTangent, type WorldMember } from './registry';

/** The heart's growth stages, one node per level (blender/recipes/heart.py), of which a heart shows one. */
export const HEART_STAGES = 11;
/** One sweep of a tower head, left and right of its rest, in seconds and in degrees to each side. */
export const TURRET_SWEEP_SECONDS = 9;
export const TURRET_SWEEP_DEG = 35;
/**
 * A member's label stands on its body's top: the highest point where its drawn surface crosses the line up through its
 * root or one of LABEL_AXIS_LINES lines around it, this many metres out. With the highest point of all, Bulwark's
 * upright sword and a tower's barrels lifted the labels above the body, and in a close view onto the assets behind it
 * ("Mark II" sat on a Husk, "Idle" on a heart). The surface is crossed rather than its vertices sampled, because a
 * low-poly box has vertices only at its corners, none of them near its middle.
 */
export const LABEL_AXIS_RADIUS = 0.3;
export const LABEL_AXIS_LINES = 8;
/**
 * Kit pieces that cast no shadow, as the Style Lab's meadow grass casts none (its scatter in labs/style/scene.ts): the
 * member is the same piece, so it reads here as it does in the game's meadow.
 */
export const SHADOWLESS_PIECES: readonly string[] = ['grass_tuft'];

export interface PlacedMember {
  member: WorldMember;
  /** The object place() stood on the ground: the asset's root, a tower mark's own node, or a kit piece's holder. */
  root: Object3D;
  /** The visible geometry's world bounds, drawn stages only, taken in the pose the member opens in. */
  bounds: Box3;
  /**
   * The visible point lowest along the planet's up at the member's spot, in the same pose: its ground contact, which
   * the browser test holds to the manifest's ground record. The bounds' lowest corner cannot stand for it, because the
   * planet's curve tilts a member 17 m out by 6 degrees from the world's y axis, which alone put rock B's bounds 14 cm
   * under its root.
   */
  lowest: Vector3;
  /** The point on the member's own up line through its root at the top of its body (LABEL_AXIS_RADIUS), for its label. */
  top: Vector3;
}

/** A member whose rig carries a face: its driver, and whether its face cycles the expression demo or holds a pose. */
interface MemberFace {
  member: WorldMember;
  root: Object3D;
  driver: FaceDriver;
  held: boolean;
}

/** What the test handle reads of a face: its lids, its expressions, and whether every hull under it shares its morphs. */
export interface FaceReading {
  name: string;
  blink: number;
  expressions: Record<Expression, number>;
  hullsShared: boolean;
}

export interface AssetWorld {
  root: Group;
  members: PlacedMember[];
  /**
   * Advances the loops, the tower sweeps and the faces by `dt` seconds of animation time (already scaled by the speed
   * dial). Each face moves after its mixer, which would otherwise write any morph or jaw track its clips carry over it.
   */
  update(dt: number): void;
  setHeartLevel(level: number): void;
  heartLevel(): number;
  /** Holds every face while the page is frozen, mid-blink included, as the page's zero step holds the clips. */
  setFrozen(on: boolean): void;
  /**
   * Holds a face pose on a member for an evidence frame (lids and expressions from 0 to 1), or with null hands the face
   * back to its auto-blink and, for the face member, its demo. False for a name with no face.
   */
  setFace(name: string, pose: FacePose | null): boolean;
  faces(): FaceReading[];
}

/** The up lines a member's top is read on, as offsets across its up: its own, and LABEL_AXIS_LINES around it. */
const AXIS_LINES: readonly (readonly [number, number])[] = [
  [0, 0],
  ...Array.from({ length: LABEL_AXIS_LINES }, (_, i): [number, number] => {
    const angle = (i / LABEL_AXIS_LINES) * Math.PI * 2;
    return [LABEL_AXIS_RADIUS * Math.cos(angle), LABEL_AXIS_RADIUS * Math.sin(angle)];
  }),
];

/**
 * Reads what a member draws, ink hulls left out and skinned meshes in the pose they are in: its bounds, its lowest point
 * along `groundUp`, and its body's top along its own up (LABEL_AXIS_RADIUS). getVertexPosition applies a skinned mesh's
 * bones, and so the dequantization M0c moves into its inverse bind matrices: a skinned mesh's own bounding box is its
 * quantization box, about 2 m on a side whatever the body.
 */
function measure(entry: PlacedMember, groundUp: Vector3, hullMaterial: unknown): void {
  const { root, bounds, lowest, top } = entry;
  bounds.makeEmpty();
  root.updateMatrixWorld(true);
  const origin = new Vector3().setFromMatrixPosition(root.matrixWorld);
  const ownUp = new Vector3(0, 1, 0).transformDirection(root.matrixWorld);
  // Two directions across the member's up, so each drawn point has a place on the plane its up lines cross.
  const across = new Vector3(1, 0, 0).projectOnPlane(ownUp);
  if (across.lengthSq() < 1e-6) across.set(0, 0, 1).projectOnPlane(ownUp);
  across.normalize();
  const across2 = new Vector3().crossVectors(ownUp, across);
  const vertex = new Vector3();
  const offset = new Vector3();
  let low = Infinity;
  let highest = -Infinity;
  let axisTop = -Infinity;
  lowest.copy(origin);
  root.traverseVisible((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || mesh.material === hullMaterial) return;
    const position = mesh.geometry.getAttribute('position');
    if (!position) return;
    // Each vertex once, as (across, across2, height along the member's up), for the crossings below.
    const flat = new Float64Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld);
      bounds.expandByPoint(vertex);
      offset.subVectors(vertex, origin);
      const depth = offset.dot(groundUp);
      if (depth < low) {
        low = depth;
        lowest.copy(vertex);
      }
      const height = offset.dot(ownUp);
      highest = Math.max(highest, height);
      flat[i * 3] = offset.dot(across);
      flat[i * 3 + 1] = offset.dot(across2);
      flat[i * 3 + 2] = height;
    }
    const index = mesh.geometry.getIndex();
    const corners = index ? index.count : position.count;
    for (let t = 0; t + 2 < corners; t += 3) {
      const a = (index ? index.getX(t) : t) * 3;
      const b = (index ? index.getX(t + 1) : t + 1) * 3;
      const c = (index ? index.getX(t + 2) : t + 2) * 3;
      const ax = flat[a]!, ay = flat[a + 1]!, bx = flat[b]!, by = flat[b + 1]!, cx = flat[c]!, cy = flat[c + 1]!;
      const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      // A face standing along the up lines crosses none of them at a single point.
      if (Math.abs(area) < 1e-12) continue;
      for (const [px, py] of AXIS_LINES) {
        const u = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / area;
        const v = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / area;
        const w = 1 - u - v;
        if (u < 0 || v < 0 || w < 0) continue;
        axisTop = Math.max(axisTop, u * flat[a + 2]! + v * flat[b + 2]! + w * flat[c + 2]!);
      }
    }
  });
  // A member whose surface crosses none of its up lines (a ring, say) falls back to its highest point; one with nothing
  // drawn, to its root.
  const rise = Number.isFinite(axisTop) ? axisTop : Number.isFinite(highest) ? highest : 0;
  top.copy(origin).addScaledVector(ownUp, rise);
}

/**
 * Takes the object a member stands on the ground, following the ground contract M0c's asset check measures
 * (tools/assets/inspect.mjs): the runtime sets a whole asset's root, and a top-level empty's own position and rotation,
 * so both are placed themselves; a mesh node's matrix is its quantization box, not its authored origin, so it keeps that
 * matrix inside a holder, and the holder is placed. A whole asset's first member takes the loaded root and every later
 * one a copy, cloned with its rig so each copy's skeleton follows its own mixer.
 *
 * "Mesh node" is read from the three.js type, which matches inspect.mjs (a node that carries a mesh) only while every
 * such node has a single primitive: GLTFLoader loads a node with two or more primitives (a piece with two materials) as
 * a Group, which this would place as an empty and so overwrite its quantization matrix. The shipped GLBs are held to one
 * primitive per placed mesh node by tests/unit/labs/world-glb.test.ts, which says so by name when one is not.
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
  const groundUps: Vector3[] = [];
  const mixers: AnimationMixer[] = [];
  const turrets: { yaw: Object3D; rest: number; phase: number }[] = [];
  const hearts: { member: PlacedMember; up: Vector3; stages: (Object3D | undefined)[]; live: boolean }[] = [];
  const faces: MemberFace[] = [];
  let liveLevel = LIVE_HEART_START_LEVEL;
  let frozen = false;

  for (const member of members) {
    const asset = assets.get(member.entry);
    if (!asset) throw new Error(`the Asset World has no loaded asset ${member.entry} for its member ${member.name}`);
    const object = takeRoot(member, asset, used);
    const { x, z } = toTangent(member.s, member.d);
    place(object, ground, x, z, memberYaw(member), member.lean);
    root.add(object);
    // The Style Lab draws its grass and flowers out of the screen-space edge pass (NO_EDGE_PIECES), which outlined every
    // blade, and its grass casts no shadow; the world draws the same pieces the same way, so each looks here as it does
    // in the game's meadow.
    const noEdge = member.node !== null && NO_EDGE_PIECES.includes(member.node);
    const shadowless = member.node !== null && SHADOWLESS_PIECES.includes(member.node);
    if (noEdge || shadowless) {
      object.traverse((child) => {
        const mesh = child as Mesh;
        if (!mesh.isMesh || mesh.material === ctx.hullMaterial) return;
        if (noEdge) mesh.layers.set(LAYERS.noEdge);
        if (shadowless) mesh.castShadow = false;
      });
    }
    const entry: PlacedMember = { member, root: object, bounds: new Box3(), lowest: new Vector3(), top: new Vector3() };
    placed.push(entry);
    groundUps.push(ground.surfaceAt(x, z).up.clone());

    if (member.clip) {
      const clip = asset.animations.find((candidate) => candidate.name === member.clip);
      if (!clip) throw new Error(`asset ${member.entry} has no clip ${member.clip} for the Asset World member ${member.name}`);
      const mixer = new AnimationMixer(object);
      // Every clip loops in place, the attacks included, which the game plays once: the world is for reading a clip,
      // so it repeats it rather than waiting between strikes.
      mixer.clipAction(clip).setLoop(LoopRepeat, Infinity).play();
      mixers.push(mixer);
    }
    // A SkeletonUtils copy's hulls hold sliced copies of its body's morph influences until their first draw re-points
    // them (syncHullMorphs), so a copy the camera had not yet drawn, Pip-A's run and face members from the towers' view,
    // read as unshared. Pointing them now makes every instance's ink share its lids from the start.
    object.traverse((child) => {
      if ((child as Mesh).isMesh && (child as Mesh).material === ctx.hullMaterial) syncHullMorphs(child);
    });
    // Every instance of a rig with a face blinks on its own seeded timing, taken in member order so every load blinks
    // alike; the driver is made here, before any mixer moves the rig, because it reads the jaw's axis from the bind pose.
    const driver = createCommanderFace(object, FACE_SEED + faces.length);
    if (driver) faces.push({ member, root: object, driver, held: false });
    if (member.node?.startsWith('bolt_mk')) {
      const yaw = object.getObjectByName(`${member.node}_yaw`);
      // The three heads sweep a third of a period apart, so the row never moves in step and each reads on its own.
      if (yaw) turrets.push({ yaw, rest: yaw.rotation.y, phase: (turrets.length * 2 * Math.PI) / 3 });
    }
    if (member.heartStage !== null) {
      const stages = Array.from({ length: HEART_STAGES }, (_, level) => object.getObjectByName(stageName(level)));
      hearts.push({ member: entry, up: groundUps[groundUps.length - 1]!, stages, live: member.heartStage === 'live' });
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
  // Every member takes its opening pose before it is measured, so the labels and camera fits frame what is drawn.
  for (const mixer of mixers) mixer.update(0);
  sweep(0);
  placed.forEach((entry, index) => measure(entry, groundUps[index]!, ctx.hullMaterial));

  return {
    root,
    members: placed,
    update(dt) {
      clock += dt;
      for (const mixer of mixers) mixer.update(dt);
      sweep(clock);
      for (const face of faces) {
        // The demo runs on the world's clock, so it opens on neutral and a zero step, frozen or paused, holds it.
        if (face.member.faceDemo && !face.held && !frozen && dt > 0) {
          const weights = faceDemoWeights(clock);
          for (const name of EXPRESSION_MORPHS) face.driver.setExpression(name, weights[name]);
        }
        face.driver.update(dt);
      }
    },
    setHeartLevel(level) {
      liveLevel = Math.min(HEART_STAGES - 1, Math.max(0, Math.round(level)));
      showStages();
      for (const heart of hearts) if (heart.live) measure(heart.member, heart.up, ctx.hullMaterial);
    },
    heartLevel: () => liveLevel,
    setFrozen(on) {
      frozen = on;
      for (const face of faces) face.driver.setFrozen(on);
    },
    setFace(name, pose) {
      const face = faces.find((candidate) => candidate.member.name === name);
      if (!face) return false;
      holdFacePose(face.driver, pose);
      face.held = pose !== null;
      // Handed back mid-demo, the face takes the demo's weights at once rather than resting until the clock moves.
      if (!pose && face.member.faceDemo) {
        const weights = faceDemoWeights(clock);
        for (const expression of EXPRESSION_MORPHS) face.driver.setExpression(expression, weights[expression]);
      }
      return true;
    },
    faces: () =>
      faces.map((face) => {
        const expressions = Object.fromEntries(EXPRESSION_MORPHS.map((name) => [name, 0])) as Record<Expression, number>;
        let hullsShared = true;
        face.root.traverse((object) => {
          const mesh = object as Mesh;
          if (mesh.isMesh && mesh.material === ctx.hullMaterial && mesh.morphTargetInfluences) {
            hullsShared &&= mesh.morphTargetInfluences === (mesh.parent as Mesh | null)?.morphTargetInfluences;
          }
        });
        const body = face.driver.meshes.find((mesh) => mesh.material !== ctx.hullMaterial);
        if (body?.morphTargetDictionary && body.morphTargetInfluences) {
          for (const name of EXPRESSION_MORPHS) {
            const index = body.morphTargetDictionary[name];
            if (index !== undefined) expressions[name] = body.morphTargetInfluences[index] ?? 0;
          }
        }
        return { name: face.member.name, blink: face.driver.blink, expressions, hullsShared };
      }),
  };
}
