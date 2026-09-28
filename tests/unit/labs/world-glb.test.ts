import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NodeIO } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { MEMBERS } from '../../../src/labs/world/registry';
import { assetIO } from '../../../tools/assets/optimize.mjs';

// The Asset World's takeRoot (src/labs/world/layout.ts) decides how to stand a node on the ground from the three.js type
// GLTFLoader gives it: a Mesh keeps its matrix (the quantization box) inside a holder, and anything else is an empty the
// world places itself. tools/assets/inspect.mjs measured the ground contact by whether the glTF node carries a mesh.
// The two agree only while every placed mesh node has one primitive: GLTFLoader loads a node whose mesh has two or more
// primitives (a piece given a second material) as a Group, which takeRoot would place as an empty, overwriting its
// quantization matrix and drawing it at the size and offset of that box. This reads the shipped GLBs, so such a piece
// fails here by name before it can misplace itself in the world.

interface ManifestModel {
  name: string;
  kind: string;
  file: string;
}
const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')) as { assets: ManifestModel[] };

describe('the GLB nodes the Asset World places by name', () => {
  it('are each a top-level empty, or a top-level node whose mesh has a single primitive', async () => {
    const io: NodeIO = await assetIO();
    const byNode = MEMBERS.filter((m) => m.node !== null);
    expect(byNode.length).toBeGreaterThan(0);
    const seen: string[] = [];
    for (const entry of new Set(byNode.map((m) => m.entry))) {
      const file = manifest.assets.find((asset) => asset.name === entry && asset.kind === 'model')!.file;
      const doc = await io.read(fileURLToPath(new URL(`../../../public/assets/${file}`, import.meta.url)));
      const root = doc.getRoot();
      const scene = root.getDefaultScene() ?? root.listScenes()[0]!;
      const top = new Map(scene.listChildren().map((node) => [node.getName(), node]));
      for (const member of byNode.filter((m) => m.entry === entry)) {
        const node = top.get(member.node!);
        expect(node, `${entry} has no top-level node "${member.node}" for the Asset World member ${member.name}`).toBeDefined();
        const mesh = node!.getMesh();
        const primitives = mesh ? mesh.listPrimitives().length : 0;
        expect(
          primitives <= 1,
          `${entry}: node "${member.node}" carries a mesh of ${primitives} primitives, which three.js loads as a Group, so the ` +
            'Asset World would place it as an empty and overwrite its quantization matrix; give takeRoot (layout.ts) a holder for it',
        ).toBe(true);
        seen.push(`${member.node} ${mesh ? 'mesh' : 'empty'}`);
      }
    }
    // Today the kit's pieces are single-primitive mesh nodes, held in a holder, and the tower marks are empties.
    expect(seen.filter((line) => line.startsWith('bolt_mk'))).toEqual(['bolt_mk1 empty', 'bolt_mk2 empty', 'bolt_mk3 empty']);
    expect(seen.filter((line) => !line.startsWith('bolt_mk')).every((line) => line.endsWith(' mesh'))).toBe(true);
  });
});
