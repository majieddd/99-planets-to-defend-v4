import { describe, expect, it } from 'vitest';
import {
  COMBAT_FEEL_KEYS,
  COMBAT_FEEL_RANGES,
  combatFeelJson,
  DEFAULT_COMBAT_FEEL,
  defaultCombatFeel,
  feelAddressValue,
  parseCombatFeel,
  snapFeel,
} from '../../../src/labs/world/combatFeel';

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
