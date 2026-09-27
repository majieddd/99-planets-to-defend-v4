import { expect, test } from '@playwright/test';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The area of the canvas under at least one overlay. Summing the boxes counts every overlap twice, so a layout could
 * fail on chrome that is not there; here the box edges cut the canvas into cells, and a cell counts once if any box
 * covers it.
 */
function coveredArea(boxes: Box[], clip: Box): number {
  const cells = boxes
    .map((b) => ({
      x0: Math.max(b.x, clip.x),
      y0: Math.max(b.y, clip.y),
      x1: Math.min(b.x + b.width, clip.x + clip.width),
      y1: Math.min(b.y + b.height, clip.y + clip.height),
    }))
    .filter((c) => c.x1 > c.x0 && c.y1 > c.y0);
  const xs = [...new Set(cells.flatMap((c) => [c.x0, c.x1]))].sort((a, b) => a - b);
  const ys = [...new Set(cells.flatMap((c) => [c.y0, c.y1]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < ys.length; j++) {
      const x = ((xs[i] as number) + (xs[i + 1] as number)) / 2;
      const y = ((ys[j] as number) + (ys[j + 1] as number)) / 2;
      if (cells.some((c) => x > c.x0 && x < c.x1 && y > c.y0 && y < c.y1)) {
        area += ((xs[i + 1] as number) - (xs[i] as number)) * ((ys[j + 1] as number) - (ys[j] as number));
      }
    }
  }
  return area;
}

test('the area helper counts overlapping boxes once and ignores what lies off the canvas', () => {
  const clip = { x: 0, y: 0, width: 100, height: 100 };
  expect(coveredArea([{ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }], clip)).toBe(175);
  expect(coveredArea([{ x: -10, y: 90, width: 30, height: 30 }], clip)).toBe(200);
  expect(coveredArea([], clip)).toBe(0);
});

// The owner follows the work on a phone about 313 px wide; 375 x 667 is the iPhone SE and iPhone 8 viewport.
for (const viewport of [
  { width: 313, height: 640 },
  { width: 375, height: 667 },
]) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(`on a ${viewport.width} x ${viewport.height} phone`, () => {
    // A touch phone, so lil-gui applies its larger touch controls as it does on the owner's phone.
    test.use({ viewport, hasTouch: true, isMobile: true });

    test('the style lab starts with both panels closed and the canvas clear, and each panel opens, scrolls and closes', async ({ page }) => {
      test.setTimeout(240_000);
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(String(error)));
      // Headless Chromium renders in software, so the phone runs the low tier, like the desktop browser test.
      await page.goto('./labs/style.html?tier=low');
      await page.waitForFunction(() => window.__P99__?.ready === true, undefined, { timeout: 180_000 });
      // The frame interval chip stays empty until the 30th frame, and measured empty it would understate the chrome. Ready
      // comes at frame 3, and the default 5 s wait covered only about 27 slow software frames, so it could time out.
      await expect(page.locator('#fps')).not.toBeEmpty({ timeout: 60_000 });
      // One folder per project: the Pages base-path pass would otherwise overwrite the root pass's frames.
      const frames = `test-results/${test.info().project.name}`;

      const gui = page.locator('.lil-gui.lil-root');
      const dialsToggle = page.locator('.lil-gui.lil-root > .lil-title');
      const boardToggle = page.locator('.board-toggle');
      const boardBody = page.locator('.board-body');
      const banner = page.locator('#banner');
      await expect(gui).toHaveClass(/\blil-closed\b/);
      await expect(dialsToggle).toHaveText('Dials');
      // The open and closed marks carry empty alternative text, so neither reaches the name a screen reader announces.
      await expect(dialsToggle).toHaveAccessibleName('Dials');
      await expect(dialsToggle).toHaveAttribute('aria-expanded', 'false');
      await expect(boardBody).toBeHidden();
      await expect(boardToggle).toHaveText('Board');
      await expect(boardToggle).toHaveAccessibleName('Board');
      await expect(boardToggle).toHaveAttribute('aria-expanded', 'false');
      // The placeholder banner shows until the asset build lands, after which it starts hidden; only a banner shown at
      // load can prove that it comes back when a panel closes.
      const bannerAtLoad = await banner.isVisible();
      // The blueprint's touch target for menus is 48 px.
      const targetHeight = async (toggle: typeof boardToggle) => (await toggle.boundingBox())?.height ?? 0;
      expect(await targetHeight(dialsToggle)).toBeGreaterThanOrEqual(48);
      expect(await targetHeight(boardToggle)).toBeGreaterThanOrEqual(48);

      const layout = await page.evaluate(() => {
        const box = (node: Element) => {
          const r = node.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        };
        const canvas = document.querySelector('#stage canvas') as HTMLCanvasElement;
        const overlays = ['.lil-gui.lil-root', '#board', '#audit', '#fps', '#banner'].flatMap((selector) => {
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
      await page.screenshot({ path: `${frames}/style-mobile-${size}-closed.png` });

      const { canvas, overlays } = layout;
      const share = coveredArea(overlays, canvas) / (canvas.width * canvas.height);
      const centre = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
      // The printed line is the run's evidence for the review, and every assertion below carries it.
      const line =
        `style lab mobile [${test.info().project.name}] ${size}: overlays cover ${(share * 100).toFixed(2)} % of the canvas (limit 20 %); ` +
        overlays.map((o) => `${o.selector} ${Math.round(o.width)}x${Math.round(o.height)} at ${Math.round(o.x)},${Math.round(o.y)}`).join(', ');
      console.log(line);
      expect(canvas, line).toEqual({ x: 0, y: 0, width: layout.viewport.width, height: layout.viewport.height });
      expect(overlays.length, line).toBeGreaterThanOrEqual(4);
      expect(share, line).toBeLessThanOrEqual(0.2);
      expect(layout.centreIsCanvas, line).toBe(true);
      for (const o of overlays) {
        const onCentre = centre.x >= o.x && centre.x <= o.x + o.width && centre.y >= o.y && centre.y <= o.y + o.height;
        expect(onCentre, `${o.selector} covers the centre of the canvas; ${line}`).toBe(false);
      }

      // Dials: lil-gui removes lil-closed in the same frame it starts the open animation and adds lil-transition, which
      // it drops when the animation ends, so waiting on both gives a frame of the settled panel.
      await dialsToggle.tap();
      await expect(gui).not.toHaveClass(/\blil-closed\b/);
      await expect(gui).not.toHaveClass(/\blil-transition\b/);
      await expect(dialsToggle).toHaveAttribute('aria-expanded', 'true');
      // An open panel hides the banner, which otherwise showed through or stuck out beside it.
      await expect(banner).toBeHidden();
      // Open, the title bar is the close button, and the panel's height cap once squeezed it to about half height.
      expect(await targetHeight(dialsToggle)).toBeGreaterThanOrEqual(48);
      await page.screenshot({ path: `${frames}/style-mobile-${size}-dials.png` });
      const dials = await page.evaluate(() => {
        const children = document.querySelector('.lil-gui.lil-root > .lil-children') as HTMLElement;
        const scrollable = children.scrollHeight > children.clientHeight;
        children.scrollTop = children.scrollHeight;
        const panel = (document.querySelector('.lil-gui.lil-root') as HTMLElement).getBoundingClientRect();
        const audit = (document.querySelector('#audit') as HTMLElement).getBoundingClientRect();
        return { scrollable, scrolled: children.scrollTop > 0, panelBottom: panel.bottom, auditTop: audit.top };
      });
      expect(dials.scrollable && dials.scrolled, JSON.stringify(dials)).toBe(true);
      // The open panel stops above the audit chip, so an audit run from the panel shows its verdict at once.
      expect(dials.panelBottom, JSON.stringify(dials)).toBeLessThanOrEqual(dials.auditTop);
      // tap() refuses a target that another element covers, so this also proves the title is still in reach.
      await dialsToggle.tap();
      await expect(gui).toHaveClass(/\blil-closed\b/);
      await expect(gui).not.toHaveClass(/\blil-transition\b/);
      if (bannerAtLoad) await expect(banner).toBeVisible();

      // Board.
      await boardToggle.tap();
      await expect(boardBody).toBeVisible();
      await expect(boardToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(banner).toBeHidden();
      await page.screenshot({ path: `${frames}/style-mobile-${size}-board.png` });
      const board = await page.evaluate(() => {
        const body = document.querySelector('.board-body') as HTMLElement;
        const scrollable = body.scrollHeight > body.clientHeight;
        body.scrollTop = body.scrollHeight;
        return { scrollable, scrolled: body.scrollTop > 0 };
      });
      expect(board, JSON.stringify(board)).toEqual({ scrollable: true, scrolled: true });
      await page.screenshot({ path: `${frames}/style-mobile-${size}-board-end.png` });
      await boardToggle.tap();
      await expect(boardBody).toBeHidden();
      await expect(boardToggle).toHaveAttribute('aria-expanded', 'false');
      if (bannerAtLoad) await expect(banner).toBeVisible();

      expect(errors).toEqual([]);
    });
  });
}
