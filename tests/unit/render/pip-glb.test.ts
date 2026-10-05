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
// the loader's and not assumed. Node has no image decoder, so the file's three textures are dropped before parsing; the
// geometry, the skin, the morphs and the clips pass through the loader exactly as the page loads them.
const FILE = fileURLToPath(new URL('../../../public/assets/commanders/commander_pip.glb', import.meta.url));
const FACE = ['blink_L', 'blink_R', 'smile', 'brows_up', 'pucker'];
// Since the v5 study export the body's glTF mesh has two primitives, the body on the shared paint material and the head
// on a second material with its own 1024 px texture. GLTFLoader loads such a node as a Group named after the node, with
// one skinned mesh per primitive named after the mesh and made unique, so the node's own name is taken and the two
// primitives arrive as commander_body_1 (body) and commander_body_2 (head). Every check that read commander_body as one
// mesh now reads both, because a check on the body alone would pass with the head, where the eyes are, left unpainted,
// uninked or undriven.
const BODY_PARTS = ['commander_body_1', 'commander_body_2'];

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
const bodyParts = () => BODY_PARTS.map(mesh);

describe('the shipped Pip-A through GLTFLoader', () => {
  it('loads the two-material body as a Group of the body and the head, each a skinned mesh on its own material', () => {
    const body = scene.getObjectByName('commander_body')!;
    expect([body.type, body.children.map((child) => child.name)]).toEqual(['Group', BODY_PARTS]);
    expect(bodyParts().map((part) => (part as Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh)).toEqual([true, true]);
    // The head's own material is the one that carries the 1024 px head texture in the file.
    const materials = bodyParts().map((part) => (part.material as { name: string }).name);
    expect(materials[0]).not.toMatch(/head/);
    expect(materials[1]).toMatch(/head/);
  });

  it('delivers _INK and _SKIN lower-cased as _ink and _skin, the skin weight on the body alone', () => {
    const armour = mesh('commander_armour').geometry;
    for (const part of bodyParts()) {
      expect(Object.keys(part.geometry.attributes).filter((name) => name.startsWith('_')).sort()).toEqual(['_ink', '_skin']);
    }
    expect(Object.keys(armour.attributes).filter((name) => name.startsWith('_'))).toEqual(['_ink']);
    const range = (part: Mesh) => {
      const skin = part.geometry.getAttribute('_skin');
      let low = Infinity;
      let high = -Infinity;
      for (let i = 0; i < skin.count; i++) {
        low = Math.min(low, skin.getX(i));
        high = Math.max(high, skin.getX(i));
      }
      return [low, high];
    };
    // Soft at the borders: the weight spans 0 to 1 on the body, where skin meets suit, and the head is skin throughout.
    const [bodyPart, head] = bodyParts();
    expect(range(bodyPart!)).toEqual([expect.closeTo(0, 3), expect.closeTo(1, 3)]);
    expect(range(head!)).toEqual([expect.closeTo(1, 3), expect.closeTo(1, 3)]);
  });

  it('carries the five face morphs on the body and the head, positions only, the jaw bone by its exact name, and the idle and run clips', () => {
    for (const part of bodyParts()) {
      expect(Object.keys(part.morphTargetDictionary ?? {})).toEqual(FACE);
      expect(part.geometry.morphAttributes['position']).toHaveLength(5);
      expect(part.geometry.morphAttributes['normal']).toBeUndefined();
    }
    expect(mesh('commander_armour').morphTargetDictionary).toBeUndefined();
    // No prefix to resolve: the CharForge rig's jaw is 'jaw', while its other bones carry mixamorig: (sanitized to
    // mixamorigHead by the loader).
    const jaw = scene.getObjectByName(JAW_BONE_NAME) as Bone;
    expect(jaw.isBone).toBe(true);
    expect(jaw.parent?.name).toBe('mixamorigHead');
    expect(clips).toEqual(['idle', 'run']);
  });

  it('paints the body and the head as skin out of the edge pass and keeps the armour in it, all inked', () => {
    const ctx = { paint: createPaintUniforms(VERDANT, DEFAULT_DIALS, new Texture()), hullMaterial: createHullMaterial(createInkUniforms(DEFAULT_DIALS)), hullLayer: LAYERS.hull };
    paintAndInk(scene, ctx, 0.35);
    const armour = mesh('commander_armour');
    for (const part of bodyParts()) {
      expect(part.layers.mask).toBe(1 << LAYERS.noEdge);
      expect(part.geometry.getAttribute('skinMask')).toBe(part.geometry.getAttribute('_skin'));
      expect(part.children.map((child) => child.name)).toEqual([`${part.name}_hull`]);
    }
    // Two source materials, two painted ones: the head keeps its own texture rather than sharing the body's.
    const [bodyPart, head] = bodyParts();
    expect(head!.material).not.toBe(bodyPart!.material);
    expect(armour.layers.mask).toBe(1 << LAYERS.world);
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
    const made = createCommanderFace(scene, 1);
    // The shipped rig carries the face morphs, so it gets a face; a null here would pass every check below unread.
    expect(made).not.toBeNull();
    const face = made!;
    // The driver sets the morphs on the head, where the eyes and mouth are, as well as on the body.
    expect(face.meshes.map((m) => m.name)).toEqual(expect.arrayContaining(BODY_PARTS));
    // And it writes to the shipped asset's own influences, not a copy: with the lids held shut, every body primitive's
    // blink_L reads 1, the head's included.
    face.setBlinkHold(1);
    for (const part of bodyParts()) expect(part.morphTargetInfluences![part.morphTargetDictionary!['blink_L']!], part.name).toBe(1);
    face.setBlinkHold(null);
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
