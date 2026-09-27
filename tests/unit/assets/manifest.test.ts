import { describe, expect, it } from 'vitest';
import { groundEntries, manifestEntry } from '../../../tools/assets/manifest.mjs';

describe('manifestEntry', () => {
  it('merges what the recipe declared with what the GLB holds', () => {
    const meta = {
      name: 'husk',
      family: 'xeno',
      kind: 'model',
      file: 'xeno/husk.glb',
      recipe: 'husk',
      nodes: ['declared'],
      animations: [{ name: 'attack', duration: 1.4, loop: false, strike: 0.4 }],
      tris: 1,
      notes: {},
      placeables: [],
    };
    const stats = {
      tris: 4200,
      bones: 17,
      animations: [{ name: 'attack', duration: 1.3999 }],
      textures: [{ width: 1024, height: 1024, mime: 'image/webp' }],
      nodes: ['rig', 'husk'],
      hasInk: true,
      doubleSided: true,
      ground: { asset: -0.0024, nodes: [{ name: 'rig', empty: true, minY: -0.0024 }] },
      bytes: 123456,
    };
    expect(manifestEntry(meta, stats)).toEqual({
      name: 'husk',
      family: 'xeno',
      kind: 'model',
      file: 'xeno/husk.glb',
      nodes: ['rig', 'husk'],
      animations: [{ name: 'attack', duration: 1.4, loop: false, strike: 0.4, exportedDuration: 1.3999 }],
      tris: 4200,
      bones: 17,
      textures: [{ width: 1024, height: 1024, mime: 'image/webp' }],
      hasInk: true,
      doubleSided: true,
      ground: [
        { node: null, minY: -0.0024, sink: 0 },
        { node: 'rig', minY: -0.0024, sink: 0 },
      ],
      bytes: 123456,
    });
  });

  it('keeps texture entries without GLB stats', () => {
    const entry = manifestEntry({ name: 'ink_noise', family: 'textures', kind: 'texture', file: 'textures/ink_noise.png', nodes: [], animations: [] }, null);
    expect(entry).toMatchObject({ name: 'ink_noise', kind: 'texture', tris: 0, doubleSided: false, ground: [], bytes: 0 });
  });
});

describe('groundEntries', () => {
  const kit = {
    asset: -0.1138,
    nodes: [
      { name: 'bush', empty: false, minY: -0.1138 },
      { name: 'rock_a', empty: false, minY: -0.05 },
    ],
  };

  it('stands for the whole asset, with no sink, when the recipe declares nothing', () => {
    expect(groundEntries(undefined, kit)).toEqual([{ node: null, minY: -0.1138, sink: 0 }]);
    expect(groundEntries([], kit)).toEqual([{ node: null, minY: -0.1138, sink: 0 }]);
  });

  it('takes the declared placeables, each with its own measurement and sink, in place of the whole asset', () => {
    const declared = [{ node: 'rock_a', sink: 0.05 }, { node: 'bush', sink: 0.114 }];
    expect(groundEntries(declared, kit)).toEqual([
      { node: 'rock_a', minY: -0.05, sink: 0.05 },
      { node: 'bush', minY: -0.1138, sink: 0.114 },
    ]);
  });

  it('adds every top-level empty the recipe did not declare, as the handle the runtime would place', () => {
    const bolt = {
      asset: 0,
      nodes: [
        { name: 'bolt_mk1', empty: true, minY: -0.15 },
        { name: 'bolt_mk2', empty: true, minY: -0.21 },
      ],
    };
    expect(groundEntries([{ node: 'bolt_mk2', sink: 0 }], bolt)).toEqual([
      { node: 'bolt_mk2', minY: -0.21, sink: 0 },
      { node: 'bolt_mk1', minY: -0.15, sink: 0 },
    ]);
  });

  it('leaves out a top-level empty with no geometry under it, and marks a declared node the GLB lacks unmeasured', () => {
    const measured = { asset: 0, nodes: [{ name: 'marker', empty: true, minY: null }] };
    expect(groundEntries([{ node: 'rock_z', sink: 0 }], measured)).toEqual([{ node: 'rock_z', minY: null, sink: 0 }]);
  });
});
