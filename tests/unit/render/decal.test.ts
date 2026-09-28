import { createHash } from 'node:crypto';
import {
  DataTexture,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  SphereGeometry,
  Texture,
  UniformsLib,
  Vector2,
  type ShaderMaterial,
} from 'three';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FaceDriver, type EyeState, type MouthState } from '../../../src/labs/shared/faceDriver';
import { decalAtlasOf, paintAndInk, readDecalAtlas } from '../../../src/render/assets/loadAsset';
import { DEFAULT_DIALS } from '../../../src/render/defaults';
import { createHullMaterial, createInkUniforms } from '../../../src/render/ink/hull';
import { LAYERS } from '../../../src/render/layers';
import {
  copyDecalMaterial,
  createPaintedMaterial,
  createPaintUniforms,
  DECAL_ALPHA_CUTOFF,
  DECAL_POLYGON_OFFSET_FACTOR,
  DECAL_POLYGON_OFFSET_UNITS,
  decalCellOffset,
} from '../../../src/render/materials/painted';
import { VERDANT } from '../../../src/render/themes';
import { createMockRenderer } from './mockWebGl';

const shared = createPaintUniforms(VERDANT, DEFAULT_DIALS, new Texture());
const ctx = { paint: shared, hullMaterial: createHullMaterial(createInkUniforms(DEFAULT_DIALS)), hullLayer: LAYERS.hull };
const painted = (mesh: Mesh) => mesh.material as ShaderMaterial;

afterEach(() => vi.restoreAllMocks());

// A synthetic expression atlas: cols by rows cells of CELL x CELL texels, each cell one colour (its index times 40 in
// red, and 200 minus that in green), with a transparent border a texel wide around an opaque middle, the cutout.
const CELL = 4;
function atlasTexture(cols: number, rows: number): DataTexture {
  const width = cols * CELL;
  const height = rows * CELL;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = Math.floor(y / CELL) * cols + Math.floor(x / CELL);
      const [cx, cy] = [x % CELL, y % CELL];
      const border = cx === 0 || cy === 0 || cx === CELL - 1 || cy === CELL - 1;
      data.set([cell * 40, 200 - cell * 40, 90, border ? 0 : 255], (y * width + x) * 4);
    }
  }
  const texture = new DataTexture(data, width, height, RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

// The fragment shader's texture2D(uMap, vUv) at the nearest texel, with row 0 of the data at v = 0: glTF's UV origin is
// the image's top-left corner and GLTFLoader leaves flipY off, so the data's first row is where v is 0.
function sample(texture: DataTexture, uv: Vector2): [number, number, number, number] {
  const { width, height, data } = texture.image as { width: number; height: number; data: Uint8Array };
  const x = Math.min(width - 1, Math.max(0, Math.floor(uv.x * width)));
  const y = Math.min(height - 1, Math.max(0, Math.floor(uv.y * height)));
  const at = (y * width + x) * 4;
  return [data[at]!, data[at + 1]!, data[at + 2]!, data[at + 3]!];
}

// The UVs of every texel centre in cell 0, where a decal's own UVs point.
function cellZeroUvs(cols: number, rows: number): Vector2[] {
  const out: Vector2[] = [];
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) out.push(new Vector2((x + 0.5) / (cols * CELL), (y + 0.5) / (rows * CELL)));
  return out;
}

// A head in miniature as the anime GLB will arrive through GLTFLoader: head_skin with _skin and _ink, face_eyes and
// face_mouth decals carrying p99_atlas on their own objects, and hair, all with authored normals.
function animeHead(options: { eyesInk?: boolean; eyesSkin?: number; alphaTest?: number } = {}) {
  const skinGeometry = new SphereGeometry(0.12, 24, 16);
  const count = skinGeometry.getAttribute('position').count;
  skinGeometry.setAttribute('_skin', new Float32BufferAttribute(new Array(count).fill(1), 1));
  skinGeometry.setAttribute('_ink', new Float32BufferAttribute(new Array(count).fill(0.5), 1));
  const head = new Mesh(skinGeometry, new MeshStandardMaterial({ color: 0xd9a07f }));
  head.name = 'head_skin';
  const decal = (name: string, cols: number, rows: number, states: string[]) => {
    const geometry = new SphereGeometry(0.1205, 8, 4, 0, 0.6, 1.2, 0.4);
    const n = geometry.getAttribute('position').count;
    if (options.eyesInk) geometry.setAttribute('_ink', new Float32BufferAttribute(new Array(n).fill(0.5), 1));
    if (options.eyesSkin !== undefined && name === 'face_eyes') geometry.setAttribute('_skin', new Float32BufferAttribute(new Array(n).fill(options.eyesSkin), 1));
    const material = new MeshStandardMaterial({ map: atlasTexture(cols, rows), alphaTest: options.alphaTest ?? 0 });
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.userData['p99_atlas'] = { cols, rows, states };
    return mesh;
  };
  const eyes = decal('face_eyes', 4, 1, ['open', 'half', 'closed', 'happy']);
  const mouth = decal('face_mouth', 2, 2, ['neutral', 'smile', 'talk', 'o']);
  const hair = new Mesh(new SphereGeometry(0.13, 12, 8), new MeshStandardMaterial({ color: 0x302018 }));
  hair.name = 'head_hair';
  const root = new Group();
  root.add(head, eyes, mouth, hair);
  return { root, head, eyes, mouth, hair };
}

describe('expression decals in the painted material', () => {
  it('declares the cell offset on decal materials alone, one of its own each, sharing every dial', () => {
    const map = new Texture();
    const a = createPaintedMaterial(shared, { map, standardBlend: 0.35, skin: true, decal: true });
    const b = createPaintedMaterial(shared, { map, standardBlend: 0.35, skin: true, decal: true });
    const plain = createPaintedMaterial(shared, { map, standardBlend: 0.35, skin: true });
    expect(a.uniforms['uCellOffset']?.value).toEqual(new Vector2(0, 0));
    expect(a.uniforms['uCellOffset']).not.toBe(b.uniforms['uCellOffset']);
    expect('uCellOffset' in plain.uniforms).toBe(false);
    expect(a.defines['PAINT_DECAL']).toBe('');
    expect(plain.defines['PAINT_DECAL']).toBeUndefined();
    for (const name of Object.keys(shared)) expect(a.uniforms[name], name).toBe(shared[name]);
    // Cut out at glTF's default unless told otherwise, and pulled toward the camera; the plain material neither.
    expect(DECAL_ALPHA_CUTOFF).toBe(0.5);
    expect(a.uniforms['uAlphaTest']?.value).toBe(DECAL_ALPHA_CUTOFF);
    expect(createPaintedMaterial(shared, { map, decal: true, alphaTest: 0.3 }).uniforms['uAlphaTest']?.value).toBe(0.3);
    expect(plain.uniforms['uAlphaTest']?.value).toBe(0);
    expect([a.polygonOffset, a.polygonOffsetFactor, a.polygonOffsetUnits]).toEqual([true, DECAL_POLYGON_OFFSET_FACTOR, DECAL_POLYGON_OFFSET_UNITS]);
    expect([DECAL_POLYGON_OFFSET_FACTOR, DECAL_POLYGON_OFFSET_UNITS]).toEqual([-1, -4]);
    expect(plain.polygonOffset).toBe(false);
    // Opaque, so the emissive key in alpha stays the bloom's: no blend, no alpha to coverage.
    expect([a.transparent, a.alphaToCoverage]).toEqual([false, false]);
  });

  it('leaves a material without the decal option with exactly the uniforms it had before decals existed', () => {
    const plain = createPaintedMaterial(shared, { map: new Texture(), standardBlend: 0.35, skin: true });
    const expected = [
      ...Object.keys(UniformsLib.lights),
      ...Object.keys(shared),
      'uBaseColor',
      'uMap',
      'uEmissiveMap',
      'uEmissiveColor',
      'uEmissiveIntensity',
      'uStandardBlend',
      'uAlphaTest',
      'uSoilColor',
    ];
    expect(Object.keys(plain.uniforms).sort()).toEqual([...expected].sort());
  });

  it('adds the offset to the UVs inside the decal define, and a material without it compiles the shader it always did', () => {
    const decal = createPaintedMaterial(shared, { map: new Texture(), decal: true });
    const v = decal.vertexShader;
    const f = decal.fragmentShader;
    const offset = v.indexOf('vUv += uCellOffset;');
    expect(offset).toBeGreaterThan(v.indexOf('vUv = uv;'));
    expect(v.lastIndexOf('#ifdef PAINT_DECAL', offset)).toBeGreaterThan(v.lastIndexOf('#endif', offset));
    expect(v).toContain('#ifdef PAINT_DECAL\n  uniform vec2 uCellOffset;\n#endif');
    // The decal skips the broad mip, which would mix its cell with its neighbours, and cuts out on the map's alpha.
    const albedo = f.indexOf('albedo = texel.rgb * vColor;');
    expect(f.lastIndexOf('#ifdef PAINT_DECAL', albedo)).toBeGreaterThan(f.lastIndexOf('#endif', albedo));
    expect(f.slice(albedo).trimStart().split('\n')[1]?.trim()).toBe('#else');
    const alpha = f.indexOf('alpha = texel.a;');
    expect(alpha).toBeGreaterThan(albedo);
    const discard = f.indexOf('if (alpha < uAlphaTest) discard;');
    expect(discard).toBeGreaterThan(alpha);
    expect(discard).toBeLessThan(f.indexOf('float ndl = dot(N, L);'));
    // Every PAINT_DECAL block stripped, its #else kept, as the GLSL preprocessor does without the define: the result
    // is byte for byte the vertex and fragment shaders at 52faa6f, before decals existed.
    const sha = (text: string) => createHash('sha256').update(stripDecal(text)).digest('hex');
    expect(sha(v)).toBe('f176cd5ffccf25370f47b78d7914b5fe6a2ad546a1e407c21714236b7c9281db');
    expect(sha(f)).toBe('a589324c33cb1fbd10b6107a0f97c28af57e52886eeccbcf6ad30d59d29bcd5e');
  });

  it("reaches three's real program with the decal define, and a plain material's program without it", () => {
    const decal = new Mesh(new SphereGeometry(0.1, 8, 6), createPaintedMaterial(shared, { map: new Texture(), decal: true }));
    const plain = new Mesh(new SphereGeometry(0.1, 8, 6), createPaintedMaterial(shared, { map: new Texture() }));
    const scene = new Scene();
    scene.add(decal, new DirectionalLight(0xffffff, 1));
    const camera = new PerspectiveCamera(50, 1, 0.1, 10);
    camera.position.set(0, 0, 1);
    const gl = createMockRenderer();
    gl.renderer.compile(scene, camera);
    const decalSources = [...gl.sources];
    expect(decalSources.filter((source) => source.includes('#define PAINT_DECAL'))).toHaveLength(2);
    scene.remove(decal);
    scene.add(plain);
    const second = createMockRenderer();
    second.renderer.compile(scene, camera);
    expect(second.sources.length).toBeGreaterThan(0);
    for (const source of second.sources) expect(source).not.toContain('#define PAINT_DECAL');
  });

  it('moves the sampled cell when the face changes state, across rows as well as columns', () => {
    const { root, eyes, mouth } = animeHead();
    paintAndInk(root, ctx, 0.35);
    const driver = new FaceDriver(root, { random: () => 0.5 });
    const cases: [Mesh, number, number, string[], (state: string) => boolean][] = [
      [eyes, 4, 1, ['open', 'half', 'closed', 'happy'], (s) => driver.setEyes(s as EyeState)],
      [mouth, 2, 2, ['neutral', 'smile', 'talk', 'o'], (s) => driver.setMouth(s as MouthState)],
    ];
    for (const [mesh, cols, rows, states, set] of cases) {
      const texture = painted(mesh).uniforms['uMap']?.value as DataTexture;
      const offset = painted(mesh).uniforms['uCellOffset']?.value as Vector2;
      states.forEach((state, cell) => {
        expect(set(state)).toBe(true);
        // What the vertex shader hands the fragment shader: the mesh's UV plus the offset, sampled at every texel of the
        // cell the UVs point at; every opaque texel reads the state's own cell colour.
        const colours = new Set(cellZeroUvs(cols, rows).map((uv) => sample(texture, uv.clone().add(offset))).filter((t) => t[3] > 0).map((t) => t.slice(0, 3).join()));
        expect([...colours], `${mesh.name} ${state}`).toEqual([[cell * 40, 200 - cell * 40, 90].join()]);
        expect(offset).toEqual(decalCellOffset(painted(mesh).userData['decalAtlas'], cell, new Vector2()));
      });
    }
    // The mouth's third cell is in the second row: v moves down half the atlas, toward the image's bottom.
    driver.setMouth('talk');
    expect((painted(mouth).uniforms['uCellOffset']?.value as Vector2).toArray()).toEqual([0, 0.5]);
  });

  it('discards the transparent texels of every cell and keeps the opaque ones', () => {
    const { root, eyes } = animeHead();
    paintAndInk(root, ctx, 0.35);
    const driver = new FaceDriver(root, { random: () => 0.5 });
    const material = painted(eyes);
    const cutoff = material.uniforms['uAlphaTest']?.value as number;
    // The fragment shader's cutout: alpha = texel.a, then discard where alpha < uAlphaTest.
    const kept = (uv: Vector2) => !(sample(material.uniforms['uMap']?.value as DataTexture, uv)[3] / 255 < cutoff);
    for (const state of ['open', 'closed'] as const) {
      driver.setEyes(state);
      const offset = material.uniforms['uCellOffset']?.value as Vector2;
      const uvs = cellZeroUvs(4, 1).map((uv) => uv.clone().add(offset));
      // The cell's one-texel border is transparent and its 2 x 2 middle opaque.
      expect(uvs.filter(kept)).toHaveLength(4);
      expect(uvs.filter((uv) => !kept(uv))).toHaveLength(12);
    }
    // A GLB that names its own cutoff (alphaMode MASK, which GLTFLoader puts in alphaTest) keeps it.
    const own = animeHead({ alphaTest: 0.3 });
    paintAndInk(own.root, ctx, 0.35);
    expect(painted(own.eyes).uniforms['uAlphaTest']?.value).toBe(0.3);
  });
});

describe('expression decals through the loader', () => {
  it('paints each decal with a material of its own, cut out, skin-lit, out of the edge pass and the shadow map, and never inked', () => {
    const { root, head, eyes, mouth, hair } = animeHead({ eyesInk: true });
    const normals = [head, eyes, mouth, hair].map((mesh) => mesh.geometry.getAttribute('normal'));
    paintAndInk(root, ctx, 0.35);
    for (const decal of [eyes, mouth]) {
      const material = painted(decal);
      expect(material.defines['PAINT_DECAL'], decal.name).toBe('');
      expect(material.defines['PAINT_SKIN'], decal.name).toBe('');
      // No hull, even on a decal that carries _ink, and no crease or silhouette ink from the edge pass.
      expect(decal.children, decal.name).toHaveLength(0);
      expect(decal.layers.mask).toBe(1 << LAYERS.noEdge);
      expect([decal.castShadow, decal.receiveShadow]).toEqual([false, true]);
      // A skin weight of 1 wherever the decal carries none, so it takes the face's soft light.
      const skin = decal.geometry.getAttribute('skinMask');
      expect(skin.count).toBe(decal.geometry.getAttribute('position').count);
      for (let i = 0; i < skin.count; i++) expect(skin.getX(i)).toBe(1);
      expect(material.userData['decalOwner']).toBe(decal.uuid);
    }
    expect(eyes.material).not.toBe(mouth.material);
    expect(painted(eyes).userData['decalAtlas']).toEqual({ cols: 4, rows: 1, states: ['open', 'half', 'closed', 'happy'], cellUV: [0.25, 1], role: 'eyes' });
    expect(painted(mouth).userData['decalAtlas']).toEqual({ cols: 2, rows: 2, states: ['neutral', 'smile', 'talk', 'o'], cellUV: [0.5, 0.5], role: 'mouth' });
    // The head keeps the skin path it had: soft light, noEdge, its hull, and no decal define or offset.
    expect(painted(head).defines['PAINT_SKIN']).toBe('');
    expect(painted(head).defines['PAINT_DECAL']).toBeUndefined();
    expect('uCellOffset' in painted(head).uniforms).toBe(false);
    expect(head.layers.mask).toBe(1 << LAYERS.noEdge);
    expect(head.children.map((child) => child.name)).toEqual(['head_skin_hull']);
    expect(hair.layers.mask).toBe(1 << LAYERS.world);
    // Authored normals are never recomputed, on decals or anywhere else.
    [head, eyes, mouth, hair].forEach((mesh, i) => expect(mesh.geometry.getAttribute('normal'), mesh.name).toBe(normals[i]));
  });

  it("keeps a decal's own _skin weight, and finds extras on the group of a multi-primitive node or a quantized mesh's parent", () => {
    const { root, eyes } = animeHead({ eyesSkin: 0.25 });
    // The build's quantizer moves a mesh off a node with children onto a new child, leaving the extras on the node.
    const node = new Group();
    node.name = 'face_mouth';
    node.userData['p99_atlas'] = { cols: 4, rows: 1, states: ['neutral', 'smile', 'talk', 'o'] };
    const part = new Mesh(new SphereGeometry(0.05, 6, 4), new MeshStandardMaterial({ map: atlasTexture(4, 1) }));
    part.name = 'face_mouth_1';
    node.add(part);
    root.add(node);
    expect(decalAtlasOf(part, root)?.role).toBe('mouth');
    paintAndInk(root, ctx, 0.35);
    expect(eyes.geometry.getAttribute('skinMask').getX(0)).toBe(0.25);
    expect(painted(part).defines['PAINT_DECAL']).toBe('');
    expect(part.layers.mask).toBe(1 << LAYERS.noEdge);
  });

  it('warns about a malformed atlas or a name that is neither eyes nor mouth, and still draws the mesh as a decal', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(readDecalAtlas({ cols: 4, rows: 1, states: ['open', 'half'] }, 'face_eyes')).toEqual({ cols: 4, rows: 1, states: ['open', 'half'], cellUV: [0.25, 1], role: 'eyes' });
    expect(warn).not.toHaveBeenCalled();
    expect(readDecalAtlas({ cols: 2, rows: 1, states: ['a', 'b', 'c'] }, 'face_mouth').states).toEqual([]);
    expect(warn.mock.calls.at(-1)?.[0]).toMatch(/decal face_mouth: p99_atlas is malformed.*names 3 states for 2 cells/);
    expect(readDecalAtlas({ cols: 0, rows: 1, states: ['open'] }, 'face_eyes').states).toEqual([]);
    expect(readDecalAtlas({ cols: 4, rows: 1, states: ['open', 'open'] }, 'face_eyes').states).toEqual([]);
    expect(readDecalAtlas({ cols: 4, rows: 1, states: ['open'], cellUV: [0.3, 1] }, 'face_eyes').states).toEqual([]);
    expect(readDecalAtlas('open', 'face_eyes').states).toEqual([]);
    const blush = readDecalAtlas({ cols: 1, rows: 1, states: ['on'] }, 'face_blush');
    expect([blush.role, blush.states]).toEqual([null, ['on']]);
    expect(warn.mock.calls.at(-1)?.[0]).toMatch(/decal face_blush: its node name names neither eyes nor a mouth/);
  });
});

describe('expression decals on a cloned rig', () => {
  it('get a material of their own from the face driver, on the same dials, so each instance holds its own expression', () => {
    const { root } = animeHead();
    paintAndInk(root, ctx, 0.35);
    const first = new FaceDriver(root, { random: () => 0.5 });
    // SkeletonUtils.clone, as the Asset World places its instances, shares the source's materials.
    const copy = cloneRig(root);
    const copiedEyes = copy.getObjectByName('face_eyes') as Mesh;
    const sourceEyes = root.getObjectByName('face_eyes') as Mesh;
    expect(copiedEyes.material).toBe(sourceEyes.material);
    const second = new FaceDriver(copy, { random: () => 0.5 });
    expect(copiedEyes.material).not.toBe(sourceEyes.material);
    expect(painted(copiedEyes).uniforms['uBands']).toBe(shared.uBands);
    expect(painted(copiedEyes).uniforms['uMap']?.value).toBe(painted(sourceEyes).uniforms['uMap']?.value);
    second.setEyes('happy');
    first.setEyes('closed');
    expect((painted(copiedEyes).uniforms['uCellOffset']?.value as Vector2).x).toBe(0.75);
    expect((painted(sourceEyes).uniforms['uCellOffset']?.value as Vector2).x).toBe(0.5);
    expect(() => copyDecalMaterial(createPaintedMaterial(shared, {}))).toThrow(/not a painted decal material/);
  });
});

// Drops each #ifdef PAINT_DECAL block, keeping its #else branch, as the GLSL preprocessor does without the define.
function stripDecal(text: string): string {
  const out: string[] = [];
  const stack: string[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('#if')) {
      stack.push(t === '#ifdef PAINT_DECAL' ? 'decal-if' : 'other');
      if (stack.at(-1) === 'decal-if') continue;
    } else if (t === '#else' && stack.at(-1)?.startsWith('decal')) {
      stack[stack.length - 1] = 'decal-else';
      continue;
    } else if (t.startsWith('#endif')) {
      if (stack.pop()?.startsWith('decal')) continue;
    }
    if (stack.includes('decal-if')) continue;
    out.push(line);
  }
  return out.join('\n');
}
