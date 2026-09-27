#!/usr/bin/env node
// npm run test:blender: runs tests/blender/run_tests.py inside Blender and fails unless it reports at least one pass
// and fail=0.
import { join, resolve } from 'node:path';
import { runBlender } from './blender.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const result = await runBlender(['--python', join(root, 'tests', 'blender', 'run_tests.py')], { label: 'tests', quiet: false });
const summary = result.log.split(/\r?\n/).map((line) => /^BLENDER_TESTS pass=(\d+) fail=(\d+)$/.exec(line)).find(Boolean);
// This passed on fail=0 alone, so a run that found or ran no tests (pass=0 fail=0) reported success.
if (result.code !== 0 || !summary || Number(summary[1]) === 0 || Number(summary[2]) !== 0) {
  console.error(`blender tests failed (${summary?.[0] ?? 'no BLENDER_TESTS summary'}, exit code ${result.code}); a run must pass at least one test and fail none`);
  process.exit(1);
}
