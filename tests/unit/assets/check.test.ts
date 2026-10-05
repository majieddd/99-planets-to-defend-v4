import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { comboWindowFailures, comboWindowsNote, evaluateAsset, fileFailures, timedClips } from '../../../tools/assets/check.mjs';

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

describe("morph targets and Pip's attack", () => {
  const FACE = ['blink_L', 'blink_R', 'smile', 'brows_up', 'pucker'];
  const commanders = {
    commanders: { tris: 24000, bones: 32, texture: 1024, ink: true, animations: ['idle', 'run', 'attack'], morphs: FACE },
    xeno: budgets.xeno,
  };
  const commanderTimings = { ...timings, commanders: { commander_pip: { attack: { duration: 0.85, strike: 0.34 } } } };
  // Pip as the recipe build ships him: 23,999 triangles, under the commanders line, three 1024 px textures (the body and
  // armour atlas and its emissive, and the head's own albedo on its second material), and his attack on his own timing.
  const TEXTURE_1024 = { width: 1024, height: 1024, mime: 'image/webp' };
  const ATTACK = { name: 'attack', duration: 0.85, loop: false, strike: 0.34, exportedDuration: 0.85 };
  function pip(overrides: Record<string, unknown> = {}) {
    return husk({
      name: 'commander_pip',
      family: 'commanders',
      file: 'commanders/commander_pip.glb',
      tris: 23999,
      bones: 24,
      textures: [TEXTURE_1024, TEXTURE_1024, TEXTURE_1024],
      morphs: FACE,
      animations: [
        { name: 'idle', duration: 1.6, loop: true, strike: null, exportedDuration: 1.6 },
        { name: 'run', duration: 0.7, loop: true, strike: null, exportedDuration: 0.7 },
        ATTACK,
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

  it("passes Pip on the triangle line and fails him over it; the texture line caps each texture's size, not their count", () => {
    expect(evaluateAsset(pip(), commanders, commanderTimings)).toEqual([]);
    expect(evaluateAsset(pip({ tris: 24001 }), commanders, commanderTimings)).toEqual(['tris 24001 > 24000']);
    // The head texture is a third 1024 px texture, which the line allows; a larger one fails however few there are.
    expect(evaluateAsset(pip({ textures: [{ width: 2048, height: 1024 }] }), commanders, commanderTimings)).toEqual(['texture 2048x1024 > 1024']);
  });

  it('requires every commander clip, with no exception left for a model whose attack once had not shipped', () => {
    const idleAndRun = (pip().animations as { name: string }[]).filter((clip) => clip.name !== 'attack');
    expect(evaluateAsset(pip({ animations: idleAndRun }), commanders, commanderTimings)).toEqual(["missing animation 'attack'"]);
    expect(evaluateAsset(pip({ name: 'commander_bo', animations: idleAndRun }), commanders, commanderTimings)).toEqual(["missing animation 'attack'"]);
  });

  it("holds Pip's attack to his own entry in timings.json: duration, exported duration and strike", () => {
    const off = (attack: Record<string, unknown>) => pip({ animations: [...(pip().animations as object[]).slice(0, 2), { ...ATTACK, ...attack }] });
    expect(evaluateAsset(off({ strike: 0.3 }), commanders, commanderTimings)).toEqual(['attack strike 0.3 != timings 0.34']);
    expect(evaluateAsset(off({ duration: 0.9, exportedDuration: 0.9 }), commanders, commanderTimings)).toEqual([
      'attack duration 0.9 != timings 0.85',
      'attack exported duration 0.900 != timings 0.85',
    ]);
    // Within one frame (1 / 30 s) of the contract passes, as the export's frame rounding needs.
    expect(evaluateAsset(off({ strike: 0.35 }), commanders, commanderTimings)).toEqual([]);
    // The real export: 0.85 s is 25.5 frames, and the GLB's clip ends at 25 frames, 0.8333 s, as the manifest records
    // it; a clip a frame and a half short is out.
    expect(evaluateAsset(off({ exportedDuration: 0.8333333134651184 }), commanders, commanderTimings)).toEqual([]);
    expect(evaluateAsset(off({ exportedDuration: 0.8 }), commanders, commanderTimings)).toEqual(['attack exported duration 0.800 != timings 0.85']);
    // The pass line names the contracts held; a model with no entry, or a texture, names none.
    expect(timedClips(pip(), commanderTimings)).toEqual(['attack 0.85 s, strike 0.34 s']);
    expect(timedClips(pip({ name: 'commander_bo' }), commanderTimings)).toEqual([]);
    expect(timedClips({ ...pip(), kind: 'texture' }, commanderTimings)).toEqual([]);
  });

  it("holds every clip timings.json times for the model, not only the family's required ones: Pip's combo hits", () => {
    // Pip's attack_1 to attack_3 as the recipe exports them: 0.55 s contracts exported at 16 frames (0.533 s), the
    // finisher's 0.85 s at 25 (0.833 s), each struck at its contract strike. The family requires none of them, since
    // Bulwark ships no combo, so the check walked only idle, run and attack and passed any of them, or none.
    const comboTimings = {
      ...timings,
      commanders: {
        commander_pip: {
          attack: { duration: 0.85, strike: 0.34 },
          attack_1: { duration: 0.55, strike: 0.2 },
          attack_2: { duration: 0.55, strike: 0.2 },
          attack_3: { duration: 0.85, strike: 0.38 },
        },
      },
    };
    const hit = (name: string, duration: number, strike: number, exportedDuration: number) => ({ name, duration, loop: false, strike, exportedDuration });
    const combo = [hit('attack_1', 0.55, 0.2, 0.5333333), hit('attack_2', 0.55, 0.2, 0.5333333), hit('attack_3', 0.85, 0.38, 0.8333333)];
    const withCombo = (hits: object[]) => pip({ animations: [...(pip().animations as object[]), ...hits] });
    expect(evaluateAsset(withCombo(combo), commanders, comboTimings)).toEqual([]);
    expect(timedClips(withCombo(combo), comboTimings)).toEqual([
      'attack 0.85 s, strike 0.34 s',
      'attack_1 0.55 s, strike 0.2 s',
      'attack_2 0.55 s, strike 0.2 s',
      'attack_3 0.85 s, strike 0.38 s',
    ]);
    // A timed hit the GLB lacks is missing, as a required clip is; one off its strike or length fails by name.
    expect(evaluateAsset(withCombo(combo.slice(0, 2)), commanders, comboTimings)).toEqual(["missing animation 'attack_3'"]);
    expect(evaluateAsset(withCombo([combo[0]!, { ...combo[1]!, strike: 0.25 }, combo[2]!]), commanders, comboTimings)).toEqual([
      'attack_2 strike 0.25 != timings 0.2',
    ]);
    expect(evaluateAsset(withCombo([combo[0]!, combo[1]!, { ...combo[2]!, exportedDuration: 0.7 }]), commanders, comboTimings)).toEqual([
      'attack_3 exported duration 0.700 != timings 0.85',
    ]);
    // Bulwark, with no entry for the hits, is not asked for them.
    expect(evaluateAsset(pip({ name: 'bulwark' }), commanders, { commanders: { bulwark: { attack: { duration: 0.85, strike: 0.34 } } } })).toEqual([]);
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

describe("the combo's windows against timings.json and the sidecar", () => {
  const model = { name: 'commander_pip', family: 'commanders', kind: 'model' };
  const windows = (overrides: Record<string, Record<string, unknown>> = {}) => ({
    commanders: {
      commander_pip: {
        attack: { duration: 0.85, strike: 0.34 },
        attack_1: { duration: 0.55, strike: 0.2, activeFrom: 0.15, activeTo: 0.28, cancel: 0.3, ...overrides['attack_1'] },
        attack_2: { duration: 0.55, strike: 0.2, activeFrom: 0.15, activeTo: 0.28, cancel: 0.3, ...overrides['attack_2'] },
        attack_3: { duration: 0.85, strike: 0.38, activeFrom: 0.33, activeTo: 0.46, cancel: null, ...overrides['attack_3'] },
      },
    },
  });
  const sidecar = (cancels: (number | null)[] = [0.3, 0.3, null]) => ({
    notes: { combo: Object.fromEntries(cancels.map((cancel, i) => [`attack_${i + 1}`, { source: 'hand', cancel }])) },
  });

  it('passes the shipped windows and names them on the pass line', () => {
    expect(comboWindowFailures(model, windows(), sidecar())).toEqual([]);
    expect(comboWindowsNote(model, windows(), sidecar())).toBe(
      'combo windows attack_1 0 < 0.15 < 0.2 < 0.28 <= 0.3 < 0.55, attack_2 0 < 0.15 < 0.2 < 0.28 <= 0.3 < 0.55, ' +
        'attack_3 0 < 0.33 < 0.38 < 0.46 <= 0.85 (finisher, cancel null); sidecar cancels 0.3, 0.3, null match',
    );
    // The committed file itself, against the committed sidecar.
    const shipped = JSON.parse(readFileSync('src/shared/timings.json', 'utf8')) as object;
    const meta = JSON.parse(readFileSync('public/assets/commanders/commander_pip.meta.json', 'utf8')) as object;
    expect(comboWindowFailures(model, shipped, meta)).toEqual([]);
  });

  it('fails a light hit whose windows are out of order: active frames past the cancel, a strike outside them, a cancel at the end', () => {
    expect(comboWindowFailures(model, windows({ attack_1: { activeTo: 0.32 } }), sidecar())).toEqual([
      'attack_1 windows out of order: want 0 < activeFrom 0.15 < strike 0.2 < activeTo 0.32 <= cancel 0.3 < duration 0.55',
    ]);
    expect(comboWindowFailures(model, windows({ attack_2: { activeFrom: 0.21 } }), sidecar())).toHaveLength(1);
    expect(comboWindowFailures(model, windows({ attack_2: { activeFrom: 0 } }), sidecar())).toHaveLength(1);
    expect(comboWindowFailures(model, windows({ attack_1: { cancel: 0.55 } }), sidecar([0.55, 0.3, null]))).toEqual([
      'attack_1 windows out of order: want 0 < activeFrom 0.15 < strike 0.2 < activeTo 0.28 <= cancel 0.55 < duration 0.55',
    ]);
  });

  it('fails a finisher with a cancel, a light hit without one, and a hit missing its window keys', () => {
    expect(comboWindowFailures(model, windows({ attack_3: { cancel: 0.7 } }), sidecar([0.3, 0.3, 0.7]))).toEqual(['attack_3, the finisher, must have cancel null, not 0.7']);
    expect(comboWindowFailures(model, windows({ attack_2: { cancel: null } }), sidecar([0.3, null, null]))).toEqual(['attack_2, a light hit, needs a cancel in seconds, not null']);
    const bare = windows();
    bare.commanders.commander_pip.attack_1 = { duration: 0.55, strike: 0.2 } as never;
    expect(comboWindowFailures(model, bare, sidecar())).toEqual(['attack_1 timings lack activeFrom, activeTo, cancel']);
  });

  it("holds the sidecar's recorded cancel to the file's, and a windowed entry to a combo the sidecar records", () => {
    // The recipe records each cancel rounded to the millisecond; one the file moved since the build fails by name.
    expect(comboWindowFailures(model, windows(), sidecar([0.3, 0.3004, null]))).toEqual([]);
    expect(comboWindowFailures(model, windows({ attack_2: { cancel: 0.32 } }), sidecar())).toEqual(['attack_2 sidecar cancel 0.3 != timings 0.32']);
    expect(comboWindowFailures(model, windows(), { notes: {} })).toEqual(['timings.json gives combo windows for attack_1, attack_2, attack_3, but the sidecar records no combo']);
    expect(comboWindowFailures(model, windows(), null)).toHaveLength(1);
    // A model with no windows and no combo (Bulwark, the Husk) has nothing to hold.
    expect(comboWindowFailures({ ...model, name: 'bulwark' }, { commanders: { bulwark: { attack: { duration: 0.85, strike: 0.34 } } } }, { notes: {} })).toEqual([]);
    expect(comboWindowsNote({ ...model, name: 'bulwark' }, windows(), { notes: {} })).toBeNull();
  });
});
