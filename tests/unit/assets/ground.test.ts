import { Document, getBounds, type Primitive, type Scene, type TypedArray, type vec4 } from '@gltf-transform/core';
import { quantize } from '@gltf-transform/functions';
import { describe, expect, it } from 'vitest';
import { groundFailures } from '../../../tools/assets/check.mjs';
import { measureGround } from '../../../tools/assets/inspect.mjs';
import { groundEntries } from '../../../tools/assets/manifest.mjs';

// A box 1 m wide and deep, from y = low to y = high in its node's frame.
function box(doc: Document, low: number, high: number): Primitive {
  const square: [number, number][] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  const corners = [low, high].flatMap((y) => square.flatMap(([x, z]) => [x, y, z]));
  const indices = [
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
  ];
  return doc
    .createPrimitive()
    .setAttribute('POSITION', accessor(doc, 'VEC3', new Float32Array(corners)))
    .setIndices(accessor(doc, 'SCALAR', new Uint16Array(indices)));
}

function accessor(doc: Document, type: 'SCALAR' | 'VEC3' | 'VEC4' | 'MAT4', array: TypedArray) {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  return doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
}

function sceneOf(doc: Document): Scene {
  const scene = doc.createScene();
  doc.getRoot().setDefaultScene(scene);
  return scene;
}

function about(axis: [number, number, number], angle: number): vec4 {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

// Bolt Sentinel mark I in miniature: a 0.3 m plinth standing on the ground (scene y 0 to 0.3) with the yaw on top.
// Before the ground-contact ruling the plinth was the mark's root, its origin at mid-plinth; after it, an empty on the
// ground is the root and the plinth, bolt_mk1_base, keeps its mid-plinth origin under it.
function bolt(doc: Document, groundRoot: boolean) {
  const plinth = doc.createMesh().addPrimitive(box(doc, -0.15, 0.15));
  const yaw = doc.createNode('bolt_mk1_yaw').setTranslation([0, 0.15, 0]);
  if (!groundRoot) return doc.createNode('bolt_mk1').setTranslation([0, 0.15, 0]).setMesh(plinth).addChild(yaw);
  const base = doc.createNode('bolt_mk1_base').setTranslation([0, 0.15, 0]).setMesh(plinth).addChild(yaw);
  return doc.createNode('bolt_mk1').addChild(base);
}

// Each of the body's eight corners, the four lower ones first, on the knee (joint 1) or the hips (joint 0), wholly.
const LOWER_ON_KNEE = [1, 1, 1, 1, 0, 0, 0, 0].flatMap((joint) => [joint, 0, 0, 0]);
const WHOLLY = Array.from({ length: 8 }, () => [1, 0, 0, 0]).flat();

// A two-joint leg under a rig empty: the hips 1 m up and the knee 0.5 m under them, bound where they stand, and a
// skinned body spanning y 0 to 1.6 in the bind pose.
function leg(doc: Document, joints = LOWER_ON_KNEE, weights = WHOLLY) {
  const hips = doc.createNode('hips').setTranslation([0, 1, 0]);
  const knee = doc.createNode('knee').setTranslation([0, -0.5, 0]);
  hips.addChild(knee);
  const inverseBind = [
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1],
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -0.5, 0, 1],
  ].flat();
  const skin = doc.createSkin().addJoint(hips).addJoint(knee);
  skin.setInverseBindMatrices(accessor(doc, 'MAT4', new Float32Array(inverseBind)));
  const prim = box(doc, 0, 1.6)
    .setAttribute('JOINTS_0', accessor(doc, 'VEC4', new Uint8Array(joints)))
    .setAttribute('WEIGHTS_0', accessor(doc, 'VEC4', new Float32Array(weights)));
  const body = doc.createNode('body').setMesh(doc.createMesh('body').addPrimitive(prim)).setSkin(skin);
  return { rig: doc.createNode('rig').addChild(hips).addChild(body), knee, body, prim };
}

describe('measureGround', () => {
  it('fails an empty root at 0.15 m over geometry that reaches the ground, the old Bolt, declared or not', async () => {
    const doc = new Document();
    sceneOf(doc).addChild(bolt(doc, false));
    // As in the shipped file, the quantizer moves the mesh of a node with children onto a new child, so the root
    // becomes an empty at mid-plinth.
    await doc.transform(quantize());
    const measured = measureGround(doc);
    expect(measured).toEqual({ asset: 0, nodes: [{ name: 'bolt_mk1', empty: true, minY: -0.15 }] });
    const sunk = ["ground 'bolt_mk1': lowest point -0.1500 m sinks (limit -0.0050)"];
    expect(groundFailures(groundEntries([{ node: 'bolt_mk1', sink: 0 }], measured))).toEqual(sunk);
    // Undeclared, the whole asset stands on the ground, but the root is a top-level empty and is checked as a handle.
    expect(groundFailures(groundEntries([], measured))).toEqual(sunk);
    // No declared sink hides that root: 0.15 m is over the cap, and under the 0.14 m cap the root still sinks past it.
    expect(groundFailures(groundEntries([{ node: 'bolt_mk1', sink: 0.15 }], measured))).toEqual([
      "ground 'bolt_mk1': sink 0.15 m > 0.14 m",
    ]);
    expect(groundFailures(groundEntries([{ node: 'bolt_mk1', sink: 0.14 }], measured))).toEqual([
      "ground 'bolt_mk1': lowest point -0.1500 m sinks (limit -0.1450)",
    ]);
  });

  it('passes the same geometry under a root on the ground, the plinth keeping its origin under it', async () => {
    const doc = new Document();
    sceneOf(doc).addChild(bolt(doc, true));
    await doc.transform(quantize());
    const measured = measureGround(doc);
    expect(measured).toEqual({ asset: 0, nodes: [{ name: 'bolt_mk1', empty: true, minY: 0 }] });
    expect(groundFailures(groundEntries([{ node: 'bolt_mk1', sink: 0 }], measured))).toEqual([]);
    const base = doc.getRoot().listNodes().find((node) => node.getName() === 'bolt_mk1_base');
    expect(base?.getTranslation()[1]).toBeCloseTo(0.15, 6);
  });

  it('measures a quantized mesh node from the asset origin, its translation being a dequantization', async () => {
    const doc = new Document();
    const rock = doc.createNode('rock').setMesh(doc.createMesh().addPrimitive(box(doc, 0, 0.8)));
    const marker = doc.createNode('marker').setTranslation([2, 1, 0]);
    sceneOf(doc).addChild(rock).addChild(marker);
    await doc.transform(quantize());
    // The quantizer replaced the rock's authored origin with its quantization box's centre and scale; measured from
    // that translation, its lowest point would read -0.4 and fail.
    expect(rock.getTranslation()[1]).toBeCloseTo(0.4, 6);
    expect(rock.getScale()[1]).toBeCloseTo(0.5, 6);
    const measured = measureGround(doc);
    expect(measured).toEqual({
      asset: 0,
      nodes: [
        { name: 'rock', empty: false, minY: 0 },
        { name: 'marker', empty: true, minY: null },
      ],
    });
    // The marker has no geometry to stand on the ground, so it is no placement handle.
    expect(groundEntries([{ node: 'rock', sink: 0 }], measured)).toEqual([{ node: 'rock', minY: 0, sink: 0 }]);
  });

  it('measures through every rotation between a top-level empty and its mesh, tilted and nested', async () => {
    // A sign: its root 2 m up, an arm 0.5 m over the root leaning 30 degrees about z, and on the arm a plate 1 m square
    // and 0.2 m thick turned 60 degrees about x. The plate's lowest corner, (-0.5, -0.1, +0.5) in its own frame, lands
    // at 0.5 - 0.5 sin 30 - (0.1 cos 60 + 0.5 sin 60) cos 30 = -0.1683 m from the root. Without the terms by which a
    // rotation turns x and z into height, only the plate's thickness would count and put that corner 0.46 m up.
    const doc = new Document();
    const lean = Math.PI / 6;
    const turn = Math.PI / 3;
    const plate = doc.createNode('plate').setRotation(about([1, 0, 0], turn));
    plate.setMesh(doc.createMesh().addPrimitive(box(doc, -0.1, 0.1)));
    const arm = doc.createNode('arm').setTranslation([0, 0.5, 0]).setRotation(about([0, 0, 1], lean)).addChild(plate);
    sceneOf(doc).addChild(doc.createNode('sign').setTranslation([3, 2, 0]).addChild(arm));
    await doc.transform(quantize());
    const expected = 0.5 - 0.5 * Math.sin(lean) - (0.1 * Math.cos(turn) + 0.5 * Math.sin(turn)) * Math.cos(lean);
    const measured = measureGround(doc);
    expect(measured.nodes).toEqual([{ name: 'sign', empty: true, minY: expect.closeTo(expected, 3) }]);
    expect(measured.asset).toBeCloseTo(2 + expected, 3);
  });

  it('counts only the vertices its indices draw: an unreferenced vertex 10 m down does not sink the rock', () => {
    const doc = new Document();
    const prim = box(doc, 0, 0.8);
    const position = prim.getAttribute('POSITION');
    position?.setArray(new Float32Array([...(position?.getArray() ?? []), 0, -10, 0]));
    expect(position?.getCount()).toBe(9);
    sceneOf(doc).addChild(doc.createNode('rock').setMesh(doc.createMesh().addPrimitive(prim)));
    expect(measureGround(doc)).toEqual({ asset: 0, nodes: [{ name: 'rock', empty: false, minY: 0 }] });
  });

  it('measures a skinned mesh through its skin, where the quantizer put the dequantization', async () => {
    const doc = new Document();
    const { rig, body } = leg(doc);
    const scene = sceneOf(doc).addChild(rig);
    await doc.transform(quantize());
    // glTF ignores a skinned mesh node's transform, so the quantizer scaled and offset the inverse bind matrices
    // instead.
    expect(body.getTranslation()).toEqual([0, 0, 0]);
    expect(body.getSkin()?.getInverseBindMatrices()?.getElement(1, [])[13]).toBeCloseTo(0.3, 6);
    // getBounds reads only node transforms: it takes the quantized positions, -1 to 1, for metres.
    expect(getBounds(scene).min[1]).toBeCloseTo(-1, 3);
    expect(measureGround(doc)).toEqual({ asset: 0, nodes: [{ name: 'rig', empty: true, minY: 0 }] });
  });

  it('weights a skinned vertex as three r186 draws it: scaled to sum to 1, or wholly on its first joint', () => {
    // Saved out of its bind pose, with the knee 0.2 m under where it was bound. Lower corners 1 to 3 hang 0.3 on the
    // knee and 0.3 on the hips, which three's loader scales to 0.5 each, so they stand at 0.5 x -0.2 = -0.1 m (-0.06
    // unscaled). Corner 0 carries no weight, and the loader binds it wholly to its first joint, here the hips, at 0.
    const corners = (first: number[], lower: number[], upper: number[]) =>
      [first, lower, lower, lower, upper, upper, upper, upper].flat();
    const joints = corners([0, 1, 0, 0], [1, 0, 0, 0], [0, 0, 0, 0]);
    const weights = corners([0, 0, 0, 0], [0.3, 0.3, 0, 0], [1, 0, 0, 0]);
    const doc = new Document();
    const { rig, knee, prim } = leg(doc, joints, weights);
    knee.setTranslation([0, -0.7, 0]);
    sceneOf(doc).addChild(rig);
    expect(measureGround(doc)).toEqual({ asset: -0.1, nodes: [{ name: 'rig', empty: true, minY: -0.1 }] });
    // With the knee named first, corner 0 follows it down to -0.2 m. Skipped as a vertex drawn at the origin, it read
    // -0.1.
    prim.getAttribute('JOINTS_0')?.setElement(0, [1, 0, 0, 0]);
    expect(measureGround(doc)).toEqual({ asset: -0.2, nodes: [{ name: 'rig', empty: true, minY: -0.2 }] });
  });

  it('refuses a skinned primitive with an influence set three r186 does not skin with, naming asset and node', () => {
    const doc = new Document();
    const { rig, prim } = leg(doc);
    sceneOf(doc).addChild(rig);
    // Eight influences per vertex: glTF allows JOINTS_1 and WEIGHTS_1, which three loads but never skins with.
    prim
      .setAttribute('JOINTS_1', accessor(doc, 'VEC4', new Uint8Array(32)))
      .setAttribute('WEIGHTS_1', accessor(doc, 'VEC4', new Float32Array(32)));
    expect(() => measureGround(doc, 'husk.glb')).toThrow(
      "husk.glb: primitive 0 of mesh 'body' on node 'body' is skinned with JOINTS_0, JOINTS_1, WEIGHTS_0, WEIGHTS_1; " +
        'three r186 skins with JOINTS_0 and WEIGHTS_0 alone',
    );
    // Without JOINTS_0 three would draw the primitive unskinned; it was skipped here as though it had no vertices.
    prim.setAttribute('JOINTS_1', null).setAttribute('WEIGHTS_1', null).setAttribute('JOINTS_0', null);
    expect(() => measureGround(doc, 'husk.glb')).toThrow("on node 'body' is skinned with WEIGHTS_0;");
  });

  it('refuses a primitive with morph targets, whose weights move the vertices it measures', () => {
    const doc = new Document();
    const prim = box(doc, 0, 1);
    const lift = accessor(doc, 'VEC3', new Float32Array(24));
    prim.addTarget(doc.createPrimitiveTarget('lift').setAttribute('POSITION', lift));
    sceneOf(doc).addChild(doc.createNode('nest').setMesh(doc.createMesh('nest').addPrimitive(prim)));
    expect(() => measureGround(doc, 'nest.glb')).toThrow(
      "nest.glb: primitive 0 of mesh 'nest' on node 'nest' has 1 morph target(s)",
    );
  });

  it('refuses a top-level empty with geometry under it that carries a rotation, and lets a marker turn', () => {
    const doc = new Document();
    const rock = doc.createNode('rock').setMesh(doc.createMesh().addPrimitive(box(doc, 0, 1)));
    const marker = doc.createNode('rally_point').setTranslation([4, 0, 0]).setRotation(about([0, 1, 0], 0.3));
    const scene = sceneOf(doc).addChild(rock).addChild(marker);
    // The marker has nothing to stand on the ground, so its rotation leaves no ground contact to mislead.
    expect(measureGround(doc).nodes).toEqual([
      { name: 'rock', empty: false, minY: 0 },
      { name: 'rally_point', empty: true, minY: null },
    ]);
    // The runtime replaces a handle's rotation when it places it, so a tilt the file carries is never drawn.
    const base = doc.createNode('bolt_mk1_base').setMesh(doc.createMesh().addPrimitive(box(doc, 0, 0.3)));
    scene.addChild(doc.createNode('bolt_mk1').setRotation(about([1, 0, 0], 0.2)).addChild(base));
    expect(() => measureGround(doc, 'bolt_sentinel.glb')).toThrow(
      "bolt_sentinel.glb: top-level empty 'bolt_mk1' carries a rotation (quaternion 0.0998, 0.0000, 0.0000, 0.9950)",
    );
  });
});
