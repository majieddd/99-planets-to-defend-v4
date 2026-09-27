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
  shadowLift: number;
  rimStrength: number;
  rimPower: number;
  standardBlend: number;
  ambientStrength: number;
  brushScale: number;
  terrainBrush: number;
  propBrush: number;
  soilBreakup: number;
  litSaturation: number;
  actorFill: number;
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
  fogHeightFalloff: number;
  sunElevation: number;
  sunColor: string;
  sunIntensity: number;
  exposure: number;
  contrast: number;
  bloomIntensity: number;
  heartHalo: number;
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
  // A floor under every shadow, in the theme's shadow grade colour, as a fraction of full sun on white: the darkest note
  // is a coloured dark, never black. At 0 the shadows are where the shadow depth and the grade's contrast leave them.
  shadowLift: 0,
  rimStrength: 0.35,
  rimPower: 3,
  standardBlend: 0.35,
  ambientStrength: 0.45,
  brushScale: 0.35,
  terrainBrush: 0.5,
  // 0 leaves everything but the terrain with its baked paint alone, the look before the dial existed; above 0 the brush
  // atlas strokes the albedo of characters, towers and props as terrainBrush strokes the ground.
  propBrush: 0,
  // 0 keeps the soil ring's smooth vertex-colour edge; 1 breaks it into the terrain's brush strokes.
  soilBreakup: 0,
  // The saturation of lit colour, after the key has tinted it and before any emitter adds its light. At 1 it changes
  // nothing; lower, it restrains the chroma a warm key adds to the meadow while the energy keeps its full colour.
  litSaturation: 1,
  // A fill from the camera's side on the unlit side of actors (materials with a standard blend above 0), so a backlit
  // character keeps its form instead of reading as a black cut-out. At 0 it adds nothing.
  actorFill: 0,
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
  // Per metre of altitude above the planet. At 0 every metre of the ray counts alike, which is the distance fog the
  // renderer drew before height fog existed, so the default look is unchanged.
  fogHeightFalloff: 0,
  // The sun defaults to the Verdant theme's light (themes.ts), so a preset can lower and warm the key without
  // editing the theme. The theme keeps the azimuth.
  sunElevation: 35,
  sunColor: '#ffd29a',
  sunIntensity: 3.2,
  exposure: 0.77,
  contrast: 1.05,
  // Halo strengths, in units of an emitter pixel's hue at full brightness (post/pipeline.ts). 0.8 gives the rails and
  // the nest the glow they had when the bloom took 0.6 of the capped surface colour (whose peak is about 1.3); the
  // heart's 4 is what makes its halo read at hero distance.
  bloomIntensity: 0.8,
  heartHalo: 4,
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
  // At the default exposure and contrast, 0.15 of full sun lifts a black surface in shadow to about 0.1 in linear light
  // before tone mapping, a mid-dark; more would flatten the shadows into haze.
  shadowLift: [0, 0.15, 0.001],
  rimStrength: [0, 1.5, 0.01],
  rimPower: [1, 8, 0.1],
  standardBlend: [0, 1, 0.01],
  ambientStrength: [0, 1.5, 0.01],
  brushScale: [0.05, 2, 0.01],
  terrainBrush: [0, 1.5, 0.01],
  propBrush: [0, 1.5, 0.01],
  soilBreakup: [0, 1, 0.01],
  // Under preset B, 0.65 already took the meadow's HSV saturation from 0.63 to 0.42, a grey-green, so 0.4 is the floor;
  // above 1 it only adds chroma the albedo saturation dial already gives.
  litSaturation: [0.4, 1.5, 0.01],
  // 2 gives a shadow side that faces the camera twice the sky light the ambient term gives at full strength.
  actorFill: [0, 2, 0.01],
  inkWidthPx: [0, 6, 0.1],
  edgeStrength: [0, 1, 0.01],
  edgeLineWidth: [0.5, 3, 0.05],
  depthThreshold: [0.005, 0.2, 0.005],
  normalThreshold: [0.05, 1, 0.01],
  // The fade ranges overlap on purpose so each slider moves freely. The ink edge effect puts the pair in strict
  // order before the shader sees it, because GLSL smoothstep is undefined when its edges are equal or inverted.
  edgeFadeNear: [5, 300, 1],
  edgeFadeFar: [10, 600, 1],
  // Height fog thins with altitude, so a ground density visible at the low cameras' 20 to 35 m horizon needs more than
  // the 0.03 that capped the distance fog; old links stay inside the wider range.
  fogDensity: [0, 0.08, 0.0005],
  fogStart: [0, 200, 1],
  // 0.5 is a 2 m scale height, fog that lies on the ground; 0.02 is 50 m, close to the uniform fog at 0.
  fogHeightFalloff: [0, 0.5, 0.005],
  // At 3 degrees the key already grazes the level clearing (a 6 m tree throws a 114 m shadow), and on a 160 m planet
  // the patch's far side has turned away from it (at 8 degrees the terminator already crosses the strategic view).
  // 85 is a noon sun.
  sunElevation: [3, 85, 0.5],
  sunIntensity: [0.5, 8, 0.05],
  exposure: [0.2, 3, 0.01],
  contrast: [0.7, 1.5, 0.01],
  bloomIntensity: [0, 3, 0.01],
  heartHalo: [0, 8, 0.05],
  bloomThreshold: [0.2, 3, 0.01],
  grain: [0, 0.2, 0.005],
  vignette: [0, 1, 0.01],
};

export const COLOR_DIALS = ['shadowTint', 'inkColor', 'sunColor'] as const;
