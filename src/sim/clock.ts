import { TICK_DT } from './state';

export interface StepPlan {
  /** Ticks to run now. */
  steps: number;
  /** Progress into the next tick, 0 to 1, for render interpolation. */
  alpha: number;
  /** Ticks skipped because the frame was too long. */
  dropped: number;
}

/**
 * Converts real elapsed time into whole simulation ticks. The shell owns the real clock and passes
 * elapsed seconds in, so the simulation never reads time itself. A long frame (a tab switch, a pause in
 * the browser) runs at most maxSteps ticks and drops the rest instead of spiralling.
 */
export class FixedStepper {
  private accumulator = 0;

  constructor(
    readonly dt: number = TICK_DT,
    readonly maxSteps: number = 5,
  ) {}

  advance(elapsedSeconds: number): StepPlan {
    // NaN or infinite elapsed time (a shell bug, such as a first frame with no previous timestamp) is
    // ignored like negative time, so one bad frame cannot poison the accumulator and stop every tick.
    if (Number.isFinite(elapsedSeconds) && elapsedSeconds > 0) this.accumulator += elapsedSeconds;
    // The small epsilon keeps frame times that sum to a hair under a tick boundary (twelve 1/144 s frames
    // against five 1/60 s ticks) from running that tick a frame late.
    let steps = Math.floor(this.accumulator / this.dt + 1e-6);
    let dropped = 0;
    if (steps > this.maxSteps) {
      dropped = steps - this.maxSteps;
      steps = this.maxSteps;
    }
    this.accumulator = Math.max(0, this.accumulator - (steps + dropped) * this.dt);
    const alpha = this.accumulator / this.dt;
    return { steps, alpha: alpha < 1e-6 ? 0 : alpha, dropped };
  }
}
