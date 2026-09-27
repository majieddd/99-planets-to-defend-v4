#!/usr/bin/env node
// npm run assets [-- --only bulwark,husk] [--jobs 3] [--no-previews]
// Runs Blender recipes headless (brushes first: paint bakes read its stroke texture), optimizes each raw
// GLB with its sidecar into a staged copy of public/assets, writes the manifest there, publishes what it
// wrote to public/assets only once all of it has passed, and composes preview contact sheets.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { runBlender } from './blender.mjs';
import { writeManifest } from './manifest.mjs';
import { optimizeGlb } from './optimize.mjs';
import { composeSheets } from './sheet.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const RAW = join(ROOT, 'build', 'assets', 'raw');
const PREVIEWS = join(ROOT, 'build', 'assets', 'previews');
const STAGE = join(ROOT, 'build', 'assets', 'stage');
const PUBLIC = join(ROOT, 'public', 'assets');
const MANIFEST = join(PUBLIC, 'manifest.json');
const TEXTURES = join(PUBLIC, 'textures');
const SHEETS = join(ROOT, 'docs', 'evidence', 'assets');

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

const all = readdirSync(join(ROOT, 'blender', 'recipes'))
  .filter((file) => file.endsWith('.py') && !file.startsWith('_'))
  .map((file) => file.slice(0, -3))
  .sort();
const selected = option('only')?.split(',').filter(Boolean) ?? all;
for (const name of selected) if (!all.includes(name)) throw new Error(`unknown recipe '${name}' (have ${all.join(', ')})`);
// --jobs 0 or --jobs x reached the pool as 0 or NaN, which starts no workers, so the build ran brushes
// alone and exited 0 as if it had built everything it was asked to.
const jobsText = process.argv.includes('--jobs') ? (option('jobs') ?? '') : '3';
if (!/^[1-9][0-9]*$/.test(jobsText)) throw new Error(`--jobs needs a whole number of 1 or more, got '${jobsText}'`);
const jobs = Number(jobsText);
const previews = !process.argv.includes('--no-previews');

async function recipe(name) {
  const started = Date.now();
  const args = ['--python', join(ROOT, 'blender', 'run.py'), '--', '--recipe', name, '--out', RAW, '--previews', PREVIEWS, '--textures', TEXTURES];
  if (!previews) args.push('--no-previews');
  const result = await runBlender(args, { label: name });
  const ok = result.code === 0 && result.log.includes(`RECIPE_OK ${name}`);
  console.log(`recipe ${name}: ${ok ? 'ok' : 'FAILED'} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (!ok) console.log(result.log.split(/\r?\n/).slice(-40).join('\n'));
  return { name, ok };
}

async function pool(names, size) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < names.length) results.push(await recipe(names[next++]));
  }
  await Promise.all(Array.from({ length: Math.min(size, names.length) }, worker));
  return results;
}

function sidecars(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sidecars(path);
    return name.endsWith('.meta.json') ? [path] : [];
  });
}

/**
 * Optimizes each built recipe's GLB, copies its sidecar and writes the manifest, all in STAGE, a fresh copy of
 * public/assets, and returns the manifest with the files written, relative to the asset root. The build used to write
 * straight into public/assets and the manifest last: inspect.mjs refuses some files (a rotated handle, morph targets,
 * extra skin influence sets) by throwing inside writeManifest, and by then the refused GLB was published beside the
 * old manifest, which assets:check passed.
 */
async function stage(built) {
  rmSync(STAGE, { recursive: true, force: true });
  if (existsSync(PUBLIC)) cpSync(PUBLIC, STAGE, { recursive: true });
  else mkdirSync(STAGE, { recursive: true });
  const files = [];
  for (const path of sidecars(RAW)) {
    const meta = JSON.parse(readFileSync(path, 'utf8'));
    if (!built.has(meta.recipe)) continue;
    mkdirSync(join(STAGE, meta.family), { recursive: true });
    if (meta.kind === 'model') {
      await optimizeGlb(join(RAW, meta.file), join(STAGE, meta.file));
      files.push(meta.file);
    }
    const sidecar = join(meta.family, `${meta.name}.meta.json`);
    copyFileSync(path, join(STAGE, sidecar));
    files.push(sidecar);
  }
  return { manifest: await writeManifest(STAGE), files };
}

// The old manifest goes first and the new one last, so a publish that stops partway leaves no manifest,
// which assets:check fails, rather than the old manifest over some of the new files.
function publish(files) {
  rmSync(MANIFEST, { force: true });
  for (const file of files) {
    mkdirSync(dirname(join(PUBLIC, file)), { recursive: true });
    copyFileSync(join(STAGE, file), join(PUBLIC, file));
  }
  copyFileSync(join(STAGE, 'manifest.json'), MANIFEST);
}

function fail(message, error) {
  console.log(`assets: FAILED ${message}`);
  if (error) console.log(error.stack ?? error);
  process.exit(1);
}

const results = [];
if (selected.includes('brushes') || !existsSync(join(TEXTURES, 'brush_strokes.png'))) {
  const brushes = await recipe('brushes');
  results.push(brushes);
  // Every paint bake reads the brush atlas, yet the build went on without it: it baked every other recipe
  // against an old, partial or missing atlas, published those models and exited 1 only at the end. Brushes
  // writes its textures straight into public/assets/textures, so a failure may already have replaced them
  // there, and the manifest goes with them.
  if (!brushes.ok) {
    rmSync(MANIFEST, { force: true });
    fail(
      'at brushes, whose atlas every paint bake reads, so nothing else was built; brushes writes ' +
        'public/assets/textures itself, so public/assets/manifest.json was removed until a build passes',
    );
  }
}
results.push(...(await pool(selected.filter((name) => name !== 'brushes'), jobs)));
const built = new Set(results.filter((r) => r.ok).map((r) => r.name));

let staged;
try {
  staged = await stage(built);
} catch (error) {
  fail('before publishing; no model, sidecar or manifest in public/assets was changed:', error);
}
try {
  publish(staged.files);
} catch (error) {
  fail('while publishing; public/assets/manifest.json is removed until a build passes, so assets:check fails:', error);
}
if (previews) await composeSheets(PREVIEWS, SHEETS);
const failed = results.filter((r) => !r.ok).map((r) => r.name);
console.log(`assets: built=${built.size} failed=${failed.length}${failed.length ? ` (${failed.join(', ')})` : ''} manifest=${staged.manifest.assets.length}`);
if (failed.length) process.exit(1);
