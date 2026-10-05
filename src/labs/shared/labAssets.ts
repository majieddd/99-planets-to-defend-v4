import { DataTexture, NoColorSpace, RedFormat, RepeatWrapping, TextureLoader, type Texture } from 'three';
import type { Manifest } from '../../render/assets/manifest';
import { loadAsset, type LoadedAsset, type MaterialContext } from '../../render/assets/loadAsset';

/** A one-texel grey texture, the stand-in for a brush atlas or ink noise that is missing. */
export function flatTexture(value: number): Texture {
  const texture = new DataTexture(new Uint8Array([value]), 1, 1, RedFormat);
  texture.needsUpdate = true;
  return texture;
}

/**
 * The brush atlas and the ink noise are requested only when the manifest lists them. Until the asset track's first
 * build there is no public/assets, and GitHub Pages answers each missing file with a 404 that Chromium logs as a
 * console error (Vite's dev and preview servers hide this by answering with index.html), so the flat grey fallback
 * stands in without a request.
 */
function textureUrl(base: string, manifest: Manifest | null, name: string): string | null {
  const entry = manifest?.assets.find((asset) => asset.name === name && asset.kind === 'texture');
  return entry ? `${base}assets/${entry.file}` : null;
}

/**
 * Null when the manifest does not list the texture or its load failed, so the caller knows whether the real texture
 * arrived. A failed load used to hand back the flat grey without a word, and the Style Lab's sky, which checked only
 * that the manifest listed the atlas, took that grey and drew a solid slab of cloud. The warning names the page and the
 * texture; it is a warning rather than an error because the page still runs, and the browser tests fail on console
 * errors.
 */
export async function loadManifestTexture(base: string, manifest: Manifest | null, name: string, page: string): Promise<Texture | null> {
  const url = textureUrl(base, manifest, name);
  if (!url) return null;
  try {
    const texture = await new TextureLoader().loadAsync(url);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.colorSpace = NoColorSpace; // data, not colour
    return texture;
  } catch (error) {
    console.warn(`${page}: texture ${name} failed to load from ${url}; using the flat fallback`, error);
    return null;
  }
}

/**
 * A model's sidecar notes: the `notes` of the .meta.json the build writes beside its GLB (public/assets/<family>/<name>
 * .meta.json), which carries what the GLB cannot, such as a clip's recorded root motion (notes.root_motion, which Play
 * Pip's lunge reads). Null when the manifest does not list the model or the file does not load, with a warning naming
 * the page and the file in the second case, since the manifest promised it. The labs never read a sidecar before; it is
 * one small file fetched beside the model, so the arena stays a two-model page.
 */
export async function fetchModelNotes(base: string, manifest: Manifest | null, name: string, page: string): Promise<unknown> {
  const entry = manifest?.assets.find((asset) => asset.name === name && asset.kind === 'model');
  if (!entry) return null;
  const url = `${base}assets/${entry.file.replace(/[.]glb$/, '.meta.json')}`;
  try {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const sidecar = (await response.json()) as { notes?: unknown };
    return sidecar.notes ?? null;
  } catch (error) {
    console.warn(`${page}: the sidecar of ${name} failed to load from ${url}; its clips take no recorded root motion`, error);
    return null;
  }
}

/**
 * GLTFLoader's errors need not name the model (a parse error names neither asset nor file), so a failed load reached
 * the banner and the console without saying which model it was. The manifest name and URL now travel with it.
 */
export async function loadNamedAsset(name: string, url: string, ctx: MaterialContext, blend: number): Promise<LoadedAsset> {
  try {
    return await loadAsset(url, ctx, blend);
  } catch (error) {
    throw new Error(`asset ${name} failed to load from ${url}: ${String(error)}`, { cause: error });
  }
}
