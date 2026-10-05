import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AnimationMixer, Vector3, type AnimationClip, type Group, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { COMBO_HITS, HAND_HITS } from '../../../src/labs/world/combo';
import { sampleTrack } from '../../../src/labs/world/lunge';
import timings from '../../../src/shared/timings.json';
import { assetIO } from '../../../tools/assets/optimize.mjs';

/** What attack_checks (lib/charforge.py) records of an authored clip. */
interface ClipChecks {
  sword_shield_overlaps: number;
  blade_body_overlaps: number;
  boot_shift_mm: number;
  min_z: number;
}

/** One clip's recorded root motion (blender/lib/retarget.py root_motion_notes). */
interface RootMotionRecord {
  times: number[];
  forward: number[];
  side: number[];
}

/** What the Pip recipe records of its clip checks in the sidecar (blender/recipes/commander_pip.py, lib/charforge.py). */
interface PipMeta {
  animations: { name: string; duration: number }[];
  notes: {
    attack_checks: ClipChecks;
    clip_ground: Record<string, { min_z: number; offset_m: number; sword_turn_deg?: number; sword_min_z?: number; boot_min_z?: number }>;
    /** Each combo hit of both swing sets: its set, where its motion came from, the cancel point it was keyed to, and its checks. */
    combo: Record<string, { set: string; source: string; cancel: number | null; checks: ClipChecks }>;
    root_motion: Record<string, RootMotionRecord>;
    quaternius: {
      grip: { turn_deg: number; forearm_deg_before: number; forearm_deg_after: number };
      clips: Record<string, { clip: string; duration: number; cancel_window?: [number, number]; edge?: { mean: number; worst: number } }>;
    };
  };
}

const meta = JSON.parse(readFileSync('public/assets/commanders/commander_pip.meta.json', 'utf8')) as PipMeta;
const ENTRIES = timings.commanders.commander_pip as unknown as Record<string, { duration: number; recoverFrom?: number; recoverTo?: number }>;

/**
 * The sword's clearance over the ground, read from the recipe library that holds it, so the two cannot drift apart. The
 * ground pass stops the build unless a turned sword reaches it within 0.5 mm, the allowance held here too.
 */
const BLADE_CLEARANCE_M = Number(/^BLADE_CLEARANCE_M = ([\d.]+)$/m.exec(readFileSync('blender/lib/charforge.py', 'utf8'))?.[1]);
const BLADE_TOLERANCE_M = 0.0005;
/**
 * How far a planted foot may slide in a frame once a clip's root motion carries him, in metres: 1 cm a frame. A foot
 * counts as planted on two frames running within PLANTED_M of its lowest point. Measured on the build: 0.1 to 4.6 mm a
 * frame, and the backhand's pivoting right toe 9.6 mm, against 26 to 68 mm a frame in the clip's own frame, where the
 * travel the clips no longer carry slides the planted foot back under him.
 */
const PLANTED_SLIDE_M = 0.01;
const PLANTED_M = 0.01;
/** The slide in the clip's own frame that shows the root motion is what plants the feet: some clip slides this far. */
const UNCORRECTED_SLIDE_M = 0.025;
const FOOT_BONES = ['mixamorigLeftToeBase', 'mixamorigRightToeBase', 'mixamorigLeftFoot', 'mixamorigRightFoot'];

let scene: Group;
let animations: AnimationClip[];

beforeAll(async () => {
  const io = await assetIO();
  const doc = await io.read(fileURLToPath(new URL('../../../public/assets/commanders/commander_pip.glb', import.meta.url)));
  for (const texture of doc.getRoot().listTextures()) texture.dispose();
  const bytes = await io.writeBinary(doc);
  await MeshoptDecoder.ready;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
  scene = gltf.scene;
  animations = gltf.animations;
});

/**
 * Each foot bone's worst slide between two planted frames of a clip, sampled at the clips' 30 fps, with its root motion
 * applied (`rooted`) or in the clip's own frame. A root-motion record's side is to his right, -x in the rig's frame
 * (he faces +z), and its forward along +z.
 */
function plantedSlides(clip: AnimationClip, record: RootMotionRecord, rooted: boolean): Record<string, number> {
  const rig = cloneRig(scene) as Object3D;
  const mixer = new AnimationMixer(rig);
  mixer.clipAction(clip).play();
  const frames = Math.round(clip.duration * 30);
  const tracks: Vector3[][] = FOOT_BONES.map(() => []);
  for (let f = 0; f <= frames; f++) {
    // Just short of the end: the mixer's default loop wraps a time of exactly the clip's length back to its start.
    const time = Math.min(f / 30, clip.duration - 1e-4);
    mixer.setTime(time);
    rig.updateMatrixWorld(true);
    const travel = rooted ? new Vector3(-sampleTrack(record.times, record.side, time), 0, sampleTrack(record.times, record.forward, time)) : new Vector3();
    FOOT_BONES.forEach((bone, i) => tracks[i]!.push(rig.worldToLocal(rig.getObjectByName(bone)!.getWorldPosition(new Vector3())).add(travel)));
  }
  const out: Record<string, number> = {};
  FOOT_BONES.forEach((bone, i) => {
    const track = tracks[i]!;
    const low = Math.min(...track.map((p) => p.y));
    let worst = 0;
    for (let f = 1; f < track.length; f++) {
      if (track[f]!.y < low + PLANTED_M && track[f - 1]!.y < low + PLANTED_M) worst = Math.max(worst, Math.hypot(track[f]!.x - track[f - 1]!.x, track[f]!.z - track[f - 1]!.z));
    }
    out[bone] = worst;
  });
  return out;
}

/**
 * The build measures these on the posed meshes and only records them; nothing failed when they went wrong, so the idle's
 * sword passed 3.4 cm into the ground (1.7 cm in the Asset World's opening pose) and the run's boots 1.75 cm with
 * every check green. The Kit's ground contract allows 5 mm of rounding, the same allowance every clip gets here, either
 * way: a clip that floats is as wrong as one that sinks.
 */
describe("Pip's recorded clip checks", () => {
  it('keeps the attack clear of the shield and the body, with the boots where they stand', () => {
    const checks = meta.notes.attack_checks;
    expect(checks.sword_shield_overlaps).toBe(0);
    expect(checks.blade_body_overlaps).toBe(0);
    expect(checks.boot_shift_mm).toBeLessThanOrEqual(1);
  });

  it("stands every clip's lowest point on the ground, within the contract's 5 mm either way", () => {
    const ground = meta.notes.clip_ground;
    expect(Object.keys(ground).sort()).toEqual(meta.animations.map((clip) => clip.name).sort());
    for (const [clip, record] of Object.entries(ground)) {
      expect(record.min_z, clip).toBeGreaterThanOrEqual(-0.005);
      expect(record.min_z, clip).toBeLessThanOrEqual(0.005);
    }
    expect(meta.notes.attack_checks.min_z).toBeGreaterThanOrEqual(-0.005);
    expect(meta.notes.attack_checks.min_z).toBeLessThanOrEqual(0.005);
  });

  it('holds the sword at its clearance or above, and the boots on the ground, in every clip, both swing sets and the Quaternius extras included', () => {
    expect(BLADE_CLEARANCE_M).toBeGreaterThan(0);
    const ground = Object.entries(meta.notes.clip_ground);
    // The idle and the run go through the ground pass, which turns the hand to put the sword there; the attack, the
    // hand-keyed hits and the Quaternius clips (whose retarget stands the boots on the ground and lifts the blade) reach
    // it as built. The finisher's chop once took the blade 4.4 mm under the ground with every check green.
    const passed = ground.filter(([, record]) => record.sword_turn_deg !== undefined);
    expect(passed.map(([clip]) => clip).sort()).toEqual(['idle', 'run']);
    expect(ground.map(([clip]) => clip).sort()).toEqual(meta.animations.map((clip) => clip.name).sort());
    for (const [clip, record] of ground) {
      expect(record.sword_min_z, clip).toBeGreaterThanOrEqual(BLADE_CLEARANCE_M - BLADE_TOLERANCE_M);
      expect(Math.abs(record.boot_min_z!), clip).toBeLessThanOrEqual(1e-4);
    }
  });
});

describe("Pip's combo hits, both swing sets", () => {
  it('records every hit of both sets, in chain order, each clear of the shield and the body', () => {
    expect(Object.keys(meta.notes.combo)).toEqual([...COMBO_HITS, ...HAND_HITS].map((hit) => hit.name));
    for (const hit of [...COMBO_HITS, ...HAND_HITS]) {
      const { checks } = meta.notes.combo[hit.name]!;
      expect(checks.sword_shield_overlaps, hit.name).toBe(0);
      expect(checks.blade_body_overlaps, hit.name).toBe(0);
    }
  });

  it("plants the hand-keyed light hits' boots and steps the hand-keyed finisher's front boot about 22 cm out and back", () => {
    // Authored in place, their boots stay put by IK, the light hits' on every frame; the finisher's front boot steps
    // 22 cm forward and back, lifting 5 cm on the way, so a boot point moves about 23 cm from its first frame and no more.
    for (const hit of HAND_HITS) {
      const { checks } = meta.notes.combo[hit.name]!;
      if (hit.finisher) {
        expect(checks.boot_shift_mm, hit.name).toBeGreaterThan(200);
        expect(checks.boot_shift_mm, hit.name).toBeLessThan(250);
      } else expect(checks.boot_shift_mm, hit.name).toBeLessThanOrEqual(1);
    }
  });

  it("plants the Quaternius clips' feet once their root motion carries him, where in the clip's own frame they slide", () => {
    // The library's travel is taken out of every clip (the hips keep only their bob) and recorded for the page to apply
    // as the lunge, so in the clip's own frame a planted boot slides back as far as he travels: the build's boot shifts
    // read 355 to 1,208 mm. Carried by the recorded root motion, as Play Pip carries him, each planted foot holds within
    // PLANTED_SLIDE_M a frame.
    for (const hit of COMBO_HITS) expect(meta.notes.combo[hit.name]!.checks.boot_shift_mm, hit.name).toBeGreaterThan(300);
    let uncorrected = 0;
    const names = [...COMBO_HITS.map((hit) => hit.name), ...COMBO_HITS.flatMap((hit) => (hit.recovery ? [hit.recovery] : [])), 'block', 'idle_guard'];
    for (const name of names) {
      const record = meta.notes.root_motion[name]!;
      const clip = animations.find((each) => each.name === name)!;
      expect(record, name).toBeDefined();
      for (const [bone, slide] of Object.entries(plantedSlides(clip, record, true))) expect(slide, `${name} ${bone}`).toBeLessThanOrEqual(PLANTED_SLIDE_M);
      uncorrected = Math.max(uncorrected, ...Object.values(plantedSlides(clip, record, false)));
    }
    expect(uncorrected).toBeGreaterThan(UNCORRECTED_SLIDE_M);
  });

  it('records root motion for every Quaternius clip, ending with its clip, and none for the hand-keyed hits', () => {
    for (const [name, record] of Object.entries(meta.notes.root_motion)) {
      const clip = meta.animations.find((each) => each.name === name)!;
      expect(clip, name).toBeDefined();
      expect(record.times[0], name).toBe(0);
      expect(Math.abs(record.times.at(-1)! - clip.duration), name).toBeLessThanOrEqual(1 / 30);
      expect([record.forward.length, record.side.length], name).toEqual([record.times.length, record.times.length]);
    }
    for (const hit of HAND_HITS) expect(meta.notes.root_motion[hit.name], hit.name).toBeUndefined();
    // The forehand carries him 0.75 m, the backhand steps back 6 cm, the spin finisher 1.47 m.
    expect(COMBO_HITS.map((hit) => Number(meta.notes.root_motion[hit.name]!.forward.at(-1)!.toFixed(2)))).toEqual([0.75, -0.06, 1.47]);
  });

  it('was keyed to the cancel points the page plays (combo.ts), each set from its own source', () => {
    // The recipe and combo.ts both read each cancel from timings.json; the hand-keyed set keys a chained hit from the
    // pose the hit before holds at its cancel point, so the build's recorded cancel must be the page's or the page cuts a
    // hit where its successor does not start (assets:check holds the record to the file too).
    for (const [hits, set, source] of [
      [COMBO_HITS, 'quaternius', 'quaternius'],
      [HAND_HITS, 'hand', 'hand'],
    ] as const) {
      for (const hit of hits) {
        const record = meta.notes.combo[hit.name]!;
        expect(record.cancel, hit.name).toBe(hit.cancel);
        expect([record.set, record.source], hit.name).toEqual([set, source]);
      }
    }
  });

  it("records the Quaternius windows timings.json gives: each light hit's cancel window opening at its cancel, the finisher's cuttable recovery, and each recovery clip", () => {
    const clips = meta.notes.quaternius.clips;
    for (const hit of COMBO_HITS) {
      const window = clips[hit.name]!.cancel_window!;
      if (hit.finisher) expect(window, hit.name).toEqual([hit.recoverFrom, hit.recoverTo]);
      else expect(window[0], hit.name).toBe(hit.cancel);
      if (!hit.recovery) continue;
      // The recovery clip the page plays when the chain stops after this hit, its length the build's and the file's.
      expect(clips[hit.recovery]!.duration, hit.recovery).toBeCloseTo(ENTRIES[hit.recovery]!.duration, 3);
      expect(hit.recoveryDuration, hit.recovery).toBe(ENTRIES[hit.recovery]!.duration);
    }
    expect([ENTRIES['attack_3']!.recoverFrom, ENTRIES['attack_3']!.recoverTo]).toEqual([0.767, 1.633]);
  });

  it('records the natural grip: the sword regripped from 141 to 104 degrees off the forearm, the edge leading each cut', () => {
    const grip = meta.notes.quaternius.grip;
    expect(grip.forearm_deg_before).toBeCloseTo(140.7, 1);
    expect(grip.forearm_deg_after).toBeCloseTo(104.2, 1);
    expect(grip.turn_deg).toBeCloseTo(36.6, 1);
    // The edge within 10 degrees of the cut's way on average over each hit's active frames.
    for (const hit of COMBO_HITS) expect(meta.notes.quaternius.clips[hit.name]!.edge!.mean, hit.name).toBeLessThan(10);
  });
});
