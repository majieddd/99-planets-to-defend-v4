import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLOR_DIALS, DEFAULT_DIALS, NUMERIC_RANGES } from '../../../src/render/defaults';
import { acceptDial, decodeDials, encodeDials } from '../../../src/render/dialsCodec';
import { sunDirection, VERDANT } from '../../../src/render/themes';

/** Preset B3's live dials link, the golden-hour look the owner approved at the M0 style gate (blueprint, Render defaults). */
const B3_LINK =
  'eyJiYW5kcyI6MiwiYmFuZFNvZnRuZXNzIjowLjAzLCJ0ZXJtaW5hdG9yTm9pc2UiOjAuMywicGFpbnRTdHJlbmd0aCI6MSwic2F0dXJhdGlvbiI6MS4xMiwic2hhZG93RGVwdGgiOjAuNjIsInNoYWRvd1RpbnQiOiIjMWI3MDc4IiwicmltU3RyZW5ndGgiOjAuNiwic3RhbmRhcmRCbGVuZCI6MC40NSwiYW1iaWVudFN0cmVuZ3RoIjowLjIyLCJicnVzaFNjYWxlIjowLjcsInRlcnJhaW5CcnVzaCI6MS4yLCJwcm9wQnJ1c2giOjEuMywic29pbEJyZWFrdXAiOjEsImxpdFNhdHVyYXRpb24iOjAuODcsImFjdG9yRmlsbCI6MS40LCJpbmtXaWR0aFB4IjozLjIsImVkZ2VTdHJlbmd0aCI6MSwiZWRnZUxpbmVXaWR0aCI6MS40LCJmb2dEZW5zaXR5IjowLjAyLCJmb2dTdGFydCI6MCwiZm9nSGVpZ2h0RmFsbG9mZiI6MC4zLCJzdW5FbGV2YXRpb24iOjE1LCJzdW5Db2xvciI6IiNmZmMwNWMiLCJzdW5JbnRlbnNpdHkiOjYuNiwiZXhwb3N1cmUiOjAuNDQsImNvbnRyYXN0IjoxLjM1LCJibG9vbUludGVuc2l0eSI6MS4yLCJoZWFydEhhbG8iOjExLCJ2aWduZXR0ZSI6MC41NX0';

describe('VERDANT', () => {
  it('uses valid hex colours everywhere', () => {
    const hexes = JSON.stringify(VERDANT).match(/"#[^"]*"/g) ?? [];
    expect(hexes).toHaveLength(18);
    for (const hex of hexes) expect(hex).toMatch(/^"#[0-9a-fA-F]{6}"$/);
  });

  it('names hue bands inside 0 to 360', () => {
    for (const band of VERDANT.bands) {
      expect(band.hueMin).toBeGreaterThanOrEqual(0);
      expect(band.hueMax).toBeLessThanOrEqual(360);
    }
  });

  it('puts the sun above the horizon on a unit vector', () => {
    const [x, y, z] = sunDirection(VERDANT);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
    expect(y).toBeCloseTo(Math.sin((35 * Math.PI) / 180), 9);
  });
});

describe('dials', () => {
  const toLink = (json: string) => btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  it('keeps every numeric default inside its range', () => {
    for (const [key, range] of Object.entries(NUMERIC_RANGES)) {
      const value = DEFAULT_DIALS[key as keyof typeof DEFAULT_DIALS] as number;
      expect(value, key).toBeGreaterThanOrEqual(range[0]);
      expect(value, key).toBeLessThanOrEqual(range[1]);
    }
  });

  it('round-trips changed dials through the codec', () => {
    const changed = { ...DEFAULT_DIALS, inkWidthPx: 3.1, shadowTint: '#205060', bands: 4 };
    const text = encodeDials(changed);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeDials(text)).toEqual(changed);
    expect(encodeDials({ ...DEFAULT_DIALS, bands: 4 })).toBe('eyJiYW5kcyI6NH0');
    expect(decodeDials(toLink('{"bands":5,"exposure":0.2}'))).toEqual({ ...DEFAULT_DIALS, bands: 5, exposure: 0.2 });
  });

  it('encodes defaults as an empty object and ignores bad input', () => {
    expect(encodeDials(DEFAULT_DIALS)).toBe('e30');
    expect(decodeDials(encodeDials(DEFAULT_DIALS))).toEqual(DEFAULT_DIALS);
    expect(decodeDials('not base64 at all')).toEqual(DEFAULT_DIALS);
    const hostile = toLink(JSON.stringify({ bands: 'x', exposure: Number.NaN, unknown: 1, inkColor: 'red' }));
    expect(decodeDials(hostile)).toEqual(DEFAULT_DIALS);
    expect(decodeDials(toLink('{"bands":9,"edgeFadeFar":5,"grain":-0.1,"exposure":1e999,"inkColor":"#abc"}'))).toEqual(DEFAULT_DIALS);
    for (const json of ['null', '5', '"x"', '[1]']) expect(decodeDials(toLink(json))).toEqual(DEFAULT_DIALS);
  });

  it('gives every dial either a range or a colour, never both, and every colour default is six-digit hex', () => {
    // A dial with neither never reaches a link: the codec writes it but reads only ranged numbers and listed colours.
    for (const key of Object.keys(DEFAULT_DIALS) as (keyof typeof DEFAULT_DIALS)[]) {
      const ranged = key in NUMERIC_RANGES;
      const colour = (COLOR_DIALS as readonly string[]).includes(key);
      expect(ranged !== colour, key).toBe(true);
      if (colour) expect(DEFAULT_DIALS[key], key).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(COLOR_DIALS).toContain('sunColor');
  });

  it('round-trips the halo, height fog, sun and soil dials through a link', () => {
    // Off their defaults, inside their ranges; the colour is the only way a sun colour reaches a link.
    const changed = { ...DEFAULT_DIALS, heartHalo: 5.5, fogHeightFalloff: 0.2, sunElevation: 12.5, sunColor: '#ffaa55', sunIntensity: 2.4, soilBreakup: 0.7 };
    const decoded = decodeDials(encodeDials(changed));
    expect(decoded).toEqual(changed);
    // Out of range, or not a colour: each is dropped as a link's bad value is, and the default stands.
    const hostile = toLink(JSON.stringify({ heartHalo: 12.5, fogHeightFalloff: 0.6, sunElevation: 1, sunColor: 'orange', sunIntensity: 0.1, soilBreakup: 1.5 }));
    expect(decodeDials(hostile)).toEqual(DEFAULT_DIALS);
  });

  it('reaches a heart halo of 12, past preset B2 at the old top of 8, and still opens every link made under 8', () => {
    expect(NUMERIC_RANGES.heartHalo[0]).toBe(0);
    expect(NUMERIC_RANGES.heartHalo[1]).toBe(12);
    for (const heartHalo of [0, 4, 8, 9.5, 12]) expect(decodeDials(toLink(JSON.stringify({ heartHalo })))).toEqual({ ...DEFAULT_DIALS, heartHalo });
    expect(decodeDials(toLink(JSON.stringify({ heartHalo: 12.05 })))).toEqual(DEFAULT_DIALS);
  });

  it('round-trips the prop brush, lit saturation, actor fill and shadow lift through a link', () => {
    // Off their defaults, inside their ranges, and apart from each other.
    const changed = { ...DEFAULT_DIALS, propBrush: 0.65, litSaturation: 0.82, actorFill: 0.9, shadowLift: 0.085 };
    const text = encodeDials(changed);
    expect(decodeDials(text)).toEqual(changed);
    // Only the moved dials are written. A link opens against the current defaults, so one made before the M0 lock that
    // left a dial at its renderer v1 start now opens that dial at the locked value (blueprint, Render defaults).
    expect(JSON.parse(atob(text.replace(/-/g, '+').replace(/_/g, '/')))).toEqual({ shadowLift: 0.085, propBrush: 0.65, litSaturation: 0.82, actorFill: 0.9 });
    // Out of range or the wrong type: each is dropped and its default stands.
    const hostile = toLink(JSON.stringify({ propBrush: 1.6, litSaturation: 0.3, actorFill: -0.1, shadowLift: '0.01' }));
    expect(decodeDials(toLink(JSON.stringify({ shadowLift: 0.16 })))).toEqual(DEFAULT_DIALS);
    expect(decodeDials(hostile)).toEqual(DEFAULT_DIALS);
    const edges = { ...DEFAULT_DIALS, propBrush: 1.5, litSaturation: 0.4, actorFill: 2, shadowLift: 0.15 };
    expect(decodeDials(encodeDials(edges))).toEqual(edges);
  });

  it("locks Painted-Anime-Inkline 4.0 from the owner's golden-hour link B3, with the owner's three adjustments", () => {
    // The live preset link the owner approved at the M0 style gate on 2026-09-28, exactly as the lab's "Copy dials link"
    // wrote it against renderer v1's starts: it names the 30 dials that differed from them (the grain was already 0).
    const raw = JSON.parse(atob(B3_LINK.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
    expect(Object.keys(raw)).toHaveLength(30);
    for (const [key, value] of Object.entries(raw)) expect(acceptDial(key, value), key).toBe(true);
    // Every named dial is locked at B3's value but two, which the owner set; the third adjustment is a dial B3 left at
    // its start. A link names only what differs from the defaults, so this link now opens the locked look with
    // B3's edgeStrength and litSaturation, and keeps the locked edgeFadeFar it does not name.
    const OWNER = { edgeStrength: 0.33, edgeFadeFar: 65, litSaturation: 1.09 };
    expect({ ...raw, ...OWNER }).toEqual(Object.fromEntries(Object.keys({ ...raw, ...OWNER }).map((key) => [key, DEFAULT_DIALS[key as keyof typeof DEFAULT_DIALS]])));
    const opened = decodeDials(B3_LINK);
    expect(Object.keys(DEFAULT_DIALS).filter((key) => opened[key as keyof typeof opened] !== DEFAULT_DIALS[key as keyof typeof DEFAULT_DIALS]).sort()).toEqual(['edgeStrength', 'litSaturation']);
    expect(opened.edgeStrength).toBe(1);
    expect(opened.litSaturation).toBe(0.87);
    // The eight dials neither B3 nor the owner moved keep renderer v1's starts, and the edge fade stays strictly ordered.
    expect(Object.keys(DEFAULT_DIALS).length).toBe(30 + 1 + 8);
    expect({
      shadowLift: DEFAULT_DIALS.shadowLift,
      rimPower: DEFAULT_DIALS.rimPower,
      inkColor: DEFAULT_DIALS.inkColor,
      depthThreshold: DEFAULT_DIALS.depthThreshold,
      normalThreshold: DEFAULT_DIALS.normalThreshold,
      edgeFadeNear: DEFAULT_DIALS.edgeFadeNear,
      bloomThreshold: DEFAULT_DIALS.bloomThreshold,
      grain: DEFAULT_DIALS.grain,
    }).toEqual({ shadowLift: 0, rimPower: 3, inkColor: '#0e0f14', depthThreshold: 0.03, normalThreshold: 0.35, edgeFadeNear: 60, bloomThreshold: 1, grain: 0 });
    expect(DEFAULT_DIALS.edgeFadeNear).toBeLessThan(DEFAULT_DIALS.edgeFadeFar);
  });

  it("holds the blueprint's preset B3 row to the live link the lock was decoded from", () => {
    // The row records the approved look as JSON and no code reads it, so only this keeps the two from drifting apart. It
    // names the link's 30 dials at the link's values and the grain at 0, which the link leaves out as the default.
    const row = readFileSync('docs/blueprint.md', 'utf8')
      .split(/\r?\n/)
      .find((line) => line.startsWith('| Golden-hour preset B3 |'));
    const json = row ? /^\| Golden-hour preset B3 \| `([^`]+)` \|/.exec(row)?.[1] : undefined;
    if (!json) throw new Error('docs/blueprint.md has no Render defaults row "Golden-hour preset B3" opening with its JSON in backticks');
    const recorded = JSON.parse(json) as Record<string, unknown>;
    const raw = JSON.parse(atob(B3_LINK.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
    expect(recorded).toEqual({ ...raw, grain: 0 });
    // The row's claim: decodeDials opens the link at the row's value for every dial the row names.
    const opened = decodeDials(B3_LINK) as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(recorded)) expect(opened[key], key).toBe(value);
  });

  it("sets the gate's sun, height fog and soil from the locked look, while the Verdant theme keeps its own light", () => {
    // The dials override the theme's key; the theme keeps its own light, a baseline for the per-theme sun seeds M2 needs
    // (Task list), and the azimuth, which no dial moves. The locked key is lower, warmer and stronger than the theme's.
    expect(VERDANT.sun).toEqual({ color: '#ffd29a', intensity: 3.2, elevationDeg: 35, azimuthDeg: 250 });
    expect(DEFAULT_DIALS.sunElevation).toBe(15);
    expect(DEFAULT_DIALS.sunColor).toBe('#ffc05c');
    expect(DEFAULT_DIALS.sunIntensity).toBe(6.6);
    const blueOverRed = (hex: string) => parseInt(hex.slice(5, 7), 16) / parseInt(hex.slice(1, 3), 16);
    expect(blueOverRed(DEFAULT_DIALS.sunColor)).toBeLessThan(blueOverRed(VERDANT.sun.color));
    // The haze lies on the ground from the camera out, and the soil ring's edge breaks into the terrain's strokes.
    expect(DEFAULT_DIALS.fogHeightFalloff).toBe(0.3);
    expect(DEFAULT_DIALS.fogDensity).toBe(0.02);
    expect(DEFAULT_DIALS.fogStart).toBe(0);
    expect(DEFAULT_DIALS.soilBreakup).toBe(1);
    // The heart's halo is stronger than the energy's glow, so warm light reads as the heart's (Pillar 5).
    expect(DEFAULT_DIALS.heartHalo).toBeGreaterThan(DEFAULT_DIALS.bloomIntensity);
  });

  it('starts the film grain off, as the owner directed at the style gate, and keeps its dial', () => {
    expect(DEFAULT_DIALS.grain).toBe(0);
    expect(NUMERIC_RANGES.grain).toEqual([0, 0.2, 0.005]);
    // A link that names a grain still turns it on, so the owner can bring it back from the panel or a pasted link.
    const grainy = { ...DEFAULT_DIALS, grain: 0.06 };
    expect(decodeDials(toLink('{"grain":0.06}'))).toEqual(grainy);
    expect(decodeDials(encodeDials(grainy))).toEqual(grainy);
  });
});
