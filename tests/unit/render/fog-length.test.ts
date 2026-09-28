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

/**
 * The shader's two height fog functions with their comments dropped, which the fp32 port below copies line for line.
 * Held whole, so a change anywhere in them (midpoint sampling, a dropped last segment, a new branch) fails here until
 * the port and this copy are changed with it. Both sides are compared with their whitespace normalised (normaliseGlsl),
 * so re-indenting the shader or spacing it out with blank lines, which changes nothing the GPU runs, does not fail it.
 */
const FOG_ALTITUDE_GLSL = ['float fogAltitude(vec3 p) {', '  return max(length(p - uPlanetCenter) - uPlanetRadius, 0.0);', '}'].join('\n');
const FOG_LENGTH_GLSL = [
  'float fogLength(vec3 origin, vec3 direction, float far) {',
  '  float near = min(uStart, far);',
  '  if (uHeightFalloff <= 0.0) return far - near;',
  '  float segment = (far - near) / float(FOG_STEPS);',
  '  float h0 = fogAltitude(origin + direction * near);',
  '  float e0 = exp(-uHeightFalloff * h0);',
  '  float total = 0.0;',
  '  for (int i = 1; i <= FOG_STEPS; i++) {',
  '    float h1 = fogAltitude(origin + direction * (near + segment * float(i)));',
  '    float e1 = exp(-uHeightFalloff * h1);',
  '    float x = uHeightFalloff * (h1 - h0);',
  '    total += segment * (abs(x) > 1e-3 ? (e0 - e1) / x : e0 * (1.0 - 0.5 * x));',
  '    h0 = h1;',
  '    e0 = e1;',
  '  }',
  '  return total;',
  '}',
].join('\n');

/** Collapses every run of whitespace, line breaks included, to one space, since formatting is not what the pin holds. */
function normaliseGlsl(source: string): string {
  return source.replace(/\s+/g, ' ').trim();
}

/**
 * A GLSL function from its signature to its matching closing brace, with its comments dropped and its whitespace
 * normalised. The closing brace is found by counting braces, not by looking for one at the start of a line, so the
 * function may be indented. The pin used to need the brace in column 0 and every line exactly as written, so a
 * re-indent or a blank line failed it though the shader was the same.
 */
function glslFunction(shader: string, signature: string): string {
  const source = shader.replace(/\/\/[^\n]*/g, '');
  const start = source.indexOf(signature);
  if (start < 0) return `(no ${signature} in the shader)`;
  let depth = 0;
  for (let i = source.indexOf('{', start); i >= 0 && i < source.length; i++) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return normaliseGlsl(source.slice(start, i + 1));
  }
  return `(no end to ${signature} in the shader)`;
}

function altitude(p: Vec): number {
  const dx = f(p[0] - CENTER[0]);
  const dy = f(p[1] - CENTER[1]);
  const dz = f(p[2] - CENTER[2]);
  return Math.max(f(f(Math.sqrt(f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz)))) - RADIUS), 0);
}

function along(origin: Vec, direction: Vec, t: number): Vec {
  return [f(origin[0] + f(direction[0] * t)), f(origin[1] + f(direction[1] * t)), f(origin[2] + f(direction[2] * t))];
}

/** The series takes over at and under this |x|: the shader's literal 1e-3, which GLSL reads as an fp32 value. */
const SERIES_BELOW = f(1e-3);

/** fogLength from fogEffect.ts, line for line (FOG_LENGTH_GLSL), in fp32. */
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
    const weight = Math.abs(x) > SERIES_BELOW ? f(f(e0 - e1) / x) : f(e0 * f(1 - f(0.5 * x)));
    total = f(total + f(segment * weight));
    h0 = h1;
    e0 = e1;
  }
  return total;
}

/**
 * The same sum over the port's own fp32 altitudes, with each segment's weight, the mean of exp(-falloff * altitude)
 * across a linear altitude, taken in float64 without cancellation. It differs from the port only by how well the port's
 * fp32 weights hold their digits. Also returns each segment's x, as the port forms it.
 */
function fogLengthExactWeights(origin: Vec, direction: Vec, farIn: number, start: number, falloffIn: number): { total: number; xs: number[] } {
  const far = f(farIn);
  const falloff = f(falloffIn);
  const near = f(Math.min(f(start), far));
  const segment = f(f(far - near) / FOG_STEPS);
  let h0 = altitude(along(origin, direction, near));
  let total = 0;
  const xs: number[] = [];
  for (let i = 1; i <= FOG_STEPS; i++) {
    const h1 = altitude(along(origin, direction, f(near + f(segment * i))));
    xs.push(f(falloff * f(h1 - h0)));
    const x = falloff * (h1 - h0);
    const e0 = Math.exp(-falloff * h0);
    total += segment * (x === 0 ? e0 : (e0 * -Math.expm1(-x)) / x);
    h0 = h1;
  }
  return { total, xs };
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

  it('keeps its digits at near-constant altitude, where every segment takes the series', () => {
    // A level ray at eye height over the top of the planet climbs by only its length squared over twice the radius, so
    // across 1.6 m every segment's x stays under 1e-3 and the series carries the whole sum. There e0 and e1 agree in
    // their first 3 to 5 digits: without the series, (e0 - e1) / x missed the exact weights by up to 2.1e-4 of the sum,
    // where the series stays within 1.5e-7.
    for (const falloff of FALLOFFS) {
      for (const [origin, far] of [[[0, 1.7, 0], 1.6], [[-0.8, 1.7, 0], 1.6], [[0, 0.2, 0], 1.2]] as Array<[Vec, number]>) {
        const direction: Vec = [1, 0, 0];
        const label = `f ${falloff} from ${origin.join(', ')} over ${far} m`;
        const { total, xs } = fogLengthExactWeights(origin, direction, far, 0, falloff);
        expect(xs.every((x) => Math.abs(x) <= SERIES_BELOW), `${label}: x ${xs.join(', ')}`).toBe(true);
        expect(xs.some((x) => Math.abs(x) > 1e-5), `${label}: x ${xs.join(', ')}`).toBe(true);
        const result = fogLength(origin, direction, far, 0, falloff);
        expect(Math.abs(result - total) / total, `${label}: ${result} vs ${total}`).toBeLessThan(1e-6);
      }
    }
  });

  it('counts every metre at the surface density through a hollow, and nothing on a ray that ends before the fog starts', () => {
    // Constant altitude makes x exactly 0, where the quotient is 0 / 0: a ray under the sphere's surface (a hollow in the
    // terrain) has altitude 0 throughout, and a ray shorter than fogStart has segments of no length.
    for (const falloff of FALLOFFS) {
      expect(fogLength([0, -2, 0], [1, 0, 0], 20, 0, falloff), `hollow, f ${falloff}`).toBe(f(20));
      expect(fogLength([0, -2, 0], [1, 0, 0], 20, 5, falloff), `hollow from 5 m, f ${falloff}`).toBe(f(15));
      expect(fogLength([0, 1.7, 0], [1, 0, 0], 10, DEFAULT_DIALS.fogStart, falloff), `short ray, f ${falloff}`).toBe(0);
    }
  });

  it('copies the shader it checks', () => {
    const shader = new FogEffect(new PerspectiveCamera(), VERDANT, new Vector3(0, 1, 0), DEFAULT_DIALS, {
      center: new Vector3(...CENTER),
      radius: RADIUS,
    }).getFragmentShader();
    expect(glslFunction(shader, 'float fogAltitude(')).toBe(normaliseGlsl(FOG_ALTITUDE_GLSL));
    expect(glslFunction(shader, 'float fogLength(')).toBe(normaliseGlsl(FOG_LENGTH_GLSL));
    // The pin ignores formatting and still holds every token: the shader indented by four spaces throughout, closing
    // braces included, with a blank line after every statement, still matches, and one changed literal does not.
    const reformatted = shader.replace(/\n/g, '\n    ').replace(/;\n/g, ';\n\n');
    expect(glslFunction(reformatted, 'float fogLength(')).toBe(normaliseGlsl(FOG_LENGTH_GLSL));
    expect(glslFunction(reformatted, 'float fogAltitude(')).toBe(normaliseGlsl(FOG_ALTITUDE_GLSL));
    expect(glslFunction(shader.replace('abs(x) > 1e-3', 'abs(x) > 1e-4'), 'float fogLength(')).not.toBe(normaliseGlsl(FOG_LENGTH_GLSL));
  });
});
