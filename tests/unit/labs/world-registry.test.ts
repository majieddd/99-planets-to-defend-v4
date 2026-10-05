import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pendingClips } from '../../../tools/assets/check.mjs';
import { COMMANDER_LABELS } from '../../../src/labs/shared/commanders';
import { FAMILY_STANDARD_BLEND, standardBlendFor } from '../../../src/render/assets/familyBlend';
import {
  BULWARK_ROW_START,
  CHARACTER_ROW_DEPTH,
  CHARACTER_ROW_GAP,
  CHARACTER_SPACING,
  clipHasReason,
  CLIPS_NOT_SHOWN,
  COMMANDER_ROW_GAP,
  coverageGaps,
  HUSK_ROW_START,
  LEAN,
  MEMBERS,
  NON_PLACEABLE,
  PIP_ROW_START,
  requiredPieces,
  THREE_QUARTER_TURN_DEG,
  toTangent,
  WORLD_REACH,
  ZONES,
  type CoverageManifest,
} from '../../../src/labs/world/registry';
import { WORLD_CASTER_MARGIN, WORLD_SHADOW_HALF_WIDTH } from '../../../src/labs/world/sun';

interface ShippedManifest extends CoverageManifest {
  assets: (CoverageManifest['assets'][number] & { animations: { name: string }[] })[];
}

const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')) as ShippedManifest;
const budgets = JSON.parse(readFileSync('tools/assets/budgets.json', 'utf8')) as Record<string, { pending?: Record<string, Record<string, string>> }>;

describe('the Asset World registry', () => {
  it('accounts for every entry of the shipped manifest: each model placed, each placeable and kit piece placed, each clip looped, each texture given a reason', () => {
    expect(coverageGaps(manifest)).toEqual([]);
    const models = manifest.assets.filter((entry) => entry.kind === 'model');
    for (const entry of models) expect(MEMBERS.some((m) => m.entry === entry.name), entry.name).toBe(true);
    // A clip with a written reason in CLIPS_NOT_SHOWN is accounted for without a member, as coverageGaps accepts it.
    for (const entry of models) {
      for (const clip of entry.animations.filter((animation) => !clipHasReason(entry.name, animation.name))) {
        expect(MEMBERS.some((m) => m.entry === entry.name && m.clip === clip.name), `${entry.name} ${clip.name}`).toBe(true);
      }
    }
    const kit = manifest.assets.filter((entry) => entry.family === 'env').flatMap((entry) => entry.nodes);
    expect(kit.length).toBeGreaterThan(0);
    for (const piece of kit) expect(MEMBERS.some((m) => m.node === piece), piece).toBe(true);
    for (const entry of manifest.assets.filter((asset) => asset.kind === 'texture')) expect(NON_PLACEABLE[entry.name], entry.name).toMatch(/\w/);
  });

  it('fails a new model, a new kit piece, a new tower mark and an unexplained texture by name', () => {
    const grown: CoverageManifest = {
      assets: [
        ...manifest.assets.map((entry) =>
          entry.name === 'verdant_kit'
            ? { ...entry, nodes: [...entry.nodes, 'rock_d'], ground: [...(entry.ground ?? []), { node: 'rock_d' }] }
            : entry.name === 'bolt_sentinel'
              ? { ...entry, nodes: [...entry.nodes, 'bolt_mk4'], ground: [...(entry.ground ?? []), { node: 'bolt_mk4' }] }
              : entry,
        ),
        { name: 'mortar_bastion', kind: 'model', family: 'towers', nodes: ['mortar_mk1'], ground: [{ node: 'mortar_mk1' }] },
        { name: 'paper_grain', kind: 'texture', family: 'textures', nodes: [] },
      ],
    };
    const gaps = coverageGaps(grown);
    const line = gaps.join('\n');
    expect(gaps.some((gap) => gap.includes('"mortar_bastion"') && gap.includes('no layout')), line).toBe(true);
    expect(gaps.some((gap) => gap.includes('"rock_d"')), line).toBe(true);
    expect(gaps.some((gap) => gap.includes('"bolt_mk4"')), line).toBe(true);
    expect(gaps.some((gap) => gap.includes('"paper_grain"') && gap.includes('NON_PLACEABLE')), line).toBe(true);
    // Every message says where to add the layout.
    for (const gap of gaps) expect(gap).toContain('src/labs/world/registry.ts');
  });

  it('fails a clip no member loops by name, unless CLIPS_NOT_SHOWN gives it a reason', () => {
    const grown: CoverageManifest = {
      assets: manifest.assets.map((entry) => (entry.name === 'husk' ? { ...entry, animations: [...entry.animations, { name: 'leap' }] } : entry)),
    };
    const gaps = coverageGaps(grown);
    expect(gaps).toEqual([expect.stringMatching(/"husk" has a clip "leap" that no Asset World member loops and CLIPS_NOT_SHOWN/)]);
    expect(gaps[0]).toContain('src/labs/world/registry.ts');
    const reason = { 'husk/leap': 'a one-off intro, shown in the cutscene lab' };
    expect(coverageGaps(grown, MEMBERS, NON_PLACEABLE, reason)).toEqual([]);
    expect(clipHasReason('husk', 'leap', reason)).toBe(true);
    // A blank reason is no reason, and a reason for another entry's clip covers nothing here (and is itself a stale
    // reason, since Bulwark ships no such clip).
    expect(coverageGaps(grown, MEMBERS, NON_PLACEABLE, { 'husk/leap': '  ' })).toHaveLength(1);
    expect(clipHasReason('husk', 'leap', { 'husk/leap': '  ' })).toBe(false);
    expect(coverageGaps(grown, MEMBERS, NON_PLACEABLE, { 'bulwark/leap': 'Bulwark does not leap' })).toEqual([
      expect.stringContaining('"husk" has a clip "leap"'),
      expect.stringContaining('reason for "bulwark/leap", which is no clip the manifest lists'),
    ]);
    // The shipped registry loops every shipped clip, so the table of reasons starts empty.
    expect(CLIPS_NOT_SHOWN).toEqual({});
    const withoutIdle = MEMBERS.filter((m) => m.name !== 'husk_idle');
    expect(coverageGaps(manifest, withoutIdle)).toEqual([expect.stringContaining('"husk" has a clip "idle"')]);
    expect(coverageGaps(manifest, withoutIdle, NON_PLACEABLE, { 'husk/idle': 'the idle Husk stands in the wave lab' })).toEqual([]);
  });

  it('fails a CLIPS_NOT_SHOWN reason whose clip left the manifest, or that a member loops, by its key', () => {
    // The clip left the GLB, so its reason explains nothing, and would silently cover a new clip of that name.
    const stale = coverageGaps(manifest, MEMBERS, NON_PLACEABLE, { 'husk/leap': 'a one-off intro, shown in the cutscene lab' });
    expect(stale).toEqual([expect.stringMatching(/CLIPS_NOT_SHOWN gives a reason for "husk\/leap", which is no clip the manifest lists/)]);
    // A key that names no entry, or has no clip part, is as stale.
    expect(coverageGaps(manifest, MEMBERS, NON_PLACEABLE, { 'mortar_bastion/fire': 'not built yet' })).toHaveLength(1);
    expect(coverageGaps(manifest, MEMBERS, NON_PLACEABLE, { husk: 'every clip' })).toHaveLength(1);
    // A member loops the clip, so the reason says a shown clip is hidden.
    const looped = coverageGaps(manifest, MEMBERS, NON_PLACEABLE, { 'husk/walk': 'shown in the wave lab instead' });
    expect(looped).toEqual([expect.stringMatching(/CLIPS_NOT_SHOWN gives a reason for "husk\/walk", but member "husk_walk" loops that clip/)]);
    for (const gap of [...stale, ...looped]) expect(gap).toContain('src/labs/world/registry.ts');
  });

  it('fails a member whose entry left the manifest', () => {
    const shrunk: CoverageManifest = { assets: manifest.assets.filter((entry) => entry.name !== 'nest') };
    expect(coverageGaps(shrunk)).toEqual([expect.stringContaining('member "nest" comes from "nest"')]);
  });

  it('reads the placeables from the ground records: a whole-asset record covers the asset, otherwise each named node', () => {
    const find = (name: string) => manifest.assets.find((entry) => entry.name === name)!;
    expect(requiredPieces(find('bulwark'))).toEqual([]);
    // Pip-A is placed whole, like Bulwark: his rig's top-level empty is covered by the whole-asset record.
    expect(requiredPieces(find('commander_pip'))).toEqual([]);
    expect(requiredPieces(find('worldheart'))).toEqual([]);
    expect(requiredPieces(find('bolt_sentinel'))).toEqual(['bolt_mk1', 'bolt_mk2', 'bolt_mk3']);
    expect([...requiredPieces(find('verdant_kit'))].sort()).toEqual([...find('verdant_kit').nodes].sort());
  });

  it('names each member once, puts it in its entry family and a zone, and loops only clips its entry exports', () => {
    const names = MEMBERS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
    for (const m of MEMBERS) {
      const entry = manifest.assets.find((asset) => asset.name === m.entry)!;
      expect(m.family, m.name).toBe(entry.family);
      expect(ZONES.some((zone) => zone.family === m.zone), m.name).toBe(true);
      // Every member stands in its family's zone; Pip's no longer has one of its own beside Bulwark's.
      expect(m.zone, m.name).toBe(m.family);
      if (m.clip) expect(entry.animations.map((clip) => clip.name), m.name).toContain(m.clip);
      if (typeof m.heartStage === 'number') expect(entry.nodes, m.name).toContain(`heart_stage_${String(m.heartStage).padStart(2, '0')}`);
    }
    // The members the world shows: the Husk idle, walking and attacking, the commanders, the three fixed heart stages and
    // the slider's heart, and the three tower marks.
    expect(MEMBERS.filter((m) => m.entry === 'husk').map((m) => m.clip)).toEqual(['idle', 'walk', 'attack']);
    // The commanders' zone: Pip (commander), the default, first, idle, running and a third idle whose face cycles the
    // expression demo (his attack clip is pending); then Bulwark, the alternate, idle, running and attacking.
    expect(ZONES.find((zone) => zone.family === 'commanders')?.label).toBe('Commanders');
    expect(MEMBERS.filter((m) => m.zone === 'commanders').map((m) => [m.name, m.entry, m.clip, m.faceDemo, m.label, m.character])).toEqual([
      ['pip_idle', 'commander_pip', 'idle', false, 'Idle', 'Pip (commander)'],
      ['pip_run', 'commander_pip', 'run', false, 'Run', 'Pip (commander)'],
      ['pip_face', 'commander_pip', 'idle', true, 'Face', 'Pip (commander)'],
      ['bulwark_idle', 'bulwark', 'idle', false, 'Idle', 'Bulwark'],
      ['bulwark_run', 'bulwark', 'run', false, 'Run', 'Bulwark'],
      ['bulwark_attack', 'bulwark', 'attack', false, 'Attack', 'Bulwark'],
    ]);
    expect(COMMANDER_LABELS.pip).toBe('Pip (commander)');
    expect(MEMBERS.filter((m) => m.faceDemo).map((m) => m.name)).toEqual(['pip_face']);
    // Only a zone shared by more than one character names them; the Husk's members name their clips alone.
    expect(MEMBERS.filter((m) => m.character !== null).every((m) => m.zone === 'commanders')).toBe(true);
    expect(ZONES.map((zone) => zone.family)).toEqual(['env', 'towers', 'nests', 'xeno', 'commanders', 'heart']);
    expect(MEMBERS.filter((m) => m.entry === 'worldheart').map((m) => m.heartStage)).toEqual([0, 5, 10, 'live']);
    expect(MEMBERS.filter((m) => m.entry === 'bolt_sentinel').map((m) => m.node)).toEqual(['bolt_mk1', 'bolt_mk2', 'bolt_mk3']);
  });

  it('keeps every two roots at least 2.4 m apart, so no two members stand in each other', () => {
    let nearest = Infinity;
    let pair = '';
    for (let i = 0; i < MEMBERS.length; i++) {
      for (let j = i + 1; j < MEMBERS.length; j++) {
        const a = MEMBERS[i]!;
        const b = MEMBERS[j]!;
        const gap = Math.hypot(a.s - b.s, a.d - b.d);
        if (gap < nearest) {
          nearest = gap;
          pair = `${a.name} and ${b.name}`;
        }
      }
    }
    expect(nearest, pair).toBeGreaterThanOrEqual(2.4);
  });

  it('stands Pip first on the level clearing after the Husk, then Bulwark, 4 m and 5 m apart, so the three read apart', () => {
    const husk = MEMBERS.filter((m) => m.entry === 'husk');
    const bulwark = MEMBERS.filter((m) => m.entry === 'bulwark');
    const pip = MEMBERS.filter((m) => m.entry === 'commander_pip');
    expect([HUSK_ROW_START, PIP_ROW_START, BULWARK_ROW_START]).toEqual([-6.4, 2.8, 13]);
    expect(husk[0]!.s).toBe(HUSK_ROW_START);
    expect(pip[0]!.s).toBe(PIP_ROW_START);
    expect(bulwark[0]!.s).toBe(BULWARK_ROW_START);
    // Left to right as the cameras see them: the Husk, Pip, then Bulwark.
    expect(Math.min(...pip.map((m) => m.s)) - Math.max(...husk.map((m) => m.s))).toBeCloseTo(CHARACTER_ROW_GAP, 12);
    expect(Math.min(...bulwark.map((m) => m.s)) - Math.max(...pip.map((m) => m.s))).toBeCloseTo(COMMANDER_ROW_GAP, 12);
    expect([CHARACTER_ROW_GAP, COMMANDER_ROW_GAP]).toEqual([4, 5]);
    // Pip's idle and run stand on the level clearing, inside 6 m of the pole, where the relief begins.
    for (const m of pip.filter((member) => !member.faceDemo)) expect(Math.hypot(m.s, m.d), m.name).toBeLessThan(6);
    for (const row of [husk, bulwark, pip]) {
      for (let i = 1; i < row.length; i++) expect(row[i]!.s - row[i - 1]!.s).toBeCloseTo(CHARACTER_SPACING, 12);
      for (const m of row) expect([m.d, m.lean, m.turnDeg], m.name).toEqual([CHARACTER_ROW_DEPTH, LEAN.plumb, THREE_QUARTER_TURN_DEG]);
    }
  });

  it('treats a pending clip (budgets.json) as no member yet, so the clip shipping later needs one member and no other change', () => {
    const pending = Object.values(budgets).flatMap((budget) =>
      Object.keys(budget.pending ?? {}).flatMap((entryName) => {
        const entry = manifest.assets.find((asset) => asset.name === entryName)!;
        return (pendingClips(entry, budget) as { clip: string }[]).map(({ clip }) => ({ entry: entryName, clip }));
      }),
    );
    // Today one clip is pending: Pip's attack, phase B.
    expect(pending).toEqual([{ entry: 'commander_pip', clip: 'attack' }]);
    for (const { entry, clip } of pending) {
      const key = `${entry}/${clip}`;
      // The manifest does not list it, no member loops it, and no CLIPS_NOT_SHOWN reason stands in for it.
      expect(manifest.assets.find((asset) => asset.name === entry)!.animations.map((animation) => animation.name), key).not.toContain(clip);
      expect(MEMBERS.some((m) => m.entry === entry && m.clip === clip), key).toBe(false);
      expect(clipHasReason(entry, clip), key).toBe(false);
      // A member put in ahead of the clip is named, and the page leaves it out, rather than stopping on a missing clip.
      const first = MEMBERS.find((m) => m.entry === entry)!;
      const early = { ...first, name: `${first.name.split('_')[0]}_${clip}`, label: 'Attack', clip, faceDemo: false };
      expect(coverageGaps(manifest, [...MEMBERS, early])).toEqual([expect.stringContaining(`member "${early.name}" loops a clip "${clip}" that "${entry}" does not export`)]);
      // The clip ships: the coverage check names exactly it, and one member that loops it closes the gap.
      const shipped: CoverageManifest = {
        assets: manifest.assets.map((asset) => (asset.name === entry ? { ...asset, animations: [...asset.animations, { name: clip }] } : asset)),
      };
      expect(coverageGaps(shipped)).toEqual([expect.stringContaining(`"${entry}" has a clip "${clip}" that no Asset World member loops`)]);
      expect(coverageGaps(shipped, [...MEMBERS, early])).toEqual([]);
    }
  });

  it('fails a member standing in a zone ZONES does not list, by name', () => {
    const astray = MEMBERS.map((m) => (m.name === 'pip_face' ? { ...m, zone: 'previews' } : m));
    expect(coverageGaps(manifest, astray)).toEqual([expect.stringMatching(/member "pip_face" stands in zone "previews", which ZONES does not list/)]);
  });

  it('maps the view frame onto the tangent plane without stretching it', () => {
    for (const m of MEMBERS) {
      const { x, z } = toTangent(m.s, m.d);
      expect(Math.hypot(x, z)).toBeCloseTo(Math.hypot(m.s, m.d), 9);
    }
    // The cameras' right and their line of sight are perpendicular unit vectors.
    const right = toTangent(1, 0);
    const away = toTangent(0, 1);
    expect(right.x * away.x + right.z * away.z).toBeCloseTo(0, 12);
  });

  it('sizes the sun box to hold every member: the furthest root plus the caster margin', () => {
    expect(WORLD_REACH).toBeCloseTo(Math.max(...MEMBERS.map((m) => Math.hypot(m.s, m.d))), 12);
    expect(WORLD_SHADOW_HALF_WIDTH).toBe(WORLD_REACH + WORLD_CASTER_MARGIN);
  });

  it('has a standard blend for every family the manifest ships', () => {
    for (const entry of manifest.assets.filter((asset) => asset.kind === 'model')) expect(() => standardBlendFor(entry.family), entry.family).not.toThrow();
    expect(() => standardBlendFor('mounts')).toThrow(/mounts.*familyBlend\.ts/);
    expect(FAMILY_STANDARD_BLEND.commanders).toBe(0.35);
  });
});
