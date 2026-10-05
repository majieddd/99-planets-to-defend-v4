import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { ARENA_DUMMY_NAMES, RESET_NAME } from '../../src/labs/combat/arena';
import { PLAY_BODY_RADIUS } from '../../src/labs/world/playMotion';

/** What `__P99__.play()` reads of Play Pip (labs/world/play.ts), as far as these tests read it. */
interface PlayReading {
  on: boolean;
  tangent: number[] | null;
  position: number[] | null;
  yaw: number;
  speed: number;
  clearance: number | null;
  attacking: boolean;
  attackTime: number | null;
  bufferOpensAt: number | null;
  comboStep: number;
  strikes: number;
  strikesByStep: number[];
  lastStrikeStep: number | null;
  attackWeight: number;
  sources: ('clip' | 'placeholder')[] | null;
  clipLengthOff: number[] | null;
  feet: number[][] | null;
  clocks: { combo: number; motion: number; frame: number };
  lunge: { moved: number; planned: number; target: number; turnDeg: number; blocked: boolean; source: string | null; total: number };
  lungeSources: string[];
  trail: { points: number; alpha: number; emitting: boolean };
}

/** What `__P99__.dummies()` reads of one training dummy (labs/combat/main.ts). */
interface DummyReading {
  name: string;
  position: number[];
  tangent: number[];
  yaw: number;
  home: { tangent: number[]; yaw: number };
  reach: number;
  /** Its core's radius (labs/combat/dummies.ts DUMMY_CORE_SHARE of its reach): the hump and thorax a lunge comes up to. */
  core: number;
  hits: number;
  fromPip: { distance: number; angleDeg: number } | null;
  flinch: number;
  knockback: number;
}

/** What `__P99__.impact()` reads of the arena's impact (labs/combat/impact.ts), as far as these tests read it. */
interface ImpactReading {
  swings: { step: number; connected: boolean; dummies: number[]; at: number | null }[];
  connects: number;
  lastConnect: { step: number; dummy: number; at: number; contact: number[] } | null;
  hitStop: { active: boolean; remaining: number; lengths: number[]; held: boolean[] };
  sparks: { alive: number; lastCount: number; lastPosition: number[] | null; bursts: number };
  shake: { offset: number; active: boolean; enabled: boolean };
  numbers: { live: number; last: number | null };
}

/** What `__P99__.sound()` reads of the combat sounds (labs/shared/combatSound.ts). */
interface SoundReading {
  state: string;
  unlocked: boolean;
  muted: boolean;
  gain: number;
  asked: { whoosh: number; impact: number; whiff: number };
  played: { whoosh: number; impact: number; whiff: number };
  skipped: { whoosh: number; impact: number; whiff: number };
  deviceErrors: number;
}

interface CameraReading {
  position: number[];
  target: number[];
}

/** The tip of Pip's blade at a clip's strike in his rig's frame, from his build's own measure (Blender's -y ahead). */
interface BladeTip {
  x: number;
  y: number;
}
const pipMeta = JSON.parse(readFileSync('public/assets/commanders/commander_pip.meta.json', 'utf8')) as {
  notes: { combo: Record<string, { checks: { strike_blade_tip: BladeTip } }> };
};
/**
 * How far across the ground from his root each hit's blade tip reaches at its strike, attack_1 to attack_3, from the
 * sidecar's strike_blade_tip of each real clip: 1.14 m for the forehand, 1.48 m for the backhand (out to his right) and
 * 1.35 m for the finisher's chop. It read the attack clip's 1.12 m for every hit while placeholders warped that clip.
 * Phase B's hit detection replaces this reading with real hits.
 */
const BLADE_REACH = [1, 2, 3].map((step) => {
  const tip = pipMeta.notes.combo[`attack_${step}`]!.checks.strike_blade_tip;
  return Math.hypot(tip.x, tip.y);
});
/** The widest a dummy may stand off his facing at a strike, or his facing off the middle dummy at the start, in degrees. */
const FACING_DEG = 15;

/** The Pages project serves the site under this path (playwright.config.ts). */
const PAGES_BASE = '/99-planets-to-defend-v4/';

/**
 * Chromium's own GPU process message on the first WebGL page a fresh SwiftShader browser draws, exactly as it prints it:
 * "[.WebGL-0x71b400422c00]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels",
 * three times, then a fourth time ending " (this message will no longer repeat)" (the arena's e2e log, 2026-10-05). It
 * is the browser's, not the page's: the Asset World and the Style Lab give the same four lines when they are the first
 * page, the page loaded second gives none, and the arena on the GPU gives none. Only that message is left out; every
 * other warning, the page's own and any other driver message, must be none. The filter let through any line starting
 * "GL Driver Message", so a driver's report of something else would have passed unread.
 */
const BROWSER_GPU_MESSAGE = /^\[\.WebGL-0x[0-9a-f]+\]GL Driver Message \(OpenGL, Performance, [^)]*\): GPU stall due to ReadPixels( \(this message will no longer repeat\))?$/;

/**
 * Chromium's own report that the audio device or its WebAudio renderer failed, exactly as it prints it. The combat
 * sounds (labs/shared/combatSound.ts) open an AudioContext on the first real key or click, and on this machine headless
 * Chromium raises this in some of several browsers running at once, as the suite's workers do: of six arenas playing
 * sounds at once, 3 launched plainly, 3 with --audio-buffer-size=4096, and 0, 3 and 1 in three runs with the audio
 * service in process, and the suite itself with --disable-audio-output still raised it (2026-10-05). It is the
 * browser's report of its device, not the page's: the context suspends itself, the sounds count it (`deviceErrors`)
 * and resume it, and a browser on its own never raised it.
 * Only that message is left out; every other error must still be none.
 */
const AUDIO_DEVICE_MESSAGE = 'The AudioContext encountered an error from the audio device or the WebAudio renderer.';

function collectConsole(page: Page): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text() !== AUDIO_DEVICE_MESSAGE) errors.push(message.text());
    if (message.type() === 'warning' && !BROWSER_GPU_MESSAGE.test(message.text())) warnings.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return { errors, warnings };
}

async function open(page: Page, query = '?tier=low'): Promise<number> {
  const at = Date.now();
  await page.goto(`./labs/combat.html${query}`);
  await page.waitForFunction(() => window.__P99__?.ready === true && window.__P99__?.page === 'combat', undefined, { timeout: 180_000 });
  return Date.now() - at;
}

const read = (page: Page) =>
  page.evaluate(() => {
    const p99 = window.__P99__!;
    return {
      play: (p99['play'] as () => PlayReading)(),
      dummies: (p99['dummies'] as () => DummyReading[])(),
      start: (p99['start'] as () => { tangent: number[]; yaw: number; cameraDistance: number })(),
      camera: (p99['camera'] as () => CameraReading)(),
    };
  });

/** Whether every dummy stands at its home pose, its point within a micrometre and its yaw exactly. */
const allHome = (dummies: readonly DummyReading[]) =>
  dummies.every((d) => Math.hypot(d.tangent[0]! - d.home.tangent[0]!, d.tangent[1]! - d.home.tangent[1]!) < 1e-6 && d.yaw === d.home.yaw && d.hits === 0);

test.describe.configure({ mode: 'parallel' });

test.describe('the combat arena', () => {
  // A small canvas keeps SwiftShader's frames cheap, as the Asset World's tests do.
  test.use({ viewport: { width: 480, height: 270 } });

  test('loads Pip and three training dummies alone, quietly, with Pip facing them and the camera behind him', async ({ page }) => {
    test.setTimeout(240_000);
    const log = collectConsole(page);
    const models: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('.glb')) models.push(request.url().split('/').pop()!);
    });
    const wallMs = await open(page);
    const state = await read(page);
    const readyMs = await page.evaluate(() => window.__P99__!['readyMs'] as number);
    const surfaces = await page.evaluate((dummies) => dummies.map((d) => (window.__P99__!['surfaceAt'] as (x: number, z: number) => number[])(d.tangent[0]!, d.tangent[1]!)), state.dummies);
    const middle = state.dummies[1]!;
    // The camera's bearing from his chest, on the ground, against his back: 0 is straight behind him.
    const [cx, , cz] = state.camera.position;
    const [tx, , tz] = state.camera.target;
    const behindDeg = (Math.abs(Math.atan2(Math.sin(Math.atan2(cx! - tx!, cz! - tz!) - (state.play.yaw + Math.PI)), Math.cos(Math.atan2(cx! - tx!, cz! - tz!) - (state.play.yaw + Math.PI)))) * 180) / Math.PI;
    const offGround = state.dummies.map((d, i) => Math.hypot(...d.position.map((value, k) => value - surfaces[i]![k]!)));
    const line =
      `combat arena load [${test.info().project.name}]: ready ${readyMs} ms after navigation (${wallMs} ms from goto); models ${JSON.stringify(models)}; ` +
      `Pip on ${state.play.on} at ${JSON.stringify(state.play.tangent?.map((v) => Number(v.toFixed(3))))}, the middle dummy ${middle.fromPip?.distance.toFixed(3)} m ahead at ${middle.fromPip?.angleDeg.toFixed(3)} degrees off his facing, ` +
      `the others at ${state.dummies.map((d) => d.fromPip?.angleDeg.toFixed(2)).join(', ')} degrees; camera ${behindDeg.toFixed(2)} degrees off straight behind him, ${state.start.cameraDistance} m back; ` +
      `dummy reaches ${state.dummies.map((d) => d.reach.toFixed(3)).join(', ')} m, off the ground ${offGround.map((v) => (v * 1000).toFixed(3)).join(', ')} mm; clearance ${state.play.clearance?.toFixed(3)} m; ` +
      `hit clips from ${JSON.stringify(state.play.sources)}, lengths off their contracts ${state.play.clipLengthOff?.map((v) => v.toFixed(4)).join(', ')} s; ` +
      `console errors ${JSON.stringify(log.errors)}, warnings ${JSON.stringify(log.warnings)}`;
    console.log(line);
    expect(log.errors, line).toEqual([]);
    expect(log.warnings, line).toEqual([]);
    // The real attack_1 to attack_3 in his GLB, picked up with no change to the page, each within a frame of its contract.
    expect(state.play.sources, line).toEqual(['clip', 'clip', 'clip']);
    for (const off of state.play.clipLengthOff!) expect(Math.abs(off), line).toBeLessThanOrEqual(1 / 30);
    // Two models and no others: Pip and the Husk.
    expect([...models].sort(), line).toEqual(['commander_pip.glb', 'husk.glb']);
    expect(state.play.on, line).toBe(true);
    expect(state.play.tangent, line).toEqual(state.start.tangent);
    expect(state.dummies.map((d) => d.name), line).toEqual([...ARENA_DUMMY_NAMES]);
    expect(allHome(state.dummies), line).toBe(true);
    // He faces the middle dummy, the camera behind him; every dummy stands on the ground, and he stands clear of them.
    expect(Math.abs(middle.fromPip!.angleDeg), line).toBeLessThan(FACING_DEG);
    expect(behindDeg, line).toBeLessThan(1);
    for (const value of offGround) expect(value, line).toBeLessThan(0.001);
    expect(state.play.clearance!, line).toBeGreaterThan(0);
  });

  test.describe('beyond the load', () => {
    test.skip(({ baseURL }) => Boolean(baseURL?.endsWith(PAGES_BASE)), 'The Pages project keeps the load test for its base path; the play and the phone layout need no second run.');

    test('lands a three-hit chain with the middle dummy in front of him and within the blade\'s reach at each strike', async ({ page }) => {
      test.setTimeout(240_000);
      const log = collectConsole(page);
      await open(page);
      // W walks him straight at the middle dummy, the camera being behind him, until its reach holds him.
      await page.keyboard.down('KeyW');
      await page.waitForFunction(() => ((window.__P99__!['play'] as () => PlayReading)().clearance ?? 1) < 0.02, undefined, { timeout: 60_000 });
      await page.keyboard.up('KeyW');
      await page.waitForFunction(() => (window.__P99__!['play'] as () => PlayReading)().speed === 0, undefined, { timeout: 60_000 });
      // The chain's presses go from inside the page on the frames a recorder reads, one as each light hit's buffer
      // opens, as the Asset World's chain test does; the recorder keeps every dummy's reading on each strike's frame, and
      // from the finisher's first frame to ten frames past its end it keeps his root and his feet on every frame.
      await page.evaluate(() => {
        type Strike = { step: number; dummies: DummyReading[] };
        type Frame = { step: number; time: number | null; weight: number; tangent: number[]; position: number[]; feet: number[][]; lunge: number };
        const store = window as unknown as { strikes: Strike[]; frames: Frame[]; presses: number; done: boolean; lunges: number[]; closest: { distance: number; core: number; step: number } };
        const p99 = window.__P99__!;
        const play = () => (p99['play'] as () => PlayReading)();
        const press = (): void => {
          store.presses += 1;
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f' }));
          window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', key: 'f' }));
        };
        store.strikes = [];
        store.frames = [];
        store.presses = 0;
        store.done = false;
        store.lunges = [0, 0, 0];
        store.closest = { distance: Infinity, core: 0, step: 0 };
        const pressedIn = new Set<number>();
        let last = play().strikes;
        let after = -1;
        const tick = (): void => {
          const sample = play();
          if (sample.comboStep > 0) store.lunges[sample.comboStep - 1] = Math.max(store.lunges[sample.comboStep - 1]!, sample.lunge.moved);
          const middleNow = (p99['dummies'] as () => DummyReading[])()[1]!;
          if (middleNow.fromPip && middleNow.fromPip.distance < store.closest.distance) store.closest = { distance: middleNow.fromPip.distance, core: middleNow.core, step: sample.comboStep };
          if (sample.strikes > last) store.strikes.push({ step: sample.lastStrikeStep ?? 0, dummies: (p99['dummies'] as () => DummyReading[])() });
          last = sample.strikes;
          if (sample.comboStep === 3 || store.frames.length) {
            store.frames.push({
              step: sample.comboStep,
              time: sample.attackTime,
              weight: sample.attackWeight,
              tangent: sample.tangent!,
              position: sample.position!,
              feet: sample.feet!,
              lunge: sample.lunge.moved,
            });
            if (sample.comboStep === 0) after += 1;
          }
          if (after >= 10) {
            store.done = true;
            return;
          }
          const open = sample.attackTime !== null && sample.bufferOpensAt !== null && sample.attackTime >= sample.bufferOpensAt;
          if (sample.comboStep > 0 && sample.comboStep < 3 && open && !pressedIn.has(sample.comboStep)) {
            pressedIn.add(sample.comboStep);
            press();
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        press();
      });
      await page.waitForFunction(() => (window as unknown as { done: boolean }).done, undefined, { timeout: 120_000 });
      const result = await page.evaluate(() => {
        const store = window as unknown as {
          strikes: { step: number; dummies: DummyReading[] }[];
          frames: { step: number; time: number | null; weight: number; tangent: number[]; position: number[]; feet: number[][]; lunge: number }[];
          presses: number;
          lunges: number[];
          closest: { distance: number; core: number; step: number };
        };
        return { strikes: store.strikes, frames: store.frames, presses: store.presses, lunges: store.lunges, closest: store.closest, play: (window.__P99__!['play'] as () => PlayReading)() };
      });
      const atStrike = result.strikes.map((strike) => {
        const middle = strike.dummies[1]!;
        const nearest = [...strike.dummies].sort((a, b) => a.fromPip!.distance - a.reach - (b.fromPip!.distance - b.reach))[0]!;
        return { step: strike.step, middle, nearest };
      });
      // The finisher plants him while its front (left) boot steps forward and back inside the clip: nothing but its lunge
      // may move his root (his steering is held), the boot must travel about its 22 cm from his root, the frame on which
      // the hit ends must move neither foot more than the frames before it did, and the feet must then stand still, or
      // the step would read as a slide or a snap. That the boot comes home inside the clip is the unit test's
      // (combo-clips.test.ts); here, ten frames after the end, it stands where the idle puts it, which is not where the
      // hits stand it (the idle's stance is 9.4 cm wider at the left toe than the rest pose's, which every authored clip
      // holds), so that distance is read, not held.
      const frames = result.frames;
      const finisher = frames.filter((frame) => frame.step === 3);
      const end = frames.findIndex((frame) => frame.step === 0);
      const gap = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
      const rootDrift = Math.max(...finisher.map((frame) => Math.hypot(frame.tangent[0]! - finisher[0]!.tangent[0]!, frame.tangent[1]! - finisher[0]!.tangent[1]!)));
      const lunged = finisher.at(-1)!.lunge;
      // The boot's place from his root, so the lunge carrying both does not count as the step.
      const fromRoot = (frame: (typeof frames)[number], foot: number) => frame.feet[foot]!.map((value, k) => value - frame.position[k]!);
      const stepOut = Math.max(...finisher.map((frame) => gap(fromRoot(frame, 0), fromRoot(finisher[0]!, 0))));
      const home = gap(fromRoot(frames.at(-1)!, 0), fromRoot(finisher[0]!, 0));
      const footMove = (index: number) => Math.max(gap(frames[index]!.feet[0]!, frames[index - 1]!.feet[0]!), gap(frames[index]!.feet[1]!, frames[index - 1]!.feet[1]!));
      const atEnd = footMove(end);
      const lateMoves = frames.slice(1, end).map((_, i) => i + 1).filter((index) => (frames[index]!.time ?? 0) >= 0.55).map(footMove);
      const afterMoves = frames.slice(end + 1).map((_, i) => footMove(end + 1 + i));
      // The closest his body (PLAY_BODY_RADIUS about his root) came to the middle dummy's core (its hump and thorax).
      const bodyToCore = result.closest.distance - PLAY_BODY_RADIUS - result.closest.core;
      const line =
        `combat arena chain [${test.info().project.name}]: ${result.presses} presses; strikes at steps ${atStrike.map((s) => s.step).join(', ')}; ` +
        atStrike
          .map(
            (s) =>
              `attack_${s.step}: the middle dummy ${s.middle.fromPip!.distance.toFixed(3)} m from his root (its reach ${s.middle.reach.toFixed(3)} m, so ${(s.middle.fromPip!.distance - s.middle.reach).toFixed(3)} m beyond it against the blade's ${BLADE_REACH[s.step - 1]!.toFixed(3)} m) ` +
              `at ${s.middle.fromPip!.angleDeg.toFixed(2)} degrees, the nearest ${s.nearest.name} at ${s.nearest.fromPip!.distance.toFixed(3)} m and ${s.nearest.fromPip!.angleDeg.toFixed(2)} degrees`,
          )
          .join('; ') +
        `; lunges from W-contact ${result.lunges.map((m, i) => `attack_${i + 1} ${(m * 1000).toFixed(1)} mm`).join(', ')} (${JSON.stringify(result.play.lungeSources)}), ` +
        `his body ${(bodyToCore * 1000).toFixed(1)} mm from the middle dummy's core at the closest (roots ${result.closest.distance.toFixed(3)} m apart in attack_${result.closest.step}, core ${result.closest.core.toFixed(3)} m)` +
        `; strikes by hit ${JSON.stringify(result.play.strikesByStep)}; finisher over ${finisher.length} frames: root moved ${(rootDrift * 1000).toFixed(2)} mm against its lunge's ${(lunged * 1000).toFixed(2)} mm, ` +
        `left boot out ${(stepOut * 100).toFixed(1)} cm from his root at most, and ten frames after the end ${(home * 1000).toFixed(1)} mm from where it stood from his root at the start (the idle's stance against the hits'); ` +
        `largest foot move in a frame ${(Math.max(...lateMoves) * 1000).toFixed(1)} mm from 0.55 s to the end, ${(atEnd * 1000).toFixed(1)} mm on the frame it ended, ` +
        `${(Math.max(...afterMoves) * 1000).toFixed(1)} mm in the ten after; console errors ${JSON.stringify(log.errors)}`;
      console.log(line);
      expect(atStrike.map((s) => s.step), line).toEqual([1, 2, 3]);
      expect(result.play.strikesByStep, line).toEqual([1, 1, 1]);
      for (const s of atStrike) {
        expect(s.nearest.name, line).toBe('dummy_middle');
        expect(s.middle.fromPip!.distance - s.middle.reach, line).toBeLessThanOrEqual(BLADE_REACH[s.step - 1]!);
        expect(Math.abs(s.middle.fromPip!.angleDeg), line).toBeLessThan(FACING_DEG);
      }
      // Every hit lunges from W-contact against the middle dummy: each light hit at least 0.3 m and the finisher further,
      // swept against the dummy's core, so his body never enters its hump and thorax. The lunge was measured against the
      // dummy's whole reach, where W parks him, and moved 0, 0.17 and 0.26 m.
      expect(result.lunges[0]!, line).toBeGreaterThanOrEqual(0.3);
      expect(result.lunges[1]!, line).toBeGreaterThanOrEqual(0.3);
      expect(result.lunges[2]!, line).toBeGreaterThan(Math.max(result.lunges[0]!, result.lunges[1]!));
      expect(bodyToCore, line).toBeGreaterThanOrEqual(-0.001);
      // Only the lunge moved him: his root went the lunge's metres and no more (a straight lunge, read on the plane).
      expect(Math.abs(rootDrift - lunged), line).toBeLessThan(0.001);
      expect(stepOut, line).toBeGreaterThan(0.15);
      expect(stepOut, line).toBeLessThan(0.3);
      expect(atEnd, line).toBeLessThanOrEqual(Math.max(...lateMoves) + 1e-6);
      for (const move of afterMoves) expect(move, line).toBeLessThan(0.002);
      expect(log.errors, line).toEqual([]);
    });

    test('lands all three hits on the middle dummy with a hit-stop, sparks and a reaction, and gives a whiff none of them', async ({ page }) => {
      test.setTimeout(240_000);
      const log = collectConsole(page);
      await open(page);
      const sound = () => page.evaluate(() => (window.__P99__!['sound'] as () => SoundReading)());
      // The sounds stay locked, and make no audio context, until a real gesture: Shift, which only sprints, is one.
      const locked = await sound();
      await page.keyboard.press('ShiftLeft');
      await page.waitForFunction(() => (window.__P99__!['sound'] as () => SoundReading)().state === 'running', undefined, { timeout: 30_000 });
      const unlocked = await sound();
      // Every frame from a press until a while after the hits end is read in the page, as the chain test does, with the
      // frame's clocks (a hit-stop shows as a combo step under the frame's), the impact and the middle dummy.
      type Frame = { step: number; time: number | null; clocks: PlayReading['clocks']; impact: ImpactReading; middle: DummyReading; trail: PlayReading['trail'] };
      const record = (presses: 'one' | 'chain') =>
        page.evaluate(async (mode) => {
          const p99 = window.__P99__!;
          const play = () => (p99['play'] as () => PlayReading)();
          const frames: Frame[] = [];
          const pressedIn = new Set<number>();
          const press = (): void => {
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f' }));
            window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', key: 'f' }));
          };
          press();
          await new Promise<void>((done) => {
            let after = 0;
            const tick = (): void => {
              const sample = play();
              frames.push({
                step: sample.comboStep,
                time: sample.attackTime,
                clocks: sample.clocks,
                impact: (p99['impact'] as () => ImpactReading)(),
                middle: (p99['dummies'] as () => DummyReading[])()[1]!,
                trail: sample.trail,
              });
              if (sample.comboStep === 0 && frames.length > 3) after += 1;
              if (after >= 12) return done();
              const open = sample.attackTime !== null && sample.bufferOpensAt !== null && sample.attackTime >= sample.bufferOpensAt;
              if (mode === 'chain' && sample.comboStep > 0 && sample.comboStep < 3 && open && !pressedIn.has(sample.comboStep)) {
                pressedIn.add(sample.comboStep);
                press();
              }
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
          return frames;
        }, presses);
      /** Each run of frames whose combo clock took less than the frame's: a hit-stop, with the time it held. */
      const stops = (frames: Frame[]) => {
        const out: { step: number; ms: number; frames: number }[] = [];
        let run: { step: number; ms: number; frames: number } | null = null;
        for (const frame of frames) {
          const held = frame.clocks.frame - frame.clocks.combo;
          if (held > 1e-9) {
            run ??= { step: frame.step, ms: 0, frames: 0 };
            run.ms += held * 1000;
            run.frames += 1;
          } else if (run) {
            out.push(run);
            run = null;
          }
        }
        if (run) out.push(run);
        return out;
      };

      // A swing at the air from the spawn, the dummies 3 m off: the blade meets nothing, so nothing marks it.
      const whiff = await record('one');
      const whiffEnd = whiff.at(-1)!.impact;
      const afterWhiff = await sound();
      // Then W walks him straight at the middle dummy until its reach holds him, and the chain is pressed from the page.
      await page.keyboard.down('KeyW');
      await page.waitForFunction(() => ((window.__P99__!['play'] as () => PlayReading)().clearance ?? 1) < 0.02, undefined, { timeout: 60_000 });
      await page.keyboard.up('KeyW');
      await page.waitForFunction(() => (window.__P99__!['play'] as () => PlayReading)().speed === 0, undefined, { timeout: 60_000 });
      const chain = await record('chain');
      const end = chain.at(-1)!.impact;
      const afterChain = await sound();
      const measured = stops(chain);
      // Each contact as the frame it landed on read it: which hit, the sparks then, and where they went.
      const contacts = chain
        .map((frame, i) => ({ frame, before: chain[i - 1] }))
        .filter(({ frame, before }) => before && frame.impact.connects > before.impact.connects)
        .map(({ frame }) => ({
          step: frame.impact.lastConnect!.step,
          dummy: frame.impact.lastConnect!.dummy,
          bursts: frame.impact.sparks.bursts,
          alive: frame.impact.sparks.alive,
          sparksAt: frame.impact.sparks.lastPosition,
          contact: frame.impact.lastConnect!.contact,
          hits: frame.middle.hits,
        }));
      // The middle dummy's reaction between one contact and the next: its most flinch and its knockback.
      const connectAt = chain.map((frame, i) => (i > 0 && frame.impact.connects > chain[i - 1]!.impact.connects ? i : -1)).filter((i) => i >= 0);
      const reactions = connectAt.map((from, k) => {
        const span = chain.slice(from, connectAt[k + 1] ?? chain.length);
        return { flinch: Math.max(...span.map((frame) => frame.middle.flinch)), knockback: Math.max(...span.map((frame) => frame.middle.knockback)) };
      });
      const line =
        `combat arena impact [${test.info().project.name}]: whiff ${whiff.length} frames, swings ${JSON.stringify(whiffEnd.swings)}, ` +
        `stops ${JSON.stringify(stops(whiff))}, sparks ${whiffEnd.sparks.bursts}, trail up to ${Math.max(...whiff.map((frame) => frame.trail.points))} samples; ` +
        `chain ${chain.length} frames, swings ${JSON.stringify(end.swings.slice(-3))}; hit-stops from the clocks ${measured.map((run) => `attack_${run.step} ${run.ms.toFixed(1)} ms over ${run.frames} frames`).join(', ')} ` +
        `(the impact's own ${end.hitStop.lengths.slice(-3).map((value) => (value * 1000).toFixed(1)).join(', ')} ms); ` +
        `contacts ${contacts.map((c) => `attack_${c.step} on dummy ${c.dummy}: sparks burst ${c.bursts} (${c.alive} alive) at ${c.sparksAt?.map((v) => v.toFixed(2)).join(',')}, hits ${c.hits}`).join('; ')}; ` +
        `reactions ${reactions.map((r) => `flinch ${r.flinch.toFixed(2)}, knockback ${r.knockback.toFixed(3)} m`).join('; ')}; ` +
        `the middle dummy's hits ${chain.at(-1)!.middle.hits}, numbers last ${end.numbers.last}; ` +
        `sounds: ${locked.state} before a gesture (${locked.unlocked ? 'unlocked' : 'locked'}), ${unlocked.state} after Shift at gain ${unlocked.gain}; ` +
        `the whiff asked ${JSON.stringify(afterWhiff.asked)}, the chain to ${JSON.stringify(afterChain.asked)} (played ${JSON.stringify(afterChain.played)}, skipped ${JSON.stringify(afterChain.skipped)}, device errors ${afterChain.deviceErrors}); console errors ${JSON.stringify(log.errors)}`;
      console.log(line);
      // The sounds: locked until the gesture, then a whoosh for the whiff swing and a whiff at its end, no impact; then a
      // whoosh for each hit of the chain and an impact for each contact, and no further whiff.
      expect(locked.state, line).toBe('locked');
      expect(unlocked.state, line).toBe('running');
      expect(afterWhiff.asked, line).toEqual({ whoosh: 1, impact: 0, whiff: 1 });
      expect(afterChain.asked, line).toEqual({ whoosh: 4, impact: 3, whiff: 1 });
      // The whiff: a swing, but no contact, no stop, no sparks; its trail still drew.
      expect(whiffEnd.swings.at(-1), line).toMatchObject({ step: 1, connected: false });
      expect(whiffEnd.connects, line).toBe(0);
      expect(stops(whiff), line).toEqual([]);
      expect(whiffEnd.hitStop.lengths, line).toEqual([]);
      expect(whiffEnd.sparks.bursts, line).toBe(0);
      expect(Math.max(...whiff.map((frame) => frame.trail.points)), line).toBeGreaterThan(1);
      // The chain: three swings, each connected with the middle dummy alone.
      expect(end.swings.slice(-3), line).toEqual([
        expect.objectContaining({ step: 1, connected: true, dummies: [1] }),
        expect.objectContaining({ step: 2, connected: true, dummies: [1] }),
        expect.objectContaining({ step: 3, connected: true, dummies: [1] }),
      ]);
      // A stop of time at each contact, measured on the frames' clocks: 55, 55 and 90 ms (the blueprint's light and heavy).
      expect(measured.map((run) => run.step), line).toEqual([1, 2, 3]);
      measured.forEach((run, i) => expect(run.ms, line).toBeCloseTo([55, 55, 90][i]!, 3));
      // Sparks thrown at every contact, from the contact.
      expect(contacts.map((c) => c.bursts), line).toEqual([1, 2, 3]);
      for (const c of contacts) {
        expect(c.alive, line).toBeGreaterThan(0);
        expect(c.sparksAt, line).toEqual(c.contact);
      }
      // The middle dummy counted all three, flinched and was knocked back after each.
      expect(contacts.map((c) => c.hits), line).toEqual([1, 2, 3]);
      expect(chain.at(-1)!.middle.hits, line).toBe(3);
      for (const r of reactions) {
        expect(r.flinch, line).toBeGreaterThan(0.5);
        expect(r.knockback, line).toBeGreaterThan(0.05);
      }
      expect(log.errors, line).toEqual([]);
    });

    test("mutes the combat sounds from the feel folder's checkbox, zeroing their gain and suspending the context", async ({ page }) => {
      test.setTimeout(240_000);
      const log = collectConsole(page);
      await open(page);
      const sound = () => page.evaluate(() => (window.__P99__!['sound'] as () => SoundReading)());
      await page.keyboard.press('ShiftLeft');
      await page.waitForFunction(() => (window.__P99__!['sound'] as () => SoundReading)().state === 'running', undefined, { timeout: 30_000 });
      const before = await sound();
      // The panel starts closed under the phone layout's 768 px line, as this 480 px canvas is.
      await page.locator('.lil-gui.lil-root > .lil-title').click();
      const mute = page.locator('.lil-gui .lil-controller', { hasText: 'mute the combat sounds' }).locator('input[type=checkbox]');
      await mute.check();
      await page.waitForFunction(() => (window.__P99__!['sound'] as () => SoundReading)().state === 'suspended', undefined, { timeout: 30_000 });
      const muted = await sound();
      const address = new URL(page.url()).searchParams.get('feel');
      await mute.uncheck();
      // Unmuted, the gain comes back at once and the context is resumed, tried again about every second while it stays
      // suspended (RESUME_RETRY_FRAMES). Whether it runs again is the audio device's to say: alone this test reads it
      // running within a second or two, but among the suite's parallel headless browsers the device raised errors and
      // refused it for a minute (AUDIO_DEVICE_MESSAGE), so its resumption is read and printed, not held.
      await page.waitForFunction(() => !(window.__P99__!['sound'] as () => SoundReading)().muted, undefined, { timeout: 30_000 });
      const resumed = await page
        .waitForFunction(() => (window.__P99__!['sound'] as () => SoundReading)().state === 'running', undefined, { timeout: 10_000 })
        .then(() => true, () => false);
      const unmuted = await sound();
      const line =
        `combat arena mute [${test.info().project.name}]: before ${before.state} at gain ${before.gain}; muted ${muted.state} at gain ${muted.gain} (the address's feel ${address}); ` +
        `unmuted ${unmuted.state} (resumed ${resumed}) at gain ${unmuted.gain}, device errors ${unmuted.deviceErrors}; console errors ${JSON.stringify(log.errors)}, warnings ${JSON.stringify(log.warnings)}`;
      console.log(line);
      expect(before.gain, line).toBeGreaterThan(0);
      expect(muted.gain, line).toBe(0);
      expect(muted.muted, line).toBe(true);
      expect(JSON.parse(address ?? '{}'), line).toMatchObject({ mute: true });
      expect(unmuted.gain, line).toBe(before.gain);
      expect(unmuted.muted, line).toBe(false);
      expect(log.errors, line).toEqual([]);
      expect(log.warnings, line).toEqual([]);
    });

    test('puts the dummies and Pip back on R and on the panel\'s button, and the button hands the keys back to him', async ({ page }) => {
      test.setTimeout(240_000);
      const log = collectConsole(page);
      await open(page);
      // Each dummy is moved and hit through the page's debug hooks, since phase A has no hit reactions to move one, and
      // Pip walks a little, so a reset has something of each to restore.
      const disturb = () =>
        page.evaluate(() => {
          const p99 = window.__P99__!;
          const dummies = (p99['dummies'] as () => DummyReading[])();
          dummies.forEach((d, i) => (p99['moveDummy'] as (i: number, x: number, z: number, yaw: number) => boolean)(i, d.tangent[0]! + 0.4, d.tangent[1]! - 0.3, d.yaw + 0.5));
          (p99['hitDummy'] as (i: number) => boolean)(1);
          return (p99['dummies'] as () => DummyReading[])();
        });
      const walk = async () => {
        const from = (await read(page)).play.tangent!;
        await page.keyboard.down('KeyS');
        await page.waitForFunction((at) => {
          const now = (window.__P99__!['play'] as () => PlayReading)().tangent!;
          return Math.hypot(now[0]! - at[0]!, now[1]! - at[1]!) > 0.3;
        }, from);
        await page.keyboard.up('KeyS');
      };
      const afterFrames = () => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));

      await walk();
      const moved = await disturb();
      await page.keyboard.press('KeyR');
      await afterFrames();
      const byKey = await read(page);

      await walk();
      await disturb();
      // The panel starts closed under the phone layout's 768 px line, as this 480 px canvas is; a click opens it.
      await page.locator('.lil-gui.lil-root > .lil-title').click();
      await expect(page.locator('.lil-gui.lil-root')).not.toHaveClass(/\blil-closed\b/);
      const button = page.locator('.lil-gui button', { hasText: RESET_NAME });
      await button.click();
      await afterFrames();
      const byButton = await read(page);
      const focusAfterClick = await page.evaluate(() => (document.activeElement && document.querySelector('.lil-gui')?.contains(document.activeElement) ? 'in the panel' : 'the page'));
      // The keys reach him straight after the click: S walks him off the start.
      const before = byButton.play.tangent!;
      await page.keyboard.down('KeyS');
      await page.waitForFunction((at) => {
        const now = (window.__P99__!['play'] as () => PlayReading)().tangent!;
        return Math.hypot(now[0]! - at[0]!, now[1]! - at[1]!) > 0.1;
      }, before);
      await page.keyboard.up('KeyS');
      // A keyboard's press of the same button resets him too and leaves the focus on it, where the keyboard put it.
      await button.focus();
      await page.keyboard.press('Enter');
      await afterFrames();
      const byEnter = await read(page);
      const focusAfterEnter = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent ?? '');

      const atStart = (state: Awaited<ReturnType<typeof read>>) => JSON.stringify(state.play.tangent) === JSON.stringify(state.start.tangent) && state.play.yaw === state.start.yaw;
      const line =
        `combat arena reset [${test.info().project.name}]: moved the dummies to ${moved.map((d) => d.tangent.map((v) => v.toFixed(2)).join(',')).join(' / ')} with ${moved[1]!.hits} hit on the middle one; ` +
        `R: dummies home ${allHome(byKey.dummies)}, Pip at the start ${atStart(byKey)} (combo step ${byKey.play.comboStep}, speed ${byKey.play.speed}); ` +
        `button: dummies home ${allHome(byButton.dummies)}, Pip at the start ${atStart(byButton)}, focus on ${focusAfterClick}; ` +
        `Enter on the focused button: Pip at the start ${atStart(byEnter)}, focus on "${focusAfterEnter}"; console errors ${JSON.stringify(log.errors)}`;
      console.log(line);
      expect(moved.some((d) => Math.hypot(d.tangent[0]! - d.home.tangent[0]!, d.tangent[1]! - d.home.tangent[1]!) > 0.1), line).toBe(true);
      expect(moved[1]!.hits, line).toBe(1);
      for (const state of [byKey, byButton]) {
        expect(allHome(state.dummies), line).toBe(true);
        expect(atStart(state), line).toBe(true);
        expect(state.play.comboStep, line).toBe(0);
        expect(state.play.speed, line).toBe(0);
      }
      expect(focusAfterClick, line).toBe('the page');
      expect(atStart(byEnter), line).toBe(true);
      expect(focusAfterEnter, line).toBe(RESET_NAME);
      expect(log.errors, line).toEqual([]);
    });

    test('is reached from the home page, the Style Lab and the Asset World, whose link carries its combat feel', async ({ page }) => {
      test.setTimeout(300_000);
      const log = collectConsole(page);
      /** Waits for the arena to be up after a link, and returns its address. */
      const arrived = async (): Promise<URL> => {
        await page.waitForURL(/\/labs\/combat\.html/, { timeout: 60_000 });
        await page.waitForFunction(() => window.__P99__?.ready === true && window.__P99__?.page === 'combat', undefined, { timeout: 180_000 });
        return new URL(page.url());
      };
      // The 480 px canvas is under the phone layout's line, so each lab's panel starts closed behind its title.
      const openPanel = async () => {
        await page.locator('.lil-gui.lil-root > .lil-title').click();
        await expect(page.locator('.lil-gui.lil-root')).not.toHaveClass(/\blil-closed\b/);
      };
      const ARENA = 'Open the combat arena';

      await page.goto('./');
      await page.getByRole('link', { name: ARENA }).click();
      const fromHome = await arrived();

      await page.goto('./labs/style.html?tier=low');
      await page.waitForFunction(() => window.__P99__?.ready === true && window.__P99__?.page === 'style', undefined, { timeout: 180_000 });
      await openPanel();
      await page.locator('.lil-gui button', { hasText: ARENA }).click();
      const fromStyle = await arrived();

      // A feel moved off the defaults in the world goes with him, in the arena's own `?feel=`.
      const moved = JSON.stringify({ crossfade: 0.15 });
      await page.goto(`./labs/world.html?tier=low&feel=${encodeURIComponent(moved)}`);
      await page.waitForFunction(() => window.__P99__?.ready === true && window.__P99__?.page === 'world', undefined, { timeout: 180_000 });
      await openPanel();
      await page.locator('.lil-gui button', { hasText: ARENA }).click();
      const fromWorld = await arrived();
      const carried = JSON.parse(fromWorld.searchParams.get('feel') ?? '{}') as Record<string, number>;

      const line =
        `combat arena links [${test.info().project.name}]: home to ${fromHome.pathname}${fromHome.search}, Style Lab to ${fromStyle.pathname}${fromStyle.search}, ` +
        `Asset World to ${fromWorld.pathname} with feel ${JSON.stringify(carried)}; console errors ${JSON.stringify(log.errors)}`;
      console.log(line);
      for (const at of [fromHome, fromStyle, fromWorld]) expect(at.pathname.endsWith('/labs/combat.html'), line).toBe(true);
      // The home page and the Style Lab hand over no feel: the arena opens on the defaults.
      expect(fromHome.searchParams.get('feel'), line).toBeNull();
      expect(fromStyle.searchParams.get('feel'), line).toBeNull();
      expect(carried.crossfade, line).toBe(0.15);
      expect(log.errors, line).toEqual([]);
    });

    // The owner follows the work on a phone: upright and on its side, the pad and the Attack button must stay uncovered.
    for (const size of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      test.describe(`on a ${size.width} x ${size.height} touch phone`, () => {
        test.use({ viewport: size, hasTouch: true, isMobile: true });

        test('shows the thumb pad and the Attack button uncovered by the controls card and the panel, closed or open', async ({ page }) => {
          test.setTimeout(240_000);
          const log = collectConsole(page);
          await open(page);
          await expect(page.locator('#pad')).toBeVisible();
          await expect(page.locator('#attack')).toBeVisible();
          await expect(page.locator('#controls')).toBeVisible();
          const gui = page.locator('.lil-gui.lil-root');
          // On a touch screen the panel starts closed, so the canvas and both controls are clear from the first frame.
          await expect(gui).toHaveClass(/\blil-closed\b/);
          const layout = () =>
            page.evaluate(() => {
              const box = (node: Element) => {
                const r = node.getBoundingClientRect();
                return { x: r.x, y: r.y, width: r.width, height: r.height };
              };
              // Each control is hit where a thumb lands on it: its centre and four points halfway to its edges.
              const uncovered = (selector: string) => {
                const node = document.querySelector(selector)!;
                const r = node.getBoundingClientRect();
                return [
                  [0.5, 0.5],
                  [0.25, 0.5],
                  [0.75, 0.5],
                  [0.5, 0.25],
                  [0.5, 0.75],
                ].every(([fx, fy]) => {
                  const hit = document.elementFromPoint(r.x + r.width * fx!, r.y + r.height * fy!);
                  return hit !== null && (hit === node || node.contains(hit));
                });
              };
              return {
                pad: { ...box(document.querySelector('#pad')!), uncovered: uncovered('#pad') },
                attack: { ...box(document.querySelector('#attack')!), uncovered: uncovered('#attack') },
                card: box(document.querySelector('#controls')!),
                panel: box(document.querySelector('.lil-gui.lil-root')!),
              };
            });
          const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
            a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
          const closed = await layout();
          await page.locator('.lil-gui.lil-root > .lil-title').tap();
          await expect(gui).not.toHaveClass(/\blil-closed\b/);
          await expect(gui).not.toHaveClass(/\blil-transition\b/);
          const opened = await layout();
          const describe = (l: Awaited<ReturnType<typeof layout>>) =>
            `pad ${Math.round(l.pad.width)}x${Math.round(l.pad.height)} at (${Math.round(l.pad.x)}, ${Math.round(l.pad.y)}) uncovered ${l.pad.uncovered}, ` +
            `Attack ${Math.round(l.attack.width)}x${Math.round(l.attack.height)} at (${Math.round(l.attack.x)}, ${Math.round(l.attack.y)}) uncovered ${l.attack.uncovered}, ` +
            `card ${Math.round(l.card.width)}x${Math.round(l.card.height)} at (${Math.round(l.card.x)}, ${Math.round(l.card.y)}), panel ${Math.round(l.panel.width)}x${Math.round(l.panel.height)} at (${Math.round(l.panel.x)}, ${Math.round(l.panel.y)})`;
          const line = `combat arena phone [${test.info().project.name}] ${size.width} x ${size.height}: closed: ${describe(closed)}; open: ${describe(opened)}; console errors ${JSON.stringify(log.errors)}`;
          console.log(line);
          for (const l of [closed, opened]) {
            expect(l.pad.uncovered, line).toBe(true);
            expect(l.attack.uncovered, line).toBe(true);
            for (const control of [l.pad, l.attack]) {
              expect(overlaps(control, l.panel), line).toBe(false);
              expect(overlaps(control, l.card), line).toBe(false);
            }
          }
          expect(log.errors, line).toEqual([]);
        });
      });
    }
  });
});
