import { describe, expect, it } from 'vitest';
import { evaluateAsset, fileFailures, pendingClips, stalePending } from '../../../tools/assets/check.mjs';

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
    ground: [{ node: null, minY: -0.0024, sink: 0 }],
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

  it('fails a double-sided material', () => {
    expect(evaluateAsset(husk({ doubleSided: true }), budgets, timings)).toEqual(['double-sided material']);
  });

  it('skips textures and flags unknown families', () => {
    expect(evaluateAsset({ ...husk(), kind: 'texture' }, budgets, timings)).toEqual([]);
    expect(evaluateAsset({ ...husk(), family: 'nope' }, budgets, timings)).toEqual(["no budget for family 'nope'"]);
  });
});

describe('morph targets and pending clips', () => {
  const FACE = ['blink_L', 'blink_R', 'smile', 'brows_up', 'pucker'];
  const commanders = {
    commanders: {
      tris: 24000,
      bones: 32,
      texture: 1024,
      ink: true,
      animations: ['idle', 'run', 'attack'],
      morphs: FACE,
      pending: { commander_pip: { attack: 'phase B' } },
    },
    xeno: budgets.xeno,
  };
  function pip(overrides: Record<string, unknown> = {}) {
    return husk({
      name: 'commander_pip',
      family: 'commanders',
      file: 'commanders/commander_pip.glb',
      tris: 21799,
      bones: 24,
      morphs: FACE,
      animations: [
        { name: 'idle', duration: 1.6, loop: true, strike: null, exportedDuration: 1.6 },
        { name: 'run', duration: 0.7, loop: true, strike: null, exportedDuration: 0.7 },
      ],
      ground: [{ node: null, minY: 0, sink: 0 }],
      ...overrides,
    });
  }

  it('passes the five face morphs on a commander, and fails any morph its family does not name', () => {
    expect(evaluateAsset(pip(), commanders, timings)).toEqual([]);
    expect(evaluateAsset(pip({ morphs: [...FACE, 'foot_curl'] }), commanders, timings)).toEqual([
      "morph targets foot_curl not in the commanders budget's list (blink_L, blink_R, smile, brows_up, pucker)",
    ]);
    // A family that names no morphs takes none, and an entry that records none passes whatever its family allows.
    expect(evaluateAsset(husk({ morphs: ['blink_L'] }), commanders, timings)).toEqual(["morph targets blink_L not in the xeno budget's list (none)"]);
    expect(evaluateAsset(husk(), commanders, timings)).toEqual([]);
  });

  it('lets one named model lack a required clip while its reason stands, and reports the clip as pending', () => {
    expect(pendingClips(pip(), commanders.commanders)).toEqual([{ clip: 'attack', reason: 'phase B' }]);
    // Any other commander still needs the clip, and so does Pip-A with a blank reason.
    expect(evaluateAsset(pip({ name: 'commander_bo' }), commanders, timings)).toEqual(["missing animation 'attack'"]);
    const blank = { ...commanders, commanders: { ...commanders.commanders, pending: { commander_pip: { attack: '  ' } } } };
    expect(evaluateAsset(pip(), blank, timings)).toEqual(["missing animation 'attack'"]);
    expect(pendingClips(pip(), blank.commanders)).toEqual([]);
  });

  it('fails a pending reason once its clip ships, once the family stops requiring it, or once its model leaves the manifest', () => {
    const shipped = pip({ animations: [...(pip().animations as object[]), { name: 'attack', duration: 0.9, loop: false, strike: 0.3, exportedDuration: 0.9 }] });
    expect(evaluateAsset(shipped, commanders, timings)).toEqual(["animation 'attack' ships, so its pending reason in budgets.json must go"]);
    expect(pendingClips(shipped, commanders.commanders)).toEqual([]);
    const dance = { ...commanders, commanders: { ...commanders.commanders, pending: { commander_pip: { attack: 'phase B', dance: 'never' } } } };
    expect(evaluateAsset(pip(), dance, timings)).toEqual(["pending clip 'dance' is not one the commanders budget requires; remove its reason"]);
    expect(stalePending({ assets: [pip()] }, commanders)).toEqual([]);
    expect(stalePending({ assets: [husk()] }, commanders)).toEqual([
      "budgets.json commanders.pending names 'commander_pip', which the manifest does not list as a commanders model; remove it",
    ]);
  });
});

describe('the ground contact rule', () => {
  function standing(minY: number | null, sink = 0, node = 'rock_a') {
    return husk({ ground: [{ node, minY, sink }] });
  }

  it('passes a placeable whose lowest point is on its origin or within 5 mm of it', () => {
    for (const minY of [0, 0.005, -0.005]) expect(evaluateAsset(standing(minY), budgets, timings)).toEqual([]);
  });

  it('passes a declared 0.05 m sink at -0.05 and fails it at -0.06', () => {
    expect(evaluateAsset(standing(-0.05, 0.05), budgets, timings)).toEqual([]);
    expect(evaluateAsset(standing(-0.06, 0.05), budgets, timings)).toEqual([
      "ground 'rock_a': lowest point -0.0600 m sinks (limit -0.0550)",
    ]);
  });

  it('fails a placeable floating 2 cm above its origin', () => {
    expect(evaluateAsset(standing(0.02), budgets, timings)).toEqual([
      "ground 'rock_a': lowest point +0.0200 m floats (limit +0.005)",
    ]);
  });

  it('fails a declared sink deeper than the geometry reaches, as the bush declared 0.12 m over 0.1138 m', () => {
    // A sink is the depth the geometry has. As a bound, 0.12 passed any lowest point from -0.125 m to +0.005 m, so the
    // declared depth said almost nothing about the geometry.
    expect(evaluateAsset(standing(-0.1138, 0.12, 'bush'), budgets, timings)).toEqual([
      "ground 'bush': lowest point -0.1138 m is shallower than its declared sink of 0.12 m (limit -0.1150)",
    ]);
    expect(evaluateAsset(standing(-0.1138, 0.114, 'bush'), budgets, timings)).toEqual([]);
  });

  it('caps a declared sink at 0.14 m: 0.15 fails even where the geometry matches it, and 0.14 matched passes', () => {
    // A 0.15 m cap let a declared sink pass the old Bolt mark I, whose root sat 0.150 m over its plinth's bottom.
    expect(evaluateAsset(standing(-0.15, 0.15), budgets, timings)).toEqual(["ground 'rock_a': sink 0.15 m > 0.14 m"]);
    expect(evaluateAsset(standing(-0.14, 0.14), budgets, timings)).toEqual([]);
  });

  it('fails a model entry without ground data, as in a manifest written before the rule', () => {
    const { ground: _ground, ...stale } = husk();
    const missing = ['no ground data (the manifest predates the ground rule; run npm run assets)'];
    expect(evaluateAsset(stale, budgets, timings)).toEqual(missing);
    expect(evaluateAsset(husk({ ground: [] }), budgets, timings)).toEqual(missing);
  });

  it('fails a placeable the GLB could not measure', () => {
    expect(evaluateAsset(standing(null), budgets, timings)).toEqual([
      "ground 'rock_a': not measured (no such top-level node, or no geometry under it)",
    ]);
  });

  it('checks every placeable of an asset: the old Bolt passes as a whole and fails at its mark roots', () => {
    const ground = [
      { node: null, minY: 0, sink: 0 },
      { node: 'bolt_mk1', minY: -0.15, sink: 0 },
      { node: 'bolt_mk2', minY: -0.21, sink: 0 },
    ];
    expect(evaluateAsset(husk({ ground }), budgets, timings)).toEqual([
      "ground 'bolt_mk1': lowest point -0.1500 m sinks (limit -0.0050)",
      "ground 'bolt_mk2': lowest point -0.2100 m sinks (limit -0.0050)",
    ]);
  });

  it('exempts textures, which carry no ground data', () => {
    const texture = { name: 'ink_noise', family: 'textures', kind: 'texture', file: 'textures/ink_noise.png', ground: [] };
    expect(evaluateAsset(texture, budgets, timings)).toEqual([]);
  });
});

describe('the committed file against the manifest', () => {
  const texture = { name: 'ink_noise', family: 'textures', kind: 'texture', file: 'textures/ink_noise.png', bytes: 0 };

  it('passes a model whose file is exactly the length the build recorded', () => {
    expect(fileFailures(husk({ bytes: 172804 }), 172804)).toEqual([]);
  });

  it('fails a model whose file changed after the manifest was written, even by one byte', () => {
    // A build that published a nest.glb inspect.mjs then refused left the old manifest's 41016 bytes over a 41108-byte
    // file, and every other number in the manifest still passed.
    expect(fileFailures(husk({ file: 'nests/nest.glb', bytes: 41016 }), 41108)).toEqual([
      'nests/nest.glb is 41108 bytes, the manifest records 41016 (changed without npm run assets)',
    ]);
    expect(fileFailures(husk({ bytes: 172804 }), 172805)).toHaveLength(1);
  });

  it('fails a missing file, model or texture', () => {
    expect(fileFailures(husk({ bytes: 172804 }), null)).toEqual(['file missing: xeno/husk.glb']);
    expect(fileFailures(texture, null)).toEqual(['file missing: textures/ink_noise.png']);
  });

  it('exempts textures from the length rule: the manifest records their bytes as 0', () => {
    expect(fileFailures(texture, 43226)).toEqual([]);
  });
});
