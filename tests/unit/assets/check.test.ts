import { describe, expect, it } from 'vitest';
import { evaluateAsset } from '../../../tools/assets/check.mjs';

const budgets = {
  xeno: { tris: 9000, bones: 24, texture: 1024, ink: true, animations: ['idle', 'walk', 'attack'] },
};
const timings = { xeno: { husk: { attack: { duration: 1.4, strike: 0.4 } } } };

function husk(overrides: Record<string, unknown> = {}) {
  return {
    name: 'husk',
    family: 'xeno',
    kind: 'model',
    file: 'xeno/husk.glb',
    tris: 5000,
    bones: 17,
    hasInk: true,
    textures: [{ width: 1024, height: 1024 }],
    animations: [
      { name: 'idle', duration: 2, loop: true, strike: null, exportedDuration: 2 },
      { name: 'walk', duration: 1, loop: true, strike: null, exportedDuration: 1 },
      { name: 'attack', duration: 1.4, loop: false, strike: 0.4, exportedDuration: 1.4 },
    ],
    ...overrides,
  };
}

describe('evaluateAsset', () => {
  it('passes an asset inside every budget', () => {
    expect(evaluateAsset(husk(), budgets, timings)).toEqual([]);
  });

  it('reports each broken budget', () => {
    const failures = evaluateAsset(
      husk({ tris: 9001, bones: 30, hasInk: false, textures: [{ width: 2048, height: 2048 }] }),
      budgets,
      timings,
    );
    expect(failures).toEqual([
      'tris 9001 > 9000',
      'bones 30 > 24',
      'texture 2048x2048 > 1024',
      'missing _INK attribute',
    ]);
  });

  it('reports a missing animation and a strike more than a frame off', () => {
    const entry = husk();
    entry.animations = entry.animations
      .filter((a) => a.name !== 'walk')
      .map((a) => (a.name === 'attack' ? { ...a, strike: 0.5 } : a));
    const failures = evaluateAsset(entry, budgets, timings);
    expect(failures).toContain("missing animation 'walk'");
    expect(failures.some((f) => f.startsWith('attack strike 0.5'))).toBe(true);
  });

  it('accepts a strike within one frame', () => {
    const entry = husk();
    entry.animations = entry.animations.map((a) => (a.name === 'attack' ? { ...a, strike: 0.42 } : a));
    expect(evaluateAsset(entry, budgets, timings)).toEqual([]);
  });

  it('skips textures and flags unknown families', () => {
    expect(evaluateAsset({ ...husk(), kind: 'texture' }, budgets, timings)).toEqual([]);
    expect(evaluateAsset({ ...husk(), family: 'nope' }, budgets, timings)).toEqual(["no budget for family 'nope'"]);
  });
});
