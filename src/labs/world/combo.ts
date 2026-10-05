/**
 * Play Pip (prototype)'s three-hit combo, kept apart from three and the page so the unit test drives it directly: the
 * hits' timing contracts, the chain's state machine (which hit plays, its clip time, the buffered press, the strike once
 * per hit, the cancel point and the chain's reset), the weights that crossfade one hit into the next, and how a hit
 * slows and turns him. Like the rest of Play Pip it is a lab prototype that feeds the M1 commander controller (Mechanics,
 * Commander combat), not that controller.
 *
 * Time comes in only as each frame's step, as the simulation's time will. A step of 0 moves no time, but a press on it
 * still counts: it starts a hit at its first moment or is kept for the next, exactly as on a moving frame. That is the
 * seam phase B's hit-stop needs, which holds the combo's clock at 0 for a few frames on contact while the player keeps
 * pressing: a press made in the stop must still chain the next hit. The step used to drop every press on a zero step,
 * so hit-stop would have eaten the very presses that chain a combo. The lab's freeze, which should take no input, drops
 * its presses in play.ts instead, before they reach here.
 */
// With its import attribute: the browser tests import this module (tests/e2e/asset-world.spec.ts, for COMBO_HITS), and
// Playwright loads it as Node's own ES module, which refuses a JSON import without one, so the whole suite stopped
// before its first test. Vite and Vitest take the attribute as they take the plain import.
import timings from '../../shared/timings.json' with { type: 'json' };
import type { CombatFeel } from './combatFeel';
import { FREE_MOTION, type SwingMotion } from './playMotion';

export type ComboStep = 1 | 2 | 3;
export type HitName = 'attack_1' | 'attack_2' | 'attack_3';

/** One hit's timing contract, in seconds into its clip. */
export interface HitContract {
  /** The clip the hit plays, by its name in the GLB; a placeholder stands in for a GLB that does not export it. */
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

/** How long before a hit's strike its active frames begin, and how long after it they end, in seconds. */
export const ACTIVE_BEFORE_STRIKE = 0.05;
export const ACTIVE_AFTER_STRIKE = 0.08;

/**
 * One hit's contract: its length and strike from its entry under commanders.commander_pip in src/shared/timings.json,
 * the file assets:check holds the exported clip to and the recipe keys the clip from, and what that file has no place
 * for from here: the cancel point, the active frames around the strike and the plant.
 */
function contract(name: HitName, cancel: number | null, planted: boolean): HitContract {
  const { duration, strike } = timings.commanders.commander_pip[name];
  return { name, duration, strike, cancel, activeFrom: strike - ACTIVE_BEFORE_STRIKE, activeTo: strike + ACTIVE_AFTER_STRIKE, planted };
}

/**
 * The timing contracts for attack_1, attack_2 and the finisher attack_3. The lengths and strikes are the shared ones in
 * src/shared/timings.json, since the real clips shipped in commander_pip.glb: they lived here while placeholders stood
 * in, and a clip and the page could have timed a hit apart. The light hits are quick (0.55 s, striking at 0.20 s) and
 * cancel at 0.30 s, after the strike and its active frames; the finisher keeps the cleave's weight (0.85 s, striking at
 * 0.38 s) and has no cancel. Each hit's active frames run from 50 ms before its strike to 80 ms after it, about four
 * frames at 30 fps, where the cut moves fastest; a light hit's active frames end 20 ms before its cancel point, so the
 * cancel never lands inside them. The cancel points stay here, as timings.json carries a clip's length and strike only;
 * the recipe keys each chained hit from the pose the hit before holds at its cancel point, records the cancel it used in
 * the sidecar, and a unit test holds the two equal (tests/unit/assets/pip-meta.test.ts).
 */
export const COMBO_HITS: readonly HitContract[] = [contract('attack_1', 0.3, false), contract('attack_2', 0.3, false), contract('attack_3', null, true)];

/**
 * The fades a hit plays with, copied from the combat feel settings on the frame it begins: the seconds it rises over
 * (the crossfade from a hit still showing, or the first hit's fade in from the idle and run) and the seconds its last
 * fade out may take. Read live from the settings instead, a slider moved mid-hit rescaled the hit already playing, so
 * its weight jumped on the frame of the edit (a crossfade dragged from 0.10 to 0.25 s halfway through a crossfade threw
 * the incoming hit's weight from 0.5 to 0.2 at once); copied, an edit applies from the next hit.
 */
export interface HitFades {
  rise: number;
  fadeOut: number;
}

/** The fades a hit takes on from the settings as it begins, over a hit still showing (`crossfaded`) or over the idle. */
export function hitFades(crossfaded: boolean, feel: CombatFeel): HitFades {
  return { rise: crossfaded ? feel.crossfade : feel.fadeIn, fadeOut: feel.fadeOut };
}

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
  /** Its fades, fixed when it began (HitFades says why). */
  fades: HitFades;
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

/** The fade step a page starts from, before its combo's clock has moved: a frame at 60 frames a second. */
export const FIRST_FADE_STEP = 1 / 60;

/** The least step the combo takes at once, in seconds (longestComboStep): a frame at 120 frames a second. */
export const COMBO_STEP_FLOOR = 1 / 120;

/**
 * The step the hits' fades read on a frame (ownWeight): the combo's own step when its clock moves, and on a held clock
 * (phase B's hit-stop, or the lab's freeze) the last step it moved by, `previous`. A page keeps the value from frame to
 * frame, from FIRST_FADE_STEP. The fades read the frame's movement step before, which is 0 whenever a hit-stop holds his
 * movement too, as it must (PlayClocks says why): a hit begun in the stop then took over from a weight read at a step
 * of 0, not the one drawn on the frame before (0.5 against 0.417 for a light hit 0.45 s in), and the pose popped.
 */
export function fadeStep(previous: number, comboStep: number): number {
  return comboStep > 0 ? comboStep : previous;
}

/**
 * A hit's own weight over the idle and run at a time into it: risen over its fades' rise (the crossfade from a hit still
 * showing, or the first hit's fade in from the idle and run), held, and faded out to 0 one frame before its end,
 * `frameStep` (the step the combo's clock last moved by, the best guess at its next: fadeStep) short of it, since the
 * hit ends on the frame that reaches its end and a fade that reached 0 only there left that last frame up to a step's
 * share of the fade, which then vanished in one frame (a quarter at SwiftShader's 0.05 s step). The last moving step,
 * not this frame's, because phase B's hit-stop will hold the combo's step at 0 while frames still draw: read at a step
 * of 0 the fade's end jumped a frame's share each time a stop began and ended. A light hit keeps its full weight until
 * its cancel point whatever the fade out, so a buffered hit always takes over from a hit at full weight and no idle
 * shows between two hits.
 */
export function ownWeight(contract: HitContract, time: number, fades: HitFades, frameStep: number): number {
  const step = frameStep > 0 ? frameStep : 0;
  const rise = fades.rise > 0 ? time / fades.rise : 1;
  const room = contract.cancel === null ? fades.fadeOut : Math.min(fades.fadeOut, contract.duration - step - contract.cancel);
  const fall = (contract.duration - step - time) / Math.max(1e-6, room);
  return Math.min(1, Math.max(0, Math.min(rise, fall)));
}

/**
 * The weights of the hit playing and of the one fading out under it. The incoming hit rises over its crossfade while
 * the outgoing one falls from the weight it had when the next began, so the two never sum past 1 and, from a hit at
 * full weight, sum to exactly 1 through the crossfade: the idle and run take only what the two leave, and the pose never
 * pops. `frameStep` is the step the combo's clock last moved by (fadeStep; ownWeight says why).
 */
export function comboWeights(state: ComboState, frameStep: number, hits: readonly HitContract[] = COMBO_HITS): { current: number; outgoing: number } {
  const { hit, outgoing } = state;
  if (!hit) return { current: 0, outgoing: 0 };
  const current = ownWeight(contractOf(hit.step, hits), hit.time, hit.fades, frameStep);
  const handed = hit.fades.rise > 0 ? Math.min(1, hit.time / hit.fades.rise) : 1;
  return { current, outgoing: outgoing ? outgoing.weight * (1 - handed) : 0 };
}

/**
 * Begins a hit, `time` seconds in, over the hit now playing (`from`, at its clip time `fromTime`), which fades out under
 * it if it still shows. Only two hits ever show: the crossfade's 0.25 s ceiling (COMBAT_FEEL_RANGES) is under the light
 * hits' 0.30 s cancel point, so a hit has always finished fading in, and dropped the hit under it, by the time the next
 * can begin. The new hit takes its fades from the settings now and keeps them (HitFades).
 */
function startHit(step: ComboStep, time: number, from: HitPlay | null, fromTime: number, feel: CombatFeel, frameStep: number, hits: readonly HitContract[]): { hit: HitPlay; outgoing: FadingHit | null } {
  const weight = from ? ownWeight(contractOf(from.step, hits), fromTime, from.fades, frameStep) : 0;
  const outgoing = from && weight > 0 ? { step: from.step, time: fromTime, weight } : null;
  const crossfaded = outgoing !== null;
  return { hit: { step, time, struck: false, crossfaded, chainedAt: from ? fromTime : null, fades: hitFades(crossfaded, feel) }, outgoing };
}

/**
 * The longest step the combo takes at once: its earliest strike moment. A hit can begin part way into a frame (a kept
 * press at a cancel point, or a new chain at the finisher's end), carrying the frame's time past that moment into it;
 * carried as far as its own strike, it began already past it, the strike check (before the strike, then at or past it)
 * never saw it cross, and the hit never struck (a light hit carried in by a 0.25 s step began 0.20 s in, on its strike).
 * The carry is always shorter than the step, so a step no longer than the earliest strike starts every hit short of its
 * own. The pages clamp their step to 1/20 s, so this only guards a caller that does not. It is floored at
 * COMBO_STEP_FLOOR: a contract with its strike at 0 made the cap 0, and the combo then moved no time on any frame, so
 * every hit stood at its first moment for good (a unit test holds every shipped strike above 0).
 */
export function longestComboStep(hits: readonly HitContract[] = COMBO_HITS): number {
  return Math.max(COMBO_STEP_FLOOR, Math.min(...hits.map((hit) => hit.strike)));
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
 * - A press before the buffer opens and a second press while one is kept are dropped.
 * - A press on a step of 0 counts as on any other: it starts a hit at its first moment or is kept, and the time it
 *   would have moved waits for a step that moves it (the module's comment says why).
 * - A kept press survives the crossfade: it belongs to the hit that was playing when it was made, and that hit's own
 *   cancel point starts the next one, so nothing a crossfade does can lose it.
 * - Each hit strikes once, on the frame that reaches its strike moment; a step is cut to longestComboStep, so a hit
 *   carried into a frame always crosses its strike on a later one.
 * - After a hit ends with no press kept, the chain waits `reset` seconds for the next press and then starts again from
 *   attack_1; after the finisher it starts again from attack_1 at once.
 *
 * `dt` is the combo's own step, which phase B's hit-stop holds at 0 (and a NaN step moves no time either, so it cannot
 * leave a hit whose time never reaches its end); `frameStep` is the step the weights read (fadeStep: the combo's last
 * moving step), the same as `dt` unless the combo's clock is held, so a hit begun on a held frame takes over from the
 * weight drawn on the frame before.
 */
export function stepCombo(state: ComboState, pressed: boolean, dt: number, feel: CombatFeel, frameStep: number = dt, hits: readonly HitContract[] = COMBO_HITS): ComboFrame {
  let { hit, outgoing, queued, next, sinceEnd } = state;
  let started: ComboStep | null = null;
  let struck: ComboStep | null = null;
  let press: PressResult = 'none';

  if (pressed) {
    if (!hit) {
      ({ hit, outgoing } = startHit(next, 0, null, 0, feel, frameStep, hits));
      started = hit.step;
      press = 'started';
      queued = false;
    } else {
      const contract = contractOf(hit.step, hits);
      if (contract.cancel !== null && hit.time >= contract.cancel) {
        ({ hit, outgoing } = startHit(followingStep(hit.step), 0, hit, hit.time, feel, frameStep, hits));
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

  // Written as "not above 0" so that a NaN step, which compares false both ways, moves no time.
  if (!(dt > 0)) {
    if (press === 'none' || press === 'dropped') return { state, struck: null, started: null, press };
    if (hit) sinceEnd = 0;
    return { state: { hit, outgoing, queued, next, sinceEnd }, struck: null, started, press };
  }
  const step = Math.min(dt, longestComboStep(hits));

  if (hit) {
    const contract = contractOf(hit.step, hits);
    const before = hit.time;
    const after = before + step;
    if (outgoing) outgoing = { ...outgoing, time: Math.min(contractOf(outgoing.step, hits).duration, outgoing.time + step) };
    let hitStruck = hit.struck;
    if (!hitStruck && before < contract.strike && after >= contract.strike) {
      hitStruck = true;
      struck = hit.step;
    }
    const playing: HitPlay = { ...hit, time: after, struck: hitStruck };
    if (queued && contract.cancel !== null && after >= contract.cancel) {
      // The kept press begins the next hit exactly at the cancel point: it starts the time past the cancel point in,
      // and the hit it takes over from fades from its weight at the cancel point, full by ownWeight's rule.
      ({ hit, outgoing } = startHit(followingStep(playing.step), after - contract.cancel, { ...playing, time: contract.cancel }, contract.cancel, feel, frameStep, hits));
      outgoing = outgoing ? { ...outgoing, time: after } : null;
      started = hit.step;
      queued = false;
    } else if (after >= contract.duration) {
      if (queued) {
        // Only the finisher can still hold a press at its end, kept in its buffer for a new chain. Its weight has
        // already reached 0 a frame early, so the new chain fades in from the idle and run.
        ({ hit, outgoing } = startHit(followingStep(playing.step), after - contract.duration, null, 0, feel, frameStep, hits));
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
    if (hit && outgoing && hit.time >= hit.fades.rise) outgoing = null;
    if (hit) sinceEnd = 0;
  } else {
    sinceEnd += step;
  }
  if (!hit && sinceEnd >= feel.reset) next = 1;
  return { state: { hit, outgoing, queued, next, sinceEnd }, struck, started, press };
}

/**
 * How the hit playing slows and turns him. A light hit keeps `moveScale` of his pace from its start to its cancel point:
 * through the wind-up his drive eases down to it at the stop rate, and through the active frames it is held at or under
 * it (`cap`, stepMotion), so the blow lands at a steady, reduced pace while his legs keep running, and a key let go
 * there eases him down rather than stopping him dead. Freed at the end of the active
 * frames instead, he surged from 1.28 m/s to 1.6 m/s in the 20 ms before the cancel point and slowed again in the next
 * hit's wind-up, a bump in every chain; held to the cancel point, a chain runs at one even pace. His turn rate falls to
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
  if (contract.cancel !== null && hit.time < contract.cancel) return { moveScale: feel.moveScale, turnScale: 0, cap: false };
  return FREE_MOTION;
}

/**
 * Whether the run keeps the weight it had on the frame before rather than following his speed: while a planted hit
 * fades in. The finisher stops him dead on its first frame, and following his speed there dropped the run's weight from
 * 1 to 0 at once while the hit stood at a frame's share of its fade in, so the idle showed under it (76 percent at
 * 60 fps). Held, with its rate at 0 at his zero speed, the run stands still until the hit covers it. A light hit eases
 * his pace down instead, so the run follows his speed and its rate keeps his feet on the ground.
 */
export function holdsRunWeight(state: ComboState, hits: readonly HitContract[] = COMBO_HITS): boolean {
  const { hit } = state;
  if (!hit || !contractOf(hit.step, hits).planted) return false;
  return hit.time < hit.fades.rise;
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
 * body plays a planted hit at its full weight, and a light hit only in the idle's place: the run keeps its share, run
 * times what the planted hits leave, a light hit takes its weight times the idle's share, (1 - run), and the idle the
 * rest of that share. Standing, the whole body swings, the hips' coil and the planted stance included; moving, the legs
 * keep the run cycle under the swinging arms. The run's share used to shrink with the light hit's on the legs too, so
 * at full hit weight it was run squared: at half the run's weight (0.6 m/s) the legs took 0.25 run, 0.5 hit and 0.25
 * idle, an idle stance mixed into a jog, where they now take 0.5 run and 0.5 hit. The shares still sum to 1 and move
 * continuously with the run's weight and the hits'.
 */
export function bodyWeights(run: number, current: number, currentPlanted: boolean, outgoing: number, outgoingPlanted: boolean): { upper: LayerWeights; lower: LayerWeights } {
  const r = Math.min(1, Math.max(0, run));
  const total = current + outgoing;
  const attack = Math.min(1, total);
  // The two hits never sum past 1 (comboWeights); scaled down if rounding takes them past it, so the idle never goes
  // negative on the legs.
  const k = total > 1 ? 1 / total : 1;
  const planted = k * ((currentPlanted ? current : 0) + (outgoingPlanted ? outgoing : 0));
  const light = k * total - planted;
  const lowerCurrent = k * current * (currentPlanted ? 1 : 1 - r);
  const lowerOutgoing = k * outgoing * (outgoingPlanted ? 1 : 1 - r);
  return {
    upper: { idle: (1 - r) * (1 - attack), run: r * (1 - attack), current, outgoing },
    lower: { idle: (1 - r) * Math.max(0, 1 - planted - light), run: r * (1 - planted), current: lowerCurrent, outgoing: lowerOutgoing },
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
