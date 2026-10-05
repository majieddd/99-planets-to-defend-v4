/**
 * Play Pip (prototype)'s three-hit combo, kept apart from three and the page so the unit test drives it directly: the
 * hits' timing contracts, the chain's state machine (which hit plays, its clip time, the buffered press, the strike once
 * per hit, the cancel point, the finisher's recovery cut, the recovery clip that plays when a chain stops and the chain's
 * reset), the weights that crossfade one clip into the next, and how a hit slows and turns him. Like the rest of Play Pip
 * it is a lab prototype that feeds the M1 commander controller (Mechanics, Commander combat), not that controller.
 *
 * Time comes in only as each frame's step, as the simulation's time will. A step of 0 moves no time, but a press on it
 * still counts: it starts a hit at its first moment or is kept for the next. That is the seam the hit-stop needs, which
 * holds the combo's clock at 0 for a few frames on contact while the player keeps pressing: a press made in the stop
 * must still chain the next hit. The step used to drop every press on a zero step, so hit-stop would have eaten the
 * very presses that chain a combo. The lab's freeze, which should take no input, drops its presses in play.ts instead,
 * before they reach here, so a held clock here is always a hit-stop's.
 *
 * Every window of a hit stays in its clip's own seconds: a hit's playback speed (the feel's per-hit speed) advances its
 * clip time by the frame's step times the speed, so the strike, the active frames, the cancel point, the recovery cut,
 * the fades and the clip's root motion all move together, and nothing here needs rescaling when the speed changes.
 *
 * Nothing here is the player's alone: a hit's contract is data (its timings.json entry), the chain reads only the
 * contracts it is handed, and the state is plain values, so an enemy's attack chain can run on the same module with its
 * own contracts (blueprint Task list, the M1 note on enemy choreography).
 */
// With its import attribute: the browser tests import this module (tests/e2e/asset-world.spec.ts, for COMBO_HITS), and
// Playwright loads it as Node's own ES module, which refuses a JSON import without one, so the whole suite stopped
// before its first test. Vite and Vitest take the attribute as they take the plain import.
import timings from '../../shared/timings.json' with { type: 'json' };
import type { CombatFeel } from './combatFeel';
import { FREE_MOTION, type SwingMotion } from './playMotion';

export type ComboStep = 1 | 2 | 3;

/**
 * The swing sets Pip's GLB ships, each three clips by name in chain order: Quaternius's sword combo, retargeted onto him
 * with the natural grip (the default since 2026-10-05, at the owner's word on the hand-keyed swing: "the swing looks
 * unnatural with the way the sword is held"), and the hand-keyed hits kept beside it for comparison, under names of
 * their own. The labs' "swing set" control picks one.
 */
export type SwingSet = 'quaternius' | 'hand';
export const SWING_SETS: Readonly<Record<SwingSet, readonly [string, string, string]>> = Object.freeze({
  quaternius: ['attack_1', 'attack_2', 'attack_3'] as const,
  hand: ['attack_1_hand', 'attack_2_hand', 'attack_3_hand'] as const,
});
export const DEFAULT_SWING_SET: SwingSet = 'quaternius';

/** One hit's timing contract, in seconds into its clip. */
export interface HitContract {
  /** The clip the hit plays, by its name in the GLB; a placeholder stands in for a GLB that does not export it. */
  name: string;
  /** Its place in the chain: 1 and 2 the light hits, 3 the finisher. */
  step: ComboStep;
  duration: number;
  /** The strike moment, where the hit lands (Pillar 4). */
  strike: number;
  /**
   * From here a press starts the next hit at once, and a buffered press starts it exactly here; null for the finisher,
   * which closes the chain.
   */
  cancel: number | null;
  /** The active frames, from `activeFrom` up to `activeTo`: the blade's fast stretch around the strike. */
  activeFrom: number;
  activeTo: number;
  /**
   * Whether it closes the chain (it has no cancel): the finisher, with its own pace and turn knobs. It used to mean he
   * planted for it too (`planted`, his whole body and no pace at all); the owner asked that the last swing slow him
   * rather than stop him (2026-10-05), so closing the chain no longer plants him.
   */
  finisher: boolean;
  /**
   * The finisher's cuttable recovery, from `recoverFrom` to `recoverTo` seconds in: the stretch the feel's recovery cut
   * may end it at, where he regains full control and may start a new chain. Null for a light hit, and for a finisher
   * whose recovery plays out (the hand-keyed one).
   */
  recoverFrom: number | null;
  recoverTo: number | null;
  /** The clip that plays when the chain stops after this light hit (Quaternius's attack_1_rec), and its length; else null. */
  recovery: string | null;
  recoveryDuration: number | null;
}

/**
 * One clip's timing as src/shared/timings.json gives it under commanders.commander_pip: its length and strike, which the
 * recipe keys the clip to and assets:check holds the export to; for a hit, its active frames, the blade's fast stretch
 * around the strike that the arena's hit test reads, and its cancel point, null for the chain's closing hit; the
 * finisher's cuttable recovery; and a light hit's recovery clip. All in seconds into the clip. A clip that is not a hit
 * (a recovery) gives a length and a strike of null.
 */
export interface HitTiming {
  duration: number;
  strike: number | null;
  activeFrom?: number;
  activeTo?: number;
  cancel?: number | null;
  recoverFrom?: number;
  recoverTo?: number;
  recovery?: string;
}

/** Throws unless every named number is finite, naming the hit and the key: the contracts are built once, at load. */
function finiteOrThrow(name: string, values: Readonly<Record<string, unknown>>): void {
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name}'s ${key} must be a finite number of seconds, not ${String(value)}`);
  }
}

/**
 * A hit's contract from its timing (and, for its recovery clip's length, the set of timings it came from). The hit with
 * no cancel closes the chain: the finisher. Every number must be finite, or the build of the contracts throws, naming
 * it: a NaN strike or active frame compared false everywhere, so the hit never struck and never landed, with nothing to
 * say why (a timings entry with a key left out read as undefined the same way).
 */
export function hitContract(name: string, step: ComboStep, timing: HitTiming, all: Readonly<Record<string, HitTiming>> = {}): HitContract {
  const { duration, strike, activeFrom, activeTo } = timing;
  const cancel = timing.cancel === undefined ? null : timing.cancel;
  finiteOrThrow(name, { duration, strike, activeFrom, activeTo, ...(cancel === null ? {} : { cancel }) });
  const window = timing.recoverFrom !== undefined || timing.recoverTo !== undefined;
  if (window) finiteOrThrow(name, { recoverFrom: timing.recoverFrom, recoverTo: timing.recoverTo });
  const recovery = typeof timing.recovery === 'string' ? timing.recovery : null;
  const recoveryDuration = recovery ? (all[recovery]?.duration ?? null) : null;
  if (recovery) finiteOrThrow(recovery, { duration: recoveryDuration });
  return {
    name,
    step,
    duration,
    strike: strike as number,
    cancel,
    activeFrom: activeFrom as number,
    activeTo: activeTo as number,
    finisher: cancel === null,
    recoverFrom: window ? timing.recoverFrom! : null,
    recoverTo: window ? timing.recoverTo! : null,
    recovery,
    recoveryDuration,
  };
}

/**
 * The combo's contracts for three clips in chain order (`names`, a swing set's), from a set of timings shaped as
 * timings.json's commander entry. A new set of clips with new numbers drops in by its entries there, with no change to
 * this code: every caller of the combo takes the contracts it is handed.
 */
export function comboContracts(timing: Readonly<Record<string, HitTiming>>, names: readonly [string, string, string] = SWING_SETS.quaternius): HitContract[] {
  return names.map((name, index) => {
    const entry = timing[name];
    if (!entry) throw new Error(`timings.json has no entry for ${name}, the combo's hit ${index + 1}`);
    return hitContract(name, (index + 1) as ComboStep, entry, timing);
  });
}

const PIP_TIMINGS = timings.commanders.commander_pip as unknown as Readonly<Record<string, HitTiming>>;

/**
 * The timing contracts of Pip's Quaternius hits, attack_1, attack_2 and the finisher attack_3, every number from
 * src/shared/timings.json: the forehand 0.433 s, striking at 0.267 s and cancelling at 0.367 s; the backhand 0.533 s,
 * striking at 0.267 s and cancelling at 0.367 s; the spin finisher 2.0 s, striking at 0.667 s, with its recovery cuttable
 * from 0.767 to 1.633 s. The active frames run from 50 ms before each strike to 80 ms after it. The light hits name the
 * recovery clips that play when the chain stops after them (attack_1_rec, attack_2_rec). assets:check holds the window
 * order there (0 < activeFrom < strike < activeTo <= cancel < duration, activeTo <= recoverFrom < recoverTo <= duration)
 * and the sidecar's recorded cancels to it, and tests/unit/assets/pip-meta.test.ts holds the sidecar to these contracts.
 */
export const COMBO_HITS: readonly HitContract[] = comboContracts(PIP_TIMINGS, SWING_SETS.quaternius);
/**
 * The hand-keyed hits' contracts (attack_1_hand to attack_3_hand), the values the combo had before the Quaternius set
 * replaced it, unchanged: the light hits 0.55 s, striking at 0.20 s and cancelling at 0.30 s, the finisher 0.85 s,
 * striking at 0.38 s, with no recovery clips and no cuttable recovery.
 */
export const HAND_HITS: readonly HitContract[] = comboContracts(PIP_TIMINGS, SWING_SETS.hand);

/** A swing set's contracts. */
export function swingSetContracts(set: SwingSet): readonly HitContract[] {
  return set === 'hand' ? HAND_HITS : COMBO_HITS;
}

/**
 * The fades a hit plays with, copied from the combat feel settings on the frame it begins: the seconds it rises over
 * (the crossfade from a clip still showing, or the first hit's fade in from the idle and run) and the seconds its last
 * fade out may take, both in its clip's seconds. Read live from the settings instead, a slider moved mid-hit rescaled
 * the hit already playing, so its weight jumped on the frame of the edit (a crossfade dragged from 0.10 to 0.25 s halfway
 * through a crossfade threw the incoming hit's weight from 0.5 to 0.2 at once); copied, an edit applies from the next hit.
 */
export interface HitFades {
  rise: number;
  fadeOut: number;
}

/** The fades a hit takes on from the settings as it begins, over a clip still showing (`crossfaded`) or over the idle. */
export function hitFades(crossfaded: boolean, feel: CombatFeel): HitFades {
  return { rise: crossfaded ? feel.crossfade : feel.fadeIn, fadeOut: feel.fadeOut };
}

/** A hit's playback speed from the feel, by its place in the chain (1 plays every time as authored). */
export function hitSpeed(step: ComboStep, feel: CombatFeel): number {
  const speed = step === 1 ? feel.speed1 : step === 2 ? feel.speed2 : feel.speed3;
  return speed > 0 && Number.isFinite(speed) ? speed : 1;
}

/**
 * The clip time at which the finisher's recovery is cut: `share` (the feel's recovery cut, 0 to 1) of the way through
 * its cuttable window, or its whole length when it has none. From here he moves and turns freely and a press starts a
 * new chain.
 */
export function recoveryCut(contract: HitContract, share: number): number {
  if (contract.recoverFrom === null || contract.recoverTo === null) return contract.duration;
  const u = Math.min(1, Math.max(0, Number.isFinite(share) ? share : 1));
  return contract.recoverFrom + u * (contract.recoverTo - contract.recoverFrom);
}

/** The hit playing now. */
export interface HitPlay {
  step: ComboStep;
  /** Seconds into its clip. */
  time: number;
  /** Whether its strike moment has passed, so it strikes once however the frames fall. */
  struck: boolean;
  /** True when it took over from a clip still showing (the crossfade); false when it took over from the idle and run. */
  crossfaded: boolean;
  /** The clip time the hit before it had reached when this one began, or null when none was playing. */
  chainedAt: number | null;
  /** Its fades, fixed when it began (HitFades says why). */
  fades: HitFades;
  /** Its playback speed, fixed when it began: its clip time moves by the step times this. */
  speed: number;
  /**
   * The clip time from which the next press starts the next hit at once, a kept press starts it, and he moves and turns
   * freely: a light hit's cancel point, or the finisher's recovery cut (a new chain), fixed when it began.
   */
  opensAt: number;
  /**
   * The clip time it ends at: its length, or for a finisher with a cuttable recovery its cut plus its fade out, so the
   * clip fades back to the idle from the cut rather than playing a recovery he has already left.
   */
  endsAt: number;
}

/** A clip fading out under the hit that took over from it: a hit, or a recovery clip, and its weight then. */
export interface FadingClip {
  step: ComboStep;
  time: number;
  weight: number;
  speed: number;
  /** Whether it is the recovery clip of the hit `step` rather than that hit. */
  recovery: boolean;
}

/** A light hit's recovery clip, playing after a chain stopped there: the hit it follows, its clip time and speed. */
export interface RecoveryPlay {
  step: ComboStep;
  time: number;
  speed: number;
  /** The seconds its fade back to the idle takes at its end, copied from the hit it follows. */
  fadeOut: number;
}

export interface ComboState {
  hit: HitPlay | null;
  outgoing: FadingClip | null;
  /** The recovery clip playing after the chain stopped, or null; it plays only while no hit does. */
  recovery: RecoveryPlay | null;
  /** Whether a press is kept for the next hit, which then starts at the cancel point (or the finisher's recovery cut). */
  queued: boolean;
  /** The hit the next press starts when none is playing. */
  next: ComboStep;
  /** Seconds since the last hit ended, while none is playing. */
  sinceEnd: number;
}

export const COMBO_READY: ComboState = Object.freeze({ hit: null, outgoing: null, recovery: null, queued: false, next: 1, sinceEnd: 0 }) as ComboState;

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

export function contractOf(step: ComboStep, hits: readonly HitContract[]): HitContract {
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

export function comboPhase(state: ComboState, hits: readonly HitContract[]): ComboPhase {
  return state.hit ? hitPhase(contractOf(state.hit.step, hits), state.hit.time) : 'ready';
}

/**
 * When a press starts to count during a hit: `buffer` seconds before the clip time its next hit may start (`opensAt`:
 * a light hit's cancel point, the finisher's recovery cut), and never before its start. At the default 0.2 s a press
 * made in rhythm with the swing, anywhere from the wind-up's second half to the cancel, plays the next hit exactly at
 * the cancel point: the chain flows on presses that need no frame timing. A press before that is dropped rather than
 * held. It comes within 0.1 s of the press that began a hand-keyed hit, which is a key's bounce, a mouse's double click
 * or a mash, not a choice of the next hit, and holding it would commit him to a second hit he may not want; the buffer
 * is live in the panel. The finisher keeps one press from 0.2 s before its recovery cut, for a new chain there.
 */
export function bufferOpensAt(opensAt: number, buffer: number): number {
  return Math.max(0, opensAt - Math.max(0, buffer));
}

/** The fade step a page starts from, before its combo's clock has moved: a frame at 60 frames a second. */
export const FIRST_FADE_STEP = 1 / 60;

/** The least step the combo takes at once, in seconds (longestComboStep): a frame at 120 frames a second. */
export const COMBO_STEP_FLOOR = 1 / 120;

/**
 * The step the clips' fades read on a frame (ownWeight): the combo's own step when its clock moves, and on a held clock
 * (phase B's hit-stop, or the lab's freeze) the last step it moved by, `previous`. A page keeps the value from frame to
 * frame, from FIRST_FADE_STEP. The fades read the frame's movement step before, which is 0 whenever a hit-stop holds his
 * movement too, as it must (PlayClocks says why): a hit begun in the stop then took over from a weight read at a step
 * of 0, not the one drawn on the frame before (0.5 against 0.417 for a light hit 0.45 s in), and the pose popped.
 */
export function fadeStep(previous: number, comboStep: number): number {
  return comboStep > 0 ? comboStep : previous;
}

/**
 * A hit's own weight over the idle and run at a time into it: risen over its fades' rise (the crossfade from a clip still
 * showing, or the first hit's fade in from the idle and run), held, and faded out to 0 one frame before it ends
 * (`endsAt`, its length unless the finisher's recovery is cut), `weightStep` (the clip time the combo's clock last
 * moved by, the best guess at its next: fadeStep times the hit's speed) short of it, since the hit ends on the frame that
 * reaches its end and a fade that reached 0 only there left that last frame up to a step's share of the fade, which then
 * vanished in one frame (a quarter at SwiftShader's 0.05 s step). The last moving step, not this frame's, because the
 * hit-stop holds the combo's step at 0 while frames still draw: read at a step of 0 the fade's end jumped a frame's share
 * each time a stop began and ended. A light hit keeps its full weight until its cancel point whatever the fade out, so a
 * buffered hit always takes over from a hit at full weight and no idle shows between two hits; one with a recovery clip
 * keeps it to its very end, where the recovery takes over at full weight (the two clips meet in one pose). The finisher
 * with a cuttable recovery holds its full weight to its cut (`holdTo`) in the same way, so a new chain kept for the cut
 * crossfades from it whole.
 */
export function ownWeight(
  contract: HitContract,
  time: number,
  fades: HitFades,
  weightStep: number,
  endsAt: number = contract.duration,
  holdTo: number | null = contract.cancel,
): number {
  const step = weightStep > 0 ? weightStep : 0;
  const rise = fades.rise > 0 ? time / fades.rise : 1;
  if (contract.recovery !== null && contract.recoveryDuration !== null) return Math.min(1, Math.max(0, rise));
  const room = holdTo === null ? fades.fadeOut : Math.min(fades.fadeOut, endsAt - step - holdTo);
  const fall = (endsAt - step - time) / Math.max(1e-6, room);
  return Math.min(1, Math.max(0, Math.min(rise, fall)));
}

/**
 * A recovery clip's weight at a time into it: whole from its first frame, where it takes over from its hit's last pose,
 * and faded out to 0 one step before its end over its fade out, back to the idle and run.
 */
export function recoveryWeight(contract: HitContract, time: number, fadeOut: number, weightStep: number): number {
  const length = contract.recoveryDuration ?? 0;
  const step = weightStep > 0 ? weightStep : 0;
  return Math.min(1, Math.max(0, (length - step - time) / Math.max(1e-6, fadeOut)));
}

/** The clip time a hit holds its full weight to: a light hit's cancel point, or a cuttable finisher's recovery cut. */
function holdOf(contract: HitContract, hit: HitPlay): number | null {
  return contract.cancel ?? (contract.recoverFrom !== null ? hit.opensAt : null);
}

/** The weight a fading clip had when the hit over it began: a hit's own weight, or a recovery clip's. */
function clipWeight(state: ComboState, hits: readonly HitContract[], weightStep: number): FadingClip | null {
  if (state.hit) {
    const hit = state.hit;
    const contract = contractOf(hit.step, hits);
    return { step: hit.step, time: hit.time, speed: hit.speed, recovery: false, weight: ownWeight(contract, hit.time, hit.fades, weightStep * hit.speed, hit.endsAt, holdOf(contract, hit)) };
  }
  if (state.recovery) {
    const r = state.recovery;
    return { step: r.step, time: r.time, speed: r.speed, recovery: true, weight: recoveryWeight(contractOf(r.step, hits), r.time, r.fadeOut, weightStep * r.speed) };
  }
  return null;
}

/**
 * The weights of the hit playing, of the clip fading out under it, and of a recovery clip playing alone. The incoming
 * hit rises over its crossfade while the outgoing clip falls from the weight it had when the next began, so the two never
 * sum past 1 and, from a clip at full weight, sum to exactly 1 through the crossfade: the idle and run take only what
 * the two leave, and the pose never pops. `weightStep` is the step the combo's clock last moved by (fadeStep; ownWeight
 * says why), which each clip reads at its own speed.
 */
export function comboWeights(state: ComboState, weightStep: number, hits: readonly HitContract[]): { current: number; outgoing: number; recovery: number } {
  const { hit, outgoing, recovery } = state;
  if (!hit) {
    if (!recovery) return { current: 0, outgoing: 0, recovery: 0 };
    return { current: 0, outgoing: 0, recovery: recoveryWeight(contractOf(recovery.step, hits), recovery.time, recovery.fadeOut, weightStep * recovery.speed) };
  }
  const contract = contractOf(hit.step, hits);
  const current = ownWeight(contract, hit.time, hit.fades, weightStep * hit.speed, hit.endsAt, holdOf(contract, hit));
  const handed = hit.fades.rise > 0 ? Math.min(1, hit.time / hit.fades.rise) : 1;
  return { current, outgoing: outgoing ? outgoing.weight * (1 - handed) : 0, recovery: 0 };
}

/**
 * Begins a hit, `time` seconds into its clip, over the clip now showing (`from`, its weight then), which fades out under
 * it if it still shows. Only two clips ever show: the crossfade's 0.25 s ceiling (COMBAT_FEEL_RANGES) is under every
 * light hit's cancel point, so a hit has always finished fading in, and dropped the clip under it, by the time the next
 * can begin. The new hit takes its fades, its speed and its recovery cut from the settings now and keeps them.
 */
function startHit(step: ComboStep, time: number, from: FadingClip | null, chainedAt: number | null, feel: CombatFeel, hits: readonly HitContract[]): { hit: HitPlay; outgoing: FadingClip | null } {
  const outgoing = from && from.weight > 0 ? from : null;
  const crossfaded = outgoing !== null;
  const fades = hitFades(crossfaded, feel);
  const contract = contractOf(step, hits);
  const opensAt = contract.cancel ?? recoveryCut(contract, feel.recoveryCut);
  const endsAt = contract.finisher && contract.recoverFrom !== null ? Math.min(contract.duration, opensAt + fades.fadeOut) : contract.duration;
  return { hit: { step, time, struck: false, crossfaded, chainedAt, fades, speed: hitSpeed(step, feel), opensAt, endsAt }, outgoing };
}

/**
 * The longest clip step the combo takes at once: its earliest strike moment. A hit can begin part way into a frame (a
 * kept press at a cancel point, or a new chain at the finisher's recovery cut), carrying the frame's time past that
 * moment into it; carried as far as its own strike, it began already past it, the strike check (before the strike, then
 * at or past it) never saw it cross, and the hit never struck (a light hit carried in by a 0.25 s step began 0.20 s in,
 * on its strike). The carry is always shorter than the step, so a step no longer than the earliest strike starts every
 * hit short of its own. The pages clamp their step to 1/20 s, so this only guards a caller that does not. It is floored
 * at COMBO_STEP_FLOOR: a contract with its strike at 0 made the cap 0, and the combo then moved no time on any frame, so
 * every hit stood at its first moment for good (a unit test holds every shipped strike above 0).
 */
export function longestComboStep(hits: readonly HitContract[]): number {
  return Math.max(COMBO_STEP_FLOOR, Math.min(...hits.map((hit) => hit.strike)));
}

/** A fading clip's time moved on by a step, held at its clip's end. */
function advanceFading(clip: FadingClip, dt: number, hits: readonly HitContract[]): FadingClip {
  const contract = contractOf(clip.step, hits);
  const length = clip.recovery ? (contract.recoveryDuration ?? contract.duration) : contract.duration;
  return { ...clip, time: Math.min(length, clip.time + dt * clip.speed) };
}

/**
 * One frame of the combo: the frame's press, read against the state the frame starts from, then the frame's step.
 *
 * - With no hit playing, a press begins the next hit: attack_1, or the hit after the last if it ended less than the
 *   reset ago. A recovery clip still playing fades out under it.
 * - During a light hit, a press from the buffer's opening to the cancel point is kept, once, and the next hit begins
 *   exactly at the cancel point, the time past it carried into the new hit (in real seconds, so a hit at another speed
 *   takes the carry at its own), so the chain keeps its rhythm whatever the frame rate. A press past the cancel point
 *   begins the next hit at once, on this frame.
 * - During the finisher, a press in the buffer before its recovery cut is kept and begins a new chain at the cut; one
 *   past the cut begins it at once; one before the buffer is dropped. Three hits at most, then the finisher's recovery,
 *   cut where the feel says.
 * - A press before the buffer opens and a second press while one is kept are dropped.
 * - A press on a step of 0, a hit-stop, starts a hit at its first moment or is kept, and the time it would have moved
 *   waits for a step that moves it (the module's comment says why). One the buffer would drop for coming early is kept
 *   too. Judged at the held clip time, a press made in a light hit's stop fell before any buffer under 0.10 s and was
 *   dropped, though the player made it on contact. It is safe to keep: a stop begins on contact, inside the active
 *   frames, well after the press that began the hit, past the 0.1 s in which the buffer's early drop catches a key's
 *   bounce or a double click. In the finisher's stop such a press is kept for a new chain at its cut.
 * - A kept press survives the crossfade: it belongs to the hit that was playing when it was made, and that hit's own
 *   cancel point starts the next one, so nothing a crossfade does can lose it.
 * - Each hit strikes once, on the frame that reaches its strike moment; a step is cut to longestComboStep, so a hit
 *   carried into a frame always crosses its strike on a later one.
 * - A light hit that ends with no press kept hands over to its recovery clip, if it names one, which plays at the hit's
 *   speed until it ends or a press begins a hit over it. After a hit ends the chain waits `reset` seconds for the next
 *   press and then starts again from attack_1; after the finisher it starts again from attack_1 at once.
 *
 * `dt` is the combo's own step in real seconds, which phase B's hit-stop holds at 0 (and a NaN step moves no time
 * either, so it cannot leave a hit whose time never reaches its end); each clip's time moves by it times that clip's
 * speed. `weightStep` is the step the weights read (fadeStep: the combo's last moving step), the same as `dt` unless the
 * combo's clock is held, so a hit begun on a held frame takes over from the weight drawn on the frame before.
 */
export function stepCombo(state: ComboState, pressed: boolean, dt: number, feel: CombatFeel, weightStep: number, hits: readonly HitContract[]): ComboFrame {
  let { hit, outgoing, recovery, queued, next, sinceEnd } = state;
  let started: ComboStep | null = null;
  let struck: ComboStep | null = null;
  let press: PressResult = 'none';
  // Written as "not above 0" so that a NaN step, which compares false both ways, counts as held and moves no time.
  const held = !(dt > 0);

  if (pressed) {
    if (!hit) {
      ({ hit, outgoing } = startHit(next, 0, clipWeight(state, hits, weightStep), null, feel, hits));
      recovery = null;
      started = hit.step;
      press = 'started';
      queued = false;
    } else if (hit.time >= hit.opensAt) {
      ({ hit, outgoing } = startHit(followingStep(hit.step), 0, clipWeight(state, hits, weightStep), hit.time, feel, hits));
      started = hit.step;
      press = 'started';
      queued = false;
    } else if (!queued && (held || hit.time >= bufferOpensAt(hit.opensAt, feel.buffer))) {
      queued = true;
      press = 'queued';
    } else {
      press = 'dropped';
    }
  }

  if (held) {
    if (press === 'none' || press === 'dropped') return { state, struck: null, started: null, press };
    if (hit) sinceEnd = 0;
    return { state: { hit, outgoing, recovery, queued, next, sinceEnd }, struck: null, started, press };
  }

  if (hit) {
    const contract = contractOf(hit.step, hits);
    const before = hit.time;
    const after = before + Math.min(dt * hit.speed, longestComboStep(hits));
    if (outgoing) outgoing = advanceFading(outgoing, dt, hits);
    let hitStruck = hit.struck;
    if (!hitStruck && before < contract.strike && after >= contract.strike) {
      hitStruck = true;
      struck = hit.step;
    }
    const playing: HitPlay = { ...hit, time: after, struck: hitStruck };
    if (queued && after >= playing.opensAt) {
      // The kept press begins the next hit exactly at the opening: it starts the time past it in (that much real time,
      // at the new hit's own speed), and the hit it takes over from fades from its weight at the opening, full by
      // ownWeight's rule at a cancel point and at a recovery cut.
      const carry = (after - playing.opensAt) / playing.speed;
      const at: ComboState = { ...state, hit: { ...playing, time: playing.opensAt } };
      const nextStep = followingStep(playing.step);
      ({ hit, outgoing } = startHit(nextStep, carry * hitSpeed(nextStep, feel), clipWeight(at, hits, weightStep), playing.opensAt, feel, hits));
      outgoing = outgoing ? { ...outgoing, time: after } : null;
      started = hit.step;
      queued = false;
    } else if (after >= playing.endsAt) {
      // No press kept: the chain stops here. A light hit with a recovery clip hands over to it, the time past its end
      // carried in at its speed; the fade back to the idle then belongs to the recovery.
      hit = null;
      outgoing = null;
      next = followingStep(playing.step);
      sinceEnd = (after - playing.endsAt) / playing.speed;
      recovery =
        contract.recovery !== null && contract.recoveryDuration !== null
          ? { step: playing.step, time: after - playing.endsAt, speed: playing.speed, fadeOut: playing.fades.fadeOut }
          : null;
    } else {
      hit = playing;
    }
    if (hit && outgoing && hit.time >= hit.fades.rise) outgoing = null;
    if (hit) sinceEnd = 0;
  } else {
    sinceEnd += dt;
    if (recovery) {
      const length = contractOf(recovery.step, hits).recoveryDuration ?? 0;
      const time = recovery.time + dt * recovery.speed;
      recovery = time >= length ? null : { ...recovery, time };
    }
  }
  if (!hit && sinceEnd >= feel.reset) next = 1;
  return { state: { hit, outgoing, recovery, queued, next, sinceEnd }, struck, started, press };
}

/**
 * How the hit playing slows and turns him. A light hit keeps `moveScale` of his pace from its start to its cancel point,
 * the finisher `finisherPace` from its start to its recovery cut (the owner's rule for the last swing: "instead of
 * stopping completely, he just slows down even more so it doesn't feel too penalizing", 2026-10-05). Through the wind-up
 * his drive comes down to it at the stop rate, or faster where the stop rate would not get there by the active frames
 * (`settleBy`, stepMotion, in real seconds at the hit's speed), so the blow lands at a steady, reduced pace while his
 * legs keep running; through the active frames the pace asked stays under it, and a key let go there eases him down
 * rather than stopping him dead. His turn rate falls to `windupTurn` of its cap in a light hit's wind-up and to
 * `finisherTurn` in the finisher's, so he can still aim the blow, and his facing is locked through the active frames, so
 * the cut goes where it was aimed (Pillar 4). After them a light hit holds his facing to its cancel point, a short
 * stretch; the finisher's recovery, which runs on to its cut, gives back the wind-up's turn rate. Past the opening he
 * turns and runs freely. The finisher planted him (no pace and no turn for its whole length) until the owner's word.
 */
export function swingMotion(state: ComboState, feel: CombatFeel, hits: readonly HitContract[]): SwingMotion {
  const { hit } = state;
  if (!hit) return FREE_MOTION;
  const contract = contractOf(hit.step, hits);
  const pace = contract.finisher ? feel.finisherPace : feel.moveScale;
  const turn = contract.finisher ? feel.finisherTurn : feel.windupTurn;
  if (hit.time < contract.activeFrom) return { moveScale: pace, turnScale: turn, cap: false, settleBy: (contract.activeFrom - hit.time) / hit.speed };
  if (hit.time < contract.activeTo) return { moveScale: pace, turnScale: 0, cap: true };
  if (hit.time < hit.opensAt) return { moveScale: pace, turnScale: contract.finisher ? turn : 0, cap: false };
  return FREE_MOTION;
}

/** One half of the body's weights: the idle, the run, the clip playing and the clip fading out. */
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
 * the combo's clips (`current`, the hit or a recovery clip playing alone, and `outgoing`, the clip fading under it) at
 * their weights, over the idle and run by his speed (`run`, the run's weight against the idle). The lower body plays
 * them only in the idle's place: the run keeps its share, each clip takes its weight times the idle's share, (1 - run),
 * and the idle the rest of that share. Standing, the whole body swings, the hips' coil and the stance included; moving,
 * the legs keep the run cycle under the swinging arms. Every clip is layered so, the finisher and the recovery clips
 * included: the finisher played on his whole body while it planted him, and now that it only slows him (finisherPace)
 * his legs keep walking under it.
 */
export function bodyWeights(run: number, current: number, outgoing: number): { upper: LayerWeights; lower: LayerWeights } {
  const r = Math.min(1, Math.max(0, run));
  const total = current + outgoing;
  const attack = Math.min(1, total);
  // The two clips never sum past 1 (comboWeights); scaled down if rounding takes them past it, so the idle never goes
  // negative on the legs.
  const k = total > 1 ? 1 / total : 1;
  return {
    upper: { idle: (1 - r) * (1 - attack), run: r * (1 - attack), current, outgoing },
    lower: { idle: (1 - r) * Math.max(0, 1 - k * total), run: r, current: k * current * (1 - r), outgoing: k * outgoing * (1 - r) },
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
 * The second hit's placeholder plays the source cleave backward, as a rising backhand: from the follow-through
 * (BACKHAND_FROM_AFTER_STRIKE past the source's strike), up through the cut, whose fastest moment it strikes at
 * (BACKHAND_STRIKE_BEFORE_STRIKE before the source's strike), to the coil above his right shoulder
 * (BACKHAND_TO_BEFORE_STRIKE before it). The source cleave snaps its sword hand up in one frame (0.067 to 0.1 s), holds
 * the coil to 0.267 s, cuts down by 0.333 s at up to 27 m/s, and holds the follow-through in front until 0.63 s. Played
 * backward with its strike on the source's own 0.34 s, the end of the cut, the backhand struck before its blade moved
 * and rose only after; on 0.30 s, the middle of the cut, the blade passes in front at speed on the strike. Its first pose
 * stands within 7 cm of the first hit's sword hand at its cancel point, both in the follow-through, so the crossfade
 * barely moves the sword, and the cut down and the cut back up read as two blows, where a second forward cleave read as
 * the first one again. Mirroring was not used: the sword is in his right hand and the shield in his left, so a mirrored
 * cleave swings the shield.
 */
export const BACKHAND_FROM_AFTER_STRIKE = 0.26;
export const BACKHAND_STRIKE_BEFORE_STRIKE = 0.04;
export const BACKHAND_TO_BEFORE_STRIKE = 0.22;
/**
 * The finisher's placeholder starts this long before the source's strike, in the held coil just after the snap up,
 * where the backhand ends, so the chain goes from the backhand's coil straight into a long, still wind-up and the
 * cleave. Started from the source's first frame, it dropped the sword from the coil to the guard over the crossfade only
 * to snap it back up 0.1 s later.
 */
export const FINISHER_FROM_BEFORE_STRIKE = 0.21;

/**
 * The anchors a placeholder hit is time-warped from the source attack clip by: piecewise-linear through the hit's start,
 * its strike and its end, so the source's strike lands exactly at the hit's contract strike, where a uniform scale of the
 * 0.833 s cleave to 0.55 s would put its 0.34 s strike at 0.22 s instead of 0.20 s, and to 0.85 s at 0.35 s instead of
 * 0.38 s. The first hit plays the whole cleave forward, the second a stretch of it backward, and the finisher the cleave
 * from its coil, each by its place in the chain; every source time is clamped into the source clip.
 */
export function placeholderAnchors(contract: HitContract, sourceDuration: number, sourceStrike: number): WarpAnchors {
  const at = (time: number): number => Math.min(sourceDuration, Math.max(0, time));
  if (contract.step === 2) {
    return [
      [0, at(sourceStrike + BACKHAND_FROM_AFTER_STRIKE)],
      [contract.strike, at(sourceStrike - BACKHAND_STRIKE_BEFORE_STRIKE)],
      [contract.duration, at(sourceStrike - BACKHAND_TO_BEFORE_STRIKE)],
    ];
  }
  return [
    [0, contract.step === 3 ? at(sourceStrike - FINISHER_FROM_BEFORE_STRIKE) : 0],
    [contract.strike, at(sourceStrike)],
    [contract.duration, at(sourceDuration)],
  ];
}
