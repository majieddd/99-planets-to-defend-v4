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
  uShadowLift: IUniform<number>;
  uShadowLiftColor: IUniform<Color>;
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
  uPropBrush: IUniform<number>;
  uSoilBreakup: IUniform<number>;
  uLitSaturation: IUniform<number>;
  uActorFill: IUniform<number>;
  uStandardBlendScale: IUniform<number>;
}

/**
 * Per-material standard blends are authored against Bulwark's character blend of 0.35, and the standardBlend dial
 * rescales them all, so the dial always equals the commander's blend and props and creatures follow in proportion
 * (terrain at 0 stays pure cel). Without this scale the dial goes unread and its Style Lab slider does nothing. The actor
 * fill is weighted by the same ratio, so a character takes all of it and a 0.1 structure 0.29.
 */
export const AUTHORED_CHARACTER_BLEND = 0.35;

/**
 * The shadow lift's colour: the theme's shadow grade colour at unit luminance, so the shadowLift dial reads as a fraction
 * of full sun in any theme, and the grade, which tones darks with that same colour, deepens it into a coloured dark.
 */
export function shadowLiftColor(theme: Theme): Color {
  const color = new Color(theme.grade.shadows);
  const luma = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  return luma > 0 ? color.multiplyScalar(1 / luma) : new Color(1, 1, 1);
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
    uShadowLift: { value: dials.shadowLift },
    uShadowLiftColor: { value: shadowLiftColor(theme) },
    uAmbientSky: { value: new Color(theme.ambient.sky) },
    uAmbientGround: { value: new Color(theme.ambient.ground) },
    uAmbientStrength: { value: dials.ambientStrength },
    uUp: { value: new Vector3(0, 1, 0) },
    // The rim is sunlight at a grazing angle, so it takes the sun colour dial, which defaults to the theme's sun.
    uRimColor: { value: new Color(dials.sunColor) },
    uRimStrength: { value: dials.rimStrength },
    uRimPower: { value: dials.rimPower },
    uPaintStrength: { value: dials.paintStrength },
    uSaturation: { value: dials.saturation },
    uTerrainBrush: { value: dials.terrainBrush },
    uPropBrush: { value: dials.propBrush },
    uSoilBreakup: { value: dials.soilBreakup },
    uLitSaturation: { value: dials.litSaturation },
    uActorFill: { value: dials.actorFill },
    uStandardBlendScale: { value: dials.standardBlend / AUTHORED_CHARACTER_BLEND },
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
  u.uShadowLift.value = dials.shadowLift;
  u.uShadowLiftColor.value.copy(shadowLiftColor(theme));
  u.uAmbientSky.value.set(theme.ambient.sky);
  u.uAmbientGround.value.set(theme.ambient.ground);
  u.uAmbientStrength.value = dials.ambientStrength;
  u.uRimColor.value.set(dials.sunColor);
  u.uRimStrength.value = dials.rimStrength;
  u.uRimPower.value = dials.rimPower;
  u.uPaintStrength.value = dials.paintStrength;
  u.uSaturation.value = dials.saturation;
  u.uTerrainBrush.value = dials.terrainBrush;
  u.uPropBrush.value = dials.propBrush;
  u.uSoilBreakup.value = dials.soilBreakup;
  u.uLitSaturation.value = dials.litSaturation;
  u.uActorFill.value = dials.actorFill;
  u.uStandardBlendScale.value = dials.standardBlend / AUTHORED_CHARACTER_BLEND;
}

/**
 * The emissive key rides in the output alpha as key / EMISSIVE_KEY_RANGE, where the key is the brightest channel of
 * the surface's emissive light before the cap below (0 for anything that does not emit). The key stays uncapped so the
 * bloomThreshold dial keeps its whole range. postprocessing's EffectPass clamps alpha to [0, 1] at the end of every
 * pass (effect.frag), so a raw HDR key would reach the bloom as at most 1, under the default threshold plus its
 * smoothing, and nothing would glow. 4 holds every threshold the dial allows (up to 3, plus 0.25 of smoothing) and M0c's
 * energy, which is authored at emissive strength 4.
 */
export const EMISSIVE_KEY_RANGE = 4;

/**
 * The brightest channel an emissive surface may add to its lit colour, chosen on the hero frame. AgX walks bright energy
 * toward white: uncapped, the stand-in heart (the palette's pale core at the placeholders' intensity 3) left the tone
 * mapper at (238, 216, 184), a saturation of 0.23. Scaling all three channels by one factor keeps the hue. With the
 * heart's amber-gold glow the crystal's median saturation measured 0.44 at a cap of 1.5, 0.47 at 1.25 and 0.51 at 1.0.
 * 1.25 is the brightest cap that clears 0.45, and there the magenta nest and the cyan rails keep their hues (330 and 170
 * degrees, from 337 and 176 uncapped).
 */
export const EMISSIVE_PEAK = 1.25;

/**
 * How far the brush sample moves the soil edge's threshold, in soil weight, and the threshold's half-width. The brush
 * atlas spans about 0.29 to 0.71 between its 5th and 95th percentiles, so a gain of 2.2 spreads the threshold over 0.04
 * to 0.96 of the weight (the shader clamps it to 0.07 to 0.93): soil strokes reach across the whole of the old soft
 * band and meadow strokes into the soil, where a gain of 1 would have jittered the edge by a fifth of the band. The
 * half-width of 0.06 is about 10 cm of ground on the ring's 0.8 to 1 m ramps, a crisp stroke edge at hero distance that
 * still anti-aliases from the strategic camera.
 */
export const SOIL_EDGE_GAIN = 2.2;
export const SOIL_EDGE_SOFTNESS = 0.06;

/**
 * The widest the terrain's brush-broken terminator may spread, in brush tiles to each side of the true terminator. The
 * brush can flip a pixel wherever ndl is smaller than the terminator noise, and under a low key that band follows how
 * slowly ndl changes: across the 160 m planet's far side it changes by about 1/160 per metre, so under preset B's 15
 * degree key the band ran tens of metres wide and the brush atlas, repeating every tile, printed a lattice of dark
 * strokes over the lit meadow (the crosshatch on the strategic camera's right half: 127 dark flecks per thousand ground
 * pixels by the limb, 80 with the noise off). Capping the noise at the ground's own rate of change of ndl times this
 * width keeps a relief terminator broken over a tile to each side while a gently curved field keeps a clean edge (84
 * flecks per thousand; at an 8 degree key, 197 before and 71 after). Characters, towers and props are not capped: their
 * forms turn fast enough.
 */
export const TERMINATOR_BAND_TILES = 1;

/**
 * The gentlest curve, as a radius in metres, over which the terrain's band edges keep the bandSoftness dial's full ramp.
 * The dial is a width in ndl, so its ground width follows how slowly ndl changes: on the planet's own curve, about 1/160
 * per metre, preset B2's 0.03 spread each edge over nearly 10 m of ground, and the strategic camera's limb showed soft
 * airbrushed blobs, a 55 px luma ramp where a cast-shadow edge in the same frame took 10 px. On ground curving more
 * gently than this radius the softness is scaled down by the ground's rate of change of ndl times it, so an edge's ramp
 * spans at most the ground it would on a curve of this radius (0.75 m to each side at a 0.03 ndl half-width), and the dial
 * still widens or narrows it. 25 m is about the radius of the patch's broad relief (a 50 m wavelength, 2.5 m high), so
 * a terminator on relief keeps the ramp it had; on the planet's curve B2's softness acts like 0.005, the value that turned
 * the reviewer's frames crisp and brush-broken. Under B2 the band terminator's ramp by the limb (90th percentile, along
 * the luma gradient) fell from 31 to 15 px at a 15 degree key and from 35 to 19 px at 8.
 */
export const BAND_EDGE_RADIUS = 25;

/** The standard blend a painted material gets when its creator names none: a prop's. */
export const DEFAULT_STANDARD_BLEND = 0.1;

/**
 * Whether a material is an actor's, which takes the actorFill dial. The test is the authored standard blend, decided once
 * at creation (the shader branch is a define), so it needs nothing from the loader: every asset already passes its blend.
 */
export function isActorBlend(standardBlend: number, terrain: boolean): boolean {
  return !terrain && standardBlend > 0;
}

/** GLSL ES 3.0 has no implicit int to float conversion, so a whole number must still reach the shader as 4.0. */
export function glslFloat(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

export interface PaintedOptions {
  map?: Texture | null;
  emissiveMap?: Texture | null;
  emissiveColor?: Color;
  emissiveIntensity?: number;
  baseColor?: Color;
  /** Terrain paints its brush in world space and scales it with the terrain brush dial. */
  terrain?: boolean;
  /**
   * The soil the geometry's soilWeight attribute mixes into its vertex colour. The mix happens here rather than in the
   * vertex colour so the soilBreakup dial can break the soil's edge into the brush strokes.
   */
  soilColor?: Color;
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
#ifdef PAINT_SOIL
  attribute float soilWeight;
  varying float vSoil;
#endif

void main() {
  vUv = uv;
  #ifdef USE_COLOR
    vColor = color.rgb;
  #else
    vColor = vec3(1.0);
  #endif
  #ifdef PAINT_SOIL
    vSoil = soilWeight;
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
uniform float uShadowLift;
uniform vec3 uShadowLiftColor;
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
uniform float uPropBrush;
uniform float uLitSaturation;
uniform float uActorFill;
uniform float uStandardBlendScale;
#ifdef PAINT_SOIL
  uniform vec3 uSoilColor;
  uniform float uSoilBreakup;
  varying float vSoil;
#endif

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
  #ifdef PAINT_SOIL
    // Thresholded against the brush sample, the soil's edge breaks into the terrain's own strokes, darker strokes
    // turning to soil first; at a breakup of 0 it is the smooth vertex-colour blend it has always been. The clamp keeps
    // the threshold's ramp inside (0, 1), so weight 0 stays meadow and weight 1 stays soil.
    float soilEdge = clamp(0.5 + (brush - 0.5) * SOIL_EDGE_GAIN, SOIL_EDGE_SOFTNESS + 0.01, 0.99 - SOIL_EDGE_SOFTNESS);
    float soil = mix(vSoil, smoothstep(soilEdge - SOIL_EDGE_SOFTNESS, soilEdge + SOIL_EDGE_SOFTNESS, vSoil), uSoilBreakup);
    albedo = mix(albedo, uBaseColor * uSoilColor, soil);
  #endif
  #ifdef PAINT_TERRAIN
    albedo *= 1.0 + (brush - 0.5) * uTerrainBrush;
  #else
    // The baked paint is broad at hero distance (Bulwark's plates read smooth), so the brush atlas strokes it too, in
    // object space so the strokes ride the body; the terminator had been the only place the brush reached a prop.
    albedo *= 1.0 + (brush - 0.5) * uPropBrush;
  #endif
  if (alpha < uAlphaTest) discard;
  albedo = withSaturation(albedo, uSaturation);

  #ifdef USE_PAINT_EMISSIVE
    vec3 emissive = texture2D(uEmissiveMap, vUv).rgb * uEmissiveColor * uEmissiveIntensity;
  #else
    vec3 emissive = uEmissiveColor * uEmissiveIntensity;
  #endif
  // Decided per pixel, because a real asset's gunmetal and its cyan channels share one mesh and one atlas.
  float emissiveKey = max(emissive.r, max(emissive.g, emissive.b));
  // Glow is information (Pillar 5), so the look dials that re-light and restrain lit colour (actor fill, shadow lift,
  // lit saturation) leave emitting pixels as authored, fading in over the key's first unit. Restrained along with the
  // stone, the heart crystal's lit gold took its glowing pixels' saturation from 0.58 to 0.49 at the hero camera; spared,
  // it keeps 0.57.
  float spare = 1.0 - clamp(emissiveKey, 0.0, 1.0);

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
    // three passes light colour times intensity and its own Lambert divides by PI (undivided, lit albedo ran about
    // PI too bright and bloomed like energy). The Verdant sun's 3.2 is calibrated so a white surface facing it lands
    // near 1.0: lit albedo stays under the bloom threshold (only energy and hazards bloom), and shadowDepth,
    // ambientStrength and rimStrength read as fractions of full sun.
    sunColor = directionalLights[0].color * RECIPROCAL_PI;
  #endif
  float ndl = dot(N, L);
  float shadow = getShadowMask();

  // The terminator breaks up like a brush stroke, and a cast shadow drops the surface into the shadow band.
  float breakup = uTerminatorNoise;
  #ifdef PAINT_TERRAIN
    // On the ground the noise is capped by how fast ndl changes per metre, so the broken band stays at most
    // TERMINATOR_BAND_TILES brush tiles to each side of the terminator (see the constant for the crosshatch it ends). The
    // rate is read along both screen axes and the larger kept: at a grazing view one axis stretches over metres. The cap
    // fades out by twice the noise, because the noise can flip light into shadow only where |ndl| is under it, so it
    // reaches only the terminator while 2 * terminatorNoise stays under 1 / (bands - 1), the ndl of the next band edge:
    // at any noise with 2 bands, and up to 0.25 with 3. Past that it caps the mid-to-lit edge too, which is where the
    // default's three-band meadow under its 35 degree key lies, and capped there it lost its broken strokes.
    // The terrain never discards (it has no alpha-tested map), so every pixel of a quad reaches these derivatives; if it
    // ever gains an alpha-tested map, derivatives taken after a non-uniform discard become undefined.
    float ndlRate = max(
      abs(dFdx(ndl)) / max(length(dFdx(vBrushPos)), 1e-5),
      abs(dFdy(ndl)) / max(length(dFdy(vBrushPos)), 1e-5)
    );
    // The floor keeps smoothstep's edges apart at a noise of 0, where GLSL leaves equal edges undefined.
    float reach = max(uTerminatorNoise, 1e-4);
    float nearTerminator = 1.0 - smoothstep(reach, 2.0 * reach, abs(ndl));
    breakup = mix(breakup, min(breakup, ndlRate * TERMINATOR_BAND_TILES / uBrushScale), nearTerminator);
  #endif
  float t = ndl + (brush - 0.5) * 2.0 * breakup;
  t = min(t, shadow * 2.0 - 1.0);
  // Exactly uBands light levels with the first step on the terminator, so the whole form-shadow side takes the
  // shadow tint. The bands dial starts at 2, so uBands - 1.0 is never 0.
  float x = clamp(t * (uBands - 1.0) + 0.5, 0.0, uBands - 1.0);
  float softness = uBandSoftness;
  #ifdef PAINT_TERRAIN
    // On ground gentler than BAND_EDGE_RADIUS the softness shrinks with the ground's rate of change of ndl, so an edge
    // across the planet's curve is as crisp as one across relief (see the constant for the airbrushed limb it ends). It
    // never drops under half of x's change across a pixel, so every edge still anti-aliases over about a pixel, and
    // never rises over the dial: across a cast shadow's edge x jumps, and there the dial's own softness stands as before.
    // The last floor keeps smoothstep's edges apart where x does not change at all.
    softness = min(uBandSoftness, max(uBandSoftness * min(1.0, ndlRate * BAND_EDGE_RADIUS), 0.5 * fwidth(x)));
    softness = max(softness, 1e-4);
  #endif
  float stepped = (floor(x) + smoothstep(0.5 - softness, 0.5 + softness, fract(x))) / (uBands - 1.0);
  float lambert = max(ndl, 0.0) * shadow;
  // The standardBlend dial rescales the authored blend; the clamp stops mix extrapolating past standard lighting.
  float lit = clamp(mix(stepped, lambert, clamp(uStandardBlend * uStandardBlendScale, 0.0, 1.0)), 0.0, 1.0);

  // Shadows take the theme's colour instead of going grey.
  vec3 direct = mix(uShadowTint * uShadowDepth, sunColor, lit);
  vec3 hemisphere = mix(uAmbientGround, uAmbientSky, dot(worldN, uUp) * 0.5 + 0.5);
  vec3 ambient = hemisphere * uAmbientStrength;
  vec3 color = albedo * (direct + ambient);

  // The fill and the lift below give way to the key by the smooth key, (1 - lambert), not by the banded (1 - lit). lit
  // jumps at the terminator and lambert does not, so a term weighted by (1 - lit) stepped down exactly where the key
  // stepped up: with a standard blend the lit side just past the terminator kept only part of the fill, and the
  // terminator's step shrank as the fill grew. Camera-facing white under the default key, 0.05 of ndl to each side, it
  // measured 0.217 linear luminance at a fill of 0, 0.059 at 1.2, 0.006 at 1.6 and -0.046 at 2, and the lift inverted
  // it on dark albedo (a lift of 0.06 on an albedo of 0.04, 0.1 on 0.1). The smooth weight is continuous across the
  // terminator and the same everywhere on the shadow side, form or cast, so the step is the key's (0.178 at a fill of 2).
  // A cast shadow's edge still drops the smooth key, so where the fill outshines the key a shadow on a lit face reads
  // brighter than the light beside it: above a fill of 1.18 under the default key, never within the range under B3's.
  #ifdef PAINT_ACTOR
    // Seen against the light, an actor's whole visible side is in the shadow band, and preset B's hero camera showed
    // Bulwark's back at a median luma of 14 against 72 to 81 of ground (every blow must read, Pillar 4). This fill comes
    // from the camera's side, so it reaches whatever the camera sees whatever the key does; it takes the sky and
    // ground-bounce colour of the ambient hemisphere, fading out as the key lights the surface, so the lit side and the
    // hard terminator stay the key's; and it falls off with dot(N, V), so the shadow side keeps its roundness. It follows
    // the authored standard blend, full on characters (Bulwark's 0.35) and 0.29 of it on the towers, heart and nest at
    // 0.1: at full strength the sky light greyed the heart's stone around its warm crystal (saturation 0.40 without the
    // fill, 0.30 with it and 0.36 weighted, at the hero camera), and the towers read at 0.59 of their ground with no fill.
    float actorWeight = clamp(uStandardBlend / AUTHORED_CHARACTER_BLEND, 0.0, 1.0);
    color += albedo * hemisphere * uActorFill * actorWeight * clamp(dot(N, V), 0.0, 1.0) * (1.0 - lambert) * spare;
  #endif

  // A coloured lift added where the key does not reach, fading out as the smooth key lights the surface, whatever the
  // albedo; it adds light rather than setting a floor, so a shadow keeps the depth order of its albedos. Under a low key
  // the smooth key is small on lit ground too (0.26 on level ground at 15 degrees), so there the lift also greys the lit
  // meadow; preset B3 leaves it at 0 and deepens its shadow depth instead. The grade's contrast pivots at mid grey, and
  // preset B's 1.35 crushed every shadow toward navy-black. It lives here rather than in the grade because the grade
  // cannot tell ink from a dark it should lift once fog has touched the ink: keyed on the ink's luminance, a grade lift
  // raised the hull ink beside Bulwark from 5 to 27 luma at the hero camera. The ink is never drawn with this material,
  // so it stays black.
  color += uShadowLiftColor * uShadowLift * (1.0 - lambert) * spare;

  // The rim separates characters and props from the ground; on terrain, at grazing angles, it lifts the whole field.
  #ifndef PAINT_TERRAIN
    float facing = 1.0 - clamp(dot(N, V), 0.0, 1.0);
    color += pow(facing, uRimPower) * uRimStrength * smoothstep(-0.1, 0.4, ndl) * shadow * uRimColor * sunColor;
  #endif

  // The saturation dial works on albedo, so the key's own tint still raised the meadow's chroma (preset B's amber key
  // took the ground's HSV saturation from 0.56 to 0.66). This restrains the lit colour itself, before the emitters add
  // their light and away from emitting pixels, so the energy, the heart and the bloom that reads them keep their full
  // colour. The grade would have greyed the halo too: it runs after the bloom. At 1 it is skipped rather than computed,
  // so the default frame stays the one it was bit for bit (mix(luma, c, 1.0) need not return c exactly).
  float restraint = mix(1.0, uLitSaturation, spare);
  if (restraint != 1.0) color = withSaturation(color, restraint);

  // One factor on all three channels stops the peak at EMISSIVE_PEAK and keeps the hue (see EMISSIVE_PEAK).
  color += emissive * min(1.0, EMISSIVE_PEAK / max(emissiveKey, 1e-4));
  // The bloom keys on this alpha, not on luminance. Keyed on Rec.709 luminance, magenta (about 0.83 at intensity 3)
  // never glowed while cyan (about 2.2) did, and a lower threshold would have bloomed lit white (up to 1.08 with rim).
  gl_FragColor = vec4(color, emissiveKey / EMISSIVE_KEY_RANGE);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Cloning (ShaderMaterial.clone) clones the uniforms, detaching the copy from the shared dials; call this instead. */
export function createPaintedMaterial(shared: PaintUniforms, options: PaintedOptions): ShaderMaterial {
  const defines: Record<string, string> = {
    EMISSIVE_PEAK: glslFloat(EMISSIVE_PEAK),
    EMISSIVE_KEY_RANGE: glslFloat(EMISSIVE_KEY_RANGE),
  };
  if (options.map) defines['USE_PAINT_MAP'] = '';
  if (options.emissiveMap) defines['USE_PAINT_EMISSIVE'] = '';
  if (options.terrain) {
    defines['PAINT_TERRAIN'] = '';
    defines['TERMINATOR_BAND_TILES'] = glslFloat(TERMINATOR_BAND_TILES);
    defines['BAND_EDGE_RADIUS'] = glslFloat(BAND_EDGE_RADIUS);
  }
  const standardBlend = options.standardBlend ?? DEFAULT_STANDARD_BLEND;
  // Actors are the materials authored with some standard lighting: Bulwark, the Husk, the towers, the heart and the nest
  // (and their placeholders, through paintAndInk). The terrain and the Verdant kit are pure cel at 0 and take no fill.
  if (isActorBlend(standardBlend, options.terrain === true)) {
    defines['PAINT_ACTOR'] = '';
    defines['AUTHORED_CHARACTER_BLEND'] = glslFloat(AUTHORED_CHARACTER_BLEND);
  }
  // Only a material given a soil colour declares the soilWeight attribute. A mesh without that attribute would read
  // whatever constant WebGL last left at its location (three sets such constants for the colour attribute), which
  // could paint a whole planet in soil.
  if (options.soilColor) {
    defines['PAINT_SOIL'] = '';
    defines['SOIL_EDGE_GAIN'] = glslFloat(SOIL_EDGE_GAIN);
    defines['SOIL_EDGE_SOFTNESS'] = glslFloat(SOIL_EDGE_SOFTNESS);
  }
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
      // PAINT_ACTOR above was decided from this blend when the material was created, so changing one material's blend
      // later (a blend of 0 made positive, or the reverse) must rebuild the material, or the fill stays as it was.
      uStandardBlend: { value: standardBlend },
      uAlphaTest: { value: options.alphaTest ?? 0 },
      uSoilColor: { value: options.soilColor ?? new Color(0, 0, 0) },
    },
    vertexShader,
    fragmentShader,
  });
  material.userData['painted'] = true;
  return material;
}
