import { describe, expect, it } from 'vitest';
import { manifestEntry } from '../../../tools/assets/manifest.mjs';

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
    };
    const stats = {
      tris: 4200,
      bones: 17,
      animations: [{ name: 'attack', duration: 1.3999 }],
      textures: [{ width: 1024, height: 1024, mime: 'image/webp' }],
      nodes: ['rig', 'husk'],
      hasInk: true,
      doubleSided: true,
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
      bytes: 123456,
    });
  });

  it('keeps texture entries without GLB stats', () => {
    const entry = manifestEntry({ name: 'ink_noise', family: 'textures', kind: 'texture', file: 'textures/ink_noise.png', nodes: [], animations: [] }, null);
    expect(entry).toMatchObject({ name: 'ink_noise', kind: 'texture', tris: 0, doubleSided: false, bytes: 0 });
  });
});
