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
