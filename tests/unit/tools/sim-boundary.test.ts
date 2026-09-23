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
