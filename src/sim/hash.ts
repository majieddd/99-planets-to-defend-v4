import type { JsonValue } from './types';

/** FNV-1a over UTF-16 code units. Small and stable; used to derive RNG stream seeds from names. */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** cyrb53: a 53-bit string hash with far fewer collisions than 32 bits, used for state fingerprints. */
export function cyrb53(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * JSON with object keys sorted at every level, so equal states give equal text whatever order their
 * fields were written in. Non-finite numbers throw: JSON would write NaN as null and quietly change the
 * game when the save loads.
 */
export function canonicalStringify(value: unknown): string {
  return canonical(value, new Set());
}

function canonical(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'number':
      if (!Number.isFinite(value)) throw new Error(`canonicalStringify: non-finite number ${String(value)}`);
      return JSON.stringify(value);
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'object': {
      // JSON has no references: an object reached twice loads back as two copies, so a resumed game would
      // drift from the continuous one although their hashes matched at the save. A cycle would never end.
      if (seen.has(value)) throw new Error('canonicalStringify: the same object or array is reachable twice');
      seen.add(value);
      // Array.from reads holes as undefined, which the default case refuses. map skipped holes, so join wrote
      // invalid text like [1,,,4] while the save held [1,null,null,4] and failed its own hash check on load.
      if (Array.isArray(value)) return `[${Array.from(value, (item) => canonical(item, seen)).join(',')}]`;
      const record = value as Record<string, unknown>;
      const fields = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(record[key], seen)}`);
      return `{${fields.join(',')}}`;
    }
    default:
      throw new Error(`canonicalStringify: unsupported type ${typeof value}`);
  }
}

/** A 14-hex-digit fingerprint of any JSON value, stable across key order. */
export function hashState(value: JsonValue | object): string {
  return cyrb53(canonicalStringify(value)).toString(16).padStart(14, '0');
}
