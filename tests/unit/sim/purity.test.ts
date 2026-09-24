import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.[cm]?[jt]sx?$/.test(path) ? [path] : [];
  });
}

// Both folders sit inside the simulation boundary. The minimum counts catch a scan that silently stops
// recursing or finds nothing.
const ROOTS: ReadonlyArray<readonly [string, number]> = [
  ['src/sim', 6],
  ['src/shared', 1],
];

// Raw text on purpose: a comment naming a forbidden call fails too, which errs on the safe side.
const FORBIDDEN: RegExp[] = [
  // Engine and shell modules in static, side-effect and dynamic imports and re-exports.
  /\b(?:from|import)\s*\(?\s*['"](?:three|postprocessing|lil-gui|(?:[^'"]*\/)?(?:render|game|ui|audio|labs)[/'"])/,
  // import() of a template, variable or expression can load anything; ESLint bans every import() here.
  /\bimport\s*\(\s*[^'"\s]/,
  /\brequire\s*\(/,
  // Clocks and unseeded randomness.
  /\bMath\s*(?:\??\.\s*random|(?:\?\.)?\[)/,
  /\bDate\s*(?:\??\.\s*now|(?:\?\.)?\[|\()/,
  /\bnew\s+(?:globalThis\s*\.\s*)?Date\b/,
  /\bperformance\s*\??\.\s*now/,
  // Host objects and the globals that reach them.
  /(?<![\w$]|[^.]\.)(?:window|document|crypto)\s*(?:\??\.[\w$[]|\[)/,
  /\b(?:globalThis|localStorage|sessionStorage|indexedDB|requestAnimationFrame|setTimeout|setInterval)\b/,
  // Code built from strings, which no lint rule or type check can see into.
  /\beval\b/,
  /\bFunction\s*\(/,
  // Results that depend on the machine's locale or on when the garbage collector runs.
  /\bIntl\b/,
  /\b(?:localeCompare|toLocale\w*)\b/,
  /\b(?:WeakRef|FinalizationRegistry)\b/,
];

describe('simulation purity', () => {
  it('contains no engine imports, clocks, unseeded randomness, string-built code, locale or collector reads', () => {
    for (const [root, minimum] of ROOTS) {
      const files = sourceFiles(root);
      expect(files.length, root).toBeGreaterThanOrEqual(minimum);
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        for (const pattern of FORBIDDEN) expect(pattern.test(text), `${file} matches ${pattern}`).toBe(false);
      }
    }
  });
});
