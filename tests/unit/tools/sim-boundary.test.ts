import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((message) => message.ruleId ?? 'fatal').sort();
}

const SIM_GLOBALS = ['window', 'self', 'globalThis', 'global', 'document', 'navigator', 'localStorage', 'sessionStorage',
  'indexedDB', 'performance', 'requestAnimationFrame', 'setTimeout', 'setInterval', 'fetch', 'process', 'crypto'];
const ENGINE_IMPORTS = ['three', 'three/addons/controls/OrbitControls.js', 'postprocessing', 'lil-gui',
  '../render/draw', '../game/input', '../ui/hud', '../audio/engine', '../labs/style/dials'];

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

  it.each(SIM_GLOBALS)('refuses the global %s inside src/sim', async (name) => {
    expect(await ruleIds(`export const g = ${name};\n`, 'src/sim/planted.ts')).toContain('no-restricted-globals');
  });

  it.each(ENGINE_IMPORTS)("refuses import '%s' inside src/sim", async (specifier) => {
    expect(await ruleIds(`import * as m from '${specifier}';\nexport const x = m;\n`, 'src/sim/planted.ts')).toContain(
      'no-restricted-imports',
    );
  });

  it('covers nested folders, every linted extension and src/shared', async () => {
    for (const filePath of ['src/sim/dev/planted.ts', 'src/sim/planted.js', 'src/sim/planted.mjs', 'src/sim/planted.mts', 'src/shared/planted.ts']) {
      expect(await ruleIds('export const a = Math.random();\n', filePath)).toContain('no-restricted-properties');
    }
  });

  it('refuses dynamic import and Date() without new inside src/sim', async () => {
    expect(await ruleIds("export const m = import('three');\n", 'src/sim/planted.ts')).toContain('no-restricted-syntax');
    expect(await ruleIds('export const d = Date();\n', 'src/sim/planted.ts')).toContain('no-restricted-syntax');
  });

  it('refuses triple-slash lib and types references inside src/sim', async () => {
    for (const directive of ['/// <reference lib="dom" />', '/// <reference types="node" />']) {
      expect(await ruleIds(`${directive}\nexport {};\n`, 'src/sim/planted.ts')).toContain('@typescript-eslint/triple-slash-reference');
    }
  });

  it('says why in the globals message', async () => {
    const [result] = await eslint.lintText('export const w = window.innerWidth;\n', { filePath: 'src/sim/planted.ts' });
    expect(result?.messages[0]?.message).toContain('src/sim is pure');
  });

  it('allows dynamic import outside src/sim', async () => {
    expect(await ruleIds("export const m = import('three');\n", 'src/labs/planted.ts')).toEqual([]);
  });
});
