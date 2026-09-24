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
