import { Quaternion, Vector3, type Object3D } from 'three';
import { EXPRESSION_MORPHS, FaceDriver, JAW_BONE_NAME, seededFaceRandom, type Expression } from './faceDriver';

/**
 * A commander's face in the labs, set up from its loaded rig: the jaw's opening axis read from the rig, a seeded face
 * driver per instance, and the slow held-expression demo the Asset World's face member cycles. Lab code, outside the
 * simulation. Its numbers have rows in docs/blueprint.md (Numbers, Face driver).
 */

/**
 * The seed of the first commander instance's blink timing; each further instance on a page takes the next seed, so no
 * two faces blink in step and every load blinks alike.
 */
export const FACE_SEED = 1;

/**
 * The axis a commander's jaw opens about, in the jaw bone's own frame: the character's left-right axis, a glTF
 * character's +X, as the rig holds it. Pip's jaw bone, from the CharForge rig, is turned about 130 degrees from his head
 * and its own x runs 15.7 degrees off the character's, so the driver's default, the bone's own x, would swing the chin
 * sideways as it dropped; about this axis the chin drops and draws back straight. Read it in the bind pose, before a clip
 * moves the rig: the jaw's turn from the head is what matters, and no clip moves it (Pip's idle, run and attack key the
 * jaw at its rest). Null when the rig has no jaw bone.
 */
export function jawAxisOf(root: Object3D): Vector3 | null {
  const jaw = root.getObjectByName(JAW_BONE_NAME);
  if (!jaw) return null;
  root.updateMatrixWorld(true);
  const rootTurn = root.getWorldQuaternion(new Quaternion());
  const jawTurn = jaw.getWorldQuaternion(new Quaternion());
  return new Vector3(1, 0, 0).applyQuaternion(rootTurn).applyQuaternion(jawTurn.invert()).normalize();
}

/**
 * A face driver for one commander instance, blinking on its own seeded timing with the jaw axis its rig gives, or null
 * for a rig with no face morph, which the lab then leaves alone: Bulwark's visored rig, and any creature rig with a bone
 * that happens to be named jaw, whose clips' jaw keys the driver would otherwise overwrite with its rest pose every frame.
 */
export function createCommanderFace(root: Object3D, seed: number): FaceDriver | null {
  const jawAxis = jawAxisOf(root);
  const driver = new FaceDriver(root, jawAxis ? { random: seededFaceRandom(seed), jawAxis } : { random: seededFaceRandom(seed) });
  return driver.meshes.length > 0 ? driver : null;
}

/**
 * The held-expression demo: neutral, then smile, then brows up, then neutral again, each held FACE_DEMO_HOLD_SECONDS
 * and eased into the next over FACE_DEMO_BLEND_SECONDS. Slow enough to study each expression under the blinks, which run
 * on through it, and it opens on neutral, so a frozen frame shows the rest face.
 */
export const FACE_DEMO_STEPS: readonly (Expression | null)[] = [null, 'smile', 'brows_up'];
export const FACE_DEMO_HOLD_SECONDS = 2;
export const FACE_DEMO_BLEND_SECONDS = 0.4;

/** The demo's weight for each expression at a time in seconds from its start. */
export function faceDemoWeights(seconds: number): Record<Expression, number> {
  const period = FACE_DEMO_HOLD_SECONDS + FACE_DEMO_BLEND_SECONDS;
  const cycle = period * FACE_DEMO_STEPS.length;
  const t = ((seconds % cycle) + cycle) % cycle;
  const index = Math.floor(t / period);
  const into = t - index * period;
  const from = FACE_DEMO_STEPS[index] ?? null;
  const to = FACE_DEMO_STEPS[(index + 1) % FACE_DEMO_STEPS.length] ?? null;
  const u = into <= FACE_DEMO_HOLD_SECONDS ? 0 : (into - FACE_DEMO_HOLD_SECONDS) / FACE_DEMO_BLEND_SECONDS;
  const eased = u * u * (3 - 2 * u);
  const weights = Object.fromEntries(EXPRESSION_MORPHS.map((name) => [name, 0])) as Record<Expression, number>;
  if (from) weights[from] += 1 - eased;
  if (to) weights[to] += eased;
  return weights;
}

/** A face pose a lab or a test handle holds for a frame: lids and expressions from 0 to 1, any left out at 0. */
export type FacePose = Partial<Record<Expression | 'blink' | 'jaw', number>>;

/** Holds a pose on a driver, or with null hands the lids back to the auto-blink and rests the expressions and jaw. */
export function holdFacePose(driver: FaceDriver, pose: FacePose | null): void {
  driver.setBlinkHold(pose ? (pose.blink ?? 0) : null);
  for (const name of EXPRESSION_MORPHS) driver.setExpression(name, pose?.[name] ?? 0);
  driver.setJaw(pose?.jaw ?? 0);
}
