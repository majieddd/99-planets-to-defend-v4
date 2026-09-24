import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// The simulation is the game and must stay pure: no engine, DOM, clock or unseeded randomness.
// Breaking this destroys headless testing, the bot and any future port (blueprint, Architecture).
const SIM_MESSAGE = 'src/sim is pure: no rendering, DOM, clock or unseeded randomness (docs/blueprint.md, Architecture).';
const CLOCK_MESSAGE = 'The simulation takes time by injection.';
// globalThis, self and global reach every other name here (new globalThis.Date()); crypto is unseeded randomness.
const SIM_GLOBALS = ['window', 'self', 'globalThis', 'global', 'document', 'navigator', 'localStorage', 'sessionStorage',
  'indexedDB', 'performance', 'requestAnimationFrame', 'setTimeout', 'setInterval', 'fetch', 'process', 'crypto'];

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
    // src/shared is inside the simulation's type-checked view (tsconfig.sim.json), so it obeys the same rules.
    // Patterns ending in /** apply to every file another block already lints and pull nothing else in.
    files: ['src/sim/**', 'src/shared/**'],
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
      'no-restricted-globals': ['error', ...SIM_GLOBALS.map((name) => ({ name, message: SIM_MESSAGE }))],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded streams in src/sim/rng.ts.' },
        { object: 'Date', property: 'now', message: CLOCK_MESSAGE },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: ":matches(NewExpression, CallExpression)[callee.name='Date']", message: CLOCK_MESSAGE },
        // import() is asynchronous, which a fixed tick cannot wait for, and no-restricted-imports does not see it.
        { selector: 'ImportExpression', message: SIM_MESSAGE },
      ],
      // One /// <reference lib="dom" /> or types="node" in any file turns off tsconfig.sim.json's guard for all of src/sim.
      '@typescript-eslint/triple-slash-reference': ['error', { lib: 'never', path: 'never', types: 'never' }],
    },
  },
]);
