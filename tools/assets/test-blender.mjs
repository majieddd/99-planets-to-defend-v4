#!/usr/bin/env node
// npm run test:blender: runs tests/blender/run_tests.py inside Blender and fails unless it reports fail=0.
import { join, resolve } from 'node:path';
import { runBlender } from './blender.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const result = await runBlender(['--python', join(root, 'tests', 'blender', 'run_tests.py')], { label: 'tests', quiet: false });
const summary = result.log.split(/\r?\n/).find((line) => line.startsWith('BLENDER_TESTS'));
if (result.code !== 0 || !summary || !summary.includes('fail=0')) {
  console.error('blender tests failed');
  process.exit(1);
}
