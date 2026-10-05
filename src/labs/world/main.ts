import { PerspectiveCamera, Scene, Vector2, Vector3, type WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { standardBlendFor } from '../../render/assets/familyBlend';
import type { LoadedAsset, MaterialContext } from '../../render/assets/loadAsset';
import { assetUrl, fetchManifest, type Manifest } from '../../render/assets/manifest';
import { DEFAULT_DIALS, type RenderDials } from '../../render/defaults';
import { acceptDial, decodeDials, encodeDials, type SetDialsResult } from '../../render/dialsCodec';
import { applyInkDials, createHullMaterial, createInkUniforms } from '../../render/ink/hull';
import { LAYERS } from '../../render/layers';
import { applyPaintDials, createPaintUniforms } from '../../render/materials/painted';
import { createPipeline, type Pipeline } from '../../render/post/pipeline';
import { detectTier, parseTier, TIERS, type TierName } from '../../render/quality';
import { createRenderer } from '../../render/renderer';
import { createPaintedSky } from '../../render/sky';
import { createStylePatch, STYLE_PLANET_RADIUS } from '../../render/terrain/stylePatch';
import { VERDANT } from '../../render/themes';
import { FACE_SEED, type FacePose } from '../shared/commanderFace';
import { flatTexture, loadManifestTexture, loadNamedAsset } from '../shared/labAssets';
import { NARROW_SCREEN } from '../style/referenceBoard';
import { WorldLabels, type LabelSpec } from './labels';
import { buildAssetWorld, type AssetWorld } from './layout';
import { createWorldPanel, type WorldPanelState } from './panel';
import { createPipPlay } from './play';
import { createPlayInput } from './playInput';
import { coverageGaps, MEMBERS, showableMembers } from './registry';
import { createWorldSun } from './sun';
import {
  frameView,
  isViewName,
  labelRule,
  labelSpecs,
  memberLabelAnchor,
  OVERVIEW,
  registryOverview,
  resolveAddress,
  styleLabQuery,
  type OpenView,
  type ViewPose,
} from './views';

const BASE = import.meta.env.BASE_URL;
const theme = VERDANT;
const PAGE = 'Asset World';
/** One turn of the turntable around the current view, in seconds: slow enough to study a silhouette as it turns. */
const TURNTABLE_SECONDS = 40;
/** How long a view chosen in the panel takes to arrive, in seconds; reduced motion and the test handle jump at once. */
const TRANSITION_SECONDS = 0.8;
/** The one value `?play=` takes: Pip under the keys (the play prototype). */
const PLAY_PIP = 'pip';
/** The play hint's words, mechanics first: the keys and a click on a keyboard, the pad and the button on a touch screen. */
const PLAY_HINT_KEYS = 'Play Pip (prototype): WASD or the arrow keys move him, Shift sprints, F or a click swings his sword, drag to orbit, wheel to zoom.';
const PLAY_HINT_TOUCH =
  'Play Pip (prototype): the pad moves him, pushed to its rim he sprints; Attack swings his sword; drag elsewhere to orbit, pinch to zoom.';

// start() fills these in, so a failure at any point can stop the loop and word the banner for when it happened.
let activeRenderer: WebGLRenderer | null = null;
let loopStarted = false;

/** The one way out for a failure, as in the Style Lab: stop the loop first, so a failure is one error and one banner. */
function fail(error: unknown): void {
  activeRenderer?.setAnimationLoop(null);
  console.error(error);
  showBanner(`${PAGE} ${loopStarted ? 'stopped' : 'failed to start'}: ${String(error)}`);
}

function showBanner(text: string): void {
  const banner = document.getElementById('banner');
  if (!banner) return;
  banner.hidden = false;
  banner.textContent = banner.textContent && banner.textContent !== text ? `${banner.textContent}\n${text}` : text;
}

/** Each manifest model a member comes from, loaded once with its family's standard blend. */
async function loadEntries(manifest: Manifest, ctx: MaterialContext): Promise<Map<string, LoadedAsset>> {
  const names = [...new Set(MEMBERS.map((m) => m.entry))];
  const loaded = await Promise.all(
    names.map(async (name): Promise<[string, LoadedAsset] | null> => {
      const entry = manifest.assets.find((asset) => asset.name === name && asset.kind === 'model');
      const url = assetUrl(BASE, manifest, name);
      if (!entry || !url) return null;
      return [name, await loadNamedAsset(name, url, ctx, standardBlendFor(entry.family))];
    }),
  );
  return new Map(loaded.filter((pair): pair is [string, LoadedAsset] => pair !== null));
}

function liveHeartText(level: number): string {
  return `Stage ${level} (slider)`;
}

/** How the banner and the console name the view an address fell back to. */
function describeView(open: OpenView): string {
  if (open.member) return `the member ${open.member}`;
  return open.view === OVERVIEW ? 'the overview' : `the ${open.view} view`;
}

async function start(): Promise<void> {
  const stage = document.getElementById('stage') as HTMLElement;
  const params = new URLSearchParams(location.search);
  const probe = document.createElement('canvas').getContext('webgl2');
  const linked = params.get('dials');
  // The locked Painted-Anime-Inkline 4.0 defaults, which the Style Lab opens on too, unless the address carries a dials
  // link, whose dials apply over those defaults exactly as the Style Lab applies the same link, so a look tuned there
  // opens here unchanged. The page opened in its own copy of preset B3 while the style gate was open, built as B3's
  // changes over DEFAULT_DIALS; once the lock moved DEFAULT_DIALS that copy silently became neither B3 nor the locked
  // look (the locked edge fade with B3's edge ink and lit saturation), so the page now reads the one locked set.
  const dials: RenderDials = linked ? decodeDials(linked) : { ...DEFAULT_DIALS };
  // Named for what the dials are, not for whether the address has a link: both pages' buttons always write one, and a
  // link that moves no dial opens the locked look. Read afresh each time, because the test handle moves dials too.
  const lookKind = (): 'locked' | 'link' => ((Object.keys(DEFAULT_DIALS) as (keyof RenderDials)[]).every((key) => dials[key] === DEFAULT_DIALS[key]) ? 'locked' : 'link');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state: WorldPanelState = {
    view: OVERVIEW,
    member: '',
    turntable: false,
    labels: true,
    heartLevel: 0,
    speed: 1,
    paused: false,
    tier: parseTier(params.get('tier')) ?? (probe ? detectTier(probe, navigator.userAgent) : 'low'),
    play: false,
  };
  let tier = TIERS[state.tier];
  const renderer = createRenderer(stage, tier);
  activeRenderer = renderer;

  const look = document.getElementById('look') as HTMLButtonElement;
  const lookName = look.querySelector('.look-name') as HTMLElement;
  const syncLook = (): void => {
    lookName.textContent = lookKind() === 'locked' ? 'Look: Painted-Anime-Inkline 4.0 (locked)' : 'Look: a dials link over the locked defaults';
  };
  syncLook();
  // On a phone the note starts closed behind the chip's first line, and a tap opens or closes it. On a wider screen the
  // note always shows and the chip is no toggle: a click there used to hide the note for good, since nothing reopened
  // it, and turning a phone past the line kept the other width's state. Crossing the line starts that width afresh.
  // On a wider screen the chip also leaves the tab order, where it was a stop on a button that did nothing when pressed.
  const narrow = matchMedia(NARROW_SCREEN);
  const syncLookOpen = (): void => {
    if (narrow.matches) look.setAttribute('aria-expanded', 'false');
    else look.removeAttribute('aria-expanded');
    look.tabIndex = narrow.matches ? 0 : -1;
  };
  syncLookOpen();
  narrow.addEventListener('change', syncLookOpen);
  look.addEventListener('click', () => {
    if (narrow.matches) look.setAttribute('aria-expanded', String(look.getAttribute('aria-expanded') !== 'true'));
  });

  // One manifest read serves the textures and the models; a build without one skips even that (see the Style Lab).
  const manifest = __HAS_ASSET_MANIFEST__ ? await fetchManifest(BASE) : null;
  const [brushAtlas, inkNoiseMap] = await Promise.all([
    loadManifestTexture(BASE, manifest, 'brush_strokes', PAGE),
    loadManifestTexture(BASE, manifest, 'ink_noise', PAGE),
  ]);
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
  const camera = new PerspectiveCamera(50, stage.clientWidth / stage.clientHeight, 0.1, 2500);
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

  // Every manifest entry must have a place or a reason, which the unit test holds; a page built from a manifest that
  // outran the registry still opens, places what it knows, and names what it left out.
  const gaps = manifest ? coverageGaps(manifest) : [];
  for (const gap of gaps) console.warn(`${PAGE}: ${gap}`);
  if (gaps.length) showBanner(`Not in the Asset World yet: ${gaps.join('; ')}`);
  const assets = manifest ? await loadEntries(manifest, ctx) : new Map<string, LoadedAsset>();
  if (!manifest) showBanner('The Asset World needs the built assets (npm run assets); none were found.');
  // Before the world is built: the play prototype keeps a copy of Pip's rig in the bind pose, which the world's mixers
  // would otherwise have posed by the time it is copied. He goes in the scene, not the world's root, so the world's
  // members, bounds and labels stay exactly what they are with play off.
  const pipPlay = createPipPlay(assets, patch, scene, ctx.hullMaterial, STYLE_PLANET_RADIUS);
  // A member whose model or clip this build lacks is left out rather than built, where a member put in ahead of its clip
  // would stop the page with "has no clip". The coverage gaps above, read from the manifest, name most such members;
  // one the loaded GLBs drop that the manifest does not (a GLB rebuilt without a clip the manifest lists) is named here.
  const loadedClips = new Map([...assets].map(([name, asset]) => [name, asset.animations.map((clip) => clip.name)] as const));
  const { shown, unnamed } = showableMembers(loadedClips, gaps);
  if (manifest) {
    for (const line of unnamed) console.warn(`${PAGE}: ${line}`);
    if (unnamed.length) showBanner(`Left out of the Asset World: ${unnamed.join('; ')}`);
  }
  const world: AssetWorld = buildAssetWorld(patch, assets, ctx, shown);
  scene.add(world.root);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  // As in the Style Lab: past about 1 km the depth buffer cannot keep the patch in front of the low planet under it.
  controls.maxDistance = 400;
  // OrbitControls turns autoRotateSpeed * 2 pi / 60 radians per second when update() is given the frame's seconds.
  controls.autoRotateSpeed = 60 / TURNTABLE_SECONDS;

  const inkNoise = inkNoiseMap ?? flatTexture(128);
  let pipeline: Pipeline = createPipeline({ renderer, scene, camera, tier, dials, theme, inkNoise, sunDirection: sun.direction, reducedMotion, planet });
  const drawing = new Vector2();

  // Everything that reads the sun, as in the Style Lab: the light, the sky and the fog's sunward warming. Run once here
  // too, because the sky starts from the theme's sun colour, which the locked defaults already override, and
  // createWorldSun leaves the light's position to the first sync.
  function syncSun(): void {
    sun.sync(dials);
    sky.setSun(sun.direction, dials.sunColor);
    pipeline.setSunDirection(sun.direction);
  }
  syncSun();

  // Labels: a placard under each family's zone, and a label over each member, except a family's only member.
  const labels = new WorldLabels(document.getElementById('labels') as HTMLElement);
  for (const spec of labelSpecs(world.members, patch)) labels.add(spec);
  // The same objects the labels carry, so the fits read an anchor the slider moved.
  const specs = labels.specs();
  const liveHeart = world.members.find((entry) => entry.member.heartStage === 'live');
  state.heartLevel = world.heartLevel();
  if (liveHeart) labels.setText(liveHeart.member.name, liveHeartText(state.heartLevel));

  // The canvas size, read on resize rather than in every frame.
  let widthPx = stage.clientWidth;
  let heightPx = stage.clientHeight;
  const current = (): OpenView => ({ view: state.view, member: state.member });
  // The label rule is resolved when what it depends on changes, so the frame loop only calls it.
  const ruleFor = { view: '', member: '', labels: false, widthPx: -1 };
  let shows: (spec: LabelSpec) => boolean = () => false;
  function labelShows(): (spec: LabelSpec) => boolean {
    if (ruleFor.view !== state.view || ruleFor.member !== state.member || ruleFor.labels !== state.labels || ruleFor.widthPx !== widthPx) {
      Object.assign(ruleFor, { view: state.view, member: state.member, labels: state.labels, widthPx });
      shows = labelRule(current(), world.members, { labels: state.labels, widthPx });
    }
    return shows;
  }

  // Views. The test handle and the address jump; the panel glides, unless the viewer asked for reduced motion.
  let transition: { from: ViewPose; to: ViewPose; elapsed: number } | null = null;
  let userMoved = false;
  const focusKey = (): string => state.member || state.view;
  function jumpTo(pose: ViewPose): void {
    transition = null;
    camera.position.copy(pose.position);
    controls.target.copy(pose.target);
    camera.lookAt(pose.target);
  }
  /**
   * Fits the open view (frameView in views.ts, which the unit test drives), or, when it frames no member because the
   * assets did not load, the registry's overview, so the camera never stays at the origin inside the ground.
   */
  function applyFocus(animate: boolean): void {
    // While Pip plays the camera follows him: a resize or the slider heart must not glide it off to a view.
    if (pipPlay.active) return;
    const lens = { fov: camera.fov, aspect: camera.aspect, heightPx };
    const pose = frameView(current(), world.members, specs, { labels: state.labels, widthPx }, lens) ?? registryOverview(patch, lens);
    userMoved = false;
    labels.focus(state.member || null);
    if (animate && !reducedMotion) transition = { from: { position: camera.position.clone(), target: controls.target.clone() }, to: pose, elapsed: 0 };
    else jumpTo(pose);
  }
  /** Keeps the address on the open view, so the bar always holds a link to it (the inspection-view law). */
  function syncAddress(): void {
    const next = new URLSearchParams(location.search);
    next.delete('family');
    next.delete('member');
    if (state.member) next.set('member', state.member);
    else if (state.view !== OVERVIEW) next.set('family', state.view);
    next.delete('play');
    if (state.play) next.set('play', PLAY_PIP);
    const query = next.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
  }
  function openView(view: OpenView): void {
    state.view = view.view;
    state.member = view.member;
    panel.refresh();
    applyFocus(false);
    syncAddress();
  }
  /** The test handle's way in: opens a view or a member by name, and is false for a name that is neither. */
  function focus(name: string): boolean {
    const member = MEMBERS.find((m) => m.name === name);
    if (member) openView({ view: member.zone, member: member.name });
    else if (isViewName(name)) openView({ view: name, member: '' });
    else return false;
    return true;
  }
  // The play prototype: Pip out on the patch under the keys or the thumb pad, the camera following him.
  const playHint = document.getElementById('play-hint') as HTMLElement;
  const pad = document.getElementById('pad') as HTMLElement;
  const attackButton = document.getElementById('attack') as HTMLElement;
  const input = createPlayInput(pad, pad.querySelector('.pad-knob') as HTMLElement, attackButton, renderer.domElement);
  const coarse = matchMedia('(pointer: coarse)');
  function syncPlayUi(): void {
    const touch = coarse.matches;
    playHint.hidden = !state.play;
    playHint.textContent = touch ? PLAY_HINT_TOUCH : PLAY_HINT_KEYS;
    // The attack button rides with the pad: shown only while playing on a coarse pointer, where F and a click are not.
    pad.hidden = !(state.play && touch);
    attackButton.hidden = pad.hidden;
    document.body.classList.toggle('pad-shown', !pad.hidden);
  }
  coarse.addEventListener('change', syncPlayUi);
  // The turntable as the viewer had it before he came out: play turns it off, and leaving play used to leave it off.
  let turntableBeforePlay = state.turntable;
  /** Puts Pip out to play or brings him in, and is false when the page has no Pip to play. */
  function setPlay(on: boolean): boolean {
    if (on && !pipPlay.available) {
      state.play = false;
      panel.refresh();
      showBanner('Play Pip needs Pip (commander) and his idle and run clips, which this build does not have.');
      return false;
    }
    if (on !== pipPlay.active) {
      if (on) {
        transition = null;
        turntableBeforePlay = state.turntable;
        state.turntable = false;
        // Each face on the page blinks on its own seed, and his follows the world's (FACE_SEED).
        pipPlay.enter(camera, controls, world.members, FACE_SEED + world.faces().length, frozen);
      } else {
        pipPlay.exit(controls);
        // The panel's refresh below shows the restored value.
        state.turntable = turntableBeforePlay;
        state.view = OVERVIEW;
        state.member = '';
      }
    }
    state.play = on;
    input.setActive(on);
    panel.refresh();
    syncPlayUi();
    // Leaving play glides back to the overview, which applyFocus skips while he plays.
    if (!on) applyFocus(true);
    syncAddress();
    return true;
  }
  controls.addEventListener('start', () => {
    // A drag takes the camera from a gliding view, and a resize then leaves the viewer's framing alone.
    transition = null;
    userMoved = true;
  });

  function setHeartLevel(level: number): void {
    world.setHeartLevel(level);
    state.heartLevel = world.heartLevel();
    // He walks round the reaches read when he came out, so a heart grown while he played let him walk into its new
    // crystal, and one shrunk kept him off ground it had given up.
    if (pipPlay.active) pipPlay.refreshObstacles(world.members);
    if (!liveHeart) return;
    labels.setText(liveHeart.member.name, liveHeartText(state.heartLevel));
    labels.setAnchor(liveHeart.member.name, memberLabelAnchor(liveHeart));
    // The slider heart's own view follows its growth, as a resize refits a view, unless the viewer has moved the camera:
    // the view fitted to stage 7 cut off stage 10's crystal and framed stage 0 from twice as far as it needed.
    if (state.member === liveHeart.member.name && !userMoved) applyFocus(true);
  }

  function resize(): void {
    widthPx = stage.clientWidth;
    heightPx = stage.clientHeight;
    camera.aspect = widthPx / heightPx;
    camera.updateProjectionMatrix();
    renderer.setSize(widthPx, heightPx);
    pipeline.setSize(widthPx, heightPx);
    renderer.getDrawingBufferSize(drawing);
    inkUniforms.uResolution.value.copy(drawing);
    // A turned phone refits the open view, unless the viewer has moved the camera since opening it.
    if (!userMoved && loopStarted) applyFocus(false);
  }
  window.addEventListener('resize', resize);
  resize();

  function applyDials(): void {
    applyPaintDials(paint, dials, theme);
    applyInkDials(inkUniforms, dials);
    syncHulls();
    pipeline.applyDials(dials, theme);
    syncSun();
    syncLook();
  }

  function setTier(name: TierName): void {
    try {
      const next = TIERS[name];
      // Built before anything changes, so a throw leaves the working pipeline in place (see the Style Lab).
      const nextPipeline = createPipeline({ renderer, scene, camera, tier: next, dials, theme, inkNoise, sunDirection: sun.direction, reducedMotion, planet });
      tier = next;
      state.tier = name;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.pixelRatioMax));
      sun.setTier(tier);
      pipeline.dispose();
      pipeline = nextPipeline;
      resize();
    } catch (error) {
      fail(error);
    }
  }

  const panel = createWorldPanel(state, {
    onFocus: () => {
      applyFocus(true);
      syncAddress();
    },
    onPlay: (on) => setPlay(on),
    onHeartLevel: (level) => setHeartLevel(level),
    onTier: setTier,
    openStyleLab: () => {
      const url = new URL('style.html', location.href);
      url.search = styleLabQuery(encodeDials(dials), state.member);
      location.assign(url.toString());
    },
  });

  // The address opens a member or a family (the inspection-view law), each parameter read as its own kind; a name that
  // is neither is named in the console and the banner, and the view falls back to the other parameter or the overview,
  // with the address rewritten to what opened.
  const address = resolveAddress(params.get('member'), params.get('family'));
  if (address.problems.length) {
    const where = describeView(address.open);
    for (const problem of address.problems) console.warn(`${PAGE}: ${problem} in the address; opening ${where}`);
    const said = address.problems.join('; ');
    showBanner(`${said.charAt(0).toUpperCase()}${said.slice(1)}; showing ${where}.`);
  }
  openView(address.open);

  /** Moves dials as the Style Lab's handle does: each change passes acceptDial, and a refused one is named. */
  function setDials(changes: Record<string, unknown>): SetDialsResult {
    const target = dials as unknown as Record<string, unknown>;
    const rejected: string[] = [];
    for (const [key, value] of Object.entries(changes ?? {})) {
      if (acceptDial(key, value)) target[key] = value;
      else rejected.push(key);
    }
    applyDials();
    return { dials: { ...dials }, rejected };
  }

  let frozen = params.get('freeze') === '1';
  // The faces hold with the clips, a blink included, so a frozen frame is the same frame on every load.
  world.setFrozen(frozen);
  // `?play=pip` opens the play prototype over the view the address opened, once the freeze it must respect is read;
  // any other value is named and skipped.
  const playParam = params.get('play');
  if (playParam === PLAY_PIP) setPlay(true);
  else if (playParam) {
    console.warn(`${PAGE}: no play mode named "${playParam}" in the address`);
    showBanner(`No play mode named "${playParam}"; only ?play=${PLAY_PIP} opens one.`);
  }
  const fpsBox = document.getElementById('fps') as HTMLElement;
  let last = performance.now();
  let frames = 0;
  let frameMs = 16.7;
  const surface = (x: number, z: number): [number, number, number] => patch.surfaceAt(x, z).position.toArray() as [number, number, number];
  window.__P99__ = {
    ready: false,
    page: 'world',
    tier: state.tier,
    assets: manifest !== null && gaps.length === 0 && world.members.length === MEMBERS.length,
    get look() {
      return lookKind();
    },
    placed: [...new Set(world.members.flatMap((entry) => [entry.member.entry, entry.member.name]))],
    roots: () =>
      world.members.map((entry) => ({
        name: entry.member.name,
        entry: entry.member.entry,
        node: entry.member.node,
        family: entry.member.family,
        zone: entry.member.zone,
        clip: entry.member.clip,
        position: entry.root.getWorldPosition(new Vector3()).toArray(),
      })),
    surfaceAt: surface,
    bounds: () =>
      world.members.map((entry) => ({
        name: entry.member.name,
        min: entry.bounds.min.toArray(),
        max: entry.bounds.max.toArray(),
        lowest: entry.lowest.toArray(),
        top: entry.top.toArray(),
      })),
    focus: (name: string) => focus(name),
    focused: focusKey,
    gliding: () => transition !== null,
    camera: () => {
      camera.updateMatrixWorld();
      return {
        position: camera.position.toArray(),
        target: controls.target.toArray(),
        projection: camera.projectionMatrix.toArray(),
        view: camera.matrixWorldInverse.toArray(),
      };
    },
    labels: () => labels.read(),
    frameMs: () => frameMs,
    dials: () => ({ ...dials }),
    setDials,
    setHeartLevel: (level: number) => {
      setHeartLevel(level);
      panel.refresh();
    },
    setLabels: (on: boolean) => {
      state.labels = on;
      panel.refresh();
    },
    setTurntable: (on: boolean) => {
      state.turntable = on;
      panel.refresh();
    },
    freeze: (on: boolean) => {
      frozen = on;
      world.setFrozen(on);
      pipPlay.setFrozen(on);
    },
    // The play prototype: puts Pip out or brings him in (false when the page has none), and reads where he is.
    setPlay: (on: boolean) => setPlay(on),
    play: () => pipPlay.reading(),
    // A face pose held on a member for an evidence frame, or null to hand it back to its blink and demo.
    setFace: (name: string, pose: FacePose | null) => world.setFace(name, pose),
    faces: () => world.faces(),
    // A debug hook for evidence captures: places the camera and the orbit's centre exactly, ending any glide, so a frame
    // can be taken from a chosen pose. Nothing on the page calls it.
    setCamera: (position: number[], target: number[]) => {
      transition = null;
      camera.position.fromArray(position);
      controls.target.fromArray(target);
      controls.update();
    },
  };
  loopStarted = true;
  renderer.setAnimationLoop(() => {
    try {
      const now = performance.now();
      const interval = now - last;
      last = now;
      // Only the scene's step is clamped, so a stall does not jump it; the reading keeps the real interval (Style Lab).
      const dt = frozen ? 0 : Math.min(interval / 1000, 1 / 20);
      frameMs = frameMs * 0.95 + interval * 0.05;
      world.update(state.paused ? 0 : dt * state.speed);
      if (transition) {
        transition.elapsed += Math.min(interval / 1000, 1 / 20);
        const t = Math.min(transition.elapsed / TRANSITION_SECONDS, 1);
        const eased = 1 - Math.pow(1 - t, 3); // ease out: the move starts at once and settles softly
        camera.position.lerpVectors(transition.from.position, transition.to.position, eased);
        controls.target.lerpVectors(transition.from.target, transition.to.target, eased);
        if (t >= 1) transition = null;
      }
      // Pip moves on the frame's own step, which the freeze stops, and not on the animation speed dial, which is the
      // world's clips'; the camera then follows him before the controls apply a drag or the wheel.
      if (pipPlay.active) pipPlay.update(dt, input.read(), input.takeAttack(), camera, controls);
      // The turntable turns around the open view, and waits while a view glides in or Pip plays.
      controls.autoRotate = state.turntable && transition === null && !pipPlay.active;
      controls.update(frozen ? 0 : Math.min(interval / 1000, 1 / 20));
      sky.follow(camera);
      pipeline.render(dt);
      labels.update(camera, widthPx, heightPx, labelShows());
      frames += 1;
      if (frames % 30 === 0) fpsBox.textContent = `${tier.name} tier, frame interval ${frameMs.toFixed(1)} ms`;
      if (frames === 3 && window.__P99__) window.__P99__.ready = true;
    } catch (error) {
      fail(error);
    }
  });
}

start().catch(fail);
