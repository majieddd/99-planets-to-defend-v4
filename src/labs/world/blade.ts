import { Vector3, type Object3D, type SkinnedMesh } from 'three';

/**
 * Pip's blade, for the sword trail and the hit test. His sword has no bone of its own: it is skinned whole to his right
 * hand (commander_armour, weight 1 on mixamorigRightHand), so its base and tip ride the hand rigidly. The blade is read
 * once from the rig in its bind pose, as two points in the hand's own frame, and each frame carries them out through the
 * hand's world matrix, which costs two matrix products and reads no vertex.
 */

/** The hand bone the sword is skinned to, by the end of its name (GLTFLoader strips Mixamo's colon). */
export const BLADE_HAND = 'RightHand';
/** A vertex counts as the sword's when this much of its skin weight or more is on the hand. */
export const BLADE_MIN_WEIGHT = 0.99;
/**
 * Where the blade starts: past the last vertex of the hand's that stands this far or further off the line from the hand
 * to the tip, the crossguard. On the shipped Pip the mitten and the grip reach 0.09 m off that line, the crossguard
 * 0.19 m, and the blade itself under 0.1 m (its flat), so 0.12 m finds the guard's far face 0.26 m along the line and the
 * blade runs from there to the tip, 0.94 m along it.
 */
export const BLADE_GUARD_OFFSET = 0.12;
/**
 * The height above his root, in metres, about which the blade's sweep between two frames is read (hitShape.ts,
 * swingPoint): his shoulders, on his 1.78 m body, where a cut turns from.
 */
export const BLADE_SWING_PIVOT_M = 1.35;

/**
 * The blade as read from the rig: its hand bone's name, and its base and tip in the hand's own frame, which hold for any
 * copy of the rig (Play Pip measures the bind-pose copy it keeps, and samples the copy he plays).
 */
export interface BladeMeasure {
  readonly handName: string;
  readonly base: Vector3;
  readonly tip: Vector3;
  /** From the base to the tip, in metres (in the bind pose, where the rig's scale is read). */
  readonly length: number;
}

/**
 * Reads the blade from a rig in its bind pose (a copy made before any mixer moves it): the vertices skinned to the hand,
 * the tip the one furthest from the hand's origin, and the base where the crossguard ends along the line to the tip
 * (BLADE_GUARD_OFFSET). Null when the rig has no such hand or no vertex on it, so a rig without a sword draws no trail.
 */
export function measureBlade(root: Object3D): BladeMeasure | null {
  root.updateMatrixWorld(true);
  const meshes: SkinnedMesh[] = [];
  root.traverse((object) => {
    if ((object as SkinnedMesh).isSkinnedMesh) meshes.push(object as SkinnedMesh);
  });
  let hand: Object3D | null = null;
  const points: Vector3[] = [];
  for (const mesh of meshes) {
    const bones = mesh.skeleton.bones;
    const index = bones.findIndex((bone) => bone.name.endsWith(BLADE_HAND));
    if (index < 0) continue;
    hand ??= bones[index]!;
    const skinIndex = mesh.geometry.getAttribute('skinIndex');
    const skinWeight = mesh.geometry.getAttribute('skinWeight');
    const count = mesh.geometry.getAttribute('position')?.count ?? 0;
    if (!skinIndex || !skinWeight) continue;
    for (let i = 0; i < count; i++) {
      let weight = 0;
      for (let k = 0; k < skinIndex.itemSize; k++) if (skinIndex.getComponent(i, k) === index) weight += skinWeight.getComponent(i, k);
      if (weight >= BLADE_MIN_WEIGHT) points.push(mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld));
    }
  }
  if (!hand || points.length === 0) return null;
  const origin = hand.getWorldPosition(new Vector3());
  let tip = points[0]!;
  for (const point of points) if (point.distanceToSquared(origin) > tip.distanceToSquared(origin)) tip = point;
  const axis = tip.clone().sub(origin);
  const reach = axis.length();
  if (reach < 1e-6) return null;
  axis.divideScalar(reach);
  let guard = 0;
  const offset = new Vector3();
  for (const point of points) {
    offset.subVectors(point, origin);
    const along = offset.dot(axis);
    const off = offset.addScaledVector(axis, -along).length();
    if (off >= BLADE_GUARD_OFFSET) guard = Math.max(guard, along);
  }
  const base = origin.clone().addScaledVector(axis, Math.min(guard, reach));
  const length = base.distanceTo(tip);
  return { handName: hand.name, base: hand.worldToLocal(base.clone()), tip: hand.worldToLocal(tip.clone()), length };
}

/** The bone in a copy of the rig that the measure's points ride (its hand, by name), or null. */
export function bladeHand(root: Object3D, measure: BladeMeasure): Object3D | null {
  return root.getObjectByName(measure.handName) ?? null;
}

/**
 * The blade's base and tip in world space as `hand` is posed now, written into `base` and `tip`. The hand's world
 * matrix is brought up to date first (its parents' too), since the mixer moves the bones' local transforms and three
 * composes their world matrices only when the scene is drawn.
 */
export function sampleBlade(hand: Object3D, measure: BladeMeasure, base: Vector3, tip: Vector3): void {
  hand.updateWorldMatrix(true, false);
  base.copy(measure.base).applyMatrix4(hand.matrixWorld);
  tip.copy(measure.tip).applyMatrix4(hand.matrixWorld);
}
