import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO, type TypedArray } from '@gltf-transform/core';
import { afterAll, describe, expect, it } from 'vitest';
import { inspectGlb } from '../../../tools/assets/inspect.mjs';
import { optimizeGlb } from '../../../tools/assets/optimize.mjs';

const dir = mkdtempSync(join(tmpdir(), 'p99-morphs-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function accessor(doc: Document, type: 'SCALAR' | 'VEC3' | 'VEC4' | 'MAT4', array: TypedArray) {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  return doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
}

// A 1.6 m skinned body in miniature, a box on two joints like a commander on its skeleton, with the given morph targets.
// Each target lists the box corners it moves (0 to 3 on the ground, 4 to 7 at the top) and by how much.
function commander(targets: Record<string, { corners: number[]; by: [number, number, number] }>): Document {
  const doc = new Document();
  const square: [number, number][] = [[-0.2, -0.1], [0.2, -0.1], [0.2, 0.1], [-0.2, 0.1]];
  const corners = [0, 1.6].flatMap((y) => square.flatMap(([x, z]) => [x, y, z]));
  const indices = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', accessor(doc, 'VEC3', new Float32Array(corners)))
    .setIndices(accessor(doc, 'SCALAR', new Uint16Array(indices)))
    .setAttribute('JOINTS_0', accessor(doc, 'VEC4', new Uint8Array([1, 1, 1, 1, 0, 0, 0, 0].flatMap((joint) => [joint, 0, 0, 0]))))
    .setAttribute('WEIGHTS_0', accessor(doc, 'VEC4', new Float32Array(Array.from({ length: 8 }, () => [1, 0, 0, 0]).flat())));
  for (const [name, { corners: moved, by }] of Object.entries(targets)) {
    const delta = new Float32Array(24);
    for (const corner of moved) delta.set(by, corner * 3);
    prim.addTarget(doc.createPrimitiveTarget(name).setAttribute('POSITION', accessor(doc, 'VEC3', delta)));
  }
  const hips = doc.createNode('hips').setTranslation([0, 1, 0]);
  const knee = doc.createNode('knee').setTranslation([0, -0.5, 0]);
  hips.addChild(knee);
  const skin = doc.createSkin().addJoint(hips).addJoint(knee);
  skin.setInverseBindMatrices(accessor(doc, 'MAT4', new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -0.5, 0, 1])));
  const body = doc.createNode('commander_body').setMesh(doc.createMesh('commander_body').addPrimitive(prim)).setSkin(skin);
  const scene = doc.createScene();
  scene.addChild(doc.createNode('commander_rig').addChild(hips).addChild(body));
  doc.getRoot().setDefaultScene(scene);
  return doc;
}

// Written as Blender's raw GLB, then optimized and inspected as npm run assets does (meshopt quantizes the targets).
async function build(name: string, doc: Document) {
  const raw = join(dir, `${name}.raw.glb`);
  const shipped = join(dir, `${name}.glb`);
  writeFileSync(raw, await new NodeIO().writeBinary(doc));
  await optimizeGlb(raw, shipped);
  return inspectGlb(shipped);
}

describe('morph targets through the asset build', () => {
  it('ships face morphs on a skinned body, reports their names and keeps the ground contact at 0', async () => {
    const stats = await build('face', commander({
      blink_L: { corners: [5, 6], by: [0, -0.012, 0] },
      brows_up: { corners: [4, 5, 6, 7], by: [0, 0.012, 0] },
    }));
    expect(stats.morphs).toEqual(['blink_L', 'brows_up']);
    expect(stats.ground).toEqual({ asset: 0, nodes: [{ name: 'commander_rig', empty: true, minY: 0 }] });
    expect(stats.bones).toBe(2);
  });

  it('refuses a morph that moves a foot vertex, so the build fails before it publishes', async () => {
    const doc = commander({ blink_L: { corners: [5], by: [0, -0.012, 0] }, tiptoe: { corners: [1], by: [0, 0.04, 0] } });
    await expect(build('foot', doc)).rejects.toThrow(
      /foot\.glb: primitive 0 of mesh 'commander_body' on node 'commander_body': morph target 'tiptoe' moves 1 vertices within 5 mm of the ground contact by up to (39|40)\.\d mm/,
    );
  });

  it('reports no morphs for a model without targets', async () => {
    expect((await build('plain', commander({}))).morphs).toEqual([]);
  });
});
