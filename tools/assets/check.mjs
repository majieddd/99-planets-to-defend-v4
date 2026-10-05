#!/usr/bin/env node
// npm run assets:check: every exported asset against its family budget, the shared strike timings and the ground
// contact rule, and every listed file against the manifest.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isMain } from '../is-main.mjs';

// The exporter's sampling step: the recipes key and export their clips at 30 fps (blender/lib/anim.py FPS), so a clip
// lasts a whole number of frames and its duration and strike can miss a contract that falls between two frames by up
// to one. Pip's and Bulwark's attacks are timed 0.85 s, 25.5 frames, and export as 25 frames, 0.8333 s.
const FRAME = 1 / 30;
// How far a placeable's lowest point may sit from its placement origin, or from its declared sink under it, on either
// side, and still stand on the ground as designed: far above the manifest's 0.1 mm rounding and the few millimetres an
// asset reaches by construction (the Husk's legs, 2.4 mm into the ground), and far below the 0.15 to 0.26 m by which
// the Bolt Sentinel's mid-plinth roots sank its marks.
export const GROUND_TOLERANCE = 0.005;
// The deepest sink a recipe may declare. A sink beds an edge into uneven ground (the Verdant rocks 0.05 m, the bush
// 0.119, the nest's spikes 0.123, the deepest today); a deeper allowance would start to cover a misplaced origin
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
  // A model may carry only the morph targets its family names (the commanders' five face morphs, which the labs' face
  // driver sets), and a family that names none takes none: a stray shape key costs every vertex of its mesh a morph
  // fetch in both the painted and the hull shader, and nothing would drive it.
  const allowed = budget.morphs ?? [];
  const stray = (entry.morphs ?? []).filter((name) => !allowed.includes(name));
  if (stray.length) failures.push(`morph targets ${stray.join(', ')} not in the ${entry.family} budget's list (${allowed.join(', ') || 'none'})`);
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

/**
 * The clips of a model that src/shared/timings.json times, as the check held them ("attack 0.85 s, strike 0.34 s"), for
 * its pass line: a timed clip that passed shows there, so a reader sees which contracts the check enforced.
 */
export function timedClips(entry, timings) {
  if (entry.kind !== 'model') return [];
  return Object.entries(timings[entry.family]?.[entry.name] ?? {})
    .filter(([name]) => entry.animations.some((a) => a.name === name))
    .map(([name, timing]) => `${name} ${timing.duration} s, strike ${timing.strike} s`);
}

/**
 * The listed file against its manifest entry, where `size` is the committed file's length in bytes, or null when there
 * is no such file. The check reads the numbers the build recorded, never the GLB, so a model rebuilt or edited without
 * rewriting the manifest used to pass on the numbers of the file it replaced. A model must now be exactly the length
 * the build recorded, the one fact about the file itself that can be compared without reading it. Textures record no
 * length (bytes 0), so only their presence is checked.
 */
export function fileFailures(entry, size) {
  if (size === null) return [`file missing: ${entry.file}`];
  if (entry.kind === 'model' && size !== entry.bytes) {
    return [`${entry.file} is ${size} bytes, the manifest records ${entry.bytes} (changed without npm run assets)`];
  }
  return [];
}

// Anything at the path but a file, a directory say, is as missing as no entry at all.
function fileSize(path) {
  const stats = statSync(path, { throwIfNoEntry: false });
  return stats?.isFile() ? stats.size : null;
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
    failures.push(...fileFailures(entry, fileSize(join(root, 'public', 'assets', entry.file))));
    if (failures.length) {
      fail += 1;
      console.log(`ASSET ${entry.name} FAIL: ${failures.join('; ')}`);
    } else {
      pass += 1;
      const timed = timedClips(entry, timings);
      const note = timed.length ? `; ${timed.join(', ')} as timings.json sets` : '';
      console.log(`ASSET ${entry.name} ok (${entry.tris} tris, ${Math.round(entry.bytes / 1024)} KB${note})`);
    }
  }
  console.log(`assets:check pass=${pass} fail=${fail}`);
  if (fail) process.exit(1);
}

// This compared argv[1], the path as typed, with the module's own path, which Node resolves through links, so run
// through a junction or symlink the check printed nothing and exited 0, even with the manifest missing.
if (isMain(import.meta.url)) main();
