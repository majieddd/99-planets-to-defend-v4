export interface ManifestAnimation {
  name: string;
  duration: number;
  loop: boolean;
  strike: number | null;
  exportedDuration: number | null;
}

export interface ManifestEntry {
  name: string;
  family: string;
  kind: 'model' | 'texture';
  file: string;
  nodes: string[];
  animations: ManifestAnimation[];
  tris: number;
  bones: number;
  hasInk: boolean;
  bytes: number;
}

export interface Manifest {
  version: number;
  assets: ManifestEntry[];
}

/** Null when no assets have been built yet; the lab then uses placeholders. */
export async function fetchManifest(base: string): Promise<Manifest | null> {
  try {
    const response = await fetch(`${base}assets/manifest.json`, { cache: 'no-cache' });
    if (!response.ok) return null;
    return (await response.json()) as Manifest;
  } catch {
    return null;
  }
}

export function assetUrl(base: string, manifest: Manifest, name: string): string | null {
  const entry = manifest.assets.find((asset) => asset.name === name && asset.kind === 'model');
  return entry ? `${base}assets/${entry.file}` : null;
}
