import { Vector3, type PerspectiveCamera } from 'three';

/**
 * The camera's kick on contact: a short shake, more on the finisher, laid over the follow camera as an offset only for
 * the frame's draw and taken off again straight after, so the orbit's centre and the follow never see it and cannot
 * drift (Mechanics, Commander combat: camera kick). It runs on the frame's clock, so it plays through the hit-stop, the
 * view staying alive while Pip holds. Under prefers-reduced-motion it is off altogether: a shake is motion the player
 * did not ask for, and the hit-stop, the sparks and the flinch still mark the blow.
 */

/** The shake's amplitude at its start, in metres across the view, and how long it takes to die away, in seconds. */
export const SHAKE_LIGHT_M = 0.025;
export const SHAKE_FINISHER_M = 0.055;
export const SHAKE_LIGHT_SECONDS = 0.16;
export const SHAKE_FINISHER_SECONDS = 0.26;
/** The shake's two frequencies, across and up the view, in hertz: unrelated, so it reads as a jolt and not a wobble. */
export const SHAKE_HZ_ACROSS = 23;
export const SHAKE_HZ_UP = 31;

/**
 * The offset `t` seconds into a shake of `amplitude` metres lasting `duration` seconds, across (x) and up (y) the
 * view, written into `out`: two sines under an envelope that falls as the square of the time left, so it starts at
 * full strength and dies smoothly, with nothing left at its end.
 */
export function shakeAt(t: number, duration: number, amplitude: number, out: { x: number; y: number }): { x: number; y: number } {
  if (!(t >= 0) || !(t < duration) || !(amplitude > 0)) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const left = 1 - t / duration;
  const envelope = amplitude * left * left;
  out.x = envelope * Math.sin(2 * Math.PI * SHAKE_HZ_ACROSS * t + 0.7);
  out.y = envelope * Math.sin(2 * Math.PI * SHAKE_HZ_UP * t + 2.1);
  return out;
}

export interface CameraShake {
  /** Starts a shake of a light hit or the finisher, at `strength` times its amplitude (the feel's `shake`). */
  start(finisher: boolean, strength: number): void;
  /** Advances it by the frame's step. */
  update(dt: number): void;
  /** Lays the offset on the camera for this frame's draw. */
  apply(camera: PerspectiveCamera): void;
  /** Takes the offset off again, the camera's position restored exactly. */
  remove(camera: PerspectiveCamera): void;
  reset(): void;
  /** How far the camera is off its follow pose now, in metres, and whether the shake is on at all. */
  reading(): { offset: number; active: boolean; enabled: boolean };
}

export function createCameraShake(reducedMotion: boolean): CameraShake {
  let time = Infinity;
  let duration = 0;
  let amplitude = 0;
  const wave = { x: 0, y: 0 };
  const offset = new Vector3();
  const saved = new Vector3();
  const right = new Vector3();
  const up = new Vector3();
  let applied = false;
  return {
    start(finisher, strength) {
      if (reducedMotion || !(strength > 0)) return;
      time = 0;
      duration = finisher ? SHAKE_FINISHER_SECONDS : SHAKE_LIGHT_SECONDS;
      amplitude = (finisher ? SHAKE_FINISHER_M : SHAKE_LIGHT_M) * strength;
    },
    update(dt) {
      if (Number.isFinite(time)) time += Math.max(0, dt);
      if (time >= duration) time = Infinity;
    },
    apply(camera) {
      shakeAt(time, duration, amplitude, wave);
      if (wave.x === 0 && wave.y === 0) return;
      right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      offset.copy(right).multiplyScalar(wave.x).addScaledVector(up, wave.y);
      saved.copy(camera.position);
      camera.position.add(offset);
      camera.updateMatrixWorld();
      applied = true;
    },
    remove(camera) {
      if (!applied) return;
      // Put back as it was to the bit, not by subtracting, so nothing of the shake can creep into the follow.
      camera.position.copy(saved);
      camera.updateMatrixWorld();
      applied = false;
    },
    reset() {
      time = Infinity;
    },
    reading() {
      shakeAt(time, duration, amplitude, wave);
      return { offset: Math.hypot(wave.x, wave.y), active: Number.isFinite(time), enabled: !reducedMotion };
    },
  };
}
