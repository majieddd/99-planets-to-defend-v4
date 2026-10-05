import { Box3, Matrix4, Vector3, type Mesh, type Object3D, type SkinnedMesh } from 'three';

/**
 * How near Pip's body comes to a training dummy's geometry: an evidence reading for the arena's side view and its
 * browser test (labs/combat/main.ts, `__P99__.bodyGap`), which the page never calls on its own. His body is every
 * vertex of his meshes but his sword's and his shield's (PIP_PROPS), posed as drawn; the dummy's is every vertex of
 * its meshes, posed as drawn. The reading is the least distance between a vertex of one and a vertex of the other, so
 * it can only overstate a true gap by up to the meshes' own vertex spacing (a few centimetres on the Husk's 1,740
 * triangles); a gap that falls to 0 or near it is read off the side-view frame, not taken from this number alone.
 */

/** The ink hulls copy the meshes they ink; they are left out, as the drawn bounds leave them out (dummies.ts). */
export interface BodyGapOptions {
  hullMaterial: unknown;
}

/** Which of Pip's vertices are props, not body: by mesh, one flag per vertex. */
export type PropMask = Map<Mesh, Uint8Array>;

/** The bone a vertex leans on most. */
function topBone(mesh: SkinnedMesh, i: number): number {
  const index = mesh.geometry.getAttribute('skinIndex');
  const weight = mesh.geometry.getAttribute('skinWeight');
  let best = 0;
  let at = 0;
  for (let k = 0; k < 4; k++) {
    const w = weight.getComponent(i, k);
    if (w > best) [best, at] = [w, k];
  }
  return index.getComponent(i, at);
}

/**
 * Pip's props, read once in the bind pose through each skin's own inverse bind matrices: the shield is the armour on his
 * left forearm (its guard included), and the sword the armour on his right hand that stands more than PROP_MITTEN_M
 * along the line from the hand to the blade's tip (the farthest vertex on the hand), past his mitten.
 */
export const PROP_MITTEN_M = 0.1;
export function pipProps(root: Object3D): PropMask {
  const mask: PropMask = new Map();
  const v = new Vector3();
  root.traverse((object) => {
    const mesh = object as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const position = mesh.geometry.getAttribute('position');
    const flags = new Uint8Array(position.count);
    mask.set(mesh, flags);
    if (mesh.name !== 'commander_armour' && !mesh.name.startsWith('commander_armour')) return;
    const bones = mesh.skeleton.bones;
    const hand = bones.findIndex((bone) => bone.name.endsWith('RightHand'));
    const fore = bones.findIndex((bone) => bone.name.endsWith('LeftForeArm'));
    if (hand < 0) return;
    const toHand = new Matrix4().multiplyMatrices(mesh.skeleton.boneInverses[hand]!, mesh.bindMatrix);
    let tip = new Vector3();
    for (let i = 0; i < position.count; i++) {
      if (topBone(mesh, i) !== hand) continue;
      v.fromBufferAttribute(position, i).applyMatrix4(toHand);
      if (v.lengthSq() > tip.lengthSq()) tip = v.clone();
    }
    const along = tip.normalize();
    for (let i = 0; i < position.count; i++) {
      const bone = topBone(mesh, i);
      if (bone === fore) flags[i] = 1;
      else if (bone === hand && v.fromBufferAttribute(position, i).applyMatrix4(toHand).dot(along) > PROP_MITTEN_M) flags[i] = 1;
    }
  });
  return mask;
}

/** Every posed vertex of a body in world space, ink hulls and flagged props left out, every `every`th. */
function posedPoints(root: Object3D, options: BodyGapOptions, props: PropMask | null, every: number): Vector3[] {
  const out: Vector3[] = [];
  root.updateMatrixWorld(true);
  root.traverseVisible((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || mesh.material === options.hullMaterial) return;
    const position = mesh.geometry.getAttribute('position');
    if (!position) return;
    const flags = props?.get(mesh);
    for (let i = 0; i < position.count; i += every) {
      if (flags?.[i]) continue;
      out.push(mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld));
    }
  });
  return out;
}

/** The least vertex-to-vertex distance between Pip's body and a dummy's, and the two points; Infinity when far apart. */
export function bodyGap(pip: Object3D, props: PropMask, dummy: Object3D, options: BodyGapOptions, near = 0.6): { distance: number; pip: number[] | null; dummy: number[] | null } {
  const theirs = posedPoints(dummy, options, null, 1);
  const box = new Box3().setFromPoints(theirs).expandByScalar(near);
  const ours = posedPoints(pip, options, props, 1).filter((point) => box.containsPoint(point));
  let best = Infinity;
  let a: Vector3 | null = null;
  let b: Vector3 | null = null;
  for (const p of ours) {
    for (const q of theirs) {
      const d = p.distanceToSquared(q);
      if (d < best) [best, a, b] = [d, p, q];
    }
  }
  return { distance: Math.sqrt(best), pip: a ? a.toArray() : null, dummy: b ? b.toArray() : null };
}
