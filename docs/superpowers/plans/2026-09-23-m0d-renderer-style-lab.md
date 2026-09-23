# M0d Renderer and Style Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the Painted-Anime-Inkline 4.0 renderer (painted lighting material, hull ink, screen-space edge ink, fog, painted sky, bloom, grade, quality tiers) and the Style Lab page that shows the M0 style scene with live dials, a reference board and a colour audit with its mutation proof, deployed for the owner's style gate.

**Architecture:** one `ShaderMaterial` family paints everything: it includes r186's skinning and shadow chunks, reads the scene's first directional light, bands the light with a brush-broken terminator, tints shadows with the theme's colour and blends toward standard lighting per material (characters more, as Sifu does). Every painted material shares one set of dial uniforms, so a dial move updates the whole scene. Ink is two passes: an inverted-hull child mesh per inked mesh (width from the `_ink` attribute, constant in screen pixels, thinning with distance), and a postprocessing `Effect` that finds depth and normal discontinuities. pmndrs postprocessing runs RenderPass, NormalPass (hulls and sky excluded by layer), ink and fog, then bloom, grade, AgX tone mapping and a finish pass (vignette, grain). The Style Lab builds a curved patch of a 160 m planet, places M0c's assets (or labelled placeholders when they are missing), animates them and wires every dial to lil-gui.

**Tech Stack:** three 0.186.0 (WebGL2), postprocessing 6.39.5, lil-gui 0.21.0, TypeScript 6.0.3, Vitest 5, Playwright 1.63.

**Prerequisites:** M0a complete. M0c's assets are needed only for Task 11; everything before it runs on placeholders.

---

## Facts verified against the pinned versions (do not re-derive)

- r186 declares `attribute vec2 uv;` for every non-raw material; `color` is declared only with `vertexColors`.
- `PCFSoftShadowMap` was removed in r186 (it warns and falls back). Use `PCFShadowMap` and `light.shadow.radius`.
- `inverseTransformDirection` is deprecated; use `transformNormalByInverseViewMatrix(normal, viewMatrix)`.
- `getShadowMask()` (shadowmask chunk) needs `lights_pars_begin` (which declares `receiveShadow`) and
  `shadowmap_pars_fragment`; `shadowmap_vertex` needs `worldpos_vertex` before it.
- `UniformsUtils.merge` clones uniforms. To share dial uniforms across materials, spread the shared
  `{ value }` objects into each material's uniforms instead.
- postprocessing: `new Effect(name, fragment, { attributes, blendFunction, uniforms: Map })`; with
  `EffectAttribute.DEPTH` the fragment is `mainImage(inputColor, uv, depth, out outputColor)` and may call
  `readDepth(uv)` and `getViewZ(depth)`. The pass prefixes effect identifiers when it merges effects, and
  owns names such as `resolution`, `texelSize` and `normalBuffer`, so custom uniforms here all start with
  `u`. `BloomEffect` exposes `luminanceMaterial.threshold`. `NormalPass(scene, camera, { resolutionScale })`
  exposes `.texture` (packed view-space normals). `ToneMappingMode.AGX` exists.
- `three/addons/*` maps to `examples/jsm/*` in both three and @types/three; GLTFLoader, OrbitControls and
  `libs/meshopt_decoder.module.js` are typed.
- GLTFLoader names a custom `_INK` attribute `_ink` and copies node extras into `object.userData`.
- M0c stores `_ink` as width / 2; the hull shader multiplies by 2.
- Lesson from `worldheart-styles`: adding hull children inside `traverse()` makes traverse visit the hulls
  and give them hulls forever. Collect meshes first, then add hulls.

## File map

| File | Responsibility |
|---|---|
| `src/render/layers.ts` | render layers (world, hull, sky) |
| `src/render/themes.ts` | `Theme`, `AuditBand`, `VERDANT`, `sunDirection` |
| `src/render/defaults.ts` | `RenderDials`, `DEFAULT_DIALS`, ranges |
| `src/render/dialsCodec.ts` | dials to and from a URL-safe string |
| `src/render/quality.ts` | tiers, GPU-based tier choice |
| `src/render/ink/inkNormals.ts` | averaged normals for closed hulls |
| `src/render/ink/hull.ts` | hull material and `attachHull` |
| `src/render/materials/painted.ts` | shared paint uniforms, `createPaintedMaterial`, GLSL |
| `src/render/post/*.ts` | ink edge, fog, grade and finish effects, the pipeline |
| `src/render/sky.ts` | painted sky dome |
| `src/render/renderer.ts` | the configured `WebGLRenderer` |
| `src/render/terrain/noise.ts`, `stylePatch.ts` | value noise and the curved style patch |
| `src/render/assets/manifest.ts`, `loadAsset.ts` | manifest types, GLB loading, paint and ink conversion |
| `src/labs/style/audit.ts` | the colour audit and mutation proof (pure) |
| `src/labs/style/placeholders.ts` | stand-ins until M0c's assets exist |
| `src/labs/style/scene.ts` | style scene layout, animation, camera presets |
| `src/labs/style/dials.ts`, `referenceBoard.ts`, `main.ts`, `style.css` | the lab page |
| `labs/style.html` | page markup |
| `tests/unit/render/*.test.ts`, `tests/unit/labs/audit.test.ts`, `tests/e2e/style-lab.spec.ts` | tests |

---

### Task 1: Dependencies, layers, theme, dials and the dial codec

**Files:**
- Create: `src/render/layers.ts`, `src/render/themes.ts`, `src/render/defaults.ts`, `src/render/dialsCodec.ts`
- Test: `tests/unit/render/themes-dials.test.ts`

- [ ] **Step 1: Install the runtime dependencies**

Run: `npm install --save-exact postprocessing@6.39.5 lil-gui@0.21.0`
Expected: `added 2 packages`, no peer warning (postprocessing accepts three `>=0.168 <0.187`).

- [ ] **Step 2: Write the failing test `tests/unit/render/themes-dials.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIALS, NUMERIC_RANGES } from '../../../src/render/defaults';
import { decodeDials, encodeDials } from '../../../src/render/dialsCodec';
import { sunDirection, VERDANT } from '../../../src/render/themes';

describe('VERDANT', () => {
  it('uses valid hex colours everywhere', () => {
    const hexes = JSON.stringify(VERDANT).match(/#[0-9a-fA-F]+/g) ?? [];
    expect(hexes.length).toBeGreaterThan(15);
    for (const hex of hexes) expect(hex).toMatch(/^#[0-9a-fA-F]{6}$/);
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
  });

  it('encodes defaults as an empty object and ignores bad input', () => {
    expect(decodeDials(encodeDials(DEFAULT_DIALS))).toEqual(DEFAULT_DIALS);
    expect(decodeDials('not base64 at all')).toEqual(DEFAULT_DIALS);
    const hostile = btoa(JSON.stringify({ bands: 'x', exposure: Number.NaN, unknown: 1, inkColor: 'red' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(decodeDials(hostile)).toEqual(DEFAULT_DIALS);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/unit/render/themes-dials.test.ts`
Expected: FAIL, modules cannot be resolved.

- [ ] **Step 4: Write `src/render/layers.ts`**

```ts
/** Render layers. The normal pass renders the world layer only, so hulls and the sky never enter the edge test. */
export const LAYERS = { world: 0, hull: 1, sky: 2 } as const;
```

- [ ] **Step 5: Write `src/render/themes.ts`**

```ts
/** A hue band the colour audit expects a theme's frames to concentrate in. */
export interface AuditBand {
  name: string;
  /** Degrees. hueMin greater than hueMax means the band wraps through 0. */
  hueMin: number;
  hueMax: number;
}

/**
 * A planet theme owns a named palette and a named light (blueprint, Art direction): a palette plus a light
 * direction is what buys the anime read, not the name of a style.
 */
export interface Theme {
  id: string;
  name: string;
  sun: { color: string; intensity: number; elevationDeg: number; azimuthDeg: number };
  shadowTint: string;
  ambient: { sky: string; ground: string };
  sky: { zenith: string; horizon: string; ground: string; cloudLit: string; cloudShadow: string };
  fog: { color: string; sunColor: string };
  grade: { shadows: string; highlights: string };
  ground: { meadow: string; meadowLight: string; moss: string; stone: string; soil: string };
  bands: AuditBand[];
}

export const VERDANT: Theme = {
  id: 'verdant',
  name: 'Verdant Highlands',
  sun: { color: '#ffd29a', intensity: 3.2, elevationDeg: 35, azimuthDeg: 250 },
  shadowTint: '#2f8f8c',
  ambient: { sky: '#9cc7e0', ground: '#6b8f5a' },
  sky: { zenith: '#4f8fcf', horizon: '#f4d9a8', ground: '#8aa383', cloudLit: '#fff1d6', cloudShadow: '#9fb6cf' },
  fog: { color: '#cfe0d6', sunColor: '#ffe0b0' },
  grade: { shadows: '#d4ecf0', highlights: '#fff0dc' },
  ground: { meadow: '#4ec98a', meadowLight: '#7fdd9e', moss: '#2e8f6a', stone: '#8a8378', soil: '#8a6a4a' },
  bands: [
    { name: 'amber light', hueMin: 25, hueMax: 60 },
    { name: 'jade meadow', hueMin: 80, hueMax: 170 },
    { name: 'teal shadow and sky', hueMin: 170, hueMax: 225 },
  ],
};

/** Unit vector pointing from the ground toward the sun, with +Y up. */
export function sunDirection(theme: Theme): [number, number, number] {
  const elevation = (theme.sun.elevationDeg * Math.PI) / 180;
  const azimuth = (theme.sun.azimuthDeg * Math.PI) / 180;
  return [Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth)];
}
```

- [ ] **Step 6: Write `src/render/defaults.ts`**

```ts
/**
 * Every dial the Style Lab exposes. DEFAULT_DIALS are the starting values from docs/blueprint.md (Numbers,
 * Render defaults). At the M0 gate the owner's approved values replace them and become Painted-Anime-Inkline 4.0.
 */
export interface RenderDials {
  bands: number;
  bandSoftness: number;
  terminatorNoise: number;
  paintStrength: number;
  saturation: number;
  shadowDepth: number;
  shadowTint: string;
  rimStrength: number;
  rimPower: number;
  standardBlend: number;
  ambientStrength: number;
  brushScale: number;
  terrainBrush: number;
  inkWidthPx: number;
  inkColor: string;
  edgeStrength: number;
  edgeLineWidth: number;
  depthThreshold: number;
  normalThreshold: number;
  edgeFadeNear: number;
  edgeFadeFar: number;
  fogDensity: number;
  fogStart: number;
  exposure: number;
  contrast: number;
  bloomIntensity: number;
  bloomThreshold: number;
  grain: number;
  vignette: number;
}

export const DEFAULT_DIALS: RenderDials = {
  bands: 3,
  bandSoftness: 0.06,
  terminatorNoise: 0.12,
  paintStrength: 0.85,
  saturation: 1.3,
  shadowDepth: 0.35,
  shadowTint: '#2f8f8c',
  rimStrength: 0.35,
  rimPower: 3,
  standardBlend: 0.35,
  ambientStrength: 0.45,
  brushScale: 0.35,
  terrainBrush: 0.5,
  inkWidthPx: 2.2,
  inkColor: '#0e0f14',
  edgeStrength: 0.9,
  edgeLineWidth: 1.2,
  depthThreshold: 0.03,
  normalThreshold: 0.35,
  edgeFadeNear: 60,
  edgeFadeFar: 180,
  fogDensity: 0.006,
  fogStart: 20,
  exposure: 0.77,
  contrast: 1.05,
  bloomIntensity: 0.6,
  bloomThreshold: 1.0,
  grain: 0.04,
  vignette: 0.35,
};

type NumericKey = { [K in keyof RenderDials]: RenderDials[K] extends number ? K : never }[keyof RenderDials];

/** min, max, step for every numeric dial. */
export const NUMERIC_RANGES: Record<NumericKey, [number, number, number]> = {
  bands: [2, 5, 1],
  bandSoftness: [0.005, 0.25, 0.005],
  terminatorNoise: [0, 0.4, 0.01],
  paintStrength: [0, 1, 0.01],
  saturation: [0.5, 2, 0.01],
  shadowDepth: [0.05, 0.8, 0.01],
  rimStrength: [0, 1.5, 0.01],
  rimPower: [1, 8, 0.1],
  standardBlend: [0, 1, 0.01],
  ambientStrength: [0, 1.5, 0.01],
  brushScale: [0.05, 2, 0.01],
  terrainBrush: [0, 1.5, 0.01],
  inkWidthPx: [0, 6, 0.1],
  edgeStrength: [0, 1, 0.01],
  edgeLineWidth: [0.5, 3, 0.05],
  depthThreshold: [0.005, 0.2, 0.005],
  normalThreshold: [0.05, 1, 0.01],
  edgeFadeNear: [5, 300, 1],
  edgeFadeFar: [10, 600, 1],
  fogDensity: [0, 0.03, 0.0005],
  fogStart: [0, 200, 1],
  exposure: [0.2, 3, 0.01],
  contrast: [0.7, 1.5, 0.01],
  bloomIntensity: [0, 3, 0.01],
  bloomThreshold: [0.2, 3, 0.01],
  grain: [0, 0.2, 0.005],
  vignette: [0, 1, 0.01],
};

export const COLOR_DIALS = ['shadowTint', 'inkColor'] as const;
```

- [ ] **Step 7: Write `src/render/dialsCodec.ts`**

```ts
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
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/unit/render/themes-dials.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/render/layers.ts src/render/themes.ts src/render/defaults.ts src/render/dialsCodec.ts tests/unit/render/themes-dials.test.ts
git commit -F - <<'EOF'
Add the Verdant theme, render dials and a URL-safe dial codec

The theme owns its palette, sun, shadow tint, sky, fog, grade and the hue
bands the colour audit expects. DEFAULT_DIALS carry the blueprint's render
start values (v3's 1.3.2 calibration where it applies). The codec writes only
changed dials and refuses anything outside a dial's range or not a six-digit
hex colour, so a pasted link can never push the renderer into NaN.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: The colour audit and its mutation proof

**Files:**
- Create: `src/labs/style/audit.ts`
- Test: `tests/unit/labs/audit.test.ts`

The metric follows the `art-catalogue` method: concentration of chromatic pixels inside the theme's hue bands against chance (share in bands divided by the bands' total width over 360). An establishing frame passes at 1.5 times chance. The mutation proof rotates the frame's dominant hue into the widest gap between bands and requires the audit to fail.

- [ ] **Step 1: Write the failing test `tests/unit/labs/audit.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { auditPixels, bandCoverage, hsvToRgb, inBand, mutationProof, rgbToHsv, widestGapCenter } from '../../../src/labs/style/audit';
import { VERDANT } from '../../../src/render/themes';

function solid(h: number, s: number, v: number, count = 400): Uint8ClampedArray {
  const [r, g, b] = hsvToRgb(h, s, v);
  const out = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) out.set([r, g, b, 255], i * 4);
  return out;
}

describe('colour conversions', () => {
  it('round-trips hue, saturation and value', () => {
    for (const [h, s, v] of [[0, 1, 1], [150, 0.6, 0.7], [210, 0.4, 0.9], [330, 0.8, 0.5]] as const) {
      const [r, g, b] = hsvToRgb(h, s, v);
      const [h2, s2, v2] = rgbToHsv(r, g, b);
      expect(Math.abs(((h2 - h + 540) % 360) - 180)).toBeLessThan(2);
      expect(s2).toBeCloseTo(s, 1);
      expect(v2).toBeCloseTo(v, 1);
    }
  });
});

describe('bands', () => {
  it('measures coverage without double counting', () => {
    expect(bandCoverage(VERDANT.bands)).toBe(180);
    expect(bandCoverage([{ name: 'a', hueMin: 10, hueMax: 50 }, { name: 'b', hueMin: 30, hueMax: 70 }])).toBe(60);
  });

  it('handles a band that wraps through zero', () => {
    const band = { name: 'wrap', hueMin: 340, hueMax: 20 };
    expect(inBand(350, band)).toBe(true);
    expect(inBand(10, band)).toBe(true);
    expect(inBand(30, band)).toBe(false);
  });

  it('finds the widest gap', () => {
    expect(widestGapCenter(VERDANT.bands)).toBe(305);
  });
});

describe('auditPixels', () => {
  it('passes a frame inside the theme bands', () => {
    const report = auditPixels(solid(150, 0.6, 0.7), VERDANT.bands);
    expect(report.inBandShare).toBe(1);
    expect(report.chance).toBeCloseTo(0.5, 9);
    expect(report.concentration).toBeCloseTo(2, 9);
    expect(report.verdict).toBe('pass');
  });

  it('fails a frame outside them and calls a grey frame inconclusive', () => {
    expect(auditPixels(solid(300, 0.6, 0.7), VERDANT.bands).verdict).toBe('fail');
    expect(auditPixels(solid(0, 0.02, 0.6), VERDANT.bands).verdict).toBe('inconclusive');
  });
});

describe('mutationProof', () => {
  it('rotates a passing frame into the widest gap and requires the audit to reject it', () => {
    // Hue 150 lands in the 150 to 160 histogram bin, so the dominant hue is 155 and the widest gap's centre
    // (305) is 150 degrees away.
    const proof = mutationProof(solid(150, 0.6, 0.7), VERDANT.bands);
    expect(proof.rotation).toBe(150);
    expect(proof.report.verdict).toBe('fail');
    expect(proof.rejected).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/labs/audit.test.ts`
Expected: FAIL, `src/labs/style/audit` cannot be resolved.

- [ ] **Step 3: Write `src/labs/style/audit.ts`**

```ts
import type { AuditBand } from '../../render/themes';

/** Pixels below this saturation or value are material mass, not colour, and are left out of the hue test. */
const SAT_MIN = 0.18;
const VAL_MIN = 0.12;
/** A frame with less colour than this cannot say anything about its palette. */
const CHROMATIC_MIN = 0.2;

export interface AuditReport {
  pixels: number;
  chromaticShare: number;
  inBandShare: number;
  chance: number;
  concentration: number;
  bandShares: Record<string, number>;
  dominantHue: number;
  verdict: 'pass' | 'fail' | 'inconclusive';
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const [r, g, b] =
    hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  const m = v - c;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function inBand(hue: number, band: AuditBand): boolean {
  const h = ((hue % 360) + 360) % 360;
  return band.hueMin <= band.hueMax ? h >= band.hueMin && h < band.hueMax : h >= band.hueMin || h < band.hueMax;
}

function coverageBins(bands: readonly AuditBand[]): boolean[] {
  const bins = new Array<boolean>(360).fill(false);
  for (let degree = 0; degree < 360; degree++) bins[degree] = bands.some((band) => inBand(degree + 0.5, band));
  return bins;
}

/** Degrees of the hue circle covered by at least one band. */
export function bandCoverage(bands: readonly AuditBand[]): number {
  return coverageBins(bands).filter(Boolean).length;
}

/** Centre of the longest run of hues no band covers, wrapping through zero. */
export function widestGapCenter(bands: readonly AuditBand[]): number {
  const bins = coverageBins(bands);
  let bestStart = 0;
  let bestLength = 0;
  for (let start = 0; start < 360; start++) {
    if (bins[start] || !bins[(start + 359) % 360]) continue; // runs start right after a covered bin
    let length = 0;
    while (length < 360 && !bins[(start + length) % 360]) length++;
    if (length > bestLength) {
      bestLength = length;
      bestStart = start;
    }
  }
  return (bestStart + Math.floor(bestLength / 2)) % 360;
}

export function auditPixels(rgba: ArrayLike<number>, bands: readonly AuditBand[], gate = 1.5): AuditReport {
  const pixels = Math.floor(rgba.length / 4);
  const histogram = new Array<number>(36).fill(0);
  const bandCounts = new Map<string, number>(bands.map((band) => [band.name, 0]));
  let chromatic = 0;
  let inBands = 0;
  for (let i = 0; i < pixels; i++) {
    const [h, s, v] = rgbToHsv(rgba[i * 4] as number, rgba[i * 4 + 1] as number, rgba[i * 4 + 2] as number);
    if (s < SAT_MIN || v < VAL_MIN) continue;
    chromatic += 1;
    histogram[Math.min(35, Math.floor(h / 10))]! += 1;
    let counted = false;
    for (const band of bands) {
      if (!inBand(h, band)) continue;
      bandCounts.set(band.name, (bandCounts.get(band.name) ?? 0) + 1);
      counted = true;
    }
    if (counted) inBands += 1;
  }
  const chance = bandCoverage(bands) / 360;
  const inBandShare = chromatic ? inBands / chromatic : 0;
  const concentration = chance > 0 ? inBandShare / chance : 0;
  const chromaticShare = pixels ? chromatic / pixels : 0;
  const bandShares: Record<string, number> = {};
  for (const [name, count] of bandCounts) bandShares[name] = chromatic ? count / chromatic : 0;
  const peak = histogram.indexOf(Math.max(...histogram));
  const verdict = chromaticShare < CHROMATIC_MIN ? 'inconclusive' : concentration >= gate ? 'pass' : 'fail';
  return { pixels, chromaticShare, inBandShare, chance, concentration, bandShares, dominantHue: peak * 10 + 5, verdict };
}

export function rotateHue(rgba: ArrayLike<number>, degrees: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const [h, s, v] = rgbToHsv(rgba[i] as number, rgba[i + 1] as number, rgba[i + 2] as number);
    const [r, g, b] = hsvToRgb(h + degrees, s, v);
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = rgba[i + 3] as number;
  }
  return out;
}

/**
 * Breaks a frame on purpose: its dominant hue is rotated into the widest gap between the bands. An audit
 * that still passes the broken frame is measuring nothing (art-catalogue, mutation proof).
 */
export function mutationProof(rgba: ArrayLike<number>, bands: readonly AuditBand[], gate = 1.5) {
  const original = auditPixels(rgba, bands, gate);
  const rotation = (widestGapCenter(bands) - original.dominantHue + 360) % 360;
  const report = auditPixels(rotateHue(rgba, rotation), bands, gate);
  return { rotation, report, rejected: report.verdict === 'fail' };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/labs/audit.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/labs/style/audit.ts tests/unit/labs/audit.test.ts
git commit -F - <<'EOF'
Add the Style Lab colour audit and its mutation proof

Concentration is the share of chromatic pixels inside the theme's hue bands
divided by chance (the bands' coverage of the hue circle); an establishing
frame passes at 1.5 times chance, a frame with under 20% colour is
inconclusive. The mutation proof rotates the dominant hue into the widest gap
between bands and requires a fail, so the audit is shown able to reject.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Ink normals, the hull and quality tiers

**Files:**
- Create: `src/render/ink/inkNormals.ts`, `src/render/ink/hull.ts`, `src/render/quality.ts`
- Test: `tests/unit/render/ink-quality.test.ts`

- [ ] **Step 1: Write the failing test `tests/unit/render/ink-quality.test.ts`**

```ts
import { Bone, BoxGeometry, BufferAttribute, Float32BufferAttribute, Mesh, MeshBasicMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIALS } from '../../../src/render/defaults';
import { attachHull, createHullMaterial, createInkUniforms } from '../../../src/render/ink/hull';
import { computeInkNormals } from '../../../src/render/ink/inkNormals';
import { tierForGpu, TIERS } from '../../../src/render/quality';

function inked(width: number) {
  const geometry = new BoxGeometry(1, 1, 1);
  geometry.setAttribute('inkWidth', new Float32BufferAttribute(new Array(geometry.getAttribute('position').count).fill(width), 1));
  return geometry;
}

describe('computeInkNormals', () => {
  it('averages split normals at a cube corner into the diagonal', () => {
    const geometry = new BoxGeometry(1, 1, 1);
    const attr = computeInkNormals(geometry);
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const expected = [position.getX(i), position.getY(i), position.getZ(i)].map((c) => Math.sign(c) / Math.sqrt(3));
      expect(attr.getX(i)).toBeCloseTo(expected[0]!, 5);
      expect(attr.getY(i)).toBeCloseTo(expected[1]!, 5);
      expect(attr.getZ(i)).toBeCloseTo(expected[2]!, 5);
    }
  });
});

describe('attachHull', () => {
  const material = createHullMaterial(createInkUniforms(DEFAULT_DIALS));

  it('adds one hull child on the hull layer that ignores shadows', () => {
    const mesh = new Mesh(inked(0.5), new MeshBasicMaterial());
    const hull = attachHull(mesh, material, 1);
    expect(hull).not.toBeNull();
    expect(mesh.children).toEqual([hull]);
    expect(hull!.layers.mask).toBe(1 << 1);
    expect(hull!.castShadow).toBe(false);
    expect(mesh.geometry.getAttribute('inkNormal')).toBeDefined();
  });

  it('skips meshes whose ink is zero or missing', () => {
    expect(attachHull(new Mesh(inked(0), new MeshBasicMaterial()), material, 1)).toBeNull();
    expect(attachHull(new Mesh(new BoxGeometry(), new MeshBasicMaterial()), material, 1)).toBeNull();
  });

  it('binds a skinned hull to the same skeleton', () => {
    const geometry = inked(0.5);
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(count * 4).fill(0), 4));
    geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array(count * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    const bone = new Bone();
    const skinned = new SkinnedMesh(geometry, new MeshBasicMaterial());
    skinned.add(bone);
    skinned.bind(new Skeleton([bone]));
    const hull = attachHull(skinned, material, 1) as SkinnedMesh;
    expect(hull.isSkinnedMesh).toBe(true);
    expect(hull.skeleton).toBe(skinned.skeleton);
  });
});

describe('tierForGpu', () => {
  it('picks a tier from the GPU string', () => {
    expect(tierForGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Laptop GPU Direct3D11)', false)).toBe('high');
    expect(tierForGpu('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', false)).toBe('medium');
    expect(tierForGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))', false)).toBe('low');
    expect(tierForGpu('Adreno (TM) 740', true)).toBe('low');
    expect(TIERS.low.edgeInk).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/render/ink-quality.test.ts`
Expected: FAIL, modules cannot be resolved.

- [ ] **Step 3: Write `src/render/ink/inkNormals.ts`**

```ts
import { BufferAttribute, type BufferGeometry, Vector3 } from 'three';

/**
 * Averages the normals of vertices that share a position. A hull pushed out along split (hard-edge)
 * normals tears open at every crease; pushed along these it stays closed.
 */
export function computeInkNormals(geometry: BufferGeometry, precision = 1e-4): BufferAttribute {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const sums = new Map<string, Vector3>();
  const keys = new Array<string>(position.count);
  const v = new Vector3();
  const n = new Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    const key = `${Math.round(v.x / precision)},${Math.round(v.y / precision)},${Math.round(v.z / precision)}`;
    keys[i] = key;
    n.fromBufferAttribute(normal, i);
    const sum = sums.get(key);
    if (sum) sum.add(n);
    else sums.set(key, n.clone());
  }
  const out = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const sum = sums.get(keys[i] as string) as Vector3;
    const length = sum.length() || 1;
    out[i * 3] = sum.x / length;
    out[i * 3 + 1] = sum.y / length;
    out[i * 3 + 2] = sum.z / length;
  }
  const attribute = new BufferAttribute(out, 3);
  geometry.setAttribute('inkNormal', attribute);
  return attribute;
}
```

- [ ] **Step 4: Write `src/render/ink/hull.ts`**

```ts
import {
  BackSide,
  Color,
  InstancedMesh,
  Mesh,
  ShaderMaterial,
  SkinnedMesh,
  Vector2,
  type IUniform,
  type Material,
} from 'three';
import type { RenderDials } from '../defaults';
import { computeInkNormals } from './inkNormals';

export interface InkUniforms {
  [name: string]: IUniform;
  uInkWidthPx: IUniform<number>;
  uInkColor: IUniform<Color>;
  uMinPx: IUniform<number>;
  uMaxPx: IUniform<number>;
  uDistanceRef: IUniform<number>;
  uResolution: IUniform<Vector2>;
}

export function createInkUniforms(dials: RenderDials): InkUniforms {
  return {
    uInkWidthPx: { value: dials.inkWidthPx },
    uInkColor: { value: new Color(dials.inkColor) },
    uMinPx: { value: 0.8 },
    uMaxPx: { value: 4.0 },
    uDistanceRef: { value: 25 },
    uResolution: { value: new Vector2(1920, 1080) },
  };
}

export function applyInkDials(uniforms: InkUniforms, dials: RenderDials): void {
  uniforms.uInkWidthPx.value = dials.inkWidthPx;
  uniforms.uInkColor.value.set(dials.inkColor);
}

const vertexShader = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
#include <skinning_pars_vertex>
attribute vec3 inkNormal;
attribute float inkWidth;
uniform float uInkWidthPx;
uniform float uMinPx;
uniform float uMaxPx;
uniform float uDistanceRef;
uniform vec2 uResolution;
void main() {
  #include <batching_vertex>
  #include <beginnormal_vertex>
  objectNormal = inkNormal;
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vec2 direction = (projectionMatrix * vec4(normalize(transformedNormal), 0.0)).xy;
  float len = length(direction);
  direction = len > 1e-5 ? direction / len : vec2(0.0);
  // Constant screen width near the camera, thinning with distance so far props do not turn to ink blots.
  float distanceScale = clamp(uDistanceRef / max(-mvPosition.z, 0.001), 0.35, 1.0);
  // inkWidth is stored as width / 2 (see blender/lib/ink.py).
  float widthPx = inkWidth > 0.0 ? clamp(uInkWidthPx * inkWidth * 2.0 * distanceScale, uMinPx, uMaxPx) : 0.0;
  gl_Position.xy += direction * widthPx * 2.0 / uResolution * gl_Position.w;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uInkColor;
void main() {
  gl_FragColor = vec4(uInkColor, 1.0);
  #include <colorspace_fragment>
}
`;

export function createHullMaterial(uniforms: InkUniforms): ShaderMaterial {
  return new ShaderMaterial({ name: 'InkHull', uniforms, vertexShader, fragmentShader, side: BackSide });
}

function maxInk(mesh: Mesh): number {
  const attribute = mesh.geometry.getAttribute('inkWidth');
  if (!attribute) return 0;
  let max = 0;
  for (let i = 0; i < attribute.count; i++) max = Math.max(max, attribute.getX(i));
  return max;
}

/**
 * Adds an inverted hull as a child of the mesh, with an identity transform so it follows the mesh (skinned
 * meshes stay in attached bind mode, so the child shares the parent's world matrix). Returns null when the
 * mesh carries no ink. Call this on a collected list, never inside traverse().
 */
export function attachHull(mesh: Mesh, material: Material, layer: number): Mesh | null {
  if (maxInk(mesh) <= 0) return null;
  if (!mesh.geometry.getAttribute('inkNormal')) computeInkNormals(mesh.geometry);
  let hull: Mesh;
  if ((mesh as SkinnedMesh).isSkinnedMesh) {
    const source = mesh as SkinnedMesh;
    const skinned = new SkinnedMesh(source.geometry, material);
    skinned.bind(source.skeleton, source.bindMatrix);
    hull = skinned;
  } else if ((mesh as InstancedMesh).isInstancedMesh) {
    const source = mesh as InstancedMesh;
    const instanced = new InstancedMesh(source.geometry, material, source.count);
    instanced.instanceMatrix = source.instanceMatrix;
    hull = instanced;
  } else {
    hull = new Mesh(mesh.geometry, material);
  }
  hull.name = `${mesh.name}_hull`;
  hull.layers.set(layer);
  hull.castShadow = false;
  hull.receiveShadow = false;
  hull.frustumCulled = mesh.frustumCulled;
  hull.raycast = () => {};
  mesh.add(hull);
  return hull;
}
```

- [ ] **Step 5: Write `src/render/quality.ts`**

```ts
export type TierName = 'high' | 'medium' | 'low';

export interface Tier {
  name: TierName;
  pixelRatioMax: number;
  msaa: number;
  shadowMapSize: number;
  normalScale: number;
  edgeInk: boolean;
  bloomLevels: number;
  terrainSegments: number;
  scatterScale: number;
}

/** Targets from the blueprint: 60 fps at 1440p on the RTX 4080 laptop, 60 at 1080p on Iris Xe, 30+ on a phone. */
export const TIERS: Record<TierName, Tier> = {
  high: { name: 'high', pixelRatioMax: 2, msaa: 4, shadowMapSize: 2048, normalScale: 1, edgeInk: true, bloomLevels: 8, terrainSegments: 256, scatterScale: 1 },
  medium: { name: 'medium', pixelRatioMax: 1.25, msaa: 2, shadowMapSize: 1024, normalScale: 0.75, edgeInk: true, bloomLevels: 6, terrainSegments: 192, scatterScale: 0.7 },
  low: { name: 'low', pixelRatioMax: 1, msaa: 0, shadowMapSize: 512, normalScale: 0.5, edgeInk: false, bloomLevels: 4, terrainSegments: 128, scatterScale: 0.4 },
};

export function tierForGpu(gpu: string, mobile: boolean): TierName {
  const g = gpu.toLowerCase();
  if (/swiftshader|llvmpipe|software/.test(g)) return 'low';
  if (mobile) return 'low';
  if (/nvidia|geforce|rtx|gtx|radeon rx|radeon pro|arc\(tm\) a|arc a/.test(g)) return 'high';
  return 'medium';
}

export function detectTier(gl: WebGLRenderingContext | WebGL2RenderingContext, userAgent: string): TierName {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return tierForGpu(gpu, /Android|iPhone|iPad|Mobile/i.test(userAgent));
}

export function parseTier(value: string | null): TierName | null {
  return value === 'high' || value === 'medium' || value === 'low' ? value : null;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/unit/render/ink-quality.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add src/render/ink src/render/quality.ts tests/unit/render/ink-quality.test.ts
git commit -F - <<'EOF'
Add hull ink with averaged normals, and quality tiers

The hull is an inverted child mesh pushed out along position-averaged
normals, so it stays closed at hard creases; its width is constant in screen
pixels near the camera and thins with distance. Skinned hulls bind to the
parent's skeleton and instanced hulls share its instance matrices. Tiers
follow the blueprint targets; software renderers and phones get the low
tier, which drops the screen-space edge pass.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: The painted material

**Files:**
- Create: `src/render/materials/painted.ts`
- Test: `tests/unit/render/painted.test.ts`

- [ ] **Step 1: Write the failing test `tests/unit/render/painted.test.ts`**

```ts
import { Color, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIALS } from '../../../src/render/defaults';
import { applyPaintDials, createPaintedMaterial, createPaintUniforms } from '../../../src/render/materials/painted';
import { VERDANT } from '../../../src/render/themes';

describe('painted materials', () => {
  const shared = createPaintUniforms(VERDANT, DEFAULT_DIALS, new Texture());

  it('share one set of dial uniforms', () => {
    const a = createPaintedMaterial(shared, { map: new Texture() });
    const b = createPaintedMaterial(shared, { baseColor: new Color('#ff0000') });
    expect(a.uniforms['uBands']).toBe(b.uniforms['uBands']);
    applyPaintDials(shared, { ...DEFAULT_DIALS, bands: 4 }, VERDANT);
    expect(a.uniforms['uBands']!.value).toBe(4);
    expect(b.uniforms['uBands']!.value).toBe(4);
  });

  it('enable lights and choose features by define', () => {
    const terrain = createPaintedMaterial(shared, { terrain: true, vertexColors: true });
    const mapped = createPaintedMaterial(shared, { map: new Texture(), emissiveMap: new Texture() });
    expect(terrain.lights).toBe(true);
    expect(terrain.vertexColors).toBe(true);
    expect(terrain.defines['PAINT_TERRAIN']).toBe('');
    expect(mapped.defines['USE_PAINT_MAP']).toBe('');
    expect(mapped.defines['USE_PAINT_EMISSIVE']).toBe('');
    expect(mapped.uniforms['directionalLights']).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/render/painted.test.ts`
Expected: FAIL, the module cannot be resolved.

- [ ] **Step 3: Write `src/render/materials/painted.ts`**

```ts
import {
  Color,
  DoubleSide,
  FrontSide,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type IUniform,
  type Texture,
} from 'three';
import type { RenderDials } from '../defaults';
import type { Theme } from '../themes';

/** Dial uniforms shared by every painted material, so one dial move repaints the whole scene. */
export interface PaintUniforms {
  [name: string]: IUniform;
  uBrush: IUniform<Texture | null>;
  uBrushScale: IUniform<number>;
  uTerminatorNoise: IUniform<number>;
  uBands: IUniform<number>;
  uBandSoftness: IUniform<number>;
  uShadowTint: IUniform<Color>;
  uShadowDepth: IUniform<number>;
  uAmbientSky: IUniform<Color>;
  uAmbientGround: IUniform<Color>;
  uAmbientStrength: IUniform<number>;
  uUp: IUniform<Vector3>;
  uRimColor: IUniform<Color>;
  uRimStrength: IUniform<number>;
  uRimPower: IUniform<number>;
  uPaintStrength: IUniform<number>;
  uSaturation: IUniform<number>;
  uTerrainBrush: IUniform<number>;
}

export function createPaintUniforms(theme: Theme, dials: RenderDials, brush: Texture | null): PaintUniforms {
  const uniforms: PaintUniforms = {
    uBrush: { value: brush },
    uBrushScale: { value: dials.brushScale },
    uTerminatorNoise: { value: dials.terminatorNoise },
    uBands: { value: dials.bands },
    uBandSoftness: { value: dials.bandSoftness },
    uShadowTint: { value: new Color(dials.shadowTint) },
    uShadowDepth: { value: dials.shadowDepth },
    uAmbientSky: { value: new Color(theme.ambient.sky) },
    uAmbientGround: { value: new Color(theme.ambient.ground) },
    uAmbientStrength: { value: dials.ambientStrength },
    uUp: { value: new Vector3(0, 1, 0) },
    uRimColor: { value: new Color(theme.sun.color) },
    uRimStrength: { value: dials.rimStrength },
    uRimPower: { value: dials.rimPower },
    uPaintStrength: { value: dials.paintStrength },
    uSaturation: { value: dials.saturation },
    uTerrainBrush: { value: dials.terrainBrush },
  };
  return uniforms;
}

export function applyPaintDials(u: PaintUniforms, dials: RenderDials, theme: Theme): void {
  u.uBrushScale.value = dials.brushScale;
  u.uTerminatorNoise.value = dials.terminatorNoise;
  u.uBands.value = dials.bands;
  u.uBandSoftness.value = dials.bandSoftness;
  u.uShadowTint.value.set(dials.shadowTint);
  u.uShadowDepth.value = dials.shadowDepth;
  u.uAmbientSky.value.set(theme.ambient.sky);
  u.uAmbientGround.value.set(theme.ambient.ground);
  u.uAmbientStrength.value = dials.ambientStrength;
  u.uRimColor.value.set(theme.sun.color);
  u.uRimStrength.value = dials.rimStrength;
  u.uRimPower.value = dials.rimPower;
  u.uPaintStrength.value = dials.paintStrength;
  u.uSaturation.value = dials.saturation;
  u.uTerrainBrush.value = dials.terrainBrush;
}

export interface PaintedOptions {
  map?: Texture | null;
  emissiveMap?: Texture | null;
  emissiveColor?: Color;
  emissiveIntensity?: number;
  baseColor?: Color;
  /** Terrain paints its brush in world space and scales it with the terrain brush dial. */
  terrain?: boolean;
  vertexColors?: boolean;
  /** 0 is pure cel banding; characters blend toward standard lighting, as Sifu does. */
  standardBlend?: number;
  doubleSided?: boolean;
  alphaTest?: number;
}

const vertexShader = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>

varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vViewNormal;
varying vec3 vViewPosition;
varying vec3 vColor;
varying vec3 vBrushPos;
varying vec3 vBrushNormal;

void main() {
  vUv = uv;
  #ifdef USE_COLOR
    vColor = color.rgb;
  #else
    vColor = vec3(1.0);
  #endif
  #include <batching_vertex>
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vViewPosition = -mvPosition.xyz;
  vViewNormal = normalize(transformedNormal);
  vWorldNormal = normalize(transformNormalByInverseViewMatrix(transformedNormal, viewMatrix));
  #ifdef PAINT_TERRAIN
    vBrushPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
    vBrushNormal = vWorldNormal;
  #else
    // Object space before skinning: strokes stay on the body as it moves instead of swimming.
    vBrushPos = position;
    vBrushNormal = normal;
  #endif
  #include <worldpos_vertex>
  #include <shadowmap_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>

uniform vec3 uBaseColor;
#ifdef USE_PAINT_MAP
  uniform sampler2D uMap;
#endif
#ifdef USE_PAINT_EMISSIVE
  uniform sampler2D uEmissiveMap;
#endif
uniform vec3 uEmissiveColor;
uniform float uEmissiveIntensity;
uniform float uStandardBlend;
uniform float uAlphaTest;

uniform sampler2D uBrush;
uniform float uBrushScale;
uniform float uTerminatorNoise;
uniform float uBands;
uniform float uBandSoftness;
uniform vec3 uShadowTint;
uniform float uShadowDepth;
uniform vec3 uAmbientSky;
uniform vec3 uAmbientGround;
uniform float uAmbientStrength;
uniform vec3 uUp;
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform float uRimPower;
uniform float uPaintStrength;
uniform float uSaturation;
uniform float uTerrainBrush;

varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vViewNormal;
varying vec3 vViewPosition;
varying vec3 vColor;
varying vec3 vBrushPos;
varying vec3 vBrushNormal;

float brushSample(vec3 p, vec3 n) {
  vec3 w = pow(abs(normalize(n)), vec3(4.0));
  w /= (w.x + w.y + w.z + 1e-5);
  vec3 q = p * uBrushScale;
  return texture2D(uBrush, q.yz).r * w.x + texture2D(uBrush, q.xz).r * w.y + texture2D(uBrush, q.xy).r * w.z;
}

vec3 withSaturation(vec3 c, float amount) {
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return max(mix(vec3(luma), c, amount), 0.0);
}

void main() {
  float brush = brushSample(vBrushPos, vBrushNormal);
  vec3 albedo = uBaseColor * vColor;
  float alpha = 1.0;
  #ifdef USE_PAINT_MAP
    vec4 texel = texture2D(uMap, vUv);
    // The paint strength dial fades the baked strokes toward the region's broad colour (a high mip).
    vec3 broad = textureLod(uMap, vUv, 6.0).rgb;
    albedo = mix(broad, texel.rgb, uPaintStrength) * vColor;
    alpha = texel.a;
  #endif
  #ifdef PAINT_TERRAIN
    albedo *= 1.0 + (brush - 0.5) * uTerrainBrush;
  #endif
  if (alpha < uAlphaTest) discard;
  albedo = withSaturation(albedo, uSaturation);

  vec3 N = normalize(vViewNormal);
  vec3 worldN = normalize(vWorldNormal);
  #ifdef DOUBLE_SIDED
    if (!gl_FrontFacing) {
      N = -N;
      worldN = -worldN;
    }
  #endif
  vec3 V = normalize(vViewPosition);
  vec3 L = vec3(0.0, 1.0, 0.0);
  vec3 sunColor = vec3(1.0);
  #if NUM_DIR_LIGHTS > 0
    L = directionalLights[0].direction;
    sunColor = directionalLights[0].color;
  #endif
  float ndl = dot(N, L);
  float shadow = getShadowMask();

  // The terminator breaks up like a brush stroke, and a cast shadow drops the surface into the shadow band.
  float t = ndl + (brush - 0.5) * 2.0 * uTerminatorNoise;
  t = min(t, shadow * 2.0 - 1.0);
  float x = clamp(t * 0.5 + 0.5, 0.0, 1.0) * uBands;
  float stepped = (floor(x) + smoothstep(0.5 - uBandSoftness, 0.5 + uBandSoftness, fract(x))) / uBands;
  float lambert = max(ndl, 0.0) * shadow;
  float lit = clamp(mix(stepped, lambert, uStandardBlend), 0.0, 1.0);

  // Shadows take the theme's colour instead of going grey.
  vec3 direct = mix(uShadowTint * uShadowDepth, sunColor, lit);
  vec3 ambient = mix(uAmbientGround, uAmbientSky, dot(worldN, uUp) * 0.5 + 0.5) * uAmbientStrength;
  vec3 color = albedo * (direct + ambient);

  float facing = 1.0 - clamp(dot(N, V), 0.0, 1.0);
  color += pow(facing, uRimPower) * uRimStrength * smoothstep(-0.1, 0.4, ndl) * shadow * uRimColor * sunColor;

  #ifdef USE_PAINT_EMISSIVE
    color += texture2D(uEmissiveMap, vUv).rgb * uEmissiveColor * uEmissiveIntensity;
  #else
    color += uEmissiveColor * uEmissiveIntensity;
  #endif
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createPaintedMaterial(shared: PaintUniforms, options: PaintedOptions): ShaderMaterial {
  const defines: Record<string, string> = {};
  if (options.map) defines['USE_PAINT_MAP'] = '';
  if (options.emissiveMap) defines['USE_PAINT_EMISSIVE'] = '';
  if (options.terrain) defines['PAINT_TERRAIN'] = '';
  const material = new ShaderMaterial({
    name: 'PaintedMaterial',
    lights: true,
    vertexColors: options.vertexColors === true,
    side: options.doubleSided ? DoubleSide : FrontSide,
    defines,
    uniforms: {
      // Lights are cloned per material (three writes them per frame); the dials are spread, not cloned,
      // so every material holds the very same { value } objects.
      ...UniformsUtils.clone(UniformsLib.lights),
      ...shared,
      uBaseColor: { value: options.baseColor ?? new Color(1, 1, 1) },
      uMap: { value: options.map ?? null },
      uEmissiveMap: { value: options.emissiveMap ?? null },
      uEmissiveColor: { value: options.emissiveColor ?? new Color(0, 0, 0) },
      uEmissiveIntensity: { value: options.emissiveIntensity ?? 1 },
      uStandardBlend: { value: options.standardBlend ?? 0.1 },
      uAlphaTest: { value: options.alphaTest ?? 0 },
    },
    vertexShader,
    fragmentShader,
  });
  material.userData['painted'] = true;
  return material;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/render/painted.test.ts`
Expected: PASS, 2 tests. Shader compilation is proven in the browser in Task 9.

- [ ] **Step 5: Commit**

```bash
git add src/render/materials/painted.ts tests/unit/render/painted.test.ts
git commit -F - <<'EOF'
Add the painted lighting material

Light is banded with a brush-broken terminator; cast shadows push surfaces
into the shadow band, which takes the theme's colour rather than grey; a
per-material blend toward standard lighting gives characters Sifu's softer
mix. Brush sampling is object space before skinning, so strokes ride the body
instead of swimming. All materials share the same dial uniform objects.
PCFSoftShadowMap was removed in r186, so softness will come from the
shadow radius.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Post effects and the pipeline

**Files:**
- Create: `src/render/post/inkEdgeEffect.ts`, `src/render/post/fogEffect.ts`, `src/render/post/gradeEffect.ts`, `src/render/post/finishEffect.ts`, `src/render/post/pipeline.ts`

These run only in a browser; Task 9 proves them in the Style Lab with frames and zero console errors.

- [ ] **Step 1: Write `src/render/post/inkEdgeEffect.ts`**

```ts
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { Color, Matrix4, Uniform, Vector2, type PerspectiveCamera, type Texture } from 'three';
import type { RenderDials } from '../defaults';

const fragmentShader = /* glsl */ `
uniform sampler2D uNormalBuffer;
uniform sampler2D uInkNoise;
uniform vec3 uInkColor;
uniform float uInkStrength;
uniform float uLineWidth;
uniform float uDepthThreshold;
uniform float uNormalThreshold;
uniform float uFadeNear;
uniform float uFadeFar;
uniform vec2 uTexel;
uniform mat4 uProjectionInverse;
uniform mat4 uViewInverse;

float inkDistance(const in vec2 coord) {
  return -getViewZ(readDepth(coord));
}

vec3 inkNormal(const in vec2 coord) {
  return normalize(texture2D(uNormalBuffer, coord).xyz * 2.0 - 1.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (depth >= 0.99999) {
    outputColor = inputColor;
    return;
  }
  float d = -getViewZ(depth);
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uProjectionInverse * clip;
  view /= view.w;
  vec3 world = (uViewInverse * view).xyz;
  // Width varies along a line with world-anchored noise, so it wobbles like ink and never swims.
  float wobble = texture2D(uInkNoise, world.xz * 0.08).r;
  vec2 offset = uTexel * uLineWidth * mix(0.6, 1.4, wobble);
  vec2 ox = vec2(offset.x, 0.0);
  vec2 oy = vec2(0.0, offset.y);
  float farthest = max(max(inkDistance(uv + ox), inkDistance(uv - ox)), max(inkDistance(uv + oy), inkDistance(uv - oy)));
  float depthEdge = smoothstep(uDepthThreshold, uDepthThreshold * 2.0, (farthest - d) / d);
  vec3 n = inkNormal(uv);
  float bend = max(
    max(1.0 - dot(n, inkNormal(uv + ox)), 1.0 - dot(n, inkNormal(uv - ox))),
    max(1.0 - dot(n, inkNormal(uv + oy)), 1.0 - dot(n, inkNormal(uv - oy)))
  );
  float normalEdge = smoothstep(uNormalThreshold, uNormalThreshold * 1.6, bend);
  // Creases fade out with distance before they become moire; silhouettes keep some weight.
  float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, d);
  float edge = clamp(max(depthEdge * mix(0.45, 1.0, fade), normalEdge * fade), 0.0, 1.0);
  outputColor = vec4(mix(inputColor.rgb, uInkColor, edge * uInkStrength), inputColor.a);
}
`;

export class InkEdgeEffect extends Effect {
  private readonly camera: PerspectiveCamera;

  constructor(camera: PerspectiveCamera, normalBuffer: Texture, inkNoise: Texture, dials: RenderDials) {
    super('InkEdgeEffect', fragmentShader, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uNormalBuffer', new Uniform(normalBuffer)],
        ['uInkNoise', new Uniform(inkNoise)],
        ['uInkColor', new Uniform(new Color(dials.inkColor))],
        ['uInkStrength', new Uniform(dials.edgeStrength)],
        ['uLineWidth', new Uniform(dials.edgeLineWidth)],
        ['uDepthThreshold', new Uniform(dials.depthThreshold)],
        ['uNormalThreshold', new Uniform(dials.normalThreshold)],
        ['uFadeNear', new Uniform(dials.edgeFadeNear)],
        ['uFadeFar', new Uniform(dials.edgeFadeFar)],
        ['uTexel', new Uniform(new Vector2(1 / 1920, 1 / 1080))],
        ['uProjectionInverse', new Uniform(new Matrix4())],
        ['uViewInverse', new Uniform(new Matrix4())],
      ]),
    });
    this.camera = camera;
  }

  private u<T>(name: string): Uniform<T> {
    return this.uniforms.get(name) as Uniform<T>;
  }

  setDials(dials: RenderDials): void {
    this.u<Color>('uInkColor').value.set(dials.inkColor);
    this.u<number>('uInkStrength').value = dials.edgeStrength;
    this.u<number>('uLineWidth').value = dials.edgeLineWidth;
    this.u<number>('uDepthThreshold').value = dials.depthThreshold;
    this.u<number>('uNormalThreshold').value = dials.normalThreshold;
    this.u<number>('uFadeNear').value = dials.edgeFadeNear;
    this.u<number>('uFadeFar').value = dials.edgeFadeFar;
  }

  override update(): void {
    this.u<Matrix4>('uProjectionInverse').value.copy(this.camera.projectionMatrixInverse);
    this.u<Matrix4>('uViewInverse').value.copy(this.camera.matrixWorld);
  }

  override setSize(width: number, height: number): void {
    this.u<Vector2>('uTexel').value.set(1 / width, 1 / height);
  }
}
```

- [ ] **Step 2: Write `src/render/post/fogEffect.ts`**

```ts
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { Color, Matrix4, Uniform, Vector3, type PerspectiveCamera } from 'three';
import type { RenderDials } from '../defaults';
import type { Theme } from '../themes';

const fragmentShader = /* glsl */ `
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform vec3 uSunDirection;
uniform float uDensity;
uniform float uStart;
uniform mat4 uProjectionInverse;
uniform mat4 uViewInverse;

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (depth >= 0.99999) {
    outputColor = inputColor;
    return;
  }
  float d = -getViewZ(depth);
  float amount = 1.0 - exp(-pow(max(d - uStart, 0.0) * uDensity, 1.5));
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uProjectionInverse * clip;
  view /= view.w;
  vec3 direction = normalize((uViewInverse * vec4(view.xyz, 0.0)).xyz);
  // Looking toward the sun, the haze warms: aerial perspective in the theme's two fog colours.
  float sun = pow(max(dot(direction, uSunDirection), 0.0), 6.0);
  outputColor = vec4(mix(inputColor.rgb, mix(uFogColor, uFogSunColor, sun), amount), inputColor.a);
}
`;

export class FogEffect extends Effect {
  private readonly camera: PerspectiveCamera;

  constructor(camera: PerspectiveCamera, theme: Theme, sunDirection: Vector3, dials: RenderDials) {
    super('FogEffect', fragmentShader, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uFogColor', new Uniform(new Color(theme.fog.color))],
        ['uFogSunColor', new Uniform(new Color(theme.fog.sunColor))],
        ['uSunDirection', new Uniform(sunDirection.clone().normalize())],
        ['uDensity', new Uniform(dials.fogDensity)],
        ['uStart', new Uniform(dials.fogStart)],
        ['uProjectionInverse', new Uniform(new Matrix4())],
        ['uViewInverse', new Uniform(new Matrix4())],
      ]),
    });
    this.camera = camera;
  }

  setDials(dials: RenderDials, theme: Theme): void {
    (this.uniforms.get('uDensity') as Uniform<number>).value = dials.fogDensity;
    (this.uniforms.get('uStart') as Uniform<number>).value = dials.fogStart;
    (this.uniforms.get('uFogColor') as Uniform<Color>).value.set(theme.fog.color);
    (this.uniforms.get('uFogSunColor') as Uniform<Color>).value.set(theme.fog.sunColor);
  }

  override update(): void {
    (this.uniforms.get('uProjectionInverse') as Uniform<Matrix4>).value.copy(this.camera.projectionMatrixInverse);
    (this.uniforms.get('uViewInverse') as Uniform<Matrix4>).value.copy(this.camera.matrixWorld);
  }
}
```

- [ ] **Step 3: Write `src/render/post/gradeEffect.ts`**

```ts
import { BlendFunction, Effect } from 'postprocessing';
import { Color, Uniform } from 'three';
import type { RenderDials } from '../defaults';
import type { Theme } from '../themes';

// Runs on HDR colour before tone mapping: exposure, contrast around mid grey, then split toning.
const fragmentShader = /* glsl */ `
uniform float uExposure;
uniform float uContrast;
uniform vec3 uShadowGrade;
uniform vec3 uHighlightGrade;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb * uExposure, 0.0);
  c = pow(c / 0.18, vec3(uContrast)) * 0.18;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= mix(uShadowGrade, uHighlightGrade, smoothstep(0.03, 1.0, luma));
  outputColor = vec4(c, inputColor.a);
}
`;

export class GradeEffect extends Effect {
  constructor(theme: Theme, dials: RenderDials) {
    super('GradeEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uExposure', new Uniform(dials.exposure)],
        ['uContrast', new Uniform(dials.contrast)],
        ['uShadowGrade', new Uniform(new Color(theme.grade.shadows))],
        ['uHighlightGrade', new Uniform(new Color(theme.grade.highlights))],
      ]),
    });
  }

  setDials(dials: RenderDials, theme: Theme): void {
    (this.uniforms.get('uExposure') as Uniform<number>).value = dials.exposure;
    (this.uniforms.get('uContrast') as Uniform<number>).value = dials.contrast;
    (this.uniforms.get('uShadowGrade') as Uniform<Color>).value.set(theme.grade.shadows);
    (this.uniforms.get('uHighlightGrade') as Uniform<Color>).value.set(theme.grade.highlights);
  }
}
```

- [ ] **Step 4: Write `src/render/post/finishEffect.ts`**

```ts
import { BlendFunction, Effect } from 'postprocessing';
import { Uniform, Vector2 } from 'three';
import type { RenderDials } from '../defaults';

// After tone mapping: a soft vignette and a fine grain. Reduced motion freezes the grain.
const fragmentShader = /* glsl */ `
uniform float uVignette;
uniform float uGrain;
uniform float uSeed;
uniform vec2 uResolution;

float finishHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 q = uv - 0.5;
  vec3 c = inputColor.rgb * (1.0 - uVignette * dot(q, q) * 1.6);
  c += (finishHash(floor(uv * uResolution)) - 0.5) * uGrain;
  outputColor = vec4(max(c, 0.0), inputColor.a);
}
`;

export class FinishEffect extends Effect {
  private time = 0;
  private readonly animate: boolean;

  constructor(dials: RenderDials, reducedMotion: boolean) {
    super('FinishEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uVignette', new Uniform(dials.vignette)],
        ['uGrain', new Uniform(dials.grain)],
        ['uSeed', new Uniform(0)],
        ['uResolution', new Uniform(new Vector2(1920, 1080))],
      ]),
    });
    this.animate = !reducedMotion;
  }

  setDials(dials: RenderDials): void {
    (this.uniforms.get('uVignette') as Uniform<number>).value = dials.vignette;
    (this.uniforms.get('uGrain') as Uniform<number>).value = dials.grain;
  }

  tick(delta: number): void {
    if (!this.animate) return;
    this.time += delta;
    (this.uniforms.get('uSeed') as Uniform<number>).value = Math.floor(this.time * 24) % 1000;
  }

  override setSize(width: number, height: number): void {
    (this.uniforms.get('uResolution') as Uniform<Vector2>).value.set(width, height);
  }
}
```

- [ ] **Step 5: Write `src/render/post/pipeline.ts`**

```ts
import { BloomEffect, EffectComposer, EffectPass, NormalPass, RenderPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { HalfFloatType, type PerspectiveCamera, type Scene, type Texture, type Vector3, type WebGLRenderer } from 'three';
import type { RenderDials } from '../defaults';
import { LAYERS } from '../layers';
import type { Tier } from '../quality';
import type { Theme } from '../themes';
import { FinishEffect } from './finishEffect';
import { FogEffect } from './fogEffect';
import { GradeEffect } from './gradeEffect';
import { InkEdgeEffect } from './inkEdgeEffect';

export interface PipelineOptions {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  tier: Tier;
  dials: RenderDials;
  theme: Theme;
  inkNoise: Texture;
  sunDirection: Vector3;
  reducedMotion: boolean;
}

export interface Pipeline {
  composer: EffectComposer;
  ink: InkEdgeEffect | null;
  render(deltaSeconds: number): void;
  setSize(width: number, height: number): void;
  applyDials(dials: RenderDials, theme: Theme): void;
  dispose(): void;
}

/**
 * Scene, then (high and medium tiers) normals for the edge ink, then ink and fog, then bloom, grade, AgX
 * tone mapping and the finish. The normal pass has its own camera limited to the world layer, so hulls
 * and the sky never produce edges of their own.
 */
export function createPipeline(o: PipelineOptions): Pipeline {
  const composer = new EffectComposer(o.renderer, { frameBufferType: HalfFloatType, multisampling: o.tier.msaa });
  composer.addPass(new RenderPass(o.scene, o.camera));
  let normalCamera: PerspectiveCamera | null = null;
  let ink: InkEdgeEffect | null = null;
  if (o.tier.edgeInk) {
    normalCamera = o.camera.clone();
    const normalPass = new NormalPass(o.scene, normalCamera, { resolutionScale: o.tier.normalScale });
    composer.addPass(normalPass);
    ink = new InkEdgeEffect(o.camera, normalPass.texture, o.inkNoise, o.dials);
  }
  const fog = new FogEffect(o.camera, o.theme, o.sunDirection, o.dials);
  composer.addPass(new EffectPass(o.camera, ...(ink ? [ink, fog] : [fog])));
  const bloom = new BloomEffect({
    luminanceThreshold: o.dials.bloomThreshold,
    luminanceSmoothing: 0.25,
    intensity: o.dials.bloomIntensity,
    mipmapBlur: true,
    levels: o.tier.bloomLevels,
  });
  const grade = new GradeEffect(o.theme, o.dials);
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
  const finish = new FinishEffect(o.dials, o.reducedMotion);
  composer.addPass(new EffectPass(o.camera, bloom, grade, tone, finish));

  return {
    composer,
    ink,
    render(deltaSeconds) {
      if (normalCamera) {
        normalCamera.copy(o.camera, false);
        normalCamera.layers.set(LAYERS.world);
      }
      finish.tick(deltaSeconds);
      composer.render(deltaSeconds);
    },
    setSize(width, height) {
      composer.setSize(width, height);
    },
    applyDials(dials, theme) {
      ink?.setDials(dials);
      fog.setDials(dials, theme);
      bloom.intensity = dials.bloomIntensity;
      bloom.luminanceMaterial.threshold = dials.bloomThreshold;
      grade.setDials(dials, theme);
      finish.setDials(dials);
    },
    dispose() {
      composer.dispose();
    },
  };
}
```

- [ ] **Step 6: Type-check**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/render/post
git commit -F - <<'EOF'
Add the post pipeline: edge ink, fog, bloom, grade, AgX and finish

The edge effect compares linear depth (relative threshold) and normals with
a four-tap cross whose width wobbles with world-anchored ink noise; creases
fade with distance while silhouettes keep weight. Fog warms toward the sun.
Grade runs on HDR before AgX; vignette and grain run after, and reduced
motion freezes the grain. The normal pass renders through a camera limited
to the world layer, so hulls and the sky never make edges. Custom uniforms
all start with u because the pass owns names like normalBuffer.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Sky, renderer and the curved style patch

**Files:**
- Create: `src/render/sky.ts`, `src/render/renderer.ts`, `src/render/terrain/noise.ts`, `src/render/terrain/stylePatch.ts`
- Test: `tests/unit/render/terrain.test.ts`

- [ ] **Step 1: Write the failing test `tests/unit/render/terrain.test.ts`**

```ts
import { Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIALS } from '../../../src/render/defaults';
import { createPaintUniforms } from '../../../src/render/materials/painted';
import { fbm3, valueNoise3 } from '../../../src/render/terrain/noise';
import { createStylePatch, STYLE_PLANET_RADIUS } from '../../../src/render/terrain/stylePatch';
import { VERDANT } from '../../../src/render/themes';

describe('noise', () => {
  it('is deterministic and stays in [0, 1)', () => {
    for (let i = 0; i < 500; i++) {
      const v = valueNoise3(i * 0.37, i * 0.11, -i * 0.23, 5);
      expect(v).toBe(valueNoise3(i * 0.37, i * 0.11, -i * 0.23, 5));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const f = fbm3(i * 0.1, 0.5, i * 0.2, 3, 4);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });
});

describe('createStylePatch', () => {
  const patch = createStylePatch(VERDANT, createPaintUniforms(VERDANT, DEFAULT_DIALS, new Texture()), 32);

  it('keeps the heart clearing level at the origin', () => {
    const origin = patch.surfaceAt(0, 0);
    expect(origin.position.length()).toBeLessThan(1e-6);
    expect(origin.up.y).toBeCloseTo(1, 9);
    expect(Math.abs(patch.surfaceAt(3, 2).position.y - patch.surfaceAt(-3, -2).position.y)).toBeLessThan(0.2);
  });

  it('curves away with the planet', () => {
    const far = patch.surfaceAt(60, 0);
    // The point above (60, 0) sits about 0.36 rad around the sphere, about 10 m below the tangent plane;
    // terrain relief adds less than 3.5 m.
    const drop = STYLE_PLANET_RADIUS * (1 - Math.cos(Math.atan(60 / STYLE_PLANET_RADIUS)));
    expect(far.position.y).toBeLessThan(-drop + 3.5);
    expect(far.up.x).toBeGreaterThan(0.3);
  });

  it('builds a vertex-coloured mesh', () => {
    expect(patch.mesh.geometry.getAttribute('color')).toBeDefined();
    expect(patch.mesh.geometry.getAttribute('position').count).toBe(33 * 33);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/render/terrain.test.ts`
Expected: FAIL, modules cannot be resolved.

- [ ] **Step 3: Write `src/render/terrain/noise.ts`**

```ts
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Smooth value noise in [0, 1) on an integer lattice. */
export function valueNoise3(x: number, y: number, z: number, seed = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const fz = smooth(z - z0);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(x0 + dx, y0 + dy, z0 + dz, seed);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), fx), lerp(c(0, 1, 0), c(1, 1, 0), fx), fy),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), fx), lerp(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz,
  );
}

/** Fractal sum of value noise, normalised back into [0, 1). */
export function fbm3(x: number, y: number, z: number, seed = 0, octaves = 4): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise3(x * frequency, y * frequency, z * frequency, seed + i * 31) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return Math.min(sum / total, 0.999999);
}
```

- [ ] **Step 4: Write `src/render/terrain/stylePatch.ts`**

```ts
import { BufferAttribute, BufferGeometry, Color, IcosahedronGeometry, Mesh, Vector3 } from 'three';
import { createPaintedMaterial, type PaintUniforms } from '../materials/painted';
import type { Theme } from '../themes';
import { fbm3 } from './noise';

/** The style scene sits at the north pole of a planet of the blueprint's standard radius. */
export const STYLE_PLANET_RADIUS = 160;
const HALF_EXTENT = 80; // metres of ground from the centre to the patch edge
const CENTER = new Vector3(0, -STYLE_PLANET_RADIUS, 0);

export interface SurfacePoint {
  position: Vector3;
  up: Vector3;
  normal: Vector3;
}

export interface StylePatch {
  mesh: Mesh;
  lowPlanet: Mesh;
  surfaceAt(x: number, z: number): SurfacePoint;
}

function smoothstep(a: number, b: number, t: number): number {
  const x = Math.min(Math.max((t - a) / (b - a), 0), 1);
  return x * x * (3 - 2 * x);
}

/** Height above the sphere for a unit direction; the heart's clearing (6 to 14 m) stays level. */
function height(dir: Vector3): number {
  const p = dir.clone().multiplyScalar(STYLE_PLANET_RADIUS);
  const broad = (fbm3(p.x * 0.02, p.y * 0.02, p.z * 0.02, 3, 4) - 0.5) * 5.0;
  const detail = (fbm3(p.x * 0.09, p.y * 0.09, p.z * 0.09, 7, 3) - 0.5) * 1.1;
  return (broad + detail) * smoothstep(6, 14, Math.hypot(p.x, p.z));
}

function point(x: number, z: number): Vector3 {
  const dir = new Vector3(x, STYLE_PLANET_RADIUS, z).normalize();
  return CENTER.clone().addScaledVector(dir, STYLE_PLANET_RADIUS + height(dir));
}

export function createStylePatch(theme: Theme, paint: PaintUniforms, segments: number): StylePatch {
  const count = segments + 1;
  const positions = new Float32Array(count * count * 3);
  const colors = new Float32Array(count * count * 3);
  const indices: number[] = [];
  for (let j = 0; j < count; j++) {
    for (let i = 0; i < count; i++) {
      const x = -HALF_EXTENT + (2 * HALF_EXTENT * i) / segments;
      const z = -HALF_EXTENT + (2 * HALF_EXTENT * j) / segments;
      point(x, z).toArray(positions, (j * count + i) * 3);
      if (i < segments && j < segments) {
        const a = j * count + i;
        indices.push(a, a + count, a + 1, a + 1, a + count, a + count + 1);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const meadow = new Color(theme.ground.meadow);
  const meadowLight = new Color(theme.ground.meadowLight);
  const moss = new Color(theme.ground.moss);
  const stone = new Color(theme.ground.stone);
  const soil = new Color(theme.ground.soil);
  const normals = geometry.getAttribute('normal');
  const c = new Color();
  const p = new Vector3();
  const n = new Vector3();
  for (let v = 0; v < count * count; v++) {
    p.fromArray(positions, v * 3);
    n.fromBufferAttribute(normals, v);
    const up = p.clone().sub(CENTER).normalize();
    const slope = 1 - n.dot(up);
    const lift = p.clone().sub(CENTER).length() - STYLE_PLANET_RADIUS;
    const patchNoise = fbm3(p.x * 0.05, 0, p.z * 0.05, 11, 3);
    c.copy(meadow).lerp(meadowLight, smoothstep(0.45, 0.7, patchNoise));
    c.lerp(moss, smoothstep(0.2, -1.2, lift) * 0.8);
    const ring = Math.hypot(p.x, p.z);
    c.lerp(soil, (smoothstep(2.6, 3.4, ring) - smoothstep(4.6, 5.6, ring)) * smoothstep(0.3, 0.6, patchNoise + 0.2));
    c.lerp(stone, smoothstep(0.12, 0.3, slope));
    c.toArray(colors, v * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));

  const mesh = new Mesh(geometry, createPaintedMaterial(paint, { terrain: true, vertexColors: true, standardBlend: 0 }));
  mesh.name = 'style_patch';
  mesh.receiveShadow = true;

  // Fills the horizon seen from high cameras beyond the patch edge.
  const lowPlanet = new Mesh(
    new IcosahedronGeometry(STYLE_PLANET_RADIUS - 0.6, 20),
    createPaintedMaterial(paint, { terrain: true, baseColor: meadow.clone().multiplyScalar(0.92), standardBlend: 0 }),
  );
  lowPlanet.name = 'style_low_planet';
  lowPlanet.position.copy(CENTER);
  lowPlanet.receiveShadow = true;

  return {
    mesh,
    lowPlanet,
    surfaceAt(x, z) {
      const position = point(x, z);
      const up = position.clone().sub(CENTER).normalize();
      const e = 0.25;
      const dx = point(x + e, z).sub(point(x - e, z));
      const dz = point(x, z + e).sub(point(x, z - e));
      const normal = dz.cross(dx).normalize();
      if (normal.dot(up) < 0) normal.negate();
      return { position, up, normal };
    },
  };
}
```

- [ ] **Step 5: Write `src/render/sky.ts`**

```ts
import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3, type Camera, type Texture } from 'three';
import { LAYERS } from './layers';
import type { Theme } from './themes';

const vertexShader = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = clip.xyww; // pinned to the far plane
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uCloudLit;
uniform vec3 uCloudShadow;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uUp;
uniform sampler2D uBrush;
varying vec3 vDirection;

void main() {
  vec3 d = normalize(vDirection);
  float h = dot(d, uUp);
  vec3 color = h >= 0.0 ? mix(uHorizon, uZenith, pow(h, 0.45)) : mix(uHorizon, uGround, pow(-h, 0.35));
  // Painted cumulus: brush strokes thresholded into hard-edged masses in a band above the horizon.
  float azimuth = atan(d.z, d.x);
  vec2 uv = vec2(azimuth / 6.2831853 * 3.0, h * 2.2);
  float field = texture2D(uBrush, uv).r * 0.6 + texture2D(uBrush, uv * 2.3 + vec2(0.37, 0.11)).r * 0.4;
  float band = smoothstep(0.02, 0.12, h) * (1.0 - smoothstep(0.24, 0.5, h));
  float cloud = smoothstep(0.54, 0.6, field * 0.8 + band * 0.35) * band;
  float sunSide = dot(d, uSunDirection) * 0.5 + 0.5;
  vec3 cloudColor = mix(uCloudShadow, uCloudLit, smoothstep(0.4, 0.62, sunSide + (field - 0.5) * 0.6));
  color = mix(color, cloudColor, cloud);
  float s = max(dot(d, uSunDirection), 0.0);
  color += uSunColor * (pow(s, 900.0) * 8.0 + pow(s, 14.0) * 0.3) * (1.0 - cloud * 0.8);
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

export interface PaintedSky {
  mesh: Mesh;
  follow(camera: Camera): void;
}

export function createPaintedSky(theme: Theme, brush: Texture, sunDirection: Vector3): PaintedSky {
  const material = new ShaderMaterial({
    name: 'PaintedSky',
    side: BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new Color(theme.sky.zenith) },
      uHorizon: { value: new Color(theme.sky.horizon) },
      uGround: { value: new Color(theme.sky.ground) },
      uCloudLit: { value: new Color(theme.sky.cloudLit) },
      uCloudShadow: { value: new Color(theme.sky.cloudShadow) },
      uSunDirection: { value: sunDirection.clone().normalize() },
      uSunColor: { value: new Color(theme.sun.color) },
      uUp: { value: new Vector3(0, 1, 0) },
      uBrush: { value: brush },
    },
    vertexShader,
    fragmentShader,
  });
  const mesh = new Mesh(new SphereGeometry(1000, 48, 24), material);
  mesh.name = 'painted_sky';
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  mesh.layers.set(LAYERS.sky);
  return {
    mesh,
    follow(camera) {
      mesh.position.copy(camera.position);
    },
  };
}
```

- [ ] **Step 6: Write `src/render/renderer.ts`**

```ts
import { NoToneMapping, PCFShadowMap, SRGBColorSpace, WebGLRenderer } from 'three';
import type { Tier } from './quality';

export function createRenderer(container: HTMLElement, tier: Tier): WebGLRenderer {
  const renderer = new WebGLRenderer({
    antialias: false, // the composer multisamples
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true, // the lab reads frames back for the colour audit and screenshots
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.pixelRatioMax));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping; // tone mapping happens once, in the post pipeline
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap; // PCFSoftShadowMap was removed in r186; softness is shadow.radius
  container.appendChild(renderer.domElement);
  return renderer;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/unit/render/terrain.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 8: Commit**

```bash
git add src/render/sky.ts src/render/renderer.ts src/render/terrain tests/unit/render/terrain.test.ts
git commit -F - <<'EOF'
Add the painted sky, the renderer and the curved style patch

The patch is 160 m of ground at the north pole of a 160 m planet (the
blueprint's standard radius), so the surface visibly curves away; the heart's
clearing stays level and vertex colours paint meadow, light patches, moss in
hollows, a trodden soil ring and stone on slopes. A low sphere fills the
horizon from high cameras. The sky pins itself to the far plane and paints
hard-edged cumulus from the brush atlas. Shadows use PCFShadowMap because
r186 removed PCFSoftShadowMap.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Loading assets with paint and ink

**Files:**
- Create: `src/render/assets/manifest.ts`, `src/render/assets/loadAsset.ts`
- Test: `tests/unit/render/load-asset.test.ts`

- [ ] **Step 1: Write the failing test `tests/unit/render/load-asset.test.ts`**

```ts
import { BoxGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { collectMeshes, paintAndInk } from '../../../src/render/assets/loadAsset';
import { DEFAULT_DIALS } from '../../../src/render/defaults';
import { createHullMaterial, createInkUniforms } from '../../../src/render/ink/hull';
import { createPaintUniforms } from '../../../src/render/materials/painted';
import { VERDANT } from '../../../src/render/themes';

function inkedMesh(name: string, width: number, material: MeshStandardMaterial) {
  const geometry = new BoxGeometry();
  geometry.setAttribute('_ink', new Float32BufferAttribute(new Array(geometry.getAttribute('position').count).fill(width), 1));
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

describe('paintAndInk', () => {
  const ctx = {
    paint: createPaintUniforms(VERDANT, DEFAULT_DIALS, new Texture()),
    hullMaterial: createHullMaterial(createInkUniforms(DEFAULT_DIALS)),
    hullLayer: 1,
  };

  it('gives every inked mesh exactly one hull, without recursing into the hulls', () => {
    const shared = new MeshStandardMaterial();
    const root = new Group();
    root.add(inkedMesh('a', 0.5, shared), inkedMesh('b', 0.5, shared));
    paintAndInk(root, ctx, 0.2);
    const meshes = collectMeshes(root);
    expect(meshes.map((m) => m.name).sort()).toEqual(['a', 'a_hull', 'b', 'b_hull']);
  });

  it('shares one painted material per source, split by double-sidedness', () => {
    const shared = new MeshStandardMaterial();
    const rock = inkedMesh('rock', 0.5, shared);
    const grass = inkedMesh('grass', 0, shared);
    grass.userData['double_sided'] = true;
    const root = new Group();
    root.add(rock, grass);
    paintAndInk(root, ctx, 0.1);
    expect(rock.material).not.toBe(grass.material);
    expect(grass.children).toHaveLength(0); // zero ink, no hull
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/render/load-asset.test.ts`
Expected: FAIL, the module cannot be resolved.

- [ ] **Step 3: Write `src/render/assets/manifest.ts`**

```ts
export interface ManifestAnimation {
  name: string;
  duration: number;
  loop: boolean;
  strike: number | null;
  exportedDuration: number | null;
}

export interface ManifestEntry {
  name: string;
  family: string;
  kind: 'model' | 'texture';
  file: string;
  nodes: string[];
  animations: ManifestAnimation[];
  tris: number;
  bones: number;
  hasInk: boolean;
  bytes: number;
}

export interface Manifest {
  version: number;
  assets: ManifestEntry[];
}

/** Null when no assets have been built yet; the lab then uses placeholders. */
export async function fetchManifest(base: string): Promise<Manifest | null> {
  try {
    const response = await fetch(`${base}assets/manifest.json`, { cache: 'no-cache' });
    if (!response.ok) return null;
    return (await response.json()) as Manifest;
  } catch {
    return null;
  }
}

export function assetUrl(base: string, manifest: Manifest, name: string): string | null {
  const entry = manifest.assets.find((asset) => asset.name === name && asset.kind === 'model');
  return entry ? `${base}assets/${entry.file}` : null;
}
```

- [ ] **Step 4: Write `src/render/assets/loadAsset.ts`**

```ts
import { Color, DoubleSide, type AnimationClip, type Group, type Mesh, type MeshStandardMaterial, type Object3D, type ShaderMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { attachHull } from '../ink/hull';
import { createPaintedMaterial, type PaintUniforms } from '../materials/painted';

export interface MaterialContext {
  paint: PaintUniforms;
  hullMaterial: ShaderMaterial;
  hullLayer: number;
}

export interface LoadedAsset {
  root: Group;
  animations: AnimationClip[];
}

/**
 * Collect first, change afterwards. Adding hull children inside traverse() makes traverse visit the new
 * hulls and give them hulls of their own, forever; the reference repo lost a scene to exactly that.
 */
export function collectMeshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((object) => {
    if ((object as Mesh).isMesh) out.push(object as Mesh);
  });
  return out;
}

/** Swaps GLB materials for painted ones (shared per source and sidedness) and inks meshes that carry _ink. */
export function paintAndInk(root: Object3D, ctx: MaterialContext, standardBlend: number): void {
  const cache = new Map<string, ShaderMaterial>();
  for (const mesh of collectMeshes(root)) {
    const source = mesh.material as MeshStandardMaterial;
    const doubleSided = source.side === DoubleSide || mesh.userData['double_sided'] === true;
    const key = `${source.uuid}:${doubleSided}`;
    let painted = cache.get(key);
    if (!painted) {
      painted = createPaintedMaterial(ctx.paint, {
        map: source.map ?? null,
        emissiveMap: source.emissiveMap ?? null,
        emissiveColor: source.emissive ? source.emissive.clone() : new Color(0, 0, 0),
        emissiveIntensity: source.emissiveIntensity ?? 1,
        baseColor: source.map ? new Color(1, 1, 1) : (source.color?.clone() ?? new Color(1, 1, 1)),
        doubleSided,
        standardBlend,
      });
      cache.set(key, painted);
    }
    mesh.material = painted;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const ink = mesh.geometry.getAttribute('_ink');
    if (ink) {
      mesh.geometry.setAttribute('inkWidth', ink);
      attachHull(mesh, ctx.hullMaterial, ctx.hullLayer);
    }
  }
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

export async function loadAsset(url: string, ctx: MaterialContext, standardBlend = 0.1): Promise<LoadedAsset> {
  const gltf = await loader.loadAsync(url);
  paintAndInk(gltf.scene, ctx, standardBlend);
  return { root: gltf.scene, animations: gltf.animations };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/render/load-asset.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add src/render/assets tests/unit/render/load-asset.test.ts
git commit -F - <<'EOF'
Load GLB assets into painted materials with hull ink

Meshes are collected before hulls are added, because adding children inside
traverse() recursed forever in the reference repo's style trials. Painted
materials are shared per source material and sidedness: the Verdant kit is
one atlas, and the grass card must not force the rocks double-sided. The
_INK attribute becomes inkWidth; meshes whose ink is zero get no hull.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Placeholders and the style scene

**Files:**
- Create: `src/labs/style/placeholders.ts`, `src/labs/style/scene.ts`

- [ ] **Step 1: Write `src/labs/style/placeholders.ts`**

Stand-ins carry the same node names the scene looks for, so the lab runs before M0c's assets exist and switches to them without code changes.

```ts
import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  type BufferGeometry,
} from 'three';
import { paintAndInk, type LoadedAsset, type MaterialContext } from '../../render/assets/loadAsset';

function inked(geometry: BufferGeometry, width = 1): BufferGeometry {
  geometry.setAttribute('_ink', new Float32BufferAttribute(new Array(geometry.getAttribute('position').count).fill(width / 2), 1));
  return geometry;
}

function part(name: string, geometry: BufferGeometry, color: string, emissive = '#000000', ink = 1): Mesh {
  const material = new MeshStandardMaterial({ color: new Color(color), emissive: new Color(emissive), emissiveIntensity: 3 });
  const mesh = new Mesh(inked(geometry, ink), material);
  mesh.name = name;
  return mesh;
}

function asset(root: Group, ctx: MaterialContext, blend: number): LoadedAsset {
  paintAndInk(root, ctx, blend);
  return { root, animations: [] };
}

export function placeholderAssets(ctx: MaterialContext) {
  const bulwark = new Group();
  const bulwarkBody = part('bulwark', new CapsuleGeometry(0.35, 1.1, 4, 12), '#566276');
  bulwarkBody.position.y = 0.9;
  bulwark.add(bulwarkBody);
  const husk = new Group();
  const huskBody = part('husk', new IcosahedronGeometry(0.6, 1), '#3a2c52', '#000000');
  huskBody.position.y = 0.8;
  husk.add(huskBody);
  const bolt = new Group();
  for (const level of [1, 2, 3]) {
    const base = part(`bolt_mk${level}`, new CylinderGeometry(0.7, 0.78, 0.35 + 0.12 * (level - 1), 8), '#3d4757');
    const yaw = part(`bolt_mk${level}_yaw`, new CylinderGeometry(0.5, 0.5, 0.2, 12), '#566276');
    yaw.position.y = 0.3 + 0.12 * (level - 1);
    const pitch = part(`bolt_mk${level}_pitch`, new BoxGeometry(0.7, 0.42, 0.9), '#3d4757');
    pitch.position.y = 0.35;
    const rail = part(`bolt_mk${level}_rail`, new BoxGeometry(0.1, 0.1, 1 + 0.2 * level), '#cdd8e6', '#59f2ff');
    rail.position.z = 0.8;
    pitch.add(rail);
    yaw.add(pitch);
    base.add(yaw);
    bolt.add(base);
  }
  const heart = new Group();
  heart.add(part('heart_plinth', new CylinderGeometry(1.05, 1.2, 0.4, 8), '#9c8a74'));
  for (let level = 0; level <= 10; level++) {
    const stage = part(`heart_stage_${String(level).padStart(2, '0')}`, new ConeGeometry(0.3 + 0.012 * level, 1.4 + 0.14 * level, 6), '#ffb38a', '#ffc36b', 0.9);
    stage.position.y = 0.4 + (1.4 + 0.14 * level) / 2;
    heart.add(stage);
  }
  const nest = new Group();
  nest.add(part('nest', new IcosahedronGeometry(1.4, 1), '#241a38', '#ff3fa6'));
  const kit = new Group();
  const pieces: [string, BufferGeometry, string, number][] = [
    ['rock_a', new IcosahedronGeometry(0.8, 0), '#8a8378', 1.1],
    ['rock_b', new IcosahedronGeometry(1.0, 0), '#8a8378', 1.1],
    ['rock_c', new IcosahedronGeometry(0.6, 0), '#8a8378', 1.1],
    ['tree_broad', new IcosahedronGeometry(1.4, 1).translate(0, 3, 0), '#3e9f6e', 1.25],
    ['tree_conifer', new ConeGeometry(1, 3.5, 8).translate(0, 1.8, 0), '#3e9f6e', 1.2],
    ['bush', new IcosahedronGeometry(0.6, 1).translate(0, 0.45, 0), '#3e9f6e', 1.1],
    ['grass_tuft', new ConeGeometry(0.15, 0.6, 4).translate(0, 0.3, 0), '#4ec98a', 0],
    ['flowers', new IcosahedronGeometry(0.12, 0).translate(0, 0.35, 0), '#ffc857', 0.6],
  ];
  for (const [name, geometry, color, ink] of pieces) kit.add(part(name, geometry, color, '#000000', ink));
  return {
    bulwark: asset(bulwark, ctx, 0.35),
    husk: asset(husk, ctx, 0.3),
    bolt: asset(bolt, ctx, 0.1),
    heart: asset(heart, ctx, 0.1),
    nest: asset(nest, ctx, 0.1),
    kit: asset(kit, ctx, 0.0),
  };
}
```

- [ ] **Step 2: Write `src/labs/style/scene.ts`**

```ts
import {
  AnimationMixer,
  Group,
  InstancedMesh,
  LoopOnce,
  LoopRepeat,
  Matrix4,
  Quaternion,
  Vector3,
  type AnimationAction,
  type Mesh,
  type Object3D,
  type PerspectiveCamera,
} from 'three';
import { Rng, seedRng } from '../../sim/rng';
import type { LoadedAsset, MaterialContext } from '../../render/assets/loadAsset';
import { attachHull } from '../../render/ink/hull';
import type { StylePatch } from '../../render/terrain/stylePatch';

export type BulwarkMode = 'cycle' | 'idle' | 'run' | 'attack';
export type PresetName = 'hero' | 'strategic' | 'closeup' | 'horizon';
export const PRESETS: PresetName[] = ['hero', 'strategic', 'closeup', 'horizon'];

export interface StyleAssets {
  bulwark: LoadedAsset;
  husk: LoadedAsset;
  bolt: LoadedAsset;
  heart: LoadedAsset;
  nest: LoadedAsset;
  kit: LoadedAsset;
}

export interface StyleScene {
  root: Group;
  update(dt: number): void;
  setHeartStage(level: number): void;
  setBulwarkMode(mode: BulwarkMode): void;
  preset(name: PresetName): { position: Vector3; target: Vector3 };
}

const UP = new Vector3(0, 1, 0);
const HUSK_RADIUS = 13;
const HUSK_SPEED = 1.85; // v3 Husk speed, metres per second
const RUN_RADIUS = 6;
const RUN_SPEED = 7; // blueprint commander run speed

function place(object: Object3D, patch: StylePatch, x: number, z: number, yaw: number, alignToGround = 0): void {
  const surface = patch.surfaceAt(x, z);
  object.position.copy(surface.position);
  const up = surface.up.clone().lerp(surface.normal, alignToGround).normalize();
  object.quaternion.setFromUnitVectors(UP, up).multiply(new Quaternion().setFromAxisAngle(UP, yaw));
}

class Actor {
  readonly mixer: AnimationMixer;
  private readonly actions = new Map<string, AnimationAction>();
  private current: AnimationAction | null = null;

  constructor(readonly root: Object3D, asset: LoadedAsset) {
    this.mixer = new AnimationMixer(root);
    for (const clip of asset.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
  }

  /** Crossfades in 0.18 s, the reference game's clip blend. Missing clips are ignored (placeholders). */
  play(name: string, once = false): number {
    const next = this.actions.get(name);
    if (!next) return 0;
    if (next === this.current && !once) return next.getClip().duration;
    next.reset();
    next.setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.play();
    if (this.current) this.current.crossFadeTo(next, 0.18, false);
    this.current = next;
    return next.getClip().duration;
  }
}

function scatter(root: Group, patch: StylePatch, kit: LoadedAsset, ctx: MaterialContext, scale: number): void {
  const rng = new Rng(seedRng(2026));
  const plan: [string, number, number, number][] = [
    ['tree_broad', 14, 18, 46],
    ['tree_conifer', 12, 20, 48],
    ['rock_a', 8, 6, 44],
    ['rock_b', 7, 7, 44],
    ['rock_c', 9, 6, 40],
    ['bush', 26, 6, 42],
    ['grass_tuft', 420, 2.5, 40],
    ['flowers', 70, 3, 36],
  ];
  const matrix = new Matrix4();
  const holder = new Group();
  for (const [name, baseCount, minRadius, maxRadius] of plan) {
    const source = kit.root.getObjectByName(name) as Mesh | undefined;
    if (!source) continue;
    const count = Math.max(1, Math.round(baseCount * scale));
    const instanced = new InstancedMesh(source.geometry, source.material, count);
    instanced.name = `${name}_instances`;
    instanced.castShadow = name !== 'grass_tuft';
    instanced.receiveShadow = true;
    for (let i = 0; i < count; i++) {
      const angle = rng.range(0, Math.PI * 2);
      const radius = Math.sqrt(rng.range(minRadius * minRadius, maxRadius * maxRadius));
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      place(holder, patch, x, z, rng.range(0, Math.PI * 2), name.startsWith('rock') ? 0.8 : 0.2);
      const s = rng.range(0.8, 1.25);
      holder.scale.setScalar(s);
      holder.updateMatrix();
      instanced.setMatrixAt(i, matrix.copy(holder.matrix));
    }
    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
    attachHull(instanced, ctx.hullMaterial, ctx.hullLayer);
    root.add(instanced);
  }
}

export function buildStyleScene(patch: StylePatch, assets: StyleAssets, ctx: MaterialContext, scatterScale: number): StyleScene {
  const root = new Group();
  root.name = 'style_scene';

  const heart = assets.heart.root;
  place(heart, patch, 0, 0, 0);
  root.add(heart);
  const stages = Array.from({ length: 11 }, (_, level) => heart.getObjectByName(`heart_stage_${String(level).padStart(2, '0')}`));
  const setHeartStage = (level: number) => stages.forEach((stage, index) => stage && (stage.visible = index === level));
  setHeartStage(3);

  const turrets: { yaw: Object3D; pitch: Object3D }[] = [];
  [1, 2, 3].forEach((level, index) => {
    const mark = assets.bolt.root.getObjectByName(`bolt_mk${level}`);
    if (!mark) return;
    const angle = ((200 + index * 40) * Math.PI) / 180;
    place(mark, patch, Math.cos(angle) * 7, Math.sin(angle) * 7, -angle + Math.PI / 2, 0.5);
    root.add(mark);
    const yaw = mark.getObjectByName(`bolt_mk${level}_yaw`);
    const pitch = mark.getObjectByName(`bolt_mk${level}_pitch`);
    if (yaw && pitch) turrets.push({ yaw, pitch });
  });

  const nest = assets.nest.root;
  place(nest, patch, -15, -14, 0.4, 0.6);
  root.add(nest);

  const husk = new Actor(assets.husk.root, assets.husk);
  root.add(husk.root);
  const bulwark = new Actor(assets.bulwark.root, assets.bulwark);
  root.add(bulwark.root);

  scatter(root, patch, assets.kit, ctx, scatterScale);

  let huskAngle = 0;
  let huskTimer = 0;
  let huskAttacking = 0;
  let mode: BulwarkMode = 'cycle';
  let cycleTime = 0;
  let runAngle = 0;
  const bulwarkHome = new Vector3(3.2, 0, 2.4);
  const huskWorld = new Vector3();
  const temp = new Vector3();

  function updateHusk(dt: number) {
    huskTimer += dt;
    if (huskAttacking > 0) {
      huskAttacking -= dt;
      if (huskAttacking <= 0) husk.play('walk');
    } else {
      huskAngle += (HUSK_SPEED / HUSK_RADIUS) * dt;
      if (huskTimer > 7) {
        huskTimer = 0;
        huskAttacking = husk.play('attack', true) || 1.4;
      } else {
        husk.play('walk');
      }
    }
    const x = Math.cos(huskAngle) * HUSK_RADIUS;
    const z = Math.sin(huskAngle) * HUSK_RADIUS;
    place(husk.root, patch, x, z, -huskAngle); // faces along its path (glTF characters face +Z)
    husk.mixer.update(dt);
  }

  function updateBulwark(dt: number) {
    cycleTime += dt;
    let running = false;
    if (mode === 'run') running = true;
    if (mode === 'cycle') {
      const t = cycleTime % 12;
      if (t < 3) bulwark.play('idle');
      else if (t < 3.85) bulwark.play('attack', t - dt < 3);
      else if (t < 6) bulwark.play('idle');
      else if (t < 6 + (2 * Math.PI * RUN_RADIUS) / RUN_SPEED) running = true;
      else bulwark.play('idle');
    } else if (mode === 'idle') bulwark.play('idle');
    else if (mode === 'attack' && Math.floor((cycleTime - dt) / 1.6) !== Math.floor(cycleTime / 1.6)) bulwark.play('attack', true);
    if (running) {
      bulwark.play('run');
      runAngle += (RUN_SPEED / RUN_RADIUS) * dt;
      // Moving counter-clockwise, velocity is (-sin a, cos a); a glTF character faces +Z, so its yaw is -a.
      place(bulwark.root, patch, Math.cos(runAngle) * RUN_RADIUS, Math.sin(runAngle) * RUN_RADIUS, -runAngle);
    } else if (mode !== 'run') {
      place(bulwark.root, patch, bulwarkHome.x, bulwarkHome.z, Math.PI);
    }
    bulwark.mixer.update(dt);
  }

  function aimTurrets(dt: number) {
    husk.root.getWorldPosition(huskWorld).add(temp.set(0, 0.8, 0));
    for (const { yaw, pitch } of turrets) {
      const local = yaw.parent ? yaw.parent.worldToLocal(huskWorld.clone()) : huskWorld.clone();
      const desired = Math.atan2(local.x - yaw.position.x, local.z - yaw.position.z);
      let delta = desired - yaw.rotation.y;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      yaw.rotation.y += Math.sign(delta) * Math.min(Math.abs(delta), 9 * dt); // v3 turn rate, 9 rad/s
      const flat = Math.hypot(local.x - yaw.position.x, local.z - yaw.position.z);
      pitch.rotation.x = -Math.atan2(local.y - yaw.position.y - pitch.position.y, flat);
    }
  }

  return {
    root,
    update(dt) {
      updateHusk(dt);
      updateBulwark(dt);
      aimTurrets(dt);
    },
    setHeartStage,
    setBulwarkMode(next) {
      mode = next;
      cycleTime = 0;
    },
    preset(name) {
      const body = new Vector3();
      bulwark.root.getWorldPosition(body);
      const forward = new Vector3(0, 0, 1).applyQuaternion(bulwark.root.quaternion);
      switch (name) {
        case 'hero':
          return { position: body.clone().addScaledVector(forward, -5.5).add(new Vector3(0, 2.4, 0)), target: body.clone().addScaledVector(forward, 4).add(new Vector3(0, 1.3, 0)) };
        case 'closeup':
          return { position: body.clone().addScaledVector(forward, 2.6).add(new Vector3(0.6, 1.6, 0)), target: body.clone().add(new Vector3(0, 1.35, 0)) };
        case 'strategic':
          return { position: new Vector3(0, 38, 30), target: new Vector3(0, 0, 0) };
        case 'horizon':
          return { position: new Vector3(-12, 1.6, 22), target: new Vector3(10, 2, -20) };
      }
    },
  };
}

export function applyPreset(scene: StyleScene, name: PresetName, camera: PerspectiveCamera, target: Vector3): void {
  const { position, target: look } = scene.preset(name);
  camera.position.copy(position);
  target.copy(look);
  camera.lookAt(look);
}
```

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`
Expected: exits 0 (with the placeholder note in Step 1 applied).

- [ ] **Step 4: Commit**

```bash
git add src/labs/style/placeholders.ts src/labs/style/scene.ts
git commit -F - <<'EOF'
Add the style scene layout, its actors and placeholder assets

The heart sits at the pole with a selectable growth stage; Bolt Sentinel
marks I to III stand in an arc and turn at the reference game's 9 rad/s
toward a Husk that walks a 13 m circle at its 1.85 m/s and attacks every 7 s;
Bulwark cycles idle, attack and a 7 m/s lap of the heart; the Verdant kit is
scattered as instanced, inked meshes from a fixed seed. Placeholders carry
the same node names, so the lab runs before M0c's assets exist.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: The lab page: dials, reference board, audit and main

**Files:**
- Create: `src/labs/style/dials.ts`, `src/labs/style/referenceBoard.ts`, `src/labs/style/style.css`
- Modify: `src/labs/style/main.ts` (replace the M0a placeholder), `labs/style.html`

- [ ] **Step 1: Write `src/labs/style/dials.ts`**

```ts
import GUI from 'lil-gui';
import { NUMERIC_RANGES, type RenderDials } from '../../render/defaults';
import type { TierName } from '../../render/quality';
import { PRESETS, type BulwarkMode, type PresetName } from './scene';

export interface LabState {
  tier: TierName;
  preset: PresetName;
  heartStage: number;
  bulwark: BulwarkMode;
}

export interface LabHandlers {
  onDials(): void;
  onTier(tier: TierName): void;
  onPreset(preset: PresetName): void;
  onHeartStage(level: number): void;
  onBulwark(mode: BulwarkMode): void;
  audit(): void;
  copyDials(): void;
  reset(): void;
  screenshot(): void;
}

const GROUPS: Record<string, (keyof RenderDials)[]> = {
  Paint: ['bands', 'bandSoftness', 'terminatorNoise', 'paintStrength', 'saturation', 'shadowDepth', 'shadowTint', 'rimStrength', 'rimPower', 'standardBlend', 'ambientStrength', 'brushScale', 'terrainBrush'],
  Ink: ['inkWidthPx', 'inkColor', 'edgeStrength', 'edgeLineWidth', 'depthThreshold', 'normalThreshold', 'edgeFadeNear', 'edgeFadeFar'],
  Atmosphere: ['fogDensity', 'fogStart'],
  Post: ['exposure', 'contrast', 'bloomIntensity', 'bloomThreshold', 'grain', 'vignette'],
};

export function createDialsPanel(dials: RenderDials, state: LabState, handlers: LabHandlers): GUI {
  const gui = new GUI({ title: 'Painted-Anime-Inkline 4.0' });
  const lab = gui.addFolder('Lab');
  lab.add(state, 'tier', ['high', 'medium', 'low']).name('quality tier').onChange((tier: TierName) => handlers.onTier(tier));
  lab.add(state, 'preset', PRESETS).name('camera').onChange((preset: PresetName) => handlers.onPreset(preset));
  lab.add(state, 'heartStage', 0, 10, 1).name('heart level').onChange((level: number) => handlers.onHeartStage(level));
  lab.add(state, 'bulwark', ['cycle', 'idle', 'run', 'attack']).name('Bulwark').onChange((mode: BulwarkMode) => handlers.onBulwark(mode));
  for (const [group, keys] of Object.entries(GROUPS)) {
    const folder = gui.addFolder(group);
    for (const key of keys) {
      if (key === 'shadowTint' || key === 'inkColor') {
        folder.addColor(dials, key).onChange(() => handlers.onDials());
      } else {
        const [min, max, step] = NUMERIC_RANGES[key as Exclude<keyof RenderDials, 'shadowTint' | 'inkColor'>];
        folder.add(dials, key, min, max, step).onChange(() => handlers.onDials());
      }
    }
    if (group !== 'Paint') folder.close();
  }
  const actions = gui.addFolder('Actions');
  actions.add({ run: () => handlers.audit() }, 'run').name('Run colour audit');
  actions.add({ copy: () => handlers.copyDials() }, 'copy').name('Copy dials link');
  actions.add({ shot: () => handlers.screenshot() }, 'shot').name('Save screenshot');
  actions.add({ reset: () => handlers.reset() }, 'reset').name('Reset dials');
  return gui;
}
```

- [ ] **Step 2: Write `src/labs/style/referenceBoard.ts`**

The board describes the references; it carries no copied imagery.

```ts
import type { Theme } from '../../render/themes';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function list(items: string[]): HTMLUListElement {
  const ul = el('ul');
  for (const item of items) ul.appendChild(el('li', item));
  return ul;
}

export function mountReferenceBoard(host: HTMLElement, theme: Theme): void {
  host.replaceChildren();
  const toggle = el('button', 'Reference board', 'board-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'true');
  const body = el('div', undefined, 'board-body');
  toggle.addEventListener('click', () => {
    const open = body.hidden;
    body.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  });
  body.append(
    el('h2', 'What we are matching'),
    list([
      'Painted 3D from the Sifu flashback: simple forms, hand-painted brush-stroke colour on every surface.',
      'A hard-edged light and shadow boundary with painted gradients inside each zone.',
      'Warm amber key light against teal and green coloured shadows; saturated accents.',
      'Characters blend cel and standard lighting; environments stay painted.',
      'Borderlands ink: bold, near-black silhouette lines on outer edges and major creases.',
      'The flashback ink sketch (black and white with one warm accent) is the cutscene mode.',
    ]),
    el('h2', 'Frozen nouns'),
    el('p', 'painted brush-stroke albedo, brush-edged shadow, coloured shadow, ink silhouette, gunmetal and enamel, cyan energy channel, wet chitin, magenta seam light, warm heart crystal, painted sky'),
    el('h2', 'Calibration from v3 (Painted-Anime-Inkline 1.3.2)'),
    el('p', 'line 1.81, texture 1.5, saturation 1.3, shadow depth 0.35, exposure 0.77'),
    el('h2', `${theme.name} palette`),
  );
  const swatches = el('div', undefined, 'swatches');
  const colours: [string, string][] = [
    ['sun', theme.sun.color],
    ['shadow', theme.shadowTint],
    ['zenith', theme.sky.zenith],
    ['horizon', theme.sky.horizon],
    ['meadow', theme.ground.meadow],
    ['meadow light', theme.ground.meadowLight],
    ['moss', theme.ground.moss],
    ['stone', theme.ground.stone],
    ['soil', theme.ground.soil],
  ];
  for (const [name, hex] of colours) {
    const swatch = el('div', undefined, 'swatch');
    const chip = el('span', undefined, 'chip');
    chip.style.background = hex;
    swatch.append(chip, el('span', `${name} ${hex}`));
    swatches.appendChild(swatch);
  }
  body.appendChild(swatches);
  body.appendChild(el('h2', 'Audit bands'));
  body.appendChild(list(theme.bands.map((band) => `${band.name}: ${band.hueMin} to ${band.hueMax} degrees`)));
  const link = el('a', 'Owner reference clip (YouTube)');
  link.href = 'https://www.youtube.com/watch?v=B-KxB2ip3JY';
  link.target = '_blank';
  link.rel = 'noopener';
  body.appendChild(link);
  host.append(toggle, body);
}
```

- [ ] **Step 3: Write `src/labs/style/style.css`**

```css
#stage {
  position: fixed;
  inset: 0;
}

#stage canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.board {
  position: fixed;
  top: 12px;
  left: 12px;
  width: min(340px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  overflow: auto;
  background: rgba(20, 22, 29, 0.9);
  border: 1px solid var(--hairline);
  border-radius: 8px;
  padding: 12px 16px;
}

.board h2 {
  font: 700 16px/1.2 var(--font-display);
  letter-spacing: 0.04em;
  margin: 16px 0 8px;
}

.board ul {
  margin: 0;
  padding-left: 18px;
}

.board-toggle {
  font: 700 20px/1.2 var(--font-display);
  color: var(--paper);
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  min-height: 48px;
}

.swatches {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.swatch {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
}

.chip {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid var(--hairline);
}

.audit,
.fps,
.banner {
  position: fixed;
  background: rgba(20, 22, 29, 0.9);
  border: 1px solid var(--hairline);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12.5px;
}

.audit {
  left: 12px;
  bottom: 12px;
  max-width: 420px;
  white-space: pre-line;
}

.fps {
  right: 12px;
  bottom: 12px;
  font-variant-numeric: tabular-nums;
}

.banner {
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  color: var(--gold);
}

@media (max-width: 720px) {
  .board {
    width: calc(100vw - 24px);
    max-height: 45vh;
  }
}
```

- [ ] **Step 4: Replace `labs/style.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Style Lab</title>
    <link rel="stylesheet" href="/src/ui/base.css" />
    <link rel="stylesheet" href="/src/labs/style/style.css" />
  </head>
  <body>
    <div id="stage"></div>
    <aside id="board" class="board" aria-label="Reference board"></aside>
    <div id="audit" class="audit">Colour audit: not run yet.</div>
    <div id="fps" class="fps"></div>
    <div id="banner" class="banner" hidden></div>
    <script type="module" src="/src/labs/style/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Replace `src/labs/style/main.ts`**

```ts
import { DataTexture, DirectionalLight, NoColorSpace, PerspectiveCamera, RedFormat, RepeatWrapping, Scene, TextureLoader, Vector2, Vector3, type Texture } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { assetUrl, fetchManifest } from '../../render/assets/manifest';
import { loadAsset, type MaterialContext } from '../../render/assets/loadAsset';
import { DEFAULT_DIALS, type RenderDials } from '../../render/defaults';
import { decodeDials, encodeDials } from '../../render/dialsCodec';
import { applyInkDials, createHullMaterial, createInkUniforms } from '../../render/ink/hull';
import { LAYERS } from '../../render/layers';
import { applyPaintDials, createPaintUniforms } from '../../render/materials/painted';
import { createPipeline, type Pipeline } from '../../render/post/pipeline';
import { detectTier, parseTier, TIERS, type TierName } from '../../render/quality';
import { createRenderer } from '../../render/renderer';
import { createPaintedSky } from '../../render/sky';
import { createStylePatch } from '../../render/terrain/stylePatch';
import { sunDirection, VERDANT } from '../../render/themes';
import { auditPixels, mutationProof } from './audit';
import { createDialsPanel, type LabState } from './dials';
import { placeholderAssets } from './placeholders';
import { mountReferenceBoard } from './referenceBoard';
import { applyPreset, buildStyleScene, type PresetName, type StyleAssets } from './scene';

const BASE = import.meta.env.BASE_URL;
const theme = VERDANT;

function grey(): Texture {
  const texture = new DataTexture(new Uint8Array([128]), 1, 1, RedFormat);
  texture.needsUpdate = true;
  return texture;
}

async function loadTexture(url: string): Promise<Texture> {
  try {
    const texture = await new TextureLoader().loadAsync(url);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.colorSpace = NoColorSpace; // data, not colour
    return texture;
  } catch {
    return grey();
  }
}

async function loadStyleAssets(ctx: MaterialContext): Promise<StyleAssets | null> {
  const manifest = await fetchManifest(BASE);
  if (!manifest) return null;
  const urls = {
    bulwark: assetUrl(BASE, manifest, 'bulwark'),
    husk: assetUrl(BASE, manifest, 'husk'),
    bolt: assetUrl(BASE, manifest, 'bolt_sentinel'),
    heart: assetUrl(BASE, manifest, 'worldheart'),
    nest: assetUrl(BASE, manifest, 'nest'),
    kit: assetUrl(BASE, manifest, 'verdant_kit'),
  };
  if (Object.values(urls).some((url) => url === null)) return null;
  const [bulwark, husk, bolt, heart, nest, kit] = await Promise.all([
    loadAsset(urls.bulwark as string, ctx, 0.35),
    loadAsset(urls.husk as string, ctx, 0.3),
    loadAsset(urls.bolt as string, ctx, 0.1),
    loadAsset(urls.heart as string, ctx, 0.1),
    loadAsset(urls.nest as string, ctx, 0.1),
    loadAsset(urls.kit as string, ctx, 0.0),
  ]);
  return { bulwark, husk, bolt, heart, nest, kit };
}

function readPixels(canvas: HTMLCanvasElement, width: number, height: number): Uint8ClampedArray {
  const small = document.createElement('canvas');
  small.width = width;
  small.height = height;
  const context = small.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  context.drawImage(canvas, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

async function start(): Promise<void> {
  const stage = document.getElementById('stage') as HTMLElement;
  const params = new URLSearchParams(location.search);
  const probe = document.createElement('canvas').getContext('webgl2');
  const state: LabState = {
    tier: parseTier(params.get('tier')) ?? (probe ? detectTier(probe, navigator.userAgent) : 'low'),
    preset: (params.get('preset') as PresetName | null) ?? 'hero',
    heartStage: 3,
    bulwark: 'cycle',
  };
  const dials: RenderDials = params.get('dials') ? decodeDials(params.get('dials') as string) : { ...DEFAULT_DIALS };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let tier = TIERS[state.tier];
  const renderer = createRenderer(stage, tier);

  const [brush, inkNoise] = await Promise.all([loadTexture(`${BASE}assets/textures/brush_strokes.png`), loadTexture(`${BASE}assets/textures/ink_noise.png`)]);
  const paint = createPaintUniforms(theme, dials, brush);
  const inkUniforms = createInkUniforms(dials);
  const ctx: MaterialContext = { paint, hullMaterial: createHullMaterial(inkUniforms), hullLayer: LAYERS.hull };

  const scene = new Scene();
  const camera = new PerspectiveCamera(50, stage.clientWidth / stage.clientHeight, 0.1, 2500);
  camera.layers.enable(LAYERS.hull);
  camera.layers.enable(LAYERS.sky);

  const sunDir = new Vector3(...sunDirection(theme));
  const sun = new DirectionalLight(theme.sun.color, theme.sun.intensity);
  sun.position.copy(sunDir).multiplyScalar(90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(tier.shadowMapSize, tier.shadowMapSize);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 220 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  const sky = createPaintedSky(theme, brush, sunDir);
  scene.add(sky.mesh);
  const patch = createStylePatch(theme, paint, tier.terrainSegments);
  scene.add(patch.mesh, patch.lowPlanet);

  const loaded = await loadStyleAssets(ctx);
  const banner = document.getElementById('banner') as HTMLElement;
  if (!loaded) {
    banner.hidden = false;
    banner.textContent = 'Placeholders: M0c assets are not built yet (npm run assets).';
  }
  const style = buildStyleScene(patch, loaded ?? placeholderAssets(ctx), ctx, tier.scatterScale);
  scene.add(style.root);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  applyPreset(style, state.preset, camera, controls.target);

  let pipeline: Pipeline = createPipeline({ renderer, scene, camera, tier, dials, theme, inkNoise, sunDirection: sunDir, reducedMotion });
  const drawing = new Vector2();

  function resize(): void {
    camera.aspect = stage.clientWidth / stage.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    pipeline.setSize(stage.clientWidth, stage.clientHeight);
    renderer.getDrawingBufferSize(drawing);
    inkUniforms.uResolution.value.copy(drawing);
  }
  window.addEventListener('resize', resize);
  resize();

  function applyDials(): void {
    applyPaintDials(paint, dials, theme);
    applyInkDials(inkUniforms, dials);
    pipeline.applyDials(dials, theme);
  }

  function setTier(name: TierName): void {
    tier = TIERS[name];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.pixelRatioMax));
    sun.shadow.mapSize.set(tier.shadowMapSize, tier.shadowMapSize);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    pipeline.dispose();
    pipeline = createPipeline({ renderer, scene, camera, tier, dials, theme, inkNoise, sunDirection: sunDir, reducedMotion });
    resize();
  }

  const auditBox = document.getElementById('audit') as HTMLElement;
  function runAudit() {
    const pixels = readPixels(renderer.domElement, 192, 108);
    const report = auditPixels(pixels, theme.bands);
    const mutation = mutationProof(pixels, theme.bands);
    const shares = Object.entries(report.bandShares).map(([name, share]) => `${name} ${(share * 100).toFixed(0)}%`).join(', ');
    auditBox.textContent =
      `Colour audit (${theme.name}): ${report.verdict.toUpperCase()}\n` +
      `concentration ${report.concentration.toFixed(2)} x chance (gate 1.5), colour share ${(report.chromaticShare * 100).toFixed(0)}%\n` +
      `${shares}\n` +
      `mutation proof: hue rotated ${mutation.rotation} degrees, audit ${mutation.report.verdict} (${mutation.rejected ? 'can reject' : 'CANNOT REJECT'})`;
    return { report, mutation };
  }

  createDialsPanel(dials, state, {
    onDials: applyDials,
    onTier: setTier,
    onPreset: (preset) => applyPreset(style, preset, camera, controls.target),
    onHeartStage: (level) => style.setHeartStage(level),
    onBulwark: (mode) => style.setBulwarkMode(mode),
    audit: runAudit,
    copyDials: () => {
      const url = `${location.origin}${location.pathname}?dials=${encodeDials(dials)}`;
      void navigator.clipboard?.writeText(url);
      auditBox.textContent = `Dials link copied:\n${url}`;
    },
    reset: () => {
      Object.assign(dials, DEFAULT_DIALS);
      applyDials();
    },
    screenshot: () => {
      const link = document.createElement('a');
      link.download = `style-lab-${state.preset}.png`;
      link.href = renderer.domElement.toDataURL('image/png');
      link.click();
    },
  });
  mountReferenceBoard(document.getElementById('board') as HTMLElement, theme);

  const fpsBox = document.getElementById('fps') as HTMLElement;
  let last = performance.now();
  let frames = 0;
  let frameMs = 16.7;
  window.__P99__ = {
    ready: false,
    page: 'style',
    tier: state.tier,
    assets: loaded !== null,
    audit: runAudit,
    preset: (name: PresetName) => applyPreset(style, name, camera, controls.target),
    frameMs: () => frameMs,
  };
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    frameMs = frameMs * 0.95 + dt * 1000 * 0.05;
    style.update(dt);
    controls.update();
    sky.follow(camera);
    pipeline.render(dt);
    frames += 1;
    if (frames % 30 === 0) fpsBox.textContent = `${tier.name} tier, ${frameMs.toFixed(1)} ms`;
    if (frames === 3 && window.__P99__) window.__P99__.ready = true;
  });
}

start().catch((error: unknown) => {
  console.error(error);
  const banner = document.getElementById('banner');
  if (banner) {
    banner.hidden = false;
    banner.textContent = `Style Lab failed to start: ${String(error)}`;
  }
});
```

- [ ] **Step 6: Build, run and look**

Run: `npm run typecheck && npm run dev`
Open `http://127.0.0.1:5173/labs/style.html` in the built-in browser (via `preview_start` with a `.claude/launch.json` entry named `vite` for `npm run dev` on port 5173). Wait five seconds, take a screenshot. Expected, with placeholders (banner visible): a curved green planet patch under a warm painted sky with hard-edged clouds; a warm cone heart on a stone plinth; three turrets turning to follow a purple Husk stand-in walking a circle; a capsule Bulwark; trees and rocks scattered with black silhouette ink and dark crease ink; teal-tinted shadows; no errors in `read_console_messages`. Run the colour audit from the Actions folder and read the audit box.

- [ ] **Step 7: Commit**

```bash
git add src/labs/style labs/style.html
git commit -F - <<'EOF'
Build the Style Lab: live dials, reference board and colour audit

lil-gui exposes every render dial plus tier, camera preset, heart level and
Bulwark's action; dial changes update the shared paint and ink uniforms and
the post effects in place, and tier changes rebuild the pipeline. The
reference board describes the Sifu, Borderlands and v3 references in words
and swatches only. The audit reads back a 192 by 108 frame and reports
concentration, band shares and the mutation proof; the page exposes ready,
audit, preset and frameMs on window.__P99__ for tests.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: Browser test for the Style Lab

**Files:**
- Create: `tests/e2e/style-lab.spec.ts`
- Modify: `tests/e2e/smoke.spec.ts` (the style test now waits longer)

- [ ] **Step 1: Write `tests/e2e/style-lab.spec.ts`**

```ts
import { expect, test } from '@playwright/test';

interface AuditResult {
  report: { verdict: string; concentration: number };
  mutation: { rejected: boolean; rotation: number };
}

test('the style lab renders every preset and passes its colour audit', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  // CI renders in software, so the test runs the low tier; the owner reviews high-tier frames locally.
  await page.goto('./labs/style.html?tier=low');
  await page.waitForFunction(() => window.__P99__?.ready === true, undefined, { timeout: 180_000 });
  for (const preset of ['hero', 'strategic', 'closeup', 'horizon']) {
    await page.evaluate((name) => (window.__P99__!['preset'] as (n: string) => void)(name), preset);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `test-results/style-${preset}.png` });
  }
  await page.evaluate(() => (window.__P99__!['preset'] as (n: string) => void)('hero'));
  await page.waitForTimeout(800);
  const result = (await page.evaluate(() => (window.__P99__!['audit'] as () => unknown)())) as AuditResult;
  expect(result.report.verdict, `concentration ${result.report.concentration}`).toBe('pass');
  expect(result.mutation.rejected).toBe(true);
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Give the smoke test's style check the same generous wait**

In `tests/e2e/smoke.spec.ts`, change the style lab test's wait to:

```ts
  await page.waitForFunction(() => window.__P99__?.ready === true && window.__P99__?.page === 'style', undefined, { timeout: 180_000 });
```

and add `test.setTimeout(240_000);` as the first line of that test.

- [ ] **Step 3: Run the browser tests**

Run: `npm run e2e`
Expected: `3 passed`, and `test-results/style-hero.png`, `style-strategic.png`, `style-closeup.png`, `style-horizon.png` exist and show the scene from four cameras. If the audit fails, open the hero frame and read the audit box before changing anything: the art-catalogue rule is that the metric is usually wrong, not the art, so check which band is starved and whether the theme's bands describe the scene honestly; never loosen the gate to pass.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/style-lab.spec.ts tests/e2e/smoke.spec.ts
git commit -F - <<'EOF'
Test the Style Lab in the browser: four presets, audit and mutation proof

The test runs the low tier (CI renders in software), captures the hero,
strategic, close-up and horizon frames, requires the colour audit to pass
the hero frame and the mutation proof to reject its hue-rotated copy, and
fails on any console error.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: Integrate M0c's assets, deploy and hold the style gate

**Files:**
- Modify: `src/render/defaults.ts` (at the gate), `docs/blueprint.md`
- Create: `docs/evidence/m0/style-*.png`

This task runs after M0c is complete.

- [ ] **Step 1: Confirm the real assets load**

Run: `npm run assets:check && npm run dev`, open the Style Lab at the high tier (`?tier=high`). Expected: no placeholder banner; `window.__P99__.assets === true` (check with `javascript_tool`); Bulwark, the Husk, the three turrets, the heart, the nest and the Verdant kit all visible, painted and inked; Bulwark cycles idle, attack and a lap; the Husk walks and attacks; turrets track it.

- [ ] **Step 2: Capture high-tier evidence**

For each preset (hero, strategic, closeup, horizon), apply it with `window.__P99__.preset(name)`, wait one second, and save a screenshot to `docs/evidence/m0/style-<preset>-high.png`. Record `window.__P99__.frameMs()` at the hero preset in the commit message (target: under 16.7 ms at 1440p on the RTX 4080 laptop).

- [ ] **Step 3: Run the full verification**

Run: `npm run check && npm test && npm run assets:check && npm run e2e`
Expected: all green; copy `test-results/style-*.png` to `docs/evidence/m0/` with a `-low` suffix.

- [ ] **Step 4: Deploy and verify live**

```bash
git add docs/evidence/m0
git commit -F - <<'EOF'
Add M0 Style Lab evidence frames at the high and low tiers

Four presets at the high tier on the development laptop and the same four
from the low-tier browser test, with the hero frame time recorded here:
<paste window.__P99__.frameMs() and the GPU string>.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git push
gh run watch --exit-status $(gh run list --workflow pages.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

Then open `https://majieddd.github.io/99-planets-to-defend-v4/labs/style.html` in the built-in browser and confirm the scene renders with assets and no console errors.

- [ ] **Step 5: Hold the style gate with the owner**

Send the owner the live link and the eight evidence frames (use SendUserFile for the frames). Ask them to tune the dials in the lab, press "Copy dials link" and send the link back, or to approve the defaults as they are. Do not continue past this step without their answer.

- [ ] **Step 6: Lock the approved values**

Decode the owner's link (`decodeDials` on its `dials` parameter) and write the result into `DEFAULT_DIALS` in `src/render/defaults.ts`, with this comment above it:

```ts
// Painted-Anime-Inkline 4.0: approved by the owner at the M0 style gate on <date>, from <link>.
```

Update `docs/blueprint.md`:
- Numbers, Render defaults: replace each Start value with the locked value and set its rationale to `owner-approved at the M0 gate, <date>`.
- Decided: change the approach row to `| Approach A: painted assets, shader lighting, two-pass ink | in game | Style Lab live; docs/evidence/m0/style-hero-high.png; locked dials in src/render/defaults.ts |`.
- Decided: add `| Painted-Anime-Inkline 4.0 render defaults locked | in game | owner approval <date>; docs/evidence/m0 |`.
- Task list: tick the Renderer v1, Style Lab and owner style gate lines.
- Where we are: record M0 as complete and name M1 (commander feel) and M2 (planets and the headless end-to-end playable) as next.

- [ ] **Step 7: Verify and commit**

Run: `npm run check && npm test && npm run e2e`
Expected: all green, including the audit on the locked defaults.

```bash
git add src/render/defaults.ts docs/blueprint.md
git commit -F - <<'EOF'
Lock Painted-Anime-Inkline 4.0 at the M0 style gate

The owner's approved dial values replace the starting defaults; the colour
audit still passes the hero frame at the locked values and still rejects its
hue-rotated copy. The blueprint records the approval, the evidence frames and
the locked numbers, and marks M0 complete.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git push
```

---

## Self-review

- **Spec coverage:** the blueprint's frame steps 1 to 6 map to Tasks 4 (painted lighting), 3 (hull ink),
  5 (edge ink, fog, bloom, grade, finish), 6 (sky); the ink rules (in the materials, distance fade, no ink
  across flat lit ground through normal thresholds and fade, object-space strokes) are in Tasks 3 to 5;
  quality tiers are Task 3; the Style Lab with dials, reference board and colour audit plus mutation proof
  is Tasks 2 and 9; the style gate is Task 11. The ink-sketch cutscene mode is deferred to M9 as the
  blueprint's build order places it.
- **Placeholders:** none.
- **Consistency:** `createPaintUniforms(theme, dials, brush)`, `createPaintedMaterial(shared, options)`,
  `createInkUniforms(dials)`, `createHullMaterial(uniforms)`, `attachHull(mesh, material, layer)`,
  `paintAndInk(root, ctx, blend)`, `loadAsset(url, ctx, blend)`, `createStylePatch(theme, paint, segments)`,
  `createPaintedSky(theme, brush, sunDir)`, `createPipeline(options)` and `buildStyleScene(patch, assets,
  ctx, scatterScale)` are used with the same signatures everywhere; `window.__P99__` fields (`ready`,
  `page`, `audit`, `preset`, `frameMs`, `assets`, `tier`) match between `main.ts` and the tests.
