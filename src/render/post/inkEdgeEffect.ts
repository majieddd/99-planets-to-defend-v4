import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { Color, Matrix4, Uniform, Vector2, type PerspectiveCamera, type Texture, type WebGLRenderTarget } from 'three';
import type { RenderDials } from '../defaults';

/**
 * How much nearer than the edge set the main depth must be before the pixel counts as covered by something outside it.
 * Little more than precision has to fit under it: the cover test compares against the nearest of the five taps, which
 * on any surface both buffers hold is about as near as the main depth sample, or nearer. The upper part of a grass
 * blade clears it even from the strategic camera (a 0.6 m tip is about 1.6 percent nearer than the ground behind it
 * there), and far more of the blade does from the low presets.
 */
export const COVER_TOLERANCE = 0.01;

const fragmentShader = /* glsl */ `
uniform sampler2D uNormalBuffer;
uniform sampler2D uEdgeDepth;
uniform sampler2D uInkNoise;
uniform vec3 uInkColor;
uniform float uInkStrength;
uniform float uLineWidth;
uniform float uDepthThreshold;
uniform float uNormalThreshold;
uniform float uFadeNear;
uniform float uFadeFar;
uniform float uCoverTolerance;
uniform vec2 uTexel;
uniform vec2 uEdgeTexel;
uniform mat4 uProjectionInverse;
uniform mat4 uViewInverse;

// The edge set's depth: the world layer alone, drawn with the normals. The main depth also holds grass, flowers and
// hulls, so the depth test ran on them and outlined every grass cone (a fifth to three fifths of the grass pixels
// turned to ink, by preset).
float edgeDistance(const in vec2 coord) {
  return -getViewZ(texture2D(uEdgeDepth, coord).r);
}

vec3 inkNormal(const in vec2 coord) {
  return normalize(texture2D(uNormalBuffer, coord).xyz * 2.0 - 1.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  float edgeDepth = texture2D(uEdgeDepth, uv).r;
  if (edgeDepth >= 0.99999) {
    outputColor = inputColor;
    return;
  }
  float d = -getViewZ(edgeDepth);
  vec4 clip = vec4(uv * 2.0 - 1.0, edgeDepth * 2.0 - 1.0, 1.0);
  vec4 view = uProjectionInverse * clip;
  view /= view.w;
  vec3 world = (uViewInverse * view).xyz;
  // Width varies along a line with world-anchored noise, so it wobbles like ink and never swims. LOD 0 is explicit
  // because screen derivatives of world position explode across a depth jump, so automatic mip selection read a
  // coarse, flat mip exactly on the silhouette pixels. The y term makes vertical outlines (turrets, trees,
  // characters) wobble too; world.xz alone is constant along them.
  float wobble = textureLod(uInkNoise, (world.xz + world.y * vec2(0.37, -0.61)) * 0.08, 0.0).r;
  // A tap under half a texel lands back on the centre texel (depth and normals are read with nearest filtering),
  // so thin lines vanished where the noise was low. The floor is one texel of the edge buffers, which the medium tier
  // draws at 0.75 scale: a floor of one screen pixel let taps land back on the centre texel there. At full scale the
  // floor changes nothing at renderer v1's width of 1.2 or the locked 1.4: their narrowest taps, 0.72 and 0.84 of a
  // texel, already land on the neighbouring texel.
  vec2 offset = max(uTexel * uLineWidth * mix(0.6, 1.4, wobble), uEdgeTexel);
  vec2 ox = vec2(offset.x, 0.0);
  vec2 oy = vec2(0.0, offset.y);
  float right = edgeDistance(uv + ox);
  float left = edgeDistance(uv - ox);
  float up = edgeDistance(uv + oy);
  float down = edgeDistance(uv - oy);
  float farthest = max(max(right, left), max(up, down));
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
  // Where the main depth is nearer than every edge-set depth around the pixel, something outside the edge set (a grass
  // blade, a flower, a hull) stands in front, and a crease drawn there would cross it. The nearest of the five taps
  // stands in for the centre, so MSAA sample positions and the medium tier's smaller edge buffers do not read as cover
  // along a silhouette.
  float nearest = min(d, min(min(right, left), min(up, down)));
  float covered = step(-getViewZ(depth), nearest * (1.0 - uCoverTolerance));
  outputColor = vec4(mix(inputColor.rgb, uInkColor, edge * uInkStrength * (1.0 - covered)), inputColor.a);
}
`;

/** GLSL smoothstep is undefined for equal or inverted edges, and the two fade sliders move independently. */
export function edgeFadeRange(dials: RenderDials): [number, number] {
  const near = Math.min(dials.edgeFadeNear, dials.edgeFadeFar);
  return [near, Math.max(dials.edgeFadeNear, dials.edgeFadeFar, near + 1)];
}

/**
 * Screen-space ink on the edge set's depth and normal discontinuities. `edges` is the normal pass's target: normals in
 * its colour texture and the edge set's depth in its depth texture, both drawn through a camera limited to the world
 * layer. The main depth (EffectAttribute.DEPTH) only tells whether something outside the edge set covers the pixel.
 */
export class InkEdgeEffect extends Effect {
  private readonly camera: PerspectiveCamera;
  private readonly edges: WebGLRenderTarget;

  constructor(camera: PerspectiveCamera, edges: WebGLRenderTarget, inkNoise: Texture, dials: RenderDials) {
    if (!edges.depthTexture) throw new Error('InkEdgeEffect needs the edge buffers to carry a depth texture');
    const [fadeNear, fadeFar] = edgeFadeRange(dials);
    super('InkEdgeEffect', fragmentShader, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uNormalBuffer', new Uniform(edges.texture)],
        ['uEdgeDepth', new Uniform(edges.depthTexture)],
        ['uInkNoise', new Uniform(inkNoise)],
        ['uInkColor', new Uniform(new Color(dials.inkColor))],
        ['uInkStrength', new Uniform(dials.edgeStrength)],
        ['uLineWidth', new Uniform(dials.edgeLineWidth)],
        ['uDepthThreshold', new Uniform(dials.depthThreshold)],
        ['uNormalThreshold', new Uniform(dials.normalThreshold)],
        ['uFadeNear', new Uniform(fadeNear)],
        ['uFadeFar', new Uniform(fadeFar)],
        ['uCoverTolerance', new Uniform(COVER_TOLERANCE)],
        ['uTexel', new Uniform(new Vector2(1 / 1920, 1 / 1080))],
        ['uEdgeTexel', new Uniform(new Vector2(1 / 1920, 1 / 1080))],
        ['uProjectionInverse', new Uniform(new Matrix4())],
        ['uViewInverse', new Uniform(new Matrix4())],
      ]),
    });
    this.camera = camera;
    this.edges = edges;
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
    // Read every frame rather than in setSize: the normal pass sizes its own target, at the tier's scale, and this
    // stays right whichever of the two the composer resizes first.
    this.u<Vector2>('uEdgeTexel').value.set(1 / Math.max(this.edges.width, 1), 1 / Math.max(this.edges.height, 1));
  }

  override setSize(width: number, height: number): void {
    this.u<Vector2>('uTexel').value.set(1 / width, 1 / height);
  }
}
