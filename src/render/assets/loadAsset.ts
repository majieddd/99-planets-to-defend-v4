import { Color, DoubleSide, type AnimationClip, type Group, type Material, type Mesh, type MeshStandardMaterial, type Object3D, type ShaderMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { attachHull } from '../ink/hull';
import { LAYERS } from '../layers';
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

/**
 * Swaps GLB materials for painted ones (shared per source, sidedness and skin) and inks meshes that carry _ink.
 *
 * A mesh that carries _skin (GLTFLoader lower-cases a glTF's _SKIN), a commander's body with its face, ears and neck,
 * takes a painted material that reads the weight as skinMask and softens the light on skin (materials/painted.ts,
 * SKIN_BAND_SOFTNESS), and moves to the noEdge layer, out of the screen-space edge pass. That pass inks every normal and
 * depth jump the world layer shows, which on a face means lines at the nose, the lips and the eyes; the silhouette
 * stays inked by the hull, which _ink controls per vertex. The choice is per mesh, so it has a cost: garments and hair
 * on the skinned mesh lose their crease ink too, while armour exported as a mesh of its own keeps it (the commander's
 * armour is its own mesh, without _skin). A per-pixel mask the edge pass reads would spare the garments, but it needs
 * its own normal material in place of the edge pass's stock one, which every existing frame depends on.
 */
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
    // A missing weight means no skin, so a mesh without _skin keeps the material, and the frame, it always had.
    const skin = mesh.geometry.getAttribute('_skin');
    const key = `${source.uuid}:${doubleSided}:${skin ? 'skin' : 'plain'}`;
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
        skin: skin !== undefined,
      });
      cache.set(key, painted);
    }
    mesh.material = painted;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (skin) {
      mesh.geometry.setAttribute('skinMask', skin);
      mesh.layers.set(LAYERS.noEdge);
    }
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
