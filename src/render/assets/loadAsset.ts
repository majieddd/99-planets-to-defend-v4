import {
  BufferAttribute,
  Color,
  DoubleSide,
  type AnimationClip,
  type Group,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type ShaderMaterial,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { attachHull } from '../ink/hull';
import { LAYERS } from '../layers';
import { createPaintedMaterial, DECAL_ALPHA_CUTOFF, DEFAULT_STANDARD_BLEND, type DecalAtlas, type PaintUniforms } from '../materials/painted';

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

/** The glTF node extras key that marks an expression decal (docs/blueprint.md, Kit, Expression atlases). */
export const ATLAS_EXTRAS_KEY = 'p99_atlas';

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1;

/**
 * Reads a decal's p99_atlas extras, such as {"cols": 4, "rows": 1, "states": ["open", "half", "closed", "happy"],
 * "cellUV": [0.25, 1]}, for the node named `name`. cellUV may be left out, and each cell is then 1 / cols by 1 / rows.
 * A malformed atlas warns, naming the node and the fault, and comes back with no states: the mesh still draws as a
 * decal, cut out and without ink, at the cell its UVs point at, but nothing can switch it. Throwing would stop the whole
 * lab for one bad face, and drawing it as a plain mesh would paint the atlas's transparent texels over the skin.
 */
export function readDecalAtlas(value: unknown, name: string): DecalAtlas {
  const role = /eye/i.test(name) ? 'eyes' : /mouth/i.test(name) ? 'mouth' : null;
  if (role === null) console.warn(`decal ${name}: its node name names neither eyes nor a mouth, so the face driver will not drive it`);
  const faults: string[] = [];
  const raw = (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  if (raw !== value) faults.push('it is not an object');
  let cols = 1;
  if (isCount(raw['cols'])) cols = raw['cols'];
  else faults.push('cols is not a whole number of 1 or more');
  let rows = 1;
  if (isCount(raw['rows'])) rows = raw['rows'];
  else faults.push('rows is not a whole number of 1 or more');
  let cellUV: [number, number] = [1 / cols, 1 / rows];
  const cell = raw['cellUV'];
  if (cell !== undefined) {
    const fits = Array.isArray(cell) && cell.length === 2 && cell.every((v) => typeof v === 'number' && v > 0 && v <= 1);
    // The grid must fit inside the texture, give or take the rounding of a cell size written as a decimal.
    if (fits && cols * (cell[0] as number) <= 1 + 1e-6 && rows * (cell[1] as number) <= 1 + 1e-6) cellUV = [cell[0] as number, cell[1] as number];
    else faults.push('cellUV is not two sizes from 0 to 1 whose grid fits in the texture');
  }
  let states: string[] = [];
  const list = raw['states'];
  if (Array.isArray(list) && list.every((s) => typeof s === 'string' && s.length > 0) && new Set(list).size === list.length) {
    if (list.length <= cols * rows) states = list as string[];
    else faults.push(`it names ${list.length} states for ${cols * rows} cells`);
  } else {
    faults.push('states is not a list of distinct names');
  }
  if (faults.length) console.warn(`decal ${name}: ${ATLAS_EXTRAS_KEY} is malformed, so the decal stays at the cell its UVs name: ${faults.join('; ')}`);
  return { cols, rows, states: faults.length ? [] : states, cellUV, role };
}

/**
 * The atlas of a mesh that is an expression decal, or null for every other mesh. GLTFLoader puts a node's extras on the
 * object it makes for the node, which is the mesh itself for a node whose mesh has one primitive, and the group holding
 * the meshes for one with several; the build's quantizer also moves a mesh off a node that has children onto a new child
 * of it, leaving the extras on the parent. So the nearest carrier from the mesh up to the asset's root is taken.
 */
export function decalAtlasOf(mesh: Mesh, root: Object3D): DecalAtlas | null {
  for (let node: Object3D | null = mesh; node; node = node === root ? null : node.parent) {
    if (ATLAS_EXTRAS_KEY in node.userData) return readDecalAtlas(node.userData[ATLAS_EXTRAS_KEY], node.name || mesh.name);
  }
  return null;
}

/**
 * Paints an expression decal: a material of its own, so its cell offset is its own (materials/painted.ts,
 * DECAL_ALPHA_CUTOFF), cut out at the GLB's alpha cutoff or glTF's default, on the noEdge layer and with no hull.
 *
 * No ink at all: the hull would outline the decal's cutout quad, not the eye drawn in it, and the edge pass draws its
 * normals and depth with a stock material that knows nothing of the cutout, so it would ink the quad's border wherever
 * the decal's normals and the skin's part.
 *
 * It takes the face's soft skin light (SKIN_BAND_SOFTNESS), through a skin weight of 1 the loader gives it unless it
 * carries a _skin of its own. Lit by the cel bands, a terminator crossing the face would step at the decal's border
 * while the skin around it ramped softly, and the brush atlas (the prop brush) would stroke the eye whites; flat, an eye
 * would keep its colour in the face's shadow. With the skin's light and the skin's normals under it, the eye white darkens
 * exactly as the cheek beside it does, so the decal reads as painted on the face rather than stuck over it.
 *
 * It receives shadows, so hair and the brow shade the eyes as they shade the skin, but casts none: the skin under it
 * already casts the head's shadow, and the decal's cutout would cast its whole quad, since three's shadow pass knows
 * nothing of a ShaderMaterial's map.
 */
function paintDecal(mesh: Mesh, source: SourceMaterial, atlas: DecalAtlas, ctx: MaterialContext, standardBlend: number, doubleSided: boolean): void {
  const geometry = mesh.geometry;
  const skin = geometry.getAttribute('_skin') ?? new BufferAttribute(new Float32Array(geometry.getAttribute('position').count).fill(1), 1);
  geometry.setAttribute('skinMask', skin);
  const material = createPaintedMaterial(ctx.paint, {
    map: source.map ?? null,
    emissiveMap: source.emissiveMap ?? null,
    emissiveColor: source.emissive ? source.emissive.clone() : new Color(0, 0, 0),
    emissiveIntensity: source.emissiveIntensity ?? 1,
    baseColor: source.map ? new Color(1, 1, 1) : (source.color?.clone() ?? new Color(1, 1, 1)),
    doubleSided,
    standardBlend,
    skin: true,
    decal: true,
    // GLTFLoader gives a MASK material its alphaCutoff here; a BLEND or OPAQUE one reads 0 and takes the default.
    alphaTest: source.alphaTest > 0 ? source.alphaTest : DECAL_ALPHA_CUTOFF,
  });
  material.userData['decalAtlas'] = atlas;
  // The mesh this material's offset belongs to; the face driver gives a clone of the rig a material of its own.
  material.userData['decalOwner'] = mesh.uuid;
  mesh.material = material;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.layers.set(LAYERS.noEdge);
}

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
 *
 * An expression decal, a mesh under a node with p99_atlas extras, is painted apart and never inked (paintDecal).
 */
export function paintAndInk(root: Object3D, ctx: MaterialContext, standardBlend: number): void {
  const cache = new Map<string, ShaderMaterial>();
  for (const mesh of collectMeshes(root)) {
    // Hulls are ink, not source meshes, and meshes an earlier pass painted (a clone of a loaded asset, a scene
    // root) no longer carry their source colours: converting either paints it flat white and adds another hull.
    if (mesh.material === ctx.hullMaterial || (mesh.material as Material).userData['painted'] === true) continue;
    // glTF lets a primitive omit normals. Without them the hull's ink normals throw and stop the lab, and the
    // painted lighting normalizes a zero vector into NaN pixels that bloom smears into blocks.
    // Only a missing attribute is filled in: authored normals, the face's proxy-ellipsoid ones included, reach the
    // painted lighting as the GLB carries them, decals too.
    if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
    const source = mesh.material as SourceMaterial;
    const doubleSided = source.side === DoubleSide || mesh.userData['double_sided'] === true;
    // An expression decal takes its own branch; every mesh without p99_atlas extras, which is every asset built before
    // the anime face, goes on exactly as it did.
    const atlas = decalAtlasOf(mesh, root);
    if (atlas) {
      paintDecal(mesh, source, atlas, ctx, standardBlend, doubleSided);
      continue;
    }
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
