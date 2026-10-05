/**
 * The combat feel numbers of Play Pip (prototype), the Asset World's lab for trying the commander's combat, kept in one
 * settings object so the panel's "combat feel" folder, the address's `?feel=` and the play code all read one source.
 * Each number has a row in the blueprint (Numbers, Asset World layout). The combo's clip contracts (each hit's length,
 * strike and cancel point) are not here: they belong to the clips, in combo.ts, whose lengths and strikes come from
 * src/shared/timings.json.
 *
 * Phase B of the combat feel research adds its impact numbers (hit-stop length, lunge distance, shake strength, trail
 * length) as further keys of CombatFeel, DEFAULT_COMBAT_FEEL and COMBAT_FEEL_RANGES; the folder, the readout, the copy
 * button and the address parameter all follow those three tables, so nothing else needs to change for them.
 */

export interface CombatFeel {
  /** Seconds one hit of the chain crossfades into the next. */
  crossfade: number;
  /** Seconds the first hit of a chain takes to take over from the idle and run. */
  fadeIn: number;
  /** Seconds the last hit of a chain takes to hand back to the idle and run. */
  fadeOut: number;
  /** Seconds before a hit's cancel point (the finisher's end) from which a press is kept for the next hit. */
  buffer: number;
  /** Seconds after a hit ends, with no press, before the chain starts again from its first hit. */
  reset: number;
  /** The share of his pace he keeps from a light hit's start to its cancel point. */
  moveScale: number;
  /** The share of his turn rate he keeps during a light hit's wind-up. */
  windupTurn: number;
}

/** The defaults, the one place they are set. Frozen so a slider writes a copy, never these. */
export const DEFAULT_COMBAT_FEEL: Readonly<CombatFeel> = Object.freeze({
  crossfade: 0.1,
  fadeIn: 0.07,
  fadeOut: 0.2,
  buffer: 0.2,
  reset: 0.3,
  moveScale: 0.4,
  windupTurn: 0.5,
});

/** A setting's slider: its least and greatest value, its step and its name in the panel. */
export interface FeelRange {
  min: number;
  max: number;
  step: number;
  label: string;
}

/**
 * Each setting's slider, in the order the folder shows them. The ranges also bound what `?feel=` may set. The crossfade
 * stops at 0.25 s, under the light hits' 0.30 s cancel point, so a hit has always finished fading in by the time the next
 * one can take over from it, and no more than two hits ever show at once (combo.ts, startHit).
 */
export const COMBAT_FEEL_RANGES: { readonly [K in keyof CombatFeel]: FeelRange } = {
  crossfade: { min: 0.02, max: 0.25, step: 0.01, label: 'crossfade between hits (s)' },
  fadeIn: { min: 0.02, max: 0.15, step: 0.01, label: 'first hit fade in (s)' },
  fadeOut: { min: 0.05, max: 0.4, step: 0.01, label: 'last hit fade out (s)' },
  buffer: { min: 0, max: 0.3, step: 0.01, label: 'press buffer before cancel (s)' },
  reset: { min: 0, max: 1, step: 0.05, label: 'chain reset after a hit (s)' },
  moveScale: { min: 0, max: 1, step: 0.05, label: 'pace kept in a light hit' },
  windupTurn: { min: 0, max: 1, step: 0.05, label: 'turn rate kept in the wind-up' },
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
  const out: Record<string, number> = {};
  for (const key of COMBAT_FEEL_KEYS) out[key] = Number(feel[key].toFixed(decimals(COMBAT_FEEL_RANGES[key].step)));
  return JSON.stringify(out);
}

/** Whether a value may be given to a setting: a finite number within its slider's range. */
export function acceptFeel(key: string, value: unknown): key is keyof CombatFeel {
  if (!Object.prototype.hasOwnProperty.call(COMBAT_FEEL_RANGES, key)) return false;
  const range = COMBAT_FEEL_RANGES[key as keyof CombatFeel];
  return typeof value === 'number' && Number.isFinite(value) && value >= range.min && value <= range.max;
}

/** A value put on its slider's nearest step, from the slider's least value, written to the step's decimals. */
export function snapFeel(key: keyof CombatFeel, value: number): number {
  const range = COMBAT_FEEL_RANGES[key];
  const snapped = range.min + Math.round((value - range.min) / range.step) * range.step;
  return Number(Math.min(range.max, Math.max(range.min, snapped)).toFixed(decimals(range.step)));
}

/**
 * Reads pasted settings, such as the readout's JSON: every key it names that is a setting, with a number within that
 * setting's range, is taken, put on its slider's step, and each other key, or a value out of range, is named in
 * `rejected`. Text that is not a JSON object takes nothing and is named as a whole, so a mistyped address opens the
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
    if (acceptFeel(key, value)) feel[key] = snapFeel(key, value as number);
    else rejected.push(key);
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
