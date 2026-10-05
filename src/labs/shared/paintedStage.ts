import { PerspectiveCamera, Scene, Vector2, Vector3, type WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { MaterialContext } from '../../render/assets/loadAsset';
import type { Manifest } from '../../render/assets/manifest';
import type { RenderDials } from '../../render/defaults';
import { createHullMaterial, createInkUniforms, type InkUniforms } from '../../render/ink/hull';
import { LAYERS } from '../../render/layers';
import { createPaintUniforms } from '../../render/materials/painted';
import { createPipeline, type Pipeline } from '../../render/post/pipeline';
import { detectTier, parseTier, TIERS, type Tier, type TierName } from '../../render/quality';
import { createRenderer } from '../../render/renderer';
import { createPaintedSky, type PaintedSky } from '../../render/sky';
import { createStylePatch, STYLE_PLANET_RADIUS, type StylePatch } from '../../render/terrain/stylePatch';
import type { Theme } from '../../render/themes';
import { createWorldSun, type WorldSun } from '../world/sun';
import { flatTexture, loadManifestTexture } from './labAssets';

/**
 * The longest step a frame moves the scene, in seconds: a stall (a tab in the background, a debugger) moves it one 1/20 s
 * step rather than jumping it, while the frame interval the pages show keeps the real one (the Style Lab's rule).
 */
export const MAX_FRAME_STEP = 1 / 20;

/** The scene's step for a frame `intervalMs` long: clamped to MAX_FRAME_STEP, and 0 while the lab is frozen. */
export function frameStep(intervalMs: number, frozen: boolean): number {
  return frozen ? 0 : Math.min(intervalMs / 1000, MAX_FRAME_STEP);
}

/** The lens of the Asset World and the combat arena, in degrees: the Style Lab's 50 degrees, from 0.1 to 2500 m. */
export const WORLD_FOV_DEG = 50;

/**
 * The quality tier a page opens on: the address's `?tier=`, or the one the GPU suggests. The WebGL2 context made to ask
 * the GPU is released once it has answered: it was left to the garbage collector, holding one of the few contexts a
 * browser allows a page, beside the renderer's own. It is released in a `finally`, so a detection that throws (an odd
 * driver string) still lets it go, where the release used to be skipped along with the rest.
 */
export function pickTier(param: string | null): TierName {
  const parsed = parseTier(param);
  if (parsed) return parsed;
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) return 'low';
  try {
    return detectTier(probe, navigator.userAgent);
  } finally {
    probe.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

export interface PaintedStageOptions {
  tier: TierName;
  dials: RenderDials;
  theme: Theme;
  /** The page's name, which a texture that fails to load is reported under. */
  page: string;
  manifest: Manifest | null;
}

/**
 * The painted patch of planet, its sun, sky and fog in the locked look, the camera and its orbit, and the post pipeline:
 * what the Asset World and the combat arena both stand their models on. The pages read `pipeline` and `tier` afresh
 * each time, since setTier replaces them.
 */
export interface PaintedStage {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  /**
   * Where player energy goes (the sword trail, the hit sparks), each piece on LAYERS.energy: the pipeline draws this
   * scene over the inked, fogged frame, before the bloom (render/post/energyPass.ts), so no ink line or fog lands on it.
   * It outlives a tier change, which rebuilds the pipeline around the same scene.
   */
  readonly energy: Scene;
  readonly camera: PerspectiveCamera;
  /** The painted and hull materials' shared context, which every loaded model is painted and inked with. */
  readonly ctx: MaterialContext;
  readonly inkUniforms: InkUniforms;
  readonly sun: WorldSun;
  readonly sky: PaintedSky;
  readonly patch: StylePatch;
  readonly planet: { center: Vector3; radius: number };
  readonly controls: OrbitControls;
  readonly pipeline: Pipeline;
  readonly tier: Tier;
  /** Fits the camera, the renderer, the pipeline and the ink's resolution to the stage's size. */
  resize(): void;
  /**
   * Rebuilds the pipeline for another tier; throws, leaving the working pipeline in place, if the new one fails. The page
   * resizes after it, since a page's resize may do more than the stage's (the Asset World refits its view).
   */
  setTier(name: TierName): void;
  /** Shows or hides the hull ink by the dials' ink width. */
  syncHulls(): void;
  /** Everything that reads the sun, after the dials moved it: the light, the sky and the fog's sunward warming. */
  syncSun(): void;
}

/**
 * Builds the painted stage in `stage` (the page's canvas holder). The brush atlas and the ink noise come from the
 * manifest when it lists them, each with its flat stand-in otherwise.
 */
export async function createPaintedStage(stage: HTMLElement, options: PaintedStageOptions): Promise<PaintedStage> {
  const { dials, theme, page, manifest } = options;
  const base = import.meta.env.BASE_URL;
  let tier = TIERS[options.tier];
  const renderer = createRenderer(stage, tier);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const [brushAtlas, inkNoiseMap] = await Promise.all([loadManifestTexture(base, manifest, 'brush_strokes', page), loadManifestTexture(base, manifest, 'ink_noise', page)]);
  const paint = createPaintUniforms(theme, dials, brushAtlas ?? flatTexture(128));
  const inkUniforms = createInkUniforms(dials);
  const ctx: MaterialContext = { paint, hullMaterial: createHullMaterial(inkUniforms), hullLayer: LAYERS.hull };
  // As in the Style Lab, the ink width dial's 0 hides the shared hull material, because the shader's floor would still
  // draw 1.2 px hulls.
  const syncHulls = (): void => {
    ctx.hullMaterial.visible = dials.inkWidthPx > 0;
  };
  syncHulls();

  const scene = new Scene();
  const energy = new Scene();
  energy.name = 'energy';
  const camera = new PerspectiveCamera(WORLD_FOV_DEG, stage.clientWidth / stage.clientHeight, 0.1, 2500);
  camera.layers.enable(LAYERS.hull);
  camera.layers.enable(LAYERS.sky);
  camera.layers.enable(LAYERS.noEdge); // grass and flowers: drawn, and cast shadows (r186 tests this camera's layers)

  const sun = createWorldSun(theme, dials, tier);
  scene.add(sun.light, sun.light.target);
  // Without the brush atlas the sky takes a black field, not grey, which would lift its cloud band into a slab (Style Lab).
  const planet = { center: new Vector3(0, -STYLE_PLANET_RADIUS, 0), radius: STYLE_PLANET_RADIUS };
  const sky = createPaintedSky(theme, brushAtlas ?? flatTexture(0), sun.direction, planet);
  scene.add(sky.mesh);
  const patch = createStylePatch(theme, paint, tier.terrainSegments);
  scene.add(patch.mesh, patch.lowPlanet);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  // As in the Style Lab: past about 1 km the depth buffer cannot keep the patch in front of the low planet under it.
  controls.maxDistance = 400;

  const inkNoise = inkNoiseMap ?? flatTexture(128);
  const makePipeline = (next: Tier): Pipeline => createPipeline({ renderer, scene, camera, tier: next, dials, theme, inkNoise, sunDirection: sun.direction, reducedMotion, planet, energy });
  let pipeline = makePipeline(tier);
  const drawing = new Vector2();

  // Run once here too, because the sky starts from the theme's sun colour, which the locked defaults already override,
  // and createWorldSun leaves the light's position to the first sync.
  const syncSun = (): void => {
    sun.sync(dials);
    sky.setSun(sun.direction, dials.sunColor);
    pipeline.setSunDirection(sun.direction);
  };
  syncSun();

  const resize = (): void => {
    const widthPx = stage.clientWidth;
    const heightPx = stage.clientHeight;
    camera.aspect = widthPx / heightPx;
    camera.updateProjectionMatrix();
    renderer.setSize(widthPx, heightPx);
    pipeline.setSize(widthPx, heightPx);
    renderer.getDrawingBufferSize(drawing);
    inkUniforms.uResolution.value.copy(drawing);
  };

  return {
    renderer,
    scene,
    energy,
    camera,
    ctx,
    inkUniforms,
    sun,
    sky,
    patch,
    planet,
    controls,
    get pipeline() {
      return pipeline;
    },
    get tier() {
      return tier;
    },
    resize,
    setTier(name) {
      const next = TIERS[name];
      // Built before anything changes, so a throw leaves the working pipeline in place (see the Style Lab).
      const nextPipeline = makePipeline(next);
      tier = next;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.pixelRatioMax));
      sun.setTier(tier);
      pipeline.dispose();
      pipeline = nextPipeline;
    },
    syncHulls,
    syncSun,
  };
}
