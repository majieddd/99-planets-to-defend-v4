import { BlendFunction, BloomEffect, EffectPass, NormalPass, RenderPass, type Effect, type Pass } from 'postprocessing';
import { Color, DepthTexture, FloatType, PerspectiveCamera, Scene, SRGBColorSpace, Texture, Vector2, Vector3, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIALS, NUMERIC_RANGES } from '../../../src/render/defaults';
import { LAYERS } from '../../../src/render/layers';
import { EMISSIVE_KEY_RANGE, EMISSIVE_PEAK } from '../../../src/render/materials/painted';
import { FogEffect } from '../../../src/render/post/fogEffect';
import { BLOOM_SMOOTHING, BloomKeyMaterial, createPipeline, KeyedBloomEffect, OpaqueOutputEffect, type Pipeline, type PipelineOptions } from '../../../src/render/post/pipeline';
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

function build(tier: TierName, camera = new PerspectiveCamera(50, 16 / 9, 0.1, 2500), extra: Partial<PipelineOptions> = {}): Pipeline {
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
    ...extra,
  });
}

// EffectPass keeps its effects, and NormalPass its target and the render pass that holds its camera, private in the
// typings; the wiring is what is under test.
const effectsOf = (pass: Pass): Effect[] => (pass as unknown as { effects: Effect[] }).effects;
const targetOf = (pass: Pass): WebGLRenderTarget => (pass as unknown as { renderTarget: WebGLRenderTarget }).renderTarget;
const cameraOf = (pass: Pass): PerspectiveCamera => (pass as unknown as { renderPass: { camera: PerspectiveCamera } }).renderPass.camera;
const bloomOf = (pipeline: Pipeline): KeyedBloomEffect =>
  effectsOf(pipeline.composer.passes.at(-1) as EffectPass).find((effect) => effect instanceof BloomEffect) as KeyedBloomEffect;

/** The key material's warm test, as the shader runs it, for the colours the palettes name (sRGB hex). */
function warmth(hex: string): number {
  const c = new Color(hex);
  const peak = Math.max(c.r, c.g, c.b, 1e-4);
  const smoothstep = (a: number, b: number, x: number): number => {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
  };
  return (c.r >= Math.max(c.g, c.b) ? 1 : 0) * (1 - smoothstep(0.2, 0.35, c.b / peak));
}

describe('bloom key material', () => {
  const dials = { bloomThreshold: 1.35, bloomIntensity: 0.55, heartHalo: 2.75 };

  it('feeds each emissive pixel its hue at unit brightness, masked by the emissive key, never by luminance', () => {
    const { fragmentShader } = new BloomKeyMaterial(dials);
    expect(fragmentShader).toContain('float mask = smoothstep(threshold, threshold + smoothing, texel.a * keyRange);');
    expect(fragmentShader).toContain('float peak = max(max(texel.r, texel.g), max(texel.b, 1e-4));');
    expect(fragmentShader).toContain('vec3 energy = texel.rgb / max(peak, EMISSIVE_PEAK);');
    expect(fragmentShader).toContain('gl_FragColor = vec4(energy * mask * mix(energyGain, heartGain, warm), 0.0);');
    expect(fragmentShader).not.toMatch(/luminance|0\.7152/);
  });

  it('divides by the painted cap, so a pixel wholly covered by capped energy feeds unit brightness', () => {
    const material = new BloomKeyMaterial(dials);
    // GLSL ES 3.0 has no implicit int to float conversion, so the define must be a float literal.
    expect(material.defines['EMISSIVE_PEAK']).toMatch(/^\d+\.\d+$/);
    expect(Number(material.defines['EMISSIVE_PEAK'])).toBe(EMISSIVE_PEAK);
  });

  it('gives warm hue, the heart and its economy, the heart halo, and every other energy the energy strength', () => {
    const { fragmentShader } = new BloomKeyMaterial(dials);
    expect(fragmentShader).toContain('float warm = step(max(texel.g, texel.b), texel.r) * (1.0 - smoothstep(0.2, 0.35, texel.b / peak));');
    // The palettes (blender/lib/palette.py): the heart's core, deep amber and inlay gold, against player cyan, Xeno
    // magenta and violet, and a warm white. The satellites' peach facet never reaches the threshold (key 0.66).
    for (const hex of ['#ffc36b', '#ff8a3d', '#ffc857']) expect(warmth(hex), hex).toBe(1);
    for (const hex of ['#59f2ff', '#ff3fa6', '#d84dff', '#ffffff', '#fff0dc']) expect(warmth(hex), hex).toBe(0);
  });

  it('decodes the key with the range the painted material encodes it in', () => {
    const material = new BloomKeyMaterial(dials);
    expect(material.uniforms['keyRange']!.value).toBe(EMISSIVE_KEY_RANGE);
    expect(material.uniforms['smoothing']!.value).toBe(BLOOM_SMOOTHING);
    // Every threshold the dial allows, plus the ramp, fits under the range an EffectPass keeps (alpha clamped to 1).
    expect(NUMERIC_RANGES.bloomThreshold[1] + BLOOM_SMOOTHING).toBeLessThanOrEqual(EMISSIVE_KEY_RANGE);
  });

  it('takes its three dials at creation and on a live move', () => {
    const created = new BloomKeyMaterial(dials);
    expect([created.uniforms['threshold']!.value, created.uniforms['energyGain']!.value, created.uniforms['heartGain']!.value]).toEqual([1.35, 0.55, 2.75]);
    const moved = new BloomKeyMaterial(DEFAULT_DIALS);
    moved.setDials(dials);
    expect([moved.uniforms['threshold']!.value, moved.uniforms['energyGain']!.value, moved.uniforms['heartGain']!.value]).toEqual([1.35, 0.55, 2.75]);
  });

  it('takes the frame through the setter LuminancePass.render uses, and the threshold both ways', () => {
    const material = new BloomKeyMaterial(DEFAULT_DIALS);
    const frame = new Texture();
    material.inputBuffer = frame;
    expect(material.uniforms['inputBuffer']!.value).toBe(frame);
    material.threshold = 2.2;
    expect(material.threshold).toBe(2.2);
    expect(material.uniforms['threshold']!.value).toBe(2.2);
  });
});

describe('keyed bloom effect', () => {
  const make = (): KeyedBloomEffect => new KeyedBloomEffect(new BloomKeyMaterial(DEFAULT_DIALS), { blendFunction: BlendFunction.ADD, levels: 8 });

  it('keeps its glow off the pixels that fed it, by the same key, threshold and ramp', () => {
    const shader = make().getFragmentShader();
    expect(shader).toContain('float emitter = smoothstep(threshold, threshold + smoothing, inputColor.a * keyRange);');
    expect(shader).toContain('outputColor = texture2D(map, uv) * intensity * (1.0 - emitter);');
  });

  it('shares the key material\'s threshold, ramp and range uniforms, so one dial move reaches the mask and the shield', () => {
    const bloom = make();
    for (const name of ['threshold', 'smoothing', 'keyRange']) expect(bloom.uniforms.get(name), name).toBe(bloom.key.uniforms[name]);
    bloom.key.threshold = 2.4;
    expect(bloom.uniforms.get('threshold')!.value).toBe(2.4);
  });

  it('reads its input through the key material and leaves the strength to it', () => {
    const bloom = make();
    expect(bloom.luminancePass.fullscreenMaterial).toBe(bloom.key);
    expect(bloom.intensity).toBe(1);
    expect(bloom.mipmapBlurPass.enabled).toBe(true);
    expect(bloom.mipmapBlurPass.levels).toBe(8);
  });

  it('declares every uniform it is given, and nothing else', () => {
    const bloom = make();
    // map is declared twice, once per precision branch.
    const declared = new Set([...bloom.getFragmentShader()!.matchAll(/^\s*uniform\s+(?:\w+\s+)?\w+\s+(\w+)\s*;/gm)].map((m) => m[1]));
    expect([...declared].sort()).toEqual([...bloom.uniforms.keys()].sort());
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
    const bloom = bloomOf(pipeline);
    expect(bloom).toBeInstanceOf(KeyedBloomEffect);
    expect(bloom.blendMode.blendFunction).toBe(BlendFunction.ADD);
    expect(bloom.luminancePass.fullscreenMaterial).toBe(pipeline.bloomKey);
    expect(pipeline.bloomKey).toBeInstanceOf(BloomKeyMaterial);
    expect(pipeline.bloomKey.threshold).toBe(DEFAULT_DIALS.bloomThreshold);
    expect(pipeline.bloomKey.uniforms['energyGain']!.value).toBe(DEFAULT_DIALS.bloomIntensity);
    expect(pipeline.bloomKey.uniforms['heartGain']!.value).toBe(DEFAULT_DIALS.heartHalo);
    expect(effects.at(-1)).toBeInstanceOf(OpaqueOutputEffect);
    // The ink and fog pass comes before, so the bloom reads their output with the key still in alpha.
    expect(pipeline.composer.passes.indexOf(last)).toBeGreaterThan(pipeline.composer.passes.findIndex((pass) => pass instanceof EffectPass));
  });

  it('gives each tier its own bloom depth', () => {
    for (const tier of ['high', 'medium', 'low'] as const) expect(bloomOf(build(tier)).mipmapBlurPass.levels).toBe(TIERS[tier].bloomLevels);
  });

  it('moves the threshold and both halo strengths with their dials', () => {
    const pipeline = build('high');
    // Off the defaults, inside the dials' ranges and apart from each other, so a dropped or cross-wired line fails.
    pipeline.applyDials({ ...DEFAULT_DIALS, bloomThreshold: 1.85, bloomIntensity: 0.9, heartHalo: 6.5 }, VERDANT);
    expect(pipeline.bloomKey.threshold).toBe(1.85);
    expect(pipeline.bloomKey.uniforms['energyGain']!.value).toBe(0.9);
    expect(pipeline.bloomKey.uniforms['heartGain']!.value).toBe(6.5);
    // The strengths live in the key material; the effect's own intensity would multiply them.
    expect(bloomOf(pipeline).intensity).toBe(1);
    expect(bloomOf(pipeline).uniforms.get('threshold')!.value).toBe(1.85);
  });

  it('hands the planet to the fog, and turns the fog\'s sunward warming with the sun', () => {
    const planet = { center: new Vector3(0, -160, 0), radius: 160 };
    const withPlanet = build('high', undefined, { planet });
    expect(withPlanet.fog).toBeInstanceOf(FogEffect);
    expect(withPlanet.fog.defines.get('FOG_PLANET')).toBe('1');
    expect((withPlanet.fog.uniforms.get('uPlanetCenter')!.value as Vector3).toArray()).toEqual([0, -160, 0]);
    expect(withPlanet.fog.uniforms.get('uPlanetRadius')!.value).toBe(160);
    expect(build('high').fog.defines.has('FOG_PLANET')).toBe(false);
    // Starts at the sun direction the options gave (0, 1, 0), so a dropped write fails.
    withPlanet.setSunDirection(new Vector3(3, 4, 0));
    expect((withPlanet.fog.uniforms.get('uSunDirection')!.value as Vector3).distanceTo(new Vector3(0.6, 0.8, 0))).toBeLessThan(1e-12);
  });
});
