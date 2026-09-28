import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { coverageGaps, LEAN, MEMBERS, type CoverageManifest } from '../../src/labs/world/registry';
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
  fontPx: number;
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
 * in its clip's opening pose, not the bind pose the contract measures (Bulwark's run opens with both feet off the ground).
 */
const CONTRACT_M = 0.005;
const STRUCTURE_STRAY_M = 0.044;
const KIT_STRAY_M = 0.025;
const CLIP_STRAY_M = 0.04;

function groundAllowance(member: (typeof MEMBERS)[number]): number {
  if (member.clip) return CLIP_STRAY_M;
  if (member.entry === 'verdant_kit') return KIT_STRAY_M;
  return member.lean === LEAN.structure ? STRUCTURE_STRAY_M : 0;
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
    const unlooped = manifest.assets.flatMap((entry) =>
      (entry.animations ?? []).filter((clip) => !state.roots.some((root) => root.entry === entry.name && root.clip === clip.name)).map((clip) => `${entry.name}/${clip.name}`),
    );

    // Ground contact: each member's lowest drawn point, against the ground on the planet's radius through it, sits at
    // its designed sink, within the contract and the allowance its kind is documented to need.
    const centre = [0, -STYLE_PLANET_RADIUS, 0];
    const fromCentre = (point: number[]) => Math.hypot(...point.map((v, i) => v - (centre[i] as number)));
    const contacts = state.contacts.map((contact) => {
      const member = MEMBERS.find((m) => m.name === contact.name)!;
      const record = manifest.assets.find((entry) => entry.name === member.entry)!.ground!.find((r) => r.node === member.node)!;
      const height = fromCentre(contact.lowest) - fromCentre(contact.ground);
      return { name: contact.name, off: height + record.sink, limit: CONTRACT_M + groundAllowance(member) };
    });
    const unground = contacts.filter((contact) => Math.abs(contact.off) > contact.limit);
    const worst = contacts.reduce((a, b) => (Math.abs(b.off) > Math.abs(a.off) ? b : a));

    const towers = state.roots.filter((root) => root.family === 'towers');
    const towersUnframed = towers.filter((root) => !inFrame(state.towers, root.position)).map((root) => root.name);
    const outside = state.roots.filter((root) => !inFrame(state.overview!, root.position)).map((root) => root.name);

    const line =
      `asset world [${test.info().project.name}]: assets ${state.assets}, look ${state.look}, opened ${state.focused} (${state.search}), ` +
      `placed ${state.placed.length} names covering ${need.length - missing.length} of ${need.length} required, missing ${JSON.stringify(missing)}, ` +
      `registry gaps ${JSON.stringify(gaps)}, clips no root loops ${JSON.stringify(unlooped)}, ${state.roots.length} roots, ` +
      `ground: worst ${worst.name} ${(worst.off * 100).toFixed(2)} cm off its sink (limit ${(worst.limit * 100).toFixed(1)} cm), off their limit ${JSON.stringify(unground)}; ` +
      `ground offsets ${contacts.map((c) => `${c.name} ${(c.off * 100).toFixed(2)}`).join(', ')} cm; ` +
      `towers view unframed ${JSON.stringify(towersUnframed)}, labels ${JSON.stringify(state.towerLabels)}; outside the overview ${JSON.stringify(outside)}; ` +
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
        const read = {
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
      const line =
        `asset world address [${test.info().project.name}]: member view ${member.focused} (${member.search}), banner "${member.banner}", ` +
        `warnings ${JSON.stringify(log.warnings)}, mark II at ndc ${at.x.toFixed(3)}, ${at.y.toFixed(3)}, labels ${JSON.stringify(member.labels)}, ` +
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
      expect(log.errors, line).toEqual([]);
    });

    // The owner follows the work on a phone; 375 x 667 is the iPhone SE and iPhone 8 viewport.
    test.describe('on a 375 x 667 phone', () => {
      test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

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
        // On a phone the overview names the six families and leaves the members to their own views.
        expect(layout.labels.filter((label) => label.kind === 'family'), line).toHaveLength(6);
        expect(layout.labels.filter((label) => label.kind === 'member'), line).toHaveLength(0);
        for (const label of layout.labels) expect(label.fontPx, `${label.text}: ${line}`).toBeGreaterThanOrEqual(12);
        expect(log.errors, line).toEqual([]);
      });
    });
  });
});
