import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { clipHasReason, coverageGaps, LEAN, MEMBERS, type CoverageManifest } from '../../src/labs/world/registry';
import { FOCUSED_MEMBER_LABEL_ROOM_PX } from '../../src/labs/world/views';
import { DEFAULT_DIALS } from '../../src/render/defaults';
import { encodeDials } from '../../src/render/dialsCodec';
import { STYLE_PLANET_RADIUS } from '../../src/render/terrain/stylePatch';

interface ManifestEntry {
  name: string;
  kind: string;
  family: string;
  nodes: string[];
  animations: { name: string }[];
  ground?: { node: string | null; minY: number; sink: number }[];
}

interface Root {
  name: string;
  entry: string;
  node: string | null;
  family: string;
  zone: string;
  clip: string | null;
  position: [number, number, number];
}

interface CameraReading {
  position: number[];
  target: number[];
  projection: number[];
  view: number[];
}

interface LabelReading {
  key: string;
  kind: 'family' | 'member';
  text: string;
  line: string | null;
  shown: boolean;
  /** The point the label marks, in CSS pixels from the canvas's top left. */
  x: number;
  y: number;
  fontPx: number;
}

/** What `__P99__.play()` reads of the play prototype (labs/world/play.ts). */
interface PlayReading {
  on: boolean;
  position: number[] | null;
  tangent: number[] | null;
  speed: number;
  runWeight: number;
  runTimeScale: number;
  stride: { loopMetres: number; loopSeconds: number; clipSpeed: number } | null;
  /** How far he stands outside the nearest member's reach, in metres (negative inside one). */
  clearance: number | null;
  yaw: number;
  /** His swing: whether he is in one, the attack clip's time and weight, the clip's length, its strike, and strikes so far. */
  attacking: boolean;
  attackTime: number | null;
  attackWeight: number;
  attackSeconds: number | null;
  strikeAt: number | null;
  strikes: number;
}

const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')) as { assets: ManifestEntry[] };

/**
 * What the world must place, read from the shipped manifest here rather than from the page, so a new asset cannot miss
 * the world without failing this test: every model, every piece of an environment kit, and every placeable the
 * manifest's ground records name for an asset that is not placed whole.
 */
function required(): string[] {
  const names = new Set<string>();
  for (const entry of manifest.assets.filter((asset) => asset.kind === 'model')) {
    names.add(entry.name);
    if (entry.family === 'env') for (const node of entry.nodes) names.add(node);
    const ground = entry.ground ?? [];
    if (ground.length && !ground.some((record) => record.node === null)) for (const record of ground) names.add(record.node as string);
  }
  return [...names];
}

/**
 * How far a member's lowest drawn point may sit from the ground under it, beyond its designed sink, in metres (the
 * browser test's ground allowances, Asset World layout). The Kit's ground contract allows 5 mm of rounding. A
 * structure's lean follows its slope only so far, and its footprint's edges stray up to 4.4 cm from the ground (LEAN);
 * the kit's rocks and flora lean on the arc's slopes only as far as the Style Lab's scatter does; and a character stands
 * plumb in its clip's opening pose, not the bind pose the contract measures, so a character's float and sink are held
 * apart. Its float may reach 5.5 cm: Bulwark's run opens with both feet off the ground, 3.8 cm up on the level
 * clearing, and since Pip's attack member moved Bulwark's row 2.6 m further onto the slope it reads 5.24 cm at 18 m
 * from the pole, where the ground falls away under his plumb stance. Its sink may reach 1 cm, a 1.5 cm limit with the
 * contract: the deepest character reads 0.71 cm, Pip's attack member standing plumb on the slope 10.6 m out, while
 * Pip's idle sank 1.69 cm and his face member 3.47 cm before the recipe's ground pass (the idle's sword tip in the
 * ground). One allowance for both sides, checked on the size of the reading alone, had loosened sinking to the 6.0 cm
 * limit only Bulwark's float needed, which passed both. Both stay far under the 15 to 26 cm by which misplaced roots
 * once sank.
 */
const CONTRACT_M = 0.005;
const STRUCTURE_STRAY_M = 0.044;
const KIT_STRAY_M = 0.025;
const CLIP_FLOAT_M = 0.055;
const CLIP_SINK_M = 0.01;

/** A member's allowance beyond the contract above its designed sink (float) and below it (sink), in metres. */
function groundAllowance(member: (typeof MEMBERS)[number]): { float: number; sink: number } {
  if (member.clip) return { float: CLIP_FLOAT_M, sink: CLIP_SINK_M };
  const stray = member.entry === 'verdant_kit' ? KIT_STRAY_M : member.lean === LEAN.structure ? STRUCTURE_STRAY_M : 0;
  return { float: stray, sink: stray };
}

function collectConsole(page: Page): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
    if (message.type() === 'warning') warnings.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return { errors, warnings };
}

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`./labs/world.html${query}`);
  await page.waitForFunction(() => window.__P99__?.ready === true && window.__P99__?.page === 'world', undefined, { timeout: 180_000 });
}

/** The play recorder's state in the page (startRecording). */
type Recorder = { playSamples: PlayReading[]; playStop: boolean; playMark: number };

/**
 * Starts reading play() on every frame in the page, since reads from the test, each a round trip to a page busy under
 * SwiftShader, once let the whole 0.83 s swing pass between two of them. The first reading is taken at once. With
 * `pressF`, F's keydown and keyup are dispatched in the same call, right after it, so the swing starts from the state
 * recorded: pressed from the test once the recorder had started, F came a round trip later, while he ran on under the
 * held key toward whatever stood ahead.
 */
async function startRecording(page: Page, pressF = false): Promise<void> {
  await page.evaluate((press) => {
    const recorder = window as unknown as Recorder;
    recorder.playSamples = [(window.__P99__!['play'] as () => PlayReading)()];
    recorder.playStop = false;
    const tick = (): void => {
      if (recorder.playStop) return;
      recorder.playSamples.push((window.__P99__!['play'] as () => PlayReading)());
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    if (press) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', key: 'f' }));
    }
  }, pressF);
}

/** Stops the recorder and returns every reading it took. */
async function stopRecording(page: Page): Promise<PlayReading[]> {
  return page.evaluate(() => {
    const recorder = window as unknown as Recorder;
    recorder.playStop = true;
    return recorder.playSamples;
  });
}

/** Waits until the recorder has seen a swing begin and end, and, with `running`, him run again after it. */
async function waitForSwing(page: Page, running: boolean): Promise<void> {
  await page.waitForFunction(
    (run) => {
      const samples = (window as unknown as Recorder).playSamples;
      const first = samples.findIndex((sample) => sample.attacking);
      return first >= 0 && samples.slice(first).some((sample) => !sample.attacking && (!run || sample.runWeight > 0.5));
    },
    running,
    { timeout: 60_000 },
  );
}

/**
 * The frames the recorder runs on past a click's or a drag's release to see whether it started a swing. The page's next
 * frame takes an attack the release asked for, so a swing shows within a frame or two of it; five leave room to spare
 * and cost a quarter of a second at SwiftShader's 20 frames a second.
 */
const SWING_SHOWS_WITHIN_FRAMES = 5;

/** How long the click test holds its press, a fifth of PLAY_CLICK_MAX_SECONDS and about half an ordinary click, in ms. */
const CLICK_HOLD_MS = 50;

/** The page's event times of the click test's press and release, in ms (null until each arrives). */
type ClickTimes = { down: number | null; up: number | null };

/**
 * Marks how many frames the recorder has read and waits until it has read `frames` more, or, with `untilSwing`, until it
 * has seen a swing, if that comes first.
 */
async function waitFramesPast(page: Page, frames: number, untilSwing: boolean): Promise<void> {
  await page.evaluate(() => {
    const recorder = window as unknown as Recorder;
    recorder.playMark = recorder.playSamples.length;
  });
  await page.waitForFunction(
    ([count, swing]) => {
      const recorder = window as unknown as Recorder;
      return (swing && recorder.playSamples.some((sample) => sample.attacking)) || recorder.playSamples.length >= recorder.playMark + count;
    },
    [frames, untilSwing] as const,
    { timeout: 60_000 },
  );
}

/** How many swings a recording saw begin. */
const swingsIn = (samples: readonly PlayReading[]): number => samples.filter((sample, index) => sample.attacking && !(samples[index - 1]?.attacking ?? false)).length;

/** Where a world point lands on screen under a camera reading, in normalized device coordinates, and whether in front. */
function project(camera: CameraReading, [x, y, z]: readonly number[]): { x: number; y: number; w: number } {
  const v = camera.view;
  const p = camera.projection;
  const at = (m: number[], row: number, col: number) => m[col * 4 + row] as number;
  const eye = [0, 1, 2, 3].map((row) => at(v, row, 0) * (x as number) + at(v, row, 1) * (y as number) + at(v, row, 2) * (z as number) + at(v, row, 3));
  const clip = [0, 1, 3].map((row) => at(p, row, 0) * (eye[0] as number) + at(p, row, 1) * (eye[1] as number) + at(p, row, 2) * (eye[2] as number) + at(p, row, 3) * (eye[3] as number));
  const w = clip[2] as number;
  return { x: (clip[0] as number) / w, y: (clip[1] as number) / w, w };
}

const inFrame = (camera: CameraReading, point: readonly number[]) => {
  const at = project(camera, point);
  return at.w > 0 && Math.abs(at.x) <= 1 && Math.abs(at.y) <= 1;
};

/** The Pages project serves the site under this path (playwright.config.ts). */
const PAGES_BASE = '/99-planets-to-defend-v4/';

// Each test opens its own page, so the three may run on different workers, beside the Style Lab's tests in CI.
test.describe.configure({ mode: 'parallel' });

test.describe('the Asset World', () => {
  // A small canvas keeps SwiftShader's frames cheap, as the Style Lab's handle test does.
  test.use({ viewport: { width: 480, height: 270 } });

  test('places every manifest model, piece and clip on the ground, inside the overview, in the locked defaults', async ({ page }) => {
    test.setTimeout(240_000);
    const log = collectConsole(page);
    // An empty ?member= is absent, so the good ?family= behind it opens (the page once read member ?? family).
    await open(page, '?tier=low&member=&family=towers');
    // Everything from one call once the page is ready: every call waits on SwiftShader's frame, so each one costs.
    const state = await page.evaluate((radius) => {
      const p99 = window.__P99__!;
      const call = <T>(name: string, ...args: unknown[]) => (p99[name] as (...a: unknown[]) => T)(...args);
      const surfaceAt = (x: number, z: number) => call<number[]>('surfaceAt', x, z);
      const read = {
        assets: p99['assets'] as boolean,
        look: p99['look'] as string,
        placed: p99['placed'] as string[],
        focused: call<string>('focused'),
        search: location.search,
        dials: call<Record<string, unknown>>('dials'),
        roots: call<Root[]>('roots'),
        // Each member's lowest drawn point, and the ground on the planet's radius through it.
        contacts: call<{ name: string; lowest: number[] }[]>('bounds').map(({ name, lowest }) => {
          const [x, y, z] = lowest as [number, number, number];
          const up = y + radius;
          return { name, lowest, ground: surfaceAt((x / up) * radius, (z / up) * radius) };
        }),
        towers: call<CameraReading>('camera'),
        towerLabels: call<LabelReading[]>('labels').filter((label) => label.shown).map((label) => label.text),
        frameMs: call<number>('frameMs'),
        // Pip's faces, read after frames have drawn, when every hull has re-pointed at its body's morph influences.
        faces: call<{ name: string; blink: number; hullsShared: boolean }[]>('faces'),
        overview: null as CameraReading | null,
      };
      // The overview's camera, read and left within this call, so SwiftShader never draws the whole world: a frame of it
      // took seconds under CI's software GL and held up the page's close by as long.
      call('focus', 'overview');
      read.overview = call<CameraReading>('camera');
      call('focus', 'towers');
      return read;
    }, STYLE_PLANET_RADIUS);

    const need = required();
    const missing = need.filter((name) => !state.placed.includes(name));
    // The registry accounts for the manifest (models, pieces, clips, textures), and the page placed the whole registry.
    const gaps = coverageGaps(manifest as CoverageManifest);
    const registry = [...new Set(MEMBERS.flatMap((m) => [m.entry, m.name]))];
    // A clip CLIPS_NOT_SHOWN gives a written reason for needs no root, as the coverage check accepts.
    const unlooped = manifest.assets.flatMap((entry) =>
      (entry.animations ?? [])
        .filter((clip) => !clipHasReason(entry.name, clip.name) && !state.roots.some((root) => root.entry === entry.name && root.clip === clip.name))
        .map((clip) => `${entry.name}/${clip.name}`),
    );

    // Ground contact: each member's lowest drawn point, against the ground on the planet's radius through it, sits at
    // its designed sink, within the contract and the allowance its kind is documented to need.
    const centre = [0, -STYLE_PLANET_RADIUS, 0];
    const fromCentre = (point: number[]) => Math.hypot(...point.map((v, i) => v - (centre[i] as number)));
    const contacts = state.contacts.map((contact) => {
      const member = MEMBERS.find((m) => m.name === contact.name);
      expect(member, `the page placed "${contact.name}", which the registry does not list`).toBeDefined();
      const { entry, node } = member!;
      const record = manifest.assets.find((asset) => asset.name === entry)?.ground?.find((r) => r.node === node);
      expect(record, `the manifest has no ground record for member "${contact.name}" (entry "${entry}", node ${JSON.stringify(node)})`).toBeDefined();
      const height = fromCentre(contact.lowest) - fromCentre(contact.ground);
      const allowance = groundAllowance(member!);
      return { name: contact.name, off: height + record!.sink, float: CONTRACT_M + allowance.float, sink: CONTRACT_M + allowance.sink };
    });
    // Each side against its own limit: above the ground by the float, below it by the sink.
    const limitOf = (contact: (typeof contacts)[number]) => (contact.off >= 0 ? contact.float : contact.sink);
    const unground = contacts.filter((contact) => contact.off > contact.float || -contact.off > contact.sink);
    const worst = contacts.reduce((a, b) => (Math.abs(b.off) / limitOf(b) > Math.abs(a.off) / limitOf(a) ? b : a));
    const sinking = contacts.filter((contact) => contact.off < 0);
    const deepest = sinking.length ? sinking.reduce((a, b) => (b.off < a.off ? b : a)) : null;

    // The commanders' zone, left to right as placed: Pip (commander), the default, first, then Bulwark, the alternate.
    const commanders = state.roots.filter((root) => root.zone === 'commanders').map((root) => root.name);
    const towers = state.roots.filter((root) => root.family === 'towers');
    const towersUnframed = towers.filter((root) => !inFrame(state.towers, root.position)).map((root) => root.name);
    const outside = state.roots.filter((root) => !inFrame(state.overview!, root.position)).map((root) => root.name);

    const line =
      `asset world [${test.info().project.name}]: assets ${state.assets}, look ${state.look}, opened ${state.focused} (${state.search}), ` +
      `placed ${state.placed.length} names covering ${need.length - missing.length} of ${need.length} required, missing ${JSON.stringify(missing)}, ` +
      `registry gaps ${JSON.stringify(gaps)}, clips no root loops ${JSON.stringify(unlooped)}, ${state.roots.length} roots, ` +
      `ground: nearest its limit ${worst.name} ${(worst.off * 100).toFixed(2)} cm off its sink (limit ${worst.off >= 0 ? '+' : '-'}${(limitOf(worst) * 100).toFixed(1)} cm), ` +
      `deepest ${deepest ? `${deepest.name} ${(deepest.off * 100).toFixed(2)} cm (limit -${(deepest.sink * 100).toFixed(1)} cm)` : 'none'}, off their limit ${JSON.stringify(unground)}; ` +
      `ground offsets ${contacts.map((c) => `${c.name} ${(c.off * 100).toFixed(2)}`).join(', ')} cm; ` +
      `towers view unframed ${JSON.stringify(towersUnframed)}, labels ${JSON.stringify(state.towerLabels)}; outside the overview ${JSON.stringify(outside)}; ` +
      `commanders ${JSON.stringify(commanders)}; ` +
      `faces ${JSON.stringify(state.faces.map((face) => `${face.name} hulls ${face.hullsShared ? 'shared' : 'NOT shared'}`))}; ` +
      `frame interval ${state.frameMs.toFixed(0)} ms, ${log.errors.length} console errors`;
    console.log(line);
    expect(state.assets, line).toBe(true);
    expect(missing, line).toEqual([]);
    expect(gaps, line).toEqual([]);
    expect([...state.placed].sort(), line).toEqual([...registry].sort());
    expect(state.roots.map((root) => root.name), line).toEqual(MEMBERS.map((m) => m.name));
    expect(unlooped, line).toEqual([]);
    expect(unground, line).toEqual([]);
    expect(state.focused, line).toBe('towers');
    expect(state.search, line).toBe('?tier=low&family=towers');
    expect(towersUnframed, line).toEqual([]);
    expect(state.towerLabels, line).toEqual(['Bolt Sentinel', 'Mark I', 'Mark II', 'Mark III']);
    expect(outside, line).toEqual([]);
    expect(commanders, line).toEqual(['pip_idle', 'pip_run', 'pip_face', 'pip_attack', 'bulwark_idle', 'bulwark_run', 'bulwark_attack']);
    // Every Pip instance has its own face, and every one of their hulls follows its body's morphs, the copies' too.
    expect(state.faces.map((face) => face.name), line).toEqual(['pip_idle', 'pip_run', 'pip_face', 'pip_attack']);
    expect(state.faces.every((face) => face.hullsShared), line).toBe(true);
    // With no dials link the world opens on DEFAULT_DIALS, Painted-Anime-Inkline 4.0, the set the Style Lab opens on.
    expect(state.look, line).toBe('locked');
    expect(state.dials, line).toEqual(DEFAULT_DIALS);
    expect(log.errors, line).toEqual([]);
  });

  test.describe('beyond the load', () => {
    test.skip(({ baseURL }) => Boolean(baseURL?.endsWith(PAGES_BASE)), 'The Pages project keeps the load test for its base path; the views, the panel and the phone layout need no second run.');

    test('names a bad address and falls back, opens a member with its family named, takes a dials link, and drives the panel', async ({ page }) => {
      test.setTimeout(240_000);
      const log = collectConsole(page);
      const link = encodeDials({ ...DEFAULT_DIALS, sunElevation: 30 });
      await open(page, `?tier=low&family=no_such_family&member=bolt_mk2&dials=${link}`);
      const member = await page.evaluate((lockedSun) => {
        const p99 = window.__P99__!;
        const call = <T>(name: string, ...args: unknown[]) => (p99[name] as (...a: unknown[]) => T)(...args);
        // The focused label's box, and the room it takes above the point it marks, box and tail together, which the
        // view keeps in frame as FOCUSED_MEMBER_LABEL_ROOM_PX.
        const reading = call<LabelReading[]>('labels').find((label) => label.key === 'bolt_mk2' && label.shown);
        const box = document.querySelector('.world-label-focused:not([hidden])')?.getBoundingClientRect();
        const read = {
          focusedLabel: reading && box ? { height: box.height, room: reading.y - box.top } : null,
          lookTabIndex: (document.getElementById('look') as HTMLButtonElement).tabIndex,
          focused: call<string>('focused'),
          search: location.search,
          banner: document.getElementById('banner')!.hidden ? '' : document.getElementById('banner')!.textContent,
          look: p99['look'] as string,
          chip: document.querySelector('#look .look-name')!.textContent,
          dials: call<Record<string, unknown>>('dials'),
          camera: call<CameraReading>('camera'),
          root: call<Root[]>('roots').find((root) => root.name === 'bolt_mk2')!,
          labels: call<LabelReading[]>('labels').filter((label) => label.shown).map((label) => ({ text: label.text, line: label.line })),
          relocked: '',
          relockedChip: '',
        };
        // Moving the dials back to the locked set turns the look back to the locked one, chip and handle alike.
        call('setDials', { sunElevation: lockedSun });
        read.relocked = p99['look'] as string;
        read.relockedChip = document.querySelector('#look .look-name')!.textContent ?? '';
        return read;
      }, DEFAULT_DIALS.sunElevation);
      const at = project(member.camera, member.root.position);
      const labelBox = (box: { height: number; room: number } | null) => (box ? `${box.height.toFixed(1)} px tall, ${box.room.toFixed(1)} px of room` : 'not shown');
      const line =
        `asset world address [${test.info().project.name}]: member view ${member.focused} (${member.search}), banner "${member.banner}", ` +
        `warnings ${JSON.stringify(log.warnings)}, mark II at ndc ${at.x.toFixed(3)}, ${at.y.toFixed(3)}, labels ${JSON.stringify(member.labels)}, ` +
        `focused label ${labelBox(member.focusedLabel)} (limit ${FOCUSED_MEMBER_LABEL_ROOM_PX}), look chip tab index ${member.lookTabIndex}, ` +
        `look ${member.look} then ${member.relocked} ("${member.relockedChip}"), sun ${String(member.dials['sunElevation'])}, ${log.errors.length} console errors`;
      console.log(line);
      // The bad family is named in the console and the banner; the good member opens, and the address keeps only it.
      expect(log.warnings.filter((text) => text.includes('no family named "no_such_family"')), line).toHaveLength(1);
      expect(member.banner, line).toBe('No family named "no_such_family"; showing the member bolt_mk2.');
      expect(member.focused, line).toBe('bolt_mk2');
      expect(member.search, line).toBe(`?tier=low&dials=${link}&member=bolt_mk2`);
      expect(at.w > 0 && Math.abs(at.x) < 0.9 && Math.abs(at.y) < 0.9, line).toBe(true);
      // A member's view names the member alone, with its family as the label's second line, and no family placard.
      expect(member.labels, line).toEqual([{ text: 'Mark II', line: 'Bolt Sentinel' }]);
      // The two-line label takes no more room above its point than the view keeps for it.
      expect(member.focusedLabel, line).not.toBeNull();
      expect(member.focusedLabel!.room, line).toBeGreaterThan(member.focusedLabel!.height);
      expect(member.focusedLabel!.room, line).toBeLessThanOrEqual(FOCUSED_MEMBER_LABEL_ROOM_PX);
      // Under the phone line the look chip is a toggle, and a tab stop.
      expect(member.lookTabIndex, line).toBe(0);
      // A link names only what differs from the locked defaults, and every dial it does not name keeps its default.
      expect(member.look, line).toBe('link');
      expect(member.dials, line).toEqual({ ...DEFAULT_DIALS, sunElevation: 30 });
      expect(member.relocked, line).toBe('locked');
      expect(member.relockedChip, line).toContain('(locked)');

      // The panel: choosing a view glides there and puts it in the address; the slider sets the fourth heart's stage and
      // its label; the turntable turns the camera around the view's target at a constant distance.
      const control = (name: string) => page.locator('.lil-gui .lil-controller', { has: page.locator('.lil-name', { hasText: new RegExp(`^${name}$`) }) });
      // The 480 px test canvas is under the phone layout's 768 px line, so the panel starts closed behind its title.
      await page.locator('.lil-gui.lil-root > .lil-title').click();
      await expect(page.locator('.lil-gui.lil-root')).not.toHaveClass(/\blil-closed\b/);
      await control('view').locator('select').selectOption({ label: 'Worldheart (heart)' });
      await page.waitForFunction(() => (window.__P99__!['focused'] as () => string)() === 'heart' && location.search.includes('family=heart'));
      await control('slider heart level').locator('input').first().fill('3');
      await page.keyboard.press('Enter');
      // The turntable waits while a view glides in, so the glide the panel started ends first.
      await page.waitForFunction(() => (window.__P99__!['gliding'] as () => boolean)() === false);
      // The one full-frame capture: a focused family, drawn after the glide, with the slider heart at its new stage, and
      // the panel closed again, since on this canvas it covers most of the view.
      await page.locator('.lil-gui.lil-root > .lil-title').click();
      await expect(page.locator('.lil-gui.lil-root')).toHaveClass(/\blil-closed\b/);
      await expect(page.locator('.lil-gui.lil-root')).not.toHaveClass(/\blil-transition\b/);
      await page.screenshot({ path: `test-results/${test.info().project.name}/world-heart.png` });
      const before = await page.evaluate(() => {
        const p99 = window.__P99__!;
        const reading = {
          hearts: (p99['labels'] as () => LabelReading[])().filter((label) => label.shown).map((label) => label.text),
          camera: (p99['camera'] as () => CameraReading)(),
        };
        (p99['setTurntable'] as (on: boolean) => void)(true);
        return reading;
      });
      // The orbit's damping eases the turn in, so the test waits for the camera to have moved a clear 0.1 m, however few
      // frames SwiftShader draws a second, and then holds the turn to its circle.
      await page.waitForFunction((start) => {
        const now = (window.__P99__!['camera'] as () => CameraReading)().position;
        return Math.hypot(...now.map((v, i) => v - (start[i] as number))) > 0.1;
      }, before.camera.position);
      const after = await page.evaluate(() => (window.__P99__!['camera'] as () => CameraReading)());
      const radius = (reading: CameraReading) => Math.hypot(...reading.position.map((v, i) => v - (reading.target[i] as number)));
      const turned = Math.hypot(...after.position.map((v, i) => v - (before.camera.position[i] as number)));
      const panelLine = `asset world panel [${test.info().project.name}]: heart labels ${JSON.stringify(before.hearts)}, turntable moved the camera ${turned.toFixed(3)} m at ${radius(before.camera).toFixed(2)} to ${radius(after).toFixed(2)} m from its target`;
      console.log(panelLine);
      expect(before.hearts, panelLine).toContain('Stage 3 (slider)');
      expect(turned, panelLine).toBeGreaterThan(0.1);
      expect(Math.abs(radius(after) - radius(before.camera)), panelLine).toBeLessThan(0.01);
      expect(after.target, panelLine).toEqual(before.camera.target);

      // Past the phone line a label's text and tail are at their largest (world.css), so its room is read there too, on a
      // canvas just wide enough to cross the line; there the look chip is no toggle and leaves the tab order.
      await page.evaluate(() => {
        const p99 = window.__P99__!;
        (p99['setTurntable'] as (on: boolean) => void)(false);
        (p99['focus'] as (name: string) => boolean)('bolt_mk2');
      });
      await page.setViewportSize({ width: 800, height: 450 });
      const wide = await page.evaluate(async () => {
        // The resize refits the view, and the labels follow it in the frames after.
        await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
        const p99 = window.__P99__!;
        const reading = (p99['labels'] as () => LabelReading[])().find((label) => label.key === 'bolt_mk2' && label.shown);
        const box = document.querySelector('.world-label-focused:not([hidden])')?.getBoundingClientRect();
        return {
          width: innerWidth,
          focusedLabel: reading && box ? { height: box.height, room: reading.y - box.top } : null,
          lookTabIndex: (document.getElementById('look') as HTMLButtonElement).tabIndex,
        };
      });
      const wideLine = `asset world wide [${test.info().project.name}]: at ${wide.width} px the focused label is ${labelBox(wide.focusedLabel)} (limit ${FOCUSED_MEMBER_LABEL_ROOM_PX}), look chip tab index ${wide.lookTabIndex}`;
      console.log(wideLine);
      expect(wide.focusedLabel, wideLine).not.toBeNull();
      expect(wide.focusedLabel!.room, wideLine).toBeGreaterThan(member.focusedLabel!.room);
      expect(wide.focusedLabel!.room, wideLine).toBeLessThanOrEqual(FOCUSED_MEMBER_LABEL_ROOM_PX);
      expect(wide.lookTabIndex, wideLine).toBe(-1);
      expect(log.errors, line).toEqual([]);
    });

    test('opens Play Pip from ?play=pip, walks him along the ground on a held key, and follows him', async ({ page }) => {
      test.setTimeout(240_000);
      const log = collectConsole(page);
      await open(page, '?tier=low&play=pip');
      const read = () =>
        page.evaluate(() => {
          const p99 = window.__P99__!;
          const play = (p99['play'] as () => PlayReading)();
          const surface = play.tangent ? (p99['surfaceAt'] as (x: number, z: number) => number[])(play.tangent[0]!, play.tangent[1]!) : null;
          return { play, surface, target: (p99['camera'] as () => CameraReading)().target, search: location.search };
        });
      const start = await read();
      // Checked before the key is held, so a play mode that never started fails here on its reading and the console,
      // rather than on the minute's wait for a step below.
      const startLine = `asset world play [${test.info().project.name}]: start ${JSON.stringify(start.play)}; address ${start.search}; console errors ${JSON.stringify(log.errors)}`;
      expect(start.play.on, startLine).toBe(true);
      // He comes out clear of every member's reach, read from the drawn bounds of the world as laid out.
      expect(start.play.clearance, startLine).toBeGreaterThan(0);
      // Held until he has covered half a metre, since SwiftShader's frames are slow and each moves him at most 1/20 s.
      await page.keyboard.down('KeyW');
      await page.waitForFunction(
        (from) => {
          const now = (window.__P99__!['play'] as () => PlayReading)().tangent;
          return now !== null && Math.hypot(now[0]! - from[0]!, now[1]! - from[1]!) > 0.5;
        },
        start.play.tangent ?? [0, 0],
        { timeout: 60_000 },
      );
      const held = await read();
      await page.keyboard.up('KeyW');
      const moved = Math.hypot(held.play.tangent![0]! - start.play.tangent![0]!, held.play.tangent![1]! - start.play.tangent![1]!);
      const offGround = Math.hypot(...held.play.position!.map((value, i) => value - held.surface![i]!));
      const followed = Math.hypot(...held.target.map((value, i) => value - start.target[i]!));
      const line =
        `asset world play [${test.info().project.name}]: moved ${moved.toFixed(2)} m at ${held.play.speed.toFixed(2)} m/s ` +
        `(run weight ${held.play.runWeight.toFixed(2)}, run rate ${held.play.runTimeScale.toFixed(2)}), ${(offGround * 1000).toFixed(2)} mm off the ground, ` +
        `camera target followed ${followed.toFixed(2)} m; run loop ${held.play.stride ? `${held.play.stride.loopMetres.toFixed(3)} m in ${held.play.stride.loopSeconds.toFixed(3)} s` : 'unread'}; ` +
        `spawn clearance ${start.play.clearance?.toFixed(2)} m; address ${held.search}`;
      console.log(line);
      expect(start.search, line).toContain('play=pip');
      expect(moved, line).toBeGreaterThan(0.5);
      expect(held.play.speed, line).toBeGreaterThan(0);
      expect(offGround, line).toBeLessThan(0.001);
      expect(followed, line).toBeGreaterThan(0.1);
      expect(held.play.stride, line).not.toBeNull();

      // The attack: F with S held. He swings once, stops dead for the swing and keeps his facing, the clip reaches its
      // strike, and once it ends he runs on under the held key. F is pressed in the call that starts the recorder. S turns
      // him back toward the cameras, over the open clearing between his row and the kit's arc, more than 10 m clear, so
      // the run after the swing does not depend on how far the walk above carried him toward his row: run on with W,
      // toward the row, he came out of one swing 0.53 m from a member's reach, where S heads him away from the row.
      await page.keyboard.down('KeyS');
      await page.waitForFunction(() => (window.__P99__!['play'] as () => PlayReading)().runWeight > 0.5, undefined, { timeout: 60_000 });
      await startRecording(page, true);
      // Until the swing has come and gone and he runs again under the held key.
      await waitForSwing(page, true);
      const samples = await stopRecording(page);
      await page.keyboard.up('KeyS');
      const before = samples[0]!;
      const first = samples.findIndex((sample) => sample.attacking);
      const last = samples.length - 1 - [...samples].reverse().findIndex((sample) => sample.attacking);
      const swing = samples.slice(first, last + 1);
      const swingStart = swing[0]!;
      const beforeSwing = samples[first - 1]!;
      const atStrike = swing.find((sample) => (sample.attackTime ?? 0) >= (sample.strikeAt ?? Infinity));
      const struck = swing.filter((sample) => (sample.attackTime ?? 0) >= (sample.strikeAt ?? Infinity));
      const after = samples.slice(last + 1).find((sample) => sample.runWeight > 0.5)!;
      const swings = swingsIn(samples);
      const turnedDeg = Math.max(...swing.map((sample) => Math.abs(Math.atan2(Math.sin(sample.yaw - swingStart.yaw), Math.cos(sample.yaw - swingStart.yaw))))) * (180 / Math.PI);
      const attackLine =
        `asset world play attack [${test.info().project.name}]: ${samples.length} frames read; running at ${before.speed.toFixed(2)} m/s (run weight ${before.runWeight.toFixed(2)}, clearance ${before.clearance?.toFixed(2)} m), ` +
        `F started ${swings} swing over ${swing.length} frames, from clip time ${swingStart.attackTime?.toFixed(3)} s of ${swingStart.attackSeconds?.toFixed(3)} s; ` +
        `run weight ${beforeSwing.runWeight.toFixed(3)} on the frame before the swing and ${swingStart.runWeight.toFixed(3)} on its first, under a swing weight of ${swingStart.attackWeight.toFixed(3)}; ` +
        `first frame at or past the strike ${atStrike ? `clip time ${atStrike.attackTime?.toFixed(3)} s (strike ${atStrike.strikeAt} s), weight ${atStrike.attackWeight.toFixed(2)}, speed ${atStrike.speed.toFixed(2)} m/s, strikes ${atStrike.strikes}` : 'none'}; ` +
        `largest speed through the swing ${Math.max(...swing.map((sample) => sample.speed)).toFixed(2)} m/s from its first frame, turned at most ${turnedDeg.toFixed(2)} degrees; ` +
        `last swing frame at clip time ${swing.at(-1)!.attackTime?.toFixed(3)} s, weight ${swing.at(-1)!.attackWeight.toFixed(3)}; ` +
        `after the swing attacking ${after.attacking}, weight ${after.attackWeight.toFixed(2)}, run weight ${after.runWeight.toFixed(2)} at ${after.speed.toFixed(2)} m/s, ` +
        `clearance ${after.clearance?.toFixed(2)} m, strikes ${after.strikes}`;
      console.log(attackLine);
      expect(before.attacking, attackLine).toBe(false);
      expect(swings, attackLine).toBe(1);
      // Within one 30 fps frame of the 0.85 s contract, the tolerance assets:check holds the export to: the exporter
      // samples whole frames, so the clip is 25 frames, 0.833 s. toBeCloseTo(0.85, 1) let it be 0.05 s off.
      expect(Math.abs(swingStart.attackSeconds! - 0.85), attackLine).toBeLessThanOrEqual(1 / 30);
      expect(swingStart.strikeAt, attackLine).toBe(0.34);
      // The trigger frame keeps the run's weight while the swing fades in over it: following his speed, zeroed on that
      // frame, it dropped from 1 to 0 at once and showed the idle under the swing's first frame (blendRunWeight). The
      // page caps a frame's step at 1/20 s, so the trigger frame always lands inside the 0.07 s fade in.
      expect(swingStart.runWeight, attackLine).toBe(beforeSwing.runWeight);
      // The clip reaches its strike at full weight; from the swing's first frame to its end he stands still, stopped dead
      // on the frame that took F, facing as he did when the swing began.
      expect(atStrike, attackLine).toBeDefined();
      expect(atStrike!.attackWeight, attackLine).toBe(1);
      expect(atStrike!.strikes, attackLine).toBe(1);
      expect(struck.length, attackLine).toBeGreaterThan(0);
      for (const sample of swing) expect(sample.speed, attackLine).toBe(0);
      expect(turnedDeg, attackLine).toBe(0);
      // One swing for one press, and the run back under the held key once it ended.
      expect(after.attacking, attackLine).toBe(false);
      expect(after.attackWeight, attackLine).toBe(0);
      expect(after.strikes, attackLine).toBe(1);
      expect(after.runWeight, attackLine).toBeGreaterThan(0.5);
      expect(after.speed, attackLine).toBeGreaterThan(0);

      // A left click on the canvas's centre swings once, as F does; he stands, W being up. The press and the release go
      // through the DevTools protocol with timestamps CLICK_HOLD_MS apart. page.mouse.click sends the release only once
      // Chromium has acknowledged the press, which SwiftShader's busy main thread can hold past PLAY_CLICK_MAX_SECONDS
      // (0.25 s): the page then read a held press, started no swing, and the wait for one ran out its minute. The page's
      // event.timeStamp carries the protocol's timestamps (measured: a release sent 402 ms after its press read a hold
      // of 50.000 ms), so the hold the page measures is the one asked, however late the release arrives.
      const canvas = (await page.locator('#stage canvas').boundingBox())!;
      const centre = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
      await page.mouse.move(centre.x, centre.y);
      await page.evaluate(() => {
        const times: ClickTimes = { down: null, up: null };
        (window as unknown as { clickTimes: ClickTimes }).clickTimes = times;
        const stage = document.querySelector('#stage canvas')!;
        stage.addEventListener('pointerdown', (event) => (times.down = event.timeStamp), { once: true });
        stage.addEventListener('pointerup', (event) => (times.up = event.timeStamp), { once: true });
      });
      await startRecording(page);
      const cdp = await page.context().newCDPSession(page);
      const at = { x: centre.x, y: centre.y, button: 'left', clickCount: 1 } as const;
      const pressedAt = Date.now() / 1000;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, buttons: 1, timestamp: pressedAt });
      // The release is sent no earlier than its timestamp, so the page never receives an event stamped in its future.
      const early = pressedAt + CLICK_HOLD_MS / 1000 - Date.now() / 1000;
      if (early > 0) await page.waitForTimeout(early * 1000);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, buttons: 0, timestamp: pressedAt + CLICK_HOLD_MS / 1000 });
      await cdp.detach();
      // A click that starts no swing fails here with the hold the page measured, rather than in the minute's wait below.
      await waitFramesPast(page, SWING_SHOWS_WITHIN_FRAMES, true);
      const clickTimes = await page.evaluate(() => (window as unknown as { clickTimes: ClickTimes }).clickTimes);
      const hold = clickTimes.down !== null && clickTimes.up !== null ? clickTimes.up - clickTimes.down : null;
      const holdText = hold === null ? `unread (pointerdown at ${clickTimes.down}, pointerup at ${clickTimes.up})` : `${hold.toFixed(3)} ms`;
      const started = await page.evaluate(() => (window as unknown as Recorder).playSamples.some((sample) => sample.attacking));
      expect(started, `asset world play click [${test.info().project.name}]: no swing within ${SWING_SHOWS_WITHIN_FRAMES} frames of the release; the page measured a hold of ${holdText}`).toBe(true);
      await waitForSwing(page, false);
      const clicked = await stopRecording(page);
      const clickLine =
        `asset world play click [${test.info().project.name}]: ${clicked.length} frames read; a left click at the canvas centre (${centre.x}, ${centre.y}), ` +
        `pressed for ${CLICK_HOLD_MS} ms by the protocol's timestamps and held ${holdText} by the page's event times, ` +
        `started ${swingsIn(clicked)} swing; strikes ${clicked[0]!.strikes} before, ${clicked.at(-1)!.strikes} after`;
      console.log(clickLine);
      expect(hold, clickLine).not.toBeNull();
      expect(Math.abs(hold! - CLICK_HOLD_MS), clickLine).toBeLessThan(1);
      expect(clicked[0]!.attacking, clickLine).toBe(false);
      expect(swingsIn(clicked), clickLine).toBe(1);
      expect(clicked.at(-1)!.strikes - clicked[0]!.strikes, clickLine).toBe(1);

      // A press, a 40 px move and a release are OrbitControls' orbit: the camera turns and no swing starts. The recorder
      // runs on for SWING_SHOWS_WITHIN_FRAMES frames past the release, where a swing it started would show.
      const cameraAt = () => page.evaluate(() => (window.__P99__!['camera'] as () => CameraReading)().position);
      const cameraBefore = await cameraAt();
      await startRecording(page);
      await page.mouse.move(centre.x, centre.y);
      await page.mouse.down();
      await page.mouse.move(centre.x + 40, centre.y, { steps: 4 });
      await page.mouse.up();
      await waitFramesPast(page, SWING_SHOWS_WITHIN_FRAMES, false);
      const dragged = await stopRecording(page);
      const cameraAfter = await cameraAt();
      const orbited = Math.hypot(...cameraAfter.map((value, i) => value - cameraBefore[i]!));
      const dragLine =
        `asset world play drag [${test.info().project.name}]: ${dragged.length} frames read; a 40 px drag from the canvas centre started ${swingsIn(dragged)} swings ` +
        `(a frame attacking ${dragged.some((sample) => sample.attacking)}), strikes ${dragged[0]!.strikes} before, ${dragged.at(-1)!.strikes} after; ` +
        `the camera moved ${orbited.toFixed(3)} m`;
      console.log(dragLine);
      expect(dragged.some((sample) => sample.attacking), dragLine).toBe(false);
      expect(dragged.at(-1)!.strikes, dragLine).toBe(dragged[0]!.strikes);
      // The 40 px drag asks OrbitControls for a 53 degree turn on this 270 px tall canvas (a drag the canvas's height is
      // a whole turn), which the damping plays out over the frames after, so the camera moves metres by the time the
      // recorder stops (about 4 m in recent runs). He stands, so the follow carries the camera nowhere: 5 cm is far
      // above anything but the orbit and far below what the orbit gives.
      expect(orbited, dragLine).toBeGreaterThan(0.05);
      expect(log.errors, line).toEqual([]);
    });

    // The owner follows the work on a phone; 375 x 667 is the iPhone SE and iPhone 8 viewport.
    test.describe('on a 375 x 667 phone', () => {
      test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

      test('shows the Attack button while Pip plays, and swings once for one tap on it', async ({ page }) => {
        test.setTimeout(240_000);
        const log = collectConsole(page);
        await open(page, '?tier=low&play=pip');
        // The button shows on a coarse pointer while he plays, so this touch context must show it.
        const button = page.locator('#attack');
        await expect(button).toBeVisible();
        const box = (await button.boundingBox())!;
        await startRecording(page);
        await button.tap();
        await waitForSwing(page, false);
        const tapped = await stopRecording(page);
        const line =
          `asset world play tap [${test.info().project.name}]: Attack button ${Math.round(box.width)}x${Math.round(box.height)} at (${Math.round(box.x)}, ${Math.round(box.y)}); ` +
          `${tapped.length} frames read; one tap started ${swingsIn(tapped)} swing; strikes ${tapped[0]!.strikes} before, ${tapped.at(-1)!.strikes} after; ` +
          `${log.errors.length} console errors`;
        console.log(line);
        expect(tapped[0]!.attacking, line).toBe(false);
        expect(swingsIn(tapped), line).toBe(1);
        expect(tapped.at(-1)!.strikes - tapped[0]!.strikes, line).toBe(1);
        expect(log.errors, line).toEqual([]);
      });

      test('starts with the panel closed and the canvas clear, opens and closes the panel, and names the families', async ({ page }) => {
        test.setTimeout(240_000);
        const log = collectConsole(page);
        await open(page, '?tier=low');
        const gui = page.locator('.lil-gui.lil-root');
        const title = page.locator('.lil-gui.lil-root > .lil-title');
        await expect(gui).toHaveClass(/\blil-closed\b/);
        await expect(title).toHaveText('World');
        expect((await title.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);

        // The title is the toggle: it opens the panel over the canvas, which hides the look note, and closes it again.
        await title.tap();
        await expect(gui).not.toHaveClass(/\blil-closed\b/);
        await expect(gui).not.toHaveClass(/\blil-transition\b/);
        await expect(page.locator('#look')).toBeHidden();
        await title.tap();
        await expect(gui).toHaveClass(/\blil-closed\b/);
        // lil-gui marks the panel closed at once and shrinks it over a transition, so its box is read once that ends.
        await expect(gui).not.toHaveClass(/\blil-transition\b/);
        await expect(page.locator('#look')).toBeVisible();

        // The frame interval chip fills in at the 30th frame, which the taps above mostly waited out.
        await expect(page.locator('#fps')).not.toBeEmpty({ timeout: 60_000 });
        const layout = await page.evaluate(() => {
          const box = (node: Element) => {
            const r = node.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          };
          const canvas = document.querySelector('#stage canvas') as HTMLCanvasElement;
          const overlays = ['.lil-gui.lil-root', '#look', '#fps', '#banner'].flatMap((selector) => {
            const node = document.querySelector<HTMLElement>(selector);
            if (!node || node.hidden) return [];
            const style = getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden') return [];
            return [{ selector, ...box(node) }];
          });
          const c = box(canvas);
          const centre = document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2);
          const labels = (window.__P99__!['labels'] as () => LabelReading[])().filter((label) => label.shown);
          const frameMs = (window.__P99__!['frameMs'] as () => number)();
          return { canvas: c, viewport: { width: innerWidth, height: innerHeight }, overlays, centreIsCanvas: centre === canvas, labels, frameMs };
        });
        // The overlays do not overlap, so their areas add.
        const share = layout.overlays.reduce((sum, o) => sum + o.width * o.height, 0) / (layout.canvas.width * layout.canvas.height);
        const line =
          `asset world phone [${test.info().project.name}]: overlays cover ${(share * 100).toFixed(2)} % of the canvas (limit 20 %); ` +
          layout.overlays.map((o) => `${o.selector} ${Math.round(o.width)}x${Math.round(o.height)}`).join(', ') +
          `; labels shown ${layout.labels.map((label) => `${label.text} ${label.fontPx}px`).join(', ')}; frame interval ${layout.frameMs.toFixed(0)} ms`;
        console.log(line);
        expect(layout.canvas, line).toEqual({ x: 0, y: 0, width: layout.viewport.width, height: layout.viewport.height });
        expect(share, line).toBeLessThanOrEqual(0.2);
        expect(layout.centreIsCanvas, line).toBe(true);
        // On a phone the overview names the six zones on seven placards (the commanders' zone hangs one under each
        // commander's row, Pip's and Bulwark's) and leaves the members to their own views.
        expect(layout.labels.filter((label) => label.kind === 'family'), line).toHaveLength(7);
        expect(layout.labels.filter((label) => label.kind === 'member'), line).toHaveLength(0);
        for (const label of layout.labels) expect(label.fontPx, `${label.text}: ${line}`).toBeGreaterThanOrEqual(12);
        expect(log.errors, line).toEqual([]);
      });
    });
  });
});
