/**
 * Every dial the Style Lab exposes. DEFAULT_DIALS are the Painted-Anime-Inkline 4.0 values the owner locked at the M0
 * style gate, each with its row in docs/blueprint.md (Numbers, Render defaults), which also keeps the renderer v1 start
 * each dial replaced.
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

// Painted-Anime-Inkline 4.0: approved by the owner at the M0 style gate on 2026-09-28, from the golden-hour preset B3's
// live link with three adjustments (edgeStrength 0.33, edgeFadeFar 65, litSaturation 1.09).
export const DEFAULT_DIALS: RenderDials = {
  bands: 2,
  bandSoftness: 0.03,
  terminatorNoise: 0.3,
  paintStrength: 1,
  saturation: 1.12,
  shadowDepth: 0.62,
  shadowTint: '#1b7078',
  // Light added under every shadow, in the theme's shadow grade colour, as a fraction of full sun on white, so the darkest
  // note is a coloured dark, never black. It adds rather than floors, so darker albedo stays darker in shadow. At 0 the
  // shadows are where the shadow depth and the grade's contrast leave them.
  shadowLift: 0,
  rimStrength: 0.6,
  rimPower: 3,
  standardBlend: 0.45,
  ambientStrength: 0.22,
  brushScale: 0.7,
  terrainBrush: 1.2,
  // The brush atlas strokes the albedo of characters, towers and props as terrainBrush strokes the ground, because their
  // baked paint read smooth on Bulwark's broad plates at hero distance. 0 leaves them with their baked paint alone.
  propBrush: 1.3,
  // 1 breaks the soil ring's edge into the terrain's brush strokes; 0 keeps its smooth vertex-colour edge.
  soilBreakup: 1,
  // The saturation of lit colour, after the key has tinted it and before any emitter adds its light; emitting pixels are
  // spared, so the energy keeps its authored colour. At 1 it changes nothing and below 1 it restrains the chroma a warm
  // key adds to the meadow. The owner's 1.09 pushes lit colour 9 percent further from grey instead (B3 had 0.87), and
  // painted.ts's withSaturation clamps each channel at 0, so a channel under about 8 percent of its pixel's luma clips
  // to 0 rather than going negative: 10 to 13 percent of the painted pixels at the four preset cameras.
  litSaturation: 1.09,
  // A fill from the camera's side on actors (materials with a standard blend above 0), fading out as the key lights the
  // surface, so a backlit character keeps its form instead of reading as a black cut-out. Under the locked 15 degree key
  // the hero camera sees Bulwark backlit, and with no fill his body's median luma read 16.6, 0.20 of his ground's.
  actorFill: 1.4,
  inkWidthPx: 3.2,
  inkColor: '#0e0f14',
  edgeStrength: 0.33,
  edgeLineWidth: 1.4,
  depthThreshold: 0.03,
  normalThreshold: 0.35,
  // The edge pass's crease ink fades out between these two view depths, so past 65 m only its depth (silhouette) edges,
  // at 0.45 of their weight, and the hull ink remain. On the 160 m planet only the strategic camera sees terrain that far.
  edgeFadeNear: 60,
  edgeFadeFar: 65,
  fogDensity: 0.02,
  fogStart: 0,
  // Per metre of altitude above the planet, so the haze lies on the ground: at 0 every metre of the ray would count
  // alike, the distance fog the renderer drew before height fog existed.
  fogHeightFalloff: 0.3,
  // The locked sun is the golden-hour key the owner approved: a raking 15 degree amber light, lower, warmer and stronger
  // than the Verdant theme's own light (themes.ts: 35 degrees, #ffd29a, 3.2), which the theme keeps and these dials
  // override. The theme keeps the azimuth.
  sunElevation: 15,
  sunColor: '#ffc05c',
  sunIntensity: 6.6,
  exposure: 0.44,
  contrast: 1.35,
  // Halo strengths, in units of an emitter pixel's hue at full brightness (post/pipeline.ts). Renderer v1 started them
  // at 0.8 and 4; the locked 1.2 and 11 are preset B3's, and the heart's rows in the blueprint give the halo they add.
  bloomIntensity: 1.2,
  heartHalo: 11,
  bloomThreshold: 1.0,
  // Off at the owner's direction at the M0 style gate. The grain is hashed per screen pixel, so it read as noise laid
  // over the whole picture, not as paint: running, it re-seeds 24 times a second, a shimmer over every pixel; frozen or
  // under reduced motion, it holds one pattern pinned to the glass while the camera moves the world beneath it. The
  // paint's texture lives on the surfaces instead (the brush atlas and the broken terminator), which move with the
  // world. The dial keeps its range, so the owner can still turn the grain back on.
  grain: 0,
  vignette: 0.55,
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
  // At renderer v1's exposure of 0.77 and contrast of 1.05, 0.15 of full sun lifts a black surface in shadow to about
  // 0.1 in linear light before tone mapping, a mid-dark; more would flatten the shadows into haze. At the locked 0.44
  // and 1.35 the same lift reaches about 0.05: 0.066 after the exposure, and less after the steeper contrast.
  shadowLift: [0, 0.15, 0.001],
  rimStrength: [0, 1.5, 0.01],
  rimPower: [1, 8, 0.1],
  standardBlend: [0, 1, 0.01],
  ambientStrength: [0, 1.5, 0.01],
  brushScale: [0.05, 2, 0.01],
  terrainBrush: [0, 1.5, 0.01],
  propBrush: [0, 1.5, 0.01],
  soilBreakup: [0, 1, 0.01],
  // Under preset B, 0.65 already took the meadow's HSV saturation from 0.63 to 0.42, a grey-green, so 0.4 is the floor.
  // Above 1 it pushes lit colour further from grey, the key's tint included, which the albedo saturation dial, working
  // before the light, does not reach; the owner locked 1.09 there.
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
  // Preset B2 sat at the old top of 8, so the range reaches 12; every link made under 8 still opens the same look.
  heartHalo: [0, 12, 0.05],
  bloomThreshold: [0.2, 3, 0.01],
  grain: [0, 0.2, 0.005],
  vignette: [0, 1, 0.01],
};

export const COLOR_DIALS = ['shadowTint', 'inkColor', 'sunColor'] as const;
