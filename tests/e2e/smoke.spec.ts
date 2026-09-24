import { expect, test, type Page } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

test('home page boots without console errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await expect(page).toHaveTitle(/99 Planets To Defend/);
  await page.waitForFunction(() => window.__P99__?.ready === true);
  await expect(page.locator('#build-sha')).not.toBeEmpty();
  expect(errors).toEqual([]);
});

test('style lab renders WebGL frames', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./labs/style.html');
  await page.waitForFunction(() => window.__P99__?.ready === true && window.__P99__?.page === 'style');
  await expect(page.locator('#stage canvas')).toBeVisible();
  await page.screenshot({ path: 'test-results/style-lab-placeholder.png' });
  expect(errors).toEqual([]);
});
