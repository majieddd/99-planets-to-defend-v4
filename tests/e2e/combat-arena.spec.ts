import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { ARENA_DUMMY_NAMES } from '../../src/labs/combat/arena';

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
}

/** What `__P99__.dummies()` reads of one training dummy (labs/combat/main.ts). */
interface DummyReading {
  name: string;
  position: number[];
  tangent: number[];
  yaw: number;
  home: { tangent: number[]; yaw: number };
  reach: number;
  hits: number;
  fromPip: { distance: number; angleDeg: number } | null;
}

interface CameraReading {
  position: number[];
  target: number[];
}

/**
 * How far in front of his root Pip's blade tip reaches at the strike, from his build's own measure (the sidecar's
 * strike_blade_tip, Blender's -y ahead): 1.12 m. Phase B's hit detection replaces this reading with real hits.
 */
const tip = (JSON.parse(readFileSync('public/assets/commanders/commander_pip.meta.json', 'utf8')) as { notes: { attack_checks: { strike_blade_tip: { x: number; y: number } } } }).notes.attack_checks
  .strike_blade_tip;
const BLADE_REACH = Math.hypot(tip.x, tip.y);
/** The widest a dummy may stand off his facing at a strike, or his facing off the middle dummy at the start, in degrees. */
const FACING_DEG = 15;

/** The panel's reset button's name (RESET_NAME, labs/combat/panel.ts, which this file does not import: it loads lil-gui). */
const RESET_NAME = 'Reset the dummies and Pip (R)';

/** The Pages project serves the site under this path (playwright.config.ts). */
const PAGES_BASE = '/99-planets-to-defend-v4/';

/**
 * Chromium's own GPU process message on the first WebGL page a fresh SwiftShader browser draws, "GL Driver Message
 * (OpenGL, Performance, ...): GPU stall due to ReadPixels". It is the browser's, not the page's: the Asset World and the
 * Style Lab give the same four lines when they are the first page (2026-10-05), the page loaded second gives none, and
 * the arena on the GPU gives none. The page's own warnings, every other one, must be none.
 */
const BROWSER_GPU_MESSAGE = /^\[\.WebGL-[0-9a-fx]+\]GL Driver Message /;

function collectConsole(page: Page): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
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
      `console errors ${JSON.stringify(log.errors)}, warnings ${JSON.stringify(log.warnings)}`;
    console.log(line);
    expect(log.errors, line).toEqual([]);
    expect(log.warnings, line).toEqual([]);
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
      // opens, as the Asset World's chain test does; the recorder keeps every dummy's reading on each strike's frame.
      await page.evaluate(() => {
        type Strike = { step: number; dummies: DummyReading[] };
        const store = window as unknown as { strikes: Strike[]; presses: number; stop: boolean };
        const p99 = window.__P99__!;
        const play = () => (p99['play'] as () => PlayReading)();
        const press = (): void => {
          store.presses += 1;
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f' }));
          window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', key: 'f' }));
        };
        store.strikes = [];
        store.presses = 0;
        store.stop = false;
        const pressedIn = new Set<number>();
        let last = play().strikes;
        const tick = (): void => {
          if (store.stop) return;
          const sample = play();
          if (sample.strikes > last) store.strikes.push({ step: sample.lastStrikeStep ?? 0, dummies: (p99['dummies'] as () => DummyReading[])() });
          last = sample.strikes;
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
      await page.waitForFunction(() => (window as unknown as { strikes: unknown[] }).strikes.length >= 3, undefined, { timeout: 120_000 });
      const result = await page.evaluate(() => {
        const store = window as unknown as { strikes: { step: number; dummies: DummyReading[] }[]; presses: number; stop: boolean };
        store.stop = true;
        return { strikes: store.strikes, presses: store.presses, play: (window.__P99__!['play'] as () => PlayReading)() };
      });
      const atStrike = result.strikes.map((strike) => {
        const middle = strike.dummies[1]!;
        const nearest = [...strike.dummies].sort((a, b) => a.fromPip!.distance - a.reach - (b.fromPip!.distance - b.reach))[0]!;
        return { step: strike.step, middle, nearest };
      });
      const line =
        `combat arena chain [${test.info().project.name}]: ${result.presses} presses; strikes at steps ${atStrike.map((s) => s.step).join(', ')}; ` +
        atStrike
          .map(
            (s) =>
              `attack_${s.step}: the middle dummy ${s.middle.fromPip!.distance.toFixed(3)} m from his root (its reach ${s.middle.reach.toFixed(3)} m, so ${(s.middle.fromPip!.distance - s.middle.reach).toFixed(3)} m beyond it against the blade's ${BLADE_REACH.toFixed(3)} m) ` +
              `at ${s.middle.fromPip!.angleDeg.toFixed(2)} degrees, the nearest ${s.nearest.name} at ${s.nearest.fromPip!.distance.toFixed(3)} m and ${s.nearest.fromPip!.angleDeg.toFixed(2)} degrees`,
          )
          .join('; ') +
        `; strikes by hit ${JSON.stringify(result.play.strikesByStep)}; console errors ${JSON.stringify(log.errors)}`;
      console.log(line);
      expect(atStrike.map((s) => s.step), line).toEqual([1, 2, 3]);
      expect(result.play.strikesByStep, line).toEqual([1, 1, 1]);
      for (const s of atStrike) {
        expect(s.nearest.name, line).toBe('dummy_middle');
        expect(s.middle.fromPip!.distance - s.middle.reach, line).toBeLessThanOrEqual(BLADE_REACH);
        expect(Math.abs(s.middle.fromPip!.angleDeg), line).toBeLessThan(FACING_DEG);
      }
      expect(log.errors, line).toEqual([]);
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
