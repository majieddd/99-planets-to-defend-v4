import { DEFAULT_DIALS, type RenderDials } from './defaults';

/**
 * Golden-hour preset B3, as the dials that differ from DEFAULT_DIALS, which is the form a Style Lab dials link carries,
 * except that grain is named at 0 although 0 is now its default: B3 was measured with grain on, and naming it keeps a B3
 * built from these values off even if the default changes again. docs/blueprint.md carries the same JSON in its Render
 * defaults row "Golden-hour preset B3", and tests/unit/render/presets.test.ts holds the two equal, so neither can drift.
 * A raking 15 degree amber key, two bands with a brush-broken terminator, long teal shadows, the soil's edge broken into
 * strokes and heavier ink: the look the owner praised at the style gate, and the one the Asset World shows by default.
 */
export const GOLDEN_HOUR_B3_CHANGES: Readonly<Partial<RenderDials>> = {
  bands: 2,
  bandSoftness: 0.03,
  terminatorNoise: 0.3,
  paintStrength: 1,
  saturation: 1.12,
  shadowDepth: 0.62,
  shadowTint: '#1b7078',
  rimStrength: 0.6,
  standardBlend: 0.45,
  ambientStrength: 0.22,
  brushScale: 0.7,
  terrainBrush: 1.2,
  propBrush: 1.3,
  soilBreakup: 1,
  litSaturation: 0.87,
  actorFill: 1.4,
  inkWidthPx: 3.2,
  edgeStrength: 1,
  edgeLineWidth: 1.4,
  fogDensity: 0.02,
  fogStart: 0,
  fogHeightFalloff: 0.3,
  sunElevation: 15,
  sunColor: '#ffc05c',
  sunIntensity: 6.6,
  exposure: 0.44,
  contrast: 1.35,
  bloomIntensity: 1.2,
  heartHalo: 11,
  grain: 0,
  vignette: 0.55,
};

/** Preset B3 as a whole set of dials: every dial it does not name keeps its start, as a dials link's decode gives it. */
export const GOLDEN_HOUR_B3: Readonly<RenderDials> = { ...DEFAULT_DIALS, ...GOLDEN_HOUR_B3_CHANGES };
