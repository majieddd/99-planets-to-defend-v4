import { defineConfig, devices } from '@playwright/test';
import { previewPort } from './tools/preview-port.ts';

const ci = Boolean(process.env.CI);
const port = previewPort();
const origin = `http://127.0.0.1:${port}/`;

// GitHub Pages serves the site under this path, while the root project tests a build made for /. A base-path bug (an
// absolute /src/ or /assets/ URL) passes every root test and breaks only the live site, so the same tests also run
// against a Pages build, served on the next port.
const PAGES_BASE = '/99-planets-to-defend-v4/';
const pagesPort = port + 1;
const pagesOrigin = `http://127.0.0.1:${pagesPort}${PAGES_BASE}`;

// CI runners have no GPU. Playwright already passes --enable-unsafe-swiftshader; pinning ANGLE to
// SwiftShader means CI never tries a GPU backend first.
const ciGpuArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const chromiumArgs = ci ? ciGpuArgs : ['--ignore-gpu-blocklist'];

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
  // A server already on either port belongs to another checkout or project; testing it would pass or fail on someone
  // else's files, so neither server is reused.
  webServer: [
    {
      name: 'root',
      command: 'npm run build && npm run preview',
      url: origin,
      // Playwright hands the shell's environment to every server, so a shell with P99_BASE exported would otherwise
      // build the root project for the Pages path.
      env: { P99_BASE: '/' },
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      name: 'pages',
      // On Windows Playwright runs the command through cmd.exe, which has no VAR=value prefix, so the base and the port
      // travel in env. Playwright starts this server after the root one, so building into dist/ as well would empty
      // the folder the root preview is already serving.
      command: 'npm run build -- --outDir dist-pages && npm run preview -- --outDir dist-pages',
      url: pagesOrigin,
      env: { P99_BASE: PAGES_BASE, P99_PREVIEW_PORT: String(pagesPort) },
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: chromiumArgs },
      },
    },
    {
      name: 'chromium-pages',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: pagesOrigin,
        launchOptions: { args: chromiumArgs },
      },
    },
  ],
});
