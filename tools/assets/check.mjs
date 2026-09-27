#!/usr/bin/env node
// npm run assets:check: every exported asset against its family budget, the shared strike timings and the ground
// contact rule.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRAME = 1 / 30;
// How far a placeable's lowest point may sit from its placement origin, or from its declared sink under it, on either
// side, and still stand on the ground as designed: far above the manifest's 0.1 mm rounding and the few millimetres an
// asset reaches by construction (the Husk's legs, 2.4 mm into the ground), and far below the 0.15 to 0.26 m by which
// the Bolt Sentinel's mid-plinth roots sank its marks.
export const GROUND_TOLERANCE = 0.005;
// The deepest sink a recipe may declare. A sink beds an edge into uneven ground (the Verdant rocks 0.05 m, the bush
// 0.114, the nest's spikes 0.123, the deepest today); a deeper allowance would start to cover a misplaced origin
// instead. The cap was 0.15 m, which broke that promise: a sink passes GROUND_TOLERANCE either side of it, so a
// declared 0.15 m passed the Bolt Sentinel's old mark I root, mid-plinth, 0.150 m over its lowest point. At 0.14 m the
// deepest point any sink passes is 0.145 m down, 5 mm short of that root.
export const MAX_SINK = 0.14;

/**
 * The ground contact rule: the lowest bind-pose point of everything the runtime places by itself must sit within
 * GROUND_TOLERANCE of its placement origin or, where its recipe declares a sink, of that depth under it, on either
 * side. A declared sink is the depth the geometry has, not a bound on it: as a bound it let the bush declare 0.12 m
 * over 0.1138 m of geometry, and it would let a piece sink further than designed, down to its bound, without a
 * failure. A manifest written before the rule has no ground data and fails rather than passing unmeasured.
 */
export function groundFailures(ground) {
  if (!Array.isArray(ground) || ground.length === 0) {
    return ['no ground data (the manifest predates the ground rule; run npm run assets)'];
  }
  const failures = [];
  for (const { node, minY, sink } of ground) {
    const what = node === null ? 'the whole asset' : `'${node}'`;
    if (!(Number.isFinite(sink) && sink >= 0)) {
      failures.push(`ground ${what}: sink ${sink} is not a depth in metres`);
      continue;
    }
    if (sink > MAX_SINK) failures.push(`ground ${what}: sink ${sink} m > ${MAX_SINK} m`);
    const shallowest = GROUND_TOLERANCE - sink;
    const deepest = -(sink + GROUND_TOLERANCE);
    if (!Number.isFinite(minY)) {
      failures.push(`ground ${what}: not measured (no such top-level node, or no geometry under it)`);
    } else if (minY > shallowest && sink === 0) {
      failures.push(`ground ${what}: lowest point +${minY.toFixed(4)} m floats (limit +${GROUND_TOLERANCE})`);
    } else if (minY > shallowest) {
      failures.push(
        `ground ${what}: lowest point ${minY.toFixed(4)} m is shallower than its declared sink of ${sink} m ` +
          `(limit ${shallowest.toFixed(4)})`,
      );
    } else if (minY < deepest) {
      failures.push(`ground ${what}: lowest point ${minY.toFixed(4)} m sinks (limit ${deepest.toFixed(4)})`);
    }
  }
  return failures;
}

export function evaluateAsset(entry, budgets, timings) {
  if (entry.kind !== 'model') return [];
  const budget = budgets[entry.family];
  if (!budget) return [`no budget for family '${entry.family}'`];
  const failures = [];
  if (entry.tris > budget.tris) failures.push(`tris ${entry.tris} > ${budget.tris}`);
  if (entry.bones > budget.bones) failures.push(`bones ${entry.bones} > ${budget.bones}`);
  for (const texture of entry.textures) {
    if (texture.width > budget.texture || texture.height > budget.texture) {
      failures.push(`texture ${texture.width}x${texture.height} > ${budget.texture}`);
    }
  }
  if (budget.ink && !entry.hasInk) failures.push('missing _INK attribute');
  // Blender exports any material without backface culling as double-sided, and the runtime would then draw and
  // shadow both faces of every mesh using it; a mesh that needs both faces says so in its own extras.
  if (entry.doubleSided) failures.push('double-sided material');
  failures.push(...groundFailures(entry.ground));
  for (const name of budget.animations ?? []) {
    const animation = entry.animations.find((a) => a.name === name);
    if (!animation) {
      failures.push(`missing animation '${name}'`);
      continue;
    }
    if (animation.exportedDuration === null) failures.push(`animation '${name}' is not in the GLB`);
    const timing = timings[entry.family]?.[entry.name]?.[name];
    if (!timing) continue;
    if (Math.abs(animation.duration - timing.duration) > FRAME) {
      failures.push(`${name} duration ${animation.duration} != timings ${timing.duration}`);
    }
    if (animation.exportedDuration !== null && Math.abs(animation.exportedDuration - timing.duration) > FRAME) {
      failures.push(`${name} exported duration ${animation.exportedDuration.toFixed(3)} != timings ${timing.duration}`);
    }
    if (Math.abs((animation.strike ?? -1) - timing.strike) > FRAME) {
      failures.push(`${name} strike ${animation.strike} != timings ${timing.strike}`);
    }
  }
  return failures;
}

function main() {
  const root = resolve(import.meta.dirname, '..', '..');
  const manifestPath = join(root, 'public', 'assets', 'manifest.json');
  if (!existsSync(manifestPath)) {
    // This printed "skipped" and exited 0, from before any asset was built. The assets are committed now and CI runs
    // this check against them, so a missing manifest means the build output is gone, and a pass would check nothing.
    console.log('assets:check FAIL: public/assets/manifest.json is missing (run npm run assets)');
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const budgets = JSON.parse(readFileSync(join(root, 'tools', 'assets', 'budgets.json'), 'utf8'));
  const timings = JSON.parse(readFileSync(join(root, 'src', 'shared', 'timings.json'), 'utf8'));
  let pass = 0;
  let fail = 0;
  for (const entry of manifest.assets) {
    const failures = evaluateAsset(entry, budgets, timings);
    if (!existsSync(join(root, 'public', 'assets', entry.file))) failures.push(`file missing: ${entry.file}`);
    if (failures.length) {
      fail += 1;
      console.log(`ASSET ${entry.name} FAIL: ${failures.join('; ')}`);
    } else {
      pass += 1;
      console.log(`ASSET ${entry.name} ok (${entry.tris} tris, ${Math.round(entry.bytes / 1024)} KB)`);
    }
  }
  console.log(`assets:check pass=${pass} fail=${fail}`);
  if (fail) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
