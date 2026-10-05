import { Vector3, type PerspectiveCamera } from 'three';

/**
 * The number at the wound (Pillar 4): a small painted number that rises from the contact point and fades. The values
 * are placeholders for the lab, a fixed figure for a light hit and a larger one for the finisher, not game balance:
 * there are no health or damage rules yet (Mechanics, Commander combat names damage packets for M1's controller). They
 * are page elements over the canvas, a few made once and reused, placed by projecting their point each frame; a number
 * is written again only when it moves a twentieth of a pixel, as the Asset World's labels are (`MOVE_PX`).
 */

/** The placeholder figures, a light hit's and the finisher's. */
export const HIT_NUMBER_LIGHT = 12;
export const HIT_NUMBER_FINISHER = 30;
/** How long a number shows, in seconds, and how far it rises over that time, in metres. */
export const HIT_NUMBER_SECONDS = 0.7;
export const HIT_NUMBER_RISE_M = 0.45;
/**
 * How far above the contact a number starts, in metres: begun on the contact itself, it sat on the spark's flash and
 * hid the burst it marks.
 */
export const HIT_NUMBER_LIFT_M = 0.3;
/** Numbers alive at once: a chain's three, with room for a fourth. */
export const HIT_NUMBER_POOL = 4;
/** A number's place is written again only when it has moved this many CSS pixels. */
const MOVE_PX = 0.05;

interface Slot {
  element: HTMLElement;
  at: Vector3;
  age: number;
  alive: boolean;
  x: number;
  y: number;
  opacity: number;
}

export interface HitNumbers {
  /** Shows a light hit's or the finisher's figure rising from `at`. */
  spawn(at: Vector3, finisher: boolean): void;
  /** Ages and places every number for the frame (the frame's clock, so they rise through the hit-stop). */
  update(dt: number, camera: PerspectiveCamera, widthPx: number, heightPx: number): void;
  reset(): void;
  /** Numbers showing now, and the last figure shown. */
  reading(): { live: number; last: number | null };
}

/**
 * The numbers, in `container` (a layer over the canvas that takes no pointer). Under prefers-reduced-motion they fade
 * in place instead of rising.
 */
export function createHitNumbers(container: HTMLElement, reducedMotion: boolean): HitNumbers {
  const slots: Slot[] = Array.from({ length: HIT_NUMBER_POOL }, () => {
    const element = document.createElement('div');
    element.className = 'hit-number';
    element.hidden = true;
    element.setAttribute('aria-hidden', 'true');
    container.append(element);
    return { element, at: new Vector3(), age: 0, alive: false, x: NaN, y: NaN, opacity: NaN };
  });
  let next = 0;
  let last: number | null = null;
  const point = new Vector3();

  return {
    spawn(at, finisher) {
      const slot = slots[next]!;
      next = (next + 1) % slots.length;
      const value = finisher ? HIT_NUMBER_FINISHER : HIT_NUMBER_LIGHT;
      slot.element.textContent = String(value);
      slot.element.classList.toggle('finisher', finisher);
      slot.at.copy(at);
      slot.at.y += HIT_NUMBER_LIFT_M;
      slot.age = 0;
      slot.alive = true;
      slot.x = slot.y = slot.opacity = NaN;
      last = value;
    },
    update(dt, camera, widthPx, heightPx) {
      for (const slot of slots) {
        if (!slot.alive) continue;
        slot.age += Math.max(0, dt);
        const u = slot.age / HIT_NUMBER_SECONDS;
        if (u >= 1) {
          slot.alive = false;
          slot.element.hidden = true;
          continue;
        }
        const rise = reducedMotion ? 0 : HIT_NUMBER_RISE_M * (1 - (1 - u) * (1 - u));
        point.copy(slot.at);
        point.y += rise;
        point.project(camera);
        // Behind the camera a projected point flips; the number hides rather than showing mirrored.
        const behind = point.z > 1;
        slot.element.hidden = behind;
        if (behind) continue;
        const x = (point.x * 0.5 + 0.5) * widthPx;
        const y = (0.5 - point.y * 0.5) * heightPx;
        if (!(Math.abs(x - slot.x) < MOVE_PX && Math.abs(y - slot.y) < MOVE_PX)) {
          slot.element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
          slot.x = x;
          slot.y = y;
        }
        const opacity = u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45;
        if (Math.abs(opacity - slot.opacity) > 0.02) {
          slot.element.style.opacity = opacity.toFixed(2);
          slot.opacity = opacity;
        }
      }
    },
    reset() {
      for (const slot of slots) {
        slot.alive = false;
        slot.element.hidden = true;
      }
      last = null;
    },
    reading() {
      return { live: slots.filter((slot) => slot.alive).length, last };
    },
  };
}
