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
