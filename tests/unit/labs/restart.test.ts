import { describe, expect, it } from 'vitest';
import { COMBAT_FEEL_RANGES, DEFAULT_COMBAT_FEEL, type CombatFeel } from '../../../src/labs/world/combatFeel';
import {
  COMBO_HITS,
  COMBO_READY,
  comboPhase,
  comboWeights,
  easeInOut,
  fadingOwnWeight,
  hitFades,
  recoveryCut,
  restartFades,
  stepCombo,
  type ComboFrame,
  type ComboState,
  type HitContract,
  type RestartContext,
} from '../../../src/labs/world/combo';
import { freshLunge, rootMotionCurve, startLunge, stepLunge } from '../../../src/labs/world/lunge';
import { legShare } from '../../../src/labs/world/play';
import {
  bestEntry,
  entryTimes,
  poseDistance,
  quatAngleDeg,
  RESTART_MATCH_BONES,
  RESTART_POSE_NEAR_DEG,
  RESTART_SEARCH_SHARE,
  restartSearchLimit,
  type MatchPose,
  type Quat,
} from '../../../src/labs/world/restart';

// Play Pip's restart into the combo's first hit (labs/world/restart.ts and combo.ts): the restart blend's ease and
// length, the pose-matched entry and its search limit, the restart kept in the finisher's recovery until the pose is
// near, and the root motion carried on from where a cancelled curve left him.

const FEEL: CombatFeel = { ...DEFAULT_COMBAT_FEEL };
const Q = COMBO_HITS;
const [Q1, Q2, Q3] = Q as [HitContract, HitContract, HitContract];
const CUT = recoveryCut(Q3, FEEL.recoveryCut);
const R = 160;
const DT = 1 / 60;

/** A restart context with the guard as given and every entry at `at`, `distance` degrees away. */
const context = (guard: boolean, at: number, distance: number): RestartContext => ({ guard, entry: () => ({ at, distance }) });

/** The finisher playing at `time`, struck, chained from the backhand, with the fades and cut it took from FEEL. */
const finisherAt = (time: number): ComboState => ({
  ...COMBO_READY,
  hit: { step: 3, time, struck: true, crossfaded: true, chainedAt: Q2.cancel, fades: hitFades(true, FEEL), speed: 1, opensAt: CUT, endsAt: CUT + FEEL.fadeOut, startAt: 0, restart: false },
});

/** A rotation about the up axis by `deg` degrees, as a quaternion array. */
const yawQuat = (deg: number): Quat => {
  const half = (deg * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
};
/** A match pose with every bone turned `deg` degrees about the up axis. */
const turnedPose = (deg: number): MatchPose => RESTART_MATCH_BONES.map(() => yawQuat(deg));

describe('the restart blend (combo.ts)', () => {
  it('eases a restart in over the restart blend, with the finisher fading on under it, and leaves the chain crossfades straight', () => {
    expect([easeInOut(0), easeInOut(0.5), easeInOut(1)]).toEqual([0, 0.5, 1]);
    expect(easeInOut(0.25)).toBeCloseTo(0.15625, 12);
    expect(easeInOut(0.25) + easeInOut(0.75)).toBeCloseTo(1, 12);
    // At rest at both ends: its first and last hundredth move under a third of a straight blend's share.
    expect(easeInOut(0.01)).toBeLessThan(0.01 / 3);
    expect(1 - easeInOut(0.99)).toBeLessThan(0.01 / 3);
    expect([easeInOut(-1), easeInOut(2)]).toEqual([0, 1]);

    // A press kept in the finisher's buffer restarts the chain at its cut, with the restart blend, eased.
    const dt = 1 / 240;
    let state = stepCombo(finisherAt(CUT - 0.1), true, dt, FEEL, dt, Q).state;
    expect(state.queued).toBe(true);
    let frame: ComboFrame | null = null;
    for (let i = 0; i < 100 && !frame; i++) {
      const next = stepCombo(state, false, dt, FEEL, dt, Q);
      if (next.started !== null) frame = next;
      state = next.state;
    }
    const hit = frame!.state.hit!;
    expect(hit).toMatchObject({ step: 1, restart: true, startAt: 0, crossfaded: true });
    expect(hit.fades).toEqual({ rise: FEEL.restartBlend, fadeOut: FEEL.fadeOut, eased: true });
    expect(hit.chainedAt).toBeCloseTo(CUT, 12);
    // Through the blend the hit rises by the ease, and the finisher, whole at its cut, goes on with its own eased fade
    // toward the guard idle under it: it gives up the ease's share of its own weight, and the guard idle takes the rest,
    // so nothing sums past 1 and nothing stops dead.
    let blended = 0;
    let previousOwn = 1;
    while (state.hit && state.hit.time < hit.fades.rise) {
      const weights = comboWeights(state, dt, Q);
      const eased = easeInOut(state.hit.time / hit.fades.rise);
      const own = fadingOwnWeight(state.outgoing!, Q, dt);
      expect(weights.current).toBeCloseTo(eased, 9);
      expect(weights.outgoing).toBeCloseTo(own * (1 - eased), 9);
      expect(weights.current + weights.outgoing).toBeLessThanOrEqual(1 + 1e-12);
      expect(own).toBeLessThanOrEqual(previousOwn);
      previousOwn = own;
      blended += 1;
      state = stepCombo(state, false, dt, FEEL, dt, Q).state;
    }
    // The finisher's own fade from the cut is eased too: still whole a frame after the cut, half gone at its middle.
    const fadeFrom = finisherAt(CUT + dt);
    expect(comboWeights(fadeFrom, dt, Q).current).toBeGreaterThan(0.99);
    expect(comboWeights(finisherAt(CUT + (FEEL.fadeOut - dt) / 2), dt, Q).current).toBeCloseTo(0.5, 6);
    // Chained hits keep the weight they had when the next began, as before.
    expect(fadingOwnWeight({ step: 1, time: 0.4, weight: 0.8, speed: 1, recovery: false }, Q, dt)).toBe(0.8);
    expect(blended * dt).toBeCloseTo(FEEL.restartBlend, 1);
    expect(state.outgoing).toBeNull();
    expect(comboWeights(state, dt, Q).current).toBe(1);

    // The chain's own crossfade, the backhand over the forehand, stays straight at the crossfade's length.
    const forehand = stepCombo(COMBO_READY, true, dt, FEEL, dt, Q).state;
    let chain = stepCombo({ ...forehand, hit: { ...forehand.hit!, time: Q1.cancel! - 0.05 } }, true, dt, FEEL, dt, Q).state;
    while (chain.hit!.step === 1) chain = stepCombo(chain, false, dt, FEEL, dt, Q).state;
    expect(chain.hit).toMatchObject({ step: 2, restart: false, startAt: 0, fades: { rise: FEEL.crossfade, eased: false } });
    const half = stepCombo({ ...chain, hit: { ...chain.hit!, time: FEEL.crossfade / 2 - dt } }, false, dt, FEEL, dt, Q).state;
    expect(comboWeights(half, dt, Q).current).toBeCloseTo(0.5, 9);
  });

  it('restarts from the guard idle and from a recovery clip, fades in from the relaxed idle as before, and is whole by the active frames', () => {
    const dt = 1 / 120;
    // From the guard idle a chain's first hit restarts it; from the relaxed idle it fades in, straight, as it always did.
    expect(stepCombo(COMBO_READY, true, dt, FEEL, dt, Q, context(true, 0, 0)).state.hit).toMatchObject({ restart: true, fades: { rise: FEEL.restartBlend, eased: true } });
    expect(stepCombo(COMBO_READY, true, dt, FEEL, dt, Q).state.hit).toMatchObject({ restart: false, fades: { rise: FEEL.fadeIn, eased: false } });
    // Over the forehand's recovery clip once the reset has run: a restart, crossfaded from the recovery clip.
    const recovering: ComboState = { ...COMBO_READY, recovery: { step: 1, time: 0.3, speed: 1, fadeOut: FEEL.fadeOut }, next: 1, sinceEnd: 0.4 };
    const over = stepCombo(recovering, true, dt, FEEL, dt, Q);
    expect(over.state.hit).toMatchObject({ step: 1, restart: true, crossfaded: true });
    expect(over.state.outgoing).toMatchObject({ step: 1, recovery: true, weight: 1 });
    // Inside the reset the press goes on to the backhand: that is the chain going on, not a restart.
    expect(stepCombo({ ...recovering, next: 2, sinceEnd: 0.1 }, true, dt, FEEL, dt, Q).state.hit).toMatchObject({ step: 2, restart: false });
    // The blend never runs into the active frames, and the slider's ceiling keeps two clips at most on screen.
    const long = { ...FEEL, restartBlend: 0.25 };
    expect(restartFades(Q1, 0, FEEL).rise).toBe(0.2);
    expect(restartFades(Q1, 0, long).rise).toBeCloseTo(Q1.activeFrom, 12);
    expect(restartFades(Q1, 0.08, long).rise).toBeCloseTo(Q1.activeFrom - 0.08, 12);
    expect(COMBAT_FEEL_RANGES.restartBlend.max).toBeLessThan(Q1.cancel! - restartSearchLimit(Q1));
    expect(DEFAULT_COMBAT_FEEL.restartBlend).toBeGreaterThanOrEqual(0.18);
    expect(DEFAULT_COMBAT_FEEL.restartBlend).toBeLessThanOrEqual(0.25);
  });
});

describe('the pose-matched entry (restart.ts)', () => {
  it('compares poses by their weighted bone turns and searches the wind-up no later than its limit', () => {
    expect(quatAngleDeg(yawQuat(0), yawQuat(40))).toBeCloseTo(40, 9);
    // Either sign of a quaternion is the same rotation.
    expect(quatAngleDeg([0, 0, 0, 1], [0, 0, 0, -1])).toBe(0);
    expect(poseDistance(turnedPose(0), turnedPose(20))).toBeCloseTo(20, 9);
    // Weighted: the sword hand alone turned 50 degrees counts its 0.4 share.
    const handOnly = RESTART_MATCH_BONES.map((bone) => yawQuat(bone.name === 'RightHand' ? 50 : 0));
    expect(poseDistance(turnedPose(0), handOnly)).toBeCloseTo(20, 9);

    const limit = restartSearchLimit(Q1);
    expect(limit).toBeCloseTo(RESTART_SEARCH_SHARE * Q1.activeFrom, 12);
    expect(limit).toBeLessThan(Q1.strike);
    const times = entryTimes(limit);
    expect(times[0]).toBe(0);
    expect(times.at(-1)).toBe(limit);
    expect(Math.max(...times)).toBe(limit);
    // Each sample's pose turned 600 degrees a second, with one past the limit that matches 90 degrees exactly.
    const samples = [...times.map((time) => ({ time, pose: turnedPose(time * 600) })), { time: 0.15, pose: turnedPose(90) }];
    const matched = bestEntry(samples, turnedPose(30), limit);
    expect(matched.at).toBeCloseTo(0.05, 12);
    expect(matched.distance).toBeCloseTo(0, 6);
    // A pose that only the sample past the limit matches enters at the nearest inside it, the limit, never past it.
    const far = bestEntry(samples, turnedPose(90), limit);
    expect(far.at).toBe(limit);
    expect(far.distance).toBeCloseTo(90 - limit * 600, 6);
    // On a tie the earlier entry, which keeps more of the wind-up.
    expect(bestEntry([{ time: 0, pose: turnedPose(10) }, { time: 0.05, pose: turnedPose(-10) }], turnedPose(0), limit).at).toBe(0);
    // Judged by the blend each entry leaves, a later entry only a little nearer loses: its blend is held shorter inside
    // the active frames, so the pose would cross faster. One much nearer still wins.
    const blendFor = (at: number) => restartFades(Q1, at, FEEL).rise;
    const pair = (later: number) => [
      { time: 0, pose: turnedPose(75) },
      { time: 0.08, pose: turnedPose(later) },
    ];
    expect(bestEntry(pair(69), turnedPose(0), limit).at).toBe(0.08);
    expect(bestEntry(pair(69), turnedPose(0), limit, blendFor)).toEqual({ at: 0, distance: expect.closeTo(75, 6) as unknown as number });
    expect(bestEntry(pair(20), turnedPose(0), limit, blendFor).at).toBe(0.08);
  });

  it("starts a restart at its entry and moves every window with it, the strike, the active frames and the cancel all that much sooner", () => {
    const dt = 1 / 600;
    const run = (ctx: RestartContext | undefined) => {
      let state = COMBO_READY;
      const out = { started: null as ComboState['hit'], struckAt: -1, activeAt: -1, opensAt: -1 };
      for (let i = 0; i < 400; i++) {
        const frame = stepCombo(state, i === 0, dt, FEEL, dt, Q, ctx);
        state = frame.state;
        if (i === 0) out.started = state.hit;
        if (frame.struck !== null && out.struckAt < 0) out.struckAt = (i + 1) * dt;
        if (state.hit && comboPhase(state, Q) === 'active' && out.activeAt < 0) out.activeAt = (i + 1) * dt;
        if (state.hit && state.hit.time >= state.hit.opensAt && out.opensAt < 0) out.opensAt = (i + 1) * dt;
      }
      return out;
    };
    const fresh = run(undefined);
    const entered = run(context(true, 0.05, 0));
    expect(entered.started).toMatchObject({ step: 1, startAt: 0.05, restart: true });
    expect(entered.started!.time).toBeCloseTo(0.05 + dt, 12);
    // The windows stay in clip seconds, so in real seconds each comes 0.05 s sooner than from the first moment.
    expect(fresh.struckAt).toBeCloseTo(Q1.strike, 2);
    expect(entered.struckAt).toBeCloseTo(Q1.strike - 0.05, 2);
    expect(entered.activeAt).toBeCloseTo(fresh.activeAt - 0.05, 2);
    expect(entered.opensAt).toBeCloseTo(fresh.opensAt - 0.05, 2);
    // Its rise counts from the entry, and is held inside the time left before the active frames (0.167 s here): a
    // quarter of the way through it, it has risen by the ease's quarter.
    const rise = restartFades(Q1, 0.05, FEEL).rise;
    expect(rise).toBeCloseTo(Q1.activeFrom - 0.05, 12);
    const quarter = stepCombo(COMBO_READY, true, rise / 4, FEEL, rise / 4, Q, context(true, 0.05, 0)).state;
    expect(comboWeights(quarter, dt, Q).current).toBeCloseTo(easeInOut(0.25), 9);
    // An entry past the search limit is held to it.
    const held = stepCombo(COMBO_READY, true, dt, FEEL, dt, Q, context(true, 0.2, 0)).state.hit!;
    expect(held.startAt).toBeCloseTo(restartSearchLimit(Q1), 12);
  });
});

describe('the restart kept in the finisher (combo.ts)', () => {
  /**
   * Presses at `pressAt` into the finisher and steps until a hit starts, the pose `far` degrees from the first hit's
   * entry until the finisher's time (as drawn, before each frame) reaches `nearFrom`, and near after.
   */
  function restartFrom(pressAt: number, nearFrom: number, dt = 1 / 240) {
    let distance = 90;
    const ctx: RestartContext = { guard: false, entry: () => ({ at: 0, distance }) };
    let state = finisherAt(pressAt);
    const presses: string[] = [];
    for (let i = 0; i < 400; i++) {
      distance = state.hit && state.hit.time >= nearFrom ? 10 : 90;
      const frame = stepCombo(state, i === 0, dt, FEEL, dt, Q, ctx);
      presses.push(frame.press);
      if (frame.started !== null) return { frame, before: state, presses };
      // The finisher never ends with a restart kept: it fires first.
      expect(frame.state.hit).not.toBeNull();
      state = frame.state;
    }
    throw new Error('no restart');
  }

  it('fires at the later of the recovery cut and the pose coming near, and never after the finisher ends', () => {
    const dt = 1 / 240;
    const endsAt = CUT + FEEL.fadeOut;
    expect(RESTART_POSE_NEAR_DEG).toBeGreaterThan(10);
    expect(RESTART_POSE_NEAR_DEG).toBeLessThan(90);
    // Near already: a press kept in the buffer fires exactly at the cut, as before.
    const early = restartFrom(CUT - 0.1, 0);
    expect(early.presses[0]).toBe('queued');
    expect(early.frame.state.hit!.chainedAt).toBeCloseTo(CUT, 12);
    // Near only 0.08 s past the cut: it waits, kept, and fires on the first frame the pose is near.
    const late = restartFrom(CUT - 0.1, CUT + 0.08);
    expect(late.frame.state.hit!.chainedAt!).toBeGreaterThanOrEqual(CUT + 0.08 - 1e-9);
    expect(late.frame.state.hit!.chainedAt!).toBeLessThan(CUT + 0.08 + dt + 1e-9);
    expect(late.frame.state.hit).toMatchObject({ step: 1, restart: true });
    // Never near: it fires at the finisher's end, not after it.
    const never = restartFrom(CUT - 0.1, Infinity);
    expect(never.frame.state.hit!.chainedAt!).toBeLessThanOrEqual(endsAt + 1e-9);
    expect(never.frame.state.hit!.chainedAt!).toBeGreaterThan(endsAt - dt - 1e-9);
    // A press past the cut with the pose far is kept and fires when it comes near; with the pose near it starts at once.
    const past = restartFrom(CUT + 0.02, CUT + 0.06);
    expect(past.presses[0]).toBe('queued');
    expect(past.frame.state.hit!.chainedAt!).toBeGreaterThanOrEqual(CUT + 0.06 - 1e-9);
    const now = restartFrom(CUT + 0.02, 0);
    expect(now.presses[0]).toBe('started');
    expect(now.frame.state.hit!.chainedAt!).toBeCloseTo(CUT + 0.02, 12);
    // The light hits chain at their cancel points whatever the pose: the pose gate is the restart's alone.
    const far: RestartContext = { guard: false, entry: () => ({ at: 0, distance: 170 }) };
    let chain = stepCombo(COMBO_READY, true, dt, FEEL, dt, Q, far).state;
    chain = stepCombo({ ...chain, hit: { ...chain.hit!, time: Q1.cancel! - 0.05 } }, true, dt, FEEL, dt, Q, far).state;
    for (let i = 0; i < 30 && chain.hit!.step === 1; i++) chain = stepCombo(chain, false, dt, FEEL, dt, Q, far).state;
    expect(chain.hit!.step).toBe(2);
    expect(chain.hit!.chainedAt).toBeCloseTo(Q1.cancel!, 12);
  });
});

describe('the root motion through a restart (lunge.ts)', () => {
  it('keeps his place where a cancelled curve left him, and starts the next curve from there at its entry, with no jump of place or facing', () => {
    // The spin finisher's root motion, roughly, and the forehand's own (the sidecar's attack_1, to 0.2 s and its end).
    const finisher = rootMotionCurve({ times: [0, 0.5, 1, 2], forward: [0, 0.9, 1.3, 1.47], side: [0, 0.1, 0.16, -0.04] });
    const forehand = rootMotionCurve({ times: [0, 0.033, 0.067, 0.1, 0.2, 0.433], forward: [0, 0.107, 0.226, 0.348, 0.633, 0.75] });
    const state = freshLunge();
    const at = { x: 0, z: 0, yaw: 0 };
    for (let t = DT; t <= CUT + 1e-9; t += DT) stepLunge(state, finisher, t, at, [], [], 0, R);
    const left = { ...at };
    expect(Math.hypot(left.x, left.z)).toBeGreaterThan(1);
    // Cut there: the finisher's curve is no longer stepped, and the forehand enters 0.05 s in from where he stands.
    const entry = 0.05;
    startLunge(state, forehand, entry, Q1.activeFrom);
    expect([state.done, state.moved, state.plan, state.blocked]).toEqual([forehand.at(entry), 0, null, false]);
    stepLunge(state, forehand, entry, at, [], [], 0, R, undefined, Q1.activeFrom);
    expect(at).toEqual(left);
    // Its first frame carries only what the curve covers after the entry: 0.058 m, where begun at 0 it took 0.225 m.
    stepLunge(state, forehand, entry + DT, at, [], [], 0, R, undefined, Q1.activeFrom);
    const first = Math.hypot(at.x - left.x, at.z - left.z);
    expect(first).toBeCloseTo(forehand.at(entry + DT) - forehand.at(entry), 3);
    expect(first).toBeLessThan(forehand.at(entry + DT) / 2);
    // Over the rest of the clip he travels the reach left after the entry, along his facing.
    for (let t = entry + 2 * DT; t <= Q1.duration + 1e-9; t += DT) stepLunge(state, forehand, t, at, [], [], 0, R, undefined, Q1.activeFrom);
    stepLunge(state, forehand, Q1.duration, at, [], [], 0, R, undefined, Q1.activeFrom);
    expect(state.moved).toBeCloseTo(forehand.reach - forehand.at(entry), 3);
    // Planned whole from the entry, his legs take the clip's legs whole, where the whole reach would have given 0.78.
    expect(legShare(forehand, state.plan!.length, false, state.from)).toBeCloseTo(1, 9);
    expect(legShare(forehand, state.plan!.length, false)).toBeLessThan(0.8);

    // With the assist turning him toward a target, the turn counts from the entry's share: no jump on its first frame,
    // and whole by the active frames all the same.
    const turn = (15 * Math.PI) / 180;
    const off = (25 * Math.PI) / 180;
    const target = { x: Math.sin(off) * 2.15, z: Math.cos(off) * 2.15, radius: 1.55 };
    const aimed = freshLunge();
    const face = { x: 0, z: 0, yaw: 0 };
    startLunge(aimed, forehand, entry, Q1.activeFrom);
    stepLunge(aimed, forehand, entry + DT, face, [target], [], turn, R, undefined, Q1.activeFrom);
    const firstTurn = face.yaw;
    // Begun at 0, its first frame would have turned him at once by the 0.31 of the turn the curve had reached.
    expect(firstTurn).toBeGreaterThan(0);
    expect(firstTurn).toBeLessThan(turn * 0.15);
    for (let t = entry + 2 * DT; t <= Q1.activeFrom + 1e-9; t += DT) stepLunge(aimed, forehand, t, face, [target], [], turn, R, undefined, Q1.activeFrom);
    stepLunge(aimed, forehand, Q1.activeFrom, face, [target], [], turn, R, undefined, Q1.activeFrom);
    expect(face.yaw).toBeCloseTo(turn, 6);
  });
});
