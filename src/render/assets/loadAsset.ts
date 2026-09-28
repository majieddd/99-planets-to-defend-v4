import { Color, DoubleSide, type AnimationClip, type Group, type Material, type Mesh, type MeshStandardMaterial, type Object3D, type ShaderMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { attachHull } from '../ink/hull';
import { createPaintedMaterial, DEFAULT_STANDARD_BLEND, type PaintUniforms } from '../materials/painted';

export interface MaterialContext {
  paint: PaintUniforms;
  hullMaterial: ShaderMaterial;
  hullLayer: number;
}

export interface LoadedAsset {
  root: Group;
  animations: AnimationClip[];
}

/**
 * Collect first, change afterwards. Adding hull children inside traverse() makes traverse visit the new
 * hulls and give them hulls of their own, forever; the reference repo lost a scene to exactly that.
 */
export function collectMeshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((object) => {
    if ((object as Mesh).isMesh) out.push(object as Mesh);
  });
  return out;
}

/** GLTFLoader can hand back unlit and other materials, so any of these may be missing. */
type SourceMaterial = Material & Partial<Pick<MeshStandardMaterial, 'map' | 'emissiveMap' | 'emissive' | 'emissiveIntensity' | 'color'>>;

/** Swaps GLB materials for painted ones (shared per source and sidedness) and inks meshes that carry _ink. */
export function paintAndInk(root: Object3D, ctx: MaterialContext, standardBlend: number): void {
  const cache = new Map<string, ShaderMaterial>();
  for (const mesh of collectMeshes(root)) {
    // Hulls are ink, not source meshes, and meshes an earlier pass painted (a clone of a loaded asset, a scene
    // root) no longer carry their source colours: converting either paints it flat white and adds another hull.
    if (mesh.material === ctx.hullMaterial || (mesh.material as Material).userData['painted'] === true) continue;
    // glTF lets a primitive omit normals. Without them the hull's ink normals throw and stop the lab, and the
    // painted lighting normalizes a zero vector into NaN pixels that bloom smears into blocks.
    if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
    const source = mesh.material as SourceMaterial;
    const doubleSided = source.side === DoubleSide || mesh.userData['double_sided'] === true;
    const key = `${source.uuid}:${doubleSided}`;
    let painted = cache.get(key);
    if (!painted) {
      painted = createPaintedMaterial(ctx.paint, {
        map: source.map ?? null,
        emissiveMap: source.emissiveMap ?? null,
        emissiveColor: source.emissive ? source.emissive.clone() : new Color(0, 0, 0),
        emissiveIntensity: source.emissiveIntensity ?? 1,
        baseColor: source.map ? new Color(1, 1, 1) : (source.color?.clone() ?? new Color(1, 1, 1)),
        doubleSided,
        standardBlend,
      });
      cache.set(key, painted);
    }
    mesh.material = painted;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const ink = mesh.geometry.getAttribute('_ink');
    if (ink) {
      mesh.geometry.setAttribute('inkWidth', ink);
      attachHull(mesh, ctx.hullMaterial, ctx.hullLayer);
    }
  }
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

// A caller that names no blend loads a prop, the same blend createPaintedMaterial gives a material created without one.
export async function loadAsset(url: string, ctx: MaterialContext, standardBlend = DEFAULT_STANDARD_BLEND): Promise<LoadedAsset> {
  const gltf = await loader.loadAsync(url);
  paintAndInk(gltf.scene, ctx, standardBlend);
  return { root: gltf.scene, animations: gltf.animations };
}
