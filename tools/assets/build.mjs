#!/usr/bin/env node
// npm run assets [-- --only bulwark,husk] [--jobs 3] [--no-previews]
// Runs Blender recipes headless (brushes first: paint bakes read its stroke texture), optimizes each raw
// GLB into public/assets with its sidecar, rewrites the manifest and composes preview contact sheets.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runBlender } from './blender.mjs';
import { writeManifest } from './manifest.mjs';
import { optimizeGlb } from './optimize.mjs';
import { composeSheets } from './sheet.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const RAW = join(ROOT, 'build', 'assets', 'raw');
const PREVIEWS = join(ROOT, 'build', 'assets', 'previews');
const PUBLIC = join(ROOT, 'public', 'assets');
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
const jobs = Number(option('jobs') ?? 3);
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

const results = [];
if (selected.includes('brushes') || !existsSync(join(TEXTURES, 'brush_strokes.png'))) results.push(await recipe('brushes'));
results.push(...(await pool(selected.filter((name) => name !== 'brushes'), jobs)));
const built = new Set(results.filter((r) => r.ok).map((r) => r.name));

for (const path of sidecars(RAW)) {
  const meta = JSON.parse(readFileSync(path, 'utf8'));
  if (!built.has(meta.recipe)) continue;
  mkdirSync(join(PUBLIC, meta.family), { recursive: true });
  if (meta.kind === 'model') await optimizeGlb(join(RAW, meta.file), join(PUBLIC, meta.file));
  copyFileSync(path, join(PUBLIC, meta.family, `${meta.name}.meta.json`));
}

const manifest = await writeManifest(PUBLIC);
if (previews) await composeSheets(PREVIEWS, SHEETS);
const failed = results.filter((r) => !r.ok).map((r) => r.name);
console.log(`assets: built=${built.size} failed=${failed.length}${failed.length ? ` (${failed.join(', ')})` : ''} manifest=${manifest.assets.length}`);
if (failed.length) process.exit(1);
