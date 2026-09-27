import { BoxGeometry, DoubleSide, Float32BufferAttribute, FrontSide, Group, Mesh, MeshStandardMaterial, Texture, type ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { collectMeshes, paintAndInk } from '../../../src/render/assets/loadAsset';
import { DEFAULT_DIALS } from '../../../src/render/defaults';
import { createHullMaterial, createInkUniforms } from '../../../src/render/ink/hull';
import { createPaintUniforms } from '../../../src/render/materials/painted';
import { VERDANT } from '../../../src/render/themes';

function inkedMesh(name: string, width: number, material: MeshStandardMaterial) {
  const geometry = new BoxGeometry();
  geometry.setAttribute('_ink', new Float32BufferAttribute(new Array(geometry.getAttribute('position').count).fill(width), 1));
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

// The helper takes a plain Mesh, so the cast from the typed source material to the painted one is allowed.
const painted = (mesh: Mesh) => mesh.material as ShaderMaterial;

describe('paintAndInk', () => {
  const ctx = {
    paint: createPaintUniforms(VERDANT, DEFAULT_DIALS, new Texture()),
    hullMaterial: createHullMaterial(createInkUniforms(DEFAULT_DIALS)),
    hullLayer: 1,
  };

  it('gives every inked mesh exactly one hull, without recursing into the hulls', () => {
    const shared = new MeshStandardMaterial();
    const root = new Group();
    const a = inkedMesh('a', 0.5, shared);
    // glTF lets a primitive omit normals, and GLTFLoader then leaves the geometry without them.
    a.geometry.deleteAttribute('normal');
    root.add(a, inkedMesh('b', 0.5, shared));
    paintAndInk(root, ctx, 0.2);
    const meshes = collectMeshes(root);
    expect(meshes.map((m) => m.name).sort()).toEqual(['a', 'a_hull', 'b', 'b_hull']);
    expect(a.geometry.getAttribute('normal')).toBeDefined();
    expect(a.children.map((child) => child.name)).toEqual(['a_hull']);
    const firstPass = a.material;
    paintAndInk(root, ctx, 0.2); // a repeat pass must change nothing
    expect(collectMeshes(root).map((m) => m.name).sort()).toEqual(['a', 'a_hull', 'b', 'b_hull']);
    expect(a.material).toBe(firstPass);
  });

  it('shares one painted material per source, split by double-sidedness', () => {
    const shared = new MeshStandardMaterial({ color: 0x8a8378, emissive: 0x59f2ff, emissiveIntensity: 3 });
    const rock = inkedMesh('rock', 0.5, shared);
    const boulder = inkedMesh('boulder', 0.5, shared);
    const grass = inkedMesh('grass', 0, shared);
    grass.userData['double_sided'] = true;
    const root = new Group();
    root.add(rock, boulder, grass);
    paintAndInk(root, ctx, 0.1);
    expect(boulder.material).toBe(rock.material);
    expect(rock.material).not.toBe(grass.material);
    expect(painted(rock).side).toBe(FrontSide);
    expect(painted(grass).side).toBe(DoubleSide);
    expect(grass.children).toHaveLength(0); // zero ink, no hull
    const { uniforms } = painted(rock);
    expect(uniforms['uBaseColor']?.value).toEqual(shared.color);
    expect(uniforms['uEmissiveColor']?.value).toEqual(shared.emissive);
    expect(uniforms['uEmissiveIntensity']?.value).toBe(3);
    expect(rock.castShadow && rock.receiveShadow).toBe(true);
  });
});
