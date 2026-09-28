import { fileURLToPath } from 'node:url';
import { Texture, Vector3, type Bone, type Group, type Mesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCommanderFace, jawAxisOf } from '../../../src/labs/shared/commanderFace';
import { FaceDriver, JAW_BONE_NAME } from '../../../src/labs/shared/faceDriver';
import { paintAndInk } from '../../../src/render/assets/loadAsset';
import { DEFAULT_DIALS } from '../../../src/render/defaults';
import { createHullMaterial, createInkUniforms } from '../../../src/render/ink/hull';
import { LAYERS } from '../../../src/render/layers';
import { createPaintUniforms } from '../../../src/render/materials/painted';
import { VERDANT } from '../../../src/render/themes';
import { assetIO } from '../../../tools/assets/optimize.mjs';

// The shipped Pip-A, as three r186's own GLTFLoader delivers it, so the names the renderer and the face driver read are
// the loader's and not assumed. Node has no image decoder, so the file's two textures are dropped before parsing; the
// geometry, the skin, the morphs and the clips pass through the loader exactly as the page loads them.
const FILE = fileURLToPath(new URL('../../../public/assets/commanders/commander_pip.glb', import.meta.url));
const FACE = ['blink_L', 'blink_R', 'smile', 'brows_up', 'pucker'];

let scene: Group;
let clips: string[];

beforeAll(async () => {
  const io = await assetIO();
  const doc = await io.read(FILE);
  for (const texture of doc.getRoot().listTextures()) texture.dispose();
  const bytes = await io.writeBinary(doc);
  await MeshoptDecoder.ready;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
  scene = gltf.scene;
  clips = gltf.animations.map((clip) => clip.name);
});

const mesh = (name: string) => scene.getObjectByName(name) as Mesh;

describe('the shipped Pip-A through GLTFLoader', () => {
  it('delivers _INK and _SKIN lower-cased as _ink and _skin, the skin weight on the body alone', () => {
    const body = mesh('commander_body').geometry;
    const armour = mesh('commander_armour').geometry;
    expect(Object.keys(body.attributes).filter((name) => name.startsWith('_')).sort()).toEqual(['_ink', '_skin']);
    expect(Object.keys(armour.attributes).filter((name) => name.startsWith('_'))).toEqual(['_ink']);
    // Soft at the borders: the weight spans 0 to 1 on the body.
    const skin = body.getAttribute('_skin');
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < skin.count; i++) {
      low = Math.min(low, skin.getX(i));
      high = Math.max(high, skin.getX(i));
    }
    expect([low, high]).toEqual([expect.closeTo(0, 3), expect.closeTo(1, 3)]);
  });

  it('carries the five face morphs on the body, positions only, the jaw bone by its exact name, and the idle and run clips', () => {
    const body = mesh('commander_body');
    expect(Object.keys(body.morphTargetDictionary ?? {})).toEqual(FACE);
    expect(body.geometry.morphAttributes['position']).toHaveLength(5);
    expect(body.geometry.morphAttributes['normal']).toBeUndefined();
    expect(mesh('commander_armour').morphTargetDictionary).toBeUndefined();
    // No prefix to resolve: the CharForge rig's jaw is 'jaw', while its other bones carry mixamorig: (sanitized to
    // mixamorigHead by the loader).
    const jaw = scene.getObjectByName(JAW_BONE_NAME) as Bone;
    expect(jaw.isBone).toBe(true);
    expect(jaw.parent?.name).toBe('mixamorigHead');
    expect(clips).toEqual(['idle', 'run']);
  });

  it('paints the body as skin out of the edge pass and keeps the armour in it, both inked', () => {
    const ctx = { paint: createPaintUniforms(VERDANT, DEFAULT_DIALS, new Texture()), hullMaterial: createHullMaterial(createInkUniforms(DEFAULT_DIALS)), hullLayer: LAYERS.hull };
    paintAndInk(scene, ctx, 0.35);
    const body = mesh('commander_body');
    const armour = mesh('commander_armour');
    expect(body.layers.mask).toBe(1 << LAYERS.noEdge);
    expect(armour.layers.mask).toBe(1 << LAYERS.world);
    expect(body.geometry.getAttribute('skinMask')).toBe(body.geometry.getAttribute('_skin'));
    expect(body.children.map((child) => child.name)).toEqual(['commander_body_hull']);
    expect(armour.children.map((child) => child.name)).toEqual(['commander_armour_hull']);
  });

  it('opens the jaw about the character\'s left-right axis, so the chin drops and draws back without swinging sideways', () => {
    const axis = jawAxisOf(scene)!;
    // The bind pose's +X in the jaw's frame, as tools read it from the GLB (the jaw's own x is 15.7 degrees off it).
    expect(axis.toArray()).toEqual([expect.closeTo(0.9625, 3), expect.closeTo(-0.0924, 3), expect.closeTo(-0.2551, 3)]);
    const jaw = scene.getObjectByName(JAW_BONE_NAME)!;
    // A chin point, 10 cm down the jaw bone, where the jaw's +Y runs toward the chin.
    const chin = () => {
      scene.updateMatrixWorld(true);
      return jaw.localToWorld(new Vector3(0, 0.1, 0));
    };
    const rest = chin();
    const face = createCommanderFace(scene, 1)!;
    expect(face.meshes.map((m) => m.name)).toContain('commander_body');
    // Pip-A's face is morphs alone: no mesh of his carries p99_atlas extras, so the driver finds no expression decal.
    expect([face.faceKind, face.decals.length]).toEqual(['morph', 0]);
    face.setJaw(1);
    const open = chin();
    face.setJaw(0);
    expect(chin().distanceTo(rest)).toBeLessThan(1e-9);
    // Down and back (a glTF character faces +Z), and no further sideways than a tenth of a millimetre.
    expect(open.y).toBeLessThan(rest.y - 0.01);
    expect(open.z).toBeLessThan(rest.z - 0.005);
    expect(Math.abs(open.x - rest.x)).toBeLessThan(1e-4);
    // About the bone's own x, the driver's default, the chin would slide sideways by millimetres as well.
    const own = new FaceDriver(scene, { random: () => 0.5 });
    own.setJaw(1);
    expect(Math.abs(chin().x - rest.x)).toBeGreaterThan(1e-3);
    own.setJaw(0);
  });
});
