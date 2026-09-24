import { execSync } from 'node:child_process';
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
  },
  build: {
    target: 'es2023',
    sourcemap: true,
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        style: resolve(import.meta.dirname, 'labs/style.html'),
      },
    },
  },
  server: {
    // Windows resolves localhost to ::1 first, and the docs, launch config and browser checks use 127.0.0.1:5173.
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
