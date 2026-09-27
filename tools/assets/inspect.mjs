// Counts what the budget check needs from a GLB and measures where the things the runtime places meet the ground.
import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { assetIO } from './optimize.mjs';

const TRIANGLES = 4;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// A top-level empty's quaternion counts as no rotation while its vector part, sin(angle / 2), stays under this: that
// tilts a point 10 m out by at most 20 micrometres, far below the manifest's 0.1 mm rounding.
const NO_ROTATION = 1e-6;

export async function inspectGlb(path) {
  const io = await assetIO();
  const doc = await io.read(path);
  const root = doc.getRoot();
  let tris = 0;
  let hasInk = false;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getAttribute('_INK')) hasInk = true;
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
  return { tris: Math.round(tris), bones, animations, textures, nodes, hasInk, doubleSided, ground, bytes };
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
 * under it that carries a rotation, which the runtime replaces; a primitive with morph targets, whose weights move the
 * vertices measured here; and a skinned primitive with any influence set but JOINTS_0 and WEIGHTS_0 (skinnedY).
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
  top.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const skin = node.getSkin();
    const rows = skin ? skinRows(skin) : null;
    const row = skin ? null : rowY(node.getWorldMatrix());
    mesh.listPrimitives().forEach((prim, i) => {
      const where = `${asset}: primitive ${i} of mesh '${mesh.getName()}' on node ${label(node)}`;
      const targets = prim.listTargets().length;
      if (targets) {
        throw new Error(
          `${where} has ${targets} morph target(s); the ground measurement reads only its base positions, which any ` +
            'target weight moves',
        );
      }
      lowest = Math.min(lowest, primitiveMinY(prim, rows ? skinnedY(prim, rows, where) : (p) => dot(row, p)));
    });
  });
  return lowest;
}

// A node the quantizer split off has no name, so it is named by its nearest named ancestor.
function label(node) {
  if (node.getName()) return `'${node.getName()}'`;
  const parent = node.getParentNode();
  return parent ? `(unnamed, under ${label(parent)})` : '(unnamed)';
}

// Only the vertices a primitive's indices use are drawn, so only those can stand on the ground.
function primitiveMinY(prim, worldY) {
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
    lowest = Math.min(lowest, worldY(position.getElement(index, p), index));
  }
  return lowest;
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
    return rowYOfProduct(joint.getWorldMatrix(), inverseBind ? inverseBind.getElement(j, ibm) : IDENTITY);
  });
}

/**
 * Weights a skinned vertex as three r186 draws it. Three skins with JOINTS_0 and WEIGHTS_0 alone (GLTFLoader maps no
 * other set to its skinning attributes), so a primitive with more sets, which glTF allows for over four influences per
 * vertex, or with none, is refused rather than measured where three does not draw it. GLTFLoader also scales each
 * vertex's weights to sum to 1 (SkinnedMesh.normalizeSkinWeights) and binds a vertex with no weight wholly to its first
 * joint. This used to add every influence set unscaled and skip a vertex with no weight as one drawn at the origin,
 * which glTF's formula gives but three does not draw.
 */
function skinnedY(prim, rows, where) {
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
  const jointRow = (joint) => {
    if (joint >= rows.length) throw new Error(`${where} names joint ${joint}, past the ${rows.length} of its skin`);
    return rows[joint];
  };
  return (p, index) => {
    jointAttribute.getElement(index, joints);
    weightAttribute.getElement(index, weights);
    const total = Math.abs(weights[0]) + Math.abs(weights[1]) + Math.abs(weights[2]) + Math.abs(weights[3]);
    if (total === 0) return dot(jointRow(joints[0]), p);
    let y = 0;
    for (let k = 0; k < 4; k++) if (weights[k]) y += weights[k] * dot(jointRow(joints[k]), p);
    return y / total;
  };
}

// Row 1 of a column-major 4x4 matrix, world Y as a function of a local point, which is all a ground measurement needs.
// m[1] and m[9] carry a point's x and z into its height wherever a rotation tilts the node or one above it.
function rowY(m) {
  return [m[1], m[5], m[9], m[13]];
}

function rowYOfProduct(a, b) {
  const row = [0, 0, 0, 0];
  for (let column = 0; column < 4; column++) {
    for (let k = 0; k < 4; k++) row[column] += a[k * 4 + 1] * b[column * 4 + k];
  }
  return row;
}

function dot(row, p) {
  return row[0] * p[0] + row[1] * p[1] + row[2] * p[2] + row[3];
}

function tenthMillimetre(metres) {
  if (!Number.isFinite(metres)) return null;
  const rounded = Math.round(metres * 1e4) / 1e4;
  // A value a hair under zero rounds to -0, which JSON writes as 0 but Object.is, and so Vitest's toEqual, tells apart.
  return rounded === 0 ? 0 : rounded;
}
