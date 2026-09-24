import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREVIEW_PORT, previewPort } from '../../../tools/preview-port.ts';

describe('previewPort', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to 4173', () => {
    expect(DEFAULT_PREVIEW_PORT).toBe(4173);
  });

  it('uses the default when P99_PREVIEW_PORT is unset', () => {
    // An explicit undefined falls through to the environment, so the variable must be absent as well.
    vi.stubEnv('P99_PREVIEW_PORT', undefined);
    expect(previewPort(undefined)).toBe(4173);
    expect(previewPort()).toBe(4173);
  });

  it('uses the default when P99_PREVIEW_PORT is empty', () => {
    expect(previewPort('')).toBe(4173);
  });

  it('reads P99_PREVIEW_PORT from the environment', () => {
    vi.stubEnv('P99_PREVIEW_PORT', '4174');
    expect(previewPort()).toBe(4174);
  });

  it.each([
    { raw: '4174', port: 4174 },
    { raw: '1', port: 1 },
    { raw: '65535', port: 65535 },
  ])('accepts $raw', ({ raw, port }) => {
    expect(previewPort(raw)).toBe(port);
  });

  it.each(['abc', '41.5', '4174abc', ' 4174', '-1', '0', '65536', '1e4'])('rejects %j', (raw) => {
    expect(() => previewPort(raw)).toThrow(/P99_PREVIEW_PORT/);
  });
});
