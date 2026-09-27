import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { Color, Matrix4, Uniform, Vector2, type PerspectiveCamera, type Texture } from 'three';
import type { RenderDials } from '../defaults';

const fragmentShader = /* glsl */ `
uniform sampler2D uNormalBuffer;
uniform sampler2D uInkNoise;
uniform vec3 uInkColor;
uniform float uInkStrength;
uniform float uLineWidth;
uniform float uDepthThreshold;
uniform float uNormalThreshold;
uniform float uFadeNear;
uniform float uFadeFar;
uniform vec2 uTexel;
uniform mat4 uProjectionInverse;
uniform mat4 uViewInverse;

float inkDistance(const in vec2 coord) {
  return -getViewZ(readDepth(coord));
}

vec3 inkNormal(const in vec2 coord) {
  return normalize(texture2D(uNormalBuffer, coord).xyz * 2.0 - 1.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (depth >= 0.99999) {
    outputColor = inputColor;
    return;
  }
  float d = -getViewZ(depth);
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uProjectionInverse * clip;
  view /= view.w;
  vec3 world = (uViewInverse * view).xyz;
  // Width varies along a line with world-anchored noise, so it wobbles like ink and never swims. LOD 0 is explicit
  // because screen derivatives of world position explode across a depth jump, so automatic mip selection read a
  // coarse, flat mip exactly on the silhouette pixels. The y term makes vertical outlines (turrets, trees,
  // characters) wobble too; world.xz alone is constant along them.
  float wobble = textureLod(uInkNoise, (world.xz + world.y * vec2(0.37, -0.61)) * 0.08, 0.0).r;
  // A tap under half a texel lands back on the centre texel (depth and normals are read with nearest filtering),
  // so thin lines vanished where the noise was low. The 1 texel floor changes nothing at the default width of 1.2.
  vec2 offset = uTexel * max(uLineWidth * mix(0.6, 1.4, wobble), 1.0);
  vec2 ox = vec2(offset.x, 0.0);
  vec2 oy = vec2(0.0, offset.y);
  float farthest = max(max(inkDistance(uv + ox), inkDistance(uv - ox)), max(inkDistance(uv + oy), inkDistance(uv - oy)));
  float depthEdge = smoothstep(uDepthThreshold, uDepthThreshold * 2.0, (farthest - d) / d);
  vec3 n = inkNormal(uv);
  float bend = max(
    max(1.0 - dot(n, inkNormal(uv + ox)), 1.0 - dot(n, inkNormal(uv - ox))),
    max(1.0 - dot(n, inkNormal(uv + oy)), 1.0 - dot(n, inkNormal(uv - oy)))
  );
  float normalEdge = smoothstep(uNormalThreshold, uNormalThreshold * 1.6, bend);
  // Creases fade out with distance before they become moire; silhouettes keep some weight.
  float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, d);
  float edge = clamp(max(depthEdge * mix(0.45, 1.0, fade), normalEdge * fade), 0.0, 1.0);
  outputColor = vec4(mix(inputColor.rgb, uInkColor, edge * uInkStrength), inputColor.a);
}
`;

/** GLSL smoothstep is undefined for equal or inverted edges, and the two fade sliders move independently. */
export function edgeFadeRange(dials: RenderDials): [number, number] {
  const near = Math.min(dials.edgeFadeNear, dials.edgeFadeFar);
  return [near, Math.max(dials.edgeFadeNear, dials.edgeFadeFar, near + 1)];
}

export class InkEdgeEffect extends Effect {
  private readonly camera: PerspectiveCamera;

  constructor(camera: PerspectiveCamera, normalBuffer: Texture, inkNoise: Texture, dials: RenderDials) {
    const [fadeNear, fadeFar] = edgeFadeRange(dials);
    super('InkEdgeEffect', fragmentShader, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uNormalBuffer', new Uniform(normalBuffer)],
        ['uInkNoise', new Uniform(inkNoise)],
        ['uInkColor', new Uniform(new Color(dials.inkColor))],
        ['uInkStrength', new Uniform(dials.edgeStrength)],
        ['uLineWidth', new Uniform(dials.edgeLineWidth)],
        ['uDepthThreshold', new Uniform(dials.depthThreshold)],
        ['uNormalThreshold', new Uniform(dials.normalThreshold)],
        ['uFadeNear', new Uniform(fadeNear)],
        ['uFadeFar', new Uniform(fadeFar)],
        ['uTexel', new Uniform(new Vector2(1 / 1920, 1 / 1080))],
        ['uProjectionInverse', new Uniform(new Matrix4())],
        ['uViewInverse', new Uniform(new Matrix4())],
      ]),
    });
    this.camera = camera;
  }

  private u<T>(name: string): Uniform<T> {
    return this.uniforms.get(name) as Uniform<T>;
  }

  setDials(dials: RenderDials): void {
    const [fadeNear, fadeFar] = edgeFadeRange(dials);
    this.u<Color>('uInkColor').value.set(dials.inkColor);
    this.u<number>('uInkStrength').value = dials.edgeStrength;
    this.u<number>('uLineWidth').value = dials.edgeLineWidth;
    this.u<number>('uDepthThreshold').value = dials.depthThreshold;
    this.u<number>('uNormalThreshold').value = dials.normalThreshold;
    this.u<number>('uFadeNear').value = fadeNear;
    this.u<number>('uFadeFar').value = fadeFar;
  }

  override update(): void {
    this.u<Matrix4>('uProjectionInverse').value.copy(this.camera.projectionMatrixInverse);
    this.u<Matrix4>('uViewInverse').value.copy(this.camera.matrixWorld);
  }

  override setSize(width: number, height: number): void {
    this.u<Vector2>('uTexel').value.set(1 / width, 1 / height);
  }
}
