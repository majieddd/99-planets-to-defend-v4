/**
 * The combat feel numbers of Play Pip (prototype), the Asset World's lab for trying the commander's combat, kept in one
 * settings object so the panel's "combat feel" folder, the address's `?feel=` and the play code all read one source.
 * Each number has a row in the blueprint (Numbers, Asset World layout). The combo's clip contracts (each hit's length,
 * strike and cancel point) are not here: they belong to the clips, in combo.ts, whose lengths and strikes come from
 * src/shared/timings.json.
 *
 * Phase B of the combat feel research added its impact numbers (the hit-stops, the lunges and their target assist, the
 * sword trail, the camera shake and the knockbacks) as further keys of CombatFeel, DEFAULT_COMBAT_FEEL and
 * COMBAT_FEEL_RANGES; the folder, the readout, the copy button and the address parameter follow those three tables, so
 * nothing else changed for them. The hit-stops' defaults are the blueprint's (Numbers, Combat feel: 55 ms and 90 ms);
 * the rest are lab numbers with rows of their own (Numbers, Combat arena).
 *
 * Phase C added the swing set (a choice between the Quaternius hits and the hand-keyed ones), each hit's playback speed,
 * the finisher's pace, turn and recovery cut, and how long the guard stays up after a hit, the same way.
 */
import { DEFAULT_SWING_SET, type SwingSet } from './combo';

export interface CombatFeel {
  /** Which swing set the combo plays: Quaternius's retargeted sword combo, or the hand-keyed hits (combo.ts, SWING_SETS). */
  swingSet: SwingSet;
  /** Seconds one hit of the chain crossfades into the next. */
  crossfade: number;
  /** Seconds the first hit of a chain takes to take over from the idle and run. */
  fadeIn: number;
  /** Seconds the last hit of a chain takes to hand back to the idle and run. */
  fadeOut: number;
  /**
   * Seconds a restarted chain's first hit blends in over, eased: begun over the finisher, over a recovery clip or from
   * the guard idle (combo.ts, restartFades), and never past that hit's active frames.
   */
  restartBlend: number;
  /** Seconds before a hit's cancel point (the finisher's end) from which a press is kept for the next hit. */
  buffer: number;
  /** Seconds after a hit ends, with no press, before the chain starts again from its first hit. */
  reset: number;
  /** The share of his pace he keeps from a light hit's start to its cancel point. */
  moveScale: number;
  /** The share of his turn rate he keeps during a light hit's wind-up. */
  windupTurn: number;
  /** The share of his pace he keeps from the finisher's start to its recovery cut. */
  finisherPace: number;
  /** The share of his turn rate he keeps during the finisher's wind-up and its recovery up to the cut. */
  finisherTurn: number;
  /**
   * Where the finisher's recovery is cut, as a share of its cuttable window (0 its start, 1 its end): from there he moves
   * and turns freely and a press starts a new chain. A finisher with no window plays its recovery out.
   */
  recoveryCut: number;
  /** Each hit's playback speed, the first, the second and the finisher: its clip time moves by the step times this. */
  speed1: number;
  speed2: number;
  speed3: number;
  /** Seconds the guard stays up after a hit or a recovery ends, or after a target was last near, before the relaxed idle. */
  guardHold: number;
  /** Seconds a light hit's contact holds his clips, his movement and the struck dummy, while the view goes on. */
  hitStopLight: number;
  /** Seconds the finisher's contact holds them. */
  hitStopFinisher: number;
  /** Metres a light hit's lunge carries him forward around its strike. */
  lungeLight: number;
  /** Metres the finisher's lunge carries him. */
  lungeFinisher: number;
  /** The most a lunge turns him toward a target ahead, in degrees; 0 turns the target assist off. */
  assistTurn: number;
  /** Seconds of the blade's arc the sword trail keeps behind the blade. */
  trailLength: number;
  /** Seconds the sword trail takes to fade once it stops taking samples, in the early recovery. */
  trailFade: number;
  /** The share of the blade, from its tip inward, the sword trail's crescent covers where the blade is. */
  trailWidth: number;
  /** The sword trail's brightness, a multiple of its emissive keys. */
  trailBrightness: number;
  /** The camera shake's strength on contact, as a multiple of its authored amplitude (0 turns it off). */
  shake: number;
  /** Metres a light hit knocks a dummy back. */
  knockbackLight: number;
  /** Metres the finisher knocks a dummy back. */
  knockbackFinisher: number;
  /** Whether the combat sounds are off: their gain at 0 and the audio context suspended (labs/shared/combatSound.ts). */
  mute: boolean;
  /** The combat sounds' master volume, from 0 to 1. */
  volume: number;
}

/** The defaults, the one place they are set. Frozen so a slider writes a copy, never these. */
export const DEFAULT_COMBAT_FEEL: Readonly<CombatFeel> = Object.freeze({
  swingSet: DEFAULT_SWING_SET,
  crossfade: 0.1,
  fadeIn: 0.07,
  fadeOut: 0.2,
  restartBlend: 0.2,
  buffer: 0.2,
  reset: 0.3,
  moveScale: 0.4,
  windupTurn: 0.5,
  finisherPace: 0.15,
  finisherTurn: 0.25,
  recoveryCut: 0.4,
  speed1: 1,
  speed2: 1,
  speed3: 1,
  guardHold: 3,
  hitStopLight: 0.055,
  hitStopFinisher: 0.09,
  lungeLight: 0.35,
  lungeFinisher: 0.55,
  assistTurn: 15,
  trailLength: 0.16,
  trailFade: 0.12,
  trailWidth: 0.85,
  trailBrightness: 1,
  shake: 1,
  knockbackLight: 0.25,
  knockbackFinisher: 0.6,
  mute: false,
  volume: 0.7,
});

/** A setting's slider: its least and greatest value, its step and its name in the panel. */
export interface FeelRange {
  min: number;
  max: number;
  step: number;
  label: string;
}

/** A setting's checkbox: its name in the panel. A toggle takes true or false, in the panel and in `?feel=` alike. */
export interface FeelToggle {
  toggle: true;
  label: string;
}

/**
 * A setting's dropdown: each choice's name in the panel and the value it stands for, and the setting's name. A choice
 * takes one of the values, in the panel and in `?feel=` alike.
 */
export interface FeelChoice {
  choices: Readonly<Record<string, string>>;
  label: string;
}

/** Any setting's control: a slider, a checkbox or a dropdown. */
export type FeelControl = FeelRange | FeelToggle | FeelChoice;

/** The settings that are numbers, each with a slider. */
export type NumericFeelKey = { [K in keyof CombatFeel]: CombatFeel[K] extends number ? K : never }[keyof CombatFeel];

/** Whether a setting is a toggle (a checkbox) rather than a number on a slider. */
export function isFeelToggle(control: FeelControl): control is FeelToggle {
  return 'toggle' in control;
}

/** Whether a setting is a choice (a dropdown). */
export function isFeelChoice(control: FeelControl): control is FeelChoice {
  return 'choices' in control;
}

/**
 * Each setting's control, in the order the folder shows them. The ranges also bound what `?feel=` may set. The crossfade
 * stops at 0.25 s, under every light hit's cancel point (0.367 s for the Quaternius hits, 0.30 s for the hand-keyed ones,
 * in clip seconds as the fades are), so a hit has always finished fading in by the time the next one can take over from
 * it, and no more than two clips ever show at once (combo.ts, startHit). The restart blend stops at 0.25 s for the same
 * reason: a restart enters the forehand at most 0.087 s in (restart.ts, RESTART_SEARCH_SHARE), and 0.367 - 0.087 s is
 * still over 0.25 s. The playback speeds run from 0.8 to 1.6: the Quaternius hits strike in a chain at 0.27, 0.63 and
 * 1.40 s against the hand-keyed 0.20, 0.50 and 0.98 s, and 1.6 brings their finisher's 0.67 s wind-up near the hand-keyed
 * one's 0.38 s.
 */
export const COMBAT_FEEL_RANGES: {
  readonly [K in keyof CombatFeel]: CombatFeel[K] extends boolean ? FeelToggle : CombatFeel[K] extends string ? FeelChoice : FeelRange;
} = {
  swingSet: { choices: { quaternius: 'quaternius', 'hand-keyed': 'hand' }, label: 'swing set' },
  crossfade: { min: 0.02, max: 0.25, step: 0.01, label: 'crossfade between hits (s)' },
  fadeIn: { min: 0.02, max: 0.15, step: 0.01, label: 'first hit fade in (s)' },
  fadeOut: { min: 0.05, max: 0.4, step: 0.01, label: 'last hit fade out (s)' },
  restartBlend: { min: 0.05, max: 0.25, step: 0.01, label: 'restart blend into hit 1 (s)' },
  buffer: { min: 0, max: 0.3, step: 0.01, label: 'press buffer before cancel (s)' },
  reset: { min: 0, max: 1, step: 0.05, label: 'chain reset after a hit (s)' },
  moveScale: { min: 0, max: 1, step: 0.05, label: 'pace kept in a light hit' },
  windupTurn: { min: 0, max: 1, step: 0.05, label: 'turn rate kept in the wind-up' },
  finisherPace: { min: 0, max: 1, step: 0.05, label: 'finisher pace kept' },
  finisherTurn: { min: 0, max: 1, step: 0.05, label: 'finisher wind-up turn' },
  recoveryCut: { min: 0, max: 1, step: 0.05, label: 'finisher recovery cut (share of its window)' },
  speed1: { min: 0.8, max: 1.6, step: 0.05, label: 'hit 1 playback speed' },
  speed2: { min: 0.8, max: 1.6, step: 0.05, label: 'hit 2 playback speed' },
  speed3: { min: 0.8, max: 1.6, step: 0.05, label: 'finisher playback speed' },
  guardHold: { min: 0, max: 10, step: 0.5, label: 'guard held after combat (s)' },
  hitStopLight: { min: 0, max: 0.15, step: 0.005, label: 'hit-stop on a light hit (s)' },
  hitStopFinisher: { min: 0, max: 0.2, step: 0.005, label: 'hit-stop on the finisher (s)' },
  lungeLight: { min: 0, max: 0.8, step: 0.05, label: 'lunge on a light hit (m)' },
  lungeFinisher: { min: 0, max: 1.2, step: 0.05, label: 'lunge on the finisher (m)' },
  assistTurn: { min: 0, max: 45, step: 1, label: 'lunge turn toward a target (degrees)' },
  trailLength: { min: 0.02, max: 0.2, step: 0.01, label: 'sword trail length (s)' },
  trailFade: { min: 0.03, max: 0.3, step: 0.01, label: 'sword trail fade (s)' },
  trailWidth: { min: 0.2, max: 1, step: 0.05, label: 'sword trail width (share of the blade)' },
  trailBrightness: { min: 0, max: 2, step: 0.05, label: 'sword trail brightness' },
  shake: { min: 0, max: 2, step: 0.05, label: 'camera shake strength' },
  knockbackLight: { min: 0, max: 1, step: 0.05, label: 'knockback on a light hit (m)' },
  knockbackFinisher: { min: 0, max: 1.5, step: 0.05, label: 'knockback on the finisher (m)' },
  mute: { toggle: true, label: 'mute the combat sounds' },
  volume: { min: 0, max: 1, step: 0.05, label: 'combat sound volume' },
};

/**
 * The settings in the folder's order, read from COMBAT_FEEL_RANGES, which sets that order. They were read from the
 * defaults, whose order only happened to match, so a setting added to the two tables in different places would have
 * shown in one order in the folder and copied in another.
 */
export const COMBAT_FEEL_KEYS = Object.keys(COMBAT_FEEL_RANGES) as (keyof CombatFeel)[];

/** A fresh, writable copy of the defaults. */
export function defaultCombatFeel(): CombatFeel {
  return { ...DEFAULT_COMBAT_FEEL };
}

/** The decimals a setting's step shows, so the readout says 0.1 rather than 0.10000000000000002. */
function decimals(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

/**
 * The settings as compact JSON, in the folder's order and rounded to each slider's step, which the owner copies from the
 * panel and pastes back to us, and which `?feel=` takes in return.
 */
export function combatFeelJson(feel: CombatFeel): string {
  const out: Record<string, number | boolean | string> = {};
  for (const key of COMBAT_FEEL_KEYS) {
    const control: FeelControl = COMBAT_FEEL_RANGES[key];
    const value = feel[key];
    if (isFeelToggle(control)) out[key] = Boolean(value);
    else if (isFeelChoice(control)) out[key] = String(value);
    else out[key] = Number((value as number).toFixed(decimals(control.step)));
  }
  return JSON.stringify(out);
}

/**
 * Whether a value may be given to a setting: true or false for a toggle, one of its values for a choice, a finite number
 * within range for a slider.
 */
export function acceptFeel(key: string, value: unknown): key is keyof CombatFeel {
  if (!Object.prototype.hasOwnProperty.call(COMBAT_FEEL_RANGES, key)) return false;
  const control: FeelControl = COMBAT_FEEL_RANGES[key as keyof CombatFeel];
  if (isFeelToggle(control)) return typeof value === 'boolean';
  if (isFeelChoice(control)) return typeof value === 'string' && Object.values(control.choices).includes(value);
  return typeof value === 'number' && Number.isFinite(value) && value >= control.min && value <= control.max;
}

/** A value put on its slider's nearest step, from the slider's least value, written to the step's decimals. */
export function snapFeel(key: NumericFeelKey, value: number): number {
  const range = COMBAT_FEEL_RANGES[key];
  const snapped = range.min + Math.round((value - range.min) / range.step) * range.step;
  return Number(Math.min(range.max, Math.max(range.min, snapped)).toFixed(decimals(range.step)));
}

/**
 * Reads pasted settings, such as the readout's JSON: every key it names that is a setting, with a number within that
 * setting's range, is taken, put on its slider's step; a toggle takes true or false and a choice one of its values, as
 * given; and each other key, or a value out of range or of the wrong kind (a number for a toggle, a word a choice does
 * not offer), is named in `rejected`. Text that is not a JSON object takes nothing and is named as a whole, so a mistyped address opens the
 * defaults rather than a broken feel. A value between two steps used to be taken as it was, so the slider, which can
 * show only its steps, drew one value while the play code read another (`?feel={"crossfade":0.123}` played 0.123 s
 * under a slider at 0.12).
 */
export function parseCombatFeel(text: string): { feel: Partial<CombatFeel>; rejected: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { feel: {}, rejected: ['the settings (not JSON)'] };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { feel: {}, rejected: ['the settings (not a JSON object)'] };
  const feel: Partial<CombatFeel> = {};
  const rejected: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (!acceptFeel(key, value)) rejected.push(key);
    else if (typeof value === 'boolean') (feel as Record<string, boolean>)[key] = value;
    else if (typeof value === 'string') (feel as Record<string, string>)[key] = value;
    else (feel as Record<string, number>)[key] = snapFeel(key as NumericFeelKey, value as number);
  }
  return { feel, rejected };
}

/**
 * A page's combat feel as its address opens it: the defaults, with any settings `?feel=` carries (the panel's readout
 * JSON) over them, each on its slider's step. A key that is not a setting, or a value outside its slider's range, is
 * skipped and `report` is told, in a sentence naming what was skipped and the settings used, which the page puts in its
 * console and its banner. Both pages read the address alike, and each had its own copy of these lines.
 */
export function feelFromAddress(params: { get(name: string): string | null }, report: (said: string) => void): CombatFeel {
  const feel = defaultCombatFeel();
  const text = params.get('feel');
  if (!text) return feel;
  const pasted = parseCombatFeel(text);
  Object.assign(feel, pasted.feel);
  if (pasted.rejected.length) report(`Combat feel: skipped ${pasted.rejected.join(', ')} in the address; using ${combatFeelJson(feel)}`);
  return feel;
}

/**
 * What the address's `feel` parameter should hold for the settings: their compact JSON, or null when every one stands
 * at its default, so the address names only a feel that was changed. The pages rewrite the parameter whenever a setting
 * moves; read once at load and never written, it kept the opening settings after the sliders moved, so a reload or a
 * copied address brought back the old feel.
 */
export function feelAddressValue(feel: CombatFeel): string | null {
  const json = combatFeelJson(feel);
  return json === combatFeelJson(DEFAULT_COMBAT_FEEL) ? null : json;
}
