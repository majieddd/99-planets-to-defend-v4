import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../../../src/sim/clock';

describe('FixedStepper', () => {
  it('runs one tick per tick of elapsed time', () => {
    const clock = new FixedStepper();
    expect(clock.advance(1 / 60)).toEqual({ steps: 1, alpha: 0, dropped: 0 });
  });

  it('carries a partial tick as alpha', () => {
    const clock = new FixedStepper();
    const half = clock.advance(0.5 / 60);
    expect(half.steps).toBe(0);
    expect(half.alpha).toBeCloseTo(0.5, 9);
    expect(clock.advance(0.5 / 60).steps).toBe(1);
    expect(new FixedStepper().advance(0.99999 / 60).steps).toBe(0);
  });

  it('never loses a tick to floating point over many frames', () => {
    // 144 Hz is 5 ticks per 12 frames. Summed 1/144 s frames fall just under some multiples of 1/60 s,
    // where a plain floor runs the tick a frame late and ends at 5999.
    const clock = new FixedStepper();
    let total = 0;
    for (let frame = 1; frame <= 14400; frame++) {
      total += clock.advance(1 / 144).steps;
      expect(total).toBe(Math.floor((frame * 5) / 12));
    }
    expect(total).toBe(6000);
  });

  it('caps a long frame and drops the excess instead of spiralling', () => {
    const clock = new FixedStepper(1 / 60, 5);
    const plan = clock.advance(1);
    expect(plan.steps).toBe(5);
    expect(plan.dropped).toBe(55);
    expect(clock.advance(1 / 60).steps).toBe(1);
  });

  it('ignores negative elapsed time', () => {
    expect(new FixedStepper().advance(-1)).toEqual({ steps: 0, alpha: 0, dropped: 0 });
  });

  it('ignores NaN and infinite elapsed time instead of stalling for good', () => {
    const clock = new FixedStepper();
    clock.advance(0.5 / 60);
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(clock.advance(bad)).toEqual({ steps: 0, alpha: 0.5, dropped: 0 });
    }
    expect(clock.advance(0.5 / 60)).toEqual({ steps: 1, alpha: 0, dropped: 0 });
  });
});
