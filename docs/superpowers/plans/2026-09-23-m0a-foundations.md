# M0a Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a strict TypeScript, three.js and Vite workspace with type, lint, simulation-boundary, em dash and blueprint checks, Vitest and Playwright harnesses, CI, and a live GitHub Pages site serving a placeholder home page and Style Lab.

**Architecture:** one repository root holds a multi-page Vite app (`index.html`, `labs/style.html`). Two TypeScript projects share one config: the whole app, and a stricter view of `src/sim` and `src/shared` with no DOM or Node types. ESLint enforces the simulation boundary by path; plain Node ESM scripts in `tools/` hold the checks. GitHub Actions runs checks and tests on every push and deploys `dist/` to Pages from `main`.

**Tech Stack:** Node 24, TypeScript 6.0.3, Vite 8.3.0, three 0.186.0, Vitest 5.0.1, Playwright 1.63.0, ESLint 10.11.0 with typescript-eslint 8.70.1, GitHub Actions (checkout v7, setup-node v7, configure-pages v6, upload-pages-artifact v5, deploy-pages v5).

**Working directory:** `C:\Users\Majied LaFleur\Documents\99PlanetsToDefendv4` (git repo, remote `origin` = github.com/majieddd/99-planets-to-defend-v4, branch `main`). Commands below are written for Git Bash.

---

## File map

| File | Responsibility |
|---|---|
| `package.json`, `package-lock.json` | scripts and exact dependency pins |
| `.nvmrc` | Node major version for humans and CI |
| `tsconfig.json` | the whole app: strict, DOM and Node types |
| `tsconfig.sim.json` | `src/sim` and `src/shared` without DOM or Node types |
| `src/env.d.ts` | Vite client types, `__BUILD_SHA__`, the `window.__P99__` debug handle |
| `vite.config.ts` | multi-page build, base path from `P99_BASE`, build stamp |
| `vitest.config.ts` | unit tests in `tests/unit` |
| `eslint.config.js` | lint rules and the simulation boundary |
| `playwright.config.ts` | browser smoke tests against `vite preview` |
| `index.html`, `src/main.ts` | placeholder home page |
| `labs/style.html`, `src/labs/style/main.ts` | placeholder Style Lab (M0d replaces the script) |
| `src/ui/base.css` | interface tokens from the blueprint |
| `tools/check-emdash.mjs` | the em dash rule, all four forms |
| `tools/check-blueprint.mjs` | runs the aegis-suite blueprint gate when the checker exists |
| `tests/unit/tools/emdash.test.ts` | proves the em dash check can fail |
| `tests/unit/tools/sim-boundary.test.ts` | proves the boundary rule can fail |
| `tests/e2e/smoke.spec.ts` | both pages boot without console errors |
| `.github/workflows/ci.yml` | checks, unit tests, browser smoke |
| `.github/workflows/pages.yml` | build and deploy to GitHub Pages |
| `CLAUDE.md` | standing instructions for agents in this repository |

---

### Task 1: Workspace, pins and TypeScript projects

**Files:**
- Create: `package.json`, `.nvmrc`, `tsconfig.json`, `tsconfig.sim.json`, `src/env.d.ts`
- Generated: `package-lock.json`, `node_modules/`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "99-planets-to-defend-v4",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "99 Planets To Defend v4: a painted, inked action tower defense on procedural planets.",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview --port 4173 --strictPort",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.sim.json",
    "lint": "eslint .",
    "check:emdash": "node tools/check-emdash.mjs",
    "check:blueprint": "node tools/check-blueprint.mjs",
    "check": "npm run typecheck && npm run lint && npm run check:emdash && npm run check:blueprint",
    "test": "vitest run",
    "e2e": "playwright test"
  }
}
```

- [ ] **Step 2: Write `.nvmrc`**

```
24
```

- [ ] **Step 3: Install the pinned dependencies**

Run:

```bash
npm install --save-exact three@0.186.0
npm install --save-exact --save-dev typescript@6.0.3 vite@8.3.0 vitest@5.0.1 @types/three@0.186.0 @types/node@24 eslint@10.11.0 @eslint/js@10.0.1 typescript-eslint@8.70.1 globals@17.12.0 @playwright/test@1.63.0 tsx@4.23.15
```

Expected: both commands finish with `added N packages` and no `ERESOLVE` error. `package.json` now lists exact versions (no `^`).

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "allowJs": true,
    "checkJs": false,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests", "tools", "vite.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

- [ ] **Step 5: Write `tsconfig.sim.json`**

The simulation must not see the DOM or Node, so a stray `window` or `process` fails to type-check here even before lint runs.

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2023"],
    "types": []
  },
  "include": ["src/sim", "src/shared"]
}
```

- [ ] **Step 6: Write `src/env.d.ts`**

```ts
/// <reference types="vite/client" />

/** Short git SHA of the build, injected by vite.config.ts. */
declare const __BUILD_SHA__: string;

/** Debug handle that pages expose for browser tests and the agent. */
interface P99Debug {
  ready: boolean;
  page: string;
  [key: string]: unknown;
}

interface Window {
  __P99__?: P99Debug;
}
```

- [ ] **Step 7: Create empty source roots so the TypeScript projects have inputs**

```bash
mkdir -p src/sim src/shared tests/unit tools
printf '// The pure simulation lives here. See docs/blueprint.md, Architecture.\nexport {};\n' > src/sim/index.ts
printf '// Data shared by the simulation and the tools (plain JSON and types).\nexport {};\n' > src/shared/index.ts
```

- [ ] **Step 8: Type-check both projects**

Run: `npm run typecheck`
Expected: exits 0 with no output.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json .nvmrc tsconfig.json tsconfig.sim.json src/env.d.ts src/sim/index.ts src/shared/index.ts
git commit -F - <<'EOF'
Pin the toolchain and add the two TypeScript projects

TypeScript is pinned to 6.0.3 because typescript-eslint 8.70 supports
>=4.8.4 <6.1.0 and TypeScript 7 no longer ships the compiler API it needs.
three is pinned to 0.186.0 because the painted material will include r186
shader chunks. tsconfig.sim.json views src/sim and src/shared with no DOM or
Node types, so the simulation boundary fails at type-check time as well as in
lint.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Vite multi-page build and placeholder pages

**Files:**
- Create: `vite.config.ts`, `index.html`, `src/main.ts`, `labs/style.html`, `src/labs/style/main.ts`, `src/ui/base.css`

- [ ] **Step 1: Write `vite.config.ts`**

```ts
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
```

- [ ] **Step 2: Write `src/ui/base.css`**

Tokens come from the blueprint's Interface section. No pure black or white; cyan is the only accent.

```css
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Inter:wght@400;600&display=swap');

:root {
  --ink: #14161d;
  --ink-raised: #1d2029;
  --paper: #efe6d2;
  --paper-muted: #b9b1a0;
  --accent: #59f2ff;
  --gold: #ffc857;
  --danger: #ff5470;
  --hairline: rgba(239, 230, 210, 0.16);
  --font-display: 'Barlow Condensed', 'Segoe UI', sans-serif;
  --font-body: 'Inter', 'Segoe UI', sans-serif;
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  height: 100%;
  background: var(--ink);
  color: var(--paper);
  font: 400 14px/1.6 var(--font-body);
}

a {
  color: var(--accent);
}

.shell {
  max-width: 640px;
  margin: 0 auto;
  padding: 48px 16px;
}

.shell h1 {
  font: 700 48px/1.05 var(--font-display);
  letter-spacing: 0.02em;
  margin: 0 0 16px;
}

.build {
  color: var(--paper-muted);
  font-size: 12.5px;
}
```

- [ ] **Step 3: Write `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>99 Planets To Defend</title>
    <link rel="stylesheet" href="/src/ui/base.css" />
  </head>
  <body>
    <main class="shell">
      <h1>99 Planets To Defend</h1>
      <p>A painted, inked action tower defense on procedural planets, built in the open.</p>
      <p>Milestone M0 is the Style Lab, where the look is tuned and approved.</p>
      <p><a href="./labs/style.html">Open the Style Lab</a></p>
      <p class="build">build <span id="build-sha"></span></p>
    </main>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 4: Write `src/main.ts`**

```ts
const sha = document.getElementById('build-sha');
if (sha) sha.textContent = __BUILD_SHA__;
window.__P99__ = { ready: true, page: 'home' };
```

- [ ] **Step 5: Write `labs/style.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Style Lab</title>
    <link rel="stylesheet" href="/src/ui/base.css" />
    <style>
      #stage {
        position: fixed;
        inset: 0;
      }
      #stage canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
    </style>
  </head>
  <body>
    <div id="stage"></div>
    <script type="module" src="/src/labs/style/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Write the placeholder `src/labs/style/main.ts`**

M0d replaces this file. It exists now so the build, the smoke test and the Pages deploy have a real WebGL page to exercise.

```ts
import { BoxGeometry, Color, DirectionalLight, Mesh, MeshToonMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

const stage = document.getElementById('stage');
if (!stage) throw new Error('Style Lab: #stage is missing');

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(stage.clientWidth, stage.clientHeight);
stage.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color('#2a3a4a');
const camera = new PerspectiveCamera(50, stage.clientWidth / stage.clientHeight, 0.1, 100);
camera.position.set(2.2, 1.6, 3.2);
camera.lookAt(0, 0, 0);

const sun = new DirectionalLight('#ffe2b0', 2.2);
sun.position.set(3, 4, 2);
scene.add(sun);

const cube = new Mesh(new BoxGeometry(1, 1, 1), new MeshToonMaterial({ color: '#4ec98a' }));
scene.add(cube);

window.addEventListener('resize', () => {
  camera.aspect = stage.clientWidth / stage.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(stage.clientWidth, stage.clientHeight);
});

let frames = 0;
renderer.setAnimationLoop((time) => {
  cube.rotation.y = time * 0.0006;
  renderer.render(scene, camera);
  frames += 1;
  if (frames === 2) window.__P99__ = { ready: true, page: 'style' };
});
```

- [ ] **Step 7: Build and verify both pages are emitted**

Run: `npm run build && ls dist dist/labs`
Expected: the build prints two HTML entries and finishes with `built in`; `ls` shows `index.html`, `assets` and `labs`, and `dist/labs` contains `style.html`.

- [ ] **Step 8: Build with the Pages base path and verify asset URLs carry it**

Run: `P99_BASE=/99-planets-to-defend-v4/ npm run build && grep -o 'src="/99-planets-to-defend-v4/assets/[^"]*"' dist/index.html | head -1`
Expected: one line starting `src="/99-planets-to-defend-v4/assets/`.

- [ ] **Step 9: Commit**

```bash
git add vite.config.ts index.html src/main.ts labs/style.html src/labs/style/main.ts src/ui/base.css
git commit -F - <<'EOF'
Add the multi-page Vite build with a placeholder home page and Style Lab

The Style Lab placeholder renders a real WebGL frame and sets
window.__P99__.ready after its second frame, so the smoke test and the Pages
deploy exercise the renderer path from the first commit. P99_BASE switches
the base path to /99-planets-to-defend-v4/ for GitHub Pages; the build stamp
comes from GITHUB_SHA in CI and from git locally.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: The em dash check, proven by planting

**Files:**
- Create: `vitest.config.ts`, `tools/check-emdash.mjs`, `tests/unit/tools/emdash.test.ts`

- [ ] **Step 1: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
```

- [ ] **Step 2: Write the failing test `tests/unit/tools/emdash.test.ts`**

Every planted form is assembled at runtime, so this file never contains one and the repository check stays clean.

```ts
import { describe, expect, it } from 'vitest';
import { EM_DASH_FORMS, findEmDashes } from '../../../tools/check-emdash.mjs';

const planted = {
  character: String.fromCharCode(0x2014),
  named: '&' + 'mdash;',
  numeric: '&#' + '8212;',
  escape: '\\' + 'u2014',
};

describe('findEmDashes', () => {
  it('finds nothing in clean text', () => {
    expect(findEmDashes('a - b, c: d\nplain line')).toEqual([]);
  });

  it('catches every form on the right line', () => {
    const text = [
      'clean',
      `one ${planted.character} here`,
      `two ${planted.named}`,
      `three ${planted.numeric}`,
      `four ${planted.escape}`,
    ].join('\n');
    expect(findEmDashes(text)).toEqual([
      { line: 2, form: 'the character' },
      { line: 3, form: 'the named entity' },
      { line: 4, form: 'the numeric entity' },
      { line: 5, form: 'the escape' },
    ]);
  });

  it('counts repeats on one line', () => {
    expect(findEmDashes(`${planted.character}x${planted.character}`)).toHaveLength(2);
  });

  it('knows exactly four forms', () => {
    expect(EM_DASH_FORMS.map((f: { name: string }) => f.name)).toEqual([
      'the character',
      'the named entity',
      'the numeric entity',
      'the escape',
    ]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/tools/emdash.test.ts`
Expected: FAIL, with an error that `tools/check-emdash.mjs` cannot be found.

- [ ] **Step 4: Write `tools/check-emdash.mjs`**

```js
#!/usr/bin/env node
// The owner's standing rule: no em dash anywhere, in any of its four spellings. The patterns are
// assembled from parts so this file, which the check also scans, never spells one itself.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const EM_DASH_FORMS = [
  { name: 'the character', token: String.fromCharCode(0x2014) },
  { name: 'the named entity', token: '&' + 'mdash;' },
  { name: 'the numeric entity', token: '&#' + '8212;' },
  { name: 'the escape', token: '\\' + 'u2014' },
];

const BINARY = /\.(png|jpe?g|webp|gif|glb|bin|ktx2|blend|exr|ogg|wav|mp3|woff2?|ttf|ico)$/i;

/** One finding per occurrence, with a 1-based line number and the form's name. */
export function findEmDashes(text) {
  const findings = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const form of EM_DASH_FORMS) {
      let from = 0;
      for (;;) {
        const at = line.indexOf(form.token, from);
        if (at < 0) break;
        findings.push({ line: index + 1, form: form.name });
        from = at + form.token.length;
      }
    }
  });
  return findings;
}

function candidateFiles() {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    encoding: 'utf8',
  });
  return out.split('\0').filter((file) => file && !BINARY.test(file));
}

function main() {
  const files = candidateFiles();
  let total = 0;
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue; // listed by git but deleted in the working tree
    }
    for (const finding of findEmDashes(text)) {
      console.log(`${file}:${finding.line}: em dash (${finding.form})`);
      total += 1;
    }
  }
  console.log(`em dash check: ${total} found in ${files.length} files`);
  if (total > 0) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/tools/emdash.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Run the check over the repository**

Run: `npm run check:emdash`
Expected: `em dash check: 0 found in N files` and exit code 0.

- [ ] **Step 7: Prove the repository check can fail, then restore**

Run:

```bash
node -e "require('fs').writeFileSync('planted.txt', 'x ' + String.fromCharCode(0x2014) + ' y')"
npm run check:emdash; echo "exit=$?"
rm planted.txt
```

Expected: a line `planted.txt:1: em dash (the character)`, then `exit=1`.

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts tools/check-emdash.mjs tests/unit/tools/emdash.test.ts
git commit -F - <<'EOF'
Enforce the no-em-dash rule across the repository

tools/check-emdash.mjs scans every tracked or untracked-but-not-ignored text
file for the four spellings the blueprint names. The unit test plants each
form and requires the finder to report it on the right line, and a planted
file made the repository check exit 1 before it was removed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: ESLint with the simulation boundary, proven by planting

**Files:**
- Create: `eslint.config.js`, `tests/unit/tools/sim-boundary.test.ts`

- [ ] **Step 1: Write the failing test `tests/unit/tools/sim-boundary.test.ts`**

```ts
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((message) => message.ruleId ?? 'fatal').sort();
}

describe('the simulation boundary', () => {
  it('refuses engine imports inside src/sim', async () => {
    expect(await ruleIds("import * as THREE from 'three';\nexport const x = THREE;\n", 'src/sim/planted.ts')).toContain(
      'no-restricted-imports',
    );
    expect(await ruleIds("import { draw } from '../render/draw';\nexport const x = draw;\n", 'src/sim/planted.ts')).toContain(
      'no-restricted-imports',
    );
  });

  it('refuses Math.random, Date.now and new Date inside src/sim', async () => {
    const ids = await ruleIds(
      'export const a = Math.random();\nexport const b = Date.now();\nexport const c = new Date();\n',
      'src/sim/planted.ts',
    );
    expect(ids.filter((id) => id === 'no-restricted-properties')).toHaveLength(2);
    expect(ids).toContain('no-restricted-syntax');
  });

  it('refuses browser globals inside src/sim', async () => {
    expect(await ruleIds('export const w = window.innerWidth;\n', 'src/sim/planted.ts')).toContain('no-restricted-globals');
  });

  it('allows sibling imports inside src/sim', async () => {
    expect(await ruleIds("import { a } from './rng';\nexport const b = a;\n", 'src/sim/planted.ts')).toEqual([]);
  });

  it('allows the same calls outside src/sim', async () => {
    expect(await ruleIds('export const a = Math.random();\n', 'src/render/planted.ts')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/tools/sim-boundary.test.ts`
Expected: FAIL. Without a config ESLint reports no restricted-rule findings, so the first expectation fails.

- [ ] **Step 3: Write `eslint.config.js`**

```js
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// The simulation is the game and must stay pure: no engine, DOM, clock or unseeded randomness.
// Breaking this destroys headless testing, the bot and any future port (blueprint, Architecture).
const SIM_MESSAGE = 'src/sim is pure: no rendering, DOM, clock or unseeded randomness (docs/blueprint.md, Architecture).';

export default defineConfig([
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', 'build/**', 'playwright-report/**', 'test-results/**', 'blender/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,js,mjs}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['three', 'three/*', 'postprocessing', 'postprocessing/*', 'lil-gui'], message: SIM_MESSAGE },
            { regex: '(^|/)(render|game|ui|audio|labs)(/|$)', message: SIM_MESSAGE },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'localStorage',
        'sessionStorage',
        'indexedDB',
        'performance',
        'requestAnimationFrame',
        'setTimeout',
        'setInterval',
        'fetch',
        'process',
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded streams in src/sim/rng.ts.' },
        { object: 'Date', property: 'now', message: 'The simulation takes time by injection.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: 'The simulation takes time by injection.' },
      ],
    },
  },
]);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/tools/sim-boundary.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Lint the repository**

Run: `npm run lint`
Expected: exits 0 with no output.

- [ ] **Step 6: Commit**

```bash
git add eslint.config.js tests/unit/tools/sim-boundary.test.ts
git commit -F - <<'EOF'
Add ESLint with the simulation boundary rule

src/sim may not import three, postprocessing, lil-gui or any render, game,
ui, audio or labs module, may not touch browser globals or process, and may
not call Math.random, Date.now or new Date. A regex pattern catches relative
paths such as ../render/draw, which gitignore-style groups miss. The unit
test plants each violation through the ESLint API and requires the rule to
fire, and shows the same calls pass outside src/sim.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: The blueprint gate and the composite check

**Files:**
- Create: `tools/check-blueprint.mjs`

- [ ] **Step 1: Write `tools/check-blueprint.mjs`**

```js
#!/usr/bin/env node
// Runs the aegis-suite blueprint gate over docs/blueprint.md. The checker lives in the owner's private
// plugin repository, so CI, which cannot see it, reports a skip instead of failing the build.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const candidates = [
  process.env.BLUEPRINT_CHECKER,
  join(homedir(), 'Documents', 'ClaudeWorkspace', 'claude-plugins-custom', 'aegis-suite', 'tools', 'blueprint.js'),
].filter(Boolean);

const checker = candidates.find((path) => existsSync(path));
if (!checker) {
  console.log('blueprint gate: skipped (checker not found; set BLUEPRINT_CHECKER to run it)');
  process.exit(0);
}

const result = spawnSync(process.execPath, [checker, 'check', 'docs/blueprint.md', '--gate'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
```

- [ ] **Step 2: Run the composite check**

Run: `npm run check`
Expected, on the owner's machine: type-check and lint print nothing, then `em dash check: 0 found in N files`, then `blueprint OK: blueprint.md (gate), 0 fail, 0 warn`, exit 0.

- [ ] **Step 3: Run the unit tests**

Run: `npm test`
Expected: PASS, 2 files, 9 tests.

- [ ] **Step 4: Commit**

```bash
git add tools/check-blueprint.mjs
git commit -F - <<'EOF'
Wire the blueprint gate into npm run check

npm run check now runs both TypeScript projects, ESLint, the em dash scan and
the aegis-suite blueprint gate. The gate's checker is private to the owner's
machine, so the wrapper skips with a message when it cannot find it instead
of failing CI.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Browser smoke tests

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/smoke.spec.ts`

- [ ] **Step 1: Install the Chromium build Playwright uses**

Run: `npx playwright install chromium`
Expected: ends with `chromium ... downloaded to ...` (about 180 MB, once per machine).

- [ ] **Step 2: Write `playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';

const ci = Boolean(process.env.CI);

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
    baseURL: 'http://127.0.0.1:4173/',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: !ci,
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
```

- [ ] **Step 3: Write `tests/e2e/smoke.spec.ts`**

```ts
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
```

- [ ] **Step 4: Run the smoke tests**

Run: `npm run e2e`
Expected: `2 passed`, and `test-results/style-lab-placeholder.png` shows a green toon-shaded cube on a slate background.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts tests/e2e/smoke.spec.ts
git commit -F - <<'EOF'
Add Playwright smoke tests for the home page and Style Lab

Both pages must boot with no console errors and set window.__P99__.ready,
and the Style Lab must show a visible WebGL canvas. CI uses Chrome's software
WebGL path, which now needs --enable-unsafe-swiftshader explicitly.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Continuous integration

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  check-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: '24'
          cache: npm
      - run: npm ci
      - run: npm run check
      - run: npm test
      - run: npx playwright install --with-deps chromium
      - run: npm run e2e
      - name: Keep browser evidence on failure
        if: failure()
        uses: actions/upload-artifact@v7
        with:
          name: e2e-results
          path: test-results
          retention-days: 7
```

- [ ] **Step 2: Commit and push**

```bash
git add .github/workflows/ci.yml
git commit -F - <<'EOF'
Run checks, unit tests and browser smoke tests in CI

Every push to main and every pull request runs npm run check (the blueprint
gate reports a skip on runners), the Vitest suite and the Playwright smoke
tests with Chromium, and keeps the test-results folder for a week when
anything fails.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git push
```

- [ ] **Step 3: Verify the run is green**

Run: `gh run watch --exit-status $(gh run list --workflow ci.yml --limit 1 --json databaseId --jq '.[0].databaseId')`
Expected: the run finishes with every step green and the command exits 0. If a step fails, read it with `gh run view --log-failed` and fix the cause before continuing.

---

### Task 8: GitHub Pages deployment

**Files:**
- Create: `.github/workflows/pages.yml`

- [ ] **Step 1: Write `.github/workflows/pages.yml`**

```yaml
name: Deploy Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: '24'
          cache: npm
      - run: npm ci
      - run: npm run build
        env:
          P99_BASE: /99-planets-to-defend-v4/
      - uses: actions/configure-pages@v6
      - uses: actions/upload-pages-artifact@v5
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

- [ ] **Step 2: Enable Pages for the repository with the Actions source**

Run: `gh api -X POST repos/majieddd/99-planets-to-defend-v4/pages -f build_type=workflow`
Expected: JSON containing `"build_type": "workflow"` and `"html_url": "https://majieddd.github.io/99-planets-to-defend-v4/"`. If it answers `409` because Pages already exists, run `gh api -X PUT repos/majieddd/99-planets-to-defend-v4/pages -f build_type=workflow` instead.

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/pages.yml
git commit -F - <<'EOF'
Deploy the site to GitHub Pages from main

The Pages workflow builds with P99_BASE=/99-planets-to-defend-v4/ so every
asset URL carries the project path, uploads dist/ and deploys it. Pages was
enabled with the Actions source.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git push
```

- [ ] **Step 4: Verify the deploy and the live pages**

Run:

```bash
gh run watch --exit-status $(gh run list --workflow pages.yml --limit 1 --json databaseId --jq '.[0].databaseId')
curl -s -o /dev/null -w "home %{http_code}\n" https://majieddd.github.io/99-planets-to-defend-v4/
curl -s -o /dev/null -w "style %{http_code}\n" https://majieddd.github.io/99-planets-to-defend-v4/labs/style.html
```

Expected: the run exits 0, then `home 200` and `style 200`.

- [ ] **Step 5: Look at the live Style Lab in the built-in browser**

Open `https://majieddd.github.io/99-planets-to-defend-v4/labs/style.html` with the built-in browser (`preview_start` with that URL), wait two seconds and take a screenshot. Expected: the rotating green cube. Save the screenshot to `docs/evidence/m0/pages-placeholder.png`.

---

### Task 9: Repository instructions and the running document

**Files:**
- Create: `CLAUDE.md`
- Modify: `docs/blueprint.md` (Decided, Task list, Where we are)

- [ ] **Step 1: Write `CLAUDE.md`**

```markdown
# Working on 99 Planets To Defend (v4)

Read `docs/blueprint.md` before your first edit. It is the approved design and the running record:
restate its pillars and name the first end-to-end playable (Build order, item 1) before any task.

## Run it

    npm run dev          # Vite dev server on http://127.0.0.1:5173
    npm run check        # both TypeScript projects, ESLint, em dash scan, blueprint gate
    npm test             # Vitest unit tests
    npm run e2e          # Playwright smoke tests (builds, then serves on 4173)

Live site: https://majieddd.github.io/99-planets-to-defend-v4/ (deployed from main).

## Invariants

These break silently. Each one exists because the reference game lost time to it.

1. **`src/sim` is pure.** No three, DOM, `process`, clock or `Math.random`. Time and randomness come
   in by injection (`src/sim/rng.ts` streams, the fixed tick). ESLint and `tsconfig.sim.json` both
   enforce it. Anything that needs storage or rendering belongs outside `src/sim`.
2. **three is pinned to 0.186.0.** The painted material includes r186 shader chunks. Upgrading three is
   its own task with a Style Lab visual comparison.
3. **TypeScript is pinned to 6.0.3.** typescript-eslint does not support TypeScript 7.
4. **No em dash anywhere**, in any of the four spellings `npm run check` scans for. Use " - ".
5. **Exported assets are committed.** `public/assets` is produced by `npm run assets` (Blender 5.2.1 via
   `BLENDER_PATH`); CI and Pages never run Blender.
6. **Done means evidence.** A result line or a frame that shows the behaviour, pasted into the review,
   never "the code reads right".

## House style

Comments explain why, not what, in full sentences. When you fix something subtle, say what the wrong
behaviour was. Commit messages describe the defect, the cause and the measurement; end each with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Player-facing copy is mechanics first and
flavour second, with no exclamation marks.
```

- [ ] **Step 2: Update `docs/blueprint.md`**

In the Decided table, change the first row to:

```markdown
| Browser game: TypeScript, Three.js on WebGL2, Vite, GitHub Pages | partial | toolchain, CI and Pages live (docs/evidence/m0/pages-placeholder.png); no game yet |
```

In the Task list, tick these two lines:

```markdown
- [x] Toolchain: Vite, strict TypeScript, Three.js, Vitest, Playwright, ESLint with the simulation
      boundary rule, an em dash check covering all four forms
- [x] CI workflow and the GitHub Pages deploy
```

Replace the Where we are paragraph's last sentence (`Next: the M0 implementation plan is written and dispatched.`) with:

```markdown
M0a is complete: the toolchain, checks, CI and the Pages site are live at
https://majieddd.github.io/99-planets-to-defend-v4/. Next: M0b, M0c and M0d in parallel.
```

- [ ] **Step 3: Run every check**

Run: `npm run check && npm test`
Expected: `blueprint OK ... 0 fail, 0 warn`, `em dash check: 0 found`, and all unit tests PASS.

- [ ] **Step 4: Commit and push**

```bash
git add CLAUDE.md docs/blueprint.md docs/evidence/m0/pages-placeholder.png
git commit -F - <<'EOF'
Add repository instructions and record M0a in the blueprint

CLAUDE.md carries the six invariants an agent must not break (simulation
purity, the three and TypeScript pins, the em dash rule, committed exports,
evidence-based done) and the commands to run and verify the project. The
blueprint's Decided ledger moves the platform row to partial with the live
Pages placeholder as evidence.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git push
```

---

## Self-review

- **Spec coverage:** Architecture stack (Task 1, 2), simulation boundary (Tasks 1, 4), em dash rule
  (Task 3), blueprint gate (Task 5), Verification instruments `npm run check`, `npm test`, `npm run e2e`
  (Tasks 3 to 6), CI (Task 7), Pages (Task 8), running document (Task 9). `npm run bot`,
  `test:determinism`, `assets`, `assets:check`, `capture` and `perf` belong to M0b, M0c and M0d.
- **Placeholders:** none; every file is given in full.
- **Consistency:** `window.__P99__` is declared in `src/env.d.ts` (Task 1) and used by `src/main.ts`,
  the Style Lab placeholder (Task 2) and the smoke tests (Task 6) with the same `ready` and `page`
  fields.
