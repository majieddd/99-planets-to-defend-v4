import { Vector3, type WebGLRenderer } from 'three';
import { standardBlendFor } from '../../render/assets/familyBlend';
import type { LoadedAsset, MaterialContext } from '../../render/assets/loadAsset';
import { assetUrl, fetchManifest, type Manifest } from '../../render/assets/manifest';
import { DEFAULT_DIALS, type RenderDials } from '../../render/defaults';
import type { TierName } from '../../render/quality';
import { STYLE_PLANET_RADIUS } from '../../render/terrain/stylePatch';
import { VERDANT } from '../../render/themes';
import { FACE_SEED } from '../shared/commanderFace';
import { loadNamedAsset } from '../shared/labAssets';
import { createPaintedStage, frameStep, pickTier, WORLD_FOV_DEG } from '../shared/paintedStage';
import { feelAddressValue, feelFromAddress } from '../world/combatFeel';
import { createPipPlay, PLAY_CAMERA_DISTANCE, PLAY_CAMERA_MAX_DISTANCE, type PlayStart } from '../world/play';
import { createPlayInput } from '../world/playInput';
import type { Obstacle } from '../world/playMotion';
import { FIT_NDC } from '../world/views';
import { ARENA_CAMERA_PITCH_DEG, ARENA_DUMMY_NAMES, arenaCameraBearing, arenaCameraDistance, arenaSpawn, dummyFrame, dummyHomes, fromBody } from './arena';
import { createTrainingDummies, type TrainingDummies } from './dummies';
import { createArenaPanel } from './panel';

const BASE = import.meta.env.BASE_URL;
const theme = VERDANT;
const PAGE = 'Combat arena';
/** The only models the arena loads: Pip, who plays, and the Husk, whose instances are the training dummies. */
const PIP = 'commander_pip';
const HUSK = 'husk';
/** What Pip walks round when the build has no dummies to stand. */
const NO_OBSTACLES: readonly Obstacle[] = [];

// start() fills these in, so a failure at any point can stop the loop and word the banner for when it happened.
let activeRenderer: WebGLRenderer | null = null;
let loopStarted = false;

/** The one way out for a failure, as in the other labs: stop the loop first, so a failure is one error and one banner. */
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

/** One model from the manifest with its family's standard blend, or null when the manifest does not list it. */
async function loadModel(manifest: Manifest, name: string, ctx: MaterialContext): Promise<LoadedAsset | null> {
  const entry = manifest.assets.find((asset) => asset.name === name && asset.kind === 'model');
  const url = assetUrl(BASE, manifest, name);
  if (!entry || !url) return null;
  return loadNamedAsset(name, url, ctx, standardBlendFor(entry.family));
}

/**
 * The combat arena: the Asset World's painted patch, sun, sky and fog in the locked look (labs/shared/paintedStage.ts),
 * Pip out in Play Pip from the first frame, and three Husk training dummies in front of him, with the controls card
 * always on screen and the panel's combat feel folder open. It loads two models, where the Asset World loads every one
 * the manifest lists, so it is ready in a fraction of the time, and it shares the world's stage, play, input, combo and
 * feel modules, so a change to the combat shows here and in the world alike.
 */
async function start(): Promise<void> {
  const stage = document.getElementById('stage') as HTMLElement;
  const params = new URLSearchParams(location.search);
  // The locked Painted-Anime-Inkline 4.0 defaults; the arena takes no dials link, since it is for the feel, not the look.
  const dials: RenderDials = { ...DEFAULT_DIALS };
  const state = { tier: pickTier(params.get('tier')) };

  const manifest = __HAS_ASSET_MANIFEST__ ? await fetchManifest(BASE) : null;
  const painted = await createPaintedStage(stage, { tier: state.tier, dials, theme, page: PAGE, manifest });
  activeRenderer = painted.renderer;
  const { scene, camera, ctx, patch, controls } = painted;

  // Pip and the Husk alone, side by side.
  const [pip, husk] = manifest ? await Promise.all([loadModel(manifest, PIP, ctx), loadModel(manifest, HUSK, ctx)]) : [null, null];
  if (!manifest) showBanner('The combat arena needs the built assets (npm run assets); none were found.');
  else if (!pip || !husk) showBanner(`The combat arena needs ${[pip ? '' : PIP, husk ? '' : HUSK].filter(Boolean).join(' and ')} in the manifest.`);
  const assets = new Map<string, LoadedAsset>(pip ? [[PIP, pip]] : []);

  // The combat feel as the address opens it (feelFromAddress), as the world reads it.
  const feel = feelFromAddress(params, (said) => {
    console.warn(`${PAGE}: ${said}`);
    showBanner(`${said}.`);
  });
  // Play Pip keeps a copy of his rig in the bind pose, whose jaw axis his face reads; only Play Pip uses his loaded rig
  // here, so nothing poses it first, as the world's members would.
  const pipPlay = createPipPlay(assets, patch, scene, ctx.hullMaterial, STYLE_PLANET_RADIUS, feel);
  const homes = dummyHomes();
  // A knocked-back dummy stops at Pip's body, read where he stands on each push through his cheap accessor: the full
  // reading, which this called before, builds every field of the handle's reading on every push.
  const pipAt = (): Readonly<{ x: number; z: number }> | null => pipPlay.at();
  const dummies: TrainingDummies | null = husk ? createTrainingDummies(husk, patch, scene, ctx.hullMaterial, homes, ARENA_DUMMY_NAMES, pipAt) : null;
  if (husk && !dummies) showBanner('The combat arena needs the Husk\'s idle clip for its training dummies, which this build does not have.');

  window.addEventListener('resize', painted.resize);
  painted.resize();

  /**
   * Pip's start: the spawn, facing the middle dummy, with the camera straight behind him and looking down at
   * ARENA_CAMERA_PITCH_DEG, as far back as keeps all three dummies across the frame at this screen's shape
   * (arenaCameraDistance), read afresh at each respawn so a phone turned since the load is framed for its new shape.
   */
  function playStart(): PlayStart {
    const spawn = arenaSpawn();
    const frame = dummyFrame(homes);
    const reaches = dummies ? dummies.list.map((dummy) => dummy.reach) : homes.map(() => 0);
    const cameraDistance = arenaCameraDistance(
      frame.map((at, index) => ({ ...at, reach: reaches[index]! })),
      {
        fovDeg: WORLD_FOV_DEG,
        aspect: camera.aspect,
        pitchDeg: ARENA_CAMERA_PITCH_DEG,
        minDistance: PLAY_CAMERA_DISTANCE,
        maxDistance: PLAY_CAMERA_MAX_DISTANCE,
        fit: FIT_NDC,
      },
    );
    return { ...spawn, cameraBearing: arenaCameraBearing(), cameraDistance, cameraPitchDeg: ARENA_CAMERA_PITCH_DEG };
  }

  // The play controls, always on: the keys and a click, or the pad and the button on a touch screen, and R to reset.
  const pad = document.getElementById('pad') as HTMLElement;
  const attackButton = document.getElementById('attack') as HTMLElement;
  const input = createPlayInput(pad, pad.querySelector('.pad-knob') as HTMLElement, attackButton, painted.renderer.domElement, { resetKey: true });
  const coarse = matchMedia('(pointer: coarse)');
  function syncTouchUi(): void {
    pad.hidden = !(pipPlay.active && coarse.matches);
    attackButton.hidden = pad.hidden;
    document.body.classList.toggle('pad-shown', !pad.hidden);
  }
  coarse.addEventListener('change', syncTouchUi);

  let frozen = params.get('freeze') === '1';
  if (!pipPlay.available) showBanner('The combat arena needs Pip (commander) and his idle and run clips, which this build does not have.');
  else {
    // He reads the dummies' kept list on every frame, so a dummy that moves is walked round from the next frame on.
    pipPlay.enter(camera, controls, dummies ? () => dummies.obstacles() : () => NO_OBSTACLES, FACE_SEED, frozen, playStart());
    input.setActive(true);
  }
  syncTouchUi();

  /** Keeps the address on what the page shows: the tier it was opened with, and the feel the sliders hold now. */
  function syncAddress(): void {
    const next = new URLSearchParams(location.search);
    next.delete('feel');
    const feelValue = feelAddressValue(feel);
    if (feelValue) next.set('feel', feelValue);
    const query = next.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
  }
  syncAddress();

  /**
   * The reset, from R or the panel's button: every dummy home on its idle with no hits, and Pip back at the start with
   * the camera behind him, so one key starts a test afresh from the opening view. With the dummies standing still in
   * phase A, a reset of them alone would change nothing on screen; phase B's knockback will move them, and its
   * reactions hear of the reset through TrainingDummies.onReset.
   */
  function reset(): void {
    dummies?.reset();
    if (pipPlay.active) pipPlay.respawn(camera, controls, playStart());
  }

  function setTier(name: TierName): void {
    try {
      painted.setTier(name);
      state.tier = name;
      painted.resize();
    } catch (error) {
      fail(error);
    }
  }

  const panel = createArenaPanel(state, { onTier: setTier, reset, onFeel: syncAddress, notice: showBanner }, feel);
  panel.refresh();

  const fpsBox = document.getElementById('fps') as HTMLElement;
  let last = performance.now();
  let frames = 0;
  let frameMs = 16.7;
  /** Each dummy as the handle reads it: where it stands and its home, its reach and hits, and where it stands from Pip. */
  const dummyReading = () => {
    const play = pipPlay.reading();
    return (dummies?.list ?? []).map((dummy) => {
      const pose = dummy.pose();
      return {
        name: dummy.name,
        position: dummy.root.getWorldPosition(new Vector3()).toArray(),
        tangent: [pose.x, pose.z],
        yaw: pose.yaw,
        home: { tangent: [dummy.home.x, dummy.home.z], yaw: dummy.home.yaw },
        reach: dummy.reach,
        hits: dummy.hits,
        fromPip: play.tangent ? fromBody(play.tangent[0]!, play.tangent[1]!, play.yaw, pose.x, pose.z) : null,
      };
    });
  };
  window.__P99__ = {
    ready: false,
    page: 'combat',
    tier: state.tier,
    assets: pip !== null && husk !== null && dummies !== null && pipPlay.available,
    /** Milliseconds from the page's navigation to its third frame, when `ready` turns true (null until then). */
    readyMs: null as number | null,
    models: [...assets.keys(), ...(husk ? [HUSK] : [])],
    surfaceAt: (x: number, z: number) => patch.surfaceAt(x, z).position.toArray(),
    start: () => {
      const at = playStart();
      return { tangent: [at.x, at.z], yaw: at.yaw, cameraDistance: at.cameraDistance };
    },
    play: () => pipPlay.reading(),
    dummies: dummyReading,
    reset,
    camera: () => {
      camera.updateMatrixWorld();
      return { position: camera.position.toArray(), target: controls.target.toArray(), projection: camera.projectionMatrix.toArray(), view: camera.matrixWorldInverse.toArray() };
    },
    frameMs: () => frameMs,
    freeze: (on: boolean) => {
      frozen = on;
      pipPlay.setFrozen(on);
    },
    // Debug hooks for the reset test and phase B's evidence: stand a dummy at a pose, and land a hit on one through its
    // hit hook. Nothing on the page calls them.
    moveDummy: (index: number, x: number, z: number, yaw: number) => {
      const dummy = dummies?.list[index];
      if (!dummy) return false;
      dummy.moveTo({ x, z, yaw });
      return true;
    },
    hitDummy: (index: number) => {
      const dummy = dummies?.list[index];
      const play = pipPlay.reading();
      if (!dummy) return false;
      dummy.hit({ step: (play.comboStep || 1) as 1 | 2 | 3, time: play.attackTime ?? 0, from: { x: play.tangent?.[0] ?? 0, z: play.tangent?.[1] ?? 0 } });
      return true;
    },
    setCamera: (position: number[], target: number[]) => {
      camera.position.fromArray(position);
      controls.target.fromArray(target);
      controls.update();
    },
  };
  loopStarted = true;
  painted.renderer.setAnimationLoop(() => {
    try {
      const now = performance.now();
      const interval = now - last;
      last = now;
      // Only the scene's step is clamped, so a stall does not jump it; the reading keeps the real interval (Style Lab).
      const dt = frameStep(interval, frozen);
      frameMs = frameMs * 0.95 + interval * 0.05;
      // A reset asked since the last frame goes first, so this frame already draws everything home.
      if (input.takeReset()) reset();
      dummies?.update(dt);
      // His combo, his movement and the camera's follow share the frame's step here; phase B's hit-stop will hold the
      // combo's and the movement's and leave the frame's running (PlayClocks).
      if (pipPlay.active) pipPlay.update({ combo: dt, motion: dt, frame: dt }, input.read(), input.takeAttack(), camera, controls);
      controls.update(frameStep(interval, frozen));
      painted.sky.follow(camera);
      painted.pipeline.render(dt);
      frames += 1;
      if (frames % 30 === 0) fpsBox.textContent = `${painted.tier.name} tier, frame interval ${frameMs.toFixed(1)} ms`;
      if (frames === 3 && window.__P99__) {
        window.__P99__['readyMs'] = Math.round(performance.now());
        window.__P99__.ready = true;
      }
    } catch (error) {
      fail(error);
    }
  });
}

start().catch(fail);
