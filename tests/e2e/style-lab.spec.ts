import { expect, test } from '@playwright/test';

interface AuditResult {
  report: { verdict: string; concentration: number; chromaticShare: number };
  mutation: { rejected: boolean; rotation: number; report: { verdict: string } };
}

test('the style lab renders every preset and passes its colour audit', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  // The lab keeps its drawing buffer, so a screenshot or audit taken before the new camera's frame is drawn reads the
  // previous preset's frame and can pass while measuring the wrong picture. A fixed 800 ms wait allowed that: with four
  // lab pages running at once, each preset step took 3 to 4 s. three asks for each next frame before it runs the lab's
  // loop, so its request is queued ahead of this one and the first frame that answers here has already drawn the new
  // camera; the second frame is margin.
  const nextFrames = (n: number) =>
    page.evaluate(
      (count) =>
        new Promise<void>((done) => {
          const step = (left: number): void => {
            if (left === 0) done();
            else requestAnimationFrame(() => step(left - 1));
          };
          step(count);
        }),
      n,
    );
  // Headless Chromium renders in software (SwiftShader), in CI and on the development laptop alike, so the test runs
  // the low tier; the owner reviews high-tier frames in a headed browser.
  await page.goto('./labs/style.html?tier=low');
  await page.waitForFunction(() => window.__P99__?.ready === true, undefined, { timeout: 180_000 });
  // One folder per project: the Pages base-path pass would otherwise overwrite the root pass's frames.
  const frames = `test-results/${test.info().project.name}`;
  for (const preset of ['hero', 'strategic', 'closeup', 'horizon']) {
    await page.evaluate((name) => (window.__P99__!['preset'] as (n: string) => void)(name), preset);
    await nextFrames(2);
    await page.screenshot({ path: `${frames}/style-${preset}.png` });
  }
  await page.evaluate(() => (window.__P99__!['preset'] as (n: string) => void)('hero'));
  await nextFrames(2);
  const result = (await page.evaluate(() => (window.__P99__!['audit'] as () => unknown)())) as AuditResult;
  const { report, mutation } = result;
  // The printed line is the run's evidence for the review. Both assertions carry it because a verdict alone hides its
  // cause: 'inconclusive' comes from the chromatic share, not the hue test, and a mutation that is not rejected needs
  // its rotation and verdict to explain why.
  const line =
    `style lab audit [${test.info().project.name}]: verdict ${report.verdict}, ` +
    `concentration ${report.concentration.toFixed(2)} x chance, chromatic share ${report.chromaticShare.toFixed(2)}, ` +
    `mutation rotation ${mutation.rotation} degrees, mutation verdict ${mutation.report.verdict}`;
  console.log(line);
  expect(report.verdict, line).toBe('pass');
  expect(mutation.rejected, line).toBe(true);
  expect(errors).toEqual([]);
});

interface SetDialsResult {
  dials: Record<string, unknown>;
  rejected: string[];
}

// The measured frames in the look pass and the owner's gate move dials through window.__P99__.setDials and hold the
// scene with freeze, so both are held to their word here: a move changes the frame, the old values bring the old frame
// back, a bad value is refused by name instead of silently leaving a default, and a frozen scene does not move.
test('the style lab test handle moves, restores, refuses and freezes', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('./labs/style.html?tier=low&freeze=1');
  await page.waitForFunction(() => window.__P99__?.ready === true, undefined, { timeout: 180_000 });
  // three asks for its next frame before the lab's loop runs, so the second frame to answer here has drawn any change.
  const settle = () => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  // A small copy of the canvas: enough to see a lighting change, cheap to read back from SwiftShader.
  const frame = () =>
    page.evaluate(() => {
      const source = document.querySelector('#stage canvas') as HTMLCanvasElement;
      const small = document.createElement('canvas');
      small.width = 160;
      small.height = 90;
      const context = small.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
      context.drawImage(source, 0, 0, 160, 90);
      return Array.from(context.getImageData(0, 0, 160, 90).data);
    });
  const meanDifference = (a: number[], b: number[]): number => a.reduce((sum, value, i) => sum + Math.abs(value - (b[i] as number)), 0) / a.length;
  const setDials = (changes: Record<string, unknown>) =>
    page.evaluate((c) => (window.__P99__!['setDials'] as (c: Record<string, unknown>) => SetDialsResult)(c), changes);

  const original = await page.evaluate(() => (window.__P99__!['dials'] as () => Record<string, unknown>)());
  await settle();
  const before = await frame();

  // The frozen scene holds its pose while frames keep drawing.
  await settle();
  await settle();
  const still = await frame();

  const moved = await setDials({ sunElevation: 8 });
  await settle();
  const lit = await frame();

  const restored = await setDials(original);
  await settle();
  const back = await frame();

  // One bad value of each kind next to one good move: out of range, not a colour, not a dial at all.
  const refused = await setDials({ sunElevation: 200, shadowTint: 'teal', notADial: 1, exposure: 0.5 });
  const cleaned = await setDials({ exposure: original['exposure'] });

  const line =
    `style lab test handle [${test.info().project.name}]: frozen difference ${meanDifference(before, still).toFixed(3)}, ` +
    `sun move difference ${meanDifference(before, lit).toFixed(2)}, restored difference ${meanDifference(before, back).toFixed(3)}, ` +
    `refused ${JSON.stringify(refused.rejected)}`;
  console.log(line);
  expect(meanDifference(before, still), line).toBeLessThanOrEqual(0.02);
  expect(moved.rejected, line).toEqual([]);
  expect(moved.dials['sunElevation'], line).toBe(8);
  expect(meanDifference(before, lit), line).toBeGreaterThan(2);
  expect(restored.rejected, line).toEqual([]);
  expect(meanDifference(before, back), line).toBeLessThanOrEqual(0.02);
  expect([...refused.rejected].sort(), line).toEqual(['notADial', 'shadowTint', 'sunElevation']);
  expect(refused.dials['sunElevation'], line).toBe(original['sunElevation']);
  expect(refused.dials['shadowTint'], line).toBe(original['shadowTint']);
  expect(refused.dials['exposure'], line).toBe(0.5);
  expect(cleaned.rejected, line).toEqual([]);

  // Unfrozen, the scene moves (the Husk walks, Bulwark cycles, the grain turns over), which shows the freeze held it.
  await page.evaluate(() => (window.__P99__!['freeze'] as (on: boolean) => void)(false));
  await page.waitForTimeout(600);
  await settle();
  const running = await frame();
  await page.evaluate(() => (window.__P99__!['freeze'] as (on: boolean) => void)(true));
  const unfrozen = `${line}, unfrozen difference ${meanDifference(back, running).toFixed(3)}`;
  console.log(unfrozen);
  expect(meanDifference(back, running), unfrozen).toBeGreaterThan(0.02);
  expect(errors).toEqual([]);
});

// Every other browser test runs the low tier (forced, or SwiftShader detected as low), and the low tier has no edge
// pass, so a GLSL error in the edge ink or in the normal pass's depth target passed CI unseen. three reports shader
// compile and link errors through console.error when a program is first used, and ready comes after the third frame,
// by which time every pass has drawn.
test('the style lab draws the medium tier, edge ink included, without a console error', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  const started = Date.now();
  await page.goto('./labs/style.html?tier=medium');
  await page.waitForFunction(() => window.__P99__?.ready === true, undefined, { timeout: 180_000 });
  // The query sets the tier past detection. A lab that fell back to low would pass here with no edge pass to compile.
  const tier = await page.evaluate(() => window.__P99__?.['tier']);
  const line =
    `style lab medium tier [${test.info().project.name}]: tier ${String(tier)}, ` +
    `ready in ${((Date.now() - started) / 1000).toFixed(1)} s, ${errors.length} console errors`;
  console.log(line);
  expect(tier, line).toBe('medium');
  expect(errors, line).toEqual([]);
});
