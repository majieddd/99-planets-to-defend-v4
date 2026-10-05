import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMBO_HITS } from '../../../src/labs/world/combo';

/** What attack_checks (lib/charforge.py) records of an authored clip. */
interface ClipChecks {
  sword_shield_overlaps: number;
  blade_body_overlaps: number;
  boot_shift_mm: number;
  min_z: number;
}

/** What the Pip recipe records of its clip checks in the sidecar (blender/recipes/commander_pip.py, lib/charforge.py). */
interface PipMeta {
  animations: { name: string }[];
  notes: {
    attack_checks: ClipChecks;
    clip_ground: Record<string, { min_z: number; offset_m: number; sword_turn_deg?: number; sword_min_z?: number; boot_min_z?: number }>;
    /** Each combo hit: where its motion came from, the cancel point it was keyed to, and its checks (build_combo). */
    combo: Record<string, { source: string; cancel: number | null; checks: ClipChecks }>;
  };
}

const meta = JSON.parse(readFileSync('public/assets/commanders/commander_pip.meta.json', 'utf8')) as PipMeta;

/**
 * The sword's clearance over the ground, read from the recipe library that holds it, so the two cannot drift apart. The
 * ground pass stops the build unless a turned sword reaches it within 0.5 mm, the allowance held here too.
 */
const BLADE_CLEARANCE_M = Number(/^BLADE_CLEARANCE_M = ([\d.]+)$/m.exec(readFileSync('blender/lib/charforge.py', 'utf8'))?.[1]);
const BLADE_TOLERANCE_M = 0.0005;

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

  it('holds the sword at its clearance or above in every clip the ground pass measured', () => {
    expect(BLADE_CLEARANCE_M).toBeGreaterThan(0);
    const measured = Object.entries(meta.notes.clip_ground).filter(([, record]) => record.sword_turn_deg !== undefined);
    // The idle and the run go through the pass; the attack and the combo's hits, authored with their boots planted, do not.
    expect(measured.map(([clip]) => clip).sort()).toEqual(['idle', 'run']);
    for (const [clip, record] of measured) expect(record.sword_min_z, clip).toBeGreaterThanOrEqual(BLADE_CLEARANCE_M - BLADE_TOLERANCE_M);
  });
});

/**
 * The combo's three hand-keyed hits (build_combo, blender/recipes/commander_pip.py). The build records these checks and
 * stops on none of them, so they are held here, as the attack's are above.
 */
describe("Pip's combo hits", () => {
  it('keeps every hit clear of the shield and the body, the light hits on planted boots and the finisher on one step', () => {
    expect(Object.keys(meta.notes.combo)).toEqual(COMBO_HITS.map((hit) => hit.name));
    for (const hit of COMBO_HITS) {
      const { checks } = meta.notes.combo[hit.name]!;
      expect(checks.sword_shield_overlaps, hit.name).toBe(0);
      expect(checks.blade_body_overlaps, hit.name).toBe(0);
      // A planted hit's boots stay put by IK, the light hits' on every frame; the finisher's front boot steps 22 cm
      // forward and back, lifting 5 cm on the way, so a boot point moves about 23 cm from its first frame and no more.
      if (hit.planted) {
        expect(checks.boot_shift_mm, hit.name).toBeGreaterThan(200);
        expect(checks.boot_shift_mm, hit.name).toBeLessThan(250);
      } else expect(checks.boot_shift_mm, hit.name).toBeLessThanOrEqual(1);
    }
  });

  it('was keyed hand by hand to the cancel points the page plays (combo.ts), since each chained hit starts from the last at its cancel', () => {
    // timings.json carries a hit's length and strike, which assets:check holds; the cancel lives in the recipe and in
    // combo.ts alike, and a chained hit is keyed from the pose the hit before holds at its cancel point, so the two must
    // agree or the page cuts a hit where its successor does not start.
    for (const hit of COMBO_HITS) {
      const record = meta.notes.combo[hit.name]!;
      expect(record.cancel, hit.name).toBe(hit.cancel);
      expect(record.source, hit.name).toBe('hand');
    }
  });

  it("stands the finisher's lowest points, its stepping boot and its sword, within the contract's 5 mm of the ground", () => {
    // The finisher's front boot sets down at the strike and the spline through its step overshoots the ground a little
    // after it (3.9 mm), and its sword's follow-through reaches 4.4 mm under it; both inside the Kit's 5 mm, which the
    // test above holds every clip to, and the browser test's 1 cm sink allowance for the characters.
    const finisher = meta.notes.clip_ground['attack_3']!;
    expect(finisher.boot_min_z!).toBeGreaterThanOrEqual(-0.005);
    expect(finisher.sword_min_z!).toBeGreaterThanOrEqual(-0.005);
    // The light hits' boots never leave their rest pose, on the ground (the sidecar may write it as -0.0).
    for (const light of ['attack_1', 'attack_2']) expect(Math.abs(meta.notes.clip_ground[light]!.boot_min_z!), light).toBeLessThanOrEqual(1e-4);
  });
});
