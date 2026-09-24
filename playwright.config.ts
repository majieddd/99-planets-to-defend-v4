import { defineConfig, devices } from '@playwright/test';
import { previewPort } from './tools/preview-port';

const ci = Boolean(process.env.CI);
const origin = `http://127.0.0.1:${previewPort()}/`;

// CI runners have no GPU. Chrome gates its software WebGL path behind these flags, and without them
// every WebGL page fails to create a context.
const ciGpuArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  timeout: 90_000,
  retries: ci ? 1 : 0,
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
