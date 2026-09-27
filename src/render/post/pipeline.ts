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
import { EMISSIVE_KEY_RANGE, EMISSIVE_PEAK, glslFloat } from '../materials/painted';
import type { Tier } from '../quality';
import type { Theme } from '../themes';
import { FinishEffect } from './finishEffect';
import { FogEffect, type FogPlanet } from './fogEffect';
import { GradeEffect } from './gradeEffect';
import { InkEdgeEffect } from './inkEdgeEffect';

/** The width of the bloom mask's ramp above the threshold, in emissive key units. */
export const BLOOM_SMOOTHING = 0.25;

export type BloomDials = Pick<RenderDials, 'bloomThreshold' | 'bloomIntensity' | 'heartHalo'>;

/**
 * The bloom's input: each emissive pixel's hue at unit brightness, masked by the emissive key the scene wrote into alpha
 * (painted.ts) instead of by its luminance, and scaled by its halo strength. Keyed on Rec.709 luminance, the magenta nest
 * (about 0.83 at intensity 3) never glowed while cyan (about 2.2) did, and any threshold low enough for magenta bloomed
 * lit white too (0.95, up to 1.08 with rim). The bloomThreshold dial reads as the brightest emissive channel at which
 * energy starts to glow; lit colour, however bright, never opens the mask.
 *
 * The hue, not the colour, is what glows. Fed the capped surface colour, the heart (authored at a key of about 1.5)
 * showed almost no halo at hero distance: about 12 luma added 4 to 8 px outside the crystal. Fed hue times key, the
 * rails (key 4) outshone it, so any halo that made the heart read turned every rail into a neon flare. At unit
 * brightness every emitter feeds the same amount per pixel, bigger emitters get bigger halos, and two dials set the
 * strength: warm hue, which is the heart's alone (blueprint Pillar 5), takes heartHalo, and every other energy takes
 * bloomIntensity.
 *
 * It replaces the stock LuminanceMaterial through Pass's public fullscreenMaterial setter on the bloom's public
 * luminancePass, so the bloom's own blur, resize and dispose paths run unchanged. LuminancePass.render hands the frame
 * over through the inputBuffer setter, which this class provides as the stock material does.
 */
export class BloomKeyMaterial extends ShaderMaterial {
  private readonly input: Uniform<Texture | null>;
  private readonly thresholdUniform: Uniform<number>;
  private readonly energyGain: Uniform<number>;
  private readonly heartGain: Uniform<number>;

  constructor(dials: BloomDials, smoothing = BLOOM_SMOOTHING) {
    const input = new Uniform<Texture | null>(null);
    const thresholdUniform = new Uniform(dials.bloomThreshold);
    const energyGain = new Uniform(dials.bloomIntensity);
    const heartGain = new Uniform(dials.heartHalo);
    super({
      name: 'BloomKeyMaterial',
      defines: { EMISSIVE_PEAK: glslFloat(EMISSIVE_PEAK) },
      uniforms: {
        inputBuffer: input,
        threshold: thresholdUniform,
        smoothing: new Uniform(smoothing),
        keyRange: new Uniform(EMISSIVE_KEY_RANGE),
        energyGain,
        heartGain,
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
        uniform float energyGain;
        uniform float heartGain;
        varying vec2 vUv;
        void main() {
          vec4 texel = texture2D(inputBuffer, vUv);
          float mask = smoothstep(threshold, threshold + smoothing, texel.a * keyRange);
          float peak = max(max(texel.r, texel.g), max(texel.b, 1e-4));
          // Warm is red leading with blue under a fifth of it: the heart's amber and gold. Magenta's blue is about 0.4 of
          // its red and cyan's red never leads, so neither takes the heart's strength.
          float warm = step(max(texel.g, texel.b), texel.r) * (1.0 - smoothstep(0.2, 0.35, texel.b / peak));
          // A pixel wholly covered by energy reaches the cap's peak on its emission alone and feeds its hue at unit
          // brightness, lit or in shadow. Divided by its own peak instead, a thin rail's edge pixels, part rail and part
          // gunmetal but keyed past the threshold by the rail's key of 4, fed full brightness too, and the rails'
          // halos ran up to three times today's at the strategic camera.
          vec3 energy = texel.rgb / max(peak, EMISSIVE_PEAK);
          // Alpha 0: the blurred glow carries no key of its own into the frame.
          gl_FragColor = vec4(energy * mask * mix(energyGain, heartGain, warm), 0.0);
        }
      `,
    });
    this.input = input;
    this.thresholdUniform = thresholdUniform;
    this.energyGain = energyGain;
    this.heartGain = heartGain;
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

  setDials(dials: BloomDials): void {
    this.thresholdUniform.value = dials.bloomThreshold;
    this.energyGain.value = dials.bloomIntensity;
    this.heartGain.value = dials.heartHalo;
  }
}

/**
 * The bloom, keyed by a BloomKeyMaterial, adds its glow everywhere except on the pixels that fed it. Added on top of
 * them too, the glow undid the emissive cap (painted.ts EMISSIVE_PEAK) that keeps energy its colour under AgX: with a
 * halo strong enough to read and only half the glow let through, the heart crystal's median saturation still fell from
 * 0.46 to 0.40 and the rails' from 0.37 to 0.28. The shield reads the same key, threshold and ramp as the input mask,
 * from the frame's alpha, which still carries the key here because the ink and fog pass keep it. The strengths live in
 * the key material, so this effect's own intensity stays 1.
 */
export class KeyedBloomEffect extends BloomEffect {
  readonly key: BloomKeyMaterial;

  constructor(key: BloomKeyMaterial, options: { blendFunction: BlendFunction; levels: number }) {
    super({ ...options, intensity: 1, mipmapBlur: true });
    this.key = key;
    // The same Uniform objects as the key material's, so a threshold move reaches the mask and the shield at once.
    this.uniforms.set('threshold', key.uniforms['threshold'] as Uniform<number>);
    this.uniforms.set('smoothing', key.uniforms['smoothing'] as Uniform<number>);
    this.uniforms.set('keyRange', key.uniforms['keyRange'] as Uniform<number>);
    this.setFragmentShader(/* glsl */ `
#ifdef FRAMEBUFFER_PRECISION_HIGH
uniform mediump sampler2D map;
#else
uniform lowp sampler2D map;
#endif
uniform float intensity;
uniform float threshold;
uniform float smoothing;
uniform float keyRange;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float emitter = smoothstep(threshold, threshold + smoothing, inputColor.a * keyRange);
  outputColor = texture2D(map, uv) * intensity * (1.0 - emitter);
}
`);
    // Swapped in before the pass joins the composer, whose initialize() then gives this material, not the stock one,
    // the frame buffer's precision define. The stock material was never compiled; disposing it frees only its uniforms.
    this.luminancePass.fullscreenMaterial.dispose();
    this.luminancePass.fullscreenMaterial = key;
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
  /** The sphere the camera stands on. With it the fog can thin with altitude (fogHeightFalloff); without it, it cannot. */
  planet?: FogPlanet;
}

export interface Pipeline {
  composer: EffectComposer;
  ink: InkEdgeEffect | null;
  fog: FogEffect;
  bloomKey: BloomKeyMaterial;
  render(deltaSeconds: number): void;
  setSize(width: number, height: number): void;
  applyDials(dials: RenderDials, theme: Theme): void;
  /** The sun moved (its elevation is a dial): the fog's sunward warming follows it. */
  setSunDirection(direction: Vector3): void;
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
 * bloom has read it (its input mask and its shield), the last effect sets alpha back to 1 for the canvas.
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
  const fog = new FogEffect(o.camera, o.theme, o.sunDirection, o.dials, o.planet);
  composer.addPass(new EffectPass(o.camera, ...(ink ? [ink, fog] : [fog])));
  const bloomKey = new BloomKeyMaterial(o.dials);
  const bloom = new KeyedBloomEffect(bloomKey, {
    // The default SCREEN blend adds only src * (1 - dst) and dims anything brighter than 1, so the energy cores,
    // the only things meant to glow, sank under their own glow and the halo over bright ground was about halved.
    blendFunction: BlendFunction.ADD,
    levels: o.tier.bloomLevels,
  });
  const grade = new GradeEffect(o.theme, o.dials);
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
  const finish = new FinishEffect(o.dials, o.reducedMotion);
  composer.addPass(new EffectPass(o.camera, bloom, grade, tone, finish, new OpaqueOutputEffect()));

  return {
    composer,
    ink,
    fog,
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
      bloomKey.setDials(dials);
      grade.setDials(dials, theme);
      finish.setDials(dials);
    },
    setSunDirection(direction) {
      fog.setSunDirection(direction);
    },
    dispose() {
      composer.dispose();
    },
  };
}
