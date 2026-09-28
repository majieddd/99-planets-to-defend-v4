import { fileURLToPath } from 'node:url';
import type { Document } from '@gltf-transform/core';
import { Texture, Vector3, type Group, type Mesh, type MeshStandardMaterial, type ShaderMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCommanderFace, holdFacePose } from '../../../src/labs/shared/commanderFace';
import type { EyeState } from '../../../src/labs/shared/faceDriver';
import { decalAtlasOf, paintAndInk } from '../../../src/render/assets/loadAsset';
import { DEFAULT_DIALS } from '../../../src/render/defaults';
import { createHullMaterial, createInkUniforms } from '../../../src/render/ink/hull';
import { LAYERS } from '../../../src/render/layers';
import { createPaintUniforms } from '../../../src/render/materials/painted';
import { VERDANT } from '../../../src/render/themes';
import { assetIO } from '../../../tools/assets/optimize.mjs';

// The anime head test, the study's expression-atlas head on Pip-A's body, as the build's own optimizeGlb shipped it to
// public/assets-preview (a tech-validation preview outside the manifest; src/labs/style/main.ts, ANIME_URL), and as three
// r186's GLTFLoader delivers it. Node has no image decoder, so the textures are dropped before parsing; their format and
// the materials' alpha are read from the document first.
const FILE = fileURLToPath(new URL('../../../public/assets-preview/commander_anime_test.glb', import.meta.url));

/**
 * Source vertices of the study export (_scratch/m1-commander-anime/export/commander_anime_test.glb, 2.87 MB, not in the
 * repository), taken evenly by index from the face, where _INK is 0, and from both decals: the skinned bind-pose position
 * in metres and the authored normal, to 5 decimals. The face's normals are custom (a proxy ellipsoid blended over the
 * geometry's own), so a weld, a recomputation or a coarser quantization in the pipeline would move them. A new export of
 * the head needs this list taken again, as the processing script in the study's scratch folder writes it.
 */
const SOURCE_NORMALS: readonly [string, number, number, number, number, number, number][] = [
  ['head_skin', -0.00084, 1.44581, 0.00598, -0.0286, -0.98591, 0.1648],
  ['head_skin', -0.01307, 1.44797, -0.00477, -0.38291, -0.92373, 0.0095],
  ['head_skin', 0.01307, 1.44797, -0.00477, 0.38291, -0.92373, 0.0095],
  ['head_skin', 0.01584, 1.45154, 0.0141, 0.359, -0.88411, 0.2991],
  ['head_skin', 0.01362, 1.4565, 0.03061, 0.21109, -0.81497, 0.53968],
  ['head_skin', 0.00456, 1.4628, 0.04516, 0.0565, -0.73577, 0.67487],
  ['head_skin', 0, 1.47036, 0.05458, 0, -0.67045, 0.74195],
  ['head_skin', -0.00675, 1.47913, 0.0625, -0.0789, -0.60268, 0.79407],
  ['head_skin', -0.01569, 1.48902, 0.0684, -0.17999, -0.53078, 0.82817],
  ['head_skin', -0.02665, 1.49993, 0.07183, -0.29949, -0.45418, 0.83906],
  ['head_skin', -0.03927, 1.51175, 0.07235, -0.43021, -0.37311, 0.82202],
  ['head_skin', -0.05302, 1.52437, 0.06951, -0.56251, -0.28931, 0.77452],
  ['head_skin', -0.06715, 1.53768, 0.06292, -0.68619, -0.2055, 0.69779],
  ['head_skin', -0.05093, 1.55154, 0.08033, -0.5288, -0.1315, 0.8385],
  ['head_skin', 0.0278, 1.56582, 0.09102, 0.2995, -0.0537, 0.95259],
  ['head_skin', -0.09786, 1.59508, 0.0446, -0.86459, -0.1002, 0.49239],
  ['head_skin', -0.01468, 1.60979, 0.10435, -0.1456, 0.1851, 0.97188],
  ['head_skin', 0.07837, 1.62435, 0.07166, 0.71009, 0.2057, 0.67339],
  ['head_skin', 0, 1.51695, 0.08969, 0, -0.709, 0.7052],
  ['head_skin', 0, 1.5204, 0.09549, 0, -0.41521, 0.90972],
  ['head_skin', 0, 1.52998, 0.09899, 0, -0.0397, 0.99921],
  ['head_skin', 0, 1.53635, 0.09677, 0, 0.2053, 0.9787],
  ['head_skin', 0, 1.49343, 0.01428, -0.1771, 0.37999, 0.90788],
  ['head_skin', -0.01276, 1.50692, 0.00615, -0.1771, 0.37999, 0.90788],
  ['face_eyes', 0.05738, 1.5323, 0.07125, 0.59382, -0.23821, 0.76853],
  ['face_eyes', -0.01435, 1.54655, 0.09428, -0.1541, -0.16471, 0.97423],
  ['face_eyes', -0.08598, 1.56083, 0.05167, -0.8168, -0.0729, 0.5723],
  ['face_eyes', 0.02153, 1.56795, 0.09381, 0.2314, -0.0413, 0.97198],
  ['face_eyes', -0.05019, 1.58221, 0.08667, -0.50672, 0.0387, 0.86124],
  ['face_eyes', 0.05734, 1.58934, 0.08535, 0.5606, 0.0749, 0.82469],
  ['face_eyes', -0.01434, 1.6036, 0.10397, -0.1435, 0.1535, 0.97767],
  ['face_eyes', -0.08591, 1.61783, 0.06459, -0.76121, 0.2036, 0.61571],
  ['face_mouth', 0.03383, 1.47126, 0.03577, 0.4149, -0.6847, 0.5992],
  ['face_mouth', 0.00676, 1.48475, 0.0686, 0.0773, -0.55569, 0.82779],
  ['face_mouth', -0.02027, 1.4982, 0.07483, -0.22639, -0.46168, 0.85767],
  ['face_mouth', 0.04054, 1.50492, 0.06768, 0.44741, -0.41651, 0.79142],
];

let doc: Document;
let scene: Group;

beforeAll(async () => {
  const io = await assetIO();
  doc = await io.read(FILE);
  const bare = await io.read(FILE);
  for (const texture of bare.getRoot().listTextures()) texture.dispose();
  const bytes = await io.writeBinary(bare);
  await MeshoptDecoder.ready;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
  scene = gltf.scene;
  scene.updateMatrixWorld(true);
});

/** The study names its head meshes face_eyes.001 and so on, which GLTFLoader sanitizes to face_eyes001. */
function mesh(feature: string): Mesh {
  let found: Mesh | null = null;
  scene.traverse((object) => {
    if (!found && (object as Mesh).isMesh && object.name.startsWith(feature)) found = object as Mesh;
  });
  if (!found) throw new Error(`no mesh named ${feature}`);
  return found;
}

const degrees = (a: Vector3, b: Vector3) => (Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) * 180) / Math.PI;

describe('the anime head test through the build and GLTFLoader', () => {
  it('finds both expression decals by their p99_atlas extras, which the optimize step kept', () => {
    // The study's extras also carry row (the atlas row the UVs already point at) and an offset note; the reader ignores
    // both, and since each feature's states run along its own row, the offset from cell 0 moves along u alone.
    expect(decalAtlasOf(mesh('face_eyes'), scene)).toEqual({ cols: 4, rows: 2, states: ['open', 'half', 'closed', 'happy'], cellUV: [0.25, 0.5], role: 'eyes' });
    expect(decalAtlasOf(mesh('face_mouth'), scene)).toEqual({ cols: 4, rows: 2, states: ['neutral', 'smile', 'open', 'small_o'], cellUV: [0.25, 0.5], role: 'mouth' });
    expect(decalAtlasOf(mesh('head_skin'), scene)).toBeNull();
    expect(decalAtlasOf(mesh('head_hair'), scene)).toBeNull();
  });

  it('keeps alpha MASK at a cutoff of 0.5 on the decals, over an atlas the build turned to WebP', () => {
    const decals = doc
      .getRoot()
      .listMeshes()
      .filter((m) => /face_(eyes|mouth)/.test(m.getName()))
      .map((m) => m.listPrimitives()[0]!.getMaterial()!);
    expect(decals).toHaveLength(2);
    for (const material of decals) {
      expect([material.getAlphaMode(), material.getAlphaCutoff()]).toEqual(['MASK', 0.5]);
      expect(material.getBaseColorTexture()?.getMimeType()).toBe('image/webp');
      expect(material.getBaseColorTexture()?.getSize()).toEqual([2048, 512]);
    }
    for (const feature of ['face_eyes', 'face_mouth']) expect((mesh(feature).material as MeshStandardMaterial).alphaTest).toBe(0.5);
  });

  it('delivers _SKIN and _INK as _skin and _ink on every head mesh, with the face full skin and free of hull ink', () => {
    for (const feature of ['head_skin', 'head_hair', 'face_eyes', 'face_mouth']) {
      const names = Object.keys(mesh(feature).geometry.attributes).filter((name) => name.startsWith('_'));
      expect(names.sort(), feature).toEqual(['_ink', '_skin']);
    }
    const skin = mesh('head_skin').geometry;
    const ink = skin.getAttribute('_ink');
    const weight = skin.getAttribute('_skin');
    let face = 0;
    for (let i = 0; i < ink.count; i++) {
      if (ink.getX(i) >= 0.5) continue;
      face++;
      expect(weight.getX(i)).toBeGreaterThan(0.99);
    }
    expect(face).toBeGreaterThan(500);
    for (const feature of ['face_eyes', 'face_mouth']) {
      const decalInk = mesh(feature).geometry.getAttribute('_ink');
      for (let i = 0; i < decalInk.count; i++) expect(decalInk.getX(i)).toBe(0);
    }
  });

  it('ships the custom face normals within 0.15 degrees of the source, where three would compute them 20 degrees away', () => {
    const shipped = new Map<string, { positions: Vector3[]; normals: Vector3[] }>();
    for (const feature of ['head_skin', 'face_eyes', 'face_mouth']) {
      const m = mesh(feature);
      const normal = m.geometry.getAttribute('normal');
      const positions: Vector3[] = [];
      const normals: Vector3[] = [];
      // The bind pose through the skin, so the quantizer's offset, which it folds into the skin's inverse bind matrices,
      // drops out and the positions compare with the source's in metres.
      for (let i = 0; i < normal.count; i++) {
        positions.push(m.getVertexPosition(i, new Vector3()));
        normals.push(new Vector3(normal.getX(i), normal.getY(i), normal.getZ(i)).normalize());
      }
      shipped.set(feature, { positions, normals });
    }
    let worst = 0;
    for (const [feature, x, y, z, nx, ny, nz] of SOURCE_NORMALS) {
      const { positions, normals } = shipped.get(feature)!;
      const at = new Vector3(x, y, z);
      const want = new Vector3(nx, ny, nz).normalize();
      let best = Infinity;
      // 0.1 mm covers the 5-decimal rounding of the list and the 14-bit position step on a head this size.
      positions.forEach((p, i) => {
        if (p.distanceTo(at) < 1e-4) best = Math.min(best, degrees(normals[i]!, want));
      });
      expect(best, `${feature} at ${at.toArray()}`).toBeLessThan(0.15);
      worst = Math.max(worst, best);
    }
    // 10-bit normals bound the error near 0.1 degrees; the processing measured 0.087 at worst over every head vertex.
    expect(worst).toBeLessThan(0.15);
    // Custom: on the face, the shipped normals part from what three computes from the shipped triangles by up to 75
    // degrees (median 6), so a pipeline that recomputed them would fail the comparison above by far more than its bound.
    const skin = mesh('head_skin').geometry;
    const computed = skin.clone();
    computed.computeVertexNormals();
    const ink = skin.getAttribute('_ink');
    let largest = 0;
    for (let i = 0; i < ink.count; i++) {
      if (ink.getX(i) >= 0.5) continue;
      const a = new Vector3().fromBufferAttribute(skin.getAttribute('normal'), i).normalize();
      const b = new Vector3().fromBufferAttribute(computed.getAttribute('normal'), i).normalize();
      largest = Math.max(largest, degrees(a, b));
    }
    expect(largest).toBeGreaterThan(20);
  });

  it('paints the decals apart and blinks the eyes through their cells by state', () => {
    const ctx = { paint: createPaintUniforms(VERDANT, DEFAULT_DIALS, new Texture()), hullMaterial: createHullMaterial(createInkUniforms(DEFAULT_DIALS)), hullLayer: LAYERS.hull };
    paintAndInk(scene, ctx, 0.35);
    const eyes = mesh('face_eyes');
    const mouth = mesh('face_mouth');
    for (const decal of [eyes, mouth]) {
      const material = decal.material as ShaderMaterial;
      expect(material.defines['PAINT_DECAL']).toBe('');
      expect(material.uniforms['uAlphaTest']!.value).toBe(0.5);
      expect([decal.layers.mask, decal.children.length, decal.castShadow]).toEqual([1 << LAYERS.noEdge, 0, false]);
    }
    // The two decals shared one source material after the build's dedup; each still holds its own painted one.
    expect(eyes.material).not.toBe(mouth.material);
    expect(mesh('head_skin').children.map((child) => child.name)).toEqual([`${mesh('head_skin').name}_hull`]);

    const face = createCommanderFace(scene, 1)!;
    expect([face.faceKind, face.decals.length]).toEqual(['decal', 2]);
    const offset = (m: Mesh) => (m.material as ShaderMaterial).uniforms['uCellOffset']!.value.toArray();
    holdFacePose(face, { eyes: 'closed' });
    expect([offset(eyes), offset(mouth)]).toEqual([[0.5, 0], [0, 0]]);
    holdFacePose(face, { mouth: 'smile' });
    expect([offset(eyes), offset(mouth)]).toEqual([[0, 0], [0.25, 0]]);
    holdFacePose(face, { eyes: 'happy' });
    expect(offset(eyes)).toEqual([0.75, 0]);

    // Back on the auto-blink: the first blink, stepped at 240 Hz, shows open, half, closed, half, open, and the eyes'
    // cell follows each state along the atlas row.
    holdFacePose(face, null);
    const seen: [EyeState, number][] = [[face.eyes, offset(eyes)[0]!]];
    for (let t = 0; t < 6 && seen.length < 5; t += 1 / 240) {
      face.update(1 / 240);
      if (face.eyes !== seen.at(-1)![0]) seen.push([face.eyes, offset(eyes)[0]!]);
    }
    expect(seen).toEqual([['open', 0], ['half', 0.25], ['closed', 0.5], ['half', 0.25], ['open', 0]]);
  });
});
