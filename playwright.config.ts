import { defineConfig, devices } from '@playwright/test';
import { previewPort } from './tools/preview-port.ts';

const ci = Boolean(process.env.CI);
const origin = `http://127.0.0.1:${previewPort()}/`;

// CI runners have no GPU. Playwright already passes --enable-unsafe-swiftshader; pinning ANGLE to
// SwiftShader means CI never tries a GPU backend first.
const ciGpuArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  timeout: 90_000,
  retries: ci ? 1 : 0,
  // A test.only left in a commit would run one test and report the suite as passing.
  forbidOnly: ci,
  reporter: ci ? [['github'], ['list']] : 'list',
  use: {
    baseURL: origin,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: origin,
    // A server already on the port belongs to another checkout or project; testing it would pass or fail on someone else's files.
    reuseExistingServer: false,
    timeout: 240_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ci ? ciGpuArgs : ['--ignore-gpu-blocklist'] },
      },
    },
  ],
});
