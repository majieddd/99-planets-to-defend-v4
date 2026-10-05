import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** What the Pip recipe records of its clip checks in the sidecar (blender/recipes/commander_pip.py, lib/charforge.py). */
interface PipMeta {
  animations: { name: string }[];
  notes: {
    attack_checks: { sword_shield_overlaps: number; blade_body_overlaps: number; boot_shift_mm: number; min_z: number };
    clip_ground: Record<string, { min_z: number; offset_m: number; sword_turn_deg?: number }>;
  };
}

const meta = JSON.parse(readFileSync('public/assets/commanders/commander_pip.meta.json', 'utf8')) as PipMeta;

/**
 * The build measures these on the posed meshes and only records them; nothing failed when they went wrong, so the idle's
 * sword passed 3.4 cm into the ground (1.7 cm in the Asset World's opening pose) and the run's boots 1.75 cm with
 * every check green. The Kit's ground contract allows 5 mm of rounding, the same allowance every clip gets here.
 */
describe("Pip's recorded clip checks", () => {
  it('keeps the attack clear of the shield and the body, with the boots where they stand', () => {
    const checks = meta.notes.attack_checks;
    expect(checks.sword_shield_overlaps).toBe(0);
    expect(checks.blade_body_overlaps).toBe(0);
    expect(checks.boot_shift_mm).toBeLessThanOrEqual(1);
  });

  it("stands every clip's lowest point on the ground, within the contract's 5 mm", () => {
    const ground = meta.notes.clip_ground;
    expect(Object.keys(ground).sort()).toEqual(meta.animations.map((clip) => clip.name).sort());
    for (const [clip, record] of Object.entries(ground)) expect(record.min_z, clip).toBeGreaterThanOrEqual(-0.005);
    expect(meta.notes.attack_checks.min_z).toBeGreaterThanOrEqual(-0.005);
  });
});
