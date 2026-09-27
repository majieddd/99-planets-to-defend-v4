import { BlendFunction, BloomEffect, Effect, EffectComposer, EffectPass, NormalPass, RenderPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import {
  DepthTexture,
  FloatType,
  HalfFloatType,
  NearestFilter,
  NoBlending,
  ShaderMaterial,
  Uniform,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type Scene,
  type Texture,
  type Vector3,
  type WebGLRenderer,
} from 'three';
import type { RenderDials } from '../defaults';
import { LAYERS } from '../layers';
import { EMISSIVE_KEY_RANGE } from '../materials/painted';
import type { Tier } from '../quality';
import type { Theme } from '../themes';
import { FinishEffect } from './finishEffect';
import { FogEffect } from './fogEffect';
import { GradeEffect } from './gradeEffect';
import { InkEdgeEffect } from './inkEdgeEffect';

/** The width of the bloom mask's ramp above the threshold, in emissive key units. */
export const BLOOM_SMOOTHING = 0.25;

/**
 * The bloom's input: each pixel's colour, masked by the emissive key the scene wrote into alpha (painted.ts) instead of
 * by its luminance. Keyed on Rec.709 luminance, the magenta nest (about 0.83 at intensity 3) never glowed while cyan
 * (about 2.2) did, and any threshold low enough for magenta bloomed lit white too (0.95, up to 1.08 with rim). The
 * bloomThreshold dial now reads as the brightest emissive channel at which energy starts to glow; lit colour, however
 * bright, never opens the mask.
 *
 * It replaces the stock LuminanceMaterial through Pass's public fullscreenMaterial setter on the bloom's public
 * luminancePass, so the bloom's own blur, resize and dispose paths run unchanged. LuminancePass.render hands the frame
 * over through the inputBuffer setter, which this class provides as the stock material does.
 */
export class BloomKeyMaterial extends ShaderMaterial {
  private readonly input: Uniform<Texture | null>;
  private readonly thresholdUniform: Uniform<number>;

  constructor(threshold: number, smoothing = BLOOM_SMOOTHING) {
    const input = new Uniform<Texture | null>(null);
    const thresholdUniform = new Uniform(threshold);
    super({
      name: 'BloomKeyMaterial',
      uniforms: {
        inputBuffer: input,
        threshold: thresholdUniform,
        smoothing: new Uniform(smoothing),
        keyRange: new Uniform(EMISSIVE_KEY_RANGE),
      },
      blending: NoBlending,
      toneMapped: false,
      depthWrite: false,
      depthTest: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = position.xy * 0.5 + 0.5;
          gl_Position = vec4(position.xy, 1.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D inputBuffer;
        uniform float threshold;
        uniform float smoothing;
        uniform float keyRange;
        varying vec2 vUv;
        void main() {
          vec4 texel = texture2D(inputBuffer, vUv);
          float mask = smoothstep(threshold, threshold + smoothing, texel.a * keyRange);
          // Alpha 0: the blurred glow carries no key of its own into the frame.
          gl_FragColor = vec4(texel.rgb * mask, 0.0);
        }
      `,
    });
    this.input = input;
    this.thresholdUniform = thresholdUniform;
  }

  set inputBuffer(value: Texture | null) {
    this.input.value = value;
  }

  get threshold(): number {
    return this.thresholdUniform.value;
  }

  set threshold(value: number) {
    this.thresholdUniform.value = value;
  }
}

/**
 * Ends the frame with alpha 1. three r186 always creates its context with alpha (its alpha option only sets the clear
 * alpha), so the canvas composites over the page by its alpha. Carrying the emissive key, the frame's alpha is 0 almost
 * everywhere, which added the page's background colour to every pixel (the far meadow measured 23 luma brighter) and
 * would have handed the colour audit's canvas read transparent pixels.
 */
export class OpaqueOutputEffect extends Effect {
  constructor() {
    super('OpaqueOutputEffect', 'void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) { outputColor = vec4(inputColor.rgb, 1.0); }', {
      blendFunction: BlendFunction.SRC,
    });
  }
}

export interface PipelineOptions {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  tier: Tier;
  dials: RenderDials;
  theme: Theme;
  inkNoise: Texture;
  sunDirection: Vector3;
  reducedMotion: boolean;
}

export interface Pipeline {
  composer: EffectComposer;
  ink: InkEdgeEffect | null;
  bloomKey: BloomKeyMaterial;
  render(deltaSeconds: number): void;
  setSize(width: number, height: number): void;
  applyDials(dials: RenderDials, theme: Theme): void;
  dispose(): void;
}

/**
 * Scene, then (high and medium tiers) normals and depth of the edge set for the edge ink, then ink and fog, then bloom,
 * grade, AgX tone mapping and the finish. The normal pass has its own camera limited to the world layer, so hulls, the
 * sky and the noEdge layer (grass and flowers) never produce edges of their own. The camera must not be parented,
 * because the normal camera copies its local transform only and would draw the normals from the wrong place.
 *
 * Alpha carries the emissive key from the scene to the bloom, which makes one contract for every material the main
 * camera draws: write alpha = emissive key / EMISSIVE_KEY_RANGE, with blending off. A stock three material breaks it
 * without a sign: it writes alpha 1, which reads as a key of EMISSIVE_KEY_RANGE (4), so the whole surface blooms at full
 * strength. A transparent effect needs its own alpha blend equation (CustomBlending with blendSrcAlpha and
 * blendDstAlpha), because the colour blend would write its opacity into the key. The painted material writes the key,
 * the hull and sky write 0, the scene clears to 0, and the MSAA resolve, the ink and fog effects keep it. After the
 * bloom has read it, the last effect sets alpha back to 1 for the canvas.
 */
export function createPipeline(o: PipelineOptions): Pipeline {
  const composer = new EffectComposer(o.renderer, { frameBufferType: HalfFloatType, multisampling: o.tier.msaa });
  const scenePass = new RenderPass(o.scene, o.camera);
  // The renderer's alpha option is off, so three clears with alpha 1, which a pixel nothing draws would carry into the
  // bloom as a key of EMISSIVE_KEY_RANGE. The sky covers every pixel today; this keeps a gap in it from glowing.
  scenePass.clearPass.overrideClearAlpha = 0;
  composer.addPass(scenePass);
  let normalCamera: PerspectiveCamera | null = null;
  let ink: InkEdgeEffect | null = null;
  if (o.tier.edgeInk) {
    normalCamera = o.camera.clone();
    // The depth texture gives the edge pass the edge set's own depth, drawn with the normals at the same scale.
    const edges = new WebGLRenderTarget(1, 1, { minFilter: NearestFilter, magFilter: NearestFilter, depthTexture: new DepthTexture(1, 1, FloatType) });
    edges.texture.name = 'EdgePass.Normals';
    const normalPass = new NormalPass(o.scene, normalCamera, { renderTarget: edges, resolutionScale: o.tier.normalScale });
    composer.addPass(normalPass);
    ink = new InkEdgeEffect(o.camera, edges, o.inkNoise, o.dials);
  }
  const fog = new FogEffect(o.camera, o.theme, o.sunDirection, o.dials);
  composer.addPass(new EffectPass(o.camera, ...(ink ? [ink, fog] : [fog])));
  const bloom = new BloomEffect({
    // The default SCREEN blend adds only src * (1 - dst) and dims anything brighter than 1, so the energy cores,
    // the only things meant to glow, sank under their own glow and the halo over bright ground was about halved.
    blendFunction: BlendFunction.ADD,
    intensity: o.dials.bloomIntensity,
    mipmapBlur: true,
    levels: o.tier.bloomLevels,
  });
  const bloomKey = new BloomKeyMaterial(o.dials.bloomThreshold);
  // Swapped in before the pass joins the composer, whose initialize() then gives this material, not the stock one, the
  // frame buffer's precision define. The stock material was never compiled; disposing it frees nothing but its uniforms.
  bloom.luminancePass.fullscreenMaterial.dispose();
  bloom.luminancePass.fullscreenMaterial = bloomKey;
  const grade = new GradeEffect(o.theme, o.dials);
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
  const finish = new FinishEffect(o.dials, o.reducedMotion);
  composer.addPass(new EffectPass(o.camera, bloom, grade, tone, finish, new OpaqueOutputEffect()));

  return {
    composer,
    ink,
    bloomKey,
    render(deltaSeconds) {
      if (normalCamera) {
        normalCamera.copy(o.camera, false);
        normalCamera.layers.set(LAYERS.world);
      }
      finish.tick(deltaSeconds);
      composer.render(deltaSeconds);
    },
    setSize(width, height) {
      composer.setSize(width, height);
    },
    applyDials(dials, theme) {
      ink?.setDials(dials);
      fog.setDials(dials, theme);
      bloom.intensity = dials.bloomIntensity;
      bloomKey.threshold = dials.bloomThreshold;
      grade.setDials(dials, theme);
      finish.setDials(dials);
    },
    dispose() {
      composer.dispose();
    },
  };
}
