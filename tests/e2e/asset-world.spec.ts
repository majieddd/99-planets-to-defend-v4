import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_DIALS } from '../../src/render/defaults';
import { encodeDials } from '../../src/render/dialsCodec';
import { GOLDEN_HOUR_B3 } from '../../src/render/presets';

interface ManifestEntry {
  name: string;
  kind: string;
  family: string;
  nodes: string[];
  ground?: { node: string | null }[];
}

interface Root {
  name: string;
  entry: string;
  family: string;
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
  shown: boolean;
  fontPx: number;
}

/**
 * What the world must place, read from the shipped manifest here rather than from the page, so a new asset cannot miss
 * the world without failing this test: every model, every piece of an environment kit, and every placeable the
 * manifest's ground records name for an asset that is not placed whole.
 */
function required(): string[] {
  const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')) as { assets: ManifestEntry[] };
  const names = new Set<string>();
  for (const entry of manifest.assets.filter((asset) => asset.kind === 'model')) {
    names.add(entry.name);
    if (entry.family === 'env') for (const node of entry.nodes) names.add(node);
    const ground = entry.ground ?? [];
    if (ground.length && !ground.some((record) => record.node === null)) for (const record of ground) names.add(record.node as string);
  }
  return [...names];
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`./labs/world.html${query}`);
  await page.waitForFunction(() => window.__P99__?.ready === true && window.__P99__?.page === 'world', undefined, { timeout: 180_000 });
}

/** Waits for two frames, so the camera a handle call moved has drawn (see the Style Lab's spec). */
const nextFrames = (page: Page) => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));

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

test.describe('the Asset World', () => {
  // A small canvas keeps SwiftShader's frames cheap, as the Style Lab's handle test does.
  test.use({ viewport: { width: 480, height: 270 } });

  test('places every manifest model and kit piece on the patch, inside the overview, in preset B3', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    const started = Date.now();
    await open(page, '?tier=low');
    const state = await page.evaluate(() => ({
      assets: window.__P99__!['assets'] as boolean,
      look: window.__P99__!['look'] as string,
      placed: window.__P99__!['placed'] as string[],
      focused: (window.__P99__!['focused'] as () => string)(),
      dials: (window.__P99__!['dials'] as () => Record<string, unknown>)(),
    }));
    const missing = required().filter((name) => !state.placed.includes(name));

    // Each root, read from the scene, taken back to the plane tangent at the pole and compared with the ground there.
    const grounds = await page.evaluate(() => {
      const radius = 160;
      const surfaceAt = window.__P99__!['surfaceAt'] as (x: number, z: number) => number[];
      return (window.__P99__!['roots'] as () => Root[])().map((root) => {
        const [x, y, z] = root.position;
        const up = y + radius;
        const ground = surfaceAt((x / up) * radius, (z / up) * radius);
        return { name: root.name, gap: Math.hypot(x - (ground[0] as number), y - (ground[1] as number), z - (ground[2] as number)) };
      });
    });
    const worstGap = Math.max(...grounds.map((ground) => ground.gap));

    // Every root inside the overview camera's frustum, projected here from the camera's own matrices.
    await page.evaluate(() => (window.__P99__!['focus'] as (name: string) => boolean)('overview'));
    await nextFrames(page);
    const camera = await page.evaluate(() => (window.__P99__!['camera'] as () => CameraReading)());
    const roots = await page.evaluate(() => (window.__P99__!['roots'] as () => Root[])());
    const outside = roots.filter((root) => {
      const at = project(camera, root.position);
      return !(at.w > 0 && Math.abs(at.x) <= 1 && Math.abs(at.y) <= 1);
    });
    const reach = Math.max(...roots.map((root) => Math.max(Math.abs(project(camera, root.position).x), Math.abs(project(camera, root.position).y))));
    await page.screenshot({ path: `test-results/${test.info().project.name}/world-overview.png` });

    // Each family's view frames all of its members.
    const families = [...new Set(roots.map((root) => root.family))];
    const unframed: string[] = [];
    for (const family of [...families, 'characters']) {
      expect(await page.evaluate((name) => (window.__P99__!['focus'] as (n: string) => boolean)(name), family), family).toBe(true);
      await nextFrames(page);
      const view = await page.evaluate(() => (window.__P99__!['camera'] as () => CameraReading)());
      for (const root of roots.filter((r) => (family === 'characters' ? ['xeno', 'commanders'].includes(r.family) : r.family === family))) {
        const at = project(view, root.position);
        if (!(at.w > 0 && Math.abs(at.x) <= 1 && Math.abs(at.y) <= 1)) unframed.push(`${root.name} in ${family}`);
      }
    }

    const line =
      `asset world [${test.info().project.name}]: ready in ${((Date.now() - started) / 1000).toFixed(1)} s, assets ${state.assets}, look ${state.look}, ` +
      `placed ${state.placed.length} names covering ${required().length - missing.length} of ${required().length} required, missing ${JSON.stringify(missing)}, ` +
      `${roots.length} roots, worst ground gap ${(worstGap * 1000).toFixed(4)} mm, outside the overview ${JSON.stringify(outside.map((r) => r.name))} ` +
      `(largest |ndc| ${reach.toFixed(3)}), unframed by their family's view ${JSON.stringify(unframed)}, ${errors.length} console errors`;
    console.log(line);
    expect(state.assets, line).toBe(true);
    expect(state.focused, line).toBe('overview');
    expect(missing, line).toEqual([]);
    expect(worstGap, line).toBeLessThan(1e-3);
    expect(outside, line).toEqual([]);
    expect(unframed, line).toEqual([]);
    expect(state.look, line).toBe('B3');
    expect(state.dials, line).toEqual(GOLDEN_HOUR_B3);
    expect(errors, line).toEqual([]);
  });

  test('opens a family or a member from the address, and a dials link over the Style Lab defaults', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    await open(page, '?tier=low&family=towers');
    const family = await page.evaluate(() => ({ focused: (window.__P99__!['focused'] as () => string)(), search: location.search }));

    const link = encodeDials({ ...DEFAULT_DIALS, sunElevation: 30 });
    await open(page, `?tier=low&member=bolt_mk2&dials=${link}`);
    await nextFrames(page);
    const member = await page.evaluate(() => ({
      focused: (window.__P99__!['focused'] as () => string)(),
      search: location.search,
      look: window.__P99__!['look'] as string,
      dials: (window.__P99__!['dials'] as () => Record<string, unknown>)(),
      camera: (window.__P99__!['camera'] as () => CameraReading)(),
      root: (window.__P99__!['roots'] as () => Root[])().find((root) => root.name === 'bolt_mk2')!,
      labels: (window.__P99__!['labels'] as () => LabelReading[])().filter((label) => label.shown).map((label) => label.text),
    }));
    const at = project(member.camera, member.root.position);
    const line =
      `asset world address [${test.info().project.name}]: family view ${family.focused} (${family.search}), member view ${member.focused} (${member.search}), ` +
      `mark II at ndc ${at.x.toFixed(3)}, ${at.y.toFixed(3)}, labels ${JSON.stringify(member.labels)}, look ${member.look}, sun ${String(member.dials['sunElevation'])}, ` +
      `${errors.length} console errors`;
    console.log(line);
    expect(family.focused, line).toBe('towers');
    expect(family.search, line).toContain('family=towers');
    expect(member.focused, line).toBe('bolt_mk2');
    expect(member.search, line).toContain('member=bolt_mk2');
    expect(at.w > 0 && Math.abs(at.x) < 0.9 && Math.abs(at.y) < 0.9, line).toBe(true);
    expect(member.labels, line).toEqual(expect.arrayContaining(['Mark II', 'Bolt Sentinel']));
    // A link names only what differs from the Style Lab's defaults, and the rest takes the defaults, not preset B3.
    expect(member.look, line).toBe('link');
    expect(member.dials, line).toEqual({ ...DEFAULT_DIALS, sunElevation: 30 });

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
    await nextFrames(page);
    const hearts = await page.evaluate(() => (window.__P99__!['labels'] as () => LabelReading[])().filter((label) => label.shown).map((label) => label.text));
    // The turntable waits while a view glides in, so the glide the panel started ends first.
    await page.waitForFunction(() => (window.__P99__!['gliding'] as () => boolean)() === false);
    await page.evaluate(() => (window.__P99__!['setTurntable'] as (on: boolean) => void)(true));
    await nextFrames(page);
    const before = await page.evaluate(() => (window.__P99__!['camera'] as () => CameraReading)());
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => (window.__P99__!['camera'] as () => CameraReading)());
    const radius = (reading: CameraReading) => Math.hypot(...reading.position.map((v, i) => v - (reading.target[i] as number)));
    const turned = Math.hypot(...after.position.map((v, i) => v - (before.position[i] as number)));
    const panelLine = `asset world panel [${test.info().project.name}]: heart labels ${JSON.stringify(hearts)}, turntable moved the camera ${turned.toFixed(3)} m at ${radius(before).toFixed(2)} to ${radius(after).toFixed(2)} m from its target`;
    console.log(panelLine);
    expect(hearts, panelLine).toContain('Stage 3 (slider)');
    expect(turned, panelLine).toBeGreaterThan(0.05);
    expect(Math.abs(radius(after) - radius(before)), panelLine).toBeLessThan(0.01);
    expect(after.target, panelLine).toEqual(before.target);
    expect(errors, line).toEqual([]);
  });
});

// The owner follows the work on a phone; 375 x 667 is the iPhone SE and iPhone 8 viewport.
test.describe('the Asset World on a 375 x 667 phone', () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

  test('starts with the panel closed and the canvas clear, names the families, and opens and closes the panel', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    await open(page, '?tier=low');
    await expect(page.locator('#fps')).not.toBeEmpty({ timeout: 60_000 });
    const gui = page.locator('.lil-gui.lil-root');
    const title = page.locator('.lil-gui.lil-root > .lil-title');
    await expect(gui).toHaveClass(/\blil-closed\b/);
    await expect(title).toHaveText('World');
    expect((await title.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);

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
      return { canvas: c, viewport: { width: innerWidth, height: innerHeight }, overlays, centreIsCanvas: centre === canvas };
    });
    const labels = await page.evaluate(() => (window.__P99__!['labels'] as () => LabelReading[])().filter((label) => label.shown));
    await page.screenshot({ path: `test-results/${test.info().project.name}/world-phone.png` });
    // The overlays do not overlap, so their areas add.
    const share = layout.overlays.reduce((sum, o) => sum + o.width * o.height, 0) / (layout.canvas.width * layout.canvas.height);
    const line =
      `asset world phone [${test.info().project.name}]: overlays cover ${(share * 100).toFixed(2)} % of the canvas (limit 20 %); ` +
      layout.overlays.map((o) => `${o.selector} ${Math.round(o.width)}x${Math.round(o.height)}`).join(', ') +
      `; labels shown ${labels.map((label) => `${label.text} ${label.fontPx}px`).join(', ')}`;
    console.log(line);
    expect(layout.canvas, line).toEqual({ x: 0, y: 0, width: layout.viewport.width, height: layout.viewport.height });
    expect(share, line).toBeLessThanOrEqual(0.2);
    expect(layout.centreIsCanvas, line).toBe(true);
    // On a phone the overview names the six families and leaves the members to their own views.
    expect(labels.filter((label) => label.kind === 'family'), line).toHaveLength(6);
    expect(labels.filter((label) => label.kind === 'member'), line).toHaveLength(0);
    for (const label of labels) expect(label.fontPx, `${label.text}: ${line}`).toBeGreaterThanOrEqual(12);

    // The title is the toggle: it opens the panel over the canvas, which hides the look note, and closes it again.
    await title.tap();
    await expect(gui).not.toHaveClass(/\blil-closed\b/);
    await expect(gui).not.toHaveClass(/\blil-transition\b/);
    await expect(page.locator('#look')).toBeHidden();
    await page.screenshot({ path: `test-results/${test.info().project.name}/world-phone-panel.png` });
    await title.tap();
    await expect(gui).toHaveClass(/\blil-closed\b/);
    await expect(page.locator('#look')).toBeVisible();
    expect(errors, line).toEqual([]);
  });
});
