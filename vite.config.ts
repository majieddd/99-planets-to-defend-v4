import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

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
    port: 5173,
  },
});
