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
