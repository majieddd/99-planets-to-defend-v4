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
  type Object3D,
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

// The morph chunks sit where three r186 puts them (ShaderLib/meshlambert.glsl.js), so the hull moves with the painted
// surface it outlines: the morphed position before skinning, as in materials/painted.ts, where the defines three sets
// for a morphed geometry are described. morphnormal_vertex is left out on purpose. The hull pushes along inkNormal, the
// normals of split vertices averaged so the hull stays closed at every crease (inkNormals.ts); a morph's normal deltas
// differ between the split copies of a vertex and would tear it open again where they part. The commander's morph
// normals are exported off anyway (blender/lib/export.py), and a blink bends the lid's normals too little to matter to
// an outline a few pixels wide, so the hull pushes along its base ink normals from the morphed positions.
const vertexShader = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
attribute vec3 inkNormal;
attribute float inkWidth;
uniform float uInkWidthPx;
uniform float uMinPx;
uniform float uMaxPx;
uniform float uDistanceRef;
uniform vec2 uResolution;
void main() {
  #include <morphinstance_vertex>
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
  #include <morphtarget_vertex>
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
  // Alpha is the emissive key the bloom reads (see materials/painted.ts), and ink emits nothing.
  gl_FragColor = vec4(uInkColor, 0.0);
  #include <colorspace_fragment>
}
`;

/**
 * Points a hull at its source mesh's morph influences, the very array the source's animation and face driver write, so
 * a blink moves the ink with the lid. attachHull shares the array when it builds the hull, but a clone does not keep
 * the sharing: Mesh.copy slices morphTargetInfluences, so the Asset World's SkeletonUtils clones of a rig gave each
 * clone's hull a frozen copy, and its lids would have closed under an open eye's ink. The hull is always its source's
 * child, so re-pointing it from its parent before each draw (createHullMaterial) mends a clone on its first frame; once
 * shared, the check is one comparison per hull draw. An instanced source's per-instance weights live in its morph
 * texture, which is shared the same way.
 */
export function syncHullMorphs(hull: Object3D): void {
  const source = hull.parent as Mesh | null;
  if (!source?.morphTargetInfluences) return;
  const mesh = hull as Mesh;
  if (mesh.morphTargetInfluences !== source.morphTargetInfluences) {
    mesh.morphTargetInfluences = source.morphTargetInfluences;
    mesh.morphTargetDictionary = source.morphTargetDictionary;
  }
  const instanced = source as InstancedMesh;
  if (instanced.isInstancedMesh && (hull as InstancedMesh).morphTexture !== instanced.morphTexture) {
    (hull as InstancedMesh).morphTexture = instanced.morphTexture;
  }
}

export function createHullMaterial(uniforms: InkUniforms): ShaderMaterial {
  const material = new ShaderMaterial({ name: 'InkHull', uniforms, vertexShader, fragmentShader, side: BackSide });
  // three calls this for each object drawn with the material, before it uploads the object's morph influences
  // (WebGLRenderer.renderObject, then setProgram), and only hulls are drawn with it.
  material.onBeforeRender = (_renderer, _scene, _camera, _geometry, object) => syncHullMorphs(object);
  return material;
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
  // The same array, not a copy: the hull's own constructor gave it zeros, and ink left at rest while the lid closes
  // would outline an open eye over a shut one. syncHullMorphs keeps it shared through clones.
  mesh.add(hull);
  syncHullMorphs(hull);
  hull.name = `${mesh.name}_hull`;
  hull.layers.set(layer);
  hull.castShadow = false;
  hull.receiveShadow = false;
  hull.frustumCulled = mesh.frustumCulled;
  hull.raycast = () => {};
  return hull;
}
