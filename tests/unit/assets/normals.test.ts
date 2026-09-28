import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO, type Node, type TypedArray } from '@gltf-transform/core';
import { Group, Mesh, Texture, Vector3, type BufferAttribute, type ShaderMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decalAtlasOf, paintAndInk } from '../../../src/render/assets/loadAsset';
import { DEFAULT_DIALS } from '../../../src/render/defaults';
import { createHullMaterial, createInkUniforms } from '../../../src/render/ink/hull';
import { LAYERS } from '../../../src/render/layers';
import { createPaintUniforms } from '../../../src/render/materials/painted';
import { VERDANT } from '../../../src/render/themes';
import { optimizeGlb } from '../../../tools/assets/optimize.mjs';

// A synthetic anime head, written as Blender's raw GLB and shipped through the build's own optimizeGlb, then loaded by
// three r186's GLTFLoader, to follow authored normals through every step to the renderer. Its face carries
// proxy-ellipsoid custom normals, the normals of a flattened ellipsoid blended in over the front, which differ from the
// sphere's own by up to about 25 degrees; its back is faceted, every triangle with its own three vertices and flat
// normal, so every back position holds several vertices whose normals differ and any weld would show.

const dir = mkdtempSync(join(tmpdir(), 'p99-normals-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type V3 = [number, number, number];
const R = 0.12;
const LIFT = 0.0005;
const HEAD_AT: V3 = [0, 1.45, 0.02];
const length = (v: V3) => Math.hypot(v[0], v[1], v[2]);
const normalize = (v: V3): V3 => {
  const l = length(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const degrees = (a: V3, b: V3) => (Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;

/** The face weight: 1 over the front of the head (+z), 0 behind, soft between. */
const faceWeight = (p: V3) => smoothstep(-0.2, 0.4, p[2] / length(p));

/** The proxy-ellipsoid normal: the normal of an ellipsoid 1 wide, 1.1 tall and 0.6 deep, blended in by the face weight. */
function proxyNormal(p: V3): V3 {
  const g = normalize(p);
  const e = normalize([p[0], p[1] / 1.21, p[2] / 0.36]);
  const w = faceWeight(p);
  return normalize([g[0] + (e[0] - g[0]) * w, g[1] + (e[1] - g[1]) * w, g[2] + (e[2] - g[2]) * w]);
}

const sphere = (theta: number, phi: number, r: number): V3 => [r * Math.sin(theta) * Math.sin(phi), r * Math.cos(theta), r * Math.sin(theta) * Math.cos(phi)];

interface Raw {
  positions: V3[];
  normals: V3[];
  uvs: [number, number][];
  indices: number[];
}

// The skin: a UV sphere, smooth with proxy normals where a quad faces forward, faceted behind.
function headSkin(lat = 24, lon = 32): Raw {
  const raw: Raw = { positions: [], normals: [], uvs: [], indices: [] };
  const grid = (i: number, j: number) => i * (lon + 1) + j;
  for (let i = 0; i <= lat; i++) {
    for (let j = 0; j <= lon; j++) {
      const p = sphere((Math.PI * i) / lat, (2 * Math.PI * j) / lon, R);
      raw.positions.push(p);
      raw.normals.push(proxyNormal(p));
      raw.uvs.push([j / lon, i / lat]);
    }
  }
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lon; j++) {
      const quad = [grid(i, j), grid(i + 1, j), grid(i + 1, j + 1), grid(i, j + 1)];
      const tris = [[quad[0]!, quad[1]!, quad[2]!], [quad[0]!, quad[2]!, quad[3]!]];
      const front = Math.cos((2 * Math.PI * (j + 0.5)) / lon) > 0;
      for (const tri of tris) {
        const [a, b, c] = tri.map((k) => raw.positions[k]!) as [V3, V3, V3];
        // Skip the degenerate triangles at the poles.
        const cross: V3 = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
        if (length(cross) < 1e-12) continue;
        if (front) {
          raw.indices.push(...tri);
          continue;
        }
        const flat = normalize(cross);
        for (const k of tri) {
          raw.indices.push(raw.positions.length);
          raw.positions.push(raw.positions[k]!);
          raw.normals.push(flat);
          raw.uvs.push(raw.uvs[k]!);
        }
      }
    }
  }
  return raw;
}

// A decal patch lifted LIFT off the skin, with the skin's proxy normals, its UVs spanning cell 0 of a cols x rows atlas.
function decalPatch(theta: [number, number], phi: [number, number], cols: number, rows: number, steps = 8): Raw {
  const raw: Raw = { positions: [], normals: [], uvs: [], indices: [] };
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const p = sphere(theta[0] + ((theta[1] - theta[0]) * i) / steps, phi[0] + ((phi[1] - phi[0]) * j) / steps, R + LIFT);
      raw.positions.push(p);
      raw.normals.push(proxyNormal(p));
      raw.uvs.push([j / steps / cols, i / steps / rows]);
    }
  }
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const a = i * (steps + 1) + j;
      raw.indices.push(a, a + steps + 1, a + steps + 2, a, a + steps + 2, a + 1);
    }
  }
  return raw;
}

const SKIN = headSkin();
const EYES = decalPatch([1.25, 1.45], [-0.5, 0.5], 4, 1);
const MOUTH = decalPatch([1.75, 1.9], [-0.3, 0.3], 2, 2);
const EYES_ATLAS = { cols: 4, rows: 1, states: ['open', 'half', 'closed', 'happy'], cellUV: [0.25, 1] };
const MOUTH_ATLAS = { cols: 2, rows: 2, states: ['neutral', 'smile', 'talk', 'o'] };

function accessor(doc: Document, type: 'SCALAR' | 'VEC2' | 'VEC3', array: TypedArray) {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  return doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
}

function meshNode(doc: Document, name: string, raw: Raw, material: ReturnType<Document['createMaterial']>, skin: boolean): Node {
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', accessor(doc, 'VEC3', new Float32Array(raw.positions.flat())))
    .setAttribute('NORMAL', accessor(doc, 'VEC3', new Float32Array(raw.normals.flat())))
    .setAttribute('TEXCOORD_0', accessor(doc, 'VEC2', new Float32Array(raw.uvs.flat())))
    .setIndices(accessor(doc, 'SCALAR', new Uint16Array(raw.indices)))
    .setMaterial(material);
  if (skin) {
    prim.setAttribute('_SKIN', accessor(doc, 'SCALAR', new Float32Array(raw.positions.map(faceWeight))));
    prim.setAttribute('_INK', accessor(doc, 'SCALAR', new Float32Array(raw.positions.length).fill(0.5)));
  }
  return doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim));
}

function headDocument(): Document {
  const doc = new Document();
  const skinMaterial = doc.createMaterial('skin').setBaseColorFactor([0.85, 0.62, 0.5, 1]);
  const decalMaterial = doc.createMaterial('face').setAlphaMode('MASK').setAlphaCutoff(0.5);
  const head = doc.createNode('head').setTranslation(HEAD_AT);
  head.addChild(meshNode(doc, 'head_skin', SKIN, skinMaterial, true));
  head.addChild(meshNode(doc, 'face_eyes', EYES, decalMaterial, false).setExtras({ p99_atlas: EYES_ATLAS }));
  // A decal node with a child, which the build's quantizer answers by moving the mesh onto a new child node.
  const mouth = meshNode(doc, 'face_mouth', MOUTH, decalMaterial, false).setExtras({ p99_atlas: MOUTH_ATLAS });
  mouth.addChild(doc.createNode('mouth_corner').setTranslation([0.03, 0, 0.1]));
  head.addChild(mouth);
  const scene = doc.createScene().addChild(head);
  doc.getRoot().setDefaultScene(scene);
  return doc;
}

let scene: Group;
const meshes: Record<string, Mesh> = {};

beforeAll(async () => {
  const raw = join(dir, 'head.raw.glb');
  const shipped = join(dir, 'head.glb');
  writeFileSync(raw, await new NodeIO().writeBinary(headDocument()));
  await optimizeGlb(raw, shipped);
  const bytes = readFileSync(shipped);
  await MeshoptDecoder.ready;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
  scene = gltf.scene;
  scene.updateMatrixWorld(true);
  scene.traverse((object) => {
    if ((object as Mesh).isMesh) meshes[object.name] = object as Mesh;
  });
});

/** The vertices the triangles use: the build drops the rest (the back's grid, whose faceted copies stand in for it). */
const used = (raw: Raw) => [...new Set(raw.indices)];

/**
 * For every authored vertex, the shipped vertices at its place (within 0.1 mm, well over the 14-bit position step of
 * about 0.02 mm on this head) and the smallest angle between their normals and its own, then the worst of those. A weld
 * of vertices whose normals differ would leave some authored vertex with only a far normal to match, and fail.
 */
function worstNormalError(raw: Raw, mesh: Mesh): { worst: number; mean: number; uvWorst: number } {
  const position = mesh.geometry.getAttribute('position') as BufferAttribute;
  const normal = mesh.geometry.getAttribute('normal') as BufferAttribute;
  const uv = mesh.geometry.getAttribute('uv') as BufferAttribute;
  const cell = 2e-4;
  const buckets = new Map<string, number[]>();
  const key = (p: Vector3) => [p.x, p.y, p.z].map((c) => Math.floor(c / cell)).join();
  const world = new Vector3();
  const shipped: Vector3[] = [];
  for (let i = 0; i < position.count; i++) {
    world.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    shipped.push(world.clone());
    const k = key(world);
    buckets.set(k, [...(buckets.get(k) ?? []), i]);
  }
  let worst = 0;
  let sum = 0;
  let uvWorst = 0;
  const vertices = used(raw);
  for (const v of vertices) {
    const p = raw.positions[v]!;
    const at = new Vector3(p[0] + HEAD_AT[0], p[1] + HEAD_AT[1], p[2] + HEAD_AT[2]);
    const [bx, by, bz] = [at.x, at.y, at.z].map((c) => Math.floor(c / cell)) as V3;
    let best = Infinity;
    let bestUv = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const i of buckets.get([bx + dx, by + dy, bz + dz].join()) ?? []) {
            if (shipped[i]!.distanceTo(at) > 1e-4) continue;
            const angle = degrees(raw.normals[v]!, normalize([normal.getX(i), normal.getY(i), normal.getZ(i)]));
            const uvError = Math.max(Math.abs(uv.getX(i) - raw.uvs[v]![0]), Math.abs(uv.getY(i) - raw.uvs[v]![1]));
            // The UV seam holds two vertices with one normal at each place, u 0 and u 1, so a tie goes to the nearer UV.
            if (angle < best - 1e-6 || (Math.abs(angle - best) <= 1e-6 && uvError < bestUv)) {
              best = angle;
              bestUv = uvError;
            }
          }
        }
      }
    }
    worst = Math.max(worst, best);
    uvWorst = Math.max(uvWorst, bestUv);
    sum += best;
  }
  return { worst, mean: sum / vertices.length, uvWorst };
}

describe('authored normals through the asset build and the loader', () => {
  it('are custom: the face normals differ from the sphere and from what three would compute by up to about 25 degrees', () => {
    const geometric = Math.max(...SKIN.positions.map((p, v) => degrees(normalize(p), SKIN.normals[v]!)));
    expect(geometric).toBeGreaterThan(20);
    const recomputed = meshes['head_skin']!.geometry.clone();
    recomputed.computeVertexNormals();
    const shippedNormals = meshes['head_skin']!.geometry.getAttribute('normal');
    let largest = 0;
    for (let i = 0; i < shippedNormals.count; i++) {
      const a = normalize([shippedNormals.getX(i), shippedNormals.getY(i), shippedNormals.getZ(i)]);
      const n = recomputed.getAttribute('normal');
      largest = Math.max(largest, degrees(a, normalize([n.getX(i), n.getY(i), n.getZ(i)])));
    }
    expect(largest).toBeGreaterThan(20);
  });

  it('ship every vertex, unwelded, with its authored normal within 0.15 degrees and its UV within 0.25 of a 1,024 px texel', () => {
    const cases: [string, Raw][] = [['head_skin', SKIN], ['face_eyes', EYES], ['face_mouth_1', MOUTH]];
    for (const [name, raw] of cases) {
      const mesh = meshes[name]!;
      expect(mesh, name).toBeDefined();
      // reorder drops only the vertices no triangle uses, so a count equal to the used ones means no weld.
      expect(mesh.geometry.getAttribute('position').count, name).toBe(used(raw).length);
      const { worst, mean, uvWorst } = worstNormalError(raw, mesh);
      // meshopt 'medium' quantizes NORMAL to 10 bits (signed, 1/511 a step), which bounds the error at about 0.1 degrees.
      expect(worst, `${name} worst normal error, degrees`).toBeLessThan(0.15);
      expect(mean, name).toBeLessThan(0.08);
      // TEXCOORD goes to 12 bits (1/4095 a step): an atlas cell's UVs move by under a quarter of a 1,024 px texel.
      expect(uvWorst, name).toBeLessThan(0.25 / 1024);
      console.log(`${name}: ${used(raw).length} vertices, worst normal error ${worst.toFixed(4)} degrees, mean ${mean.toFixed(4)}, worst UV error ${(uvWorst * 1024).toFixed(3)} px of 1,024`);
    }
  });

  it('reach the renderer untouched through paintAndInk, and the decals keep their p99_atlas extras', () => {
    const eyes = meshes['face_eyes']!;
    // GLTFLoader put the eyes' extras on the mesh itself. The quantizer moved the mouth's mesh onto a new, unnamed child of
    // its node, which has a child of its own, so the loader named the mesh face_mouth_1 and left the extras on the node.
    const mouth = meshes['face_mouth_1']!;
    expect(eyes.userData['p99_atlas']).toEqual(EYES_ATLAS);
    expect(mouth.userData['p99_atlas']).toBeUndefined();
    expect(mouth.parent?.name).toBe('face_mouth');
    expect(mouth.parent?.userData['p99_atlas']).toEqual(MOUTH_ATLAS);
    expect(decalAtlasOf(mouth, scene)).toEqual({ ...MOUTH_ATLAS, cellUV: [0.5, 0.5], role: 'mouth' });
    const before = Object.fromEntries(Object.entries(meshes).map(([name, mesh]) => [name, mesh.geometry.getAttribute('normal')]));
    const ctx = { paint: createPaintUniforms(VERDANT, DEFAULT_DIALS, new Texture()), hullMaterial: createHullMaterial(createInkUniforms(DEFAULT_DIALS)), hullLayer: LAYERS.hull };
    paintAndInk(scene, ctx, 0.35);
    for (const [name, mesh] of Object.entries(meshes)) expect(mesh.geometry.getAttribute('normal'), name).toBe(before[name]);
    expect((eyes.material as ShaderMaterial).defines['PAINT_DECAL']).toBe('');
    expect((mouth.material as ShaderMaterial).defines['PAINT_DECAL']).toBe('');
    expect((meshes['head_skin']!.material as ShaderMaterial).defines['PAINT_DECAL']).toBeUndefined();
    expect(meshes['head_skin']!.children.map((child) => child.name)).toEqual(['head_skin_hull']);
    expect([eyes.children.length, mouth.children.length]).toEqual([0, 0]);
  });
});
