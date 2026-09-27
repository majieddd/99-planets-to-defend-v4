import { BloomEffect, EffectPass, NormalPass, RenderPass, type Effect, type Pass } from 'postprocessing';
import { DepthTexture, FloatType, PerspectiveCamera, Scene, SRGBColorSpace, Texture, Vector2, Vector3, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIALS, NUMERIC_RANGES } from '../../../src/render/defaults';
import { LAYERS } from '../../../src/render/layers';
import { EMISSIVE_KEY_RANGE } from '../../../src/render/materials/painted';
import { BLOOM_SMOOTHING, BloomKeyMaterial, createPipeline, OpaqueOutputEffect, type Pipeline } from '../../../src/render/post/pipeline';
import { InkEdgeEffect } from '../../../src/render/post/inkEdgeEffect';
import { TIERS, type TierName } from '../../../src/render/quality';
import { VERDANT } from '../../../src/render/themes';

/**
 * Enough of a WebGLRenderer for the composer and its passes to be built and wired in node. Rendering still needs a GPU;
 * the browser tests and the captured frames cover that. Without renderbufferStorageMultisample the composer treats the
 * context as having no MSAA, which changes nothing here.
 */
function stubRenderer(width = 1280, height = 720): WebGLRenderer {
  const size = new Vector2(width, height);
  return {
    autoClear: true,
    outputColorSpace: SRGBColorSpace,
    getSize: (target: Vector2) => target.copy(size),
    getDrawingBufferSize: (target: Vector2) => target.copy(size),
    setSize: (w: number, h: number) => size.set(w, h),
    getContext: () => ({ getContextAttributes: () => ({ alpha: true }) }),
  } as unknown as WebGLRenderer;
}

function build(tier: TierName, camera = new PerspectiveCamera(50, 16 / 9, 0.1, 2500)): Pipeline {
  return createPipeline({
    renderer: stubRenderer(),
    scene: new Scene(),
    camera,
    tier: TIERS[tier],
    dials: DEFAULT_DIALS,
    theme: VERDANT,
    inkNoise: new Texture(),
    sunDirection: new Vector3(0, 1, 0),
    reducedMotion: true,
  });
}

// EffectPass keeps its effects, and NormalPass its target and the render pass that holds its camera, private in the
// typings; the wiring is what is under test.
const effectsOf = (pass: Pass): Effect[] => (pass as unknown as { effects: Effect[] }).effects;
const targetOf = (pass: Pass): WebGLRenderTarget => (pass as unknown as { renderTarget: WebGLRenderTarget }).renderTarget;
const cameraOf = (pass: Pass): PerspectiveCamera => (pass as unknown as { renderPass: { camera: PerspectiveCamera } }).renderPass.camera;

describe('bloom key material', () => {
  it('masks colour by the emissive key in alpha, never by luminance', () => {
    const { fragmentShader } = new BloomKeyMaterial(1);
    expect(fragmentShader).toContain('float mask = smoothstep(threshold, threshold + smoothing, texel.a * keyRange);');
    expect(fragmentShader).toContain('gl_FragColor = vec4(texel.rgb * mask, 0.0);');
    expect(fragmentShader).not.toMatch(/luminance|0\.7152/);
  });

  it('decodes the key with the range the painted material encodes it in', () => {
    const material = new BloomKeyMaterial(1.35);
    expect(material.uniforms['keyRange']!.value).toBe(EMISSIVE_KEY_RANGE);
    expect(material.uniforms['smoothing']!.value).toBe(BLOOM_SMOOTHING);
    expect(material.uniforms['threshold']!.value).toBe(1.35);
    // Every threshold the dial allows, plus the ramp, fits under the range an EffectPass keeps (alpha clamped to 1).
    expect(NUMERIC_RANGES.bloomThreshold[1] + BLOOM_SMOOTHING).toBeLessThanOrEqual(EMISSIVE_KEY_RANGE);
  });

  it('takes the frame through the setter LuminancePass.render uses, and the threshold both ways', () => {
    const material = new BloomKeyMaterial(1);
    const frame = new Texture();
    material.inputBuffer = frame;
    expect(material.uniforms['inputBuffer']!.value).toBe(frame);
    material.threshold = 2.2;
    expect(material.threshold).toBe(2.2);
    expect(material.uniforms['threshold']!.value).toBe(2.2);
  });
});

describe('opaque output', () => {
  it('ends the frame at alpha 1, whatever key alpha carried to the bloom', () => {
    expect(new OpaqueOutputEffect().getFragmentShader()).toContain('outputColor = vec4(inputColor.rgb, 1.0);');
  });
});

describe('createPipeline', () => {
  it('clears the scene to alpha 0, so a pixel nothing draws carries no key', () => {
    const scenePass = build('high').composer.passes[0] as RenderPass;
    expect(scenePass).toBeInstanceOf(RenderPass);
    expect(scenePass.clearPass.overrideClearAlpha).toBe(0);
  });

  it('draws the edge set with a depth texture at the tier scale and hands both to the ink', () => {
    for (const tier of ['high', 'medium'] as const) {
      const pipeline = build(tier);
      const normalPass = pipeline.composer.passes[1] as NormalPass;
      expect(normalPass).toBeInstanceOf(NormalPass);
      expect(normalPass.resolution.scale).toBe(TIERS[tier].normalScale);
      const edges = targetOf(normalPass);
      expect(edges.depthTexture).toBeInstanceOf(DepthTexture);
      // The main depth is FloatType too, so the cover test compares like with like.
      expect(edges.depthTexture!.type).toBe(FloatType);
      const ink = pipeline.ink as InkEdgeEffect;
      expect(ink).toBeInstanceOf(InkEdgeEffect);
      expect(ink.uniforms.get('uNormalBuffer')!.value).toBe(normalPass.texture);
      expect(ink.uniforms.get('uEdgeDepth')!.value).toBe(edges.depthTexture);
      // 1280 x 720 at the tier scale: the ink's tap floor follows the smaller buffer.
      ink.update();
      expect((ink.uniforms.get('uEdgeTexel')!.value as Vector2).toArray()).toEqual([1 / edges.width, 1 / edges.height]);
      expect(edges.width).toBe(Math.round(1280 * TIERS[tier].normalScale));
    }
    const low = build('low');
    expect(low.ink).toBeNull();
    expect(low.composer.passes.some((pass) => pass instanceof NormalPass)).toBe(false);
  });

  it('draws the edge set through a camera that sees the world layer only, whatever the main camera sees', () => {
    for (const tier of ['high', 'medium'] as const) {
      // Every layer on, where the lab turns on hulls, the sky and noEdge: on layer 0 alone, the mask the normal camera
      // copies from the main camera would already be the world layer, and a dropped restriction would pass unseen.
      const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 2500);
      camera.layers.enableAll();
      const mainMask = camera.layers.mask;
      const pipeline = build(tier, camera);
      // Drawing needs a GPU; the camera setup before it is what is under test.
      pipeline.composer.render = () => {};
      pipeline.render(0);
      const normalCamera = cameraOf(pipeline.composer.passes[1] as NormalPass);
      expect(normalCamera).not.toBe(camera);
      expect(normalCamera.layers.mask).toBe(1 << LAYERS.world);
      expect(camera.layers.mask).toBe(mainMask);
    }
  });

  it('keys the bloom on the emissive key and ends the frame opaque', () => {
    const pipeline = build('high');
    const last = pipeline.composer.passes.at(-1) as EffectPass;
    expect(last).toBeInstanceOf(EffectPass);
    const effects = effectsOf(last);
    const bloom = effects.find((effect) => effect instanceof BloomEffect) as BloomEffect;
    expect(bloom.luminancePass.fullscreenMaterial).toBe(pipeline.bloomKey);
    expect(pipeline.bloomKey).toBeInstanceOf(BloomKeyMaterial);
    expect(pipeline.bloomKey.threshold).toBe(DEFAULT_DIALS.bloomThreshold);
    expect(effects.at(-1)).toBeInstanceOf(OpaqueOutputEffect);
    // The ink and fog pass comes before, so the bloom reads their output with the key still in alpha.
    expect(pipeline.composer.passes.indexOf(last)).toBeGreaterThan(pipeline.composer.passes.findIndex((pass) => pass instanceof EffectPass));
  });

  it('moves the key threshold with the bloomThreshold dial', () => {
    const pipeline = build('high');
    // Off the default and inside the dial's range, so a dropped or cross-wired line fails.
    pipeline.applyDials({ ...DEFAULT_DIALS, bloomThreshold: 1.85, bloomIntensity: 0.9 }, VERDANT);
    expect(pipeline.bloomKey.threshold).toBe(1.85);
    const bloom = effectsOf(pipeline.composer.passes.at(-1) as EffectPass).find((effect) => effect instanceof BloomEffect) as BloomEffect;
    expect(bloom.intensity).toBe(0.9);
  });
});
