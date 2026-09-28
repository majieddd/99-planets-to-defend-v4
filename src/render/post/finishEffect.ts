import { BlendFunction, Effect } from 'postprocessing';
import { Uniform, Vector2 } from 'three';
import type { RenderDials } from '../defaults';

// This runs after AgX but before the output sRGB encode, so it sees display-linear light, where equal steps are
// far from equal to the eye. Grain, off by default but kept as a dial, wants to read evenly from ink to highlights,
// and a gamma 2 space is close enough to sRGB for that. Reduced motion freezes the grain, because a per-frame shimmer
// is motion.
const fragmentShader = /* glsl */ `
uniform float uVignette;
uniform float uGrain;
uniform float uSeed;
uniform vec2 uResolution;

float finishHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 q = uv - 0.5;
  vec3 c = max(inputColor.rgb * (1.0 - uVignette * dot(q, q) * 1.6), 0.0);
  // Grain goes on in a gamma 2 space; added in linear light it was six to nine times louder in shadows and ink,
  // and clipping it there lifted black into grey speckle.
  vec3 g = max(sqrt(c) + (finishHash(floor(uv * uResolution)) - 0.5) * uGrain, 0.0);
  outputColor = vec4(g * g, inputColor.a);
}
`;

export class FinishEffect extends Effect {
  private time = 0;
  private readonly animate: boolean;

  constructor(dials: RenderDials, reducedMotion: boolean) {
    super('FinishEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uVignette', new Uniform(dials.vignette)],
        ['uGrain', new Uniform(dials.grain)],
        ['uSeed', new Uniform(0)],
        // A placeholder size: EffectComposer.addPass sizes the pass, and so this effect, before the first draw.
        ['uResolution', new Uniform(new Vector2(1920, 1080))],
      ]),
    });
    this.animate = !reducedMotion;
  }

  setDials(dials: RenderDials): void {
    (this.uniforms.get('uVignette') as Uniform<number>).value = dials.vignette;
    (this.uniforms.get('uGrain') as Uniform<number>).value = dials.grain;
  }

  tick(delta: number): void {
    if (!this.animate) return;
    this.time += delta;
    (this.uniforms.get('uSeed') as Uniform<number>).value = Math.floor(this.time * 24) % 1000;
  }

  override setSize(width: number, height: number): void {
    (this.uniforms.get('uResolution') as Uniform<Vector2>).value.set(width, height);
  }
}
