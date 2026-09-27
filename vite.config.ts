import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { previewPort } from './tools/preview-port.ts';

// The build stamp lets a tester confirm which commit a live page is running.
function buildSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'local';
  }
}

export default defineConfig({
  // GitHub Pages serves the site under /99-planets-to-defend-v4/; local dev serves it at /.
  base: process.env.P99_BASE ?? '/',
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
    // The Style Lab fetched assets/manifest.json even before any asset was built. The dev and preview servers answer a
    // missing file with index.html, but GitHub Pages answers 404, which Chromium logged as a console error on the live
    // lab. The asset track commits public/assets, so the next build turns the fetch on with no code change. The dev
    // server reads this once at start, so restart it after the first npm run assets.
    __HAS_ASSET_MANIFEST__: JSON.stringify(existsSync(resolve(import.meta.dirname, 'public/assets/manifest.json'))),
  },
  build: {
    target: 'es2023',
    sourcemap: true,
    // three's core is one 588 kB chunk after tree-shaking (all of three minifies to about 740 kB). Every rendered page
    // needs all of it before its first frame, so splitting it would only divide one download and quiet Vite's 500 kB
    // warning without loading less. Just above it, the warning still fires for a real regression: three's core growing,
    // or any other chunk passing 600 kB.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        style: resolve(import.meta.dirname, 'labs/style.html'),
      },
      output: {
        // The Style Lab shipped as one 828 kB chunk of three, postprocessing, lil-gui and lab code, so every lab edit
        // renamed all of it and browsers fetched three again. The libraries now sit in chunks, shared by every lab,
        // that change only when a dependency, or the part of it the labs use, changes. three's core stands alone
        // because its size sets the limit above; the addons vary by page, so they join the other libraries. three goes
        // first because a group also takes its modules' dependencies: filled first, vendor swallowed three's core too.
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]build[\\/]/, priority: 2 },
            { name: 'vendor', test: /node_modules[\\/](three[\\/]examples|postprocessing|lil-gui)[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
  server: {
    // Windows resolves localhost to ::1 first, while CLAUDE.md and the planned built-in-browser checks
    // use 127.0.0.1:5173.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    // The same loopback host as the dev server. A taken 127.0.0.1 port ends the command instead of
    // moving to one Playwright is not watching. It does not catch every clash: on Windows another
    // process's wildcard listener on this port does not stop the bind. playwright.config.ts refuses to
    // start when anything already answers on the URL.
    host: '127.0.0.1',
    port: previewPort(),
    strictPort: true,
  },
});
