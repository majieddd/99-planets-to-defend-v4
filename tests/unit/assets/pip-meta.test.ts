import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** What the Pip recipe records of its clip checks in the sidecar (blender/recipes/commander_pip.py, lib/charforge.py). */
interface PipMeta {
  animations: { name: string }[];
  notes: {
    attack_checks: { sword_shield_overlaps: number; blade_body_overlaps: number; boot_shift_mm: number; min_z: number };
    clip_ground: Record<string, { min_z: number; offset_m: number; sword_turn_deg?: number; sword_min_z?: number }>;
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
    // The idle and the run go through the pass; the attack, authored with its boots planted, does not.
    expect(measured.map(([clip]) => clip).sort()).toEqual(['idle', 'run']);
    for (const [clip, record] of measured) expect(record.sword_min_z, clip).toBeGreaterThanOrEqual(BLADE_CLEARANCE_M - BLADE_TOLERANCE_M);
  });
});
