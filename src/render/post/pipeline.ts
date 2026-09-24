import { BlendFunction, BloomEffect, EffectComposer, EffectPass, NormalPass, RenderPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { HalfFloatType, type PerspectiveCamera, type Scene, type Texture, type Vector3, type WebGLRenderer } from 'three';
import type { RenderDials } from '../defaults';
import { LAYERS } from '../layers';
import type { Tier } from '../quality';
import type { Theme } from '../themes';
import { FinishEffect } from './finishEffect';
import { FogEffect } from './fogEffect';
import { GradeEffect } from './gradeEffect';
import { InkEdgeEffect } from './inkEdgeEffect';

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
  render(deltaSeconds: number): void;
  setSize(width: number, height: number): void;
  applyDials(dials: RenderDials, theme: Theme): void;
  dispose(): void;
}

/**
 * Scene, then (high and medium tiers) normals for the edge ink, then ink and fog, then bloom, grade, AgX
 * tone mapping and the finish. The normal pass has its own camera limited to the world layer, so hulls
 * and the sky never produce edges of their own. The camera must not be parented, because the normal camera
 * copies its local transform only and would draw the normals from the wrong place.
 */
export function createPipeline(o: PipelineOptions): Pipeline {
  const composer = new EffectComposer(o.renderer, { frameBufferType: HalfFloatType, multisampling: o.tier.msaa });
  composer.addPass(new RenderPass(o.scene, o.camera));
  let normalCamera: PerspectiveCamera | null = null;
  let ink: InkEdgeEffect | null = null;
  if (o.tier.edgeInk) {
    normalCamera = o.camera.clone();
    const normalPass = new NormalPass(o.scene, normalCamera, { resolutionScale: o.tier.normalScale });
    composer.addPass(normalPass);
    ink = new InkEdgeEffect(o.camera, normalPass.texture, o.inkNoise, o.dials);
  }
  const fog = new FogEffect(o.camera, o.theme, o.sunDirection, o.dials);
  composer.addPass(new EffectPass(o.camera, ...(ink ? [ink, fog] : [fog])));
  const bloom = new BloomEffect({
    // The default SCREEN blend adds only src * (1 - dst) and dims anything brighter than 1, so the energy cores,
    // the only things meant to glow, sank under their own glow and the halo over bright ground was about halved.
    blendFunction: BlendFunction.ADD,
    luminanceThreshold: o.dials.bloomThreshold,
    luminanceSmoothing: 0.25,
    intensity: o.dials.bloomIntensity,
    mipmapBlur: true,
    levels: o.tier.bloomLevels,
  });
  const grade = new GradeEffect(o.theme, o.dials);
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
  const finish = new FinishEffect(o.dials, o.reducedMotion);
  composer.addPass(new EffectPass(o.camera, bloom, grade, tone, finish));

  return {
    composer,
    ink,
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
      bloom.luminanceMaterial.threshold = dials.bloomThreshold;
      grade.setDials(dials, theme);
      finish.setDials(dials);
    },
    dispose() {
      composer.dispose();
    },
  };
}
