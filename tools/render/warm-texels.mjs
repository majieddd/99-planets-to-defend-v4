// Computes the lit emitter texels that tests/unit/render/bloom-warm.test.ts checks the bloom's warm test against, and
// prints the block that test pastes in as its generated data.
//
//   npx tsx tools/render/warm-texels.mjs
//   npx tsx tools/render/warm-texels.mjs --dials '{"sunColor":"#ffb468","sunIntensity":6.6}'
//
// It runs under tsx, as tools/bot does, because the lighting comes from the renderer's own TypeScript: DEFAULT_DIALS,
// the VERDANT theme, EMISSIVE_PEAK and the bloom's threshold ramp. The test pins what this read (the assets' SHA-256 and
// a copy of the inputs), so a palette, asset or lighting change fails there until this is run again. --dials lays other
// dial values over the defaults to explore (the art preset's margin in pipeline.ts came from it); its output is not for
// pasting, because the test's pinned inputs are the defaults'.
//
// The lighting is painted.ts's for an emitter pixel on the lit side, simplified: full sun (the top light band), the
// ambient hemisphere at HEMISPHERE_SKY_WEIGHT, the albedo texel under the emissive texel sampled nearest, without
// paintStrength's blend toward the texture's mip 6 and without fog. The look dials that spare emitters (actor fill,
// shadow lift, lit saturation) leave these texels alone, since every one has a key of at least 1.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Color, SRGBColorSpace } from 'three';
import { DEFAULT_DIALS } from '../../src/render/defaults.ts';
import { EMISSIVE_PEAK } from '../../src/render/materials/painted.ts';
import { BLOOM_SMOOTHING, WARM_BLUE_FULL, WARM_BLUE_NONE } from '../../src/render/post/pipeline.ts';
import { VERDANT } from '../../src/render/themes.ts';
import { isMain } from '../is-main.mjs';

/** The assets whose emitters the test samples, under public/assets. */
export const WARM_ASSETS = {
  heart: 'heart/worldheart.glb',
  nest: 'nests/nest.glb',
  bolt: 'towers/bolt_sentinel.glb',
  bulwark: 'commanders/bulwark.glb',
};

/**
 * Where the ambient hemisphere is read, from 0 (facing the ground) to 1 (facing the sky): 0.75 is a normal 60 degrees
 * from straight up, halfway between the crystal's sky-facing top and its sides.
 */
export const HEMISPHERE_SKY_WEIGHT = 0.75;

/** How far a silhouette pixel faces away from the camera, 1 - dot(N, V), for the rim cases. */
export const SILHOUETTE_FACING = 0.9;

/**
 * Everything this generator reads from the renderer, under the given dials. The test compares warmInputs() with the copy
 * it was generated from, so a change to any of these fails there.
 */
export function warmInputs(dials = DEFAULT_DIALS) {
  return {
    sunColor: dials.sunColor,
    sunIntensity: dials.sunIntensity,
    saturation: dials.saturation,
    ambientStrength: dials.ambientStrength,
    ambientSky: VERDANT.ambient.sky,
    ambientGround: VERDANT.ambient.ground,
    rimStrength: dials.rimStrength,
    rimPower: dials.rimPower,
    emissivePeak: EMISSIVE_PEAK,
    // A texel keyed at least this far feeds the bloom at full mask: the threshold plus its ramp.
    keyFloor: dials.bloomThreshold + BLOOM_SMOOTHING,
    // Blue over peak at which the warm test gives half the heart's strength: smoothstep is half way at its midpoint.
    halfWarmBlue: (WARM_BLUE_FULL + WARM_BLUE_NONE) / 2,
  };
}

const linear = (hex) => {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
};

// three's sRGB decode for every byte value, as the GPU applies it to both textures.
const SRGB_TO_LINEAR = Array.from({ length: 256 }, (_, byte) => new Color().setRGB(byte / 255, 0, 0, SRGBColorSpace).r);

/** A GLB's single painted material: its emissive and albedo texels, decoded, and its emissive factor and strength. */
async function decodeAsset(file) {
  const { default: sharp } = await import('sharp');
  const buffer = readFileSync(new URL(`../../public/assets/${file}`, import.meta.url));
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  const binStart = 20 + jsonLength + 8;
  const view = (index) => {
    const bufferView = json.bufferViews[index];
    const start = binStart + (bufferView.byteOffset ?? 0);
    return buffer.subarray(start, start + bufferView.byteLength);
  };
  const image = (textureIndex) => {
    const texture = json.textures[textureIndex];
    const source = texture.extensions?.EXT_texture_webp?.source ?? texture.source;
    return sharp(view(json.images[source].bufferView)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  };
  if (json.materials.length !== 1) throw new Error(`${file}: expected one material, found ${json.materials.length}`);
  const material = json.materials[0];
  return {
    sha256: createHash('sha256').update(buffer).digest('hex'),
    emissive: await image(material.emissiveTexture.index),
    albedo: await image(material.pbrMetallicRoughness.baseColorTexture.index),
    // loadAsset.ts ignores the base colour factor when the material has a map, as every asset here does.
    emissiveFactor: material.emissiveFactor ?? [0, 0, 0],
    strength: material.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1,
  };
}

function withSaturation(c, amount) {
  const luma = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return c.map((v) => Math.max(luma + (v - luma) * amount, 0));
}

/**
 * Every emitter texel of an asset keyed past the bloom's ramp, lit as described at the top, sorted by blue over peak.
 * With rim set, a silhouette pixel's rim light is added.
 */
function litTexels(asset, inputs, { rim = false } = {}) {
  const { emissive, albedo, emissiveFactor, strength } = asset;
  const sunLinear = linear(inputs.sunColor);
  const sun = sunLinear.map((v) => (v * inputs.sunIntensity) / Math.PI);
  const sky = linear(inputs.ambientSky);
  const ground = linear(inputs.ambientGround);
  const ambient = ground.map((g, i) => (g + (sky[i] - g) * HEMISPHERE_SKY_WEIGHT) * inputs.ambientStrength);
  const rimLight = rim ? sunLinear.map((v, i) => SILHOUETTE_FACING ** inputs.rimPower * inputs.rimStrength * v * sun[i]) : [0, 0, 0];
  const { width, height } = emissive.info;
  const out = [];
  for (let k = 0; k < width * height; k++) {
    const e = [0, 1, 2].map((ch) => SRGB_TO_LINEAR[emissive.data[k * 4 + ch]] * emissiveFactor[ch] * strength);
    const key = Math.max(...e);
    if (key < inputs.keyFloor) continue;
    const ax = Math.floor((((k % width) + 0.5) * albedo.info.width) / width);
    const ay = Math.floor(((Math.floor(k / width) + 0.5) * albedo.info.height) / height);
    const ai = (ay * albedo.info.width + ax) * 4;
    const a = withSaturation([0, 1, 2].map((ch) => SRGB_TO_LINEAR[albedo.data[ai + ch]]), inputs.saturation);
    const cap = Math.min(1, inputs.emissivePeak / key);
    const c = a.map((v, i) => v * (sun[i] + ambient[i]) + rimLight[i] + e[i] * cap);
    const peak = Math.max(...c, 1e-4);
    out.push({ c, ratio: c[2] / peak, leads: c[0] >= Math.max(c[1], c[2]) });
  }
  if (out.length === 0) throw new Error('no emitter texel reached the key floor');
  return out.sort((x, y) => x.ratio - y.ratio);
}

const pick = (texels, p) => texels[Math.min(texels.length - 1, Math.floor(p * texels.length))].c.map((v) => Number(v.toFixed(4)));
// The share of red-led texels the warm test calls at least half warm.
const halfWarm = (texels, inputs) => Number((texels.filter((t) => t.leads && t.ratio <= inputs.halfWarmBlue).length / texels.length).toFixed(4));

/** The generated data, as the test holds it. */
export async function generateWarmTexels(dials = DEFAULT_DIALS) {
  const inputs = warmInputs(dials);
  const assets = Object.fromEntries(await Promise.all(Object.entries(WARM_ASSETS).map(async ([name, file]) => [name, await decodeAsset(file)])));
  const heart = litTexels(assets.heart, inputs);
  const nest = litTexels(assets.nest, inputs);
  const nestRim = litTexels(assets.nest, inputs, { rim: true });
  // The known failure: a strong orange key under a silhouette rim, at the dials' other values.
  const failureInputs = { ...inputs, sunColor: '#ff8844', sunIntensity: 8 };
  const failure = litTexels(assets.nest, failureInputs, { rim: true });
  return {
    assets: Object.fromEntries(Object.entries(WARM_ASSETS).map(([name, file]) => [file, assets[name].sha256])),
    inputs,
    heart: { p1: pick(heart, 0.01), p50: pick(heart, 0.5), p99: pick(heart, 0.99) },
    nest: { p1: pick(nest, 0.01), p50: pick(nest, 0.5), p99: pick(nest, 0.99) },
    cyan: { bolt: pick(litTexels(assets.bolt, inputs), 0.5), bulwark: pick(litTexels(assets.bulwark, inputs), 0.5) },
    nestRim: { p1: pick(nestRim, 0.01), p50: pick(nestRim, 0.5), halfWarm: halfWarm(nestRim, inputs) },
    failure: { p50: pick(failure, 0.5), halfWarm: halfWarm(failure, failureInputs) },
  };
}

function format(value, indent = '') {
  if (Array.isArray(value)) return `[${value.join(', ')}]`;
  if (value && typeof value === 'object') {
    const inner = `${indent}  `;
    const lines = Object.entries(value).map(([key, v]) => `${inner}${/^[A-Za-z_]\w*$/.test(key) ? key : `'${key}'`}: ${format(v, inner)},`);
    return `{\n${lines.join('\n')}\n${indent}}`;
  }
  return typeof value === 'string' ? `'${value}'` : String(value);
}

if (isMain(import.meta.url)) {
  const flag = process.argv.indexOf('--dials');
  const overrides = flag > 0 ? JSON.parse(process.argv[flag + 1] ?? '{}') : {};
  const generated = await generateWarmTexels({ ...DEFAULT_DIALS, ...overrides });
  if (flag > 0) console.log(`// Under ${JSON.stringify(overrides)}: for exploring, not for the test.`);
  console.log('// warm-texels: begin. Written by tools/render/warm-texels.mjs; paste its output over this block.');
  console.log(`const GENERATED = ${format(generated)} as const;`);
  console.log('// warm-texels: end');
}
