import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { Color, Matrix4, Uniform, Vector3, type PerspectiveCamera } from 'three';
import type { RenderDials } from '../defaults';
import type { Theme } from '../themes';

/** The sphere the camera stands on; the height fog measures altitude from it. */
export interface FogPlanet {
  center: Vector3;
  radius: number;
}

/**
 * The segments the height fog integrates each ray over. Measured against a 4000-step reference on the ground rays of the
 * style scene's four cameras (the bare 160 m sphere), the worst ray is always the strategic camera's grazing limb, 40 to
 * 120 m out. There 8 segments keep the fog-weighted length within 2.3 percent at a falloff of 0.3 from the default
 * fogStart of 20 m and within 3.3 percent from a fogStart of 0, and within 3.9 and 5.5 percent at the dial's top falloff
 * of 0.5, at most 0.018 of fog amount at density 0.02. 4 segments let the same rays drift by 8.9 and 12.5 percent at 0.3
 * and by 14.4 and 19.9 percent at 0.5. The low cameras, whose ground ends within 34 m, stay under 0.5 percent with 8.
 */
export const FOG_STEPS = 8;

const fragmentShader = /* glsl */ `
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform vec3 uSunDirection;
uniform float uDensity;
uniform float uStart;
uniform float uHeightFalloff;
uniform vec3 uPlanetCenter;
uniform float uPlanetRadius;
uniform mat4 uProjectionInverse;
uniform mat4 uViewInverse;

#ifdef FOG_PLANET
// Measured from the planet's sphere and never below it, so uDensity is the density at the surface and in every hollow.
float fogAltitude(vec3 p) {
  return max(length(p - uPlanetCenter) - uPlanetRadius, 0.0);
}

// The fog-weighted length of the ray from uStart to far, each metre counted at exp(-uHeightFalloff * altitude). Each
// segment is integrated exactly for an altitude that changes linearly across it, which on this planet's curve is close
// enough at FOG_STEPS segments (see FOG_STEPS). At a falloff of 0 every metre counts alike: the distance fog.
float fogLength(vec3 origin, vec3 direction, float far) {
  float near = min(uStart, far);
  if (uHeightFalloff <= 0.0) return far - near;
  float segment = (far - near) / float(FOG_STEPS);
  float h0 = fogAltitude(origin + direction * near);
  float e0 = exp(-uHeightFalloff * h0);
  float total = 0.0;
  for (int i = 1; i <= FOG_STEPS; i++) {
    float h1 = fogAltitude(origin + direction * (near + segment * float(i)));
    float e1 = exp(-uHeightFalloff * h1);
    float x = uHeightFalloff * (h1 - h0);
    // A segment's weight, (e0 - e1) / x, is the mean of exp(-uHeightFalloff * altitude) across it, so it lies between
    // e1 and e0 and never above 1. Written as e0 * (1 - e^-x) / x, it formed e^-x, which passes fp32's limit once x
    // falls below -88.7 on a long descending segment: at a falloff of 0.5 from about 1.44 km up (1.8 km at 0.4), heights
    // OrbitControls panning reaches, that was infinity times an e0 of 0, a NaN pixel that the bloom's blur spread. At
    // |x| = 1e-3 e0 and e1 agree in their first 3 digits, so their difference keeps only about 4 of fp32's 7; below it
    // the first-order expansion e0 * (1 - x / 2), off by x^2 / 6 of e0 there, takes over. It also carries x = 0, where
    // the quotient is 0 / 0: a segment of constant altitude (a ray through a hollow under the sphere) or of no length
    // (a ray that ends before uStart, which makes every segment empty).
    total += segment * (abs(x) > 1e-3 ? (e0 - e1) / x : e0 * (1.0 - 0.5 * x));
    h0 = h1;
    e0 = e1;
  }
  return total;
}
#endif

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (depth >= 0.99999) {
    outputColor = inputColor;
    return;
  }
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uProjectionInverse * clip;
  view /= view.w;
  vec3 direction = normalize((uViewInverse * vec4(view.xyz, 0.0)).xyz);
  // Distance along the ray, not view depth: with depth the fog thinned toward the frame edges (corner rays are 1.38
  // times longer in a 50 degree 16:9 view) and shifted whenever the camera turned.
  #ifdef FOG_PLANET
    float travelled = fogLength(uViewInverse[3].xyz, direction, length(view.xyz));
  #else
    float travelled = max(length(view.xyz) - uStart, 0.0);
  #endif
  float amount = 1.0 - exp(-pow(travelled * uDensity, 1.5));
  // Looking toward the sun, the haze warms: aerial perspective in the theme's two fog colours.
  float sun = pow(max(dot(direction, uSunDirection), 0.0), 6.0);
  outputColor = vec4(mix(inputColor.rgb, mix(uFogColor, uFogSunColor, sun), amount), inputColor.a);
}
`;

/**
 * Distance fog along each ray, warmed toward the sun. Given the planet, it becomes height fog: denser near the ground
 * and thinning with altitude at the fogHeightFalloff dial's rate, so the low cameras, whose horizon is only 20 to 35 m
 * away, can see haze on it while the strategic camera, 38 m up over ground 40 to 200 m away, looks down through thin
 * air instead of washing out. Without a planet the shader is the distance fog alone, whatever the dial says.
 */
export class FogEffect extends Effect {
  private readonly camera: PerspectiveCamera;

  constructor(camera: PerspectiveCamera, theme: Theme, sunDirection: Vector3, dials: RenderDials, planet?: FogPlanet) {
    const defines = new Map<string, string>([['FOG_STEPS', String(FOG_STEPS)]]);
    if (planet) defines.set('FOG_PLANET', '1');
    super('FogEffect', fragmentShader, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      defines,
      uniforms: new Map<string, Uniform>([
        ['uFogColor', new Uniform(new Color(theme.fog.color))],
        ['uFogSunColor', new Uniform(new Color(theme.fog.sunColor))],
        ['uSunDirection', new Uniform(sunDirection.clone().normalize())],
        ['uDensity', new Uniform(dials.fogDensity)],
        ['uStart', new Uniform(dials.fogStart)],
        ['uHeightFalloff', new Uniform(dials.fogHeightFalloff)],
        ['uPlanetCenter', new Uniform(planet ? planet.center.clone() : new Vector3())],
        ['uPlanetRadius', new Uniform(planet ? planet.radius : 0)],
        ['uProjectionInverse', new Uniform(new Matrix4())],
        ['uViewInverse', new Uniform(new Matrix4())],
      ]),
    });
    this.camera = camera;
  }

  setDials(dials: RenderDials, theme: Theme): void {
    (this.uniforms.get('uDensity') as Uniform<number>).value = dials.fogDensity;
    (this.uniforms.get('uStart') as Uniform<number>).value = dials.fogStart;
    (this.uniforms.get('uHeightFalloff') as Uniform<number>).value = dials.fogHeightFalloff;
    (this.uniforms.get('uFogColor') as Uniform<Color>).value.set(theme.fog.color);
    (this.uniforms.get('uFogSunColor') as Uniform<Color>).value.set(theme.fog.sunColor);
  }

  setSunDirection(direction: Vector3): void {
    (this.uniforms.get('uSunDirection') as Uniform<Vector3>).value.copy(direction).normalize();
  }

  override update(): void {
    (this.uniforms.get('uProjectionInverse') as Uniform<Matrix4>).value.copy(this.camera.projectionMatrixInverse);
    (this.uniforms.get('uViewInverse') as Uniform<Matrix4>).value.copy(this.camera.matrixWorld);
  }
}
