// Counts what the budget check needs from a GLB and measures where the things the runtime places meet the ground.
import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { GROUND_TOLERANCE } from './check.mjs';
import { assetIO } from './optimize.mjs';

const TRIANGLES = 4;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// A top-level empty's quaternion counts as no rotation while its vector part, sin(angle / 2), stays under this: that
// tilts a point 10 m out by at most 20 micrometres, far below the manifest's 0.1 mm rounding.
const NO_ROTATION = 1e-6;
// A morph target moves a vertex when it displaces it by more than this in the asset's metres: the manifest's 0.1 mm
// rounding, the finest ground contact it records. A target leaves the vertices it does not move at exactly 0, and the
// quantizer keeps 0 exact, so any displacement it reports is one the recipe authored.
export const MORPH_STILL = 1e-4;

export async function inspectGlb(path) {
  const io = await assetIO();
  const doc = await io.read(path);
  const root = doc.getRoot();
  let tris = 0;
  let hasInk = false;
  // Each morph target's name once, in the order the file first names it; glTF keeps the names in mesh.extras.targetNames,
  // which GLTFLoader turns into morphTargetDictionary, the names the face driver sets.
  const morphs = [];
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getAttribute('_INK')) hasInk = true;
      prim.listTargets().forEach((target, i) => {
        const name = target.getName() || String(i);
        if (!morphs.includes(name)) morphs.push(name);
      });
      if (prim.getMode() !== TRIANGLES) continue;
      const indices = prim.getIndices();
      tris += (indices ? indices.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  }
  const bones = root.listSkins().reduce((most, skin) => Math.max(most, skin.listJoints().length), 0);
  const animations = root.listAnimations().map((animation) => ({
    name: animation.getName(),
    duration: Math.max(0, ...animation.listSamplers().map((sampler) => sampler.getInput()?.getMax([])[0] ?? 0)),
  }));
  const textures = root.listTextures().map((texture) => {
    const size = texture.getSize();
    return { width: size?.[0] ?? 0, height: size?.[1] ?? 0, mime: texture.getMimeType() };
  });
  const nodes = root.listNodes().map((node) => node.getName());
  const doubleSided = root.listMaterials().some((material) => material.getDoubleSided());
  const ground = measureGround(doc, basename(path));
  const bytes = statSync(path).size;
  return { tris: Math.round(tris), bones, animations, textures, nodes, hasInk, doubleSided, ground, bytes, morphs };
}

/**
 * Where the shipped file meets the ground in its bind pose: the lowest Y of the whole asset's geometry and of each
 * top-level node's subtree, each measured from its placement origin (blender/lib/ctx.py Placeable), the point the
 * runtime puts on the ground. The runtime sets a top-level empty's position and rotation, so an empty is measured from
 * its own origin. A mesh node's authored origin does not survive optimization: the quantizer turns the node's
 * translation and scale into its quantization box, and the runtime composes such a node's matrix into each placement
 * instead of overwriting it, so a mesh node, like the whole asset, is measured from the asset origin. Which nodes are
 * empties is read after the quantizer, which moves the mesh of any node that has children onto a new unnamed child, so
 * a Blender mesh object with children ships, and is measured, as an empty at its authored origin. Metres, rounded to
 * 0.1 mm so that a rebuild of the same geometry leaves the manifest unchanged; null where there is no geometry.
 *
 * Where a number could not stand for what the runtime draws, this throws instead, naming `asset` (the file) and the
 * node, so the build fails rather than record a ground contact that only looks right: a top-level empty with geometry
 * under it that carries a rotation, which the runtime replaces; a morph target that could move the ground contact
 * (checkMorphs; a face morph passes); and a skinned primitive with any influence set but JOINTS_0 and WEIGHTS_0
 * (skinned).
 */
export function measureGround(doc, asset = 'the document') {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  let lowest = Infinity;
  const nodes = (scene?.listChildren() ?? []).map((node) => {
    const low = subtreeMinY(node, asset);
    lowest = Math.min(lowest, low);
    const empty = !node.getMesh();
    // An empty with nothing under it, a marker, is no placement handle (manifest.mjs groundEntries), so it may turn.
    if (empty && Number.isFinite(low) && Math.hypot(...node.getRotation().slice(0, 3)) > NO_ROTATION) {
      const quaternion = node.getRotation().map((value) => value.toFixed(4)).join(', ');
      throw new Error(
        `${asset}: top-level empty ${label(node)} carries a rotation (quaternion ${quaternion}), which the runtime ` +
          'replaces when it sets the empty on a ground point, so its ground contact would be measured in a pose the ' +
          "runtime never draws; rotate the empty's children in the recipe instead",
      );
    }
    return { name: node.getName(), empty, minY: tenthMillimetre(low - (empty ? node.getWorldMatrix()[13] : 0)) };
  });
  return { asset: tenthMillimetre(lowest), nodes };
}

function subtreeMinY(top, asset) {
  let lowest = Infinity;
  // A morphed primitive can only be judged against the placeable's lowest point, so it waits until all of it is known.
  const morphed = [];
  top.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const skin = node.getSkin();
    const joints = skin ? skinRows(skin) : null;
    const rows = skin ? null : rowsOf(node.getWorldMatrix());
    mesh.listPrimitives().forEach((prim, i) => {
      const where = `${asset}: primitive ${i} of mesh '${mesh.getName()}' on node ${label(node)}`;
      const place = joints ? skinned(prim, joints, where) : rigid(rows);
      lowest = Math.min(lowest, primitiveMinY(prim, place));
      if (prim.listTargets().length) morphed.push({ prim, place, where, mesh });
    });
  });
  for (const { prim, place, where, mesh } of morphed) checkMorphs(prim, place, lowest, where, mesh);
  return lowest;
}

/**
 * Morph targets are allowed on the terms the ground contract can keep. No target may move a vertex that lies within
 * GROUND_TOLERANCE of its placeable's lowest point (for a commander, one placeable, the asset's lowest point: the
 * ground contact), and none may carry any other vertex down to within that band. A displacement is linear in its weight,
 * so judging each target at weight 1 covers every weight from 0 to 1, the range Blender's shape key sliders and the
 * labs' face driver keep to; the file's own default weights must lie in it too, or the rest pose three draws would not
 * be the one measured here. A face morph, a blink or a smile, passes. A morph that bends a foot, or drops a hem to the
 * ground, is refused: the ground measurement reads only base positions, which such a target moves.
 */
function checkMorphs(prim, place, low, where, mesh) {
  const weight = mesh.getWeights().find((value) => !(value >= 0 && value <= 1));
  if (weight !== undefined) {
    throw new Error(`${where}: its mesh's default morph weight ${weight} is outside 0 to 1, where the ground rule for morphs holds`);
  }
  const position = prim.getAttribute('POSITION');
  if (!position) return;
  const band = low + GROUND_TOLERANCE;
  const targets = prim
    .listTargets()
    .map((target, i) => ({ name: target.getName() || String(i), delta: target.getAttribute('POSITION'), grounded: 0, lowered: 0, most: 0, deepest: Infinity }))
    .filter((target) => target.delta);
  const indices = prim.getIndices();
  const count = indices ? indices.getCount() : position.getCount();
  const seen = new Uint8Array(position.getCount());
  const p = [0, 0, 0];
  const d = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    const index = indices ? indices.getScalar(i) : i;
    if (seen[index]) continue;
    seen[index] = 1;
    const y = place.point(position.getElement(index, p), index, 1);
    for (const target of targets) {
      target.delta.getElement(index, d);
      if (d[0] === 0 && d[1] === 0 && d[2] === 0) continue;
      const move = [0, 1, 2].map((axis) => place.vector(d, index, axis));
      const length = Math.hypot(...move);
      if (length <= MORPH_STILL) continue;
      if (y <= band) {
        target.grounded += 1;
        target.most = Math.max(target.most, length);
      } else if (y + move[1] <= band) {
        target.lowered += 1;
        target.deepest = Math.min(target.deepest, y + move[1]);
      }
    }
  }
  const failures = targets.flatMap((target) => [
    ...(target.grounded ? [`morph target '${target.name}' moves ${target.grounded} vertices within ${GROUND_TOLERANCE * 1000} mm of the ground contact by up to ${(target.most * 1000).toFixed(1)} mm`] : []),
    ...(target.lowered ? [`morph target '${target.name}' carries ${target.lowered} vertices down to within ${GROUND_TOLERANCE * 1000} mm of the ground contact (to ${target.deepest.toFixed(4)} m)`] : []),
  ]);
  if (failures.length) {
    throw new Error(
      `${where}: ${failures.join('; ')}. The ground measurement reads only base positions, so a morph target is ` +
        `allowed only where it neither moves a vertex within ${GROUND_TOLERANCE * 1000} mm of the lowest point ` +
        `(${low.toFixed(4)} m) nor carries one down to it, as a face morph does`,
    );
  }
}

// A node the quantizer split off has no name, so it is named by its nearest named ancestor.
function label(node) {
  if (node.getName()) return `'${node.getName()}'`;
  const parent = node.getParentNode();
  return parent ? `(unnamed, under ${label(parent)})` : '(unnamed)';
}

// Only the vertices a primitive's indices use are drawn, so only those can stand on the ground.
function primitiveMinY(prim, place) {
  const position = prim.getAttribute('POSITION');
  if (!position) return Infinity;
  const indices = prim.getIndices();
  const count = indices ? indices.getCount() : position.getCount();
  const seen = new Uint8Array(position.getCount());
  const p = [0, 0, 0];
  let lowest = Infinity;
  for (let i = 0; i < count; i++) {
    const index = indices ? indices.getScalar(i) : i;
    if (seen[index]) continue;
    seen[index] = 1;
    lowest = Math.min(lowest, place.point(position.getElement(index, p), index, 1));
  }
  return lowest;
}

/**
 * Where a vertex of an unskinned primitive is drawn: `point` gives one world axis (0, 1 or 2) of a local point, and
 * `vector` the same axis of a local displacement, such as a morph target's, which the translation does not move. The
 * ground needs only the height; a morph's displacement is measured in all three, since a foot slid sideways has moved.
 */
function rigid(rows) {
  return {
    point: (p, _index, axis) => dot(rows[axis], p),
    vector: (d, _index, axis) => dotLinear(rows[axis], d),
  };
}

/**
 * glTF draws a skinned vertex at the weighted sum of (joint world matrix x inverse bind matrix) applied to it and
 * ignores the mesh node's own transform, as three r186 does (GLTFLoader binds each skinned mesh with an identity bind
 * matrix), so the quantizer puts a skinned mesh's dequantization into its inverse bind matrices. getBounds() reads only
 * node transforms and put the Husk's lowest point at -0.664 and the Bulwark's at -1.000, where through the skin they
 * stand at -0.0024 and 0.0000. In the bind pose every joint's product is the same matrix, so the weights only matter
 * for a file saved in another pose.
 */
function skinRows(skin) {
  const inverseBind = skin.getInverseBindMatrices();
  const ibm = [...IDENTITY];
  return skin.listJoints().map((joint, j) => {
    return rowsOfProduct(joint.getWorldMatrix(), inverseBind ? inverseBind.getElement(j, ibm) : IDENTITY);
  });
}

/**
 * Weights a skinned vertex as three r186 draws it. Three skins with JOINTS_0 and WEIGHTS_0 alone (GLTFLoader maps no
 * other set to its skinning attributes), so a primitive with more sets, which glTF allows for over four influences per
 * vertex, or with none, is refused rather than measured where three does not draw it. GLTFLoader also scales each
 * vertex's weights to sum to 1 (SkinnedMesh.normalizeSkinWeights) and binds a vertex with no weight wholly to its first
 * joint. This used to add every influence set unscaled and skip a vertex with no weight as one drawn at the origin,
 * which glTF's formula gives but three does not draw. A morph target's displacement is carried by the same weighted
 * joints, without their translations, as three skins a morphed position.
 */
function skinned(prim, jointRows, where) {
  const sets = prim.listSemantics().filter((semantic) => /^(JOINTS|WEIGHTS)_\d+$/.test(semantic)).sort();
  if (sets.join() !== 'JOINTS_0,WEIGHTS_0') {
    throw new Error(
      `${where} is skinned with ${sets.join(', ') || 'no influence set'}; three r186 skins with JOINTS_0 and ` +
        'WEIGHTS_0 alone, so its ground contact cannot be measured as drawn (export at most 4 influences per vertex)',
    );
  }
  const jointAttribute = prim.getAttribute('JOINTS_0');
  const weightAttribute = prim.getAttribute('WEIGHTS_0');
  const joints = [0, 0, 0, 0];
  const weights = [0, 0, 0, 0];
  const rowsOfJoint = (joint) => {
    if (joint >= jointRows.length) throw new Error(`${where} names joint ${joint}, past the ${jointRows.length} of its skin`);
    return jointRows[joint];
  };
  const weigh = (index, apply) => {
    jointAttribute.getElement(index, joints);
    weightAttribute.getElement(index, weights);
    const total = Math.abs(weights[0]) + Math.abs(weights[1]) + Math.abs(weights[2]) + Math.abs(weights[3]);
    if (total === 0) return apply(rowsOfJoint(joints[0]));
    let sum = 0;
    for (let k = 0; k < 4; k++) if (weights[k]) sum += weights[k] * apply(rowsOfJoint(joints[k]));
    return sum / total;
  };
  return {
    point: (p, index, axis) => weigh(index, (rows) => dot(rows[axis], p)),
    vector: (d, index, axis) => weigh(index, (rows) => dotLinear(rows[axis], d)),
  };
}

// Rows 0 to 2 of a column-major 4x4 matrix: world x, y and z as functions of a local point. Row 1's m[1] and m[9]
// carry a point's x and z into its height wherever a rotation tilts the node or one above it.
function rowsOf(m) {
  return [0, 1, 2].map((r) => [m[r], m[4 + r], m[8 + r], m[12 + r]]);
}

function rowsOfProduct(a, b) {
  return [0, 1, 2].map((r) => {
    const row = [0, 0, 0, 0];
    for (let column = 0; column < 4; column++) {
      for (let k = 0; k < 4; k++) row[column] += a[k * 4 + r] * b[column * 4 + k];
    }
    return row;
  });
}

function dot(row, p) {
  return row[0] * p[0] + row[1] * p[1] + row[2] * p[2] + row[3];
}

// A displacement has no position, so the row's translation does not apply to it.
function dotLinear(row, d) {
  return row[0] * d[0] + row[1] * d[1] + row[2] * d[2];
}

function tenthMillimetre(metres) {
  if (!Number.isFinite(metres)) return null;
  const rounded = Math.round(metres * 1e4) / 1e4;
  // A value a hair under zero rounds to -0, which JSON writes as 0 but Object.is, and so Vitest's toEqual, tells apart.
  return rounded === 0 ? 0 : rounded;
}
