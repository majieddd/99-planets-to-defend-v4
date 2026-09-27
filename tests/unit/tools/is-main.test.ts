import { dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isMain } from '../../../tools/is-main.mjs';

const here = fileURLToPath(import.meta.url);

describe('isMain', () => {
  it('is true for the script Node was started on, however the path to it is spelled', () => {
    expect(isMain(import.meta.url, ['node', here])).toBe(true);
    // A plain string comparison failed any spelling but Node's resolved one. A junction in the path was proven by
    // running assets:check through one for the M0c pre-PR review; the suite makes no links, so it writes nothing.
    expect(isMain(import.meta.url, ['node', [dirname(here), '..', 'tools', 'is-main.test.ts'].join(sep)])).toBe(true);
  });

  it('is false for another script, and when there is none, as under node -e', () => {
    expect(isMain(import.meta.url, ['node', [dirname(here), 'emdash.test.ts'].join(sep)])).toBe(false);
    expect(isMain(import.meta.url, ['node'])).toBe(false);
  });
});
