// Finds Blender and runs a Python script headless, collecting its output. --python-exit-code 1 makes an
// uncaught Python exception exit non-zero, which Blender does not do by default.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function findBlender() {
  const candidates = [process.env.BLENDER_PATH, join(homedir(), 'tools', 'blender-5.2.1', 'blender.exe')].filter(Boolean);
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error('Blender not found: set BLENDER_PATH to Blender 5.2.1 LTS');
  return found;
}

export function runBlender(scriptArgs, { label = 'blender', quiet = true } = {}) {
  const args = ['-b', '--factory-startup', '--python-exit-code', '1', ...scriptArgs];
  return new Promise((resolve) => {
    const child = spawn(findBlender(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    const collect = (chunk) => {
      const text = chunk.toString();
      log += text;
      if (!quiet) process.stdout.write(text);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('close', (code) => resolve({ label, code: code ?? 1, log }));
  });
}
