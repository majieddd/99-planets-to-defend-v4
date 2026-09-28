import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FAMILY_STANDARD_BLEND, standardBlendFor } from '../../../src/render/assets/familyBlend';
import {
  coverageGaps,
  MEMBERS,
  NON_PLACEABLE,
  requiredPieces,
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

describe('the Asset World registry', () => {
  it('accounts for every entry of the shipped manifest: each model placed, each placeable and kit piece placed, each texture given a reason', () => {
    expect(coverageGaps(manifest)).toEqual([]);
    const models = manifest.assets.filter((entry) => entry.kind === 'model');
    for (const entry of models) expect(MEMBERS.some((m) => m.entry === entry.name), entry.name).toBe(true);
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

  it('fails a member whose entry left the manifest', () => {
    const shrunk: CoverageManifest = { assets: manifest.assets.filter((entry) => entry.name !== 'nest') };
    expect(coverageGaps(shrunk)).toEqual([expect.stringContaining('member "nest" comes from "nest"')]);
  });

  it('reads the placeables from the ground records: a whole-asset record covers the asset, otherwise each named node', () => {
    const find = (name: string) => manifest.assets.find((entry) => entry.name === name)!;
    expect(requiredPieces(find('bulwark'))).toEqual([]);
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
      expect(ZONES.some((zone) => zone.family === m.family), m.name).toBe(true);
      if (m.clip) expect(entry.animations.map((clip) => clip.name), m.name).toContain(m.clip);
      if (typeof m.heartStage === 'number') expect(entry.nodes, m.name).toContain(`heart_stage_${String(m.heartStage).padStart(2, '0')}`);
    }
    // The members the world shows: the Husk walking and attacking, Bulwark idle, running and attacking, the three fixed
    // heart stages and the slider's heart, and the three tower marks.
    expect(MEMBERS.filter((m) => m.entry === 'husk').map((m) => m.clip)).toEqual(['walk', 'attack']);
    expect(MEMBERS.filter((m) => m.entry === 'bulwark').map((m) => m.clip)).toEqual(['idle', 'run', 'attack']);
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
