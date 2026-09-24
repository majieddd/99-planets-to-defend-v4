import { COLOR_DIALS, DEFAULT_DIALS, NUMERIC_RANGES, type RenderDials } from './defaults';

const HEX = /^#[0-9a-fA-F]{6}$/;

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  return atob(padded);
}

/** Only dials that differ from the defaults are written, so a shared link stays short. */
export function encodeDials(dials: RenderDials): string {
  const changed: Partial<Record<keyof RenderDials, number | string>> = {};
  for (const key of Object.keys(DEFAULT_DIALS) as (keyof RenderDials)[]) {
    if (dials[key] !== DEFAULT_DIALS[key]) changed[key] = dials[key];
  }
  return toBase64Url(JSON.stringify(changed));
}

/** Applies only well-formed known dials: finite numbers inside their range, six-digit hex colours. */
export function decodeDials(text: string, base: RenderDials = DEFAULT_DIALS): RenderDials {
  const out: RenderDials = { ...base };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(text));
  } catch {
    return out;
  }
  if (typeof parsed !== 'object' || parsed === null) return out;
  const record = parsed as Record<string, unknown>;
  for (const [key, range] of Object.entries(NUMERIC_RANGES)) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= range[0] && value <= range[1]) {
      (out as unknown as Record<string, number>)[key] = value;
    }
  }
  for (const key of COLOR_DIALS) {
    const value = record[key];
    if (typeof value === 'string' && HEX.test(value)) out[key] = value;
  }
  return out;
}
