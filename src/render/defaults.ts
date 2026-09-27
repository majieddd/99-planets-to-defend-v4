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
  // The fade ranges overlap on purpose so each slider moves freely. The ink edge effect puts the pair in strict
  // order before the shader sees it, because GLSL smoothstep is undefined when its edges are equal or inverted.
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
