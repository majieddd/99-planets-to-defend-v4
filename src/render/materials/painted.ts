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
  uStandardBlendScale: IUniform<number>;
}

/**
 * Per-material standard blends are authored against Bulwark's character blend of 0.35, and the standardBlend dial
 * rescales them all, so the dial always equals the commander's blend and props and creatures follow in proportion
 * (terrain at 0 stays pure cel). Without this scale the dial goes unread and its Style Lab slider does nothing.
 */
const AUTHORED_CHARACTER_BLEND = 0.35;

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
  u.uAmbientSky.value.set(theme.ambient.sky);
  u.uAmbientGround.value.set(theme.ambient.ground);
  u.uAmbientStrength.value = dials.ambientStrength;
  u.uRimColor.value.set(theme.sun.color);
  u.uRimStrength.value = dials.rimStrength;
  u.uRimPower.value = dials.rimPower;
  u.uPaintStrength.value = dials.paintStrength;
  u.uSaturation.value = dials.saturation;
  u.uTerrainBrush.value = dials.terrainBrush;
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

/** GLSL ES 3.0 has no implicit int to float conversion, so a whole number must still reach the shader as 4.0. */
function glslFloat(value: number): string {
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
uniform float uStandardBlendScale;

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
    // three passes light colour times intensity and its own Lambert divides by PI (undivided, lit albedo ran about
    // PI too bright and bloomed like energy). The Verdant sun's 3.2 is calibrated so a white surface facing it lands
    // near 1.0: lit albedo stays under the bloom threshold (only energy and hazards bloom), and shadowDepth,
    // ambientStrength and rimStrength read as fractions of full sun.
    sunColor = directionalLights[0].color * RECIPROCAL_PI;
  #endif
  float ndl = dot(N, L);
  float shadow = getShadowMask();

  // The terminator breaks up like a brush stroke, and a cast shadow drops the surface into the shadow band.
  float t = ndl + (brush - 0.5) * 2.0 * uTerminatorNoise;
  t = min(t, shadow * 2.0 - 1.0);
  // Exactly uBands light levels with the first step on the terminator, so the whole form-shadow side takes the
  // shadow tint. The bands dial starts at 2, so uBands - 1.0 is never 0.
  float x = clamp(t * (uBands - 1.0) + 0.5, 0.0, uBands - 1.0);
  float stepped = (floor(x) + smoothstep(0.5 - uBandSoftness, 0.5 + uBandSoftness, fract(x))) / (uBands - 1.0);
  float lambert = max(ndl, 0.0) * shadow;
  // The standardBlend dial rescales the authored blend; the clamp stops mix extrapolating past standard lighting.
  float lit = clamp(mix(stepped, lambert, clamp(uStandardBlend * uStandardBlendScale, 0.0, 1.0)), 0.0, 1.0);

  // Shadows take the theme's colour instead of going grey.
  vec3 direct = mix(uShadowTint * uShadowDepth, sunColor, lit);
  vec3 ambient = mix(uAmbientGround, uAmbientSky, dot(worldN, uUp) * 0.5 + 0.5) * uAmbientStrength;
  vec3 color = albedo * (direct + ambient);

  // The rim separates characters and props from the ground; on terrain, at grazing angles, it lifts the whole field.
  #ifndef PAINT_TERRAIN
    float facing = 1.0 - clamp(dot(N, V), 0.0, 1.0);
    color += pow(facing, uRimPower) * uRimStrength * smoothstep(-0.1, 0.4, ndl) * shadow * uRimColor * sunColor;
  #endif

  #ifdef USE_PAINT_EMISSIVE
    vec3 emissive = texture2D(uEmissiveMap, vUv).rgb * uEmissiveColor * uEmissiveIntensity;
  #else
    vec3 emissive = uEmissiveColor * uEmissiveIntensity;
  #endif
  // Decided per pixel, because a real asset's gunmetal and its cyan channels share one mesh and one atlas.
  float emissiveKey = max(emissive.r, max(emissive.g, emissive.b));
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
