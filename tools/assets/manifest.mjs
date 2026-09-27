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
    doubleSided: stats?.doubleSided ?? false,
    ground: stats?.ground ? groundEntries(meta.placeables, stats.ground) : [],
    bytes: stats?.bytes ?? 0,
  };
}

/**
 * The ground contact of everything the runtime places by itself, for assets:check: each placeable the recipe declared
 * (the whole asset when it declared none) and every top-level empty of the GLB with geometry under it, which the
 * runtime would place as a handle whether declared or not. node is a top-level node's name, or null for the whole
 * asset; minY is the lowest point of its geometry under its placement origin, in metres (inspect.mjs measureGround),
 * or null when the GLB has no such top-level node or no geometry under it; sink is the depth the recipe designed, in
 * metres, which minY must match within the check's tolerance (check.mjs groundFailures).
 */
export function groundEntries(placeables, measured) {
  const top = new Map(measured.nodes.map((node) => [node.name, node]));
  const declared = placeables?.length ? placeables : [{ node: null, sink: 0 }];
  const entries = declared.map(({ node = null, sink = 0 }) => ({
    node,
    minY: node === null ? measured.asset : (top.get(node)?.minY ?? null),
    sink,
  }));
  for (const node of measured.nodes) {
    // A top-level empty with no geometry under it, a marker, has nothing to stand on the ground.
    if (!node.empty || node.minY === null || entries.some((entry) => entry.node === node.name)) continue;
    entries.push({ node: node.name, minY: node.minY, sink: 0 });
  }
  return entries;
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
