import { AddEquation, CustomBlending, MaxEquation, OneFactor, type ShaderMaterial } from 'three';
import { EMISSIVE_KEY_RANGE, EMISSIVE_PEAK, glslFloat } from '../../render/materials/painted';

/**
 * Player energy drawn as light on its own, the sword trail and the hit sparks: cyan, Pillar 5's colour for what is
 * yours, the palette's player energy (blender/lib/palette.py PLAYER 'energy', #59f2ff) that Pip's channels glow in.
 */
export const PLAYER_ENERGY = '#59f2ff';

/**
 * Sets a material up to draw energy the way the renderer keys it (src/render/post/pipeline.ts, createPipeline): its
 * colour is added to the frame (one plus one), and its emissive key goes into alpha by the larger of the two, so the
 * bloom reads the key of the brightest energy at each pixel. Blended as a plain transparent surface, its opacity would
 * have been written into alpha as a key, which the pipeline's note warns of: a faint edge would bloom like energy and
 * the frame under a soft stroke would lose its own key. Tested against the scene's depth but writing none, so bodies in
 * front cover it. Energy goes in the page's energy scene on LAYERS.energy, which the pipeline draws over the inked,
 * fogged frame (src/render/post/energyPass.ts): drawn in the scene pass, its pixels kept the depth of what lay behind
 * it, so the ink pass drew the silhouettes behind it across it and the fog pass fogged it by the ground's distance.
 */
export function useEnergyBlending(material: ShaderMaterial): ShaderMaterial {
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.blending = CustomBlending;
  material.blendEquation = AddEquation;
  material.blendSrc = OneFactor;
  material.blendDst = OneFactor;
  material.blendEquationAlpha = MaxEquation;
  material.blendSrcAlpha = OneFactor;
  material.blendDstAlpha = OneFactor;
  material.toneMapped = false;
  return material;
}

/** The defines the energy output reads: the painted material's peak and key range, so energy here keys as it does there. */
export function energyDefines(): Record<string, string> {
  return { EMISSIVE_PEAK: glslFloat(EMISSIVE_PEAK), EMISSIVE_KEY_RANGE: glslFloat(EMISSIVE_KEY_RANGE) };
}

/**
 * The light a pixel of energy adds and its emissive key, as the painted material writes an emitter's
 * (src/render/materials/painted.ts): `hue` at unit brightness (its brightest channel 1) times the key, capped so its
 * brightest channel adds at most EMISSIVE_PEAK by one factor on all three channels, which keeps the hue under AgX; the
 * key rides in alpha as key / EMISSIVE_KEY_RANGE, which the bloom's mask and shield read.
 */
export const ENERGY_OUTPUT = /* glsl */ `
vec4 energyOut(vec3 hue, float key) {
  float k = max(key, 0.0);
  return vec4(hue * k * min(1.0, EMISSIVE_PEAK / max(k, 1e-4)), k / EMISSIVE_KEY_RANGE);
}
`;
