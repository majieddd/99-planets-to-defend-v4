import { Quaternion, Vector3, type Object3D } from 'three';
import type { StylePatch } from './stylePatch';

const UP = new Vector3(0, 1, 0);

/** What place() reads from the ground: the surface under a point of the plane tangent at the pole. */
export type Ground = Pick<StylePatch, 'surfaceAt'>;

/**
 * Stands an object's root on the ground point under (x, z), a point on the plane tangent at the pole, turned by `yaw`
 * about its own up. Its up leans from the planet's up toward the ground's normal by `alignToGround`, 0 standing plumb
 * and 1 lying flush with the slope. M0c roots every placeable asset at its ground contact point (npm run assets:check
 * holds it to 5 mm), so this is the whole of placement: the Style Lab and the Asset World both call it for every root
 * they stand on the patch, and neither adds an offset for any one asset, because an offset kept for one asset would hide
 * the next asset that broke the ground contract instead of showing it.
 */
export function place(object: Object3D, ground: Ground, x: number, z: number, yaw: number, alignToGround = 0): void {
  const surface = ground.surfaceAt(x, z);
  object.position.copy(surface.position);
  const up = surface.up.clone().lerp(surface.normal, alignToGround).normalize();
  object.quaternion.setFromUnitVectors(UP, up).multiply(new Quaternion().setFromAxisAngle(UP, yaw));
}
