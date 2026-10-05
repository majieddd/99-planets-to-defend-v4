/**
 * Play Pip (prototype)'s three-hit combo, kept apart from three and the page so the unit test drives it directly: the
 * hits' timing contracts, the chain's state machine (which hit plays, its clip time, the buffered press, the strike once
 * per hit, the cancel point and the chain's reset), the weights that crossfade one hit into the next, and how a hit
 * slows and turns him. Like the rest of Play Pip it is a lab prototype that feeds the M1 commander controller (Mechanics,
 * Commander combat), not that controller.
 *
 * Time comes in only as each frame's step, as the simulation's will: a frame whose step is 0 (the lab frozen) changes
 * nothing, and a press on it is dropped.
 */
import type { CombatFeel } from './combatFeel';
import { FREE_MOTION, type SwingMotion } from './playMotion';

export type ComboStep = 1 | 2 | 3;
export type HitName = 'attack_1' | 'attack_2' | 'attack_3';

/** One hit's timing contract, in seconds into its clip. */
export interface HitContract {
  /** The clip the hit plays, by its name in the GLB; a placeholder stands in until the GLB exports it. */
  name: HitName;
  duration: number;
  /** The strike moment, where the hit lands (Pillar 4). */
  strike: number;
  /**
   * From here a press starts the next hit at once, and a buffered press starts it exactly here; null for the finisher,
   * which has no cancel and plays its recovery out.
   */
  cancel: number | null;
  /** The active frames, from `activeFrom` up to `activeTo`: the blade's fast stretch around the strike. */
  activeFrom: number;
  activeTo: number;
  /** Whether he plants for the hit: the whole body plays it, he stops dead and his facing is locked throughout. */
  planted: boolean;
}

/**
 * The prototype's timing contracts for attack_1, attack_2 and the finisher attack_3. They live here, in the lab, while
 * placeholders stand in for the clips; they move into src/shared/timings.json, with assets:check holding the exported
 * clips to them, when the real attack_1 to attack_3 ship. The light hits are quick (0.55 s, striking at 0.20 s) and
 * cancel at 0.30 s, after the strike and its active frames; the finisher keeps the cleave's weight (0.85 s, striking at
 * 0.38 s) and has no cancel. Each hit's active frames run from 50 ms before its strike to 80 ms after it, about four
 * frames at 30 fps, where the cut moves fastest; a light hit's end 20 ms before its cancel point, so the cancel never
 * lands inside them.
 */
export const COMBO_HITS: readonly HitContract[] = [
  { name: 'attack_1', duration: 0.55, strike: 0.2, cancel: 0.3, activeFrom: 0.15, activeTo: 0.28, planted: false },
  { name: 'attack_2', duration: 0.55, strike: 0.2, cancel: 0.3, activeFrom: 0.15, activeTo: 0.28, planted: false },
  { name: 'attack_3', duration: 0.85, strike: 0.38, cancel: null, activeFrom: 0.33, activeTo: 0.46, planted: true },
];

/** The hit playing now. */
export interface HitPlay {
  step: ComboStep;
  /** Seconds into its clip. */
  time: number;
  /** Whether its strike moment has passed, so it strikes once however the frames fall. */
  struck: boolean;
  /** True when it took over from a hit still showing (the crossfade); false when it took over from the idle and run. */
  crossfaded: boolean;
  /** The clip time the hit before it had reached when this one began, or null when none was playing. */
  chainedAt: number | null;
}

/** A hit fading out under the next: its clip time and its weight on the frame the next began. */
export interface FadingHit {
  step: ComboStep;
  time: number;
  weight: number;
}

export interface ComboState {
  hit: HitPlay | null;
  outgoing: FadingHit | null;
  /** Whether a press is kept for the next hit, which then starts at the cancel point (or, after the finisher, its end). */
  queued: boolean;
  /** The hit the next press starts when none is playing. */
  next: ComboStep;
  /** Seconds since the last hit ended, while none is playing. */
  sinceEnd: number;
}

export const COMBO_READY: ComboState = Object.freeze({ hit: null, outgoing: null, queued: false, next: 1, sinceEnd: 0 }) as ComboState;

export type ComboPhase = 'ready' | 'windup' | 'active' | 'recovery';

/** What a frame's press did: nothing was pressed, it began a hit, it was kept for the next hit, or it was dropped. */
export type PressResult = 'none' | 'started' | 'queued' | 'dropped';

export interface ComboFrame {
  state: ComboState;
  /** The hit whose strike moment this frame reached, or null. */
  struck: ComboStep | null;
  /** The hit that began on this frame, or null. */
  started: ComboStep | null;
  press: PressResult;
}

export function contractOf(step: ComboStep, hits: readonly HitContract[] = COMBO_HITS): HitContract {
  return hits[step - 1]!;
}

/** The hit after this one: the light hits chain to the next, and the finisher's follow-up starts a new chain. */
export function followingStep(step: ComboStep): ComboStep {
  return step === 3 ? 1 : ((step + 1) as ComboStep);
}

/** Where a time falls in a hit: its wind-up, its active frames or its recovery. */
export function hitPhase(contract: HitContract, time: number): Exclude<ComboPhase, 'ready'> {
  if (time < contract.activeFrom) return 'windup';
  return time < contract.activeTo ? 'active' : 'recovery';
}

export function comboPhase(state: ComboState, hits: readonly HitContract[] = COMBO_HITS): ComboPhase {
  return state.hit ? hitPhase(contractOf(state.hit.step, hits), state.hit.time) : 'ready';
}

/**
 * When a press starts to count during a hit: `buffer` seconds before its cancel point (before its end, for the
 * finisher), and never before its start. At the default 0.2 s a light hit keeps a press from 0.10 s in, half way through
 * its wind-up, so a press made in rhythm with the swing, anywhere from the wind-up's second half to the cancel, plays
 * the next hit exactly at the cancel point: the chain flows on presses that need no frame timing. A press before that is
 * dropped rather than held. It comes within 0.1 s of the press that began the hit, which is a key's bounce, a mouse's
 * double click or a mash, not a choice of the next hit, and holding it would commit him to a second hit he may not want;
 * the buffer is live in the panel, and 0.3 s keeps every press from a light hit's start. The finisher keeps one press
 * from 0.2 s before its end, for a new chain after its recovery, so a held rhythm runs one chain into the next while the
 * finisher's recovery still plays out in full.
 */
export function bufferOpensAt(contract: HitContract, buffer: number): number {
  return Math.max(0, (contract.cancel ?? contract.duration) - Math.max(0, buffer));
}

/**
 * A hit's own weight over the idle and run at a time into it: faded in over the crossfade (from a hit still showing) or
 * the first hit's fade in (from the idle and run), held, and faded out to 0 one frame before its end, `frameStep` (the
 * frame's step, the best guess at the next) short of it, since the hit ends on the frame that reaches its end and a fade
 * that reached 0 only there left that last frame up to a step's share of the fade, which then vanished in one frame
 * (a quarter at SwiftShader's 0.05 s step). A light hit keeps its full weight until its cancel point whatever the fade
 * out, so a buffered hit always takes over from a hit at full weight and no idle shows between two hits of a chain.
 */
export function ownWeight(contract: HitContract, time: number, crossfaded: boolean, feel: CombatFeel, frameStep: number): number {
  const step = Math.max(0, frameStep);
  const fadeIn = crossfaded ? feel.crossfade : feel.fadeIn;
  const rise = fadeIn > 0 ? time / fadeIn : 1;
  const room = contract.cancel === null ? feel.fadeOut : Math.min(feel.fadeOut, contract.duration - step - contract.cancel);
  const fall = (contract.duration - step - time) / Math.max(1e-6, room);
  return Math.min(1, Math.max(0, Math.min(rise, fall)));
}

/**
 * The weights of the hit playing and of the one fading out under it. The incoming hit rises over the crossfade while the
 * outgoing one falls from the weight it had when the next began, so the two never sum past 1 and, from a hit at full
 * weight, sum to exactly 1 through the crossfade: the idle and run take only what the two leave, and the pose never pops.
 */
export function comboWeights(state: ComboState, feel: CombatFeel, frameStep: number, hits: readonly HitContract[] = COMBO_HITS): { current: number; outgoing: number } {
  const { hit, outgoing } = state;
  if (!hit) return { current: 0, outgoing: 0 };
  const current = ownWeight(contractOf(hit.step, hits), hit.time, hit.crossfaded, feel, frameStep);
  const handed = feel.crossfade > 0 ? Math.min(1, hit.time / feel.crossfade) : 1;
  return { current, outgoing: outgoing ? outgoing.weight * (1 - handed) : 0 };
}

/**
 * Begins a hit, `time` seconds in, over the hit now playing (`from`, at its clip time `fromTime`), which fades out under
 * it if it still shows. Only two hits ever show: the crossfade's 0.25 s ceiling (COMBAT_FEEL_RANGES) is under the light
 * hits' 0.30 s cancel point, so a hit has always finished fading in, and dropped the hit under it, by the time the next
 * can begin.
 */
function startHit(step: ComboStep, time: number, from: HitPlay | null, fromTime: number, feel: CombatFeel, frameStep: number, hits: readonly HitContract[]): { hit: HitPlay; outgoing: FadingHit | null } {
  const weight = from ? ownWeight(contractOf(from.step, hits), fromTime, from.crossfaded, feel, frameStep) : 0;
  const outgoing = from && weight > 0 ? { step: from.step, time: fromTime, weight } : null;
  return { hit: { step, time, struck: false, crossfaded: outgoing !== null, chainedAt: from ? fromTime : null }, outgoing };
}

/**
 * One frame of the combo: the frame's press, read against the state the frame starts from, then the frame's step.
 *
 * - With no hit playing, a press begins the next hit: attack_1, or the hit after the last if it ended less than the
 *   reset ago.
 * - During a light hit, a press from the buffer's opening to the cancel point is kept, once, and the next hit begins
 *   exactly at the cancel point, the time past it carried into the new hit, so the chain keeps its rhythm whatever the
 *   frame rate. A press past the cancel point begins the next hit at once, on this frame.
 * - During the finisher, a press in the buffer before its end is kept and begins a new chain at its end; one before that
 *   is dropped. Three hits at most, then the finisher's recovery.
 * - A press before the buffer opens, a second press while one is kept, and any press on a frozen frame are dropped.
 * - A kept press survives the crossfade: it belongs to the hit that was playing when it was made, and that hit's own
 *   cancel point starts the next one, so nothing a crossfade does can lose it.
 * - Each hit strikes once, on the frame that reaches its strike moment.
 * - After a hit ends with no press kept, the chain waits `reset` seconds for the next press and then starts again from
 *   attack_1; after the finisher it starts again from attack_1 at once.
 */
export function stepCombo(state: ComboState, pressed: boolean, dt: number, feel: CombatFeel, hits: readonly HitContract[] = COMBO_HITS): ComboFrame {
  if (dt <= 0) return { state, struck: null, started: null, press: pressed ? 'dropped' : 'none' };
  let { hit, outgoing, queued, next, sinceEnd } = state;
  let started: ComboStep | null = null;
  let struck: ComboStep | null = null;
  let press: PressResult = 'none';

  if (pressed) {
    if (!hit) {
      ({ hit, outgoing } = startHit(next, 0, null, 0, feel, dt, hits));
      started = hit.step;
      press = 'started';
      queued = false;
    } else {
      const contract = contractOf(hit.step, hits);
      if (contract.cancel !== null && hit.time >= contract.cancel) {
        ({ hit, outgoing } = startHit(followingStep(hit.step), 0, hit, hit.time, feel, dt, hits));
        started = hit.step;
        press = 'started';
        queued = false;
      } else if (!queued && hit.time >= bufferOpensAt(contract, feel.buffer)) {
        queued = true;
        press = 'queued';
      } else {
        press = 'dropped';
      }
    }
  }

  if (hit) {
    const contract = contractOf(hit.step, hits);
    const before = hit.time;
    const after = before + dt;
    if (outgoing) outgoing = { ...outgoing, time: Math.min(contractOf(outgoing.step, hits).duration, outgoing.time + dt) };
    let hitStruck = hit.struck;
    if (!hitStruck && before < contract.strike && after >= contract.strike) {
      hitStruck = true;
      struck = hit.step;
    }
    const playing: HitPlay = { ...hit, time: after, struck: hitStruck };
    if (queued && contract.cancel !== null && after >= contract.cancel) {
      // The kept press begins the next hit exactly at the cancel point: it starts the time past the cancel point in,
      // and the hit it takes over from fades from its weight at the cancel point, full by ownWeight's rule.
      ({ hit, outgoing } = startHit(followingStep(playing.step), after - contract.cancel, { ...playing, time: contract.cancel }, contract.cancel, feel, dt, hits));
      outgoing = outgoing ? { ...outgoing, time: after } : null;
      started = hit.step;
      queued = false;
    } else if (after >= contract.duration) {
      if (queued) {
        // Only the finisher can still hold a press at its end, kept in its buffer for a new chain. Its weight has
        // already reached 0 a frame early, so the new chain fades in from the idle and run.
        ({ hit, outgoing } = startHit(followingStep(playing.step), after - contract.duration, null, 0, feel, dt, hits));
        hit = { ...hit, chainedAt: contract.duration };
        started = hit.step;
        queued = false;
      } else {
        hit = null;
        outgoing = null;
        next = followingStep(playing.step);
        sinceEnd = after - contract.duration;
      }
    } else {
      hit = playing;
    }
    if (hit && outgoing && hit.time >= feel.crossfade) outgoing = null;
    if (hit) sinceEnd = 0;
  } else {
    sinceEnd += dt;
  }
  if (!hit && sinceEnd >= feel.reset) next = 1;
  return { state: { hit, outgoing, queued, next, sinceEnd }, struck, started, press };
}

/**
 * How the hit playing slows and turns him. A light hit keeps `moveScale` of his pace from its start to the end of its
 * active frames: through the wind-up his drive eases down to it at the stop rate, and through the active frames it is
 * held there (`cap`), so the blow lands at a steady, reduced pace while his legs keep running. His turn rate falls to
 * `windupTurn` of its cap in the wind-up, so he can still aim the blow, and his facing is locked from the active frames
 * to the cancel point, so the cut goes where it was aimed (Pillar 4); past the cancel point he turns and runs freely to
 * line up the next hit. The finisher plants him: no pace and no turn for its whole length, on the frame it begins, since
 * it plays on his whole body with both boots planted (the clip holds them by IK on every frame) and any pace under it
 * would slide them.
 */
export function swingMotion(state: ComboState, feel: CombatFeel, hits: readonly HitContract[] = COMBO_HITS): SwingMotion {
  const { hit } = state;
  if (!hit) return FREE_MOTION;
  const contract = contractOf(hit.step, hits);
  if (contract.planted) return { moveScale: 0, turnScale: 0, cap: true };
  if (hit.time < contract.activeFrom) return { moveScale: feel.moveScale, turnScale: feel.windupTurn, cap: false };
  if (hit.time < contract.activeTo) return { moveScale: feel.moveScale, turnScale: 0, cap: true };
  if (contract.cancel !== null && hit.time < contract.cancel) return { moveScale: 1, turnScale: 0, cap: false };
  return FREE_MOTION;
}

/**
 * Whether the run keeps the weight it had on the frame before rather than following his speed: while a planted hit
 * fades in. The finisher stops him dead on its first frame, and following his speed there dropped the run's weight from
 * 1 to 0 at once while the hit stood at a frame's share of its fade in, so the idle showed under it (76 percent at
 * 60 fps). Held, with its rate at 0 at his zero speed, the run stands still until the hit covers it. A light hit eases
 * his pace down instead, so the run follows his speed and its rate keeps his feet on the ground.
 */
export function holdsRunWeight(state: ComboState, feel: CombatFeel, hits: readonly HitContract[] = COMBO_HITS): boolean {
  const { hit } = state;
  if (!hit || !contractOf(hit.step, hits).planted) return false;
  return hit.time < (hit.crossfaded ? feel.crossfade : feel.fadeIn);
}

/** One half of the body's weights: the idle, the run, the hit playing and the hit fading out. */
export interface LayerWeights {
  idle: number;
  run: number;
  current: number;
  outgoing: number;
}

/**
 * The upper body's and the lower body's weights. three's AnimationMixer weighs a whole action, every bone its clip
 * touches, so each clip is split into an upper half (the spine and everything on it) and a lower half (the hips and
 * legs), and each half's weights sum to 1 on its own, so no bone falls back toward its bind pose. The upper body plays
 * the hits at their weights, over the idle and run by his speed (`run`, the run's weight against the idle). The lower
 * body plays a planted hit at its full weight, and a light hit at its weight times the idle's share, (1 - run): standing,
 * the whole body swings, the hips' coil and the planted stance included; moving, the legs keep the run cycle under the
 * swinging arms.
 */
export function bodyWeights(run: number, current: number, currentPlanted: boolean, outgoing: number, outgoingPlanted: boolean): { upper: LayerWeights; lower: LayerWeights } {
  const r = Math.min(1, Math.max(0, run));
  const attack = Math.min(1, current + outgoing);
  const lowerCurrent = current * (currentPlanted ? 1 : 1 - r);
  const lowerOutgoing = outgoing * (outgoingPlanted ? 1 : 1 - r);
  const lowerAttack = Math.min(1, lowerCurrent + lowerOutgoing);
  return {
    upper: { idle: (1 - r) * (1 - attack), run: r * (1 - attack), current, outgoing },
    lower: { idle: (1 - r) * (1 - lowerAttack), run: r * (1 - lowerAttack), current: lowerCurrent, outgoing: lowerOutgoing },
  };
}

/** A piecewise-linear map from a hit's clip time to a source clip's time: [hit time, source time] pairs, hit times rising. */
export type WarpAnchors = readonly (readonly [number, number])[];

/** The source time a hit's time maps to through the anchors, held at the first and last anchors outside them. */
export function warpTime(anchors: WarpAnchors, time: number): number {
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  if (time <= first[0]) return first[1];
  if (time >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [t1, s1] = anchors[i]!;
    if (time <= t1) {
      const [t0, s0] = anchors[i - 1]!;
      return s0 + ((time - t0) / (t1 - t0)) * (s1 - s0);
    }
  }
  return last[1];
}

/**
 * attack_2's placeholder plays the source cleave backward, as a rising backhand: from the follow-through
 * (BACKHAND_FROM_AFTER_STRIKE past the source's strike), up through the cut, whose fastest moment it strikes at
 * (BACKHAND_STRIKE_BEFORE_STRIKE before the source's strike), to the coil above his right shoulder
 * (BACKHAND_TO_BEFORE_STRIKE before it). The source cleave snaps its sword hand up in one frame (0.067 to 0.1 s), holds
 * the coil to 0.267 s, cuts down by 0.333 s at up to 27 m/s, and holds the follow-through in front until 0.63 s. Played
 * backward with its strike on the source's own 0.34 s, the end of the cut, the backhand struck before its blade moved
 * and rose only after; on 0.30 s, the middle of the cut, the blade passes in front at speed on the strike. Its first pose
 * stands within 7 cm of attack_1's sword hand at attack_1's cancel point, both in the follow-through, so the crossfade
 * barely moves the sword, and the cut down and the cut back up read as two blows, where a second forward cleave read as
 * the first one again. Mirroring was not used: the sword is in his right hand and the shield in his left, so a mirrored
 * cleave swings the shield.
 */
export const BACKHAND_FROM_AFTER_STRIKE = 0.26;
export const BACKHAND_STRIKE_BEFORE_STRIKE = 0.04;
export const BACKHAND_TO_BEFORE_STRIKE = 0.22;
/**
 * The finisher's placeholder starts this long before the source's strike, in the held coil just after the snap up,
 * where attack_2's backhand ends, so the chain goes from the backhand's coil straight into a long, still wind-up and the
 * cleave. Started from the source's first frame, it dropped the sword from the coil to the guard over the crossfade only
 * to snap it back up 0.1 s later.
 */
export const FINISHER_FROM_BEFORE_STRIKE = 0.21;

/**
 * The anchors a placeholder hit is time-warped from the source attack clip by: piecewise-linear through the hit's start,
 * its strike and its end, so the source's strike lands exactly at the hit's contract strike, where a uniform scale of the
 * 0.833 s cleave to 0.55 s would put its 0.34 s strike at 0.22 s instead of 0.20 s, and to 0.85 s at 0.35 s instead of
 * 0.38 s. attack_1 plays the whole cleave forward, attack_2 a stretch of it backward, and the finisher the cleave from its
 * coil; every source time is clamped into the source clip.
 */
export function placeholderAnchors(contract: HitContract, sourceDuration: number, sourceStrike: number): WarpAnchors {
  const at = (time: number): number => Math.min(sourceDuration, Math.max(0, time));
  if (contract.name === 'attack_2') {
    return [
      [0, at(sourceStrike + BACKHAND_FROM_AFTER_STRIKE)],
      [contract.strike, at(sourceStrike - BACKHAND_STRIKE_BEFORE_STRIKE)],
      [contract.duration, at(sourceStrike - BACKHAND_TO_BEFORE_STRIKE)],
    ];
  }
  return [
    [0, contract.name === 'attack_3' ? at(sourceStrike - FINISHER_FROM_BEFORE_STRIKE) : 0],
    [contract.strike, at(sourceStrike)],
    [contract.duration, at(sourceDuration)],
  ];
}
