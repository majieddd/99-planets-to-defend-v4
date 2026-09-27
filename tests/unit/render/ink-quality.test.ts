import { BackSide, Bone, BoxGeometry, BufferAttribute, Float32BufferAttribute, InstancedMesh, Mesh, MeshBasicMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIALS } from '../../../src/render/defaults';
import { applyInkDials, attachHull, createHullMaterial, createInkUniforms } from '../../../src/render/ink/hull';
import { computeInkNormals } from '../../../src/render/ink/inkNormals';
import { tierForGpu, TIERS } from '../../../src/render/quality';

function inked(width: number) {
  const geometry = new BoxGeometry(1, 1, 1);
  geometry.setAttribute('inkWidth', new Float32BufferAttribute(new Array(geometry.getAttribute('position').count).fill(width), 1));
  return geometry;
}

describe('computeInkNormals', () => {
  it('averages split normals at a cube corner into the diagonal', () => {
    const geometry = new BoxGeometry(1, 1, 1);
    const attr = computeInkNormals(geometry);
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const expected = [position.getX(i), position.getY(i), position.getZ(i)].map((c) => Math.sign(c) / Math.sqrt(3));
      expect(attr.getX(i)).toBeCloseTo(expected[0]!, 5);
      expect(attr.getY(i)).toBeCloseTo(expected[1]!, 5);
      expect(attr.getZ(i)).toBeCloseTo(expected[2]!, 5);
    }
  });
});

describe('attachHull', () => {
  const material = createHullMaterial(createInkUniforms(DEFAULT_DIALS));

  it('adds one hull child on the hull layer that ignores shadows', () => {
    const mesh = new Mesh(inked(0.5), new MeshBasicMaterial());
    const hull = attachHull(mesh, material, 1);
    expect(hull).not.toBeNull();
    expect(mesh.children).toEqual([hull]);
    expect(hull!.layers.mask).toBe(1 << 1);
    expect(hull!.castShadow).toBe(false);
    expect(mesh.geometry.getAttribute('inkNormal')).toBeDefined();
  });

  it('skips meshes whose ink is zero or missing', () => {
    expect(attachHull(new Mesh(inked(0), new MeshBasicMaterial()), material, 1)).toBeNull();
    expect(attachHull(new Mesh(new BoxGeometry(), new MeshBasicMaterial()), material, 1)).toBeNull();
  });

  it('binds a skinned hull to the same skeleton', () => {
    const geometry = inked(0.5);
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(count * 4).fill(0), 4));
    geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array(count * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    const bone = new Bone();
    const skinned = new SkinnedMesh(geometry, new MeshBasicMaterial());
    skinned.add(bone);
    skinned.bind(new Skeleton([bone]));
    const hull = attachHull(skinned, material, 1) as SkinnedMesh;
    expect(hull.isSkinnedMesh).toBe(true);
    expect(hull.skeleton).toBe(skinned.skeleton);
  });

  it('undoes FLIP_SIDED so the BackSide hull pushes outward', () => {
    const vs = material.vertexShader;
    const unflip = vs.indexOf('transformedNormal = - transformedNormal;');
    expect(material.side).toBe(BackSide);
    expect(unflip).toBeGreaterThan(vs.indexOf('#include <defaultnormal_vertex>'));
    expect(vs.indexOf('vec2 direction')).toBeGreaterThan(unflip);
    expect(vs.lastIndexOf('#ifdef FLIP_SIDED', unflip)).toBeGreaterThan(vs.indexOf('#include <defaultnormal_vertex>'));
    const guard = vs.lastIndexOf('#ifdef FLIP_SIDED', unflip);
    expect(vs.slice(guard + '#ifdef FLIP_SIDED'.length, unflip)).not.toMatch(/#\s*(if|else|elif|endif)/);
  });

  it('shares the instance matrices of an instanced mesh', () => {
    const source = new InstancedMesh(inked(0.5), new MeshBasicMaterial(), 3);
    const hull = attachHull(source, material, 1) as InstancedMesh;
    expect(hull.instanceMatrix).toBe(source.instanceMatrix);
    expect(hull.count).toBe(3);
    expect(hull.geometry).toBe(source.geometry);
  });

  it('clamps hull ink to the blueprint range and follows the ink dials', () => {
    const uniforms = createInkUniforms(DEFAULT_DIALS);
    expect([uniforms.uMinPx.value, uniforms.uMaxPx.value]).toEqual([1.2, 4]);
    applyInkDials(uniforms, { ...DEFAULT_DIALS, inkWidthPx: 3, inkColor: '#102030' });
    expect(uniforms.uInkWidthPx.value).toBe(3);
    expect(uniforms.uInkColor.value.getHexString()).toBe('102030');
  });

  it('writes an emissive key of 0, so the bloom never reads ink as energy', () => {
    // Alpha carries the key from the scene to the bloom, and an opaque ShaderMaterial writes it unblended.
    expect(material.fragmentShader).toContain('gl_FragColor = vec4(uInkColor, 0.0);');
    expect(material.transparent).toBe(false);
  });
});

describe('tierForGpu', () => {
  it('picks a tier from the GPU string', () => {
    expect(tierForGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Laptop GPU Direct3D11)', false)).toBe('high');
    expect(tierForGpu('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', false)).toBe('medium');
    expect(tierForGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))', false)).toBe('low');
    expect(tierForGpu('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)', false)).toBe('low');
    expect(tierForGpu('Adreno (TM) 740', true)).toBe('low');
    expect(TIERS.low.edgeInk).toBe(false);
  });
});
