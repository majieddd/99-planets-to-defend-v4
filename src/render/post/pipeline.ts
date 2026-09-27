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

/**
 * The key material's warm test ramps over a red-led pixel's blue as a fraction of its peak channel: at WARM_BLUE_FULL or
 * less the pixel is warm and takes heartHalo, at WARM_BLUE_NONE or more it takes bloomIntensity. The two edges encode
 * Pillar 5 (warm is the heart and its economy, magenta is Xeno, cyan is yours) on the committed assets lit at the
 * defaults: the heart crystal's texels sit at 0.041 to 0.074 (1st to 99th percentile), 0.126 under the first edge, and
 * the nest's magenta seams at 0.382 to 0.519, 0.032 over the second, while cyan's red never leads. The heart stays warm
 * through a fog amount of about 0.3 (at 0.4 its texels reach 0.198 to 0.237). Known failure, unreachable at the
 * defaults: a sunColor of #ff8844 at intensity 8 with a silhouette rim warms the seams until 89.5 percent of their
 * texels test at least half warm. Deciding warmth in painted.ts from the emitter's own colour, not the lit pixel, would
 * end it.
 */
export const WARM_BLUE_FULL = 0.2;
/** See WARM_BLUE_FULL. */
export const WARM_BLUE_NONE = 0.35;

/**
 * The ink gate: the linear luminance over which a pixel goes from taking none of the bloom's glow to all of it (up to
 * GLOW_LIFT_MAX). The hull and edge ink, #0e0f14, is 0.0049, under INK_GATE_LOW, so ink stays as black as it is drawn.
 * Painted surfaces sit above INK_GATE_HIGH: over the hero, close-up and strategic cameras on all three tiers, at the
 * defaults and at the art preset, the darkest ink-free pixels near energy were 0.0167 (1st percentile), and under 0.3
 * percent of the ink-free pixels in any frame fell below 0.015. The ink's coverage came from drawing it black and white.
 */
export const INK_GATE_LOW = 0.006;
/** See INK_GATE_LOW. */
export const INK_GATE_HIGH = 0.015;

/**
 * The most glow the bloom may add to a pixel, as a multiple of the pixel's own luminance, so glow brightens nothing more
 * than five-fold (2.3 stops). It covers the ink the gate cannot see: fog lifts distant ink past INK_GATE_HIGH (the art
 * preset's fogStart of 0 put the heart's outline at 0.015 to 0.034 at the hero camera, 1st to 75th percentile, where
 * the darkest paint near energy is 0.019), and MSAA mixes the ink's edge pixels with what lies behind. It also holds dark
 * paint beside a strong emitter to a warm tint where the glow flooded it (the claws beside the heart crystal turned pale
 * peach at heartHalo 7). At 4 the art preset's heart outline stays under 55 luma at the 95th percentile on every tier,
 * against 72 at 6, while the heart's halo on ink-free pixels 1 to 4 px out keeps 98 percent of its luma on the high tier
 * at the defaults and 85 percent on the low tier, whose four-level blur piles the glow onto the claws; the rails keep 92
 * to 100 percent of theirs and the nest 97 to 100. A smaller cap darkens fogged ink further at the cost of that halo.
 */
export const GLOW_LIFT_MAX = 4;

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
      defines: {
        EMISSIVE_PEAK: glslFloat(EMISSIVE_PEAK),
        WARM_BLUE_FULL: glslFloat(WARM_BLUE_FULL),
        WARM_BLUE_NONE: glslFloat(WARM_BLUE_NONE),
      },
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
          // its red and cyan's red never leads, so neither takes the heart's strength (see WARM_BLUE_FULL).
          float warm = step(max(texel.g, texel.b), texel.r) * (1.0 - smoothstep(WARM_BLUE_FULL, WARM_BLUE_NONE, texel.b / peak));
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
 * The bloom, keyed by a BloomKeyMaterial, adds its glow everywhere but on the emitters and the ink, and never more to a
 * pixel than GLOW_LIFT_MAX times its own luminance. The strengths live in the key material, so this effect's own
 * intensity stays 1.
 *
 * The shield keeps the glow off the pixels that fed it. Added on top of them too, the glow undid the emissive cap
 * (painted.ts EMISSIVE_PEAK) that keeps energy its colour under AgX: with a halo strong enough to read and only half the
 * glow let through, the heart crystal's median saturation still fell from 0.46 to 0.40 and the rails' from 0.37 to 0.28.
 * It holds on every emitter, not only the heart, because energy keeping its saturated hue is how Pillar 5 reads. Against
 * the bloom before it (469e74e), which let its glow onto every pixel, the hero camera's cyan lost the 12.9 luma that glow
 * had added and its median saturation rose from 0.310 to 0.374; the close-up's cyan lost 9.1 (0.224 to 0.245), the
 * strategic camera's nest 4.2 (0.350 to 0.359) and the heart crystal 14.1 (0.425 to 0.460). It reads the same key,
 * threshold and ramp as the input mask, from the frame's alpha, which still carries the key here because the ink and fog
 * pass keep it.
 *
 * The ink gate keeps the glow off the ink, so an outline stays black and a halo starts outside it. An outline pixel has
 * a key of 0, so the shield let the whole glow onto it, and AgX lifts dark pixels most: at heartHalo 4 the heart
 * crystal's outline gained 119 luma against 16 for the sky beside it and survived only where MSAA left a partly keyed
 * pixel, dashed on the high tier (32.7 percent of its right edge's rows had no pixel darker than 100) and gone on the low
 * tier (all of them), which phones and the browser tests render. The lift cap then covers the ink the gate cannot tell
 * from paint, and dark paint under strong glow (see GLOW_LIFT_MAX). With both, that outline averages 13 luma or less on
 * every tier at heartHalo 4 and 7 (1.9 on the low tier, its value with the bloom off) and no row of it breaks. Both read
 * only this pixel, so they cost no taps; a widened shield would have taken the rails' halos, which have no ink around
 * them, and a gate alone left the art preset's fogged outline as washed as before.
 */
export class KeyedBloomEffect extends BloomEffect {
  constructor(key: BloomKeyMaterial, options: { blendFunction: BlendFunction; levels: number }) {
    super({ ...options, intensity: 1, mipmapBlur: true });
    // The same Uniform objects as the key material's, so a threshold move reaches the mask and the shield at once.
    this.uniforms.set('threshold', key.uniforms['threshold'] as Uniform<number>);
    this.uniforms.set('smoothing', key.uniforms['smoothing'] as Uniform<number>);
    this.uniforms.set('keyRange', key.uniforms['keyRange'] as Uniform<number>);
    this.defines.set('INK_GATE_LOW', glslFloat(INK_GATE_LOW));
    this.defines.set('INK_GATE_HIGH', glslFloat(INK_GATE_HIGH));
    this.defines.set('GLOW_LIFT_MAX', glslFloat(GLOW_LIFT_MAX));
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
  vec4 glow = texture2D(map, uv) * intensity;
  float emitter = smoothstep(threshold, threshold + smoothing, inputColor.a * keyRange);
  float lum = luminance(inputColor.rgb);
  float inkGate = smoothstep(INK_GATE_LOW, INK_GATE_HIGH, lum);
  float lift = min(1.0, GLOW_LIFT_MAX * lum / max(luminance(glow.rgb), 1e-4));
  outputColor = glow * (1.0 - emitter) * inkGate * lift;
}
`);
    // Swapped in before the pass joins the composer. LuminancePass.initialize then switches the pass's target to the
    // frame buffer's HalfFloat, which keeps the glow input, whose gains run to 8, from clamping at 1; the
    // FRAMEBUFFER_PRECISION_HIGH define it also sets on this material changes nothing, because the key shader has no
    // branch on it. The stock material was never compiled, so disposing it releases nothing today (dispose only asks the
    // renderer to free what it compiled); the call keeps it that way should a later postprocessing compile it earlier.
    this.luminancePass.fullscreenMaterial.dispose();
    this.luminancePass.fullscreenMaterial = key;
  }

  /**
   * The key material, read from the luminance pass rather than kept in a field. Effect.dispose disposes every material
   * among the effect's own fields and the luminance pass's Pass.dispose disposes its full-screen material, so kept in a
   * field the key was disposed twice on every pipeline.dispose(). BloomEffect's luminanceMaterial getter returns this same
   * material still typed as a LuminanceMaterial: its threshold setter works (this material has one), but setting its
   * smoothing, luminanceRange or colorOutput does nothing. The threshold and the strengths go through setDials, and the
   * ramp is fixed at construction (BLOOM_SMOOTHING).
   */
  get key(): BloomKeyMaterial {
    return this.luminancePass.fullscreenMaterial as BloomKeyMaterial;
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
 *
 * The bloom shields every emitter's own pixels from its glow, not only the heart's, so energy keeps its saturated hue
 * (the hero camera's cyan went from 0.310 to 0.374 saturation), and it keeps the glow off the ink and caps what it adds
 * to dark paint; KeyedBloomEffect has the measurements.
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
