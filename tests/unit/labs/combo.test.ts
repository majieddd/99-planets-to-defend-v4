import { describe, expect, it } from 'vitest';
import { COMBAT_FEEL_RANGES, DEFAULT_COMBAT_FEEL, type CombatFeel } from '../../../src/labs/world/combatFeel';
import {
  ACTIVE_AFTER_STRIKE,
  ACTIVE_BEFORE_STRIKE,
  BACKHAND_STRIKE_BEFORE_STRIKE,
  bodyWeights,
  bufferOpensAt,
  COMBO_HITS,
  COMBO_READY,
  COMBO_STEP_FLOOR,
  comboPhase,
  comboWeights,
  contractOf,
  fadeStep,
  FINISHER_FROM_BEFORE_STRIKE,
  FIRST_FADE_STEP,
  hitFades,
  holdsRunWeight,
  longestComboStep,
  ownWeight,
  placeholderAnchors,
  stepCombo,
  swingMotion,
  warpTime,
  type ComboFrame,
  type ComboState,
  type ComboStep,
  type HitPlay,
} from '../../../src/labs/world/combo';
import { FREE_MOTION } from '../../../src/labs/world/playMotion';
import timings from '../../../src/shared/timings.json';

const FEEL: CombatFeel = { ...DEFAULT_COMBAT_FEEL };
const [HIT1, HIT2, HIT3] = COMBO_HITS as [(typeof COMBO_HITS)[number], (typeof COMBO_HITS)[number], (typeof COMBO_HITS)[number]];
// The source attack clip the placeholders are warped from: 25 frames at 30 fps, striking at 0.34 s (timings.json).
const SOURCE_SECONDS = 25 / 30;
const SOURCE_STRIKE = 0.34;

/** One frame of the page's loop as the test drives it, recording what it did. */
interface Frame extends ComboFrame {
  before: ComboState;
  pressed: boolean;
  dt: number;
}

/**
 * Runs frames of the combo from a state: `dts` gives each frame's step (repeating its last), and `press` says whether a
 * frame presses, from the state the frame starts from. Stops after `count` frames.
 */
function play(from: ComboState, count: number, dts: readonly number[], press: (state: ComboState, index: number) => boolean, feel = FEEL): Frame[] {
  const frames: Frame[] = [];
  let state = from;
  for (let i = 0; i < count; i++) {
    const dt = dts[Math.min(i, dts.length - 1)]!;
    const pressed = press(state, i);
    const frame = stepCombo(state, pressed, dt, feel);
    frames.push({ ...frame, before: state, pressed, dt });
    state = frame.state;
  }
  return frames;
}

/** Presses on the first frame, and then once in each hit as soon as its buffer is open, until three hits have begun. */
function chainPresser(feel = FEEL) {
  let pressedIn = new Set<ComboStep>();
  return (state: ComboState, index: number): boolean => {
    if (index === 0) return true;
    const hit = state.hit;
    if (!hit || pressedIn.has(hit.step) || hit.step === 3) return false;
    if (hit.time >= bufferOpensAt(contractOf(hit.step), feel.buffer)) {
      pressedIn = new Set([...pressedIn, hit.step]);
      return true;
    }
    return false;
  };
}

/** A hit playing at a time, with the fades it would have taken on from FEEL as it began. */
const hitAt = (step: ComboStep, time: number, fields: Partial<HitPlay> = {}): HitPlay => {
  const crossfaded = fields.crossfaded ?? false;
  return { step, time, struck: false, crossfaded, chainedAt: null, fades: hitFades(crossfaded, FEEL), ...fields };
};

const startedSteps = (frames: readonly Frame[]): ComboStep[] => frames.filter((frame) => frame.started !== null).map((frame) => frame.started!);
const struckSteps = (frames: readonly Frame[]): ComboStep[] => frames.filter((frame) => frame.struck !== null).map((frame) => frame.struck!);

describe('the combo contracts', () => {
  it('strike inside their active frames, cancel only after them, and leave the finisher without a cancel and planted', () => {
    for (const hit of COMBO_HITS) {
      expect(hit.strike, hit.name).toBeGreaterThan(hit.activeFrom);
      expect(hit.strike, hit.name).toBeLessThan(hit.activeTo);
      expect(hit.activeTo, hit.name).toBeLessThan(hit.cancel ?? hit.duration);
    }
    expect([HIT1, HIT2].map((hit) => [hit.duration, hit.strike, hit.cancel, hit.planted])).toEqual([
      [0.55, 0.2, 0.3, false],
      [0.55, 0.2, 0.3, false],
    ]);
    expect([HIT3.duration, HIT3.strike, HIT3.cancel, HIT3.planted]).toEqual([0.85, 0.38, null, true]);
    // The crossfade's ceiling is under the light hits' cancel point, so only two hits ever show at once.
    expect(COMBAT_FEEL_RANGES.crossfade.max).toBeLessThan(HIT1.cancel!);
  });

  it("take each hit's length and strike from its entry in src/shared/timings.json, the file assets:check holds the clips to", () => {
    for (const hit of COMBO_HITS) {
      expect([hit.duration, hit.strike], hit.name).toEqual([timings.commanders.commander_pip[hit.name].duration, timings.commanders.commander_pip[hit.name].strike]);
      // The active frames follow the strike: 50 ms before it to 80 ms after it.
      expect(hit.activeFrom, hit.name).toBeCloseTo(hit.strike - ACTIVE_BEFORE_STRIKE, 12);
      expect(hit.activeTo, hit.name).toBeCloseTo(hit.strike + ACTIVE_AFTER_STRIKE, 12);
    }
    expect([ACTIVE_BEFORE_STRIKE, ACTIVE_AFTER_STRIKE]).toEqual([0.05, 0.08]);
  });

  it('strike after their first moment, and the step cap stays above 0 for a contract that does not', () => {
    // A strike at 0 made longestComboStep 0, and the combo then moved no time on any frame.
    for (const hit of COMBO_HITS) expect(hit.strike, hit.name).toBeGreaterThan(0);
    expect(longestComboStep()).toBe(Math.min(...COMBO_HITS.map((hit) => hit.strike)));
    const atZero = [{ ...HIT1, strike: 0, activeFrom: 0, activeTo: 0.08 }, HIT2, HIT3];
    expect(longestComboStep(atZero)).toBe(COMBO_STEP_FLOOR);
    expect(COMBO_STEP_FLOOR).toBeCloseTo(1 / 120, 12);
    // With the floor the clock still moves, 1/120 s a frame however long the frame: a hit begun on such a contract reaches
    // its 0.55 s end in 66 frames, where it stood at its first moment for good.
    let state = stepCombo(COMBO_READY, true, 1 / 60, FEEL, 1 / 60, atZero).state;
    let frames = 0;
    while (state.hit && frames < 200) {
      state = stepCombo(state, false, 1 / 60, FEEL, 1 / 60, atZero).state;
      frames += 1;
    }
    expect(state.hit).toBeNull();
    // The frame that began it moved it too: 66 frames in all.
    expect(frames + 1).toBe(66);
  });
});

/**
 * Phase B's hit-stop holds the combo's clock and his movement for a few frames while frames still draw (PlayClocks,
 * play.ts). The page reads the fades at fadeStep's step, the combo's last moving one, so these drive the combo as the
 * page does through such a stop.
 */
describe('the fades through a held clock', () => {
  it("start a hit begun in a hit-stop from the weight drawn on the frame before, where a step of 0 popped it", () => {
    const step = 1 / 60;
    // attack_1, unpressed, run into its fade out past the cancel point: 0.45 s in, its weight falling.
    let state = stepCombo(COMBO_READY, true, step, FEEL, step).state;
    let fade = FIRST_FADE_STEP;
    while (state.hit!.time < 0.45 - 1e-9) {
      fade = fadeStep(fade, step);
      state = stepCombo(state, false, step, FEEL, fade).state;
    }
    const drawn = comboWeights(state, fade).current;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(1);
    // The stop: the combo's clock and his movement both at 0. The fade step keeps the last moving step, so the weights
    // drawn in the stop are the frame before's, and a press, past the cancel point, begins attack_2 over that weight.
    fade = fadeStep(fade, 0);
    expect(fade).toBe(step);
    expect(comboWeights(state, fade).current).toBe(drawn);
    const begun = stepCombo(state, true, 0, FEEL, fade);
    expect(begun.started).toBe(2);
    expect(begun.state.outgoing!.weight).toBe(drawn);
    expect(comboWeights(begun.state, fade)).toEqual({ current: 0, outgoing: drawn });
    // Read at the movement's step, 0 in a stop that holds him too, the outgoing hit took a weight the frame before never
    // drew (0.5 against 0.417 here), and the pose jumped by the difference on the stop's first frame.
    const atZero = stepCombo(state, true, 0, FEEL, 0).state.outgoing!.weight;
    expect(atZero).toBeCloseTo(0.5, 9);
    expect(drawn).toBeCloseTo(0.417, 3);
    // Before the combo's clock has ever moved, the fades read a frame at 60 a second.
    expect(fadeStep(FIRST_FADE_STEP, 0)).toBe(FIRST_FADE_STEP);
    expect(FIRST_FADE_STEP).toBeCloseTo(1 / 60, 12);
  });
});

describe('the combo chain', () => {
  it('begins attack_1 on a press, and keeps a press made inside the buffer for the next hit', () => {
    const begin = stepCombo(COMBO_READY, true, 1 / 60, FEEL);
    expect(begin.press).toBe('started');
    expect(begin.started).toBe(1);
    expect(begin.state.hit).toMatchObject({ step: 1, time: 1 / 60, struck: false, crossfaded: false, chainedAt: null, fades: { rise: FEEL.fadeIn, fadeOut: FEEL.fadeOut } });
    // The buffer opens 0.2 s before the cancel point, 0.10 s into a light hit.
    expect(bufferOpensAt(HIT1, FEEL.buffer)).toBeCloseTo(0.1, 12);
    const inWindow: ComboState = { ...begin.state, hit: { ...begin.state.hit!, time: 0.12 } };
    const kept = stepCombo(inWindow, true, 1 / 60, FEEL);
    expect(kept.press).toBe('queued');
    expect(kept.state.queued).toBe(true);
    expect(kept.started).toBeNull();
    expect(kept.state.hit!.step).toBe(1);
  });

  it('drops a press before the buffer opens, and a second press while one is kept', () => {
    const early: ComboState = { ...COMBO_READY, hit: hitAt(1, 0.05) };
    const dropped = stepCombo(early, true, 1 / 60, FEEL);
    expect(dropped.press).toBe('dropped');
    expect(dropped.state.queued).toBe(false);
    // Nothing was held: the hit plays out and ends with no follow-up.
    const out = play(dropped.state, 60, [1 / 60], () => false);
    expect(startedSteps(out)).toEqual([]);
    expect(out.at(-1)!.state.hit).toBeNull();
    const queued: ComboState = { ...early, hit: { ...early.hit!, time: 0.2 }, queued: true };
    const second = stepCombo(queued, true, 1 / 60, FEEL);
    expect(second.press).toBe('dropped');
    expect(second.state.queued).toBe(true);
    // A buffer of 0.3 s keeps a press from the light hit's start.
    expect(bufferOpensAt(HIT1, 0.3)).toBe(0);
    expect(stepCombo(early, true, 1 / 60, { ...FEEL, buffer: 0.3 }).press).toBe('queued');
  });

  it('starts a kept hit exactly at the cancel point, the time past it carried in, at any frame step', () => {
    for (const dts of [[1 / 60], [1 / 30], [1 / 20], [0.013, 0.047, 0.021, 0.05, 0.008, 0.033]]) {
      const frames = play(COMBO_READY, 200, dts, chainPresser());
      const label = dts.map((dt) => dt.toFixed(3)).join(',');
      expect(startedSteps(frames), label).toEqual([1, 2, 3]);
      for (const frame of frames.filter((entry) => entry.started === 2 || entry.started === 3)) {
        const previous = frame.before.hit!;
        const contract = contractOf(previous.step);
        // The hit before stood short of its cancel point when the frame began, and the new hit starts as far past it as
        // the frame's step reached.
        expect(previous.time, label).toBeLessThan(contract.cancel!);
        expect(frame.state.hit!.chainedAt, label).toBe(contract.cancel);
        expect(frame.state.hit!.time, label).toBeCloseTo(previous.time + frame.dt - contract.cancel!, 12);
        expect(frame.state.hit!.time, label).toBeGreaterThanOrEqual(0);
        expect(frame.state.queued, label).toBe(false);
      }
    }
  });

  it('starts the next hit at once on a press past the cancel point', () => {
    const late: ComboState = { ...COMBO_READY, hit: hitAt(1, 0.4, { struck: true }) };
    const frame = stepCombo(late, true, 1 / 60, FEEL);
    expect(frame.press).toBe('started');
    expect(frame.started).toBe(2);
    expect(frame.state.hit).toMatchObject({ step: 2, time: 1 / 60, crossfaded: true, chainedAt: 0.4 });
    // attack_1 was already fading out, so it fades from the weight it had rather than from 1.
    const had = ownWeight(HIT1, 0.4, hitFades(false, FEEL), 1 / 60);
    expect(had).toBeLessThan(1);
    expect(frame.state.outgoing).toMatchObject({ step: 1, weight: had });
    expect(frame.state.outgoing!.time).toBeCloseTo(0.4 + 1 / 60, 12);
  });

  it('strikes each hit exactly once, on the frame that reaches its strike, however the presses and frames fall', () => {
    for (const dts of [[1 / 60], [1 / 20], [0.05, 0.001, 0.049, 0.0005, 0.03]]) {
      // Pressing on every frame is a mash: each light hit keeps one press, the finisher one for a new chain.
      const frames = play(COMBO_READY, 240, dts, () => true);
      const strikes = struckSteps(frames);
      const label = dts.join(',');
      expect(strikes.slice(0, 3), label).toEqual([1, 2, 3]);
      for (const frame of frames.filter((entry) => entry.struck !== null)) {
        const contract = contractOf(frame.struck!);
        const hit = frame.state.hit?.step === frame.struck ? frame.state.hit : frame.state.outgoing;
        // The strike lands on the frame that crosses its moment, once.
        expect(hit!.time, label).toBeGreaterThanOrEqual(contract.strike);
        expect(hit!.time - frame.dt, label).toBeLessThan(contract.strike + 1e-12);
      }
      // Exactly one strike for every hit begun that has reached its strike moment, in the order the hits began: every hit
      // but the last has (a light hit hands over only at or past its cancel point, after its strike, and the finisher
      // plays out), and the last has if its time has come.
      const last = frames.at(-1)!.state.hit;
      const pending = last && last.time < contractOf(last.step).strike ? 1 : 0;
      const begun = startedSteps(frames);
      expect(strikes, label).toEqual(begun.slice(0, begun.length - pending));
    }
  });

  it('strikes every hit at a 0.25 s step too, where a hit carried in at its cancel point began on its own strike', () => {
    // At 0.25 s a kept press carried attack_2 in 0.20 s, on its strike, which the check "before it, then at or past it"
    // never saw crossed; the step is cut to the earliest strike, so every hit begins short of its own.
    expect(longestComboStep()).toBe(Math.min(HIT1.strike, HIT2.strike, HIT3.strike));
    const frames = play(COMBO_READY, 40, [0.25], chainPresser());
    expect(startedSteps(frames)).toEqual([1, 2, 3]);
    expect(struckSteps(frames)).toEqual([1, 2, 3]);
    // Each hit a kept press carried in (not one a press began at its first moment) starts short of its strike.
    const carried = frames.filter((entry) => entry.started !== null && entry.press !== 'started');
    expect(carried.map((frame) => frame.started)).toEqual([2, 3]);
    for (const frame of carried) expect(frame.state.hit!.time).toBeLessThan(contractOf(frame.started!).strike);
    // A mash at the same step strikes each hit it begins once.
    const mash = play(COMBO_READY, 40, [0.25], () => true);
    const last = mash.at(-1)!.state.hit;
    const begun = startedSteps(mash);
    expect(struckSteps(mash)).toEqual(begun.slice(0, begun.length - (last && last.time < contractOf(last.step).strike ? 1 : 0)));
  });

  it('plays three hits at most, then the whole finisher, which has no cancel, before a new chain', () => {
    // A press on every frame from the first: the chain is attack_1, attack_2, attack_3, and the finisher plays to its end.
    const frames = play(COMBO_READY, 160, [1 / 60], () => true);
    const steps = startedSteps(frames);
    expect(steps.slice(0, 4)).toEqual([1, 2, 3, 1]);
    const finisherStart = frames.findIndex((frame) => frame.started === 3);
    const nextChain = frames.findIndex((frame, index) => index > finisherStart && frame.started === 1);
    // Every press in the finisher before its buffer opens is dropped; the first inside it is kept; it never cancels.
    const during = frames.slice(finisherStart + 1, nextChain);
    const open = bufferOpensAt(HIT3, FEEL.buffer);
    expect(open).toBeCloseTo(0.65, 12);
    for (const frame of during) {
      const time = frame.before.hit!.time;
      if (time < open) expect(frame.press, `${time}`).toBe('dropped');
      expect(frame.state.hit!.step).toBe(3);
    }
    expect(during.some((frame) => frame.press === 'queued')).toBe(true);
    // The new chain begins at the finisher's end, its time the overshoot past 0.85 s, fading in from the idle and run.
    const begin = frames[nextChain]!;
    expect(begin.before.hit!.step).toBe(3);
    expect(begin.before.hit!.time + begin.dt).toBeGreaterThanOrEqual(HIT3.duration);
    expect(begin.state.hit).toMatchObject({ step: 1, crossfaded: false, chainedAt: HIT3.duration });
    expect(begin.state.outgoing).toBeNull();
    // Without a press in its buffer, the finisher plays out and the next press starts attack_1 at once.
    const ended = play({ ...begin.before, queued: false }, 30, [1 / 60], () => false);
    expect(ended.at(-1)!.state.hit).toBeNull();
    expect(ended.at(-1)!.state.next).toBe(1);
  });

  it('waits the reset after a hit ends for the next hit, then starts again from attack_1', () => {
    const one = play(COMBO_READY, 60, [1 / 60], (_state, index) => index === 0);
    const end = one.findIndex((frame) => frame.state.hit === null);
    expect(end).toBeGreaterThan(0);
    const ended = one[end]!.state;
    expect(ended.next).toBe(2);
    // A press 0.2 s after the end, inside the 0.3 s reset, plays attack_2, fading in from the idle and run.
    const soon = play(ended, 12, [1 / 60], () => false).at(-1)!.state;
    expect(soon.sinceEnd).toBeLessThan(FEEL.reset);
    const second = stepCombo(soon, true, 1 / 60, FEEL);
    expect(second.started).toBe(2);
    expect(second.state.hit).toMatchObject({ crossfaded: false, chainedAt: null });
    // Past the reset the chain starts again from attack_1.
    const later = play(ended, 30, [1 / 60], () => false).at(-1)!.state;
    expect(later.sinceEnd).toBeGreaterThanOrEqual(FEEL.reset);
    expect(later.next).toBe(1);
    expect(stepCombo(later, true, 1 / 60, FEEL).started).toBe(1);
  });

  it('keeps a press made during a crossfade, and starts the next hit at the cancel point all the same', () => {
    // A 0.3 s buffer opens at a light hit's start, inside its 0.1 s crossfade.
    const feel = { ...FEEL, buffer: 0.3 };
    const late: ComboState = { ...COMBO_READY, hit: hitAt(1, 0.32, { struck: true }) };
    const second = stepCombo(late, true, 1 / 60, feel);
    expect(second.started).toBe(2);
    const kept = stepCombo(second.state, true, 1 / 60, feel);
    expect(kept.press).toBe('queued');
    expect(kept.state.outgoing).not.toBeNull();
    const frames = play(kept.state, 40, [1 / 60], () => false, feel);
    const third = frames.find((frame) => frame.started === 3)!;
    expect(third.state.hit!.chainedAt).toBe(HIT2.cancel);
  });

  it('moves no time on a step of 0 or NaN, and changes nothing there without a press', () => {
    const states: ComboState[] = [
      COMBO_READY,
      { ...COMBO_READY, hit: hitAt(1, 0.12) },
      { ...COMBO_READY, hit: hitAt(2, 0.05, { crossfaded: true, chainedAt: 0.3 }), outgoing: { step: 1, time: 0.35, weight: 1 }, queued: true },
      { ...COMBO_READY, next: 2, sinceEnd: 0.1 },
    ];
    for (const state of states) {
      for (const dt of [0, Number.NaN, -1 / 60]) {
        const frame = stepCombo(state, false, dt, FEEL);
        expect(frame.state).toBe(state);
        expect(frame).toMatchObject({ struck: null, started: null, press: 'none' });
      }
    }
    // A NaN step after a press leaves no NaN in the hit, so the hit still reaches its end once time moves.
    const begun = stepCombo(COMBO_READY, true, Number.NaN, FEEL).state;
    expect(begun.hit).toMatchObject({ step: 1, time: 0 });
    const out = play(begun, 60, [1 / 60], () => false);
    expect(out.at(-1)!.state.hit).toBeNull();
  });

  it("keeps a press made on a step of 0, phase B's hit-stop, and plays it once time resumes", () => {
    // From ready, a press on a held clock starts attack_1 at its first moment, without moving its time or striking.
    const begin = stepCombo(COMBO_READY, true, 0, FEEL, 1 / 60);
    expect(begin).toMatchObject({ press: 'started', started: 1, struck: null });
    expect(begin.state.hit).toMatchObject({ step: 1, time: 0, struck: false });
    expect(struckSteps(play(begin.state, 20, [1 / 60], () => false))).toEqual([1]);
    // Inside a light hit's buffer, a press on a held clock is kept, and once the clock runs again it starts the next hit
    // exactly at the cancel point, as a press on a moving frame does.
    const inBuffer: ComboState = { ...COMBO_READY, hit: hitAt(1, 0.15) };
    const held = stepCombo(inBuffer, true, 0, FEEL, 1 / 60);
    expect(held.press).toBe('queued');
    expect(held.state.queued).toBe(true);
    expect(held.state.hit!.time).toBe(0.15);
    const resumed = play(held.state, 20, [1 / 60], () => false);
    const second = resumed.find((frame) => frame.started !== null)!;
    expect(second.started).toBe(2);
    expect(second.state.hit!.chainedAt).toBe(HIT1.cancel);
    // A press past the cancel point on a held clock starts the next hit at once, from the hit's weight on screen.
    const past = stepCombo({ ...COMBO_READY, hit: hitAt(1, 0.4, { struck: true }) }, true, 0, FEEL, 1 / 60);
    expect(past.started).toBe(2);
    expect(past.state.hit).toMatchObject({ step: 2, time: 0, crossfaded: true, chainedAt: 0.4 });
    expect(past.state.outgoing!.weight).toBe(ownWeight(HIT1, 0.4, hitFades(false, FEEL), 1 / 60));
    // A second press while one is kept is dropped on a held clock too.
    expect(stepCombo({ ...inBuffer, queued: true }, true, 0, FEEL, 1 / 60).press).toBe('dropped');
  });

  it('keeps a press made in a hit-stop whatever the buffer, and starts the next hit with it at the cancel point once the clock resumes', () => {
    // At a buffer of 0.05 s a light hit keeps a press only from 0.25 s in. A press on a moving frame at the strike, 0.2 s
    // in, is dropped as before; the same press in the stop that the strike's contact begins is kept.
    const tight = { ...FEEL, buffer: 0.05 };
    const atStrike: ComboState = { ...COMBO_READY, hit: hitAt(1, HIT1.strike, { struck: true }) };
    expect(bufferOpensAt(HIT1, tight.buffer)).toBeCloseTo(0.25, 12);
    expect(stepCombo(atStrike, true, 1 / 60, tight).press).toBe('dropped');
    const inStop = stepCombo(atStrike, true, 0, tight, 1 / 60);
    expect(inStop.press).toBe('queued');
    expect(inStop.state.queued).toBe(true);
    // Held for the stop's frames, nothing moves; then the clock runs and the kept press starts attack_2 exactly at
    // attack_1's cancel point, the step it takes the hit there carried in, as any kept press does.
    let state = inStop.state;
    for (let i = 0; i < 3; i++) {
      const frame = stepCombo(state, false, 0, tight, 1 / 60);
      expect(frame.state.hit!.time).toBe(HIT1.strike);
      state = frame.state;
    }
    const resumed = play(state, 20, [1 / 60], () => false, tight);
    const second = resumed.find((frame) => frame.started !== null)!;
    expect(second.started).toBe(2);
    expect(second.state.hit!.chainedAt).toBe(HIT1.cancel);
    expect(second.state.hit!.time).toBeLessThan(1 / 60);
    // In the finisher's stop, a press is kept for a new chain at its end, and the finisher's recovery plays out first.
    const finisherStop = stepCombo({ ...COMBO_READY, hit: hitAt(3, HIT3.strike, { struck: true }) }, true, 0, tight, 1 / 60);
    expect(finisherStop.press).toBe('queued');
    const after = play(finisherStop.state, 60, [1 / 60], () => false, tight);
    const next = after.find((frame) => frame.started !== null)!;
    expect(next.started).toBe(1);
    expect(next.state.hit!.chainedAt).toBe(HIT3.duration);
  });

  it('plays each hit with the fades it began with, so a slider moved mid-hit changes the next hit and not this one', () => {
    // attack_2 halfway through its 0.10 s crossfade; the crossfade dragged to 0.25 s leaves its weights as they were.
    const crossfading: ComboState = { ...COMBO_READY, hit: hitAt(2, 0.05, { crossfaded: true, chainedAt: 0.3 }), outgoing: { step: 1, time: 0.35, weight: 1 } };
    const edited = { ...FEEL, crossfade: 0.25, fadeIn: 0.15, fadeOut: 0.4 };
    expect(comboWeights(crossfading, 1 / 60).current).toBeCloseTo(0.5, 12);
    const next = stepCombo(crossfading, false, 1 / 60, edited).state;
    const reference = stepCombo(crossfading, false, 1 / 60, FEEL).state;
    expect(comboWeights(next, 1 / 60)).toEqual(comboWeights(reference, 1 / 60));
    expect(next.hit!.fades).toEqual(hitFades(true, FEEL));
    // The next hit takes the edited fades as it begins.
    const third = play({ ...next, queued: true }, 40, [1 / 60], () => false, edited).find((frame) => frame.started === 3)!;
    expect(third.state.hit!.fades).toEqual({ rise: 0.25, fadeOut: 0.4 });
  });
});

describe('the combo weights', () => {
  it('fade a chain in, crossfade hit to hit summing to 1, and fade it out a frame before its end, with no jump', () => {
    for (const dt of [1 / 60, 1 / 30, 1 / 20]) {
      const frames = play(COMBO_READY, Math.ceil(3 / dt), [dt], chainPresser());
      let last = 0;
      for (const frame of frames) {
        const { current, outgoing } = comboWeights(frame.state, dt);
        const total = current + outgoing;
        expect(total, `${dt}`).toBeLessThanOrEqual(1 + 1e-12);
        // During a crossfade from a hit at full weight the two sum to exactly 1, so no idle shows between hits.
        if (frame.state.outgoing && frame.state.outgoing.weight === 1) expect(total, `${dt} crossfade`).toBeCloseTo(1, 12);
        // No frame moves the total by more than a frame's share of the quickest fade.
        expect(Math.abs(total - last), `${dt} step`).toBeLessThanOrEqual(dt / Math.min(FEEL.fadeIn, FEEL.fadeOut, FEEL.crossfade) + 1e-9);
        last = total;
      }
      // Once a hit has crossfaded in, the one under it is gone.
      for (const frame of frames) if (frame.state.hit && frame.state.hit.time >= FEEL.crossfade) expect(frame.state.outgoing).toBeNull();
      // The finisher's last frame stands at 0, so the frame that ends it does not pop.
      const lastFinisher = frames.filter((frame) => frame.state.hit?.step === 3).at(-1)!;
      expect(comboWeights(lastFinisher.state, dt).current, `${dt} end`).toBeCloseTo(0, 9);
    }
  });

  it("holds a light hit at full weight until its cancel point however long the fade out, and splits each half's weights to 1", () => {
    const long = { ...FEEL, fadeOut: COMBAT_FEEL_RANGES.fadeOut.max };
    expect(ownWeight(HIT1, HIT1.cancel!, hitFades(false, long), 1 / 20)).toBe(1);
    expect(ownWeight(HIT1, HIT1.cancel! - 0.01, hitFades(false, long), 1 / 60)).toBe(1);
    // The finisher, with no cancel, takes the whole fade out.
    expect(ownWeight(HIT3, HIT3.duration - 1 / 60 - long.fadeOut / 2, hitFades(false, long), 1 / 60)).toBeCloseTo(0.5, 9);
    for (const run of [0, 0.3, 1]) {
      for (const [current, outgoing] of [
        [0, 0],
        [0.4, 0.6],
        [1, 0],
        [0.25, 0.3],
      ] as const) {
        for (const plants of [
          [false, false],
          [true, false],
          [false, true],
        ] as const) {
          const { upper, lower } = bodyWeights(run, current, plants[0], outgoing, plants[1]);
          const label = `${run} ${current} ${outgoing} ${plants}`;
          expect(upper.idle + upper.run + upper.current + upper.outgoing, label).toBeCloseTo(1, 12);
          expect(lower.idle + lower.run + lower.current + lower.outgoing, label).toBeCloseTo(1, 12);
        }
      }
    }
    // Running, a light hit leaves the legs to the run; standing, it swings the whole body; the finisher always does.
    expect(bodyWeights(1, 1, false, 0, false).lower).toEqual({ idle: 0, run: 1, current: 0, outgoing: 0 });
    expect(bodyWeights(0, 1, false, 0, false).lower.current).toBe(1);
    expect(bodyWeights(1, 1, true, 0, false).lower.current).toBe(1);
    // At half the run's weight a light hit takes only the idle's half of the legs, and the run keeps its own half, where
    // it used to keep run squared, a quarter, with a quarter of idle stance under the jog.
    expect(bodyWeights(0.5, 1, false, 0, false).lower).toEqual({ idle: 0, run: 0.5, current: 0.5, outgoing: 0 });
    // Half a light hit at half the run: run 0.5, hit 0.25, idle 0.25; a planted hit at half weight takes its half whole.
    expect(bodyWeights(0.5, 0.5, false, 0, false).lower).toEqual({ idle: 0.25, run: 0.5, current: 0.25, outgoing: 0 });
    expect(bodyWeights(0.5, 0.5, true, 0, false).lower).toEqual({ idle: 0.25, run: 0.25, current: 0.5, outgoing: 0 });
    // Mid-crossfade from a light hit into the planted finisher, the shares still sum to 1 and follow the run continuously.
    let previous = bodyWeights(0, 0.4, true, 0.6, false).lower;
    for (let run = 0.01; run <= 1 + 1e-9; run += 0.01) {
      const lower = bodyWeights(run, 0.4, true, 0.6, false).lower;
      expect(lower.idle + lower.run + lower.current + lower.outgoing).toBeCloseTo(1, 12);
      for (const key of ['idle', 'run', 'current', 'outgoing'] as const) expect(Math.abs(lower[key] - previous[key])).toBeLessThan(0.011);
      previous = lower;
    }
  });
});

describe('how a hit holds him back', () => {
  it('slows a light hit from its start to its cancel point, locks his facing from its active frames, and plants the finisher', () => {
    const at = (step: ComboStep, time: number): ComboState => ({ ...COMBO_READY, hit: hitAt(step, time) });
    expect(swingMotion(COMBO_READY, FEEL)).toBe(FREE_MOTION);
    // In the wind-up his drive must reach the hit's share by its active frames, 0.1 s on from 0.05 s in.
    expect(swingMotion(at(1, 0.05), FEEL)).toEqual({ moveScale: FEEL.moveScale, turnScale: FEEL.windupTurn, cap: false, settleBy: expect.closeTo(HIT1.activeFrom - 0.05, 12) });
    expect(swingMotion(at(1, 0.2), FEEL)).toEqual({ moveScale: FEEL.moveScale, turnScale: 0, cap: true });
    // Between the active frames and the cancel point the pace stays reduced, so a chain runs at one even pace.
    expect(swingMotion(at(2, 0.29), FEEL)).toEqual({ moveScale: FEEL.moveScale, turnScale: 0, cap: false });
    expect(swingMotion(at(2, 0.31), FEEL)).toBe(FREE_MOTION);
    for (const time of [0.01, 0.38, 0.84]) expect(swingMotion(at(3, time), FEEL)).toEqual({ moveScale: 0, turnScale: 0, cap: true });
    expect([comboPhase(at(1, 0.1)), comboPhase(at(1, 0.2)), comboPhase(at(1, 0.4)), comboPhase(COMBO_READY)]).toEqual(['windup', 'active', 'recovery', 'ready']);
    // The run's weight holds only while the planted finisher fades in over his stop.
    expect(holdsRunWeight(at(3, 0.05))).toBe(true);
    expect(holdsRunWeight({ ...COMBO_READY, hit: hitAt(3, 0.08, { crossfaded: true }) })).toBe(true);
    expect(holdsRunWeight(at(3, 0.2))).toBe(false);
    expect(holdsRunWeight(at(1, 0.01))).toBe(false);
  });
});

describe('the placeholder warps', () => {
  it("land the source's strike on each hit's contract strike, anchored at the hit's start, strike and end", () => {
    for (const hit of COMBO_HITS) {
      const anchors = placeholderAnchors(hit, SOURCE_SECONDS, SOURCE_STRIKE);
      expect(anchors.map(([time]) => time), hit.name).toEqual([0, hit.strike, hit.duration]);
      const struck = hit.name === 'attack_2' ? SOURCE_STRIKE - BACKHAND_STRIKE_BEFORE_STRIKE : SOURCE_STRIKE;
      expect(warpTime(anchors, hit.strike), hit.name).toBeCloseTo(struck, 12);
      for (const [, source] of anchors) {
        expect(source).toBeGreaterThanOrEqual(0);
        expect(source).toBeLessThanOrEqual(SOURCE_SECONDS);
      }
    }
    // attack_1 plays the whole cleave forward; attack_2 runs it backward; the finisher starts in the coil.
    expect(placeholderAnchors(HIT1, SOURCE_SECONDS, SOURCE_STRIKE)).toEqual([
      [0, 0],
      [0.2, 0.34],
      [0.55, SOURCE_SECONDS],
    ]);
    const backhand = placeholderAnchors(HIT2, SOURCE_SECONDS, SOURCE_STRIKE);
    expect(backhand[0]![1]).toBeGreaterThan(backhand[1]![1]);
    expect(backhand[1]![1]).toBeGreaterThan(backhand[2]![1]);
    expect(placeholderAnchors(HIT3, SOURCE_SECONDS, SOURCE_STRIKE)[0]![1]).toBeCloseTo(SOURCE_STRIKE - FINISHER_FROM_BEFORE_STRIKE, 12);
    // A uniform scale would have missed: the cleave's strike lands at 0.22 s in 0.55 s, and 0.35 s in 0.85 s.
    expect(SOURCE_STRIKE * (HIT1.duration / SOURCE_SECONDS)).toBeCloseTo(0.224, 3);
    expect(SOURCE_STRIKE * (HIT3.duration / SOURCE_SECONDS)).toBeCloseTo(0.347, 3);
    // Linear between anchors and held outside them.
    expect(warpTime(placeholderAnchors(HIT1, SOURCE_SECONDS, SOURCE_STRIKE), 0.1)).toBeCloseTo(0.17, 12);
    expect(warpTime(placeholderAnchors(HIT1, SOURCE_SECONDS, SOURCE_STRIKE), -1)).toBe(0);
    expect(warpTime(placeholderAnchors(HIT1, SOURCE_SECONDS, SOURCE_STRIKE), 9)).toBe(SOURCE_SECONDS);
  });
});
