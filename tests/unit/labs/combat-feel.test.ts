import { describe, expect, it } from 'vitest';
import {
  COMBAT_FEEL_KEYS,
  COMBAT_FEEL_RANGES,
  combatFeelJson,
  DEFAULT_COMBAT_FEEL,
  defaultCombatFeel,
  feelAddressValue,
  feelFromAddress,
  parseCombatFeel,
  snapFeel,
} from '../../../src/labs/world/combatFeel';
import { frameStep, MAX_FRAME_STEP, WORLD_FOV_DEG } from '../../../src/labs/shared/paintedStage';
import { createPointerMark } from '../../../src/labs/world/panel';

describe('the combat feel settings', () => {
  it("follow the ranges' order, which the folder shows, and hold every default inside its range on a step", () => {
    expect(COMBAT_FEEL_KEYS).toEqual(Object.keys(COMBAT_FEEL_RANGES));
    expect([...COMBAT_FEEL_KEYS].sort()).toEqual(Object.keys(DEFAULT_COMBAT_FEEL).sort());
    for (const key of COMBAT_FEEL_KEYS) {
      const range = COMBAT_FEEL_RANGES[key];
      expect(DEFAULT_COMBAT_FEEL[key], key).toBeGreaterThanOrEqual(range.min);
      expect(DEFAULT_COMBAT_FEEL[key], key).toBeLessThanOrEqual(range.max);
      expect(snapFeel(key, DEFAULT_COMBAT_FEEL[key]), key).toBe(DEFAULT_COMBAT_FEEL[key]);
    }
    // The copied JSON names the settings in the same order.
    expect(Object.keys(JSON.parse(combatFeelJson(defaultCombatFeel())) as object)).toEqual(COMBAT_FEEL_KEYS);
  });

  it('puts a pasted value on its slider\'s step, so the slider shows the value the play code reads', () => {
    const { feel, rejected } = parseCombatFeel('{"crossfade":0.123,"reset":0.33,"moveScale":0.41,"buffer":0.3}');
    expect(rejected).toEqual([]);
    expect(feel).toEqual({ crossfade: 0.12, reset: 0.35, moveScale: 0.4, buffer: 0.3 });
    // Out of range, not a setting, or not a number: named and skipped, as before.
    expect(parseCombatFeel('{"crossfade":0.9,"lunge":1,"fadeIn":"0.05"}')).toEqual({ feel: {}, rejected: ['crossfade', 'lunge', 'fadeIn'] });
    expect(parseCombatFeel('not json').rejected).toEqual(['the settings (not JSON)']);
  });

  it('writes the address parameter only for a changed feel, as the compact JSON the copy button copies', () => {
    expect(feelAddressValue(defaultCombatFeel())).toBeNull();
    const moved = { ...defaultCombatFeel(), crossfade: 0.15 };
    expect(feelAddressValue(moved)).toBe(combatFeelJson(moved));
    // A value a hair off its default, which the readout rounds to the default, still counts as the default.
    expect(feelAddressValue({ ...defaultCombatFeel(), crossfade: DEFAULT_COMBAT_FEEL.crossfade + 1e-12 })).toBeNull();
    // What the address carries reads back as the same settings.
    expect({ ...defaultCombatFeel(), ...parseCombatFeel(feelAddressValue(moved)!).feel }).toEqual(moved);
  });
});

describe("a page's combat feel from its address", () => {
  it('takes the defaults, puts what `?feel=` carries over them, and reports only what it skipped', () => {
    const said: string[] = [];
    const report = (text: string): number => said.push(text);
    expect(feelFromAddress(new URLSearchParams(''), report)).toEqual(defaultCombatFeel());
    expect(feelFromAddress(new URLSearchParams({ feel: '{"crossfade":0.15}' }), report)).toEqual({ ...defaultCombatFeel(), crossfade: 0.15 });
    expect(said).toEqual([]);
    // A key that is no setting is skipped and reported with the settings used, which both pages put in their console
    // and banner.
    const feel = feelFromAddress(new URLSearchParams({ feel: '{"crossfade":0.15,"lunge":1}' }), report);
    expect(feel).toEqual({ ...defaultCombatFeel(), crossfade: 0.15 });
    expect(said).toEqual([`Combat feel: skipped lunge in the address; using ${combatFeelJson(feel)}`]);
  });
});

describe("the panel's pointer mark (labs/world/panel.ts, handFocusBack)", () => {
  // Stand-ins for the panel's elements: a control holds what a press landed on when the press landed inside it.
  const checkbox = { inside: new Set(['checkbox', 'checkbox label']) };
  const holds = (control: { inside: Set<string> }) => (pressed: unknown) => control.inside.has(pressed as string);

  it('counts a change as the pointer\'s only when the control that changed holds what the press landed on, once', () => {
    const mark = createPointerMark();
    // No press: a screen reader's activation keeps its place.
    expect(mark.take(holds(checkbox))).toBe(false);
    // A press on the checkbox's label, then its change: the pointer's.
    mark.press('checkbox label');
    expect(mark.take(holds(checkbox))).toBe(true);
    // The mark served that one change: the next change, with no press before it, is not the pointer's.
    expect(mark.take(holds(checkbox))).toBe(false);
    // A press on the panel's title, then a change of the checkbox: not the pointer's, where any press used to mark any
    // change and blurred a screen reader's checkbox.
    mark.press('title');
    expect(mark.take(holds(checkbox))).toBe(false);
    // A key between the press and the change, or the focus leaving the panel, clears the mark.
    mark.press('checkbox');
    mark.clear();
    expect(mark.take(holds(checkbox))).toBe(false);
    // A press on nothing marks nothing.
    mark.press(null);
    expect(mark.take(() => true)).toBe(false);
  });
});

describe("the labs' frame step (labs/shared/paintedStage.ts)", () => {
  it('moves the scene by the frame interval up to 1/20 s, and not at all while frozen', () => {
    expect(MAX_FRAME_STEP).toBe(1 / 20);
    expect(frameStep(16, false)).toBeCloseTo(0.016, 12);
    // A stall moves the scene one clamped step rather than jumping it.
    expect(frameStep(2000, false)).toBe(MAX_FRAME_STEP);
    expect(frameStep(16, true)).toBe(0);
    expect(WORLD_FOV_DEG).toBe(50);
  });
});
