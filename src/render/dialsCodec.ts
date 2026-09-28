import { COLOR_DIALS, DEFAULT_DIALS, NUMERIC_RANGES, type RenderDials } from './defaults';

const HEX = /^#[0-9a-fA-F]{6}$/;

/** What the Style Lab's setDials handle returns: every dial after the move, and the names of the changes it refused. */
export interface SetDialsResult {
  dials: RenderDials;
  rejected: string[];
}

/**
 * Whether a value may stand for a dial: a finite number inside the dial's range for a numeric dial (a whole number for
 * the band count, which the shader counts light levels by), a six-digit hex colour for a colour dial, and nothing for a
 * name that is no dial, including the names every object inherits (constructor, toString, __proto__). A link's decode
 * and the lab's setDials both ask this, key by key, so the two cannot disagree. setDials used to check a change by
 * encoding it into a link and decoding it back, and btoa throws on a string outside Latin-1, so one such value made the
 * whole call throw: nothing moved and nothing came back to say which key was at fault.
 */
export function acceptDial(key: string, value: unknown): boolean {
  if (Object.hasOwn(NUMERIC_RANGES, key)) {
    const [min, max] = NUMERIC_RANGES[key as keyof typeof NUMERIC_RANGES];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return false;
    return key !== 'bands' || Number.isInteger(value);
  }
  if ((COLOR_DIALS as readonly string[]).includes(key)) return typeof value === 'string' && HEX.test(value);
  return false;
}

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

/** Applies only the dials acceptDial accepts; anything else in the link leaves the base value standing. */
export function decodeDials(text: string, base: RenderDials = DEFAULT_DIALS): RenderDials {
  const out: RenderDials = { ...base };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(text));
  } catch {
    return out;
  }
  if (typeof parsed !== 'object' || parsed === null) return out;
  const target = out as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(parsed)) {
    if (acceptDial(key, value)) target[key] = value;
  }
  return out;
}
