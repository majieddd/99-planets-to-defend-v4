import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIALS } from '../../../src/render/defaults';
import { FOG_STEPS, FogEffect } from '../../../src/render/post/fogEffect';
import { VERDANT } from '../../../src/render/themes';

type Vec = readonly [number, number, number];

/** fp32 rounding after every operation, as the GPU computes the fog. */
const f = Math.fround;

// The style scene's planet, whose surface passes through the origin (render/terrain/stylePatch.ts).
const CENTER: Vec = [0, -160, 0];
const RADIUS = 160;

function altitude(p: Vec): number {
  const dx = f(p[0] - CENTER[0]);
  const dy = f(p[1] - CENTER[1]);
  const dz = f(p[2] - CENTER[2]);
  return Math.max(f(f(Math.sqrt(f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz)))) - RADIUS), 0);
}

function along(origin: Vec, direction: Vec, t: number): Vec {
  return [f(origin[0] + f(direction[0] * t)), f(origin[1] + f(direction[1] * t)), f(origin[2] + f(direction[2] * t))];
}

/**
 * fogLength from fogEffect.ts, line for line, in fp32. The shader test below holds the lines it copies, so a change to
 * the shader's integration that is not made here too fails.
 */
function fogLength(origin: Vec, direction: Vec, farIn: number, start: number, falloffIn: number): number {
  const far = f(farIn);
  const falloff = f(falloffIn);
  const near = f(Math.min(f(start), far));
  if (falloff <= 0) return f(far - near);
  const segment = f(f(far - near) / FOG_STEPS);
  let h0 = altitude(along(origin, direction, near));
  let e0 = f(Math.exp(f(-falloff * h0)));
  let total = f(0);
  for (let i = 1; i <= FOG_STEPS; i++) {
    const h1 = altitude(along(origin, direction, f(near + f(segment * i))));
    const e1 = f(Math.exp(f(-falloff * h1)));
    const x = f(falloff * f(h1 - h0));
    const weight = Math.abs(x) > 1e-3 ? f(f(e0 - e1) / x) : f(e0 * f(1 - f(0.5 * x)));
    total = f(total + f(segment * weight));
    h0 = h1;
    e0 = e1;
  }
  return total;
}

/** Where a ray from origin meets the sphere, or the fog's reach (depth under 0.99999 is about 2 km out) if it misses. */
function farOf(origin: Vec, direction: Vec): number {
  const oc = origin.map((v, i) => v - CENTER[i]!);
  const b = oc[0]! * direction[0] + oc[1]! * direction[1] + oc[2]! * direction[2];
  const c = oc[0]! ** 2 + oc[1]! ** 2 + oc[2]! ** 2 - RADIUS * RADIUS;
  const disc = b * b - c;
  const t = -b - Math.sqrt(Math.max(disc, 0));
  return disc > 0 && t > 0 ? Math.min(t, 2000) : 2000;
}

// Camera heights from the strategic camera's 38 m to 1.9 km, which OrbitControls panning reaches, at the falloffs the
// art presets use (0.3) and the dial's top (0.5). The form this replaced, e0 * (1 - e^-x) / x, returned NaN from 1.44 km
// up at 0.5 and from 1.8 km at 0.4, where a descending segment's e^-x passed fp32's limit.
const HEIGHTS = [38, 400, 1500, 1900];
const FALLOFFS = [0.3, 0.5];
const STARTS = [DEFAULT_DIALS.fogStart, 0];

describe('height fog length in fp32', () => {
  it('is the analytic integral on straight-down rays, where altitude falls linearly and the segments are exact', () => {
    // Straight down from altitude H the weighted length is (1 - e^(-f (H - start))) / f. Only fp32 rounding separates
    // the shader's sum from it, so the tolerance is 1e-6 of the value, about 10 times the largest miss measured (9.5e-8).
    for (const height of HEIGHTS) {
      for (const falloff of FALLOFFS) {
        for (const start of STARTS) {
          const result = fogLength([0, height, 0], [0, -1, 0], height, start, falloff);
          const analytic = (1 - Math.exp(-falloff * (height - start))) / falloff;
          expect(Number.isFinite(result), `H ${height} f ${falloff} start ${start}`).toBe(true);
          expect(Math.abs(result - analytic) / analytic, `H ${height} f ${falloff} start ${start}: ${result} vs ${analytic}`).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('stays finite and never longer than the ray on slanted rays, down to the limb and out to the fog reach', () => {
    for (const height of HEIGHTS) {
      for (const falloff of FALLOFFS) {
        for (const start of STARTS) {
          // Degrees from straight down: steep, oblique, grazing, and level (which misses the sphere and ends 2 km out).
          for (const degrees of [30, 60, 85, 90]) {
            const angle = (degrees * Math.PI) / 180;
            const direction: Vec = [f(Math.sin(angle)), f(-Math.cos(angle)), 0];
            const far = farOf([0, height, 0], direction);
            const result = fogLength([0, height, 0], direction, far, start, falloff);
            const label = `H ${height} f ${falloff} start ${start} at ${degrees} degrees`;
            expect(Number.isFinite(result), label).toBe(true);
            expect(result, label).toBeGreaterThanOrEqual(0);
            // Each segment's weight is a mean of exp(-f h) with h >= 0, so the sum cannot pass the ray's own length.
            expect(result, label).toBeLessThanOrEqual((far - Math.min(start, far)) * (1 + 1e-5));
          }
        }
      }
    }
  });

  it('copies the shader it checks', () => {
    const shader = new FogEffect(new PerspectiveCamera(), VERDANT, new Vector3(0, 1, 0), DEFAULT_DIALS, {
      center: new Vector3(...CENTER),
      radius: RADIUS,
    }).getFragmentShader();
    expect(shader).toContain('float near = min(uStart, far);');
    expect(shader).toContain('float segment = (far - near) / float(FOG_STEPS);');
    expect(shader).toContain('float e0 = exp(-uHeightFalloff * h0);');
    expect(shader).toContain('float e1 = exp(-uHeightFalloff * h1);');
    expect(shader).toContain('float x = uHeightFalloff * (h1 - h0);');
    expect(shader).toContain('total += segment * (abs(x) > 1e-3 ? (e0 - e1) / x : e0 * (1.0 - 0.5 * x));');
  });
});
