import { DataTexture, DirectionalLight, NoColorSpace, PerspectiveCamera, RedFormat, RepeatWrapping, Scene, TextureLoader, Vector2, Vector3, type Texture, type WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { assetUrl, fetchManifest, type Manifest } from '../../render/assets/manifest';
import { loadAsset, type LoadedAsset, type MaterialContext } from '../../render/assets/loadAsset';
import { DEFAULT_DIALS, type RenderDials } from '../../render/defaults';
import { decodeDials, encodeDials } from '../../render/dialsCodec';
import { applyInkDials, createHullMaterial, createInkUniforms } from '../../render/ink/hull';
import { LAYERS } from '../../render/layers';
import { applyPaintDials, createPaintUniforms } from '../../render/materials/painted';
import { createPipeline, type Pipeline } from '../../render/post/pipeline';
import { detectTier, parseTier, TIERS, type TierName } from '../../render/quality';
import { createRenderer } from '../../render/renderer';
import { createPaintedSky } from '../../render/sky';
import { createStylePatch, STYLE_PLANET_RADIUS } from '../../render/terrain/stylePatch';
import { sunDirection, VERDANT } from '../../render/themes';
import { auditPixels, mutationProof } from './audit';
import { createDialsPanel, type LabState } from './dials';
import { placeholderAssets } from './placeholders';
import { mountReferenceBoard } from './referenceBoard';
import { applyPreset, buildStyleScene, PRESETS, type PresetName, type StyleAssets } from './scene';

const BASE = import.meta.env.BASE_URL;
const theme = VERDANT;

// start() fills these in, so a failure at any point can stop the loop and word the banner for when it happened.
let activeRenderer: WebGLRenderer | null = null;
let loopStarted = false;

/**
 * The one way out for a failure: the start catch, the animation loop and a tier switch all end here. three r186
 * requests the next frame before it calls the loop, so an exception in the loop was thrown again on every frame (about
 * 60 uncaught errors a second), never reached the banner, and before frame 3 left ready unset. Stopping the loop
 * first makes any failure one console error and one banner line.
 */
function fail(error: unknown): void {
  activeRenderer?.setAnimationLoop(null);
  console.error(error);
  const banner = document.getElementById('banner');
  if (banner) {
    banner.hidden = false;
    banner.textContent = `Style Lab ${loopStarted ? 'stopped' : 'failed to start'}: ${String(error)}`;
  }
}

function flat(value: number): Texture {
  const texture = new DataTexture(new Uint8Array([value]), 1, 1, RedFormat);
  texture.needsUpdate = true;
  return texture;
}

/**
 * The brush atlas and the ink noise are requested only when the manifest lists them. Until the asset track's first
 * build there is no public/assets, and GitHub Pages answers each missing file with a 404 that Chromium logs as a
 * console error (Vite's dev and preview servers hide this by answering with index.html), so the flat grey fallback
 * stands in without a request.
 */
function textureUrl(manifest: Manifest | null, name: string): string | null {
  const entry = manifest?.assets.find((asset) => asset.name === name && asset.kind === 'texture');
  return entry ? `${BASE}assets/${entry.file}` : null;
}

/**
 * Null when the manifest does not list the texture or its load failed, so the caller knows whether the real texture
 * arrived. A failed load used to hand back the flat grey without a word, and the sky, which checked only that the
 * manifest listed the atlas, took that grey and drew the solid slab described in start(). The warning names the
 * texture; it is a warning rather than an error because the lab still runs, and the browser tests fail on console
 * errors.
 */
async function loadTexture(manifest: Manifest | null, name: string): Promise<Texture | null> {
  const url = textureUrl(manifest, name);
  if (!url) return null;
  try {
    const texture = await new TextureLoader().loadAsync(url);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.colorSpace = NoColorSpace; // data, not colour
    return texture;
  } catch (error) {
    console.warn(`Style Lab: texture ${name} failed to load from ${url}; using the flat fallback`, error);
    return null;
  }
}

/**
 * GLTFLoader's errors need not name the model (a parse error names neither asset nor file), so a failed load reached
 * the banner and the console without saying which of the six it was. The manifest name and URL now travel with it.
 */
async function loadNamed(name: string, url: string, ctx: MaterialContext, blend: number): Promise<LoadedAsset> {
  try {
    return await loadAsset(url, ctx, blend);
  } catch (error) {
    throw new Error(`asset ${name} failed to load from ${url}: ${String(error)}`, { cause: error });
  }
}

async function loadStyleAssets(manifest: Manifest | null, ctx: MaterialContext): Promise<StyleAssets | null> {
  if (!manifest) return null;
  const urls = {
    bulwark: assetUrl(BASE, manifest, 'bulwark'),
    husk: assetUrl(BASE, manifest, 'husk'),
    bolt: assetUrl(BASE, manifest, 'bolt_sentinel'),
    heart: assetUrl(BASE, manifest, 'worldheart'),
    nest: assetUrl(BASE, manifest, 'nest'),
    kit: assetUrl(BASE, manifest, 'verdant_kit'),
  };
  if (Object.values(urls).some((url) => url === null)) return null;
  const [bulwark, husk, bolt, heart, nest, kit] = await Promise.all([
    loadNamed('bulwark', urls.bulwark as string, ctx, 0.35),
    loadNamed('husk', urls.husk as string, ctx, 0.3),
    loadNamed('bolt_sentinel', urls.bolt as string, ctx, 0.1),
    loadNamed('worldheart', urls.heart as string, ctx, 0.1),
    loadNamed('nest', urls.nest as string, ctx, 0.1),
    loadNamed('verdant_kit', urls.kit as string, ctx, 0.0),
  ]);
  return { bulwark, husk, bolt, heart, nest, kit };
}

/** A preset named in the URL must be one the scene knows: applyPreset threw on any other name and stopped the lab. */
function parsePreset(value: string | null): PresetName {
  return PRESETS.find((name) => name === value) ?? 'hero';
}

function readPixels(canvas: HTMLCanvasElement, width: number, height: number): Uint8ClampedArray {
  const small = document.createElement('canvas');
  small.width = width;
  small.height = height;
  const context = small.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  context.drawImage(canvas, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

async function start(): Promise<void> {
  const stage = document.getElementById('stage') as HTMLElement;
  const params = new URLSearchParams(location.search);
  const probe = document.createElement('canvas').getContext('webgl2');
  const state: LabState = {
    tier: parseTier(params.get('tier')) ?? (probe ? detectTier(probe, navigator.userAgent) : 'low'),
    preset: parsePreset(params.get('preset')),
    heartStage: 3,
    bulwark: 'cycle',
  };
  const dials: RenderDials = params.get('dials') ? decodeDials(params.get('dials') as string) : { ...DEFAULT_DIALS };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let tier = TIERS[state.tier];
  const renderer = createRenderer(stage, tier);
  activeRenderer = renderer;

  // One manifest read serves the textures and the models. A build without public/assets/manifest.json skips even
  // that read: GitHub Pages answered it with a 404 that Chromium logged as a console error on the live lab.
  const manifest = __HAS_ASSET_MANIFEST__ ? await fetchManifest(BASE) : null;
  const [brushAtlas, inkNoiseMap] = await Promise.all([loadTexture(manifest, 'brush_strokes'), loadTexture(manifest, 'ink_noise')]);
  const brush = brushAtlas ?? flat(128);
  const inkNoise = inkNoiseMap ?? flat(128);
  const paint = createPaintUniforms(theme, dials, brush);
  const inkUniforms = createInkUniforms(dials);
  const ctx: MaterialContext = { paint, hullMaterial: createHullMaterial(inkUniforms), hullLayer: LAYERS.hull };
  // The hull shader clamps every inked width to at least 1.2 px (uMinPx), so the ink width slider at 0 still drew
  // 1.2 px hulls. Hiding the one shared hull material is the slider's real off: on every dial change, and once here,
  // because a dials link can open the lab at 0.
  const syncHulls = (): void => {
    ctx.hullMaterial.visible = dials.inkWidthPx > 0;
  };
  syncHulls();

  const scene = new Scene();
  const camera = new PerspectiveCamera(50, stage.clientWidth / stage.clientHeight, 0.1, 2500);
  camera.layers.enable(LAYERS.hull);
  camera.layers.enable(LAYERS.sky);
  camera.layers.enable(LAYERS.noEdge); // grass and flowers: drawn, and cast shadows (r186 tests this camera's layers)

  const sunDir = new Vector3(...sunDirection(theme));
  const sun = new DirectionalLight(theme.sun.color, theme.sun.intensity);
  sun.position.copy(sunDir).multiplyScalar(90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(tier.shadowMapSize, tier.shadowMapSize);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 220 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.camera.layers.enable(LAYERS.noEdge); // flowers keep casting if a later three tests the shadow camera
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  // r186's PCF spreads five taps over shadow.radius texels and rotates them per pixel with screen-anchored noise. The
  // painted bands turned that faint dither into shadow, mid and lit speckle that crawled whenever the camera moved
  // (radius 3 measured 6.3 band changes per column across a straight shadow edge, against 2 for a clean edge). At 0
  // the taps coincide in one hardware-filtered lookup, the noise drops out and the edge stays clean.
  sun.shadow.radius = 0;
  scene.add(sun, sun.target);

  // Without the brush atlas the sky gets a black field, not the materials' grey: grey lifted the cloud band over its
  // threshold into one solid slab, lit or shadowed by sun side alone, which read as a pale vertical smear. At 0 no
  // cloud forms, leaving the painted gradient and sun glow until the atlas brings real cumulus. This keys on the atlas
  // having loaded, not on the manifest listing it, so a listed atlas that fails to load cannot bring the slab back.
  const skyBrush = brushAtlas ?? flat(0);
  // Anchored to the planet, the painted horizon sits on its limb; without the planet it is flat and floats well above
  // the limb seen from the patch.
  const sky = createPaintedSky(theme, skyBrush, sunDir, { center: new Vector3(0, -STYLE_PLANET_RADIUS, 0), radius: STYLE_PLANET_RADIUS });
  scene.add(sky.mesh);
  const patch = createStylePatch(theme, paint, tier.terrainSegments);
  scene.add(patch.mesh, patch.lowPlanet);

  const loaded = await loadStyleAssets(manifest, ctx);
  const banner = document.getElementById('banner') as HTMLElement;
  if (!loaded) {
    banner.hidden = false;
    banner.textContent = 'Placeholders: M0c assets are not built yet (npm run assets).';
  }
  const style = buildStyleScene(patch, loaded ?? placeholderAssets(ctx), ctx, tier.scatterScale);
  scene.add(style.root);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  // Past about 1 km the depth buffer can no longer keep the patch edge in front of the low planet 2 cm beneath it,
  // and the two fight; 400 m still frames the whole planet. There is no polar clamp on purpose: the horizon preset
  // looks slightly upward, and a clamp would move its camera.
  controls.maxDistance = 400;
  applyPreset(style, state.preset, camera, controls.target);

  let pipeline: Pipeline = createPipeline({ renderer, scene, camera, tier, dials, theme, inkNoise, sunDirection: sunDir, reducedMotion });
  const drawing = new Vector2();

  function resize(): void {
    camera.aspect = stage.clientWidth / stage.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    pipeline.setSize(stage.clientWidth, stage.clientHeight);
    renderer.getDrawingBufferSize(drawing);
    inkUniforms.uResolution.value.copy(drawing);
  }
  window.addEventListener('resize', resize);
  resize();

  function applyDials(): void {
    applyPaintDials(paint, dials, theme);
    applyInkDials(inkUniforms, dials);
    syncHulls();
    pipeline.applyDials(dials, theme);
  }

  function setTier(name: TierName): void {
    try {
      const next = TIERS[name];
      // Built before anything changes and before the old pipeline is disposed. Disposed first, a throw in
      // createPipeline left pipeline pointing at the disposed composer, which draws nothing, so the canvas froze
      // without a word.
      const nextPipeline = createPipeline({ renderer, scene, camera, tier: next, dials, theme, inkNoise, sunDirection: sunDir, reducedMotion });
      tier = next;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.pixelRatioMax));
      sun.shadow.mapSize.set(tier.shadowMapSize, tier.shadowMapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      pipeline.dispose();
      pipeline = nextPipeline;
      resize();
    } catch (error) {
      fail(error);
    }
  }

  const auditBox = document.getElementById('audit') as HTMLElement;
  function runAudit() {
    const pixels = readPixels(renderer.domElement, 192, 108);
    const report = auditPixels(pixels, theme.bands);
    const mutation = mutationProof(pixels, theme.bands);
    const shares = Object.entries(report.bandShares).map(([name, share]) => `${name} ${(share * 100).toFixed(0)}%`).join(', ');
    auditBox.textContent =
      `Colour audit (${theme.name}): ${report.verdict.toUpperCase()}\n` +
      `concentration ${report.concentration.toFixed(2)} x chance (gate 1.5), colour share ${(report.chromaticShare * 100).toFixed(0)}%\n` +
      `${shares}\n` +
      `mutation proof: hue rotated ${mutation.rotation} degrees, audit ${mutation.report.verdict} (${mutation.rejected ? 'can reject' : 'CANNOT REJECT'})`;
    return { report, mutation };
  }

  createDialsPanel(dials, state, {
    onDials: applyDials,
    onTier: setTier,
    onPreset: (preset) => applyPreset(style, preset, camera, controls.target),
    onHeartStage: (level) => style.setHeartStage(level),
    onBulwark: (mode) => style.setBulwarkMode(mode),
    audit: runAudit,
    copyDials: () => {
      const url = `${location.origin}${location.pathname}?dials=${encodeDials(dials)}`;
      const show = (copied: boolean) => {
        auditBox.textContent = `${copied ? 'Dials link copied' : 'Copy this dials link'}:\n${url}`;
      };
      // writeText rejects when the page lacks focus or permission, and plain http away from localhost has no
      // clipboard at all. Unhandled, the rejection was an uncaught page error (headless Chromium, after a click:
      // "NotAllowedError: ... Write permission denied"), which fails any browser test that presses the button, and the
      // box claimed a copy that never happened; it now shows the link to copy by hand.
      if (!navigator.clipboard) {
        show(false);
        return;
      }
      navigator.clipboard.writeText(url).then(
        () => show(true),
        () => show(false),
      );
    },
    reset: () => {
      Object.assign(dials, DEFAULT_DIALS);
      applyDials();
    },
    screenshot: () => {
      const link = document.createElement('a');
      link.download = `style-lab-${state.preset}.png`;
      link.href = renderer.domElement.toDataURL('image/png');
      link.click();
    },
  });
  mountReferenceBoard(document.getElementById('board') as HTMLElement, theme);

  const fpsBox = document.getElementById('fps') as HTMLElement;
  let last = performance.now();
  let frames = 0;
  let frameMs = 16.7;
  window.__P99__ = {
    ready: false,
    page: 'style',
    tier: state.tier,
    assets: loaded !== null,
    audit: runAudit,
    preset: (name: PresetName) => applyPreset(style, name, camera, controls.target),
    frameMs: () => frameMs,
  };
  loopStarted = true;
  renderer.setAnimationLoop(() => {
    try {
      const now = performance.now();
      const interval = now - last;
      last = now;
      // Only the simulation step is clamped, so a stall does not jump the scene. The reading averaged that clamped
      // step, which capped it at 50 ms, so a slow GPU or a CI runner under-reported its frame interval.
      const dt = Math.min(interval / 1000, 1 / 20);
      frameMs = frameMs * 0.95 + interval * 0.05;
      style.update(dt);
      controls.update();
      sky.follow(camera);
      pipeline.render(dt);
      frames += 1;
      // This is the time between frames, which under vsync is the display's refresh interval (16.7 ms at 60 Hz), not
      // the render cost: uncapped, the high tier measured about 1.2 ms. Shown as a bare "ms", it read as the cost.
      if (frames % 30 === 0) fpsBox.textContent = `${tier.name} tier, frame interval ${frameMs.toFixed(1)} ms`;
      if (frames === 3 && window.__P99__) window.__P99__.ready = true;
    } catch (error) {
      fail(error);
    }
  });
}

start().catch(fail);
