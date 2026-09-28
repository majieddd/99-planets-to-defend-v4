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
import { flatTexture, loadManifestTexture, loadNamedAsset } from '../shared/labAssets';
import { NARROW_SCREEN } from '../style/referenceBoard';
import { WorldLabels, type LabelSpec } from './labels';
import { buildAssetWorld, type AssetWorld, type PlacedMember } from './layout';
import { createWorldPanel, type WorldPanelState } from './panel';
import { coverageGaps, MEMBERS, ZONES } from './registry';
import { createWorldSun } from './sun';
import {
  boundsCorners,
  CHARACTER_FAMILIES,
  CHARACTERS,
  FAMILY_LABEL_ROOM_PX,
  familyLabelAnchor,
  fitPoints,
  MEMBER_LABEL_ROOM_PX,
  memberLabelAnchor,
  membersOf,
  OVERVIEW,
  pitchOf,
  type FitPoint,
  type ViewPose,
} from './views';

const BASE = import.meta.env.BASE_URL;
const theme = VERDANT;
const PAGE = 'Asset World';
/** One turn of the turntable around the current view, in seconds: slow enough to study a silhouette as it turns. */
const TURNTABLE_SECONDS = 40;
/** How long a view chosen in the panel takes to arrive, in seconds; reduced motion and the test handle jump at once. */
const TRANSITION_SECONDS = 0.8;
/** The overview shows every member's label only on a screen at least this wide, in CSS pixels; narrower, the labels
 * of 21 members crowd each other, so the overview names the families alone and a family's view names its members. */
const OVERVIEW_MEMBER_LABELS_MIN_WIDTH = 1280;

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

/** A family placard's key among the labels, apart from the members' names. */
function familyKey(family: string): string {
  return `family:${family}`;
}

function liveHeartText(level: number): string {
  return `Stage ${level} (slider)`;
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
  // link that moves no dial opens the locked look.
  const lookKind = (Object.keys(DEFAULT_DIALS) as (keyof RenderDials)[]).some((key) => dials[key] !== DEFAULT_DIALS[key]) ? 'link' : 'locked';
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
  };
  let tier = TIERS[state.tier];
  const renderer = createRenderer(stage, tier);
  activeRenderer = renderer;

  const look = document.getElementById('look') as HTMLButtonElement;
  const lookName = look.querySelector('.look-name') as HTMLElement;
  lookName.textContent = lookKind === 'locked' ? 'Look: Painted-Anime-Inkline 4.0 (locked)' : 'Look: a dials link over the locked defaults';
  const narrow = matchMedia(NARROW_SCREEN);
  // On a phone the note shows its first line and opens on a tap; on a wider screen it is always open.
  look.setAttribute('aria-expanded', String(!narrow.matches));
  look.addEventListener('click', () => look.setAttribute('aria-expanded', String(look.getAttribute('aria-expanded') !== 'true')));

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
  const world: AssetWorld = buildAssetWorld(
    patch,
    assets,
    ctx,
    MEMBERS.filter((m) => assets.has(m.entry)),
  );
  scene.add(world.root);
  const byName = new Map(world.members.map((entry) => [entry.member.name, entry]));

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
  const familyMembers = (family: string): PlacedMember[] => world.members.filter((entry) => entry.member.family === family);
  for (const zone of ZONES) {
    const members = familyMembers(zone.family);
    if (members.length) labels.add({ key: familyKey(zone.family), kind: 'family', text: zone.label, detail: zone.family, anchor: familyLabelAnchor(members, patch) });
  }
  for (const entry of world.members) {
    const { member } = entry;
    if (!member.label) continue;
    const text = member.heartStage === 'live' ? liveHeartText(world.heartLevel()) : member.label;
    labels.add({ key: member.name, kind: 'member', text, anchor: memberLabelAnchor(entry) });
  }
  const liveHeart = world.members.find((entry) => entry.member.heartStage === 'live');
  state.heartLevel = world.heartLevel();
  function setHeartLevel(level: number): void {
    world.setHeartLevel(level);
    state.heartLevel = world.heartLevel();
    if (!liveHeart) return;
    labels.setText(liveHeart.member.name, liveHeartText(state.heartLevel));
    labels.setAnchor(liveHeart.member.name, memberLabelAnchor(liveHeart));
  }
  /**
   * Which labels a view shows. The overview names every family, and on a wide screen every member too; the characters'
   * view names both character families and their members; a family's view names the family and its members; a member's
   * view names the member and its family. Other families' names stay off a close view, where they would crowd its edges.
   */
  const labelShown = (spec: LabelSpec): boolean => {
    if (!state.labels) return false;
    const family = spec.kind === 'family' ? spec.key.slice(familyKey('').length) : byName.get(spec.key)?.member.family;
    if (!family) return false;
    if (state.member) return spec.kind === 'family' ? family === byName.get(state.member)?.member.family : spec.key === state.member;
    if (state.view === OVERVIEW) return spec.kind === 'family' || stage.clientWidth >= OVERVIEW_MEMBER_LABELS_MIN_WIDTH;
    if (state.view === CHARACTERS) return CHARACTER_FAMILIES.includes(family);
    return family === state.view;
  };

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
  /** The points a view keeps in frame: its members' bounds, and the labels it shows with the room each takes. */
  function framePoints(focusName: string): FitPoint[] | null {
    const framed = membersOf(focusName, world.members);
    if (!framed || framed.length === 0) return null;
    const points: FitPoint[] = boundsCorners(framed).map((point) => ({ point }));
    if (!state.labels) return points;
    const families = new Set(framed.map((entry) => entry.member.family));
    for (const family of families) {
      const spec = labels.spec(familyKey(family));
      if (spec && labelShown(spec)) points.push({ point: spec.anchor, belowPx: FAMILY_LABEL_ROOM_PX });
    }
    for (const entry of framed) {
      const spec = labels.spec(entry.member.name);
      if (spec && labelShown(spec)) points.push({ point: spec.anchor, abovePx: MEMBER_LABEL_ROOM_PX });
    }
    return points;
  }
  function applyFocus(animate: boolean): boolean {
    const points = framePoints(focusKey());
    if (!points) return false;
    const pose = fitPoints(points, pitchOf(focusKey(), world.members), { fov: camera.fov, aspect: camera.aspect, heightPx: stage.clientHeight });
    userMoved = false;
    if (animate && !reducedMotion) transition = { from: { position: camera.position.clone(), target: controls.target.clone() }, to: pose, elapsed: 0 };
    else jumpTo(pose);
    return true;
  }
  /** Keeps the address on the open view, so the bar always holds a link to it (the inspection-view law). */
  function syncAddress(): void {
    const next = new URLSearchParams(location.search);
    next.delete('family');
    next.delete('member');
    if (state.member) next.set('member', state.member);
    else if (state.view !== OVERVIEW) next.set('family', state.view);
    const query = next.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
  }
  /** Opens a view by name: the overview, the characters, a family or a member. False for a name that is none. */
  function focus(name: string, animate = false): boolean {
    const member = byName.get(name)?.member;
    if (member) {
      state.view = member.family;
      state.member = member.name;
    } else if (membersOf(name, world.members)) {
      state.view = name;
      state.member = '';
    } else {
      return false;
    }
    panel.refresh();
    const done = applyFocus(animate);
    syncAddress();
    return done;
  }
  controls.addEventListener('start', () => {
    // A drag takes the camera from a gliding view, and a resize then leaves the viewer's framing alone.
    transition = null;
    userMoved = true;
  });

  function resize(): void {
    camera.aspect = stage.clientWidth / stage.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    pipeline.setSize(stage.clientWidth, stage.clientHeight);
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
    onHeartLevel: (level) => setHeartLevel(level),
    onTier: setTier,
    openStyleLab: () => {
      const url = new URL('style.html', location.href);
      url.search = `?dials=${encodeDials(dials)}`;
      location.assign(url.toString());
    },
  });

  // The address opens a member or a family (the inspection-view law); a name that is neither opens the overview and
  // says so, rather than a blank or a thrown error.
  const askedMember = params.get('member');
  const askedFamily = params.get('family');
  const asked = askedMember ?? askedFamily;
  if (asked && !focus(asked)) {
    console.warn(`${PAGE}: no ${askedMember ? 'member' : 'family'} named "${asked}"; opening the overview`);
    showBanner(`No ${askedMember ? 'member' : 'family'} named "${asked}"; showing the overview.`);
    focus(OVERVIEW);
  } else if (!asked) {
    applyFocus(false);
  }

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
    look: lookKind,
    placed: [...new Set(world.members.flatMap((entry) => [entry.member.entry, entry.member.name]))],
    roots: () =>
      world.members.map((entry) => ({
        name: entry.member.name,
        entry: entry.member.entry,
        family: entry.member.family,
        position: entry.root.getWorldPosition(new Vector3()).toArray(),
      })),
    surfaceAt: surface,
    bounds: () => world.members.map((entry) => ({ name: entry.member.name, min: entry.bounds.min.toArray(), max: entry.bounds.max.toArray() })),
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
      // The turntable turns around the open view, and waits while a view glides in.
      controls.autoRotate = state.turntable && transition === null;
      controls.update(frozen ? 0 : Math.min(interval / 1000, 1 / 20));
      sky.follow(camera);
      pipeline.render(dt);
      labels.update(camera, stage.clientWidth, stage.clientHeight, labelShown);
      frames += 1;
      if (frames % 30 === 0) fpsBox.textContent = `${tier.name} tier, frame interval ${frameMs.toFixed(1)} ms`;
      if (frames === 3 && window.__P99__) window.__P99__.ready = true;
    } catch (error) {
      fail(error);
    }
  });
}

start().catch(fail);
