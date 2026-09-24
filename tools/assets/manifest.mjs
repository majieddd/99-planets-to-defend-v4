// public/assets/manifest.json: one entry per sidecar, merged with the stats of its exported file.
// No timestamp, so rebuilding unchanged assets leaves the manifest byte-identical.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectGlb } from './inspect.mjs';

export function manifestEntry(meta, stats) {
  return {
    name: meta.name,
    family: meta.family,
    kind: meta.kind,
    file: meta.file,
    nodes: stats?.nodes?.length ? stats.nodes : meta.nodes,
    animations: (meta.animations ?? []).map((animation) => ({
      ...animation,
      exportedDuration: stats?.animations.find((s) => s.name === animation.name)?.duration ?? null,
    })),
    tris: stats?.tris ?? 0,
    bones: stats?.bones ?? 0,
    textures: stats?.textures ?? [],
    hasInk: stats?.hasInk ?? false,
    bytes: stats?.bytes ?? 0,
  };
}

function metaFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return metaFiles(path);
    return name.endsWith('.meta.json') ? [path] : [];
  });
}

export async function writeManifest(publicDir) {
  const entries = [];
  for (const path of metaFiles(publicDir)) {
    const meta = JSON.parse(readFileSync(path, 'utf8'));
    const stats = meta.kind === 'model' ? await inspectGlb(join(publicDir, meta.file)) : null;
    entries.push(manifestEntry(meta, stats));
  }
  entries.sort((a, b) => a.family.localeCompare(b.family) || a.name.localeCompare(b.name));
  const manifest = { version: 1, assets: entries };
  writeFileSync(join(publicDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
