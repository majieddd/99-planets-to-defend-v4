import {
  BackSide,
  Color,
  InstancedMesh,
  Mesh,
  ShaderMaterial,
  SkinnedMesh,
  Vector2,
  type IUniform,
  type Material,
} from 'three';
import type { RenderDials } from '../defaults';
import { computeInkNormals } from './inkNormals';

export interface InkUniforms {
  [name: string]: IUniform;
  uInkWidthPx: IUniform<number>;
  uInkColor: IUniform<Color>;
  uMinPx: IUniform<number>;
  uMaxPx: IUniform<number>;
  uDistanceRef: IUniform<number>;
  uResolution: IUniform<Vector2>;
}

export function createInkUniforms(dials: RenderDials): InkUniforms {
  return {
    uInkWidthPx: { value: dials.inkWidthPx },
    uInkColor: { value: new Color(dials.inkColor) },
    // The blueprint's Render defaults clamp hull ink to 1.2 to 4 px (docs/blueprint.md, Numbers).
    uMinPx: { value: 1.2 },
    uMaxPx: { value: 4.0 },
    uDistanceRef: { value: 25 },
    uResolution: { value: new Vector2(1920, 1080) },
  };
}

export function applyInkDials(uniforms: InkUniforms, dials: RenderDials): void {
  uniforms.uInkWidthPx.value = dials.inkWidthPx;
  uniforms.uInkColor.value.set(dials.inkColor);
}

const vertexShader = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
#include <skinning_pars_vertex>
attribute vec3 inkNormal;
attribute float inkWidth;
uniform float uInkWidthPx;
uniform float uMinPx;
uniform float uMaxPx;
uniform float uDistanceRef;
uniform vec2 uResolution;
void main() {
  #include <batching_vertex>
  #include <beginnormal_vertex>
  objectNormal = inkNormal;
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #ifdef FLIP_SIDED
  // The hull is BackSide, so three defines FLIP_SIDED and defaultnormal_vertex points the normal into the
  // mesh. Undo that, or the hull shrinks inside the mesh and the ink never shows.
  transformedNormal = - transformedNormal;
  #endif
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vec2 direction = (projectionMatrix * vec4(normalize(transformedNormal), 0.0)).xy;
  float len = length(direction);
  direction = len > 1e-5 ? direction / len : vec2(0.0);
  // Constant screen width near the camera, thinning with distance so far props do not turn to ink blots.
  float distanceScale = clamp(uDistanceRef / max(-mvPosition.z, 0.001), 0.35, 1.0);
  // inkWidth is stored as width / 2 (see blender/lib/ink.py).
  float widthPx = inkWidth > 0.0 ? clamp(uInkWidthPx * inkWidth * 2.0 * distanceScale, uMinPx, uMaxPx) : 0.0;
  gl_Position.xy += direction * widthPx * 2.0 / uResolution * gl_Position.w;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uInkColor;
void main() {
  gl_FragColor = vec4(uInkColor, 1.0);
  #include <colorspace_fragment>
}
`;

export function createHullMaterial(uniforms: InkUniforms): ShaderMaterial {
  return new ShaderMaterial({ name: 'InkHull', uniforms, vertexShader, fragmentShader, side: BackSide });
}

function maxInk(mesh: Mesh): number {
  const attribute = mesh.geometry.getAttribute('inkWidth');
  if (!attribute) return 0;
  let max = 0;
  for (let i = 0; i < attribute.count; i++) max = Math.max(max, attribute.getX(i));
  return max;
}

/**
 * Adds an inverted hull as a child of the mesh, with an identity transform so it follows the mesh (skinned
 * meshes stay in attached bind mode, so the child shares the parent's world matrix). Returns null when the
 * mesh carries no ink. Call this on a collected list, never inside traverse().
 */
export function attachHull(mesh: Mesh, material: Material, layer: number): Mesh | null {
  if (maxInk(mesh) <= 0) return null;
  if (!mesh.geometry.getAttribute('inkNormal')) computeInkNormals(mesh.geometry);
  let hull: Mesh;
  if ((mesh as SkinnedMesh).isSkinnedMesh) {
    const source = mesh as SkinnedMesh;
    const skinned = new SkinnedMesh(source.geometry, material);
    skinned.bind(source.skeleton, source.bindMatrix);
    hull = skinned;
  } else if ((mesh as InstancedMesh).isInstancedMesh) {
    const source = mesh as InstancedMesh;
    const instanced = new InstancedMesh(source.geometry, material, source.count);
    instanced.instanceMatrix = source.instanceMatrix;
    hull = instanced;
  } else {
    hull = new Mesh(mesh.geometry, material);
  }
  hull.name = `${mesh.name}_hull`;
  hull.layers.set(layer);
  hull.castShadow = false;
  hull.receiveShadow = false;
  hull.frustumCulled = mesh.frustumCulled;
  hull.raycast = () => {};
  mesh.add(hull);
  return hull;
}
