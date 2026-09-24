#!/usr/bin/env node
// Runs the aegis-suite blueprint gate over docs/blueprint.md. The checker lives in the owner's private
// plugin repository, so CI, which cannot see it, reports a skip instead of failing the build.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const override = process.env.BLUEPRINT_CHECKER;
const fallback = join(homedir(), 'Documents', 'ClaudeWorkspace', 'claude-plugins-custom', 'aegis-suite', 'tools', 'blueprint.js');

// A set override names the checker the caller wants. Falling back past a stale one ran a different
// checker, or none at all, and still exited 0.
if (override && !existsSync(override)) {
  console.error(`blueprint gate: BLUEPRINT_CHECKER names a missing file: ${override}`);
  process.exit(1);
}
const checker = override || (existsSync(fallback) ? fallback : undefined);
if (!checker) {
  // Only CI may skip. On the owner's machine a missing checker means the gate stopped running, and a
  // skip there reported success for a gate that never ran.
  if (process.env.CI) {
    console.log('blueprint gate: skipped in CI (checker not found)');
    process.exit(0);
  }
  console.error(`blueprint gate: checker not found at ${fallback}; set BLUEPRINT_CHECKER, or CI=1 to skip`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [checker, 'check', 'docs/blueprint.md', '--gate'], { stdio: 'inherit' });
if (result.error) console.error(`blueprint gate: could not run ${checker}: ${result.error.message}`);
process.exit(result.status ?? 1);
