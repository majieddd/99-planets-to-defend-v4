import type { PlayClocks } from '../world/play';

/**
 * The hit-stop's clock: a stop of time on contact (Pillar 4). It holds Pip's combo and movement clocks, and the struck
 * dummy's, for the stop's length while the frame's clock runs on (PlayClocks, labs/world/play.ts), so the camera, the
 * sparks and the shake stay alive and the presses made in it are kept (combo.ts). A stop that ends part way through a
 * frame lets the rest of that frame run, so a stop lasts its length at any frame rate: 55 ms is three whole frames and
 * a third of the fourth at 60 fps, and the frame's time the combo did not get adds up to 55 ms exactly. Kept apart from
 * three and the page so the unit test drives it directly.
 */
export class HitStop {
  /** Seconds of the stop still to hold. */
  remaining = 0;
  /** Whether a stop is holding (from the frame after its contact to the frame it runs out). */
  active = false;
  /** The step the held clocks take this frame: the frame's, less what the stop held of it. */
  heldStep = 0;
  /** The frame time the running stop has held so far, and each finished stop's, oldest first (at most `kept`). */
  measured = 0;
  readonly lengths: number[] = [];

  constructor(readonly kept = 12) {}

  /** A contact: holds for `seconds` from the next frame, or for what is left of a stop already holding, if longer. */
  start(seconds: number): void {
    if (!(seconds > 0)) return;
    this.remaining = Math.max(this.remaining, seconds);
    if (!this.active) {
      this.active = true;
      this.measured = 0;
    }
  }

  /**
   * This frame's clocks for a frame step of `dt`, written into `out`. A step that is not above 0 counts as 0: written as
   * Math.max(0, dt), a NaN step came through as NaN (Math.max passes NaN on) and poisoned the remaining hold and every
   * clock after it.
   */
  clocks(dt: number, out: PlayClocks): PlayClocks {
    const step = dt > 0 ? dt : 0;
    const hold = Math.min(step, this.remaining);
    this.remaining -= hold;
    this.heldStep = step - hold;
    out.frame = step;
    out.combo = step - hold;
    out.motion = step - hold;
    if (this.active) {
      this.measured += hold;
      if (this.remaining <= 1e-12) {
        this.remaining = 0;
        this.active = false;
        this.lengths.push(this.measured);
        if (this.lengths.length > this.kept) this.lengths.shift();
      }
    }
    return out;
  }

  reset(): void {
    this.remaining = 0;
    this.active = false;
    this.measured = 0;
    this.heldStep = 0;
  }
}

/**
 * Lets the dummies a finished stop held go at the end of a frame: when no stop held after this frame's clocks
 * (`stopEnded`, read before the frame's hits), every dummy not struck in this frame's hits (`struck`) is released, and
 * a dummy struck now, which began a new stop, stays held. The release used to wait for no stop to be active at the
 * frame's end, so a stop that ran out in a frame's clocks while a hit on another dummy began a new one kept the first
 * dummy held through a second stop it never took.
 */
export function releaseHeld(held: boolean[], struck: readonly boolean[], stopEnded: boolean): void {
  if (!stopEnded) return;
  for (let i = 0; i < held.length; i++) if (!struck[i]) held[i] = false;
}
