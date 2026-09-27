import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { Color, Matrix4, Uniform, Vector3, type PerspectiveCamera } from 'three';
import type { RenderDials } from '../defaults';
import type { Theme } from '../themes';

const fragmentShader = /* glsl */ `
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform vec3 uSunDirection;
uniform float uDensity;
uniform float uStart;
uniform mat4 uProjectionInverse;
uniform mat4 uViewInverse;

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (depth >= 0.99999) {
    outputColor = inputColor;
    return;
  }
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uProjectionInverse * clip;
  view /= view.w;
  // Distance along the ray, not view depth: with depth the fog thinned toward the frame edges (corner rays are 1.38
  // times longer in a 50 degree 16:9 view) and shifted whenever the camera turned.
  float amount = 1.0 - exp(-pow(max(length(view.xyz) - uStart, 0.0) * uDensity, 1.5));
  vec3 direction = normalize((uViewInverse * vec4(view.xyz, 0.0)).xyz);
  // Looking toward the sun, the haze warms: aerial perspective in the theme's two fog colours.
  float sun = pow(max(dot(direction, uSunDirection), 0.0), 6.0);
  outputColor = vec4(mix(inputColor.rgb, mix(uFogColor, uFogSunColor, sun), amount), inputColor.a);
}
`;

export class FogEffect extends Effect {
  private readonly camera: PerspectiveCamera;

  constructor(camera: PerspectiveCamera, theme: Theme, sunDirection: Vector3, dials: RenderDials) {
    super('FogEffect', fragmentShader, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uFogColor', new Uniform(new Color(theme.fog.color))],
        ['uFogSunColor', new Uniform(new Color(theme.fog.sunColor))],
        ['uSunDirection', new Uniform(sunDirection.clone().normalize())],
        ['uDensity', new Uniform(dials.fogDensity)],
        ['uStart', new Uniform(dials.fogStart)],
        ['uProjectionInverse', new Uniform(new Matrix4())],
        ['uViewInverse', new Uniform(new Matrix4())],
      ]),
    });
    this.camera = camera;
  }

  setDials(dials: RenderDials, theme: Theme): void {
    (this.uniforms.get('uDensity') as Uniform<number>).value = dials.fogDensity;
    (this.uniforms.get('uStart') as Uniform<number>).value = dials.fogStart;
    (this.uniforms.get('uFogColor') as Uniform<Color>).value.set(theme.fog.color);
    (this.uniforms.get('uFogSunColor') as Uniform<Color>).value.set(theme.fog.sunColor);
  }

  override update(): void {
    (this.uniforms.get('uProjectionInverse') as Uniform<Matrix4>).value.copy(this.camera.projectionMatrixInverse);
    (this.uniforms.get('uViewInverse') as Uniform<Matrix4>).value.copy(this.camera.matrixWorld);
  }
}
