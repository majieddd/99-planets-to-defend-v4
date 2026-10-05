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
  // The family's required clips, and every clip src/shared/timings.json times for this model: a timed clip is as
  // required as the family's, since the game reads its contract from that file. Only the family's clips were walked,
  // so a timing for a clip the family does not require (Pip's attack_1 to attack_3, which Bulwark does not ship) was
  // never checked, and the clip could miss it, or be missing, with the model still passing.
  const timed = Object.keys(timings[entry.family]?.[entry.name] ?? {});
  for (const name of new Set([...(budget.animations ?? []), ...timed])) {
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
    // A clip with no strike (a recovery) is timed with a strike of null and must export none. Compared as before, a
    // null on both sides read as a strike 1 s off (-1 against null) and a strike key left out compared as NaN, which no
    // test of "more than a frame off" catches, so a timing without its strike passed unchecked.
    if (timing.strike === null) {
      if (animation.strike !== null && animation.strike !== undefined) failures.push(`${name} strike ${animation.strike} != timings null (no strike)`);
    } else if (!(Math.abs((animation.strike ?? -1) - timing.strike) <= FRAME)) {
      failures.push(`${name} strike ${animation.strike} != timings ${timing.strike}`);
    }
  }
  return failures;
}

/**
 * The clips of a model that src/shared/timings.json times, as the check held them ("attack 0.85 s, strike 0.34 s"), for
 * its pass line: a timed clip that passed shows there, so a reader sees which contracts the check enforced. A combo hit
 * also names its active frames and its cancel point ("active 0.15 to 0.28 s, cancel 0.3 s", or "no cancel").
 */
export function timedClips(entry, timings) {
  if (entry.kind !== 'model') return [];
  return Object.entries(timings[entry.family]?.[entry.name] ?? {})
    .filter(([name]) => entry.animations.some((a) => a.name === name))
    .map(([name, timing]) => {
      const windows = hasWindows(timing) ? `, active ${timing.activeFrom} to ${timing.activeTo} s, ${timing.cancel === null ? 'no cancel' : `cancel ${timing.cancel} s`}` : '';
      return `${name} ${timing.duration} s, ${timing.strike === null ? 'no strike' : `strike ${timing.strike} s`}${windows}`;
    });
}

/** The combo window keys a hit's timings.json entry carries beside its length and strike. */
export const WINDOW_KEYS = ['activeFrom', 'activeTo', 'cancel'];
/**
 * The finisher's cuttable recovery: from `recoverFrom` to `recoverTo` seconds into its clip, the stretch of its recovery
 * the labs' "finisher recovery cut" may end it at, where he regains full control and can start a new chain. Optional:
 * a finisher without the keys plays its recovery out to its end, as the hand-keyed one does.
 */
export const RECOVER_KEYS = ['recoverFrom', 'recoverTo'];
/** The sidecar records each cancel rounded to the millisecond (blender/recipes/commander_pip.py, notes.combo). */
const RECORDED_CANCEL_TOLERANCE = 0.0005 + 1e-9;

function hasWindows(timing) {
  return WINDOW_KEYS.some((key) => key in (timing ?? {}));
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * The combo's swing sets as the sidecar records them: its `notes.combo` hits grouped by each record's `set`, in order,
 * so each set's last hit is its finisher. A sidecar from before there were two sets names none, and its hits are one set.
 */
export function comboSets(combo) {
  const sets = new Map();
  for (const name of Object.keys(combo)) {
    const set = typeof combo[name]?.set === 'string' ? combo[name].set : '';
    if (!sets.has(set)) sets.set(set, []);
    sets.get(set).push(name);
  }
  return sets;
}

/**
 * A model's combo windows against its sidecar: the combo's hits are the sidecar's `notes.combo` entries, in order, each
 * swing set's last its finisher (comboSets; Pip ships the Quaternius set and the hand-keyed one, each with its own). Each needs its timings.json entry to carry `activeFrom`, `activeTo` and `cancel`: a light hit's
 * must read 0 < activeFrom < strike < activeTo <= cancel < duration (the active frames around the strike, the cancel
 * after them and before the end), the finisher's cancel must be null and its windows 0 < activeFrom < strike <
 * activeTo <= duration, and the cancel the build recorded in the sidecar must be the file's. A timings entry with
 * window keys that the sidecar does not record as a combo hit fails too. The cancels lived in the recipe and in
 * labs/world/combo.ts, and the active frames in combo.ts alone, so nothing here could hold them; the recipe and the page
 * now read them from timings.json, and this holds the file and the build to each other. `sidecar` is the model's
 * parsed .meta.json, or null when it has none.
 */
export function comboWindowFailures(entry, timings, sidecar) {
  if (entry.kind !== 'model') return [];
  const entries = timings[entry.family]?.[entry.name] ?? {};
  const combo = sidecar?.notes?.combo ?? null;
  const failures = [];
  const windowed = Object.entries(entries).filter(([, timing]) => hasWindows(timing)).map(([name]) => name);
  if (!combo) {
    if (windowed.length) failures.push(`timings.json gives combo windows for ${windowed.join(', ')}, but the sidecar records no combo`);
    return failures;
  }
  const hits = Object.keys(combo);
  for (const names of comboSets(combo).values()) {
    names.forEach((name, index) => {
      const timing = entries[name];
      if (!timing) {
        failures.push(`combo hit ${name} has no timings.json entry`);
        return;
      }
      const missing = WINDOW_KEYS.filter((key) => !(key in timing));
      if (missing.length) {
        failures.push(`${name} timings lack ${missing.join(', ')}`);
        return;
      }
      const { duration, strike, activeFrom, activeTo, cancel } = timing;
      if (!finite(activeFrom) || !finite(activeTo)) {
        failures.push(`${name} active frames ${activeFrom} to ${activeTo} are not numbers`);
        return;
      }
      const finisher = index === names.length - 1;
      if (finisher) {
        if (cancel !== null) failures.push(`${name}, the finisher, must have cancel null, not ${cancel}`);
        else if (!(activeFrom > 0 && activeFrom < strike && strike < activeTo && activeTo <= duration)) {
          failures.push(`${name} windows out of order: want 0 < activeFrom ${activeFrom} < strike ${strike} < activeTo ${activeTo} <= duration ${duration}`);
        }
      } else if (!finite(cancel)) {
        failures.push(`${name}, a light hit, needs a cancel in seconds, not ${cancel}`);
      } else if (!(activeFrom > 0 && activeFrom < strike && strike < activeTo && activeTo <= cancel && cancel < duration)) {
        failures.push(`${name} windows out of order: want 0 < activeFrom ${activeFrom} < strike ${strike} < activeTo ${activeTo} <= cancel ${cancel} < duration ${duration}`);
      }
      failures.push(...recoveryFailures(name, timing, finisher, entries));
      const recorded = combo[name]?.cancel;
      const same = recorded === null || cancel === null ? recorded === cancel : finite(recorded) && finite(cancel) && Math.abs(recorded - cancel) <= RECORDED_CANCEL_TOLERANCE;
      if (!same) failures.push(`${name} sidecar cancel ${recorded} != timings ${cancel}`);
    });
  }
  for (const name of windowed) if (!hits.includes(name)) failures.push(`${name} has combo windows in timings.json, but the sidecar records no combo hit of that name`);
  return failures;
}

/**
 * A combo hit's recovery keys. A finisher may give its cuttable recovery (RECOVER_KEYS), both keys or neither, read
 * activeTo <= recoverFrom < recoverTo <= duration; a light hit may name the clip that plays when the chain stops after
 * it (`recovery`, Quaternius's attack_1_rec), which timings.json must time too, so assets:check requires the model to
 * export it. Neither belongs to the other kind: a light hit's recovery is cut at its cancel point or played by its
 * recovery clip, and the finisher's is the end of its own clip.
 */
function recoveryFailures(name, timing, finisher, entries) {
  const failures = [];
  const given = RECOVER_KEYS.filter((key) => key in timing);
  if (given.length && !finisher) failures.push(`${name}, a light hit, takes no ${given.join(' or ')}: its recovery ends at its cancel point or in its recovery clip`);
  else if (given.length === 1) failures.push(`${name} gives ${given[0]} without ${RECOVER_KEYS.find((key) => key !== given[0])}: the cuttable recovery needs both or neither`);
  else if (given.length === 2) {
    const { activeTo, recoverFrom, recoverTo, duration } = timing;
    if (!finite(recoverFrom) || !finite(recoverTo)) failures.push(`${name} recovery ${recoverFrom} to ${recoverTo} is not two numbers`);
    else if (!(activeTo <= recoverFrom && recoverFrom < recoverTo && recoverTo <= duration)) {
      failures.push(`${name} recovery out of order: want activeTo ${activeTo} <= recoverFrom ${recoverFrom} < recoverTo ${recoverTo} <= duration ${duration}`);
    }
  }
  if ('recovery' in timing) {
    const clip = timing.recovery;
    if (finisher) failures.push(`${name}, the finisher, names a recovery clip (${clip}); its recovery is the end of its own clip`);
    else if (typeof clip !== 'string' || !clip) failures.push(`${name} recovery ${JSON.stringify(clip)} is not a clip name`);
    else if (!(finite(entries[clip]?.duration) && entries[clip].duration > 0)) failures.push(`${name} names the recovery clip ${clip}, which timings.json does not time`);
  }
  return failures;
}

/**
 * A model's recorded root motion (its sidecar's `notes.root_motion`, Play Pip's lunge from each clip's travel) against
 * its clips: each record is for a clip the model exports, its times start at 0, rise strictly and end within a frame
 * of the clip's length, and its forward and side tracks are finite, as long as its times and start at 0. The page
 * checks the same when it loads (labs/world/lunge.ts) and falls back to the scripted lunge on a fault; here a fault
 * stops the check before the record ships.
 */
export function rootMotionFailures(entry, sidecar) {
  if (entry.kind !== 'model') return [];
  const records = sidecar?.notes?.root_motion;
  if (records === undefined || records === null) return [];
  if (typeof records !== 'object' || Array.isArray(records)) return ['notes.root_motion is not an object of clips'];
  const failures = [];
  for (const [clip, record] of Object.entries(records)) {
    const animation = entry.animations.find((a) => a.name === clip);
    if (!animation) {
      failures.push(`root motion for ${clip}, which the model does not export`);
      continue;
    }
    const { times, forward, side } = record ?? {};
    const list = (value) => Array.isArray(value) && value.length >= 2 && value.every(finite);
    if (!list(times) || times[0] !== 0 || times.some((t, i) => i > 0 && !(t > times[i - 1]))) {
      failures.push(`${clip} root motion times must be two or more finite numbers rising from 0`);
      continue;
    }
    const length = animation.exportedDuration ?? animation.duration;
    if (Math.abs(times[times.length - 1] - length) > FRAME) failures.push(`${clip} root motion ends at ${times[times.length - 1]} s, more than a frame from its ${length.toFixed(3)} s clip`);
    for (const [key, track] of [['forward', forward], ['side', side]]) {
      if (track === undefined && key === 'side') continue;
      if (!list(track) || track.length !== times.length || track[0] !== 0) failures.push(`${clip} root motion ${key} must be ${times.length} finite numbers from 0`);
    }
  }
  return failures;
}

/** The root motion the check held, for the pass line: each clip's travel forward and its length, or null for none. */
export function rootMotionNote(entry, sidecar) {
  const records = entry.kind === 'model' ? sidecar?.notes?.root_motion : null;
  if (!records || typeof records !== 'object') return null;
  const parts = Object.entries(records).map(([clip, r]) => `${clip} ${Number(r.forward.at(-1)).toFixed(2)} m forward over ${Number(r.times.at(-1)).toFixed(3)} s`);
  return parts.length ? `root motion ${parts.join(', ')}` : null;
}

/**
 * The combo windows the check held, for the pass line: each hit's order as it read it and the sidecar's cancels, or
 * null for a model with no combo.
 */
export function comboWindowsNote(entry, timings, sidecar) {
  const combo = entry.kind === 'model' ? sidecar?.notes?.combo : null;
  if (!combo) return null;
  const entries = timings[entry.family]?.[entry.name] ?? {};
  const sets = [...comboSets(combo)].map(([set, names]) => {
    const orders = names.map((name, index) => {
      const t = entries[name];
      if (index < names.length - 1) {
        const recovery = t.recovery ? ` then ${t.recovery} ${entries[t.recovery].duration} s` : '';
        return `${name} 0 < ${t.activeFrom} < ${t.strike} < ${t.activeTo} <= ${t.cancel} < ${t.duration}${recovery}`;
      }
      const cut = 'recoverFrom' in t ? `, recovery cut ${t.activeTo} <= ${t.recoverFrom} < ${t.recoverTo} <= ${t.duration}` : '';
      return `${name} 0 < ${t.activeFrom} < ${t.strike} < ${t.activeTo} <= ${t.duration} (finisher, cancel null${cut})`;
    });
    return `${set ? `${set}: ` : ''}${orders.join(', ')}`;
  });
  const cancels = Object.keys(combo).map((name) => (combo[name].cancel === null ? 'null' : combo[name].cancel)).join(', ');
  return `combo windows ${sets.join('; ')}; sidecar cancels ${cancels} match`;
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

/** A model's sidecar (its .meta.json beside the GLB), parsed, or null when there is none. */
function readSidecar(root, entry) {
  if (entry.kind !== 'model') return null;
  const path = join(root, 'public', 'assets', entry.file.replace(/[.]glb$/, '.meta.json'));
  return fileSize(path) === null ? null : JSON.parse(readFileSync(path, 'utf8'));
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
    const sidecar = readSidecar(root, entry);
    failures.push(...comboWindowFailures(entry, timings, sidecar));
    failures.push(...rootMotionFailures(entry, sidecar));
    if (failures.length) {
      fail += 1;
      console.log(`ASSET ${entry.name} FAIL: ${failures.join('; ')}`);
    } else {
      pass += 1;
      const timed = timedClips(entry, timings);
      const note = timed.length ? `; ${timed.join(', ')} as timings.json sets` : '';
      console.log(`ASSET ${entry.name} ok (${entry.tris} tris, ${Math.round(entry.bytes / 1024)} KB${note})`);
      const windows = comboWindowsNote(entry, timings, sidecar);
      if (windows) console.log(`ASSET ${entry.name} ${windows}`);
      const travel = rootMotionNote(entry, sidecar);
      if (travel) console.log(`ASSET ${entry.name} ${travel}`);
    }
  }
  console.log(`assets:check pass=${pass} fail=${fail}`);
  if (fail) process.exit(1);
}

// This compared argv[1], the path as typed, with the module's own path, which Node resolves through links, so run
// through a junction or symlink the check printed nothing and exited 0, even with the manifest missing.
if (isMain(import.meta.url)) main();
