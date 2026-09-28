import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIALS, type RenderDials } from '../../../src/render/defaults';
import { acceptDial, decodeDials, encodeDials } from '../../../src/render/dialsCodec';
import { GOLDEN_HOUR_B3, GOLDEN_HOUR_B3_CHANGES } from '../../../src/render/presets';

/** The JSON the blueprint's Render defaults row "Golden-hour preset B3" carries in its value cell. */
function blueprintB3(): Record<string, unknown> {
  const blueprint = readFileSync('docs/blueprint.md', 'utf8');
  const row = blueprint.split(/\r?\n/).find((line) => line.startsWith('| Golden-hour preset B3 |'));
  if (!row) throw new Error('docs/blueprint.md has no Render defaults row named "Golden-hour preset B3"');
  const json = /^\| Golden-hour preset B3 \| `([^`]+)` \|/.exec(row)?.[1];
  if (!json) throw new Error('the blueprint row "Golden-hour preset B3" does not open its value cell with the JSON in backticks');
  return JSON.parse(json) as Record<string, unknown>;
}

describe('golden-hour preset B3', () => {
  it('names in code exactly the dials the blueprint row names, at the same values', () => {
    expect({ ...GOLDEN_HOUR_B3_CHANGES }).toEqual(blueprintB3());
  });

  it('is every dial a link could carry, and each value is one a link would accept', () => {
    for (const [key, value] of Object.entries(GOLDEN_HOUR_B3_CHANGES)) expect(acceptDial(key, value), key).toBe(true);
  });

  it('keeps every dial it does not name at its start, as a decoded dials link does', () => {
    const decoded = decodeDials(encodeDials(GOLDEN_HOUR_B3 as RenderDials));
    expect(decoded).toEqual(GOLDEN_HOUR_B3);
    for (const key of Object.keys(DEFAULT_DIALS) as (keyof RenderDials)[]) {
      if (!(key in GOLDEN_HOUR_B3_CHANGES)) expect(GOLDEN_HOUR_B3[key], key).toBe(DEFAULT_DIALS[key]);
    }
  });

  it('carries no film grain, the owner turned it off at the gate', () => {
    expect(GOLDEN_HOUR_B3.grain).toBe(0);
    expect(GOLDEN_HOUR_B3_CHANGES.grain).toBe(0);
  });
});
