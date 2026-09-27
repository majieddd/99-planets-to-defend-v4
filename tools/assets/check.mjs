#!/usr/bin/env node
// npm run assets:check: every exported asset against its family budget and the shared strike timings.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRAME = 1 / 30;

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
    console.log('assets:check skipped (no manifest yet; run npm run assets)');
    return;
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
